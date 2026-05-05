import express from 'express';
import { signup, login, forgotPassword, resetPassword, phoneLookup, verifyPassword } from '../controllers/authController.js';
import { verifyEndpoint as verifyImplementationPin } from '../controllers/implementationPinController.js';
import { protect } from '../middleware/auth.js';
import {
  loginLimiter,
  signupLimiter,
  forgotPasswordLimiter,
  resetPasswordLimiter,
  pinLimiter,
} from '../middleware/rateLimit.js';

const router = express.Router();

router.post('/signup', signupLimiter, signup);
router.post('/login', loginLimiter, login);
router.post('/forgot-password', forgotPasswordLimiter, forgotPassword);
router.post('/reset-password', resetPasswordLimiter, resetPassword);
router.post('/phone-lookup', loginLimiter, phoneLookup);
router.post('/verify-password', protect, loginLimiter, verifyPassword);

// S78 — Implementation Engineer PIN verification (cashier-app hardware unlock).
// Public — the cashier-app may have a non-eligible user signed in or no
// session at all. PIN is the auth factor. Rate-limited via pinLimiter.
router.post('/implementation-pin/verify', pinLimiter, verifyImplementationPin);

export default router;
