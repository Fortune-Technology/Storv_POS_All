/**
 * syntheticDataScheduler.ts
 *
 * Daily synthetic-transaction generator for analytics/reporting demos.
 *
 * Why: store owners + admins need meaningful charts and KPIs in test envs
 * without a live POS feeding the database. This scheduler creates a
 * realistic cluster of transactions every day so Live Dashboard / Reports /
 * End-of-Day surfaces all show non-zero numbers.
 *
 * Behaviour (per org, per day):
 *   • Daily total falls in [SYNTHETIC_TARGET_LOW, SYNTHETIC_TARGET_HIGH]
 *     (defaults: $4,000 — $6,000)
 *   • Distributed across SYNTHETIC_TX_LOW..HIGH transactions (default 40-80)
 *     so reports see "many small orders" not one bulk dump
 *   • Each transaction picks a random store, cashier, customer (~25% of txs)
 *     and 1-5 line items from the org's product catalog
 *   • Timestamps are spread across 06:00 → 22:00 UTC of the current day so
 *     hourly charts look natural
 *
 * Idempotency: every synthetic txNumber starts with `SYN-YYYY-MM-DD-` —
 * a `findFirst({ startsWith })` check skips orgs that already have today's
 * data. Safe to re-fire after server restart.
 *
 * Gating:
 *   • Disabled by default. Set ENABLE_SYNTHETIC_DATA=true to turn on
 *     (intentional opt-in — never want this firing in real production data).
 *   • Skips orgs with slug='system' (platform org).
 *   • Waits until SYNTHETIC_DATA_HOUR_UTC (default 6 = 06:00 UTC) before
 *     firing each day so timestamps make sense.
 *
 * Cadence: 1-hour sweep. Idempotency check makes the actual generation
 * happen at most once per (org, UTC day).
 */

import type { Prisma } from '@prisma/client';
import prisma from '../config/postgres.js';

const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

const TARGET_LOW  = Number(process.env.SYNTHETIC_TARGET_LOW  ?? 4000);
const TARGET_HIGH = Number(process.env.SYNTHETIC_TARGET_HIGH ?? 6000);
const TX_LOW      = Number(process.env.SYNTHETIC_TX_LOW      ?? 40);
const TX_HIGH     = Number(process.env.SYNTHETIC_TX_HIGH     ?? 80);
const TARGET_HOUR_UTC = Number(process.env.SYNTHETIC_DATA_HOUR_UTC ?? 6);
const ENABLED = process.env.ENABLE_SYNTHETIC_DATA === 'true';

/**
 * Production safety gate: when running on real merchant data, only seed
 * the explicit sandbox store ("Jaivik Store" at "Gulmahor"). Local/dev
 * keeps the broad behaviour (every active org's first store).
 *
 * Override the production target via env if the sandbox store ever moves:
 *   SYNTHETIC_PROD_STORE_NAME=Jaivik Store
 *   SYNTHETIC_PROD_STORE_ADDRESS=Gulmahor   (matched as a substring, case-insensitive)
 */
const IS_PROD                = process.env.NODE_ENV === 'production';
const PROD_STORE_NAME         = (process.env.SYNTHETIC_PROD_STORE_NAME    ?? 'Jaivik Store').trim();
const PROD_STORE_ADDRESS_FRAG = (process.env.SYNTHETIC_PROD_STORE_ADDRESS ?? 'Gulmahor').trim().toLowerCase();

const pick = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
const rand = (lo: number, hi: number): number => Math.floor(Math.random() * (hi - lo + 1)) + lo;
const round2 = (n: number): number => Math.round(n * 100) / 100;

interface ProductRow {
  id: string;
  name: string;
  upc: string | null;
  defaultRetailPrice: Prisma.Decimal;
  defaultCostPrice: Prisma.Decimal | null;
  taxClass: string | null;
  departmentId: number | null;
  ebtEligible: boolean;
}

interface StoreRow { id: string; name: string }
interface CashierRow { id: string; name: string | null }
interface CustomerRow { id: string; name: string | null; firstName: string | null; lastName: string | null }

function todayDateString(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function customerLabel(c: CustomerRow): string {
  if (c.name) return c.name;
  const fn = (c.firstName || '').trim();
  const ln = (c.lastName  || '').trim();
  return [fn, ln].filter(Boolean).join(' ') || 'Member';
}

interface OrgGenResult { txCount: number; total: number; skipped?: 'no-stores' | 'no-products' | 'no-cashiers' | 'already-done' | 'not-prod-target' }

/**
 * @param orgId       The org to scope queries to.
 * @param dateStr     YYYY-MM-DD UTC date string used in `SYN-` txNumber prefix.
 * @param storeFilter Optional filter applied to the store lookup. Used in
 *                    production to constrain seeding to ONE specific store
 *                    (Jaivik Store / Gulmahor) so we never pollute real
 *                    merchant data.
 */
async function generateForOrg(
  orgId: string,
  dateStr: string,
  storeFilter?: { name?: string; addressContains?: string },
): Promise<OrgGenResult> {
  const todayPrefix = `SYN-${dateStr}-`;

  // Idempotency — already seeded today?
  const existing = await prisma.transaction.findFirst({
    where:  { orgId, txNumber: { startsWith: todayPrefix } },
    select: { id: true },
  });
  if (existing) return { txCount: 0, total: 0, skipped: 'already-done' };

  const storesWhere: Prisma.StoreWhereInput = { orgId, isActive: true };
  if (storeFilter?.name) {
    storesWhere.name = { equals: storeFilter.name, mode: 'insensitive' };
  }
  if (storeFilter?.addressContains) {
    storesWhere.address = { contains: storeFilter.addressContains, mode: 'insensitive' };
  }

  const [stores, products, cashiers, customers] = await Promise.all([
    prisma.store.findMany({
      where:  storesWhere,
      select: { id: true, name: true },
    }) as Promise<StoreRow[]>,
    prisma.masterProduct.findMany({
      where: { orgId, active: true, deleted: false, defaultRetailPrice: { gt: 0 } },
      take:  300,
      select: {
        id: true, name: true, upc: true, defaultRetailPrice: true, defaultCostPrice: true,
        taxClass: true, departmentId: true, ebtEligible: true,
      },
    }) as Promise<ProductRow[]>,
    prisma.user.findMany({
      where:  { orgId, status: 'active' },
      select: { id: true, name: true },
    }) as Promise<CashierRow[]>,
    prisma.customer.findMany({
      where:  { orgId, deleted: false },
      take:   200,
      select: { id: true, name: true, firstName: true, lastName: true },
    }) as Promise<CustomerRow[]>,
  ]);

  if (!stores.length)   return { txCount: 0, total: 0, skipped: 'no-stores' };
  if (!products.length) return { txCount: 0, total: 0, skipped: 'no-products' };
  if (!cashiers.length) return { txCount: 0, total: 0, skipped: 'no-cashiers' };

  const targetTotal = rand(TARGET_LOW, TARGET_HIGH);
  const targetCount = rand(TX_LOW, TX_HIGH);

  // Daytime envelope so timestamps cluster realistically (06:00 → 22:00 UTC)
  const now      = new Date();
  const dayStart = new Date(now); dayStart.setUTCHours(6, 0, 0, 0);
  const dayEnd   = new Date(now); dayEnd.setUTCHours(22, 0, 0, 0);
  // If the scheduler fires before 22:00 UTC, cap the upper bound at "now"
  // so we don't seed transactions that pretend to have happened in the future.
  const cap      = Math.min(dayEnd.getTime(), now.getTime());

  const stamp = Date.now().toString(36).slice(-4);
  const data: Prisma.TransactionCreateManyInput[] = [];
  let runningTotal = 0;

  for (let i = 0; i < targetCount; i++) {
    if (runningTotal >= targetTotal) break;

    const remaining   = targetTotal - runningTotal;
    const remainingTx = Math.max(1, targetCount - i);
    const targetPerTx = remaining / remainingTx;

    // Build 1-5 line items sized to roughly hit targetPerTx. Pick a target
    // line count first, then scale qty so the basket trends toward the per-tx
    // average without artificial caps that dragged the daily total under
    // the band on low-price catalogs.
    const maxLines = rand(1, 5);
    const lineItems: Array<Record<string, unknown>> = [];
    let subtotal = 0, taxTotal = 0;
    for (let k = 0; k < maxLines; k++) {
      const p = pick(products);
      const unit = Number(p.defaultRetailPrice);
      // Per-line dollar slot toward the per-tx target, with jitter so basket
      // sizes vary realistically.
      const slot = (targetPerTx / maxLines) * (0.6 + Math.random() * 0.8);
      // Resolve qty: aim for the dollar slot but keep within sensible bounds.
      const qty = Math.max(1, Math.min(20, Math.round(slot / Math.max(unit, 1))));
      const line = qty * unit;
      const taxable = p.taxClass !== 'grocery';
      const tax = taxable ? line * 0.055 : 0;
      subtotal += line;
      taxTotal += tax;
      lineItems.push({
        productId:    p.id,
        name:         p.name,
        upc:          p.upc,
        qty,
        unitPrice:    unit,
        lineTotal:    round2(line),
        taxable,
        taxAmount:    round2(tax),
        costPrice:    p.defaultCostPrice ? Number(p.defaultCostPrice) : null,
        departmentId: p.departmentId,
        ebtEligible:  p.ebtEligible,
      });
    }

    const grand = subtotal + taxTotal;
    runningTotal += grand;

    const store    = pick(stores);
    const cashier  = pick(cashiers);
    // Roughly 25% of transactions get an attributed customer — matches typical
    // loyalty-attach rates at independent stores. Stashed in `notes` since
    // the Transaction model has no customerId column (loyalty side-effects
    // happen via a separate path).
    const useCustomer = customers.length > 0 && Math.random() < 0.25;
    const customer    = useCustomer ? pick(customers) : null;

    const tenderMethod = pick(['cash', 'cash', 'card', 'card', 'card']);
    const tendered     = tenderMethod === 'cash' ? Math.ceil(grand + rand(0, 5)) : grand;
    const when         = new Date(dayStart.getTime() + Math.random() * (cap - dayStart.getTime()));

    data.push({
      orgId,
      storeId:      store.id,
      cashierId:    cashier.id,
      txNumber:     `${todayPrefix}${stamp}-${String(i).padStart(4, '0')}`,
      lineItems:    lineItems as Prisma.InputJsonValue,
      subtotal:     round2(subtotal),
      taxTotal:     round2(taxTotal),
      depositTotal: 0,
      ebtTotal:     0,
      grandTotal:   round2(grand),
      tenderLines:  [{ method: tenderMethod, amount: round2(tendered) }] as Prisma.InputJsonValue,
      changeGiven:  round2(Math.max(0, tendered - grand)),
      status:       'complete',
      notes:        customer ? `Loyalty: ${customerLabel(customer)} (${customer.id.slice(0, 8)})` : null,
      createdAt:    when,
      updatedAt:    when,
    });
  }

  // Top-up pass — if we still undershot targetTotal (e.g. low-price catalog),
  // append single-line filler transactions sized to close the gap quickly.
  // Safety cap at +200 extra txs to avoid runaway on pathological catalogs.
  let safety = 200;
  while (runningTotal < targetTotal && safety-- > 0) {
    const gap = targetTotal - runningTotal;
    // Aim each filler tx at $50-150 (or the remaining gap, whichever is smaller)
    // so we converge on the floor in a realistic number of extra orders.
    const fillerTarget = Math.min(gap, rand(50, 150));
    const p = pick(products);
    const unit = Number(p.defaultRetailPrice);
    const qty = Math.max(1, Math.min(20, Math.round(fillerTarget / Math.max(unit, 1))));
    const line = qty * unit;
    const taxable = p.taxClass !== 'grocery';
    const tax = taxable ? line * 0.055 : 0;
    const grand = line + tax;
    runningTotal += grand;

    const store    = pick(stores);
    const cashier  = pick(cashiers);
    const useCustomer = customers.length > 0 && Math.random() < 0.25;
    const customer    = useCustomer ? pick(customers) : null;
    const tenderMethod = pick(['cash', 'cash', 'card', 'card', 'card']);
    const tendered     = tenderMethod === 'cash' ? Math.ceil(grand + rand(0, 5)) : grand;
    const when         = new Date(dayStart.getTime() + Math.random() * (cap - dayStart.getTime()));
    const i            = data.length;

    data.push({
      orgId,
      storeId:      store.id,
      cashierId:    cashier.id,
      txNumber:     `${todayPrefix}${stamp}-${String(i).padStart(4, '0')}`,
      lineItems:    [{
        productId: p.id, name: p.name, upc: p.upc, qty, unitPrice: unit,
        lineTotal: round2(line), taxable, taxAmount: round2(tax),
        costPrice: p.defaultCostPrice ? Number(p.defaultCostPrice) : null,
        departmentId: p.departmentId, ebtEligible: p.ebtEligible,
      }] as Prisma.InputJsonValue,
      subtotal:     round2(line),
      taxTotal:     round2(tax),
      depositTotal: 0,
      ebtTotal:     0,
      grandTotal:   round2(grand),
      tenderLines:  [{ method: tenderMethod, amount: round2(tendered) }] as Prisma.InputJsonValue,
      changeGiven:  round2(Math.max(0, tendered - grand)),
      status:       'complete',
      notes:        customer ? `Loyalty: ${customerLabel(customer)} (${customer.id.slice(0, 8)})` : null,
      createdAt:    when,
      updatedAt:    when,
    });
  }

  if (!data.length) return { txCount: 0, total: 0 };
  await prisma.transaction.createMany({ data });
  return { txCount: data.length, total: round2(runningTotal) };
}

export async function runSyntheticSweep(): Promise<void> {
  if (!ENABLED) return;

  const now = new Date();
  if (now.getUTCHours() < TARGET_HOUR_UTC) return; // wait until target hour each UTC day

  const dateStr = todayDateString();

  // ── Production safety gate ───────────────────────────────────────────────
  // In production, refuse to seed across every org. Resolve the single
  // explicit sandbox store (Jaivik Store @ Gulmahor) and only seed THAT
  // one — everything else stays untouched. The store lookup is anchored
  // to an exact name match + a substring address match so a renamed real
  // store could never accidentally match.
  if (IS_PROD) {
    const sandboxStore = await prisma.store.findFirst({
      where: {
        isActive: true,
        name:     { equals: PROD_STORE_NAME, mode: 'insensitive' },
        address:  { contains: PROD_STORE_ADDRESS_FRAG, mode: 'insensitive' },
      },
      select: { id: true, name: true, orgId: true, address: true },
    });
    if (!sandboxStore) {
      console.warn(
        `[SyntheticData] PROD sandbox store not found `
        + `(name="${PROD_STORE_NAME}", address contains "${PROD_STORE_ADDRESS_FRAG}") — skipping sweep.`,
      );
      return;
    }
    try {
      const result = await generateForOrg(sandboxStore.orgId, dateStr, {
        name:            PROD_STORE_NAME,
        addressContains: PROD_STORE_ADDRESS_FRAG,
      });
      if (result.skipped === 'already-done') return;
      if (result.skipped) {
        console.log(`[SyntheticData][PROD] sandbox store ${sandboxStore.name} skipped (${result.skipped})`);
        return;
      }
      if (result.txCount > 0) {
        console.log(
          `[SyntheticData][PROD] sandbox=${sandboxStore.name} (store=${sandboxStore.id}) — `
          + `generated ${result.txCount} txs totaling $${result.total.toFixed(2)} for ${dateStr}`,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[SyntheticData][PROD] failed for sandbox store ${sandboxStore.id}:`, message);
    }
    return; // PROD path always exits here — never falls through to the broad loop
  }

  // ── Dev / local — broad sweep across every active org ────────────────────
  const orgs = await prisma.organization.findMany({
    where:  { isActive: true, slug: { not: 'system' } },
    select: { id: true, name: true },
  });
  if (!orgs.length) return;

  for (const org of orgs) {
    try {
      const result = await generateForOrg(org.id, dateStr);
      if (result.skipped === 'already-done') continue;
      if (result.skipped) {
        console.log(`[SyntheticData] org=${org.name} skipped (${result.skipped})`);
        continue;
      }
      if (result.txCount > 0) {
        console.log(
          `[SyntheticData] org=${org.name} (${org.id}) — generated ${result.txCount} txs `
          + `totaling $${result.total.toFixed(2)} for ${dateStr}`,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[SyntheticData] failed for org ${org.id}:`, message);
    }
  }
}

export function startSyntheticDataScheduler(): void {
  if (!ENABLED) {
    console.log('  • Synthetic data scheduler: DISABLED (set ENABLE_SYNTHETIC_DATA=true to enable)');
    return;
  }
  if (IS_PROD) {
    console.log(
      `✓ Synthetic data scheduler started — PROD MODE: scoped to "${PROD_STORE_NAME}" `
      + `(address contains "${PROD_STORE_ADDRESS_FRAG}") only. `
      + `Target $${TARGET_LOW}-$${TARGET_HIGH}/day, ${TX_LOW}-${TX_HIGH} txs, `
      + `fires after ${TARGET_HOUR_UTC}:00 UTC, idempotent per UTC day.`,
    );
  } else {
    console.log(
      `✓ Synthetic data scheduler started — DEV MODE: every active org. `
      + `Target $${TARGET_LOW}-$${TARGET_HIGH}/org/day, ${TX_LOW}-${TX_HIGH} txs, `
      + `fires after ${TARGET_HOUR_UTC}:00 UTC, idempotent per UTC day.`,
    );
  }
  const onError = (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[SyntheticData] sweep error:', message);
  };
  // Initial sweep ~30s after boot so we don't slow startup. Hourly thereafter.
  setTimeout(() => { runSyntheticSweep().catch(onError); }, 30 * 1000);
  setInterval(() => { runSyntheticSweep().catch(onError); }, SWEEP_INTERVAL_MS);
}
