import { ScheduleService } from '../../src/services/scheduleService';
import { emailRepository } from '../../src/repositories/emailRepository';
import { enqueueEmailJobsBulk } from '../../src/queues/emailQueue';
import { prisma } from '../../src/models/prisma';

jest.mock('../../src/repositories/emailRepository', () => ({
  emailRepository: {
    createBatchWithJobs: jest.fn(),
  },
}));

jest.mock('../../src/queues/emailQueue', () => ({
  enqueueEmailJobsBulk: jest.fn(),
}));

jest.mock('../../src/models/prisma', () => ({
  prisma: {
    sender: {
      findFirst: jest.fn(),
    },
    emailJob: {
      update: jest.fn(),
    },
  },
}));

jest.mock('../../src/services/searchService', () => ({
  searchService: {
    indexEmailsBulk: jest.fn().mockImplementation(async () => {}),
    indexEmail: jest.fn().mockImplementation(async () => {}),
    updateEmailStatus: jest.fn().mockImplementation(async () => {}),
  },
}));

describe('Audit Verification: 1000+ Scheduling & Multi-Tenant Isolation', () => {
  let scheduleService: ScheduleService;

  beforeEach(() => {
    scheduleService = new ScheduleService();
    jest.clearAllMocks();
  });

  describe('1000+ Email Scheduling with BullMQ Bulk Enqueue', () => {
    it('should scale to 1000 recipients using bulk DB persistence and BullMQ addBulk', async () => {
      const userAId = 'user-alice-123';
      const senderAId = 'sender-alice-1';

      // 1. User A owns Sender A
      (prisma.sender.findFirst as jest.Mock).mockResolvedValue({
        id: senderAId,
        userId: userAId,
        email: 'alice@company.test',
        name: 'Alice Marketing',
        hourlyLimit: 1000,
      });

      // Generate 1,000 distinct email recipients
      const recipients = Array.from({ length: 1000 }, (_, i) => `lead_${i}@enterprise.test`);

      const mockJobs = recipients.map((email, idx) => ({
        id: `job-uuid-${idx}`,
        recipientEmail: email,
        scheduledAt: new Date(Date.now() + idx * 2000),
        status: 'SCHEDULED',
      }));

      (emailRepository.createBatchWithJobs as jest.Mock).mockResolvedValue({
        batch: { id: 'batch-1000', totalRecipients: 1000 },
        jobs: mockJobs,
      });

      (enqueueEmailJobsBulk as jest.Mock).mockResolvedValue(
        mockJobs.map((j) => ({ id: `email:${j.id}` }))
      );

      const startTime = Date.now();
      const result = await scheduleService.scheduleCampaign(userAId, {
        senderId: senderAId,
        subject: 'Q4 Product Roadmap Update',
        body: 'Hello, please find our Q4 update attached.',
        startAt: new Date().toISOString(),
        minDelayMs: 2000,
        hourlyLimit: 1000,
        recipients,
      });
      const durationMs = Date.now() - startTime;

      expect(result.batchId).toBe('batch-1000');
      expect(result.totalJobs).toBe(1000);
      expect(enqueueEmailJobsBulk).toHaveBeenCalledTimes(1);

      // Verify bulk array passed to BullMQ contains all 1000 jobs
      const bulkPayload = (enqueueEmailJobsBulk as jest.Mock).mock.calls[0][0];
      expect(bulkPayload).toHaveLength(1000);
      expect(bulkPayload[0].emailJobId).toBe('job-uuid-0');
      expect(bulkPayload[999].emailJobId).toBe('job-uuid-999');
    });
  });

  describe('Multi-Sender Tenant Isolation', () => {
    it('should reject scheduling if User A attempts to use User B sender', async () => {
      const userAId = 'user-alice-123';
      const senderBId = 'sender-bob-999';

      // Sender B belongs to Bob, NOT Alice
      (prisma.sender.findFirst as jest.Mock).mockResolvedValue(null);

      try {
        await scheduleService.scheduleCampaign(userAId, {
          senderId: senderBId,
          subject: 'Unauthorized campaign',
          body: 'This should fail',
          startAt: new Date().toISOString(),
          minDelayMs: 2000,
          hourlyLimit: 100,
          recipients: ['victim@test.com'],
        });
        expect('should not reach here').toBe('failed');
      } catch (err: any) {
        expect(err.message).toBe('Sender not found or not owned by the authenticated user');
        expect(err.statusCode).toBe(403);
        expect(err.code).toBe('FORBIDDEN');
      }

      expect(emailRepository.createBatchWithJobs).not.toHaveBeenCalled();
      expect(enqueueEmailJobsBulk).not.toHaveBeenCalled();
    });
  });
});
