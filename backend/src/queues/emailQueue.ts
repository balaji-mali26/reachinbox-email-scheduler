import { Queue, JobsOptions } from 'bullmq';
import { redisConnectionOptions } from '../config/redis';
import { logger } from '../utils/logger';

export const EMAIL_QUEUE_NAME = 'email-queue';

export interface EmailJobPayload {
  emailJobId: string;
}

export const emailQueue = new Queue<EmailJobPayload>(EMAIL_QUEUE_NAME, {
  connection: redisConnectionOptions,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: {
      age: 24 * 3600, // keep completed jobs for 24 hours
      count: 5000,
    },
    removeOnFail: {
      age: 7 * 24 * 3600, // keep failed jobs for 7 days
      count: 5000,
    },
  },
});

emailQueue.on('error', (err) => {
  logger.error({ err }, 'BullMQ email-queue error');
});

/**
 * Canonical helper for generating a BullMQ-safe job ID.
 * BullMQ strictly rejects colons (':') in custom job IDs.
 * Accepts either a raw UUID or an existing legacy ID (e.g. 'email:uuid' or 'email-uuid')
 * and normalizes it deterministically to 'email-{uuid}'.
 */
export function toBullMQJobId(rawEmailJobIdOrBullmqId: string): string {
  const cleanId = rawEmailJobIdOrBullmqId.replace(/^email[:-]/, '');
  return `email-${cleanId}`;
}

/**
 * Enqueues an email job into BullMQ as a persistent delayed job.
 * Note: Zero cron scheduling is used. BullMQ calculates delay from now until scheduledAt.
 */
export async function enqueueEmailJob(
  emailJobId: string,
  scheduledAt: Date,
  options?: Partial<JobsOptions>
) {
  const now = Date.now();
  const delay = Math.max(0, scheduledAt.getTime() - now);
  const bullmqJobId = toBullMQJobId(emailJobId);

  const job = await emailQueue.add(
    'send-email',
    { emailJobId },
    {
      jobId: bullmqJobId,
      delay,
      ...options,
    }
  );

  logger.debug(
    { jobId: job.id, emailJobId, delayMs: delay, scheduledAt: scheduledAt.toISOString() },
    'Enqueued BullMQ delayed job'
  );

  return job;
}

/**
 * Bulk-enqueues multiple email jobs into BullMQ in a single Redis roundtrip.
 * Optimized for 1000+ scheduled recipient batches.
 */
export async function enqueueEmailJobsBulk(
  jobs: Array<{ emailJobId: string; scheduledAt: Date }>,
  options?: Partial<JobsOptions>
) {
  const now = Date.now();
  const bulkPayload = jobs.map((j) => ({
    name: 'send-email',
    data: { emailJobId: j.emailJobId },
    opts: {
      jobId: toBullMQJobId(j.emailJobId),
      delay: Math.max(0, j.scheduledAt.getTime() - now),
      ...options,
    },
  }));

  const enqueued = await emailQueue.addBulk(bulkPayload);
  logger.info({ count: enqueued.length }, 'Bulk enqueued BullMQ delayed jobs into Redis');
  return enqueued;
}
