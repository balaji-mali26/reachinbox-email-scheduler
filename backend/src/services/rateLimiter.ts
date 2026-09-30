import { redis } from '../config/redis';
import { logger } from '../utils/logger';

// Atomic Redis Lua Script for Slot Reservation & Hourly Quota Enforcement
const ATOMIC_SLOT_RESERVATION_LUA = `
local hourlyKey = KEYS[1]
local lastSentKey = KEYS[2]

local maxLimit = tonumber(ARGV[1])
local minDelay = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])

local currentCount = tonumber(redis.call('GET', hourlyKey) or '0')

-- 1. Check hourly quota
if currentCount >= maxLimit then
  return { 0, currentCount }
end

-- 2. Check and reserve send slot respecting minimum spacing
local lastSent = tonumber(redis.call('GET', lastSentKey) or '0')
local earliestAllowed = lastSent + minDelay
local targetSendTime = now

if earliestAllowed > now then
  targetSendTime = earliestAllowed
end

-- 3. Atomically consume 1 email quota for this hour window
local newCount = redis.call('INCR', hourlyKey)
if newCount == 1 then
  redis.call('EXPIRE', hourlyKey, ttl)
end

-- 4. Atomically reserve targetSendTime as the new last_sent milestone
redis.call('SET', lastSentKey, tostring(targetSendTime), 'EX', ttl)

-- Return 1: Allowed, with targetSendTime timestamp
return { 1, targetSendTime }
`;

export interface SlotReservationResult {
  allowed: boolean;
  targetSendTime?: number;
  currentCount?: number;
  rescheduleDelayMs?: number;
  nextWindowStart?: Date;
}

export class RateLimiterService {
  /**
   * Helper to format the current hour window key (UTC): YYYY-MM-DD-HH
   */
  getHourWindowKey(date = new Date()): string {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    const h = String(date.getUTCHours()).padStart(2, '0');
    return `${y}-${m}-${d}-${h}`;
  }

  /**
   * Helper to compute the start of the next hour window
   */
  getNextHourWindowStart(date = new Date()): Date {
    const next = new Date(date);
    next.setUTCHours(next.getUTCHours() + 1, 0, 0, 0);
    return next;
  }

  /**
   * Atomically reserves a send slot for a sender, enforcing both hourly quota and minimum delay.
   * Completely safe across multiple workers and instances.
   */
  async reserveSlot(
    senderId: string,
    hourlyLimit: number,
    minDelayMs: number
  ): Promise<SlotReservationResult> {
    const now = Date.now();
    const hourWindow = this.getHourWindowKey();
    const hourlyKey = `rate:sender:${senderId}:${hourWindow}`;
    const lastSentKey = `rate:sender:${senderId}:last_sent`;
    const windowTtlSeconds = 7200; // 2 hours TTL for safety

    try {
      const result = (await redis.eval(
        ATOMIC_SLOT_RESERVATION_LUA,
        2,
        hourlyKey,
        lastSentKey,
        hourlyLimit.toString(),
        minDelayMs.toString(),
        now.toString(),
        windowTtlSeconds.toString()
      )) as [number, number];

      const [status, val] = result;

      if (status === 1) {
        // Slot granted
        const targetSendTime = val;
        logger.debug(
          { senderId, targetSendTime, now },
          'Atomic send slot successfully reserved'
        );
        return {
          allowed: true,
          targetSendTime,
        };
      } else {
        // Quota exceeded
        const currentCount = val;
        const nextWindow = this.getNextHourWindowStart();
        // Add 1-5 second jitter to avoid all rescheduled jobs hitting the window start simultaneously
        const jitterMs = Math.floor(Math.random() * 4000) + 1000;
        const rescheduleDelayMs = Math.max(0, nextWindow.getTime() - now) + jitterMs;

        logger.warn(
          {
            senderId,
            currentCount,
            hourlyLimit,
            nextWindowStart: nextWindow.toISOString(),
            rescheduleDelayMs,
          },
          '⚠️ Hourly limit reached for sender. Triggering slot rescheduling...'
        );

        return {
          allowed: false,
          currentCount,
          nextWindowStart: new Date(nextWindow.getTime() + jitterMs),
          rescheduleDelayMs,
        };
      }
    } catch (err) {
      logger.error({ err, senderId }, 'Redis error during atomic slot reservation');
      throw err;
    }
  }
}

export const rateLimiterService = new RateLimiterService();
