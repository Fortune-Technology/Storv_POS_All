import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import { scopeToTenant } from '../middleware/scopeToTenant.js';
import { getChannels, getMessages, sendMessage, markRead, getUnreadCount, getChatUsers } from '../controllers/chatController.js';

const router = Router();
router.use(protect);
router.use(scopeToTenant);

router.get('/channels',  getChannels);
router.get('/messages',  getMessages);
router.post('/messages', sendMessage);
router.post('/read',     markRead);
router.get('/unread',    getUnreadCount);
router.get('/users',     getChatUsers);

export default router;
