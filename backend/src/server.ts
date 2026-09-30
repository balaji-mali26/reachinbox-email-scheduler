import { app } from './app';
import { env } from './config/env';
import { logger } from './utils/logger';

import { reconciliationService } from './services/reconciliationService';
import { createEmailWorker } from './workers/emailWorker';

let embeddedEmailWorker: any = null;

const server = app.listen(env.PORT, async () => {
  logger.info(`🚀 ReachInbox API Server running in ${env.NODE_ENV} mode on port ${env.PORT}`);
  logger.info(`📡 Healthcheck available at http://localhost:${env.PORT}/health`);

  // Run single-owner reconciliation on boot and periodic sweep every 15s
  try {
    await reconciliationService.runReconciliation();
    setInterval(() => {
      reconciliationService.runReconciliation().catch((sweepErr) => {
        logger.error({ sweepErr }, 'Periodic reconciliation sweep error');
      });
    }, 15000);
  } catch (err) {
    logger.error({ err }, 'Failed to complete startup reconciliation');
  }

  // Start embedded BullMQ email worker to guarantee execution across all deployment models
  try {
    embeddedEmailWorker = createEmailWorker();
    logger.info(`⚡ BullMQ Email Worker active in server process (Concurrency: ${env.WORKER_CONCURRENCY})`);
  } catch (workerErr) {
    logger.error({ workerErr }, 'Failed to start BullMQ Email Worker in server process');
  }

  // Initialize Elasticsearch index mapping
  try {
    const { initElasticsearchIndex } = await import('./integrations/elasticsearch');
    await initElasticsearchIndex();
  } catch (err) {
    logger.warn({ err }, 'Elasticsearch index initialization warning');
  }
});

const gracefulShutdown = async (signal: string) => {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);
  if (embeddedEmailWorker) {
    try {
      await embeddedEmailWorker.close();
      logger.info('BullMQ Email Worker shut down gracefully.');
    } catch (workerCloseErr) {
      logger.error({ workerCloseErr }, 'Error closing email worker');
    }
  }
  server.close(() => {
    logger.info('HTTP server closed.');
    process.exit(0);
  });
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
