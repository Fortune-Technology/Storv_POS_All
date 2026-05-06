/**
 * AI Assistant runner — orchestrates the Claude tool-use loop.
 * Split from `aiAssistantController.ts` (S80, refactor pass D, S53 pattern).
 *
 * Public exports:
 *   - `runToolLoop(conversation, userText, req)` — main entry point. Loads
 *     conversation history, retrieves KB articles via RAG, sends to Claude
 *     with prompt caching, executes any tool_use blocks, loops until end_turn.
 *   - `MODEL`, `anthropic` — re-exported so conversations.ts can detect missing
 *     API key and persist the assistant message with the right model tag.
 *   - Types: `RunResult`, `ToolCallTraceEntry`, `PromptCtx`.
 */

import type { Request } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import prisma from '../../config/postgres.js';
import { searchKB, formatKBForPrompt } from '../../services/kbService.js';
import { TOOL_DEFINITIONS, execTool, type ToolOutput } from './tools.js';

/* ── Anthropic client ────────────────────────────────────────────────────── */

export const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
const MAX_OUTPUT_TOKENS = 2048;
const MAX_HISTORY_MESSAGES = 20;   // sliding window sent to Claude
const MAX_TOOL_ITERATIONS = 5;     // guard against infinite loops
const TOOL_TIMEOUT_MS = 8000;      // per-tool hard cap

export const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

/* ── System prompt ───────────────────────────────────────────────────────── */

export interface PromptCtx {
  storeName: string | null;
  userName: string | null;
  userRole: string | null;
  orgName: string | null;
}

function buildSystemPrompt(ctx: PromptCtx, kbBlock: string = ''): string {
  const { storeName, userName, userRole, orgName } = ctx;
  return `You are the StoreVeu POS AI Assistant, helping store staff with features, operations, and live store data.

CURRENT USER:
- Name: ${userName || 'Unknown'}
- Role: ${userRole || 'Unknown'}
- Organization: ${orgName || 'Unknown'}
- Active Store: ${storeName || 'No active store'}

YOUR CAPABILITIES:
You have two sources of answers:
1. **Knowledge Base articles** — curated how-to / troubleshoot content (injected below per-question when relevant).
2. **Live data tools** — call them for real-time store data (sales summaries, inventory, transactions).

Always prefer KB articles for "how do I..." questions. Always prefer calling a tool for "how much / how many / when did..." data questions. Tools respect the user's permissions — if a tool returns \`{"error": "..."}\`, the user does not have access to that data.

CLICKABLE NAVIGATION LINKS (IMPORTANT):
When citing a UI location, write it as a clickable markdown link pointing to the real portal route. The widget renders these as in-app navigation — one click and the user lands on the right screen.

Always use this format: **[Visible label](/portal/<route>)**

Common portal routes:
- **[Live Dashboard](/portal/realtime)** — sales KPIs, today's totals, live transaction feed
- **[Products](/portal/catalog/products)** — product list, add/edit/delete
- **[Bulk Import](/portal/bulk-import)** — CSV product import
- **[Inventory Count](/portal/inventory-count)** — cycle counts + adjustments
- **[Transactions](/portal/reports?tab=transactions)** — past sales lookup
- **[End of Day](/portal/end-of-day)** — EoD reports
- **[Analytics](/portal/analytics)** — sales, predictions, departments
- **[Employee Reports](/portal/reports?tab=employees)** — hours + shifts
- **[Lottery](/portal/lottery)** — setup, inventory, EoD, commission
- **[Fuel](/portal/fuel)** — fuel types + settings
- **[Customers](/portal/customers)** — CRM + loyalty
- **[Vendors](/portal/vendors)** — vendor list
- **[Vendor Orders](/portal/vendor-orders)** — PO suggestions + reorder
- **[Invoice Import](/portal/invoice-import)** — OCR vendor invoices
- **[POS Configuration](/portal/pos-config)** — layout + receipts + label design
- **[Quick Buttons](/portal/quick-buttons)** — POS tile builder
- **[Rules & Fees](/portal/rules-fees)** — tax + deposits
- **[Support Tickets](/portal/support-tickets)** — open / view tickets
- **[Account Settings](/portal/account)** — Organisation / Users / Stores / Store Settings
- **[Roles & Permissions](/portal/roles)** — custom role creation
- **[Invitations](/portal/invitations)** — pending invites
- **[Online Store Setup](/portal/ecom/setup)**, **[Online Orders](/portal/ecom/orders)**, **[Custom Domain](/portal/ecom/domain)**

Prefer *specific tab links* when the destination is a tab within a hub page, e.g. **[Store Settings](/portal/account?tab=stores)** rather than just "Account Settings". If unsure of the exact route, use the bold-only form **Settings → Store** and say "in the portal sidebar".

RESPONSE STYLE — HOW-TO QUESTIONS:

**PREFER TOURS.** For any user message asking how to DO a task, check if the topic matches one of these tour slugs:
- \`add-product\` — anything about adding/creating a product
- \`set-age-verification\` — anything about tobacco or alcohol age limits
- \`invite-user\` — anything about inviting or adding a team member
- \`configure-receipt-printer\` — anything about printer setup
- \`setup-fuel-type\` — anything about setting up fuel / gas pumps

If a match exists, you **MUST** call \`start_product_tour\` with that slug. The tour is an interactive overlay that highlights real buttons on the page — dramatically more useful than a text walkthrough. Trigger on ANY intent to do the task, not just the literal phrase "walk me through":
- "How do I add a product?" → call it
- "I want to create a product" → call it
- "Edit tobacco age" → call it
- "Set up a cashier" → call it
- "Add a regular fuel grade" → call it

When you call the tool, respond in text with ONLY two lines:
> I'll walk you through [the task] with an interactive guided tour that highlights each button on the screen.
>
> Tap the button below to start.

Do NOT write out the steps in text when the tour covers them — the overlay IS the step-by-step.

**FALLBACK — no tour matches.** Structure as a numbered walkthrough with clickable portal links:
1. **Concrete first step** — start with a link to the destination
2. **Each step is one action** — Tap / click / enter / save.
3. **End with a confirmation** — what success looks like
4. **Offer follow-up** — "Let me know if you get stuck!"

For factual questions (sales numbers, counts) keep it brief — bullets + numbers + one link for deeper context.

TICKET ESCALATION:
- If the user asks to file a support ticket, use the \`create_support_ticket\` tool.
- If you cannot confidently answer (no KB match, no applicable tool, edge-case bug), say: "I don't have a confident answer for that. Would you like me to file a support ticket so the StoreVeu team can help?" Then file the ticket only after the user agrees.
- Never file a ticket proactively without the user's consent.

GUIDELINES:
- Be concise and practical. Short paragraphs, bullet points. Numbers and specifics over vague answers.
- Format money as $X.XX. Dates in ISO (YYYY-MM-DD) or "today"/"yesterday" when appropriate.
- If a tool returns no data or an empty list, say so plainly — don't invent numbers.
- When a KB article answers the question, paraphrase the key steps rather than quoting verbatim.

STRICT RULES:
- Never write, share, or reference source code, SQL, API internals, or environment variables.
- Never discuss other organizations' data or other stores the user doesn't have access to.
- If asked about architecture, code, or security internals, respond: "That's handled by the StoreVeu engineering team. Please contact support@storeveu.com."
- Never claim features exist if you're not sure — ask the user to clarify or suggest filing a ticket.${kbBlock ? '\n' + kbBlock : ''}`;
}

/* ── Context loader ──────────────────────────────────────────────────────── */

async function buildContext(req: Request): Promise<PromptCtx> {
  let storeName: string | null = null;
  let orgName: string | null = null;
  try {
    if (req.storeId) {
      const s = await prisma.store.findUnique({ where: { id: req.storeId }, select: { name: true } });
      storeName = s?.name || null;
    }
    if (req.orgId) {
      const o = await prisma.organization.findUnique({ where: { id: req.orgId }, select: { name: true } });
      orgName = o?.name || null;
    }
  } catch { /* non-fatal */ }

  return {
    storeName,
    orgName,
    userName: req.user?.name || null,
    userRole: req.role || req.user?.role || null,
  };
}

/* ── Run loop ────────────────────────────────────────────────────────────── */

export interface ToolCallTraceEntry {
  name: string;
  input: Record<string, unknown>;
  output: ToolOutput;
  durationMs: number;
}

export interface RunResult {
  finalText: string;
  toolCallsTrace: ToolCallTraceEntry[];
  totalTokens: number;
  articlesUsed: Array<{ id: string; title: string; score: number }>;
  ticketIdCreated: string | null;
}

export async function runToolLoop(conversation: { id: string }, userText: string, req: Request): Promise<RunResult> {
  if (!anthropic) {
    throw new Error('AI assistant is not configured. Missing ANTHROPIC_API_KEY.');
  }

  // Load recent history for context (oldest first).
  const history = await prisma.aiMessage.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: 'asc' },
    take: MAX_HISTORY_MESSAGES,
    select: { role: true, content: true },
  });

  const ctx = await buildContext(req);

  // RAG retrieval — find 3 most relevant KB articles for the new user message
  // and inject them into the system prompt.
  type KbArticle = { id: string; title: string; score: number };
  const kbArticles = (await searchKB(userText, { orgId: req.orgId, limit: 3, threshold: 0.35 } as Parameters<typeof searchKB>[1]).catch(() => [] as KbArticle[])) as unknown as KbArticle[];
  const kbBlock = formatKBForPrompt(kbArticles as Parameters<typeof formatKBForPrompt>[0]);
  const systemPrompt = buildSystemPrompt(ctx, kbBlock);

  // Append the new user message to history for Claude's view.
  type Msg = { role: 'user' | 'assistant'; content: unknown };
  const messages: Msg[] = [
    ...history.map((m: { role: string; content: string }) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user' as const, content: userText },
  ];

  const toolCallsTrace: ToolCallTraceEntry[] = [];
  const articlesUsed = kbArticles.map((a) => ({ id: a.id, title: a.title, score: a.score }));
  let finalText = '';
  let totalTokens = 0;
  let ticketIdCreated: string | null = null;

  // Prompt caching — system prompt + tool definitions are stable across requests.
  const systemBlocks = [
    {
      type: 'text',
      text: systemPrompt,
      cache_control: { type: 'ephemeral' },
    },
  ];
  const cachedTools = TOOL_DEFINITIONS.map((t, i) =>
    i === TOOL_DEFINITIONS.length - 1
      ? { ...t, cache_control: { type: 'ephemeral' } }
      : t,
  );

  for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: systemBlocks as unknown as string,
      tools: cachedTools as unknown as Parameters<typeof anthropic.messages.create>[0]['tools'],
      messages: messages as unknown as Parameters<typeof anthropic.messages.create>[0]['messages'],
    });

    totalTokens += (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);

    if (response.stop_reason === 'tool_use') {
      // Push the assistant's tool_use block back into messages, then
      // execute each tool and push a tool_result block.
      messages.push({ role: 'assistant', content: response.content });

      interface ToolUseBlock { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
      interface ToolResultBlock { type: 'tool_result'; tool_use_id: string; content: string }
      const toolResults: ToolResultBlock[] = [];
      for (const block of response.content as Array<ToolUseBlock | { type: string }>) {
        if (block.type !== 'tool_use') continue;
        const tu = block as ToolUseBlock;

        const start = Date.now();
        let output: ToolOutput;
        try {
          output = await Promise.race([
            execTool(tu.name, tu.input || {}, req),
            new Promise<ToolOutput>((_, rej) => setTimeout(() => rej(new Error('Tool timeout')), TOOL_TIMEOUT_MS)),
          ]);
        } catch (err) {
          output = { error: (err as Error).message || 'Tool execution failed' };
        }

        // Capture the ticket id if this tool call created one.
        if (tu.name === 'create_support_ticket' && typeof output?.ticketId === 'string') {
          ticketIdCreated = output.ticketId;
        }

        toolCallsTrace.push({
          name: tu.name,
          input: tu.input,
          output,
          durationMs: Date.now() - start,
        });

        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: JSON.stringify(output),
        });
      }

      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    // stop_reason === 'end_turn' (or similar) — extract final text
    interface TextBlock { type: 'text'; text: string }
    for (const block of response.content as Array<TextBlock | { type: string }>) {
      if (block.type === 'text') finalText += (block as TextBlock).text;
    }
    break;
  }

  if (!finalText) {
    finalText = 'I was unable to produce a response. Please try rephrasing your question.';
  }

  return { finalText, toolCallsTrace, totalTokens, articlesUsed, ticketIdCreated };
}
