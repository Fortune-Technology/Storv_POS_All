/**
 * Barrel — re-exports every public handler from the aiAssistant controller
 * sub-modules so route files can keep importing from the original
 * `controllers/aiAssistantController.ts` shim path. Maintains backward
 * compatibility for every existing import. (S80 — refactor pass D, S53 pattern.)
 *
 * Module layout:
 *   helpers.ts        → small shared utilities (truncateTitle)
 *   tools.ts          → TOOL_DEFINITIONS + execTool + 14 tool implementations
 *   runner.ts         → runToolLoop + buildSystemPrompt + Anthropic client
 *   conversations.ts  → 5 chat CRUD handlers + sendMessage + escalateConversation
 *   feedback.ts       → submitFeedback (user) + 4 admin review handlers
 *   kb.ts             → 5 KB article CRUD handlers
 *   tours.ts          → 2 public tour reads + 5 admin tour CRUD handlers
 */

export {
  listConversations,
  getConversation,
  createConversation,
  sendMessage,
  deleteConversation,
  escalateConversation,
} from './conversations.js';

export {
  submitFeedback,
  listReviews,
  promoteReview,
  dismissReview,
  getReviewConversation,
} from './feedback.js';

export {
  listKbArticles,
  getKbArticle,
  createKbArticle,
  updateKbArticle,
  deleteKbArticle,
} from './kb.js';

export {
  listPublicTours,
  getTourBySlug,
  listTours,
  getTour,
  createTour,
  updateTour,
  deleteTour,
} from './tours.js';
