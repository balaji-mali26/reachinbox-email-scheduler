import { Worker, Job } from 'bullmq';
import { EMAIL_QUEUE_NAME, EmailJobPayload, enqueueEmailJob } from '../queues/emailQueue';
import { redisConnectionOptions } from '../config/redis';
import { emailRepository } from '../repositories/emailRepository';
import { rateLimiterService } from '../services/rateLimiter';
import { sendEmail } from '../integrations/smtpService';
import { prisma } from '../models/prisma';
import { env } from '../config/env';
import { logger } from '../utils/logger';

export function createEmailWorker() {
  const worker = new Worker<EmailJobPayload>(
    EMAIL_QUEUE_NAME,
    async (job: Job<EmailJobPayload>) => {
      const { emailJobId } = job.data;
      logger.info({ jobId: job.id, emailJobId }, 'Processing email job...');

      // 1. Atomically claim job with processing lease
      const claimedJob = await emailRepository.claimJobForProcessing(emailJobId);
      if (!claimedJob) {
        const existingJob = await prisma.emailJob.findUnique({ where: { id: emailJobId } });
        if (existingJob?.status === 'SENT') {
          logger.info({ jobId: job.id, emailJobId }, 'Job already SENT. Idempotent skip.');
          return { status: 'already_sent' };
        }
        if (existingJob?.status === 'FAILED') {
          logger.info({ jobId: job.id, emailJobId }, 'Job already FAILED. Idempotent skip.');
          return { status: 'already_failed' };
        }
        logger.warn(
          { jobId: job.id, emailJobId, currentStatus: existingJob?.status },
          'Job currently locked by active lease or another worker. Postponing.'
        );
        throw new Error(`Job ${emailJobId} is currently locked by active lease`);
      }

      try {
        // 2. Query sender config & batch minDelayMs
        const [sender, batch] = await Promise.all([
          prisma.sender.findUnique({ where: { id: claimedJob.senderId } }),
          claimedJob.batchId
            ? prisma.emailBatch.findUnique({ where: { id: claimedJob.batchId } })
            : null,
        ]);
        const hourlyLimit = batch?.hourlyLimit ?? sender?.hourlyLimit ?? env.DEFAULT_HOURLY_LIMIT;
        const minDelayMs = batch?.minDelayMs ?? env.DEFAULT_MIN_DELAY_MS;

        // 3. Atomically reserve send slot across all concurrent workers via Redis Lua
        const reservation = await rateLimiterService.reserveSlot(
          claimedJob.senderId,
          hourlyLimit,
          minDelayMs
        );

        if (!reservation.allowed && reservation.nextWindowStart) {
          logger.warn(
            {
              emailJobId,
              senderId: claimedJob.senderId,
              nextWindowStart: reservation.nextWindowStart,
            },
            'Sender hourly limit exceeded. Rescheduling email job to next window...'
          );

          // Update DB record to RATE_LIMITED_RESCHEDULED
          await emailRepository.rescheduleJob(
            emailJobId,
            reservation.nextWindowStart
          );

          // Re-enqueue in BullMQ with calculated delay to the next hour window
          await enqueueEmailJob(emailJobId, reservation.nextWindowStart);

          // Trigger isolated Slack rate-limit notification (debounced per sender/hour)
          const targetUserId = sender?.userId || batch?.userId;
          if (targetUserId) {
            try {
              const { slackService } = await import('../services/slackService');
              const hourWindow = rateLimiterService.getHourWindowKey();
              const audit = await prisma.rateLimitAudit.upsert({
                where: {
                  senderId_hourWindow: {
                    senderId: claimedJob.senderId,
                    hourWindow,
                  },
                },
                update: {
                  attemptedJobsCount: { increment: 1 },
                },
                create: {
                  senderId: claimedJob.senderId,
                  hourWindow,
                  attemptedJobsCount: 1,
                },
              });

              if (!audit.notifiedSlackAt) {
                await slackService.sendRateLimitNotification({
                  userId: targetUserId,
                  senderEmail: sender?.email || claimedJob.recipientEmail,
                  hourlyLimit,
                  nextWindowStart: reservation.nextWindowStart!,
                });
                await prisma.rateLimitAudit.update({
                  where: { id: audit.id },
                  data: { notifiedSlackAt: new Date() },
                });
                logger.info(
                  { targetUserId, senderEmail: sender?.email },
                  '📢 Slack rate-limit notification dispatched successfully'
                );
              }
            } catch (alertErr: any) {
              logger.warn({ alertErr: alertErr?.message }, 'Slack notification failed (non-blocking)');
            }
          }

          return {
            status: 'rescheduled',
            reason: 'hourly_limit_reached',
            nextWindowStart: reservation.nextWindowStart,
          };
        }

        // 4. Non-blocking spacing constraint: do NOT sleep/hold worker thread.
        // Instead, update DB scheduledAt to the reserved targetSendTime, re-delay in BullMQ, and release worker immediately.
        const now = Date.now();
        if (reservation.targetSendTime && reservation.targetSendTime > now) {
          const targetDate = new Date(reservation.targetSendTime);
          await prisma.emailJob.update({
            where: { id: emailJobId },
            data: {
              status: 'SCHEDULED',
              scheduledAt: targetDate,
              processingLeaseUntil: null,
            },
          });

          await enqueueEmailJob(emailJobId, targetDate);
          logger.info(
            { emailJobId, targetSendTime: targetDate.toISOString() },
            'Send slot reserved in future. Re-delayed in BullMQ to free worker slot immediately.'
          );

          return {
            status: 're-delayed',
            targetSendTime: targetDate,
          };
        }

        // 5. Dispatch email via Ethereal SMTP with user's selected sender identity
        const fromAddress = sender ? `"${sender.name}" <${sender.email}>` : env.ETHEREAL_FROM;
        
        logger.info(
          {
            tag: '[EMAIL]',
            batchId: claimedJob.batchId,
            jobId: emailJobId,
            recipient: claimedJob.recipientEmail,
            scheduledAt: claimedJob.scheduledAt,
            smtpStarted: true,
          },
          '[EMAIL] Initiating SMTP transmission via Ethereal'
        );

        const result = await sendEmail({
          to: claimedJob.recipientEmail,
          from: fromAddress,
          subject: claimedJob.subject,
          body: claimedJob.body,
        });

        // 6. Mark job as SENT with preview details
        await emailRepository.markJobSent(
          emailJobId,
          result.messageId,
          result.previewUrl
        );

        // 7. Update Elasticsearch status (non-blocking)
        import('../services/searchService').then(({ searchService }) => {
          searchService.updateEmailStatus(emailJobId, 'SENT' as any, {
            sentAt: new Date(),
          });
        });

        logger.info(
          {
            tag: '[EMAIL]',
            batchId: claimedJob.batchId,
            jobId: emailJobId,
            recipient: claimedJob.recipientEmail,
            smtpSuccess: true,
            smtpMessageId: result.messageId,
            previewUrl: result.previewUrl,
            dbUpdated: true,
          },
          '[EMAIL] Email successfully delivered and marked SENT in DB'
        );

        return {
          status: 'sent',
          messageId: result.messageId,
          previewUrl: result.previewUrl,
        };
      } catch (err: any) {
        logger.error(
          {
            tag: '[EMAIL]',
            batchId: claimedJob?.batchId,
            jobId: emailJobId,
            recipient: claimedJob?.recipientEmail,
            smtpError: err.message,
            retryCount: claimedJob?.workerAttempt,
            jobFailed: true,
          },
          '[EMAIL] SMTP delivery failed'
        );

        // Classify permanent vs retryable failure
        const isPermanent =
          (err.responseCode && err.responseCode >= 500 && err.responseCode < 600) ||
          err.code === 'EENVELOPE' ||
          /invalid recipient|recipient rejected|no such user|address not found/i.test(
            err.message || ''
          );

        if (isPermanent) {
          logger.warn(
            { emailJobId, err: err.message },
            'Permanent delivery failure detected (not retrying)'
          );
          await emailRepository.markJobFailed(
            emailJobId,
            `Permanent failure: ${err.message}`
          );
          import('../services/searchService').then(({ searchService }) => {
            searchService.updateEmailStatus(emailJobId, 'FAILED' as any, {
              failureReason: err.message,
            });
          });
          return { status: 'failed', permanent: true, error: err.message };
        }

        // Retryable failure: bounded retry handling
        if (claimedJob.workerAttempt >= 3) {
          await emailRepository.markJobFailed(
            emailJobId,
            `Exceeded maximum delivery attempts: ${err.message}`
          );
          import('../services/searchService').then(({ searchService }) => {
            searchService.updateEmailStatus(emailJobId, 'FAILED' as any, {
              failureReason: err.message,
            });
          });
        } else {
          // Release lease and reset status back to SCHEDULED so BullMQ retry can re-claim it!
          await prisma.emailJob.update({
            where: { id: emailJobId },
            data: {
              status: 'SCHEDULED',
              processingLeaseUntil: null,
            },
          });
          logger.warn(
            { emailJobId, attempt: claimedJob.workerAttempt },
            'Transient failure; reset status to SCHEDULED for BullMQ retry'
          );
        }

        throw err; // Signal failure to BullMQ for exponential backoff
      }
    },
    {
      connection: redisConnectionOptions,
      concurrency: env.WORKER_CONCURRENCY,
    }
  );

  worker.on('ready', () => {
    logger.info(
      { host: redisConnectionOptions.host, port: redisConnectionOptions.port },
      '⚡ BullMQ Email Worker connected to Redis and ready to process jobs'
    );
  });

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id }, 'BullMQ job marked completed');
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err: err.message }, 'BullMQ job failed');
  });

  worker.on('error', (err) => {
    logger.error({ err: err.message }, '❌ BullMQ Worker connection error');
  });

  return worker;
}

// Standalone worker execution entrypoint
if (require.main === module) {
  logger.info(
    `Starting standalone BullMQ Email Worker (Concurrency: ${env.WORKER_CONCURRENCY})...`
  );
  
  import('../services/reconciliationService').then(({ reconciliationService }) => {
    reconciliationService.runReconciliation().catch((err) => {
      logger.error({ err }, 'Worker startup reconciliation error');
    });
  });

  const worker = createEmailWorker();

  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}. Shutting down BullMQ worker...`);
    await worker.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
