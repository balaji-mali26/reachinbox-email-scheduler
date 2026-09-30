import { prisma } from '../models/prisma';
import { JobStatus, EmailJob, EmailBatch } from '@prisma/client';
import { env } from '../config/env';
import { toBullMQJobId } from '../queues/emailQueue';

export interface CreateBatchInput {
  userId: string;
  senderId: string;
  subject: string;
  body: string;
  startAt: Date;
  minDelayMs: number;
  hourlyLimit: number;
  recipients: Array<{
    email: string;
    scheduledAt: Date;
  }>;
}

export class EmailRepository {
  /**
   * Persists an email batch and its associated jobs in a single database transaction.
   */
  async createBatchWithJobs(input: CreateBatchInput): Promise<{
    batch: EmailBatch;
    jobs: EmailJob[];
  }> {
    return prisma.$transaction(async (tx) => {
      const batch = await tx.emailBatch.create({
        data: {
          userId: input.userId,
          senderId: input.senderId,
          subject: input.subject,
          body: input.body,
          startAt: input.startAt,
          minDelayMs: input.minDelayMs,
          hourlyLimit: input.hourlyLimit,
          totalRecipients: input.recipients.length,
        },
      });

      const jobsData = input.recipients.map((recipient) => {
        const jobId = crypto.randomUUID();
        return {
          id: jobId,
          batchId: batch.id,
          senderId: input.senderId,
          recipientEmail: recipient.email,
          subject: input.subject,
          body: input.body,
          status: JobStatus.SCHEDULED,
          scheduledAt: recipient.scheduledAt,
          bullmqJobId: toBullMQJobId(jobId),
        };
      });

      await tx.emailJob.createMany({
        data: jobsData,
      });

      const jobs = await tx.emailJob.findMany({
        where: { batchId: batch.id },
      });

      return { batch, jobs };
    });
  }

  /**
   * Atomically claims an email job for processing with a 5-minute lease.
   * If another worker claimed it or it is no longer processable, returns null.
   */
  async claimJobForProcessing(jobId: string): Promise<EmailJob | null> {
    const leaseMinutes = env.PROCESSING_LEASE_MINUTES;

    // Use raw query for true atomic update with lease timestamp
    const claimed = await prisma.$queryRaw<EmailJob[]>`
      UPDATE "EmailJob"
      SET 
        status = 'PROCESSING'::"JobStatus",
        "processingStartedAt" = NOW(),
        "processingLeaseUntil" = NOW() + (${leaseMinutes} * INTERVAL '1 minute'),
        "workerAttempt" = "workerAttempt" + 1,
        "updatedAt" = NOW()
      WHERE id = ${jobId}
        AND (
          status IN ('SCHEDULED'::"JobStatus", 'RATE_LIMITED_RESCHEDULED'::"JobStatus")
          OR (status = 'PROCESSING'::"JobStatus" AND "processingLeaseUntil" < NOW())
        )
      RETURNING *;
    `;

    return claimed.length > 0 ? claimed[0] : null;
  }

  /**
   * Marks a job as successfully sent with Ethereal SMTP message ID and preview link.
   */
  async markJobSent(
    jobId: string,
    messageId: string,
    previewUrl?: string | false
  ): Promise<EmailJob> {
    return prisma.emailJob.update({
      where: { id: jobId },
      data: {
        status: JobStatus.SENT,
        sentAt: new Date(),
        etherealMessageId: messageId,
        etherealPreviewUrl: previewUrl || null,
        processingLeaseUntil: null,
      },
    });
  }

  /**
   * Marks a job as permanently failed with failure reason.
   */
  async markJobFailed(jobId: string, reason: string): Promise<EmailJob> {
    return prisma.emailJob.update({
      where: { id: jobId },
      data: {
        status: JobStatus.FAILED,
        failedAt: new Date(),
        failureReason: reason,
        processingLeaseUntil: null,
      },
    });
  }

  /**
   * Reschedules a job due to rate limit, updating scheduledAt and status.
   */
  async rescheduleJob(jobId: string, newScheduledAt: Date): Promise<EmailJob> {
    return prisma.emailJob.update({
      where: { id: jobId },
      data: {
        status: JobStatus.RATE_LIMITED_RESCHEDULED,
        scheduledAt: newScheduledAt,
        processingLeaseUntil: null,
      },
    });
  }

  /**
   * Finds all jobs requiring queue reconciliation (SCHEDULED or RATE_LIMITED_RESCHEDULED).
   */
  async findJobsNeedingQueue(): Promise<EmailJob[]> {
    return prisma.emailJob.findMany({
      where: {
        status: {
          in: [JobStatus.SCHEDULED, JobStatus.RATE_LIMITED_RESCHEDULED],
        },
      },
    });
  }

  /**
   * Finds all PROCESSING jobs whose lease has expired for crash recovery.
   */
  async findExpiredLeaseJobs(): Promise<EmailJob[]> {
    return prisma.emailJob.findMany({
      where: {
        status: JobStatus.PROCESSING,
        processingLeaseUntil: {
          lt: new Date(),
        },
      },
    });
  }
}

export const emailRepository = new EmailRepository();
