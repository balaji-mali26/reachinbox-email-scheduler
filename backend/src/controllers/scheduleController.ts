import { Request, Response, NextFunction } from 'express';
import { scheduleService } from '../services/scheduleService';
import {
  scheduleEmailSchema,
  parseLeadsSchema,
} from '../validators/scheduleValidator';
import { parseLeads } from '../utils/csvParser';
import { prisma } from '../models/prisma';

export class ScheduleController {
  async scheduleEmails(req: Request, res: Response, next: NextFunction) {
    try {
      const validatedInput = scheduleEmailSchema.parse(req.body);
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
        });
      }

      const result = await scheduleService.scheduleCampaign(userId, validatedInput);

      return res.status(201).json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  async parseLeadsFile(req: Request, res: Response, next: NextFunction) {
    try {
      const { content } = parseLeadsSchema.parse(req.body);
      const parsed = parseLeads(content);

      return res.status(200).json({
        success: true,
        data: parsed,
      });
    } catch (err) {
      next(err);
    }
  }

  async listSenders(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
        });
      }

      let senders = await prisma.sender.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      });

      if (senders.length === 0) {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (user) {
          const defaultSender = await prisma.sender.create({
            data: {
              userId: user.id,
              email: user.email,
              name: user.name || 'Default Sender',
              hourlyLimit: 100,
            },
          });
          senders = [defaultSender];
        }
      }

      return res.status(200).json({
        success: true,
        data: senders,
      });
    } catch (err) {
      next(err);
    }
  }

  async createSender(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
        });
      }

      const { email, name, hourlyLimit } = req.body;
      if (!email || !name) {
        return res.status(400).json({
          success: false,
          error: { code: 'BAD_REQUEST', message: 'Email and name are required' },
        });
      }

      const sender = await prisma.sender.upsert({
        where: {
          userId_email: {
            userId,
            email: email.toLowerCase().trim(),
          },
        },
        update: {
          name,
          hourlyLimit: hourlyLimit ? parseInt(hourlyLimit, 10) : 100,
        },
        create: {
          userId,
          email: email.toLowerCase().trim(),
          name,
          hourlyLimit: hourlyLimit ? parseInt(hourlyLimit, 10) : 100,
        },
      });

      return res.status(201).json({
        success: true,
        data: sender,
      });
    } catch (err) {
      next(err);
    }
  }
}

export const scheduleController = new ScheduleController();
