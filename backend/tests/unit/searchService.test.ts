import { SearchService } from '../../src/services/searchService';
import { elasticClient } from '../../src/integrations/elasticsearch';
import { prisma } from '../../src/models/prisma';
import { JobStatus } from '@prisma/client';

jest.mock('../../src/integrations/elasticsearch', () => ({
  elasticClient: {
    search: jest.fn(),
    index: jest.fn(),
    update: jest.fn(),
  },
  EMAIL_SEARCH_INDEX: 'test_emails',
}));

jest.mock('../../src/models/prisma', () => ({
  prisma: {
    emailJob: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
  },
}));

describe('Search Service (Elasticsearch & Controlled Postgres Fallback)', () => {
  let searchService: SearchService;

  beforeEach(() => {
    searchService = new SearchService();
    jest.clearAllMocks();
  });

  it('should search using Elasticsearch when healthy', async () => {
    const mockHit = {
      _source: {
        emailJobId: 'job-es-1',
        recipientEmail: 'test@reachinbox.com',
        subject: 'Welcome to ReachInbox',
        body: 'Email body text',
        status: 'SENT',
        scheduledAt: new Date().toISOString(),
        sentAt: new Date().toISOString(),
      },
    };

    (elasticClient.search as jest.Mock).mockResolvedValue({
      hits: {
        total: { value: 1 },
        hits: [mockHit],
      },
    });

    const result = await searchService.searchEmails({
      userId: 'user-1',
      query: 'ReachInbox',
    });

    expect(result.provider).toBe('elasticsearch');
    expect(result.total).toBe(1);
    expect(result.items[0].recipientEmail).toBe('test@reachinbox.com');
    expect(prisma.emailJob.findMany).not.toHaveBeenCalled();
  });

  it('should gracefully fall back to PostgreSQL search if Elasticsearch errors', async () => {
    (elasticClient.search as jest.Mock).mockRejectedValue(
      new Error('Connection refused to Elasticsearch:9200')
    );

    (prisma.emailJob.count as jest.Mock).mockResolvedValue(1);
    (prisma.emailJob.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'job-pg-1',
        recipientEmail: 'fallback@reachinbox.com',
        subject: 'Fallback subject',
        body: 'Fallback body',
        status: JobStatus.SCHEDULED,
        scheduledAt: new Date(),
        sentAt: null,
        failureReason: null,
      },
    ]);

    const result = await searchService.searchEmails({
      userId: 'user-1',
      query: 'fallback',
    });

    expect(result.provider).toBe('postgres-fallback');
    expect(result.total).toBe(1);
    expect(result.items[0].recipientEmail).toBe('fallback@reachinbox.com');
    expect(prisma.emailJob.findMany).toHaveBeenCalled();
  });
});
