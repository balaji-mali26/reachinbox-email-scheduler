import { redis } from '../config/redis';
import { emailQueue, enqueueEmailJob, toBullMQJobId } from '../queues/emailQueue';
import { emailRepository } from '../repositories/emailRepository';
import { prisma } from '../models/prisma';
import { JobStatus } from '@prisma/client';
import { logger } from '../utils/logger';
import { randomUUID } from 'crypto';

const RECONCILIATION_LOCK_KEY = 'lock:reconciliation';
const LOCK_TTL_SECONDS = 60;

export interface ReconciliationSummary {
  restoredMissingJobs: number;
  recoveredExpiredLeases: number;
  failedExpiredLeases: number;
  skippedActiveJobs: number;
}

export class ReconciliationService {
  /**
   * Executes single-owner reconciliation guarded by a distributed Redis lock.
   * Ensures that if both API and Worker processes boot concurrently, only one reconciles.
   */
  async runReconciliation(): Promise<ReconciliationSummary | null> {
    const ownerId = randomUUID();
    const acquired = await redis.set(
      RECONCILIATION_LOCK_KEY,
      ownerId,
      'EX',
      LOCK_TTL_SECONDS,
      'NX'
    );

    if (!acquired) {
      logger.info('Another instance holds the reconciliation lock. Skipping reconciliation on this node.');
      return null;
    }

    logger.info({ ownerId }, '🔒 Acquired reconciliation lock. Running startup audit...');

    const summary: ReconciliationSummary = {
      restoredMissingJobs: 0,
      recoveredExpiredLeases: 0,
      failedExpiredLeases: 0,
      skippedActiveJobs: 0,
    };

    try {
      // 1. Audit SCHEDULED, RATE_LIMITED_RESCHEDULED, and FAILED jobs
      const pendingJobs = await prisma.emailJob.findMany({
        where: {
          status: {
            in: [JobStatus.SCHEDULED, JobStatus.RATE_LIMITED_RESCHEDULED, JobStatus.FAILED],
          },
        },
      });

      const nowTime = Date.now();
      for (const job of pendingJobs) {
        const safeBullmqJobId = toBullMQJobId(job.bullmqJobId || job.id);
        const existingQueueJob = await emailQueue.getJob(safeBullmqJobId);

        let needsEnqueue = false;
        if (!existingQueueJob) {
          needsEnqueue = true;
        } else {
          const isFailed = await existingQueueJob.isFailed();
          const isCompleted = await existingQueueJob.isCompleted();
          // If BullMQ job failed, completed while DB isn't SENT, or is due in the past and not active
          if (
            isFailed ||
            isCompleted ||
            job.status === JobStatus.FAILED ||
            (job.scheduledAt.getTime() <= nowTime && !(await existingQueueJob.isActive()))
          ) {
            try {
              await existingQueueJob.remove();
            } catch (_rErr) {}
            needsEnqueue = true;
          }
        }

        if (needsEnqueue) {
          logger.info(
            { jobId: job.id, bullmqJobId: safeBullmqJobId },
            'Restoring and re-enqueuing job into BullMQ for immediate delivery...'
          );

          const targetDate = job.scheduledAt.getTime() <= nowTime ? new Date(nowTime) : job.scheduledAt;

          await prisma.emailJob.update({
            where: { id: job.id },
            data: {
              status: JobStatus.SCHEDULED,
              scheduledAt: targetDate,
              processingLeaseUntil: null,
              failedAt: null,
              failureReason: null,
              bullmqJobId: safeBullmqJobId,
            },
          });

          await enqueueEmailJob(job.id, targetDate);
          summary.restoredMissingJobs++;
        } else {
          summary.skippedActiveJobs++;
        }
      }

      // 2. Audit Expired PROCESSING Leases (Worker Crash Recovery)
      const expiredLeaseJobs = await emailRepository.findExpiredLeaseJobs();

      for (const job of expiredLeaseJobs) {
        logger.warn(
          {
            jobId: job.id,
            attempt: job.workerAttempt,
            leaseExpiredAt: job.processingLeaseUntil,
          },
          'Detected orphaned job with expired processing lease'
        );

        if (job.workerAttempt < 3) {
          const updateData: any = {
            status: JobStatus.SCHEDULED,
            processingLeaseUntil: null,
          };
          if (job.bullmqJobId && job.bullmqJobId.includes(':')) {
            updateData.bullmqJobId = toBullMQJobId(job.bullmqJobId);
          }
          // Recover back to SCHEDULED and re-enqueue immediately
          await prisma.emailJob.update({
            where: { id: job.id },
            data: updateData,
          });
          await enqueueEmailJob(job.id, new Date());
          summary.recoveredExpiredLeases++;
        } else {
          // Max attempts reached; mark permanently FAILED
          await emailRepository.markJobFailed(
            job.id,
            'Processing lease expired after maximum retries (worker crash recovery limit reached)'
          );
          summary.failedExpiredLeases++;
        }
      }

      logger.info(
        summary,
        '✅ Startup reconciliation complete: Database and BullMQ state are fully synchronized'
      );

      return summary;
    } finally {
      // Safely release lock only if we still own it
      const currentOwner = await redis.get(RECONCILIATION_LOCK_KEY);
      if (currentOwner === ownerId) {
        await redis.del(RECONCILIATION_LOCK_KEY);
        logger.debug('🔓 Released reconciliation lock');
      }
    }
  }
}

export const reconciliationService = new ReconciliationService();
