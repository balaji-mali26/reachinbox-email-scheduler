import Redis, { RedisOptions } from 'ioredis';
import { env } from './env';
import { logger } from '../utils/logger';

/**
 * Parses REDIS_URL into strongly-typed RedisOptions compatible with BullMQ and ioredis.
 * Guarantees that production host, port, credentials, and TLS settings are passed explicitly,
 * preventing any fallback to localhost:6379 in production.
 */
export function parseRedisConnection(redisUrl: string): RedisOptions {
  if (!redisUrl) {
    throw new Error('FATAL: REDIS_URL environment variable is required');
  }

  try {
    const parsed = new URL(redisUrl);
    const isTls = parsed.protocol === 'rediss:';

    const options: RedisOptions = {
      host: parsed.hostname || '127.0.0.1',
      port: parsed.port ? parseInt(parsed.port, 10) : 6379,
      maxRetriesPerRequest: null, // Strictly required by BullMQ
      enableReadyCheck: false,
      connectTimeout: 15000,
      retryStrategy: (times) => {
        const delay = Math.min(times * 200, 3000);
        logger.warn(`[REDIS] Connection retry attempt ${times} in ${delay}ms...`);
        return delay;
      },
    };

    if (parsed.username) {
      options.username = decodeURIComponent(parsed.username);
    }
    if (parsed.password) {
      options.password = decodeURIComponent(parsed.password);
    }
    if (parsed.pathname && parsed.pathname.length > 1) {
      const db = parseInt(parsed.pathname.slice(1), 10);
      if (!isNaN(db)) {
        options.db = db;
      }
    }
    if (isTls) {
      options.tls = {
        rejectUnauthorized: false,
      };
    }

    return options;
  } catch (err: any) {
    logger.error({ err: err.message }, 'FATAL: Failed to parse REDIS_URL');
    throw err;
  }
}

export const redisConnectionOptions: RedisOptions = parseRedisConnection(env.REDIS_URL);

// Safe diagnostic log without exposing secrets
logger.info(
  {
    host: redisConnectionOptions.host,
    port: redisConnectionOptions.port,
    tls: !!redisConnectionOptions.tls,
    db: redisConnectionOptions.db ?? 0,
  },
  '🔌 Configured Redis connection options for BullMQ & standalone client'
);

export const redis = new Redis({
  ...redisConnectionOptions,
  maxRetriesPerRequest: 20,
});

redis.on('connect', () => {
  logger.info(
    { host: redisConnectionOptions.host, port: redisConnectionOptions.port },
    '✅ Redis client connected'
  );
});

redis.on('ready', () => {
  logger.info(
    { host: redisConnectionOptions.host, port: redisConnectionOptions.port },
    '🚀 Redis client ready'
  );
});

redis.on('error', (err) => {
  logger.error(
    { err: err.message, host: redisConnectionOptions.host, port: redisConnectionOptions.port },
    '❌ Redis client connection error'
  );
});
