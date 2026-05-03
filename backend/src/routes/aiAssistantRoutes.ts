/**
 * aiAssistantRoutes.js — /api/ai-assistant
 *
 * Two tiers:
 *   - `useGuard`    — `ai_assistant.view` — anyone who can chat with the bot
 *   - `manageGuard` — `ai_assistant.manage` — admin review queue + KB curation
 */

import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import { requirePermission } from '../rbac/permissionService.js';
import {
  listConversations,
  getConversation,
  createConversation,
  sendMessage,
  submitFeedback,
  deleteConversation,
  escalateConversation,
  listReviews,
  promoteReview,
  dismissReview,
  getReviewConversation,
  listKbArticles,
  getKbArticle,
  createKbArticle,
  updateKbArticle,
  deleteKbArticle,
  listPublicTours,
  getTourBySlug,
  listTours,
  getTour,
  createTour,
  updateTour,
  deleteTour,
} from '../controllers/aiAssistantController.js';

const router = Router();

// Note: `requireTenant` is intentionally NOT used here. Superadmins may chat
// with the assistant cross-tenant (no org context); tools that need an org
// return a friendly error which Claude relays to the user. Non-superadmins
// always have an org from scopeToTenant, so they're unaffected.
const useGuard    = [protect, requirePermission('ai_assistant.view')];
const manageGuard = [protect, requirePermission('ai_assistant.manage')];

// ── User-facing chat endpoints ────────────────────────────────────────────
router.get('/conversations',                 ...useGuard, listConversations);
router.post('/conversations',                ...useGuard, createConversation);
router.get('/conversations/:id',             ...useGuard, getConversation);
router.delete('/conversations/:id',          ...useGuard, deleteConversation);
router.post('/conversations/:id/messages',   ...useGuard, sendMessage);
router.post('/conversations/:id/escalate',   ...useGuard, escalateConversation);

router.post('/messages/:id/feedback',        ...useGuard, submitFeedback);

// ── Admin review queue (ai_assistant.manage) ──────────────────────────────
router.get('/admin/reviews',                 ...manageGuard, listReviews);
router.get('/admin/reviews/:id/conversation', ...manageGuard, getReviewConversation);
router.post('/admin/reviews/:id/promote',    ...manageGuard, promoteReview);
router.post('/admin/reviews/:id/dismiss',    ...manageGuard, dismissReview);

// ── Product tours ────────────────────────────────────────────────────────
// Public read by slug (any chat user) — the TourRunner fetches the full tour
// when the user clicks the "Start guided tour" button on an AI response.
router.get('/tours',                     ...useGuard,    listPublicTours);
router.get('/tours/:slug',               ...useGuard,    getTourBySlug);

// Admin CRUD
router.get('/admin/tours',               ...manageGuard, listTours);
router.post('/admin/tours',              ...manageGuard, createTour);
router.get('/admin/tours/:id',           ...manageGuard, getTour);
router.put('/admin/tours/:id',           ...manageGuard, updateTour);
router.delete('/admin/tours/:id',        ...manageGuard, deleteTour);

// ── KB article management (ai_assistant.manage) ──────────────────────────
router.get('/admin/articles',            ...manageGuard, listKbArticles);
router.post('/admin/articles',           ...manageGuard, createKbArticle);
router.get('/admin/articles/:id',        ...manageGuard, getKbArticle);
router.put('/admin/articles/:id',        ...manageGuard, updateKbArticle);
router.delete('/admin/articles/:id',     ...manageGuard, deleteKbArticle);

export default router;
