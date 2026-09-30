import { elasticClient, EMAIL_SEARCH_INDEX } from '../integrations/elasticsearch';
import { prisma } from '../models/prisma';
import { JobStatus } from '@prisma/client';
import { logger } from '../utils/logger';

export interface EmailDocument {
  emailJobId: string;
  batchId?: string;
  userId: string;
  senderId: string;
  recipientEmail: string;
  subject: string;
  body: string;
  status: string;
  scheduledAt: string;
  sentAt?: string | null;
  failureReason?: string | null;
}

export interface SearchEmailsParams {
  userId: string;
  query: string;
  status?: string;
  page?: number;
  limit?: number;
}

export interface SearchResultItem {
  id: string;
  recipientEmail: string;
  subject: string;
  body: string;
  status: string;
  scheduledAt: Date;
  sentAt?: Date | null;
  failureReason?: string | null;
}

export interface SearchResponse {
  items: SearchResultItem[];
  total: number;
  page: number;
  limit: number;
  provider: 'elasticsearch' | 'postgres-fallback';
}

export class SearchService {
  /**
   * Indexes or updates an email record in Elasticsearch.
  /**
   * Bulk indexes email records into Elasticsearch in a single HTTP request.
   * Completely isolated: failures never crash or reject the primary email job.
   */
  async indexEmailsBulk(docs: EmailDocument[]): Promise<void> {
    if (!docs.length) return;
    try {
      const operations = docs.flatMap((doc) => [
        { index: { _index: EMAIL_SEARCH_INDEX, _id: doc.emailJobId } },
        doc,
      ]);
      await elasticClient.bulk({ operations });
      logger.debug({ count: docs.length }, 'Bulk indexed emails into Elasticsearch');
    } catch (err: any) {
      logger.warn(
        { count: docs.length, err: err.message },
        'Elasticsearch bulk indexing failed; primary PostgreSQL records remain intact'
      );
    }
  }

  /**
   * Indexes or updates an email record in Elasticsearch.
   * Completely isolated: failures never crash or reject the primary email job.
   */
  async indexEmail(doc: EmailDocument): Promise<void> {
    try {
      await elasticClient.index({
        index: EMAIL_SEARCH_INDEX,
        id: doc.emailJobId,
        document: doc,
      });
      logger.debug({ emailJobId: doc.emailJobId }, 'Indexed email into Elasticsearch');
    } catch (err: any) {
      logger.warn(
        { emailJobId: doc.emailJobId, err: err.message },
        'Elasticsearch indexing failed; primary PostgreSQL record remains intact'
      );
    }
  }

  /**
   * Updates status fields of an existing indexed email.
   */
  async updateEmailStatus(
    emailJobId: string,
    status: JobStatus,
    extra?: { sentAt?: Date | null; failureReason?: string | null; scheduledAt?: Date }
  ): Promise<void> {
    try {
      const doc: Record<string, any> = { status };
      if (extra?.sentAt) doc.sentAt = extra.sentAt.toISOString();
      if (extra?.failureReason) doc.failureReason = extra.failureReason;
      if (extra?.scheduledAt) doc.scheduledAt = extra.scheduledAt.toISOString();

      await elasticClient.update({
        index: EMAIL_SEARCH_INDEX,
        id: emailJobId,
        doc,
      });
    } catch (err: any) {
      logger.warn(
        { emailJobId, err: err.message },
        'Elasticsearch status update failed (non-blocking)'
      );
    }
  }

  /**
   * Searches emails by keyword matching recipientEmail, subject, or body.
   * Executes via Elasticsearch, with controlled PostgreSQL fallback on outage.
   */
  async searchEmails({
    userId,
    query,
    status,
    page = 1,
    limit = 20,
  }: SearchEmailsParams): Promise<SearchResponse> {
    const from = (page - 1) * limit;

    // Try Elasticsearch primary search
    try {
      const mustClauses: any[] = [{ term: { userId } }];

      if (status) {
        mustClauses.push({ term: { status } });
      }

      if (query && query.trim().length > 0) {
        mustClauses.push({
          multi_match: {
            query: query.trim(),
            fields: ['recipientEmail^3', 'subject^2', 'body'],
            fuzziness: 'AUTO',
          },
        });
      }

      const response = await elasticClient.search({
        index: EMAIL_SEARCH_INDEX,
        from,
        size: limit,
        query: {
          bool: {
            must: mustClauses,
          },
        },
        sort: [{ scheduledAt: { order: 'desc' } }],
      });

      const hits = response.hits.hits;
      const totalHits =
        typeof response.hits.total === 'number'
          ? response.hits.total
          : response.hits.total?.value || 0;

      const items: SearchResultItem[] = hits.map((hit: any) => ({
        id: hit._source.emailJobId,
        recipientEmail: hit._source.recipientEmail,
        subject: hit._source.subject,
        body: hit._source.body,
        status: hit._source.status,
        scheduledAt: new Date(hit._source.scheduledAt),
        sentAt: hit._source.sentAt ? new Date(hit._source.sentAt) : null,
        failureReason: hit._source.failureReason || null,
      }));

      return {
        items,
        total: totalHits,
        page,
        limit,
        provider: 'elasticsearch',
      };
    } catch (err: any) {
      logger.warn(
        { err: err.message },
        'Elasticsearch query failed. Executing controlled PostgreSQL fallback search...'
      );

      // Controlled PostgreSQL fallback
      const whereClause: any = {
        batch: { userId },
      };

      if (status && Object.values(JobStatus).includes(status as JobStatus)) {
        whereClause.status = status as JobStatus;
      }

      if (query && query.trim().length > 0) {
        whereClause.OR = [
          { recipientEmail: { contains: query.trim(), mode: 'insensitive' } },
          { subject: { contains: query.trim(), mode: 'insensitive' } },
          { body: { contains: query.trim(), mode: 'insensitive' } },
        ];
      }

      const [total, dbJobs] = await Promise.all([
        prisma.emailJob.count({ where: whereClause }),
        prisma.emailJob.findMany({
          where: whereClause,
          orderBy: { scheduledAt: 'desc' },
          skip: from,
          take: limit,
        }),
      ]);

      return {
        items: dbJobs.map((j) => ({
          id: j.id,
          recipientEmail: j.recipientEmail,
          subject: j.subject,
          body: j.body,
          status: j.status,
          scheduledAt: j.scheduledAt,
          sentAt: j.sentAt,
          failureReason: j.failureReason,
        })),
        total,
        page,
        limit,
        provider: 'postgres-fallback',
      };
    }
  }
}

export const searchService = new SearchService();
