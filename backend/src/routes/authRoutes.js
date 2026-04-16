import express from 'express';
import { signup, login, forgotPassword, resetPassword, phoneLookup } from '../controllers/authController.js';
import {
  loginLimiter,
  signupLimiter,
  forgotPasswordLimiter,
  resetPasswordLimiter,
} from '../middleware/rateLimit.js';

const router = express.Router();

router.post('/signup', signupLimiter, signup);
router.post('/login', loginLimiter, login);
router.post('/forgot-password', forgotPasswordLimiter, forgotPassword);
router.post('/reset-password', resetPasswordLimiter, resetPassword);
router.post('/phone-lookup', loginLimiter, phoneLookup);

export default router;
