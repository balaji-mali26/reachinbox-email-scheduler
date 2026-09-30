import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'crypto';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';

import { env } from './config/env';
import { logger } from './utils/logger';
import { emailQueue } from './queues/emailQueue';
import { authGuard } from './middleware/authGuard';
import { authRouter } from './routes/authRoutes';
import { slackRouter } from './routes/slackRoutes';
import { emailRouter } from './routes/emailRoutes';

export const app = express();

// Trust Railway edge proxy for HTTPS header detection
app.set('trust proxy', 1);

// Request correlation ID
app.use((req: Request, res: Response, next: NextFunction) => {
  const reqId = (req.headers['x-request-id'] as string) || randomUUID();
  res.setHeader('X-Request-Id', reqId);
  req.id = reqId;
  next();
});

// Security & Parsing
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  })
);
const cleanFrontendUrl = env.FRONTEND_URL.replace(/\/+$/, '');
const allowedOrigins = [
  cleanFrontendUrl,
  'http://localhost:5173',
  'http://localhost:3000',
];

app.use(
  cors({
    origin: (requestOrigin, callback) => {
      if (!requestOrigin) return callback(null, true);
      const cleanOrigin = requestOrigin.replace(/\/+$/, '');
      if (
        allowedOrigins.includes(cleanOrigin) ||
        cleanOrigin === cleanFrontendUrl ||
        (env.NODE_ENV !== 'production' && /^http:\/\/localhost(:\d+)?$/.test(cleanOrigin))
      ) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
  })
);
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Liveness & Readiness checks
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.get('/ready', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ready', timestamp: new Date().toISOString() });
});

app.get('/ready/smtp', async (_req: Request, res: Response) => {
  const net = await import('net');
  const checkPort = (host: string, port: number, timeoutMs = 4000): Promise<{ port: number; reachable: boolean; error?: string }> => {
    return new Promise((resolve) => {
      const socket = net.createConnection({ host, port, timeout: timeoutMs }, () => {
        socket.end();
        resolve({ port, reachable: true });
      });
      socket.on('timeout', () => {
        socket.destroy();
        resolve({ port, reachable: false, error: 'TIMEOUT' });
      });
      socket.on('error', (err) => {
        resolve({ port, reachable: false, error: err.message });
      });
    });
  };

  const results = await Promise.all([
    checkPort('smtp.ethereal.email', 587),
    checkPort('smtp.ethereal.email', 2525),
    checkPort('smtp.ethereal.email', 465),
    checkPort('smtp.ethereal.email', 25),
  ]);

  res.status(200).json({ host: 'smtp.ethereal.email', results });
});

// Configure Bull-Board live monitoring dashboard
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');

createBullBoard({
  queues: [new BullMQAdapter(emailQueue) as any],
  serverAdapter,
});

// Mount API routes
app.use('/api/auth', authRouter);
app.use('/api/slack', slackRouter);
app.use('/api/emails', emailRouter);

// Mount live BullMQ dashboard behind authGuard
app.use('/admin/queues', authGuard, serverAdapter.getRouter());

// Centralized error handler
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  logger.error(
    {
      err,
      requestId: req.id,
      url: req.originalUrl,
      method: req.method,
    },
    'Unhandled HTTP Error'
  );

  const statusCode = (err as any).statusCode || 500;
  res.status(statusCode).json({
    success: false,
    error: {
      code: (err as any).code || 'INTERNAL_SERVER_ERROR',
      message:
        env.NODE_ENV === 'production' && statusCode === 500
          ? 'Internal Server Error'
          : err.message,
    },
  });
});
