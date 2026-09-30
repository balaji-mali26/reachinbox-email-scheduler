import { Router } from 'express';
import { authController } from '../controllers/authController';
import { authGuard } from '../middleware/authGuard';

export const authRouter = Router();

authRouter.get('/google', (req, res) => authController.loginWithGoogle(req, res));
authRouter.get('/google/callback', (req, res, next) => authController.googleCallback(req, res, next));
authRouter.get('/exchange', (req, res, next) => authController.exchangeTicket(req, res, next));
authRouter.post('/login', (req, res, next) => authController.loginWithEmail(req, res, next));

// Protected auth endpoints
authRouter.get('/me', authGuard, (req, res, next) => authController.getMe(req, res, next));
authRouter.post('/logout', authGuard, (req, res) => authController.logout(req, res));
