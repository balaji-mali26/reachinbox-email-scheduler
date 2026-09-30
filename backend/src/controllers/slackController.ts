import { Request, Response, NextFunction } from 'express';
import { slackService } from '../services/slackService';
import { randomBytes, createHmac, timingSafeEqual } from 'crypto';
import { env } from '../config/env';

function generateSlackState(userId: string): string {
  const timestamp = Date.now().toString();
  const nonce = randomBytes(16).toString('hex');
  const payload = `${userId}.${timestamp}.${nonce}`;
  const hmac = createHmac('sha256', env.JWT_SECRET).update(payload).digest('hex');
  return `${payload}.${hmac}`;
}

function verifySlackState(stateStr?: any, storedCookieState?: string): string | null {
  if (!stateStr || typeof stateStr !== 'string') return null;

  // 1. Direct cookie match
  if (storedCookieState && stateStr === storedCookieState) {
    const parts = stateStr.split('.');
    return parts[0] || null;
  }

  // 2. Cryptographic HMAC validation (cross-domain cookie fallback)
  const parts = stateStr.split('.');
  if (parts.length !== 4) return null;
  const [userId, timestampStr, nonce, hmac] = parts;
  const timestamp = parseInt(timestampStr, 10);
  if (isNaN(timestamp)) return null;

  // 15-minute validity window
  if (Date.now() - timestamp > 15 * 60 * 1000 || Date.now() < timestamp - 60 * 1000) {
    return null;
  }

  const payload = `${userId}.${timestampStr}.${nonce}`;
  const expectedHmac = createHmac('sha256', env.JWT_SECRET).update(payload).digest('hex');
  try {
    const matches = timingSafeEqual(Buffer.from(hmac), Buffer.from(expectedHmac));
    return matches ? userId : null;
  } catch {
    return null;
  }
}

export class SlackController {
  connect(req: Request, res: Response) {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      });
    }

    const state = generateSlackState(userId);
    const isSecure = env.NODE_ENV === 'production' || env.FRONTEND_URL.startsWith('https://');

    res.cookie('slack_state', state, {
      httpOnly: true,
      secure: isSecure,
      sameSite: 'lax',
      path: '/',
      maxAge: 15 * 60 * 1000,
    });

    const redirectUrl = slackService.getAuthorizationUrl(state);
    return res.redirect(redirectUrl);
  }

  async callback(req: Request, res: Response, next: NextFunction) {
    const frontendUrl = env.FRONTEND_URL.replace(/\/+$/, '');
    const isSecure = env.NODE_ENV === 'production' || env.FRONTEND_URL.startsWith('https://');

    try {
      const { code, state, error } = req.query;

      if (error) {
        return res.redirect(`${frontendUrl}/dashboard?slack_error=${encodeURIComponent(error as string)}`);
      }

      const storedState = req.cookies?.slack_state;
      const verifiedUserId = verifySlackState(state, storedState);
      if (!verifiedUserId) {
        return res.status(403).redirect(`${frontendUrl}/dashboard?slack_error=invalid_state`);
      }

      if (!code || typeof code !== 'string') {
        return res.status(400).redirect(`${frontendUrl}/dashboard?slack_error=missing_code`);
      }

      await slackService.handleOAuthCallback(code, verifiedUserId);

      res.clearCookie('slack_state', {
        httpOnly: true,
        secure: isSecure,
        sameSite: 'lax',
        path: '/',
      });

      return res.redirect(`${frontendUrl}/dashboard?slack=connected`);
    } catch (err: any) {
      res.clearCookie('slack_state', {
        httpOnly: true,
        secure: isSecure,
        sameSite: 'lax',
        path: '/',
      });
      return res.redirect(`${frontendUrl}/dashboard?slack_error=${encodeURIComponent(err.message || 'oauth_exchange_failed')}`);
    }
  }

  async getStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
        });
      }

      const status = await slackService.getConnectionStatus(userId);
      return res.status(200).json({
        success: true,
        data: status,
      });
    } catch (err) {
      next(err);
    }
  }

  async listChannels(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
        });
      }

      const channels = await slackService.listChannels(userId);
      return res.status(200).json({
        success: true,
        data: channels,
      });
    } catch (err) {
      next(err);
    }
  }

  async selectChannel(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
        });
      }

      const { channelId, channelName } = req.body;
      if (!channelId) {
        return res.status(400).json({
          success: false,
          error: { code: 'BAD_REQUEST', message: 'channelId is required' },
        });
      }

      const updated = await slackService.selectChannel(userId, channelId, channelName);
      return res.status(200).json({
        success: true,
        data: updated,
      });
    } catch (err) {
      next(err);
    }
  }

  async disconnect(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
        });
      }

      await slackService.disconnect(userId);
      return res.status(200).json({
        success: true,
        message: 'Slack disconnected successfully',
      });
    } catch (err) {
      next(err);
    }
  }
}

export const slackController = new SlackController();
