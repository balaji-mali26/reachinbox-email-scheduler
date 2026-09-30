import { ReconciliationService } from '../../src/services/reconciliationService';
import { redis } from '../../src/config/redis';
import { emailQueue, enqueueEmailJob } from '../../src/queues/emailQueue';
import { emailRepository } from '../../src/repositories/emailRepository';
import { prisma } from '../../src/models/prisma';
import { JobStatus } from '@prisma/client';

// Mock dependencies
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

describe('Single-Owner Startup Reconciliation & Crash Recovery', () => {
  let reconciler: ReconciliationService;

  beforeEach(() => {
    reconciler = new ReconciliationService();
    jest.clearAllMocks();
  });

  it('should skip reconciliation if distributed lock is held by another process', async () => {
    (redis.set as jest.Mock).mockResolvedValue(null);

    const result = await reconciler.runReconciliation();

    expect(result).toBeNull();
    expect(emailRepository.findJobsNeedingQueue).not.toHaveBeenCalled();
  });

  it('should restore missing BullMQ jobs for SCHEDULED records', async () => {
    (redis.set as jest.Mock).mockResolvedValue('OK');
    (redis.get as jest.Mock).mockResolvedValue('owner-1');

    const scheduledDate = new Date();
    (emailRepository.findJobsNeedingQueue as jest.Mock).mockResolvedValue([
      {
        id: 'job-1',
        bullmqJobId: 'email:job-1',
        scheduledAt: scheduledDate,
        status: JobStatus.SCHEDULED,
      },
    ]);
    (emailQueue.getJob as jest.Mock).mockResolvedValue(null); // missing from Redis
    (emailRepository.findExpiredLeaseJobs as jest.Mock).mockResolvedValue([]);

    const summary = await reconciler.runReconciliation();

    expect(summary).not.toBeNull();
    expect(summary?.restoredMissingJobs).toBe(1);
    expect(enqueueEmailJob).toHaveBeenCalledWith('job-1', scheduledDate);
  });

  it('should not duplicate jobs that already exist in BullMQ', async () => {
    (redis.set as jest.Mock).mockResolvedValue('OK');
    (redis.get as jest.Mock).mockResolvedValue('owner-1');

    (emailRepository.findJobsNeedingQueue as jest.Mock).mockResolvedValue([
      {
        id: 'job-2',
        bullmqJobId: 'email:job-2',
        scheduledAt: new Date(),
        status: JobStatus.SCHEDULED,
      },
    ]);
    (emailQueue.getJob as jest.Mock).mockImplementation(async (id) => {
      if (id === 'email-job-2' || id === 'email:job-2') return { id };
      return null;
    });
    (emailRepository.findExpiredLeaseJobs as jest.Mock).mockResolvedValue([]);

    const summary = await reconciler.runReconciliation();

    expect(summary?.skippedActiveJobs).toBe(1);
    expect(summary?.restoredMissingJobs).toBe(0);
    expect(enqueueEmailJob).not.toHaveBeenCalled();
  });

  it('should recover expired PROCESSING leases when attempts < 3', async () => {
    (redis.set as jest.Mock).mockResolvedValue('OK');
    (redis.get as jest.Mock).mockResolvedValue('owner-1');

    (emailRepository.findJobsNeedingQueue as jest.Mock).mockResolvedValue([]);
    (emailRepository.findExpiredLeaseJobs as jest.Mock).mockResolvedValue([
      {
        id: 'job-crash',
        workerAttempt: 1,
        status: JobStatus.PROCESSING,
        processingLeaseUntil: new Date(Date.now() - 60000), // expired 1 min ago
      },
    ]);

    const summary = await reconciler.runReconciliation();

    expect(summary?.recoveredExpiredLeases).toBe(1);
    expect(prisma.emailJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'job-crash' },
        data: {
          status: JobStatus.SCHEDULED,
          processingLeaseUntil: null,
        },
      })
    );
    expect(enqueueEmailJob).toHaveBeenCalledWith('job-crash', expect.any(Date));
  });

  it('should mark job FAILED when workerAttempt >= 3 on expired lease', async () => {
    (redis.set as jest.Mock).mockResolvedValue('OK');
    (redis.get as jest.Mock).mockResolvedValue('owner-1');

    (emailRepository.findJobsNeedingQueue as jest.Mock).mockResolvedValue([]);
    (emailRepository.findExpiredLeaseJobs as jest.Mock).mockResolvedValue([
      {
        id: 'job-fatal',
        workerAttempt: 3,
        status: JobStatus.PROCESSING,
        processingLeaseUntil: new Date(Date.now() - 60000),
      },
    ]);

    const summary = await reconciler.runReconciliation();

    expect(summary?.failedExpiredLeases).toBe(1);
    expect(emailRepository.markJobFailed).toHaveBeenCalledWith(
      'job-fatal',
      expect.stringContaining('crash recovery limit reached')
    );
  });
});
