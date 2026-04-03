import express from 'express';
import { signup, login, forgotPassword, phoneLookup } from '../controllers/authController.js';

const router = express.Router();

router.post('/signup', signup);
router.post('/login', login);
router.post('/forgot-password', forgotPassword);
router.post('/phone-lookup', phoneLookup);

export default router;
