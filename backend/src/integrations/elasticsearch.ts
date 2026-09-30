import { Client } from '@elastic/elasticsearch';
import { env } from '../config/env';
import { logger } from '../utils/logger';

export const elasticClient = new Client({
  node: env.ELASTICSEARCH_URL,
  requestTimeout: 3000,
  maxRetries: 2,
});

export const EMAIL_SEARCH_INDEX = env.ELASTICSEARCH_INDEX || 'reachinbox_emails';

export async function initElasticsearchIndex(): Promise<boolean> {
  try {
    const ping = await elasticClient.ping();
    if (!ping) {
      logger.warn('Elasticsearch cluster not responding to ping. Fallback search mode will be active.');
      return false;
    }

    const indexExists = await elasticClient.indices.exists({
      index: EMAIL_SEARCH_INDEX,
    });

    if (!indexExists) {
      logger.info({ index: EMAIL_SEARCH_INDEX }, 'Creating Elasticsearch index with schema mapping...');
      await elasticClient.indices.create({
        index: EMAIL_SEARCH_INDEX,
        mappings: {
          properties: {
            emailJobId: { type: 'keyword' },
            batchId: { type: 'keyword' },
            userId: { type: 'keyword' },
            senderId: { type: 'keyword' },
            recipientEmail: {
              type: 'text',
              fields: {
                keyword: { type: 'keyword' },
              },
            },
            subject: { type: 'text' },
            body: { type: 'text' },
            status: { type: 'keyword' },
            scheduledAt: { type: 'date' },
            sentAt: { type: 'date' },
            failureReason: { type: 'text' },
          },
        },
      });
      logger.info('✅ Elasticsearch index initialized');
    }

    return true;
  } catch (err: any) {
    logger.warn({ err: err.message }, 'Elasticsearch unavailable at startup. Search will use PostgreSQL fallback.');
    return false;
  }
}
