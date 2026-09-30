import { RateLimiterService } from '../../src/services/rateLimiter';
import { redis } from '../../src/config/redis';

jest.mock('../../src/config/redis', () => ({
  redis: {
    eval: jest.fn(),
  },
}));

describe('Concurrency & Atomic Distributed Rate Limiting Test Suite', () => {
  let rateLimiter: RateLimiterService;

  beforeEach(() => {
    rateLimiter = new RateLimiterService();
    jest.clearAllMocks();
  });

  it('should enforce quota limit under concurrent worker requests', async () => {
    const quota = 10;
    const minDelayMs = 2000;
    let currentCounter = 0;
    let lastSent = 0;

    // Simulate atomic Redis Lua script behavior in memory
    (redis.eval as jest.Mock).mockImplementation(
      async (_script, _numKeys, _key1, _key2, maxLimitStr, minDelayStr, nowStr) => {
        const maxLimit = parseInt(maxLimitStr, 10);
        const minDelay = parseInt(minDelayStr, 10);
        const now = parseInt(nowStr, 10);

        if (currentCounter >= maxLimit) {
          return [0, currentCounter];
        }

        const earliestAllowed = lastSent + minDelay;
        const targetSendTime = Math.max(now, earliestAllowed);

        currentCounter++;
        lastSent = targetSendTime;

        return [1, targetSendTime];
      }
    );

    // Launch 100 concurrent workers requesting send slots
    const workerPromises = Array.from({ length: 100 }, (_, i) =>
      rateLimiter.reserveSlot('sender-concurrent', quota, minDelayMs)
    );

    const results = await Promise.all(workerPromises);

    const allowed = results.filter((r) => r.allowed);
    const rescheduled = results.filter((r) => !r.allowed);

    // Strictly 10 granted, 90 rescheduled
    expect(allowed).toHaveLength(10);
    expect(rescheduled).toHaveLength(90);

    // Verify minimum delay spacing between consecutive granted slots
    const sendTimes = allowed.map((r) => r.targetSendTime!).sort((a, b) => a - b);
    for (let i = 1; i < sendTimes.length; i++) {
      const diff = sendTimes[i] - sendTimes[i - 1];
      expect(diff).toBeGreaterThanOrEqual(minDelayMs);
    }

    // Verify rescheduled jobs have nextWindowStart and delay > 0
    rescheduled.forEach((r) => {
      expect(r.nextWindowStart).toBeDefined();
      expect(r.rescheduleDelayMs).toBeGreaterThan(0);
    });
  });
});
