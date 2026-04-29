/**
 * AI — large-language-model integrations.
 *
 *   gpt.ts — OpenAI client wrapper. Used by:
 *     • Invoice OCR enrichment (line-item extraction, vendor matching)
 *     • Matching service AI fallback tier (low-confidence batch resolver)
 *     • KB embedding generation for the AI Assistant (text-embedding-3-small)
 *     • Receipt photo extraction (vendor invoice scan path)
 *
 * Kept distinct from `services/aiAssistantController` (which is the chat
 * orchestrator). gpt.ts is the low-level provider client; the assistant
 * controller is the conversational layer that calls into it.
 */

export * from './gpt.js';
