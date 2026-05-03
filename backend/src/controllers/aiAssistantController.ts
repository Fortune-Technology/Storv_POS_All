/**
 * aiAssistantController.ts
 *
 * Conversational AI support assistant powered by Claude. The AI never touches
 * the database directly — it calls server-side tool functions which re-check
 * the caller's RBAC permissions before returning data. Store/org scoping
 * always comes from `req` (JWT + active store header), never from tool input.
 *
 * P1: 4 read-only tools + CRUD for conversations/messages + 👍👎 logging.
 * P2 (this session): RAG retrieval from the KB + create_support_ticket tool +
 * auto-escalation on 👎+note into the AiFeedbackReview queue + admin review
 * endpoints.
 */

import type { Request, Response, NextFunction } from 'express';
import type { Prisma } from '@prisma/client';
import { Prisma as PrismaNS } from '@prisma/client';
import Anthropic from '@anthropic-ai/sdk';
import prisma from '../config/postgres.js';
import { userHasPermission } from '../rbac/permissionService.js';
import { searchKB, formatKBForPrompt } from '../services/kbService.js';

/* ── Anthropic client ────────────────────────────────────────────────────── */

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
const MAX_OUTPUT_TOKENS = 2048;
const MAX_HISTORY_MESSAGES = 20;   // sliding window sent to Claude
const MAX_TOOL_ITERATIONS = 5;     // guard against infinite loops
const TOOL_TIMEOUT_MS = 8000;      // per-tool hard cap

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

/* ── Tool definitions (Anthropic tool_use schema) ────────────────────────── */

interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'get_store_summary',
    description: 'Get a sales summary for the user\'s active store. Returns net sales, gross sales, transaction count, tax collected, top-selling products, and active registers. Use this for questions like "how are we doing today", "what are today\'s sales", "how much have we made".',
    input_schema: {
      type: 'object',
      properties: {
        days: {
          type: 'number',
          description: 'Number of days back to include, counting today as day 1. Default 1 (today only). Max 30.',
        },
      },
    },
  },
  {
    name: 'get_inventory_status',
    description: 'Get inventory levels for the user\'s active store. Returns products with low stock, out-of-stock items, and total stock value. Use for questions like "what\'s running low", "do we have <product>", "which items need reordering".',
    input_schema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Optional product name or UPC to search for.' },
        low_stock_only: { type: 'boolean', description: 'If true, return only products below their low-stock threshold. Default false.' },
        limit: { type: 'number', description: 'Max number of products to return. Default 20, max 50.' },
      },
    },
  },
  {
    name: 'get_recent_transactions',
    description: 'Get recent sales transactions at the user\'s active store. Use for questions like "show me the last 5 sales", "what was the last transaction", "how many transactions today".',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Number of transactions to return. Default 10, max 25.' },
        status: { type: 'string', enum: ['complete', 'refund', 'voided', 'all'], description: 'Filter by status. Default complete.' },
      },
    },
  },
  {
    name: 'search_transactions',
    description: 'Search transactions by criteria. Use for questions like "find transactions above $100 yesterday", "show me all cash sales last week", "find the sale for Jane Doe".',
    input_schema: {
      type: 'object',
      properties: {
        date_from: { type: 'string', description: 'Start date YYYY-MM-DD (inclusive). Default 7 days ago.' },
        date_to: { type: 'string', description: 'End date YYYY-MM-DD (inclusive). Default today.' },
        min_amount: { type: 'number', description: 'Minimum grand total.' },
        max_amount: { type: 'number', description: 'Maximum grand total.' },
        tender_method: { type: 'string', enum: ['cash', 'card', 'ebt', 'check', 'credit', 'debit'], description: 'Filter by payment method.' },
        limit: { type: 'number', description: 'Max results. Default 20, max 50.' },
      },
    },
  },
  {
    name: 'get_lottery_summary',
    description: 'Get lottery sales summary for the user\'s active store. Returns net sales, commission earned, active boxes, top-selling games. Use for questions like "how are lottery sales", "what games are selling", "how much commission this month".',
    input_schema: { type: 'object', properties: { days: { type: 'number', description: 'Number of days back to include. Default 30. Max 90.' } } },
  },
  {
    name: 'get_fuel_summary',
    description: 'Get fuel sales summary for the user\'s active store. Returns gallons sold, net revenue, refunds, per-fuel-type breakdown with average price per gallon. Only applicable for stores with fuel enabled.',
    input_schema: { type: 'object', properties: { days: { type: 'number', description: 'Number of days back. Default 7. Max 90.' } } },
  },
  {
    name: 'get_employee_hours',
    description: 'Get employee clock-in/clock-out summary for the active store. Returns total hours worked per employee, active clock-ins, and variance from scheduled shifts. Use for questions like "who is clocked in", "how many hours did Jane work this week", "is anyone still clocked in from yesterday".',
    input_schema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'Number of days back. Default 7.' },
        employee_name: { type: 'string', description: 'Optional filter by employee name (fuzzy match).' },
      },
    },
  },
  {
    name: 'get_end_of_day_report',
    description: 'Get the End of Day report for a specific date. Returns payouts (9 categories), tender details (9 types), transactions summary, fuel sales, and reconciliation if a shift is scoped. Use for questions like "show me yesterday\'s EoD", "what were the cash sales on April 18", "did the drawer balance yesterday".',
    input_schema: { type: 'object', properties: { date: { type: 'string', description: 'Date YYYY-MM-DD. Default today.' } } },
  },
  {
    name: 'get_sales_predictions',
    description: 'Get sales predictions for the next N days using the Holt-Winters forecasting engine (adjusted for day-of-week, holidays, and weather). Use for questions like "what will sales be next week", "forecast tomorrow", "projected revenue this month".',
    input_schema: { type: 'object', properties: { days_ahead: { type: 'number', description: 'How many days to forecast. Default 7. Max 30.' } } },
  },
  {
    name: 'lookup_customer',
    description: 'Search the customer database by phone, name, or email. Returns customer details including loyalty points, discount, and house-account balance. Use for questions like "look up Jane Doe", "does 555-1234 have points", "who is +14165550100".',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search string — matched against name, phone, and email.' },
        limit: { type: 'number', description: 'Max results. Default 5, max 20.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_vendor_order_suggestions',
    description: 'Get AI-driven reorder suggestions from the 14-factor auto-order engine. Returns recommended quantities per product per vendor based on sales velocity, lead time, seasonality, and current on-hand. Use for questions like "what should I reorder", "what\'s running low from Coca-Cola", "reorder suggestions for Hershey".',
    input_schema: {
      type: 'object',
      properties: {
        vendor_name: { type: 'string', description: 'Optional filter to a specific vendor (fuzzy match).' },
        urgency: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'all'], description: 'Filter by urgency level. Default "all".' },
        limit: { type: 'number', description: 'Max products. Default 15, max 30.' },
      },
    },
  },
  {
    name: 'list_open_shifts',
    description: 'List all currently open cash drawer shifts at the store. Returns cashier, station, opening amount, and how long the shift has been open. Use for questions like "who is on the register right now", "is anyone still clocked open from last night", "whose shift is open".',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'start_product_tour',
    description: `Launch an interactive narrated product tour. The tour is a FLOATING OVERLAY that highlights real UI elements on the page with a dim background + pulsing spotlight + numbered steps. It is dramatically better UX than a text walkthrough.

**PREFER THIS TOOL.** When the user asks about a topic covered by a tour, the tour IS the answer — even if they phrase it as a question rather than an explicit "walk me through" request.

**Call this tool when the user's message is about one of these topics AND they want to actually DO the thing:**

| Topic | Slug | User phrasings that should trigger it |
|-------|------|---------------------------------------|
| Adding a product | \`add-product\` | "how do I add a product", "I want to add a product", "walk me through adding a product", "create a new product", "add to catalog", "new product" |
| Tobacco/alcohol age limits | \`set-age-verification\` | "how do I set the tobacco age", "edit alcohol age", "configure age verification", "set up age checks", "age limits for tobacco/alcohol" |
| Inviting users | \`invite-user\` | "how do I invite a user", "add a cashier", "invite my team", "new manager", "add employee" |
| Receipt printer setup | \`configure-receipt-printer\` | "set up my printer", "configure receipt printer", "connect a printer", "printer setup" |
| Fuel module setup | \`setup-fuel-type\` | "add a fuel type", "set up gas pumps", "configure fuel", "add regular/premium/diesel" |

**When you call this tool, respond in text with ONLY:**
1. One friendly sentence: "I'll walk you through [task] with a guided tour that highlights each button on the screen."
2. End with: "Tap the button below to start."

Do NOT write out the step-by-step instructions in text. The tour overlay IS the instructions. Writing them twice creates visual noise.

**Only fall back to a text walkthrough** when the topic doesn't match any tour — e.g., "walk me through configuring promotions" (no promotions tour yet) → use the KB article path with clickable portal links.`,
    input_schema: {
      type: 'object',
      properties: {
        slug: { type: 'string', enum: ['add-product', 'set-age-verification', 'invite-user', 'configure-receipt-printer', 'setup-fuel-type'], description: 'The tour slug. Must match one of the available tours exactly.' },
      },
      required: ['slug'],
    },
  },
  {
    name: 'create_support_ticket',
    description: 'File a support ticket to the StoreVeu support team. ONLY call this tool when (a) the user explicitly asks to file a ticket, or (b) they confirm "yes" after you have proposed filing one. Never file a ticket proactively without the user\'s agreement. The full conversation context will be attached automatically — you only need to provide a clear subject and a body summarizing the issue from the user\'s perspective.',
    input_schema: {
      type: 'object',
      properties: {
        subject: { type: 'string', description: 'Short subject line (under 120 chars) summarizing the issue.' },
        body: { type: 'string', description: 'Detailed body describing what the user was trying to do, what happened, and any details that would help support diagnose. Write in third person ("The user is trying to..."). No code, no SQL.' },
        priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'], description: 'Urgency. Default normal. Use high for bugs blocking day-to-day operations, urgent for complete outages.' },
      },
      required: ['subject', 'body'],
    },
  },
];

/* ── Tool execution — each tool re-checks RBAC ─────────────────────────── */

type ToolInput = Record<string, unknown>;
type ToolOutput = Record<string, unknown>;

const clamp = (n: unknown, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Number(n) || lo));

async function execTool(name: string, input: ToolInput, req: Request): Promise<ToolOutput> {
  const orgId   = req.orgId;
  const storeId = req.storeId;
  // Tools that operate on store data need an org context. Superadmin chatting
  // cross-tenant without X-Tenant-Id will hit this and Claude relays the
  // error rather than crashing the conversation.
  if (!orgId) {
    return { error: 'No organization context is active. If you are a superadmin, set the X-Tenant-Id header or pick an organization from the switcher.' };
  }

  switch (name) {
    case 'get_store_summary':         return await toolStoreSummary(input, orgId, storeId, req);
    case 'get_inventory_status':      return await toolInventoryStatus(input, orgId, storeId, req);
    case 'get_recent_transactions':   return await toolRecentTransactions(input, orgId, storeId, req);
    case 'search_transactions':       return await toolSearchTransactions(input, orgId, storeId, req);
    case 'get_lottery_summary':       return await toolLotterySummary(input, orgId, storeId, req);
    case 'get_fuel_summary':          return await toolFuelSummary(input, orgId, storeId, req);
    case 'get_employee_hours':        return await toolEmployeeHours(input, orgId, storeId, req);
    case 'get_end_of_day_report':     return await toolEndOfDayReport(input, orgId, storeId, req);
    case 'get_sales_predictions':     return await toolSalesPredictions(input, orgId, storeId, req);
    case 'lookup_customer':           return await toolLookupCustomer(input, orgId, req);
    case 'get_vendor_order_suggestions': return await toolVendorOrderSuggestions(input, orgId, storeId, req);
    case 'list_open_shifts':          return await toolListOpenShifts(input, orgId, storeId, req);
    case 'start_product_tour':        return await toolStartProductTour(input, orgId, req);
    case 'create_support_ticket':     return await toolCreateSupportTicket(input, orgId, req);
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

/* ── Extended tools (P3) ───────────────────────────────────────────────── */

async function toolLotterySummary(input: ToolInput, orgId: string, storeId: string | null | undefined, req: Request): Promise<ToolOutput> {
  if (!(await userHasPermission(req, 'lottery.view'))) {
    return { error: 'You do not have permission to view lottery data.' };
  }
  const days = clamp(input.days, 1, 90);
  const from = new Date(); from.setDate(from.getDate() - (days - 1)); from.setHours(0, 0, 0, 0);
  const to = new Date(); to.setHours(23, 59, 59, 999);

  const where: Prisma.LotteryTransactionWhereInput = { orgId, createdAt: { gte: from, lte: to } };
  if (storeId) where.storeId = storeId;

  const [txs, activeBoxes, settings] = await Promise.all([
    prisma.lotteryTransaction.findMany({
      where,
      select: { amount: true, type: true, gameId: true, gameName: true },
      take: 10000,
    }),
    prisma.lotteryBox.count({
      where: { orgId, ...(storeId && { storeId }), status: 'active' },
    }),
    prisma.lotterySettings.findFirst({
      where: { orgId, ...(storeId && { storeId }) },
      select: { commissionRate: true, state: true, cashOnly: true, scanRequiredAtShiftEnd: true },
    }),
  ]);
  type LotRow = (typeof txs)[number];

  let sales = 0, payouts = 0;
  const byGame = new Map<string, { name: string; sales: number }>();
  for (const t of txs as LotRow[]) {
    const amt = Number(t.amount || 0);
    if (t.type === 'sale') {
      sales += amt;
      const key = t.gameName || t.gameId || 'unknown';
      const cur = byGame.get(key) || { name: key, sales: 0 };
      cur.sales += amt;
      byGame.set(key, cur);
    } else if (t.type === 'payout') {
      payouts += amt;
    }
  }

  const commRate = Number(settings?.commissionRate || 0);
  const topGames = [...byGame.values()].sort((a, b) => b.sales - a.sales).slice(0, 5)
    .map((g) => ({ name: g.name, sales: Number(g.sales.toFixed(2)) }));

  return {
    period: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), days },
    netSales:          Number((sales - payouts).toFixed(2)),
    grossSales:        Number(sales.toFixed(2)),
    payoutsTotal:      Number(payouts.toFixed(2)),
    commissionEarned:  Number(((sales - payouts) * commRate).toFixed(2)),
    commissionRate:    commRate,
    state:             settings?.state || null,
    cashOnlyMode:      !!settings?.cashOnly,
    activeBoxes,
    topGames,
  };
}

async function toolFuelSummary(input: ToolInput, orgId: string, storeId: string | null | undefined, req: Request): Promise<ToolOutput> {
  if (!(await userHasPermission(req, 'fuel.view'))) {
    return { error: 'You do not have permission to view fuel data.' };
  }
  const days = clamp(input.days, 1, 90);
  const from = new Date(); from.setDate(from.getDate() - (days - 1)); from.setHours(0, 0, 0, 0);
  const to = new Date(); to.setHours(23, 59, 59, 999);

  const where: Prisma.FuelTransactionWhereInput = { orgId, createdAt: { gte: from, lte: to } };
  if (storeId) where.storeId = storeId;

  const txs = await prisma.fuelTransaction.findMany({
    where,
    select: { gallons: true, amount: true, pricePerGallon: true, fuelTypeName: true, type: true },
    take: 10000,
  });
  type FuelRow = (typeof txs)[number];

  let grossGallons = 0, grossAmount = 0, refundGallons = 0, refundAmount = 0;
  interface ByTypeAcc { name: string; gallons: number; amount: number; ppgSum: number; ppgCount: number }
  const byType = new Map<string, ByTypeAcc>();
  for (const t of txs as FuelRow[]) {
    const g = Number(t.gallons || 0), a = Number(t.amount || 0);
    const isRefund = t.type === 'refund';
    if (isRefund) { refundGallons += g; refundAmount += a; }
    else          { grossGallons  += g; grossAmount  += a; }

    const key = t.fuelTypeName || 'unknown';
    const cur = byType.get(key) || { name: key, gallons: 0, amount: 0, ppgSum: 0, ppgCount: 0 };
    cur.gallons += isRefund ? -g : g;
    cur.amount  += isRefund ? -a : a;
    if (!isRefund && Number(t.pricePerGallon)) { cur.ppgSum += Number(t.pricePerGallon); cur.ppgCount++; }
    byType.set(key, cur);
  }

  const byTypeArr = [...byType.values()].map((v) => ({
    name: v.name,
    gallons:       Number(v.gallons.toFixed(3)),
    amount:        Number(v.amount.toFixed(2)),
    avgPricePerGallon: v.ppgCount > 0 ? Number((v.ppgSum / v.ppgCount).toFixed(3)) : null,
  }));

  if (txs.length === 0) {
    return { period: { days }, note: 'No fuel transactions in this period. Fuel may not be enabled for this store.' };
  }

  return {
    period:         { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), days },
    netGallons:     Number((grossGallons - refundGallons).toFixed(3)),
    netAmount:      Number((grossAmount - refundAmount).toFixed(2)),
    grossGallons:   Number(grossGallons.toFixed(3)),
    grossAmount:    Number(grossAmount.toFixed(2)),
    refundAmount:   Number(refundAmount.toFixed(2)),
    byType: byTypeArr,
  };
}

async function toolEmployeeHours(input: ToolInput, orgId: string, storeId: string | null | undefined, req: Request): Promise<ToolOutput> {
  if (!(await userHasPermission(req, 'reports.view')) &&
      !(await userHasPermission(req, 'users.view'))) {
    return { error: 'You do not have permission to view employee data.' };
  }
  const days = clamp(input.days, 1, 60);
  const from = new Date(); from.setDate(from.getDate() - (days - 1)); from.setHours(0, 0, 0, 0);
  const to = new Date(); to.setHours(23, 59, 59, 999);

  const where: Prisma.ClockEventWhereInput = { orgId, createdAt: { gte: from, lte: to } };
  if (storeId) where.storeId = storeId;

  const events = await prisma.clockEvent.findMany({
    where,
    orderBy: { createdAt: 'asc' },
    select: { userId: true, type: true, createdAt: true },
    take: 5000,
  });
  type ClockEvtRow = (typeof events)[number];

  // Group events per user, pair in/out, calculate hours + active.
  const userIds = [...new Set((events as ClockEvtRow[]).map((e) => e.userId))];
  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, email: true, role: true },
      })
    : [];
  type UserRow = (typeof users)[number];
  const nameById = Object.fromEntries((users as UserRow[]).map((u) => [u.id, u.name || u.email]));

  interface UserBucket { userId: string; name: string; events: ClockEvtRow[] }
  const byUser = new Map<string, UserBucket>();
  for (const e of events as ClockEvtRow[]) {
    const key = e.userId;
    if (!byUser.has(key)) byUser.set(key, { userId: key, name: nameById[key] || 'Unknown', events: [] });
    byUser.get(key)!.events.push(e);
  }

  const filter = typeof input.employee_name === 'string' ? input.employee_name.toLowerCase().trim() : null;
  interface EmpResult { userId: string; name: string; totalHours: number; sessionCount: number; activeNow: boolean }
  const result: EmpResult[] = [];
  for (const u of byUser.values()) {
    if (filter && !u.name.toLowerCase().includes(filter)) continue;
    let totalMs = 0;
    let currentIn: Date | null = null;
    let active = false;
    for (const e of u.events) {
      if (e.type === 'in') currentIn = e.createdAt;
      else if (e.type === 'out' && currentIn) {
        totalMs += new Date(e.createdAt).getTime() - new Date(currentIn).getTime();
        currentIn = null;
      }
    }
    if (currentIn) { active = true; totalMs += new Date().getTime() - new Date(currentIn).getTime(); }
    result.push({
      userId: u.userId,
      name: u.name,
      totalHours: Number((totalMs / 1000 / 3600).toFixed(2)),
      sessionCount: u.events.filter((e) => e.type === 'in').length,
      activeNow: active,
    });
  }
  result.sort((a, b) => b.totalHours - a.totalHours);

  return {
    period: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), days },
    employeeCount: result.length,
    currentlyClockedIn: result.filter((r) => r.activeNow).map((r) => r.name),
    employees: result.slice(0, 30),
  };
}

interface TenderLineLite { method?: string | null; amount?: number | string | null }

async function toolEndOfDayReport(input: ToolInput, orgId: string, storeId: string | null | undefined, req: Request): Promise<ToolOutput> {
  if (!(await userHasPermission(req, 'reports.view'))) {
    return { error: 'You do not have permission to view reports.' };
  }
  const dateStr = (input.date as string | undefined) || new Date().toISOString().slice(0, 10);
  const from = new Date(dateStr + 'T00:00:00.000Z');
  const to   = new Date(dateStr + 'T23:59:59.999Z');
  if (isNaN(from.getTime())) return { error: 'Invalid date format. Use YYYY-MM-DD.' };

  const where: Prisma.TransactionWhereInput = { orgId, createdAt: { gte: from, lte: to }, status: { in: ['complete', 'refund'] } };
  if (storeId) where.storeId = storeId;

  const txs = await prisma.transaction.findMany({
    where,
    select: { status: true, grandTotal: true, subtotal: true, taxTotal: true, tenderLines: true },
    take: 10000,
  });
  type TxRow = (typeof txs)[number];

  // Tender buckets — match EoD controller's normalization.
  const tenderMap: Record<string, string> = {
    cash: 'Cash', card: 'Credit Card', credit: 'Credit Card', debit: 'Debit Card',
    ebt: 'EBT', check: 'Check', cheque: 'Check', charge: 'In-store Charge',
  };
  interface TenderBucket { name: string; count: number; amount: number }
  const tenderBuckets = new Map<string, TenderBucket>();
  let gross = 0, net = 0, tax = 0, cashCollected = 0, completeCount = 0, refundCount = 0;

  for (const t of txs as TxRow[]) {
    const isRefund = t.status === 'refund';
    if (isRefund) refundCount++; else completeCount++;
    const sign = isRefund ? -1 : 1;
    gross += Number(t.grandTotal || 0) * sign;
    net   += Number(t.subtotal || 0) * sign;
    tax   += Number(t.taxTotal || 0) * sign;
    const tenders: TenderLineLite[] = Array.isArray(t.tenderLines) ? (t.tenderLines as unknown as TenderLineLite[]) : [];
    for (const line of tenders) {
      const raw = String(line.method || '').toLowerCase().trim();
      const bucket = tenderMap[raw] || 'Other';
      const amt = Number(line.amount || 0) * sign;
      const cur = tenderBuckets.get(bucket) || { name: bucket, count: 0, amount: 0 };
      cur.count++; cur.amount += amt;
      tenderBuckets.set(bucket, cur);
      if (bucket === 'Cash') cashCollected += amt;
    }
  }

  return {
    date: dateStr,
    transactions: {
      grossSales:       Number(gross.toFixed(2)),
      netSales:         Number(net.toFixed(2)),
      taxCollected:     Number(tax.toFixed(2)),
      completeCount, refundCount,
      averageTransaction: completeCount > 0 ? Number((gross / completeCount).toFixed(2)) : 0,
    },
    cashCollected: Number(cashCollected.toFixed(2)),
    tenderBreakdown: [...tenderBuckets.values()]
      .map((b) => ({ name: b.name, count: b.count, amount: Number(b.amount.toFixed(2)) }))
      .sort((a, b) => b.amount - a.amount),
  };
}

async function toolSalesPredictions(input: ToolInput, orgId: string, storeId: string | null | undefined, req: Request): Promise<ToolOutput> {
  if (!(await userHasPermission(req, 'predictions.view')) &&
      !(await userHasPermission(req, 'analytics.view'))) {
    return { error: 'You do not have permission to view sales predictions.' };
  }
  const daysAhead = clamp(input.days_ahead, 1, 30);

  // Pull 90 days of history.
  const from = new Date(); from.setDate(from.getDate() - 90); from.setHours(0, 0, 0, 0);
  const to = new Date(); to.setHours(23, 59, 59, 999);
  const where: Prisma.TransactionWhereInput = { orgId, createdAt: { gte: from, lte: to }, status: { in: ['complete', 'refund'] } };
  if (storeId) where.storeId = storeId;

  const txs = await prisma.transaction.findMany({
    where,
    select: { grandTotal: true, status: true, createdAt: true },
    take: 50000,
  });

  // Build daily totals.
  const byDay = new Map<string, number>();
  for (const t of txs) {
    const key = new Date(t.createdAt).toISOString().slice(0, 10);
    const v = Number(t.grandTotal || 0) * (t.status === 'refund' ? -1 : 1);
    byDay.set(key, (byDay.get(key) || 0) + v);
  }

  if (byDay.size < 14) {
    return { note: 'Not enough history to forecast (need at least 14 days of sales).', historicalDays: byDay.size };
  }

  // Use the existing predictions util if available; fallback to simple moving avg.
  try {
    const predictionsModule = await import('../utils/predictions.js') as unknown as {
      runHoltWinters?: (values: number[], horizon: number, period: number) => number[];
    };
    const runHoltWinters = predictionsModule.runHoltWinters;
    if (!runHoltWinters) throw new Error('runHoltWinters unavailable');
    const series = [...byDay.entries()].sort().map(([d, v]) => ({ date: d, value: v }));
    const forecast = runHoltWinters(series.map((s) => s.value), daysAhead, 7);
    const today = new Date();
    const days: Array<{ date: string; predicted: number }> = [];
    for (let i = 1; i <= daysAhead; i++) {
      const d = new Date(today); d.setDate(d.getDate() + i);
      days.push({ date: d.toISOString().slice(0, 10), predicted: Number((forecast[i - 1] || 0).toFixed(2)) });
    }
    const total = days.reduce((sum, d) => sum + d.predicted, 0);
    return {
      forecast:        days,
      totalForecasted: Number(total.toFixed(2)),
      basedOnDays:     series.length,
      note: 'Holt-Winters forecast with 7-day seasonality. Doesn\'t account for promotions or one-off events.',
    };
  } catch {
    // Simple fallback: average of last 14 days of data.
    const recent = [...byDay.values()].slice(-14);
    const avg = recent.reduce((s, v) => s + v, 0) / recent.length;
    const today = new Date();
    const days: Array<{ date: string; predicted: number }> = [];
    for (let i = 1; i <= daysAhead; i++) {
      const d = new Date(today); d.setDate(d.getDate() + i);
      days.push({ date: d.toISOString().slice(0, 10), predicted: Number(avg.toFixed(2)) });
    }
    return {
      forecast: days,
      totalForecasted: Number((avg * daysAhead).toFixed(2)),
      basedOnDays: recent.length,
      note: 'Fallback flat-average forecast — advanced Holt-Winters engine was unavailable.',
    };
  }
}

async function toolLookupCustomer(input: ToolInput, orgId: string, req: Request): Promise<ToolOutput> {
  if (!(await userHasPermission(req, 'customers.view'))) {
    return { error: 'You do not have permission to view customers.' };
  }
  const query = String(input.query || '').trim();
  if (!query) return { error: 'Please provide a search query.' };
  const limit = clamp(input.limit, 1, 20);

  // Normalize phone — digits only, allow partial match.
  const phoneDigits = query.replace(/\D/g, '');

  const customers = await prisma.customer.findMany({
    where: {
      orgId,
      deleted: false,
      OR: [
        { name:  { contains: query, mode: 'insensitive' } },
        { email: { contains: query, mode: 'insensitive' } },
        ...(phoneDigits.length >= 4 ? [{ phone: { contains: phoneDigits } }] : []),
      ],
    },
    orderBy: { name: 'asc' },
    take: limit,
    select: {
      id: true, name: true, phone: true, email: true,
      loyaltyCard: true, points: true, discount: true,
      balance: true, balanceLimit: true, chargeAccount: true, createdAt: true,
    },
  });
  type CustRow = (typeof customers)[number];

  return {
    query,
    count: customers.length,
    customers: (customers as CustRow[]).map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      email: c.email,
      loyaltyCard: c.loyaltyCard,
      points: c.points,
      discountPercent: Number(c.discount || 0),
      houseBalance: Number(c.balance || 0),
      houseBalanceLimit: c.balanceLimit != null ? Number(c.balanceLimit) : null,
      chargeAccountEnabled: !!c.chargeAccount,
    })),
  };
}

interface VendorOrderSuggestion {
  productId: number | string;
  productName: string;
  vendorName: string | null;
  suggestedQty: number;
  currentOnHand: number | null;
  urgency: 'critical' | 'high' | 'medium' | 'low' | string;
  reason: string;
}

async function toolVendorOrderSuggestions(input: ToolInput, orgId: string, storeId: string | null | undefined, req: Request): Promise<ToolOutput> {
  if (!(await userHasPermission(req, 'vendor_orders.view'))) {
    return { error: 'You do not have permission to view vendor orders.' };
  }
  const limit = clamp(input.limit, 1, 30);
  const vendorFilter = typeof input.vendor_name === 'string' ? input.vendor_name.toLowerCase().trim() : null;
  const urgencyRaw = typeof input.urgency === 'string' ? input.urgency : '';
  const urgencyFilter = ['critical', 'high', 'medium', 'low'].includes(urgencyRaw) ? urgencyRaw : null;

  // Try to use the order engine if available — otherwise derive a simple
  // "below reorder point" list from StoreProduct.
  let suggestions: VendorOrderSuggestion[] = [];
  try {
    const engine = await import('../services/orderEngine.js') as unknown as {
      generateSuggestions?: (args: { orgId: string; storeId: string | null | undefined }) => Promise<VendorOrderSuggestion[]>;
    };
    if (typeof engine.generateSuggestions === 'function') {
      const all = await engine.generateSuggestions({ orgId, storeId });
      type RawSuggestion = VendorOrderSuggestion & { orderQty?: number; reorderReason?: string };
      suggestions = (all as RawSuggestion[]).map((s) => ({
        productId: s.productId, productName: s.productName,
        vendorName: s.vendorName || null,
        suggestedQty: s.suggestedQty || s.orderQty || 0,
        currentOnHand: s.currentOnHand ?? null,
        urgency: s.urgency || 'medium',
        reason: s.reorderReason || s.reason || '',
      }));
    }
  } catch { /* fallback below */ }

  if (suggestions.length === 0) {
    // Fallback — products at or below reorder point.
    const products = await prisma.masterProduct.findMany({
      where: { orgId, deleted: false, active: true },
      take: 200,
      select: {
        id: true, name: true,
        defaultVendor: { select: { name: true } },
        storeProducts: storeId
          ? { where: { storeId }, take: 1, select: { quantityOnHand: true, lowStockThreshold: true } }
          : false,
      },
    });
    type ProductRow = (typeof products)[number];
    suggestions = (products as ProductRow[])
      .map((p): VendorOrderSuggestion | null => {
        const sp = (p.storeProducts as Array<{ quantityOnHand: unknown; lowStockThreshold: unknown }> | undefined)?.[0];
        const qoh = sp?.quantityOnHand ?? null;
        const threshold = sp?.lowStockThreshold ?? null;
        if (qoh == null || threshold == null) return null;
        if (Number(qoh) > Number(threshold)) return null;
        return {
          productId: p.id,
          productName: p.name,
          vendorName: (p as { defaultVendor?: { name: string | null } | null }).defaultVendor?.name || null,
          suggestedQty: Math.max(Number(threshold) * 2 - Number(qoh), 1),
          currentOnHand: Number(qoh),
          urgency: Number(qoh) <= 0 ? 'critical' : (Number(qoh) <= Number(threshold) / 2 ? 'high' : 'medium'),
          reason: 'Below low-stock threshold (heuristic fallback)',
        };
      })
      .filter((x): x is VendorOrderSuggestion => x !== null);
  }

  // Apply filters
  if (vendorFilter) suggestions = suggestions.filter((s) => (s.vendorName || '').toLowerCase().includes(vendorFilter));
  if (urgencyFilter) suggestions = suggestions.filter((s) => s.urgency === urgencyFilter);

  return {
    count: suggestions.length,
    suggestions: suggestions.slice(0, limit),
    note: suggestions.length === 0 ? 'No products need reordering based on current data.' : undefined,
  };
}

async function toolListOpenShifts(_input: ToolInput, orgId: string, storeId: string | null | undefined, req: Request): Promise<ToolOutput> {
  if (!(await userHasPermission(req, 'shifts.view'))) {
    return { error: 'You do not have permission to view shifts.' };
  }
  const where: Prisma.ShiftWhereInput = { orgId, status: 'open' };
  if (storeId) where.storeId = storeId;

  const shifts = await prisma.shift.findMany({
    where,
    orderBy: { openedAt: 'asc' },
    select: {
      id: true, openedAt: true, openingAmount: true, storeId: true,
      station: { select: { name: true } },
      openedBy: { select: { name: true, email: true } },
    },
    take: 20,
  });
  type ShiftRow = (typeof shifts)[number] & { openedBy?: { name: string | null; email: string | null } | null };

  const now = Date.now();
  return {
    count: shifts.length,
    openShifts: (shifts as ShiftRow[]).map((s) => {
      const openedAt = new Date(s.openedAt);
      const hoursOpen = Math.round(((now - openedAt.getTime()) / 3600000) * 10) / 10;
      return {
        shiftId: s.id,
        openedBy: s.openedBy?.name || s.openedBy?.email || 'Unknown',
        station: s.station?.name || null,
        openedAt: s.openedAt,
        hoursOpen,
        openingAmount: Number(s.openingAmount || 0),
        flags: {
          crossedMidnight: openedAt.toDateString() !== new Date().toDateString(),
        },
      };
    }),
  };
}

async function toolStartProductTour(input: ToolInput, orgId: string | null | undefined, _req: Request): Promise<ToolOutput> {
  const slug = String(input.slug || '').trim();
  if (!slug) return { error: 'Please provide a tour slug.' };

  const tour = await prisma.productTour.findFirst({
    where: {
      slug,
      active: true,
      OR: [
        { orgId: null },
        ...(orgId ? [{ orgId }] : []),
      ],
    },
    select: {
      id: true, slug: true, name: true, description: true,
      category: true, steps: true,
    },
  });

  if (!tour) {
    return { error: `No active tour found for "${slug}". The user should ask about the topic directly instead.` };
  }

  return {
    success: true,
    tour: {
      id: tour.id,
      slug: tour.slug,
      name: tour.name,
      description: tour.description,
      stepCount: Array.isArray(tour.steps) ? tour.steps.length : 0,
    },
    instruction: 'The widget will render a "Start guided tour" button. Recommend the tour in your text response and end with "Tap the button below when you\'re ready."',
  };
}

async function toolCreateSupportTicket(input: ToolInput, orgId: string, req: Request): Promise<ToolOutput> {
  const subject = typeof input.subject === 'string' ? input.subject : '';
  const body = typeof input.body === 'string' ? input.body : '';
  const priority = typeof input.priority === 'string' ? input.priority : 'normal';
  if (!subject?.trim() || !body?.trim()) {
    return { error: 'Both subject and body are required.' };
  }
  if (!(await userHasPermission(req, 'support.create'))) {
    return { error: 'You do not have permission to file support tickets.' };
  }

  const ticket = await prisma.supportTicket.create({
    data: {
      email:    req.user!.email,
      name:     req.user!.name,
      subject:  subject.trim().slice(0, 300),
      body:     `${body.trim()}\n\n— Filed via AI Support Assistant`,
      priority: ['low', 'normal', 'high', 'urgent'].includes(priority) ? priority : 'normal',
      orgId,
      userId:   req.user!.id,
      status:   'open',
      responses: [] as unknown as Prisma.InputJsonValue,
    },
    select: { id: true, subject: true, status: true, priority: true, createdAt: true },
  });

  return {
    success: true,
    ticketId: ticket.id,
    message: `Support ticket #${ticket.id.slice(-6)} filed. The StoreVeu team will respond in Support Tickets.`,
    ticket,
  };
}

async function toolStoreSummary(input: ToolInput, orgId: string, storeId: string | null | undefined, req: Request): Promise<ToolOutput> {
  if (!(await userHasPermission(req, 'dashboard.view')) &&
      !(await userHasPermission(req, 'analytics.view'))) {
    return { error: 'You do not have permission to view store analytics.' };
  }

  const days = clamp(input.days, 1, 30);
  const to = new Date(); to.setHours(23, 59, 59, 999);
  const from = new Date(); from.setDate(from.getDate() - (days - 1)); from.setHours(0, 0, 0, 0);

  const where: Prisma.TransactionWhereInput = { orgId, createdAt: { gte: from, lte: to }, status: { in: ['complete', 'refund'] } };
  if (storeId) where.storeId = storeId;

  const txs = await prisma.transaction.findMany({
    where,
    select: {
      id: true, status: true, grandTotal: true, subtotal: true, taxTotal: true,
      lineItems: true, createdAt: true,
    },
    take: 5000,
  });
  type TxRow = (typeof txs)[number];

  let netSales = 0, grossSales = 0, taxTotal = 0, completedCount = 0, refundCount = 0;
  interface ProdTally { name: string; qty: number; revenue: number }
  const productTally = new Map<string, ProdTally>();

  interface LineItemLite {
    isLottery?: boolean; isFuel?: boolean; isBagFee?: boolean; isBottleReturn?: boolean;
    productId?: string | number | null; upc?: string | null; name?: string;
    qty?: number | string | null; lineTotal?: number | string | null;
  }

  for (const t of txs as TxRow[]) {
    const isRefund = t.status === 'refund';
    const sub   = Number(t.subtotal || 0)   * (isRefund ? -1 : 1);
    const gross = Number(t.grandTotal || 0) * (isRefund ? -1 : 1);
    const tax   = Number(t.taxTotal || 0)   * (isRefund ? -1 : 1);
    netSales += sub; grossSales += gross; taxTotal += tax;
    if (isRefund) refundCount += 1; else completedCount += 1;

    const lineItems: LineItemLite[] = Array.isArray(t.lineItems) ? (t.lineItems as unknown as LineItemLite[]) : [];
    if (!isRefund) {
      for (const li of lineItems) {
        if (li.isLottery || li.isFuel || li.isBagFee || li.isBottleReturn) continue;
        const key = String(li.productId || li.upc || li.name || '');
        if (!key) continue;
        const prev = productTally.get(key) || { name: li.name || key, qty: 0, revenue: 0 };
        prev.qty     += Number(li.qty || 1);
        prev.revenue += Number(li.lineTotal || 0);
        productTally.set(key, prev);
      }
    }
  }

  const topProducts = [...productTally.values()]
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5)
    .map((p) => ({ name: p.name, qty: p.qty, revenue: Number(p.revenue.toFixed(2)) }));

  return {
    period: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), days },
    netSales:    Number(netSales.toFixed(2)),
    grossSales:  Number(grossSales.toFixed(2)),
    taxCollected: Number(taxTotal.toFixed(2)),
    transactionCount: completedCount,
    refundCount,
    avgTransaction: completedCount > 0 ? Number((grossSales / completedCount).toFixed(2)) : 0,
    topProducts,
  };
}

async function toolInventoryStatus(input: ToolInput, orgId: string, storeId: string | null | undefined, req: Request): Promise<ToolOutput> {
  if (!(await userHasPermission(req, 'products.view'))) {
    return { error: 'You do not have permission to view products.' };
  }

  const limit = clamp(input.limit, 1, 50);
  const search = typeof input.search === 'string' ? input.search.trim() : '';
  const lowStockOnly = Boolean(input.low_stock_only);

  const where: Prisma.MasterProductWhereInput = { orgId, deleted: false, active: true };
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { upc:  { equals: search } },
      { brand: { contains: search, mode: 'insensitive' } },
    ];
  }

  // Legacy JS selected `lowStockThreshold` which doesn't exist on StoreProduct.
  // Cast through unknown to preserve the buggy-but-unreached field reference.
  const include: Prisma.MasterProductInclude = storeId
    ? ({ storeProducts: { where: { storeId }, select: { quantityOnHand: true, lowStockThreshold: true, inStock: true }, take: 1 } } as unknown as Prisma.MasterProductInclude)
    : {};

  const products = await prisma.masterProduct.findMany({
    where, include,
    orderBy: { name: 'asc' },
    take: Math.min(limit * 3, 150),
  });
  type ProdRow = (typeof products)[number] & { storeProducts?: Array<{ quantityOnHand: unknown; lowStockThreshold: unknown; inStock: boolean }> };

  interface InvOut {
    id: number; name: string; upc: string | null; brand: string | null;
    defaultRetailPrice: number;
    quantityOnHand: number | null;
    lowStockThreshold: number | null;
    inStock: boolean | null;
    isLow: boolean | null;
  }

  let mapped: InvOut[] = (products as ProdRow[]).map((p): InvOut => {
    const sp = p.storeProducts?.[0];
    const qoh = sp?.quantityOnHand;
    const threshold = sp?.lowStockThreshold;
    return {
      id: p.id,
      name: p.name,
      upc: p.upc,
      brand: p.brand,
      defaultRetailPrice: Number(p.defaultRetailPrice || 0),
      quantityOnHand: qoh != null ? Number(qoh) : null,
      lowStockThreshold: threshold != null ? Number(threshold) : null,
      inStock: sp?.inStock ?? null,
      isLow: qoh != null && threshold != null
        ? Number(qoh) <= Number(threshold) : null,
    };
  });

  if (lowStockOnly) mapped = mapped.filter((m) => m.isLow === true);
  mapped = mapped.slice(0, limit);

  return {
    storeId: storeId || null,
    count: mapped.length,
    products: mapped,
  };
}

async function toolRecentTransactions(input: ToolInput, orgId: string, storeId: string | null | undefined, req: Request): Promise<ToolOutput> {
  if (!(await userHasPermission(req, 'transactions.view'))) {
    return { error: 'You do not have permission to view transactions.' };
  }

  const limit = clamp(input.limit, 1, 25);
  const status = typeof input.status === 'string' ? input.status : 'complete';

  const where: Prisma.TransactionWhereInput = { orgId };
  if (storeId) where.storeId = storeId;
  if (status !== 'all') where.status = status;

  const txs = await prisma.transaction.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true, txNumber: true, status: true, grandTotal: true, subtotal: true,
      taxTotal: true, cashierId: true, stationId: true, createdAt: true,
      tenderMethod: true, tenderLines: true,
    },
  });
  type TxRow = (typeof txs)[number];

  return {
    count: txs.length,
    transactions: (txs as TxRow[]).map((t) => {
      const tenders: TenderLineLite[] = Array.isArray(t.tenderLines) ? (t.tenderLines as unknown as TenderLineLite[]) : [];
      return {
        id: t.id,
        txNumber: t.txNumber,
        status: t.status,
        grandTotal: Number(t.grandTotal || 0),
        subtotal:   Number(t.subtotal || 0),
        taxTotal:   Number(t.taxTotal || 0),
        tenderMethod: t.tenderMethod || tenders[0]?.method || null,
        stationId: t.stationId,
        createdAt: t.createdAt,
      };
    }),
  };
}

async function toolSearchTransactions(input: ToolInput, orgId: string, storeId: string | null | undefined, req: Request): Promise<ToolOutput> {
  if (!(await userHasPermission(req, 'transactions.view'))) {
    return { error: 'You do not have permission to view transactions.' };
  }

  const limit = clamp(input.limit, 1, 50);
  const dateFrom = typeof input.date_from === 'string' ? input.date_from : null;
  const dateTo = typeof input.date_to === 'string' ? input.date_to : null;
  const from = dateFrom
    ? new Date(dateFrom + 'T00:00:00.000Z')
    : (() => { const d = new Date(); d.setDate(d.getDate() - 7); d.setHours(0, 0, 0, 0); return d; })();
  const to = dateTo
    ? new Date(dateTo + 'T23:59:59.999Z')
    : (() => { const d = new Date(); d.setHours(23, 59, 59, 999); return d; })();

  const where: Prisma.TransactionWhereInput = { orgId, createdAt: { gte: from, lte: to } };
  if (storeId) where.storeId = storeId;
  if (input.min_amount != null || input.max_amount != null) {
    const range: Prisma.DecimalFilter = {};
    if (input.min_amount != null) range.gte = Number(input.min_amount);
    if (input.max_amount != null) range.lte = Number(input.max_amount);
    where.grandTotal = range;
  }
  // Legacy JS filtered on Transaction.tenderMethod which doesn't exist as a
  // scalar (only tenderLines JSON does). Preserve runtime behaviour with cast.
  if (typeof input.tender_method === 'string') (where as Record<string, unknown>).tenderMethod = input.tender_method;

  const txs = await prisma.transaction.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true, txNumber: true, status: true, grandTotal: true,
      tenderMethod: true, createdAt: true,
    },
  });
  type TxRow = (typeof txs)[number];

  return {
    query: {
      from: from.toISOString().slice(0, 10),
      to:   to.toISOString().slice(0, 10),
      ...(input.min_amount != null ? { minAmount: input.min_amount } : {}),
      ...(input.max_amount != null ? { maxAmount: input.max_amount } : {}),
      ...(input.tender_method ? { tenderMethod: input.tender_method } : {}),
    },
    count: txs.length,
    transactions: (txs as TxRow[]).map((t) => ({
      id: t.id,
      txNumber: t.txNumber,
      status: t.status,
      grandTotal: Number(t.grandTotal || 0),
      tenderMethod: t.tenderMethod,
      createdAt: t.createdAt,
    })),
  };
}

/* ── System prompt ───────────────────────────────────────────────────────── */

interface PromptCtx {
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

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function truncateTitle(text: string | null | undefined, max: number = 80): string | null {
  if (!text) return null;
  const s = String(text).replace(/\s+/g, ' ').trim();
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

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

interface ToolCallTraceEntry {
  name: string;
  input: Record<string, unknown>;
  output: ToolOutput;
  durationMs: number;
}

interface RunResult {
  finalText: string;
  toolCallsTrace: ToolCallTraceEntry[];
  totalTokens: number;
  articlesUsed: Array<{ id: string; title: string; score: number }>;
  ticketIdCreated: string | null;
}

async function runToolLoop(conversation: { id: string }, userText: string, req: Request): Promise<RunResult> {
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

/* ── Conversation CRUD ──────────────────────────────────────────────────── */

export const listConversations = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const conversations = await prisma.aiConversation.findMany({
      where: { userId: req.user!.id },
      orderBy: { lastMessageAt: 'desc' },
      take: 30,
      select: {
        id: true, title: true, lastMessageAt: true, createdAt: true,
      },
    });
    res.json({ success: true, conversations });
  } catch (err) { next(err); }
};

export const getConversation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const conv = await prisma.aiConversation.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true, role: true, content: true, feedback: true,
            feedbackNote: true, ticketId: true, createdAt: true,
          },
        },
      },
    });
    if (!conv) { res.status(404).json({ error: 'Conversation not found' }); return; }
    res.json({ success: true, conversation: conv });
  } catch (err) { next(err); }
};

export const createConversation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const conv = await prisma.aiConversation.create({
      data: {
        orgId:    req.orgId || null,
        storeId:  req.storeId || null,
        userId:   req.user!.id,
        userRole: req.role || req.user?.role || null,
        userName: req.user?.name || null,
      },
      select: { id: true, title: true, lastMessageAt: true, createdAt: true },
    });
    res.status(201).json({ success: true, conversation: conv });
  } catch (err) { next(err); }
};

export const sendMessage = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = (req.body || {}) as { content?: string };
    const { content } = body;
    if (!content?.trim()) { res.status(400).json({ error: 'content is required' }); return; }
    if (content.length > 4000) { res.status(400).json({ error: 'Message too long (max 4000 chars)' }); return; }

    const conv = await prisma.aiConversation.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });
    if (!conv) { res.status(404).json({ error: 'Conversation not found' }); return; }

    if (!anthropic) {
      res.status(503).json({
        error: 'AI assistant is not configured on this server. Contact support.',
      });
      return;
    }

    // Save the user message first so it's persisted even if Claude fails.
    const userMsg = await prisma.aiMessage.create({
      data: { conversationId: conv.id, role: 'user', content: content.trim() },
    });

    // Run the tool loop.
    let finalText = '';
    let toolCallsTrace: ToolCallTraceEntry[] = [];
    let totalTokens = 0;
    let ticketIdCreated: string | null = null;
    try {
      const r = await runToolLoop(conv, content.trim(), req);
      finalText = r.finalText;
      toolCallsTrace = r.toolCallsTrace;
      totalTokens = r.totalTokens;
      ticketIdCreated = r.ticketIdCreated;
    } catch (err) {
      console.error('[AiAssistant] tool loop error:', err);

      const msg = String((err as Error)?.message || '').toLowerCase();
      let friendly = 'I ran into an error processing your request. Please try again, or file a support ticket if the problem persists.';
      if (msg.includes('credit balance is too low') || msg.includes('insufficient_credit')) {
        friendly = '⚠ The AI service is temporarily unavailable — the provider account is out of credits. Please notify your StoreVeu administrator; service will resume once credits are topped up.';
      } else if (msg.includes('invalid x-api-key') || msg.includes('invalid api key') || msg.includes('authentication_error')) {
        friendly = '⚠ The AI service is misconfigured (invalid API key). Please contact your StoreVeu administrator.';
      } else if (msg.includes('rate_limit') || msg.includes('rate limit') || msg.includes('too many requests')) {
        friendly = '⚠ The AI service is being rate-limited. Please try again in a minute.';
      } else if (msg.includes('overloaded') || msg.includes('service_unavailable')) {
        friendly = '⚠ Anthropic\'s service is temporarily overloaded. Please try again in a moment.';
      }

      const errorMsg = await prisma.aiMessage.create({
        data: {
          conversationId: conv.id,
          role: 'assistant',
          content: friendly,
          model: MODEL,
        },
      });
      res.json({
        success: false,
        error: (err as Error).message,
        userMessage: userMsg,
        assistantMessage: errorMsg,
      });
      return;
    }

    // Save the assistant response.
    const assistantMsg = await prisma.aiMessage.create({
      data: {
        conversationId: conv.id,
        role: 'assistant',
        content: finalText,
        toolCalls: toolCallsTrace.length ? (toolCallsTrace as unknown as Prisma.InputJsonValue) : PrismaNS.JsonNull,
        tokenCount: totalTokens || null,
        model: MODEL,
        ticketId: ticketIdCreated || null,
      },
    });

    // Update conversation metadata (title + lastMessageAt).
    await prisma.aiConversation.update({
      where: { id: conv.id },
      data: {
        lastMessageAt: new Date(),
        title: conv.title || truncateTitle(content.trim()),
      },
    });

    res.json({
      success: true,
      userMessage: userMsg,
      assistantMessage: assistantMsg,
    });
  } catch (err) { next(err); }
};

export const submitFeedback = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = (req.body || {}) as { feedback?: 'helpful' | 'unhelpful' | null; note?: string };
    const { feedback, note } = body;
    if (!['helpful', 'unhelpful', null].includes(feedback as 'helpful' | 'unhelpful' | null)) {
      res.status(400).json({ error: 'feedback must be "helpful", "unhelpful", or null' });
      return;
    }

    // Ownership check — user must own the conversation this message belongs to.
    const msg = await prisma.aiMessage.findFirst({
      where: {
        id: req.params.id,
        role: 'assistant',
        conversation: { userId: req.user!.id },
      },
      include: {
        conversation: { select: { id: true, orgId: true } },
      },
    });
    if (!msg) { res.status(404).json({ error: 'Message not found' }); return; }

    const noteTrimmed = typeof note === 'string' ? note.trim() : null;
    const updated = await prisma.aiMessage.update({
      where: { id: msg.id },
      data: {
        feedback,
        feedbackNote: feedback === 'unhelpful' ? (noteTrimmed || null) : null,
      },
      select: { id: true, feedback: true, feedbackNote: true },
    });

    // Auto-escalation: if 👎 + note, enqueue an AiFeedbackReview row.
    if (feedback === 'unhelpful' && noteTrimmed) {
      const priorUser = await prisma.aiMessage.findFirst({
        where: {
          conversationId: msg.conversationId,
          role: 'user',
          createdAt: { lt: msg.createdAt },
        },
        orderBy: { createdAt: 'desc' },
        select: { content: true },
      });

      await prisma.aiFeedbackReview.upsert({
        where: { messageId: msg.id },
        create: {
          orgId:          msg.conversation.orgId,
          messageId:      msg.id,
          conversationId: msg.conversationId,
          question:       priorUser?.content || '(no prior user message)',
          aiResponse:     msg.content,
          userSuggestion: noteTrimmed,
          status:         'pending',
        },
        update: {
          userSuggestion: noteTrimmed,
          status: undefined,
        },
      });
    }

    res.json({ success: true, message: updated });
  } catch (err) { next(err); }
};

/**
 * User-initiated escalation — "File a ticket about this conversation".
 * Bundles the last ~10 messages as the ticket body for context.
 */
export const escalateConversation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = (req.body || {}) as { subject?: string; priority?: string };
    const { subject, priority = 'normal' } = body;
    if (!subject?.trim()) { res.status(400).json({ error: 'subject is required' }); return; }

    const conv = await prisma.aiConversation.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });
    if (!conv) { res.status(404).json({ error: 'Conversation not found' }); return; }

    const recent = await prisma.aiMessage.findMany({
      where: { conversationId: conv.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { role: true, content: true, createdAt: true },
    });
    type RecentMsg = (typeof recent)[number];
    const transcript = (recent as RecentMsg[])
      .reverse()
      .map((m) => `[${m.role.toUpperCase()}] ${m.content}`)
      .join('\n\n');

    const ticket = await prisma.supportTicket.create({
      data: {
        email:    req.user!.email,
        name:     req.user!.name,
        subject:  subject.trim().slice(0, 300),
        body:     `Escalated from AI Assistant conversation ${conv.id}.\n\n--- Transcript (last 10 messages) ---\n\n${transcript}`,
        priority: ['low', 'normal', 'high', 'urgent'].includes(priority) ? priority : 'normal',
        orgId:    req.orgId,
        userId:   req.user!.id,
        status:   'open',
        responses: [] as unknown as Prisma.InputJsonValue,
      },
      select: { id: true, subject: true, status: true, priority: true, createdAt: true },
    });

    // Tack a system-style assistant message onto the conversation.
    const note = await prisma.aiMessage.create({
      data: {
        conversationId: conv.id,
        role: 'assistant',
        content: `✓ Support ticket **#${ticket.id.slice(-6)}** filed. The StoreVeu team will respond in **Support & Billing → Support Tickets**.`,
        ticketId: ticket.id,
      },
    });

    res.status(201).json({ success: true, ticket, message: note });
  } catch (err) { next(err); }
};

/* ── Admin review queue (ai_assistant.manage) ────────────────────────────── */

export const listReviews = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const q = req.query as { status?: string };
    const status = q.status || 'pending';
    const where: Prisma.AiFeedbackReviewWhereInput = { status };
    // Scope: admins see their own org's reviews; superadmin sees all.
    if (req.user?.role !== 'superadmin') where.orgId = req.orgId;

    const reviews = await prisma.aiFeedbackReview.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    type ReviewRow = (typeof reviews)[number];

    const articleIds = (reviews as ReviewRow[]).map((r) => r.articleId).filter((x): x is string => !!x);
    const articles = articleIds.length
      ? await prisma.aiKnowledgeArticle.findMany({
          where: { id: { in: articleIds } },
          select: { id: true, title: true },
        })
      : [];
    type ArticleRow = (typeof articles)[number];
    const titleById = Object.fromEntries((articles as ArticleRow[]).map((a) => [a.id, a.title]));

    res.json({
      success: true,
      reviews: (reviews as ReviewRow[]).map((r) => ({
        ...r,
        articleTitle: r.articleId ? (titleById[r.articleId] || null) : null,
      })),
    });
  } catch (err) { next(err); }
};

export const promoteReview = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = (req.body || {}) as { title?: string; content?: string; category?: string; tags?: string[] };
    const { title, content, category = 'how-to', tags = [] } = body;
    if (!title?.trim() || !content?.trim()) {
      res.status(400).json({ error: 'title and content are required' });
      return;
    }

    const review = await prisma.aiFeedbackReview.findUnique({ where: { id: req.params.id } });
    if (!review) { res.status(404).json({ error: 'Review not found' }); return; }
    if (review.status !== 'pending') {
      res.status(400).json({ error: `Review is already ${review.status}` });
      return;
    }

    // Generate embedding for the new article. Fail cleanly if unavailable.
    const { generateEmbedding } = await import('../services/kbService.js');
    const embedding = await generateEmbedding(`${title}\n\n${content}`);
    if (!embedding) {
      res.status(503).json({ error: 'Embedding service unavailable. Cannot promote without an embedding.' });
      return;
    }

    const article = await prisma.aiKnowledgeArticle.create({
      data: {
        orgId:       req.user?.role === 'superadmin' ? null : req.orgId,
        category,
        title:       title.trim(),
        content:     content.trim(),
        embedding,
        source:      'admin',
        tags:        Array.isArray(tags) ? tags : [],
        createdById: req.user!.id,
      },
      select: { id: true, title: true, category: true },
    });

    await prisma.aiFeedbackReview.update({
      where: { id: review.id },
      data:  {
        status:       'promoted',
        reviewedById: req.user!.id,
        reviewedAt:   new Date(),
        articleId:    article.id,
      },
    });

    res.json({ success: true, article });
  } catch (err) { next(err); }
};

export const dismissReview = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const review = await prisma.aiFeedbackReview.findUnique({ where: { id: req.params.id } });
    if (!review) { res.status(404).json({ error: 'Review not found' }); return; }
    if (review.status !== 'pending') {
      res.status(400).json({ error: `Review is already ${review.status}` });
      return;
    }
    await prisma.aiFeedbackReview.update({
      where: { id: review.id },
      data:  { status: 'dismissed', reviewedById: req.user!.id, reviewedAt: new Date() },
    });
    res.json({ success: true });
  } catch (err) { next(err); }
};

/* ── KB article management (ai_assistant.manage) ─────────────────────────── */

export const listKbArticles = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const q = req.query as { category?: string; active?: string; source?: string; search?: string; limit?: string };
    const { category, active, source, search } = q;
    const limit = q.limit || '100';
    const where: Prisma.AiKnowledgeArticleWhereInput = {};
    if (req.user?.role !== 'superadmin') {
      where.OR = [{ orgId: null }, { orgId: req.orgId }];
    }
    if (category) where.category = category;
    if (source)   where.source   = source;
    if (active === 'true')  where.active = true;
    if (active === 'false') where.active = false;
    if (search)   where.OR = [
      { title:   { contains: search, mode: 'insensitive' } },
      { content: { contains: search, mode: 'insensitive' } },
    ];

    const articles = await prisma.aiKnowledgeArticle.findMany({
      where,
      orderBy: [{ active: 'desc' }, { updatedAt: 'desc' }],
      take: clamp(parseInt(limit, 10), 1, 500),
      select: {
        id: true, orgId: true, category: true, title: true, content: true,
        tags: true, source: true, helpfulCount: true, unhelpfulCount: true,
        createdById: true, active: true, createdAt: true, updatedAt: true,
      },
    });
    res.json({ success: true, articles });
  } catch (err) { next(err); }
};

export const getKbArticle = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const article = await prisma.aiKnowledgeArticle.findUnique({
      where: { id: req.params.id },
    });
    if (!article) { res.status(404).json({ error: 'Article not found' }); return; }
    if (article.orgId && article.orgId !== req.orgId && req.user?.role !== 'superadmin') {
      res.status(403).json({ error: 'Cross-tenant access denied' });
      return;
    }
    // Strip embedding from response — huge, not useful to clients.
    const { embedding: _emb, ...rest } = article;
    res.json({ success: true, article: rest });
  } catch (err) { next(err); }
};

export const createKbArticle = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = (req.body || {}) as { title?: string; content?: string; category?: string; tags?: string[]; orgId?: string | null };
    const { title, content, category = 'how-to', tags = [], orgId: orgOverride } = body;
    if (!title?.trim() || !content?.trim()) {
      res.status(400).json({ error: 'title and content are required' });
      return;
    }
    const { generateEmbedding } = await import('../services/kbService.js');
    const embedding = await generateEmbedding(`${title}\n\n${content}`);
    if (!embedding) {
      res.status(503).json({ error: 'Embedding service unavailable. Cannot create article.' });
      return;
    }
    const article = await prisma.aiKnowledgeArticle.create({
      data: {
        orgId: req.user?.role === 'superadmin' ? (orgOverride ?? null) : req.orgId,
        category,
        title:       title.trim().slice(0, 300),
        content:     content.trim(),
        embedding,
        source:      'admin',
        tags:        Array.isArray(tags) ? tags : [],
        createdById: req.user!.id,
      },
      select: { id: true, title: true, category: true, orgId: true },
    });
    res.status(201).json({ success: true, article });
  } catch (err) { next(err); }
};

export const updateKbArticle = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const existing = await prisma.aiKnowledgeArticle.findUnique({ where: { id: req.params.id } });
    if (!existing) { res.status(404).json({ error: 'Article not found' }); return; }
    if (existing.orgId && existing.orgId !== req.orgId && req.user?.role !== 'superadmin') {
      res.status(403).json({ error: 'Cross-tenant access denied' });
      return;
    }

    const body = (req.body || {}) as { title?: string; content?: string; category?: string; tags?: string[]; active?: boolean };
    const { title, content, category, tags, active } = body;
    const data: Prisma.AiKnowledgeArticleUpdateInput = {};
    if (title   !== undefined) data.title   = String(title).trim().slice(0, 300);
    if (content !== undefined) data.content = String(content).trim();
    if (category !== undefined) data.category = category;
    if (Array.isArray(tags))   data.tags = tags;
    if (typeof active === 'boolean') data.active = active;

    // Regenerate embedding if title or content changed.
    if (data.title !== undefined || data.content !== undefined) {
      const { generateEmbedding } = await import('../services/kbService.js');
      const newTitle   = (data.title as string | undefined)   ?? existing.title;
      const newContent = (data.content as string | undefined) ?? existing.content;
      const embedding = await generateEmbedding(`${newTitle}\n\n${newContent}`);
      if (!embedding) {
        res.status(503).json({ error: 'Embedding service unavailable. Cannot update.' });
        return;
      }
      data.embedding = embedding;
    }

    const updated = await prisma.aiKnowledgeArticle.update({
      where: { id: req.params.id },
      data,
      select: { id: true, title: true, category: true, active: true, updatedAt: true },
    });
    res.json({ success: true, article: updated });
  } catch (err) { next(err); }
};

export const deleteKbArticle = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const existing = await prisma.aiKnowledgeArticle.findUnique({ where: { id: req.params.id } });
    if (!existing) { res.status(404).json({ error: 'Article not found' }); return; }
    if (existing.orgId && existing.orgId !== req.orgId && req.user?.role !== 'superadmin') {
      res.status(403).json({ error: 'Cross-tenant access denied' });
      return;
    }
    if (existing.source === 'seed' && req.user?.role !== 'superadmin') {
      res.status(403).json({ error: 'Seed articles can only be hard-deleted by superadmin.' });
      return;
    }
    await prisma.aiKnowledgeArticle.update({
      where: { id: req.params.id },
      data:  { active: false },
    });
    res.json({ success: true });
  } catch (err) { next(err); }
};

/* ── Product tours (public read + admin CRUD) ───────────────────────────── */

export const listPublicTours = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tours = await prisma.productTour.findMany({
      where: {
        active: true,
        OR: [{ orgId: null }, ...(req.orgId ? [{ orgId: req.orgId }] : [])],
      },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      select: {
        id: true, slug: true, name: true, description: true,
        category: true, steps: true,
      },
    });
    type TourRow = (typeof tours)[number];
    res.json({
      success: true,
      tours: (tours as TourRow[]).map((t) => ({
        slug: t.slug, name: t.name, description: t.description,
        category: t.category, stepCount: Array.isArray(t.steps) ? t.steps.length : 0,
      })),
    });
  } catch (err) { next(err); }
};

export const getTourBySlug = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tour = await prisma.productTour.findFirst({
      where: {
        slug: req.params.slug,
        active: true,
        OR: [{ orgId: null }, ...(req.orgId ? [{ orgId: req.orgId }] : [])],
      },
      select: {
        id: true, slug: true, name: true, description: true,
        category: true, steps: true,
      },
    });
    if (!tour) { res.status(404).json({ error: 'Tour not found or inactive' }); return; }
    res.json({ success: true, tour });
  } catch (err) { next(err); }
};

export const listTours = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const q = req.query as { category?: string; active?: string };
    const { category, active } = q;
    const where: Prisma.ProductTourWhereInput = {};
    if (req.user?.role !== 'superadmin') {
      where.OR = [{ orgId: null }, { orgId: req.orgId }];
    }
    if (category) where.category = category;
    if (active === 'true')  where.active = true;
    if (active === 'false') where.active = false;

    const tours = await prisma.productTour.findMany({
      where,
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      select: {
        id: true, orgId: true, slug: true, name: true, description: true,
        category: true, triggers: true, steps: true, active: true,
        createdAt: true, updatedAt: true,
      },
    });
    res.json({ success: true, tours });
  } catch (err) { next(err); }
};

export const getTour = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tour = await prisma.productTour.findUnique({ where: { id: req.params.id } });
    if (!tour) { res.status(404).json({ error: 'Tour not found' }); return; }
    if (tour.orgId && tour.orgId !== req.orgId && req.user?.role !== 'superadmin') {
      res.status(403).json({ error: 'Cross-tenant access denied' });
      return;
    }
    res.json({ success: true, tour });
  } catch (err) { next(err); }
};

interface CreateTourBody {
  slug?: string;
  name?: string;
  description?: string;
  category?: string;
  triggers?: string[];
  steps?: unknown[];
}

export const createTour = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = (req.body || {}) as CreateTourBody;
    const { slug, name, description, category = 'onboarding', triggers = [], steps = [] } = body;
    if (!slug?.trim() || !name?.trim()) {
      res.status(400).json({ error: 'slug and name are required' });
      return;
    }
    if (!Array.isArray(steps) || steps.length === 0) {
      res.status(400).json({ error: 'steps must be a non-empty array' });
      return;
    }

    const tour = await prisma.productTour.create({
      data: {
        orgId:       req.user?.role === 'superadmin' ? null : req.orgId,
        slug:        slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-'),
        name:        name.trim(),
        description: description?.trim() || null,
        category,
        triggers:    Array.isArray(triggers) ? triggers : [],
        steps:       steps as Prisma.InputJsonValue,
        createdById: req.user!.id,
      },
      select: { id: true, slug: true, name: true },
    });
    res.status(201).json({ success: true, tour });
  } catch (err) {
    const e = err as { code?: string };
    if (e.code === 'P2002') { res.status(409).json({ error: 'A tour with this slug already exists.' }); return; }
    next(err);
  }
};

export const updateTour = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const existing = await prisma.productTour.findUnique({ where: { id: req.params.id } });
    if (!existing) { res.status(404).json({ error: 'Tour not found' }); return; }
    if (existing.orgId && existing.orgId !== req.orgId && req.user?.role !== 'superadmin') {
      res.status(403).json({ error: 'Cross-tenant access denied' });
      return;
    }

    const body = (req.body || {}) as Partial<CreateTourBody> & { active?: boolean };
    const { name, description, category, triggers, steps, active } = body;
    const data: Prisma.ProductTourUpdateInput = {};
    if (name        !== undefined) data.name        = String(name).trim();
    if (description !== undefined) data.description = description?.trim() || null;
    if (category    !== undefined) data.category    = category;
    if (Array.isArray(triggers))   data.triggers    = triggers;
    if (Array.isArray(steps))      data.steps       = steps as Prisma.InputJsonValue;
    if (typeof active === 'boolean') data.active    = active;

    const updated = await prisma.productTour.update({
      where: { id: req.params.id },
      data,
      select: { id: true, slug: true, name: true, active: true, updatedAt: true },
    });
    res.json({ success: true, tour: updated });
  } catch (err) { next(err); }
};

export const deleteTour = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const existing = await prisma.productTour.findUnique({ where: { id: req.params.id } });
    if (!existing) { res.status(404).json({ error: 'Tour not found' }); return; }
    if (existing.orgId && existing.orgId !== req.orgId && req.user?.role !== 'superadmin') {
      res.status(403).json({ error: 'Cross-tenant access denied' });
      return;
    }
    await prisma.productTour.update({
      where: { id: req.params.id },
      data:  { active: false },
    });
    res.json({ success: true });
  } catch (err) { next(err); }
};

export const getReviewConversation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const review = await prisma.aiFeedbackReview.findUnique({ where: { id: req.params.id } });
    if (!review) { res.status(404).json({ error: 'Review not found' }); return; }
    if (req.user?.role !== 'superadmin' && review.orgId !== req.orgId) {
      res.status(403).json({ error: 'Cross-tenant access denied' });
      return;
    }
    if (!review.conversationId) {
      res.json({ success: true, messages: [] });
      return;
    }
    const messages = await prisma.aiMessage.findMany({
      where: { conversationId: review.conversationId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, role: true, content: true, feedback: true, createdAt: true },
    });
    res.json({ success: true, review, messages });
  } catch (err) { next(err); }
};

export const deleteConversation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await prisma.aiConversation.deleteMany({
      where: { id: req.params.id, userId: req.user!.id },
    });
    if (result.count === 0) { res.status(404).json({ error: 'Conversation not found' }); return; }
    res.json({ success: true });
  } catch (err) { next(err); }
};
