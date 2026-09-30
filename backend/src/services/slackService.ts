import { WebClient } from '@slack/web-api';
import { prisma } from '../models/prisma';
import { env } from '../config/env';
import { encryptToken, decryptToken } from '../utils/crypto';
import { logger } from '../utils/logger';

export function getSlackRedirectUri(): string {
  // If explicitly configured in env
  const configured = env.SLACK_REDIRECT_URI;
  if (configured && configured.trim().length > 0) {
    const trimmed = configured.trim().replace(/\/+$/, '');
    if (trimmed.endsWith('/api/slack/callback')) {
      return trimmed;
    }
    try {
      const parsed = new URL(trimmed);
      if (parsed.pathname === '/' || parsed.pathname === '') {
        return `${parsed.origin}/api/slack/callback`;
      }
    } catch {
      // fallback below
    }
    return `${trimmed}/api/slack/callback`;
  }

  // Fallback to BACKEND_URL with /api/slack/callback
  const backendBase = (env.BACKEND_URL || 'http://localhost:5000').trim().replace(/\/+$/, '');
  return `${backendBase}/api/slack/callback`;
}

export class SlackService {
  getAuthorizationUrl(state: string): string {
    const scopes = ['chat:write', 'channels:read'].join(',');
    const redirectUri = getSlackRedirectUri();
    const params = new URLSearchParams({
      client_id: env.SLACK_CLIENT_ID,
      scope: scopes,
      redirect_uri: redirectUri,
      state,
    });

    return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
  }

  async handleOAuthCallback(code: string, userId: string) {
    const client = new WebClient();
    const redirectUri = getSlackRedirectUri();

    // 1. Exchange authorization code for Slack tokens
    const accessResponse = await client.oauth.v2.access({
      client_id: env.SLACK_CLIENT_ID,
      client_secret: env.SLACK_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
    });

    if (!accessResponse.ok || !accessResponse.access_token) {
      logger.error({ error: accessResponse.error }, 'Slack OAuth access exchange failed');
      throw new Error(`Slack OAuth error: ${accessResponse.error}`);
    }

    const accessToken = accessResponse.access_token;
    const teamId = (accessResponse.team as any)?.id || 'unknown';
    const teamName = (accessResponse.team as any)?.name || 'Slack Workspace';
    const botUserId = accessResponse.bot_user_id || null;
    const incomingWebhookUrl = (accessResponse as any).incoming_webhook?.url || null;
    const incomingChannel = (accessResponse as any).incoming_webhook?.channel || null;
    const incomingChannelId = (accessResponse as any).incoming_webhook?.channel_id || null;

    // 2. Encrypt token with AES-256-GCM before writing to PostgreSQL
    const { encryptedToken, tokenIv, tokenTag } = encryptToken(accessToken);

    // 3. Upsert SlackConnection in PostgreSQL
    const updateData: any = {
      teamId,
      teamName,
      encryptedToken,
      tokenIv,
      tokenTag,
      botUserId,
    };
    if (incomingChannelId) {
      updateData.channelId = incomingChannelId;
      updateData.channelName = incomingChannel;
    }

    const connection = await prisma.slackConnection.upsert({
      where: { userId },
      update: updateData,
      create: {
        userId,
        teamId,
        teamName,
        encryptedToken,
        tokenIv,
        tokenTag,
        botUserId,
        channelId: incomingChannelId,
        channelName: incomingChannel,
      },
    });

    logger.info({ userId, teamName, redirectUri }, '✅ Slack connection stored securely with AES-256 encryption');
    return connection;
  }

  async listChannels(userId: string) {
    const connection = await prisma.slackConnection.findUnique({
      where: { userId },
    });

    if (!connection) {
      throw new Error('Slack is not connected for this user');
    }

    const decryptedToken = decryptToken(
      connection.encryptedToken,
      connection.tokenIv,
      connection.tokenTag
    );

    const client = new WebClient(decryptedToken);
    let channels: any[] = [];
    try {
      const result = await client.conversations.list({
        types: 'public_channel',
        exclude_archived: true,
        limit: 100,
      });
      channels = result.channels || [];
    } catch (err: any) {
      logger.error({ err: err.message }, 'Failed to query Slack channels, returning empty channel list');
      channels = [];
    }

    return channels.map((ch) => ({
      id: ch.id,
      name: ch.name,
      isPrivate: ch.is_private || false,
    }));
  }

  async selectChannel(userId: string, channelId: string, channelName?: string) {
    const existing = await prisma.slackConnection.findUnique({
      where: { userId },
    });
    if (!existing) {
      throw new Error('Slack is not connected for this user');
    }

    return prisma.slackConnection.update({
      where: { userId },
      data: {
        channelId,
        channelName: channelName || undefined,
      },
    });
  }

  async disconnect(userId: string) {
    return prisma.slackConnection.deleteMany({
      where: { userId },
    });
  }

  async getConnectionStatus(userId: string) {
    const connection = await prisma.slackConnection.findUnique({
      where: { userId },
      select: {
        teamName: true,
        channelName: true,
        channelId: true,
        createdAt: true,
      },
    });

    return {
      connected: !!connection,
      connection: connection || null,
    };
  }

  /**
   * Dispatches rich rate-limit warning notification to the user's configured Slack channel.
   * Completely non-blocking and safe: failures are logged and never throw.
   */
  async sendRateLimitNotification({
    userId,
    senderEmail,
    hourlyLimit,
    nextWindowStart,
  }: {
    userId: string;
    senderEmail: string;
    hourlyLimit: number;
    nextWindowStart: Date;
  }): Promise<void> {
    try {
      const connection = await prisma.slackConnection.findUnique({
        where: { userId },
      });

      if (!connection || !connection.channelId) {
        logger.debug({ userId }, 'No Slack channel configured for user; skipping notification');
        return;
      }

      const decryptedToken = decryptToken(
        connection.encryptedToken,
        connection.tokenIv,
        connection.tokenTag
      );

      const client = new WebClient(decryptedToken);

      const postPayload = {
        channel: connection.channelId,
        text: `⚠️ Rate limit reached for sender ${senderEmail}!`,
        blocks: [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: '⚠️ ReachInbox Hourly Rate Limit Reached',
              emoji: true,
            },
          },
          {
            type: 'section',
            fields: [
              {
                type: 'mrkdwn',
                text: `*Sender Account:*\n\`${senderEmail}\``,
              },
              {
                type: 'mrkdwn',
                text: `*Hourly Quota:*\n${hourlyLimit} emails / hour`,
              },
              {
                type: 'mrkdwn',
                text: `*Status:*\nRescheduled to next window`,
              },
              {
                type: 'mrkdwn',
                text: `*Next Send Window:*\n${nextWindowStart.toUTCString()}`,
              },
            ],
          },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: 'All excess emails have been automatically preserved and queued in Redis for delivery in the next window.',
              },
            ],
          },
        ],
      };

      try {
        await client.chat.postMessage(postPayload);
      } catch (postErr: any) {
        const errCode = postErr?.data?.error || postErr?.message;
        if (errCode === 'not_in_channel' || String(errCode).includes('not_in_channel')) {
          try {
            await (client.conversations as any)?.join?.({ channel: connection.channelId });
            await client.chat.postMessage(postPayload);
          } catch (joinErr: any) {
            logger.warn({ joinErr: joinErr.message }, 'Could not automatically join Slack channel');
          }
        } else {
          throw postErr;
        }
      }

      logger.info(
        { userId, channelId: connection.channelId, senderEmail },
        '📢 Sent rate-limit alert to Slack channel'
      );
    } catch (err: any) {
      logger.error(
        { err: err.message, userId, senderEmail },
        'Failed to deliver Slack rate-limit alert (non-blocking)'
      );
    }
  }
}

export const slackService = new SlackService();
