import { RateLimiterService } from '../../src/services/rateLimiter';
import { redis } from '../../src/config/redis';

jest.mock('../../src/config/redis', () => ({
  redis: {
    eval: jest.fn(),
  },
}));

describe('Atomic Distributed Rate Limiter', () => {
  let rateLimiter: RateLimiterService;

  beforeEach(() => {
    rateLimiter = new RateLimiterService();
    jest.clearAllMocks();
  });

  it('should correctly format hourly window keys in UTC', () => {
    const fixedDate = new Date('2026-10-15T14:25:00Z');
    const key = rateLimiter.getHourWindowKey(fixedDate);
    expect(key).toBe('2026-10-15-14');
  });

  it('should compute correct start of next hour window', () => {
    const fixedDate = new Date('2026-10-15T14:25:30Z');
    const nextWindow = rateLimiter.getNextHourWindowStart(fixedDate);
    expect(nextWindow.toISOString()).toBe('2026-10-15T15:00:00.000Z');
  });

  it('should return allowed: true when quota is available', async () => {
    const now = Date.now();
    (redis.eval as jest.Mock).mockResolvedValue([1, now + 2000]);

    const result = await rateLimiter.reserveSlot('sender-123', 50, 2000);

    expect(result.allowed).toBe(true);
    expect(result.targetSendTime).toBe(now + 2000);
    expect(redis.eval).toHaveBeenCalledWith(
      expect.any(String),
      2,
      expect.stringContaining('rate:sender:sender-123:'),
      'rate:sender:sender-123:last_sent',
      '50',
      '2000',
      expect.any(String),
      '7200'
    );
  });

  it('should return allowed: false and calculate reschedule delay when quota is exceeded', async () => {
    (redis.eval as jest.Mock).mockResolvedValue([0, 50]); // current count is 50/50

    const result = await rateLimiter.reserveSlot('sender-123', 50, 2000);

    expect(result.allowed).toBe(false);
    expect(result.currentCount).toBe(50);
    expect(result.rescheduleDelayMs).toBeGreaterThan(0);
    expect(result.nextWindowStart).toBeDefined();
  });
});
