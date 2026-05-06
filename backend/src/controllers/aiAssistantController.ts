/**
 * aiAssistantController — split into `controllers/aiAssistant/` folder (S80,
 * refactor pass D, S53 pattern). This file is now a 1-line shim so every
 * existing `import { ... } from '../controllers/aiAssistantController.js'`
 * keeps working.
 *
 * Original 2047-line file is split across:
 *   - aiAssistant/helpers.ts        (truncateTitle)
 *   - aiAssistant/tools.ts          (TOOL_DEFINITIONS + 14 tool impls + execTool)
 *   - aiAssistant/runner.ts         (runToolLoop + buildSystemPrompt + Anthropic client)
 *   - aiAssistant/conversations.ts  (chat CRUD + sendMessage + escalateConversation)
 *   - aiAssistant/feedback.ts       (submitFeedback + admin review queue)
 *   - aiAssistant/kb.ts             (KB article CRUD)
 *   - aiAssistant/tours.ts          (public tour reads + admin tour CRUD)
 *   - aiAssistant/index.ts          (barrel)
 */

export * from './aiAssistant/index.js';
