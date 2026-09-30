import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';

// Load .env from root or current directory
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config(); // fallback to local .env

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform((val) => parseInt(val, 10)).default('5000'),
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),
  BACKEND_URL: z.string().url().default('http://localhost:5000'),

  // Persistence
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  // Security
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  SLACK_ENCRYPTION_KEY: z.string().min(32, 'SLACK_ENCRYPTION_KEY must be at least 32 characters for AES-256'),

  // Google OAuth (Strictly required in production and standard runtime; no fake auth fallback)
  GOOGLE_CLIENT_ID: z.string().min(1, 'GOOGLE_CLIENT_ID is required for real Google OAuth'),
  GOOGLE_CLIENT_SECRET: z.string().min(1, 'GOOGLE_CLIENT_SECRET is required for real Google OAuth'),
  GOOGLE_CALLBACK_URL: z.string().url().default('http://localhost:5000/api/auth/google/callback'),

  // Slack OAuth
  SLACK_CLIENT_ID: z.string().optional().default(''),
  SLACK_CLIENT_SECRET: z.string().optional().default(''),
  SLACK_REDIRECT_URI: z
    .string()
    .optional()
    .default(() => {
      const backendBase = (process.env.BACKEND_URL || 'http://localhost:5000').trim().replace(/\/+$/, '');
      return `${backendBase}/api/slack/callback`;
    })
    .transform((val) => {
      const trimmed = (val || '').trim().replace(/\/+$/, '');
      if (!trimmed) {
        const backendBase = (process.env.BACKEND_URL || 'http://localhost:5000').trim().replace(/\/+$/, '');
        return `${backendBase}/api/slack/callback`;
      }
      if (trimmed.endsWith('/api/slack/callback')) {
        return trimmed;
      }
      try {
        const u = new URL(trimmed);
        if (u.pathname === '/' || u.pathname === '') {
          return `${u.origin}/api/slack/callback`;
        }
      } catch {
        // fallback
      }
      return `${trimmed}/api/slack/callback`;
    }),

  // Ethereal SMTP
  ETHEREAL_USER: z.string().optional().default(''),
  ETHEREAL_PASS: z.string().optional().default(''),
  ETHEREAL_HOST: z.string().default('smtp.ethereal.email'),
  ETHEREAL_PORT: z.string().transform((val) => parseInt(val, 10)).default('587'),
  ETHEREAL_FROM: z.string().default('ReachInbox Scheduler <scheduler@reachinbox.test>'),

  // Elasticsearch
  ELASTICSEARCH_URL: z.string().url().default('http://localhost:9200'),
  ELASTICSEARCH_INDEX: z.string().default('reachinbox_emails'),

  // Worker & Rate Limiting Defaults
  WORKER_CONCURRENCY: z.string().transform((val) => parseInt(val, 10)).default('5'),
  DEFAULT_MIN_DELAY_MS: z.string().transform((val) => parseInt(val, 10)).default('2000'),
  DEFAULT_HOURLY_LIMIT: z.string().transform((val) => parseInt(val, 10)).default('100'),
  PROCESSING_LEASE_MINUTES: z.string().transform((val) => parseInt(val, 10)).default('5'),
});

export type EnvConfig = z.infer<typeof envSchema>;

let parsedEnv: EnvConfig;

try {
  parsedEnv = envSchema.parse(process.env);
} catch (error) {
  if (error instanceof z.ZodError) {
    const formattedErrors = error.errors.map(
      (err) => `  - ${err.path.join('.')}: ${err.message}`
    );
    console.error('❌ FATAL: Environment validation failed:\n' + formattedErrors.join('\n'));
    console.error('\nPlease copy .env.example to .env and configure all required variables.\n');
  } else {
    console.error('❌ Unknown error during environment validation:', error);
  }
  process.exit(1);
}

export const env = parsedEnv;
