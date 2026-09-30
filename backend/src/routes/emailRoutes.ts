import { Router } from 'express';
import { scheduleController } from '../controllers/scheduleController';
import { emailController } from '../controllers/emailController';
import { authGuard } from '../middleware/authGuard';

export const emailRouter = Router();

// Lead parsing is utility-friendly (can be used before scheduling)
emailRouter.post('/leads/parse', scheduleController.parseLeadsFile);

// Protected scheduling & email management endpoints
emailRouter.use(authGuard);

emailRouter.post('/schedule', scheduleController.scheduleEmails);
emailRouter.get('/search', emailController.searchEmails);
emailRouter.get('/scheduled', emailController.getScheduledEmails);
emailRouter.get('/sent', emailController.getSentEmails);
emailRouter.get('/:id', emailController.getEmailById);
emailRouter.post('/clear', emailController.clearEmails);

// Sender management
emailRouter.get('/senders/list', scheduleController.listSenders);
emailRouter.post('/senders/create', scheduleController.createSender);
