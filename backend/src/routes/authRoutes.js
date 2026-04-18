import express from 'express';
import { signup, login, forgotPassword, resetPassword, phoneLookup, verifyPassword } from '../controllers/authController.js';
import { protect } from '../middleware/auth.js';
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
router.post('/verify-password', protect, loginLimiter, verifyPassword);

export default router;
