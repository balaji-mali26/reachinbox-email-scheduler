import { googleAuthService } from '../../src/services/googleAuthService';
import { slackService } from '../../src/services/slackService';
import { prisma } from '../../src/models/prisma';
import { encryptToken } from '../../src/utils/crypto';

jest.mock('../../src/models/prisma', () => ({
  prisma: {
    slackConnection: {
      findUnique: jest.fn(),
    },
  },
}));

import { WebClient } from '@slack/web-api';

jest.mock('@slack/web-api');

const mockPostMessage = jest.fn().mockResolvedValue({ ok: true });
(WebClient.prototype as any).chat = {
  postMessage: mockPostMessage,
};
(WebClient.prototype as any).conversations = {
  list: jest.fn().mockResolvedValue({ channels: [] }),
};

describe('Google & Slack OAuth Services', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Google Auth URL Generation', () => {
    it('should generate a valid Google OAuth authorization URL with state', () => {
      const state = 'test_state_123';
      const url = googleAuthService.getAuthorizationUrl(state);

      expect(url).toContain('https://accounts.google.com/o/oauth2/v2/auth');
      expect(url).toContain('state=test_state_123');
      expect(url).toContain('response_type=code');
      expect(url).toContain('scope=openid+email+profile');
    });
  });

  describe('Slack OAuth & Rate-Limit Alerts', () => {
    it('should generate a valid Slack OAuth URL with required scopes', () => {
      const state = 'slack_state_456';
      const url = slackService.getAuthorizationUrl(state);

      expect(url).toContain('https://slack.com/oauth/v2/authorize');
      expect(url).toContain('state=slack_state_456');
      expect(url).toContain('scope=chat%3Awrite%2Cchannels%3Aread');
    });

    it('should dispatch rate-limit alert message to configured Slack channel', async () => {
      const fakeToken = 'mock-slack-test-token-val-98765';
      const encrypted = encryptToken(fakeToken);

      (prisma.slackConnection.findUnique as jest.Mock).mockResolvedValue({
        id: 'conn-1',
        userId: 'user-1',
        channelId: 'C12345678',
        encryptedToken: encrypted.encryptedToken,
        tokenIv: encrypted.tokenIv,
        tokenTag: encrypted.tokenTag,
      });

      await slackService.sendRateLimitNotification({
        userId: 'user-1',
        senderEmail: 'marketing@outbox.test',
        hourlyLimit: 100,
        nextWindowStart: new Date('2026-10-01T15:00:00Z'),
      });

      expect(mockPostMessage).toHaveBeenCalledTimes(1);
      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'C12345678',
          text: expect.stringContaining('marketing@outbox.test'),
        })
      );
    });

    it('should not throw if user has no Slack connection or channel', async () => {
      (prisma.slackConnection.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        slackService.sendRateLimitNotification({
          userId: 'user-without-slack',
          senderEmail: 'test@outbox.test',
          hourlyLimit: 50,
          nextWindowStart: new Date(),
        })
      ).resolves.not.toThrow();

      expect(mockPostMessage).not.toHaveBeenCalled();
    });
  });
});
