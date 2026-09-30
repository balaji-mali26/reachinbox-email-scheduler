import { emailRepository } from '../repositories/emailRepository';
import { enqueueEmailJobsBulk } from '../queues/emailQueue';
import { ScheduleEmailInput } from '../validators/scheduleValidator';
import { prisma } from '../models/prisma';
import { searchService } from './searchService';
import { logger } from '../utils/logger';
import { env } from '../config/env';

export class ScheduleService {
  async scheduleCampaign(userId: string, input: ScheduleEmailInput) {
    // 1. Resolve or verify sender belonging to this authenticated user
    let sender = null;
    if (input.senderId && input.senderId !== 'default') {
      sender = await prisma.sender.findFirst({
        where: {
          id: input.senderId,
          userId: userId,
        },
      });
      if (!sender) {
        const err: any = new Error('Sender not found or not owned by the authenticated user');
        err.statusCode = 403;
        err.code = 'FORBIDDEN';
        throw err;
      }
    } else {
      sender = await prisma.sender.findFirst({
        where: { userId },
      });

      if (!sender && prisma.user?.findUnique) {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (user) {
          sender = await prisma.sender.create({
            data: {
              userId: user.id,
              email: user.email,
              name: user.name || 'Default Sender',
              hourlyLimit: env.DEFAULT_HOURLY_LIMIT,
            },
          });
        }
      }
    }

    if (!sender) {
      const err: any = new Error('Sender not found or not owned by the authenticated user');
      err.statusCode = 403;
      err.code = 'FORBIDDEN';
      throw err;
    }

    const now = Date.now();
    const requestedDate = new Date(input.startAt);

    // Validate past dates for scheduled jobs
    if (!input.sendNow && requestedDate.getTime() < now - 60000) {
      const err: any = new Error('Scheduled date and time cannot be in the past');
      err.statusCode = 400;
      err.code = 'BAD_REQUEST';
      throw err;
    }

    // Determine start date: if sendNow or requested within 15s of now, execute immediately
    let startDate: Date;
    if (input.sendNow || requestedDate.getTime() <= now + 15000) {
      startDate = new Date(now);
    } else {
      startDate = requestedDate;
    }

    const minDelayMs = input.minDelayMs ?? 2000;
    const hourlyLimit = input.hourlyLimit ?? sender.hourlyLimit;

    if (input.hourlyLimit && sender.hourlyLimit !== input.hourlyLimit) {
      await prisma.sender.update({
        where: { id: sender.id },
        data: { hourlyLimit: input.hourlyLimit },
      });
    }

    // 2. Prepare recipients with staggered initial scheduled timestamps
    const recipientJobs = input.recipients.map((email, index) => {
      const scheduledAt = new Date(startDate.getTime() + index * minDelayMs);
      return {
        email,
        scheduledAt,
      };
    });

    // 3. Persist batch and jobs in PostgreSQL
    const { batch, jobs } = await emailRepository.createBatchWithJobs({
      userId,
      senderId: sender.id,
      subject: input.subject,
      body: input.body,
      startAt: startDate,
      minDelayMs,
      hourlyLimit,
      recipients: recipientJobs,
    });

    logger.info(
      { batchId: batch.id, totalJobs: jobs.length, userId },
      'Persisted email batch and jobs in PostgreSQL'
    );

    // 4. Bulk enqueue BullMQ delayed jobs in a single Redis operation
    const bulkPayload = jobs.map((job) => ({
      emailJobId: job.id,
      scheduledAt: job.scheduledAt,
    }));
    const enqueuedJobs = await enqueueEmailJobsBulk(bulkPayload);

    logger.info(
      { batchId: batch.id, enqueuedCount: enqueuedJobs.length },
      'Bulk enqueued BullMQ delayed jobs into Redis'
    );

    // 5. Index email metadata into Elasticsearch asynchronously (non-blocking)
    setImmediate(() => {
      const docs = jobs.map((job) => ({
        emailJobId: job.id,
        batchId: batch.id,
        userId,
        senderId: sender.id,
        recipientEmail: job.recipientEmail,
        subject: job.subject,
        body: job.body,
        status: job.status,
        scheduledAt: job.scheduledAt.toISOString(),
      }));
      Promise.resolve(searchService.indexEmailsBulk(docs)).catch(() => {});
    });

    return {
      batchId: batch.id,
      totalJobs: jobs.length,
      firstScheduledAt: recipientJobs[0]?.scheduledAt,
      lastScheduledAt: recipientJobs[recipientJobs.length - 1]?.scheduledAt,
    };
  }
}

export const scheduleService = new ScheduleService();
