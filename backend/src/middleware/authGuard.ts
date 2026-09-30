import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';

export interface JwtUserPayload {
  id: string;
  email: string;
  name?: string;
  avatarUrl?: string;
}

export function authGuard(req: Request, res: Response, next: NextFunction) {
  let token = req.cookies?.reachinbox_token;

  if (!token && req.headers.authorization?.startsWith('Bearer ')) {
    token = req.headers.authorization.substring(7);
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication session required. Please sign in with Google.',
      },
    });
  }

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as JwtUserPayload;
    req.user = decoded;
    next();
  } catch (_err) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'INVALID_TOKEN',
        message: 'Invalid or expired session. Please sign in again.',
      },
    });
  }
}
