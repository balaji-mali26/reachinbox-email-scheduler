import { Router } from 'express';
import { slackController } from '../controllers/slackController';
import { authGuard } from '../middleware/authGuard';

export const slackRouter = Router();

// Callback is invoked by Slack redirect (carries state param for validation)
slackRouter.get('/callback', slackController.callback);

// Protected Slack actions
slackRouter.get('/connect', authGuard, slackController.connect);
slackRouter.get('/status', authGuard, slackController.getStatus);
slackRouter.get('/channels', authGuard, slackController.listChannels);
slackRouter.post('/select-channel', authGuard, slackController.selectChannel);
slackRouter.post('/disconnect', authGuard, slackController.disconnect);
