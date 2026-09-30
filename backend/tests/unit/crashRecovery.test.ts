import { ReconciliationService } from '../../src/services/reconciliationService';
import { redis } from '../../src/config/redis';
import { emailQueue, enqueueEmailJob } from '../../src/queues/emailQueue';
import { emailRepository } from '../../src/repositories/emailRepository';
import { prisma } from '../../src/models/prisma';
import { JobStatus } from '@prisma/client';

jest.mock('../../src/config/redis', () => ({
  redis: {
    set: jest.fn(),
    get: jest.fn(),
    del: jest.fn(),
  },
}));

jest.mock('../../src/queues/emailQueue', () => ({
  emailQueue: {
    getJob: jest.fn(),
  },
  enqueueEmailJob: jest.fn(),
  toBullMQJobId: (id: string) => `email-${id.replace(/^email[:-]/, '')}`,
}));

jest.mock('../../src/repositories/emailRepository', () => ({
  emailRepository: {
    findJobsNeedingQueue: jest.fn(),
    findExpiredLeaseJobs: jest.fn(),
    markJobFailed: jest.fn(),
  },
}));

jest.mock('../../src/models/prisma', () => ({
  prisma: {
    emailJob: {
      update: jest.fn(),
    },
  },
}));

describe('Crash-Window & Expired Lease Recovery Test Suite', () => {
  let reconciler: ReconciliationService;

  beforeEach(() => {
    reconciler = new ReconciliationService();
    jest.clearAllMocks();
  });

  it('Case A: should recover a job from a crashed worker when lease has expired', async () => {
    (redis.set as jest.Mock).mockResolvedValue('OK');
    (redis.get as jest.Mock).mockResolvedValue('lock-owner');

    const expiredTimestamp = new Date(Date.now() - 1000 * 60 * 10); // 10 minutes ago
    (emailRepository.findJobsNeedingQueue as jest.Mock).mockResolvedValue([]);
    (emailRepository.findExpiredLeaseJobs as jest.Mock).mockResolvedValue([
      {
        id: 'crashed-job-1',
        workerAttempt: 1,
        status: JobStatus.PROCESSING,
        processingLeaseUntil: expiredTimestamp,
      },
    ]);

    const summary = await reconciler.runReconciliation();

    expect(summary?.recoveredExpiredLeases).toBe(1);
    expect(prisma.emailJob.update).toHaveBeenCalledWith({
      where: { id: 'crashed-job-1' },
      data: {
        status: JobStatus.SCHEDULED,
        processingLeaseUntil: null,
      },
    });
    expect(enqueueEmailJob).toHaveBeenCalledWith('crashed-job-1', expect.any(Date));
  });

  it('Case B: should mark job FAILED when workerAttempt reaches maximum crash limit', async () => {
    (redis.set as jest.Mock).mockResolvedValue('OK');
    (redis.get as jest.Mock).mockResolvedValue('lock-owner');

    (emailRepository.findJobsNeedingQueue as jest.Mock).mockResolvedValue([]);
    (emailRepository.findExpiredLeaseJobs as jest.Mock).mockResolvedValue([
      {
        id: 'unrecoverable-job',
        workerAttempt: 3,
        status: JobStatus.PROCESSING,
        processingLeaseUntil: new Date(Date.now() - 5000),
      },
    ]);

    const summary = await reconciler.runReconciliation();

    expect(summary?.failedExpiredLeases).toBe(1);
    expect(emailRepository.markJobFailed).toHaveBeenCalledWith(
      'unrecoverable-job',
      expect.stringContaining('crash recovery limit reached')
    );
  });

  it('Case C: should restore missing BullMQ jobs without duplicating active ones', async () => {
    (redis.set as jest.Mock).mockResolvedValue('OK');
    (redis.get as jest.Mock).mockResolvedValue('lock-owner');

    const scheduledDate = new Date(Date.now() + 60000);
    (emailRepository.findJobsNeedingQueue as jest.Mock).mockResolvedValue([
      {
        id: 'missing-job',
        bullmqJobId: 'email:missing-job',
        scheduledAt: scheduledDate,
      },
      {
        id: 'active-job',
        bullmqJobId: 'email:active-job',
        scheduledAt: scheduledDate,
      },
    ]);

    (emailQueue.getJob as jest.Mock).mockImplementation(async (jobId) => {
      if (jobId === 'email-active-job' || jobId === 'email:active-job') return { id: jobId };
      return null; // 'missing-job' was lost
    });

    (emailRepository.findExpiredLeaseJobs as jest.Mock).mockResolvedValue([]);

    const summary = await reconciler.runReconciliation();

    expect(summary?.restoredMissingJobs).toBe(1);
    expect(summary?.skippedActiveJobs).toBe(1);
    expect(enqueueEmailJob).toHaveBeenCalledTimes(1);
    expect(enqueueEmailJob).toHaveBeenCalledWith('missing-job', scheduledDate);
  });

  it('Case D: should prevent duplicate reconciliation when lock is held by another instance', async () => {
    (redis.set as jest.Mock).mockResolvedValue(null); // lock not acquired

    const summary = await reconciler.runReconciliation();

    expect(summary).toBeNull();
    expect(emailRepository.findJobsNeedingQueue).not.toHaveBeenCalled();
    expect(emailRepository.findExpiredLeaseJobs).not.toHaveBeenCalled();
  });
});
