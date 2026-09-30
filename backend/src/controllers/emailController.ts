import { Request, Response, NextFunction } from 'express';
import { prisma } from '../models/prisma';
import { JobStatus } from '@prisma/client';

export class EmailController {
  async getScheduledEmails(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
        });
      }

      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
      const skip = (page - 1) * limit;

      const [total, items] = await Promise.all([
        prisma.emailJob.count({
          where: {
            batch: { userId },
            status: {
              in: [JobStatus.SCHEDULED, JobStatus.RATE_LIMITED_RESCHEDULED, JobStatus.PROCESSING],
            },
          },
        }),
        prisma.emailJob.findMany({
          where: {
            batch: { userId },
            status: {
              in: [JobStatus.SCHEDULED, JobStatus.RATE_LIMITED_RESCHEDULED, JobStatus.PROCESSING],
            },
          },
          include: {
            sender: { select: { email: true, name: true } },
          },
          orderBy: { scheduledAt: 'asc' },
          skip,
          take: limit,
        }),
      ]);

      return res.status(200).json({
        success: true,
        data: {
          items,
          pagination: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
          },
        },
      });
    } catch (err) {
      next(err);
    }
  }

  async getSentEmails(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
        });
      }

      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
      const skip = (page - 1) * limit;

      const [total, items] = await Promise.all([
        prisma.emailJob.count({
          where: {
            batch: { userId },
            status: JobStatus.SENT,
          },
        }),
        prisma.emailJob.findMany({
          where: {
            batch: { userId },
            status: JobStatus.SENT,
          },
          include: {
            sender: { select: { email: true, name: true } },
          },
          orderBy: { sentAt: 'desc' },
          skip,
          take: limit,
        }),
      ]);

      return res.status(200).json({
        success: true,
        data: {
          items,
          pagination: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
          },
        },
      });
    } catch (err) {
      next(err);
    }
  }

  async getEmailById(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.id;
      const { id } = req.params;

      const email = await prisma.emailJob.findFirst({
        where: {
          id,
          batch: { userId },
        },
        include: {
          sender: true,
          batch: true,
        },
      });

      if (!email) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Email job not found' },
        });
      }

      return res.status(200).json({
        success: true,
        data: email,
      });
    } catch (err) {
      next(err);
    }
  }

  async searchEmails(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
        });
      }

      const query = (req.query.q as string) || '';
      const status = req.query.status as string | undefined;
      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 20));

      const { searchService } = await import('../services/searchService');
      const results = await searchService.searchEmails({
        userId,
        query,
        status,
        page,
        limit,
      });

      res.setHeader('X-Search-Provider', results.provider);

      return res.status(200).json({
        success: true,
        data: results,
      });
    } catch (err) {
      next(err);
    }
  }

  async clearEmails(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
        });
      }

      // Delete all email jobs and batches for this user
      const deleteJobs = await prisma.emailJob.deleteMany({
        where: {
          batch: { userId },
        },
      });

      const deleteBatches = await prisma.emailBatch.deleteMany({
        where: { userId },
      });

      await prisma.rateLimitAudit.deleteMany({});

      // Clean BullMQ queue so pending or delayed demo jobs are removed
      try {
        const { emailQueue } = await import('../queues/emailQueue');
        await emailQueue.drain();
        await emailQueue.clean(0, 1000, 'completed');
        await emailQueue.clean(0, 1000, 'failed');
        await emailQueue.clean(0, 1000, 'delayed');
        await emailQueue.clean(0, 1000, 'wait');
        await emailQueue.clean(0, 1000, 'active');
      } catch (_queueErr) {
        // queue clean best effort
      }

      return res.status(200).json({
        success: true,
        message: 'Demo email data cleared successfully',
        deletedJobs: deleteJobs.count,
        deletedBatches: deleteBatches.count,
      });
    } catch (err) {
      next(err);
    }
  }
}

export const emailController = new EmailController();
