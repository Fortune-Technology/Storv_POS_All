import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import { scopeToTenant } from '../middleware/scopeToTenant.js';
import {
  getChannels, getMessages, sendMessage, markRead, getUnreadCount, getChatUsers,
  getPartnerChannels, getPartnerMessages, sendPartnerMessage, markPartnerRead,
} from '../controllers/chatController.js';

const router = Router();
router.use(protect);
router.use(scopeToTenant);

router.get('/channels',  getChannels);
router.get('/messages',  getMessages);
router.post('/messages', sendMessage);
router.post('/read',     markRead);
router.get('/unread',    getUnreadCount);
router.get('/users',     getChatUsers);

// Partner (cross-org) chat
router.get ('/partner/channels', getPartnerChannels);
router.get ('/partner/messages', getPartnerMessages);
router.post('/partner/messages', sendPartnerMessage);
router.post('/partner/read',     markPartnerRead);

export default router;
