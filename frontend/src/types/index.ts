export interface User {
  id: string;
  email: string;
  name?: string | null;
  avatarUrl?: string | null;
  slackConnection?: {
    teamName?: string | null;
    channelName?: string | null;
    channelId?: string | null;
  } | null;
}

export interface Sender {
  id: string;
  userId: string;
  email: string;
  name: string;
  hourlyLimit: number;
}

export type JobStatus =
  | 'SCHEDULED'
  | 'PROCESSING'
  | 'SENT'
  | 'FAILED'
  | 'RATE_LIMITED_RESCHEDULED';

export interface EmailJob {
  id: string;
  batchId?: string;
  senderId: string;
  recipientEmail: string;
  subject: string;
  body: string;
  status: JobStatus;
  scheduledAt: string;
  sentAt?: string | null;
  failedAt?: string | null;
  failureReason?: string | null;
  etherealMessageId?: string | null;
  etherealPreviewUrl?: string | null;
  sender?: {
    email: string;
    name: string;
  };
}

export interface Pagination {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: {
    items: T[];
    pagination: Pagination;
  };
}

export interface SearchResultResponse {
  success: boolean;
  data: {
    items: EmailJob[];
    total: number;
    page: number;
    limit: number;
    provider: 'elasticsearch' | 'postgres-fallback';
  };
}

export interface SlackChannel {
  id: string;
  name: string;
  isPrivate: boolean;
}

export interface ParseLeadsResponse {
  validEmails: string[];
  invalidRows: Array<{
    row: number;
    raw: string;
    reason: string;
  }>;
  totalRows: number;
  validCount: number;
  duplicateCount: number;
}
