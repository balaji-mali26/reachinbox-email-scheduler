import { Request, Response, NextFunction } from 'express';
import { googleAuthService } from '../services/googleAuthService';
import { randomBytes, createHmac, timingSafeEqual } from 'crypto';
import { env } from '../config/env';
import { prisma } from '../models/prisma';
import jwt from 'jsonwebtoken';

function generateOAuthState(): string {
  const timestamp = Date.now().toString();
  const nonce = randomBytes(16).toString('hex');
  const hmac = createHmac('sha256', env.JWT_SECRET).update(`${timestamp}:${nonce}`).digest('hex');
  return `${timestamp}.${nonce}.${hmac}`;
}

function verifyOAuthState(stateStr?: any, storedCookieState?: string): boolean {
  if (!stateStr || typeof stateStr !== 'string') return false;
  if (storedCookieState && stateStr === storedCookieState) return true;

  const parts = stateStr.split('.');
  if (parts.length !== 3) return false;
  const [timestampStr, nonce, hmac] = parts;
  const timestamp = parseInt(timestampStr, 10);
  if (isNaN(timestamp)) return false;

  // Max 15 minutes validity
  if (Date.now() - timestamp > 15 * 60 * 1000 || Date.now() < timestamp - 60 * 1000) {
    return false;
  }

  const expectedHmac = createHmac('sha256', env.JWT_SECRET).update(`${timestampStr}:${nonce}`).digest('hex');
  try {
    return timingSafeEqual(Buffer.from(hmac), Buffer.from(expectedHmac));
  } catch {
    return false;
  }
}

export class AuthController {
  async loginWithEmail(req: Request, res: Response, next: NextFunction) {
    try {
      const { email } = req.body;
      if (!email || typeof email !== 'string') {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_CREDENTIALS', message: 'Email ID is required' },
        });
      }

      const cleanEmail = email.toLowerCase().trim();
      let user = await prisma.user.findUnique({
        where: { email: cleanEmail },
      });

      if (!user) {
        const namePart = cleanEmail.split('@')[0];
        const defaultName = cleanEmail.includes('oliver')
          ? 'Oliver Brown'
          : namePart.charAt(0).toUpperCase() + namePart.slice(1);

        user = await prisma.user.create({
          data: {
            email: cleanEmail,
            name: defaultName,
            googleId: `local_${cleanEmail}`,
            avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80',
          },
        });
      }

      await prisma.sender.upsert({
        where: {
          userId_email: {
            userId: user.id,
            email: user.email,
          },
        },
        update: {},
        create: {
          userId: user.id,
          email: user.email,
          name: user.name || 'Default Sender',
          hourlyLimit: env.DEFAULT_HOURLY_LIMIT,
        },
      });

      const sessionToken = jwt.sign(
        {
          id: user.id,
          email: user.email,
          name: user.name,
          avatarUrl: user.avatarUrl,
        },
        env.JWT_SECRET,
        { expiresIn: '7d' }
      );

      const isSecure = env.NODE_ENV === 'production' || env.FRONTEND_URL.startsWith('https://');
      res.cookie('reachinbox_token', sessionToken, {
        httpOnly: true,
        secure: isSecure,
        sameSite: 'lax',
        path: '/',
        maxAge: 7 * 24 * 3600 * 1000,
      });

      return res.status(200).json({
        success: true,
        data: user,
      });
    } catch (err) {
      next(err);
    }
  }
  loginWithGoogle(_req: Request, res: Response) {
    const state = generateOAuthState();
    const isSecure = env.NODE_ENV === 'production' || env.FRONTEND_URL.startsWith('https://');

    res.cookie('oauth_state', state, {
      httpOnly: true,
      secure: isSecure,
      sameSite: 'lax',
      path: '/',
      maxAge: 15 * 60 * 1000, // 15 mins
    });

    const redirectUrl = googleAuthService.getAuthorizationUrl(state);
    return res.redirect(redirectUrl);
  }

  async googleCallback(req: Request, res: Response, next: NextFunction) {
    try {
      const { code, state, error } = req.query;
      const frontendUrl = env.FRONTEND_URL.replace(/\/+$/, '');

      if (error) {
        return res.redirect(`${frontendUrl}/login?error=${encodeURIComponent(error as string)}`);
      }

      const storedState = req.cookies?.oauth_state;
      if (!verifyOAuthState(state, storedState)) {
        return res.status(403).redirect(`${frontendUrl}/login?error=invalid_state`);
      }

      if (!code || typeof code !== 'string') {
        return res.status(400).redirect(`${frontendUrl}/login?error=missing_code`);
      }

      // Exchange code and upsert user
      const profile = await googleAuthService.exchangeCodeAndGetProfile(code);
      const { user, sessionToken } = await googleAuthService.handleGoogleUser(profile);

      const isSecure = env.NODE_ENV === 'production' || env.FRONTEND_URL.startsWith('https://');

      // Detect whether request reached backend through frontend Nginx proxy or directly
      const frontendHost = new URL(frontendUrl).host;
      const reqHost = (req.headers['x-forwarded-host'] as string) || req.hostname;
      const isFrontendOrigin = reqHost.includes(frontendHost);

      if (isFrontendOrigin) {
        // Direct callback through Nginx reverse-proxy on frontend origin
        res.cookie('reachinbox_token', sessionToken, {
          httpOnly: true,
          secure: isSecure,
          sameSite: 'lax',
          path: '/',
          maxAge: 7 * 24 * 3600 * 1000, // 7 days
        });
        res.clearCookie('oauth_state', { path: '/' });
        return res.redirect(`${frontendUrl}/dashboard`);
      } else {
        // Callback reached backend Railway origin (e.g. from Google Cloud Console redirect URI)
        // Issue secure 60s single-use ticket to bridge session cookie directly onto the frontend origin
        const exchangeTicket = jwt.sign(
          { userId: user.id, type: 'oauth_exchange' },
          env.JWT_SECRET,
          { expiresIn: '60s' }
        );
        return res.redirect(`${frontendUrl}/api/auth/exchange?ticket=${exchangeTicket}`);
      }
    } catch (err: any) {
      next(err);
    }
  }

  async exchangeTicket(req: Request, res: Response, next: NextFunction) {
    try {
      const { ticket } = req.query;
      const frontendUrl = env.FRONTEND_URL.replace(/\/+$/, '');

      if (!ticket || typeof ticket !== 'string') {
        return res.redirect(`${frontendUrl}/login?error=missing_ticket`);
      }

      let decoded: any;
      try {
        decoded = jwt.verify(ticket, env.JWT_SECRET);
      } catch (_err) {
        return res.redirect(`${frontendUrl}/login?error=invalid_ticket`);
      }

      if (decoded.type !== 'oauth_exchange' || !decoded.userId) {
        return res.redirect(`${frontendUrl}/login?error=invalid_ticket`);
      }

      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
      });

      if (!user) {
        return res.redirect(`${frontendUrl}/login?error=user_not_found`);
      }

      const sessionToken = jwt.sign(
        {
          id: user.id,
          email: user.email,
          name: user.name,
          avatarUrl: user.avatarUrl,
        },
        env.JWT_SECRET,
        { expiresIn: '7d' }
      );

      const isSecure = env.NODE_ENV === 'production' || env.FRONTEND_URL.startsWith('https://');
      res.cookie('reachinbox_token', sessionToken, {
        httpOnly: true,
        secure: isSecure,
        sameSite: 'lax',
        path: '/',
        maxAge: 7 * 24 * 3600 * 1000, // 7 days
      });
      res.clearCookie('oauth_state', { path: '/' });

      return res.redirect(`${frontendUrl}/dashboard`);
    } catch (err) {
      next(err);
    }
  }

  async getMe(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Not authenticated' },
        });
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          name: true,
          avatarUrl: true,
          createdAt: true,
          slackConnection: {
            select: {
              teamName: true,
              channelName: true,
              channelId: true,
              createdAt: true,
            },
          },
        },
      });

      if (!user) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'User not found' },
        });
      }

      return res.status(200).json({
        success: true,
        data: user,
      });
    } catch (err) {
      next(err);
    }
  }

  logout(_req: Request, res: Response) {
    const isSecure = env.NODE_ENV === 'production' || env.FRONTEND_URL.startsWith('https://');
    res.clearCookie('reachinbox_token', {
      httpOnly: true,
      secure: isSecure,
      sameSite: 'lax',
      path: '/',
    });
    return res.status(200).json({
      success: true,
      message: 'Logged out successfully',
    });
  }
}

export const authController = new AuthController();
