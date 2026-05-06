/**
 * AI Assistant tools — Anthropic tool_use schema + per-tool implementations.
 * Split from `aiAssistantController.ts` (S80, refactor pass D, S53 pattern).
 *
 * Architecture:
 *   - `TOOL_DEFINITIONS` — schema array sent to Claude (name + description + input_schema)
 *   - `execTool(name, input, req)` — dispatcher that routes a tool_use block to the
 *     matching impl, after re-checking the caller's RBAC permission.
 *   - Each `tool*` function — pure data-fetcher, RBAC-guarded, never trusts client
 *     for orgId/storeId — those always come from `req` (JWT + active store header).
 *
 * Public exports: `TOOL_DEFINITIONS`, `execTool`, types.
 * Tool impls are module-private — runner.ts only invokes them via the dispatcher.
 */

import type { Request } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../../config/postgres.js';
import { userHasPermission } from '../../rbac/permissionService.js';
import { getNDaysWindow, formatLocalDate, getStoreTimezone, addDays } from '../../utils/dateTz.js';

/* ── Tool definitions (Anthropic tool_use schema) ────────────────────────── */

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
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

export type ToolInput = Record<string, unknown>;
export type ToolOutput = Record<string, unknown>;

const clamp = (n: unknown, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Number(n) || lo));

export async function execTool(name: string, input: ToolInput, req: Request): Promise<ToolOutput> {
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
  // Tz-aware window: covers the last N store-local days. Without this,
  // a store on PT shows "today" starting at 00:00 server-time which is
  // 17:00 PT the previous day — mis-attributed sales.
  const w = await getNDaysWindow(days, storeId, prisma);
  const { from, to } = w;

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
    period: { from: w.fromStr, to: w.toStr, days, timezone: w.tz },
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
  const w = await getNDaysWindow(days, storeId, prisma);
  const { from, to } = w;

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
    period:         { from: w.fromStr, to: w.toStr, days, timezone: w.tz },
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
  const w = await getNDaysWindow(days, storeId, prisma);
  const { from, to } = w;

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
    period: { from: w.fromStr, to: w.toStr, days, timezone: w.tz },
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
  // Resolve store tz first so a "today" default uses the store's local day.
  const tz = await getStoreTimezone(storeId, prisma);
  const dateStr = (input.date as string | undefined) || formatLocalDate(new Date(), tz);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return { error: 'Invalid date format. Use YYYY-MM-DD.' };
  // Tz-aware day window — handles DST correctly (no missed/extra hour).
  const { localDayStartUTC, localDayEndUTC } = await import('../../utils/dateTz.js');
  const from = localDayStartUTC(dateStr, tz);
  const to   = localDayEndUTC(dateStr, tz);

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

  // Pull 90 days of history — windowed in store-local time so partial-day
  // edges don't smear across two calendar days.
  const w = await getNDaysWindow(91, storeId, prisma);
  const where: Prisma.TransactionWhereInput = { orgId, createdAt: { gte: w.from, lte: w.to }, status: { in: ['complete', 'refund'] } };
  if (storeId) where.storeId = storeId;

  const txs = await prisma.transaction.findMany({
    where,
    select: { grandTotal: true, status: true, createdAt: true },
    take: 50000,
  });

  // Build daily totals — bucket by STORE-LOCAL date (not UTC) so each
  // bucket aligns with the store's business day.
  const byDay = new Map<string, number>();
  for (const t of txs) {
    const key = formatLocalDate(new Date(t.createdAt), w.tz);
    const v = Number(t.grandTotal || 0) * (t.status === 'refund' ? -1 : 1);
    byDay.set(key, (byDay.get(key) || 0) + v);
  }

  if (byDay.size < 14) {
    return { note: 'Not enough history to forecast (need at least 14 days of sales).', historicalDays: byDay.size };
  }

  // Use the existing predictions util if available; fallback to simple moving avg.
  try {
    const predictionsModule = await import('../../utils/predictions.js') as unknown as {
      runHoltWinters?: (values: number[], horizon: number, period: number) => number[];
    };
    const runHoltWinters = predictionsModule.runHoltWinters;
    if (!runHoltWinters) throw new Error('runHoltWinters unavailable');
    const series = [...byDay.entries()].sort().map(([d, v]) => ({ date: d, value: v }));
    const forecast = runHoltWinters(series.map((s) => s.value), daysAhead, 7);
    const days: Array<{ date: string; predicted: number }> = [];
    for (let i = 1; i <= daysAhead; i++) {
      // Forecast date = today_local + i (date-string arithmetic, tz-safe + DST-safe)
      days.push({ date: addDays(w.toStr, i), predicted: Number((forecast[i - 1] || 0).toFixed(2)) });
    }
    const total = days.reduce((sum, d) => sum + d.predicted, 0);
    return {
      forecast:        days,
      totalForecasted: Number(total.toFixed(2)),
      basedOnDays:     series.length,
      timezone:        w.tz,
      note: 'Holt-Winters forecast with 7-day seasonality. Doesn\'t account for promotions or one-off events.',
    };
  } catch {
    // Simple fallback: average of last 14 days of data.
    const recent = [...byDay.values()].slice(-14);
    const avg = recent.reduce((s, v) => s + v, 0) / recent.length;
    const days: Array<{ date: string; predicted: number }> = [];
    for (let i = 1; i <= daysAhead; i++) {
      days.push({ date: addDays(w.toStr, i), predicted: Number(avg.toFixed(2)) });
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
    const engine = await import('../../services/orderEngine.js') as unknown as {
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
  const w = await getNDaysWindow(days, storeId, prisma);
  const { from, to } = w;

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
    period: { from: w.fromStr, to: w.toStr, days, timezone: w.tz },
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
  // Tz-aware bookends so explicit YYYY-MM-DD inputs and the "last 7 days"
  // default both align with the store's local calendar.
  const tz = await getStoreTimezone(storeId, prisma);
  const { localDayStartUTC, localDayEndUTC } = await import('../../utils/dateTz.js');
  const todayLocal = formatLocalDate(new Date(), tz);
  const fromStr = dateFrom && /^\d{4}-\d{2}-\d{2}$/.test(dateFrom) ? dateFrom : addDays(todayLocal, -7);
  const toStr   = dateTo   && /^\d{4}-\d{2}-\d{2}$/.test(dateTo)   ? dateTo   : todayLocal;
  const from = localDayStartUTC(fromStr, tz);
  const to   = localDayEndUTC(toStr, tz);

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
      from: fromStr,
      to:   toStr,
      timezone: tz,
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
