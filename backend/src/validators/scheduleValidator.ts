import { z } from 'zod';

export const scheduleEmailSchema = z.object({
  senderId: z.string().optional(),
  subject: z.string().min(1, 'Subject is required').max(500),
  body: z.string().min(1, 'Email body is required'),
  startAt: z.string().datetime({ message: 'startAt must be a valid ISO 8601 string' }),
  sendNow: z.boolean().optional(),
  minDelayMs: z.number().int().min(0).default(2000),
  hourlyLimit: z.number().int().positive().default(100),
  recipients: z
    .array(z.string().email('Invalid recipient email address'))
    .min(1, 'At least one recipient is required')
    .max(5000, 'Batch size exceeds maximum limit of 5,000 recipients'),
});

export const parseLeadsSchema = z.object({
  content: z.string().min(1, 'File content is required'),
});

export type ScheduleEmailInput = z.infer<typeof scheduleEmailSchema>;
export type ParseLeadsInput = z.infer<typeof parseLeadsSchema>;
