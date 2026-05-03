/**
 * gptService.ts — backward-compat shim.
 *
 * Implementation lives in `./ai/gpt.ts` (Session 55 service-layer domain
 * refactor). This file exists so existing imports keep working:
 *   import { ... } from '../services/gptService.js';
 *
 * New code should prefer `./ai/gpt.js` directly.
 */

export * from './ai/gpt.js';
