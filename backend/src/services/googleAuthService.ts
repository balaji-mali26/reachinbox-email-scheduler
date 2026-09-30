import { env } from '../config/env';
import { prisma } from '../models/prisma';
import jwt from 'jsonwebtoken';
import { logger } from '../utils/logger';

export interface GoogleProfile {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
  email_verified?: boolean;
}

export class GoogleAuthService {
  getAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: env.GOOGLE_CALLBACK_URL,
      response_type: 'code',
      scope: 'openid email profile',
      access_type: 'offline',
      prompt: 'consent',
      state,
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  async exchangeCodeAndGetProfile(code: string): Promise<GoogleProfile> {
    // 1. Exchange code for access token
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: env.GOOGLE_CALLBACK_URL,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResponse.ok) {
      const errBody = await tokenResponse.text();
      logger.error({ errBody }, 'Failed to exchange authorization code with Google');
      throw new Error('Google OAuth token exchange failed');
    }

    const tokenData = (await tokenResponse.json()) as { access_token: string };

    // 2. Fetch user profile
    const profileResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
      },
    });

    if (!profileResponse.ok) {
      throw new Error('Failed to retrieve user profile from Google');
    }

    return (await profileResponse.json()) as GoogleProfile;
  }

  async handleGoogleUser(profile: GoogleProfile) {
    // Upsert user in PostgreSQL
    const user = await prisma.user.upsert({
      where: { googleId: profile.sub },
      update: {
        name: profile.name || undefined,
        avatarUrl: profile.picture || undefined,
      },
      create: {
        googleId: profile.sub,
        email: profile.email.toLowerCase().trim(),
        name: profile.name || null,
        avatarUrl: profile.picture || null,
      },
    });

    // Ensure default sender exists for the user
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

    // Issue JWT session token
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

    return { user, sessionToken };
  }
}

export const googleAuthService = new GoogleAuthService();
