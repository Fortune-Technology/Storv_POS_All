// @ts-nocheck — Same pattern as other seed files. Prisma types are dynamic
// after `db push`; tsc's strictness pegs unresolved generic params here as
// implicit-any. The runtime is correct and verified by smoke tests.
/**
 * Plan Modules Seeder — S80 Phase 3 (grouped architecture)
 *
 * Replaces the legacy S78 3-plan structure. Idempotent and safe to re-run.
 *
 * Architecture (grouped):
 *   • CORE modules               — always granted, never overridable
 *   • BASE modules               — included in every plan (Starter + Pro)
 *   • BUSINESS modules (12)      — addon-gated parent toggles users see in
 *                                  StoreSettings → "Store Feature Modules".
 *                                  Some are sidebar items themselves; others
 *                                  are pure parents (e.g. ecommerce, ai_assistant).
 *   • CHILD sidebar items        — sidebar items grouped under a business
 *                                  module via parentKey. They auto-hide
 *                                  when the parent business module is off.
 *
 * Plans:
 *   1. Starter ($39/mo, isDefault) — CORE + BASE only. Add-ons buy business modules.
 *   2. Pro     ($129/mo)           — Everything. All 12 business modules included.
 *
 * Add-ons (12, on Starter only — Pro includes them all by default):
 *   Each addon's moduleKeys[] points to ONE business module key. The resolver
 *   cascades to children automatically via parentKey.
 *
 * Migration:
 *   Every existing active store gets a Pro StoreSubscription so existing
 *   customers see ZERO behavior change.
 *
 * Run: npx tsx prisma/seedPlanModules.ts
 */
import prisma from '../src/config/postgres.js';
import { computeBundlePlanPricing } from '../src/utils/planPricing.js';

// ─────────────────────────────────────────────────
// MODULE CATALOG
// ─────────────────────────────────────────────────
interface ModuleSpec {
  key: string;
  name: string;
  category: string;
  routePaths: string[];
  description?: string;
  icon?: string;
  isCore?: boolean;
  isBusinessModule?: boolean;
  parentKey?: string;
  sortOrder?: number;
}

const MODULES: ModuleSpec[] = [
  // ════════════════════════════════════════════════════════════════════
  // CORE — always granted, never overridable
  // ════════════════════════════════════════════════════════════════════
  { key: 'live_dashboard',  name: 'Live Dashboard',  category: 'Operations', icon: 'Radio',         routePaths: ['/portal/realtime'],          isCore: true,  sortOrder: 10, description: 'Real-time KPIs, sales, top products.' },
  { key: 'chat',            name: 'Chat',            category: 'Operations', icon: 'MessageSquare', routePaths: ['/portal/chat'],              isCore: true,  sortOrder: 20, description: 'Internal team + customer support chat.' },
  { key: 'support_tickets', name: 'Support Tickets', category: 'Support & Billing', icon: 'MessageSquare', routePaths: ['/portal/support-tickets'], isCore: true, sortOrder: 1000, description: 'Submit + track support tickets.' },
  { key: 'billing',         name: 'Billing & Plan',  category: 'Support & Billing', icon: 'CreditCard',     routePaths: ['/portal/billing'], isCore: true, sortOrder: 1010, description: 'Subscription, invoices, payment method.' },
  { key: 'account',         name: 'Account Settings', category: 'Account', icon: 'Building2', routePaths: ['/portal/account', '/portal/my-profile', '/portal/branding'], isCore: true, sortOrder: 1100, description: 'Org / users / stores / store branding / personal profile.' },
  { key: 'roles',           name: 'Roles & Permissions', category: 'Account', icon: 'Shield', routePaths: ['/portal/roles'], isCore: true, sortOrder: 1110, description: 'Custom RBAC roles.' },
  { key: 'invitations',     name: 'Invitations', category: 'Account', icon: 'Mail', routePaths: ['/portal/invitations'], isCore: true, sortOrder: 1120, description: 'Invite teammates to your org.' },

  // ════════════════════════════════════════════════════════════════════
  // BASE — included in every plan, never gated by addon (always available)
  // ════════════════════════════════════════════════════════════════════
  { key: 'tasks',           name: 'Tasks',           category: 'Operations', icon: 'CheckSquare',   routePaths: ['/portal/tasks'],             sortOrder: 30, description: 'Assignable to-do items across the team.' },
  { key: 'customers',       name: 'Customers',       category: 'Customers',  icon: 'Users',         routePaths: ['/portal/customers-hub'],     sortOrder: 100, description: 'Customer profiles, charge accounts, history.' },
  { key: 'products',        name: 'Products',        category: 'Catalog',    icon: 'Package',       routePaths: ['/portal/catalog', '/portal/catalog/edit/:id', '/portal/catalog/new'], sortOrder: 300, description: 'Product catalog with pricing, UPCs, pack sizes.' },
  { key: 'product_groups',  name: 'Product Groups',  category: 'Catalog',    icon: 'Users',         routePaths: ['/portal/product-groups'],    sortOrder: 310, description: 'Group products to share defaults + cascading promotions.' },
  { key: 'departments',     name: 'Departments',     category: 'Catalog',    icon: 'Layers',        routePaths: ['/portal/departments'],       sortOrder: 320, description: 'Departments + per-department defaults.' },
  { key: 'promotions',      name: 'Promotions',      category: 'Catalog',    icon: 'Tag',           routePaths: ['/portal/promotions'],        sortOrder: 330, description: 'BOGO, volume, mix-and-match deals.' },
  { key: 'inventory_count', name: 'Inventory Count', category: 'Inventory',  icon: 'BarChart2',     routePaths: ['/portal/inventory-count'],   sortOrder: 400, description: 'Quick counts, adjustments, shrinkage, stock levels.' },
  { key: 'expiry_tracker',  name: 'Expiry Tracker',  category: 'Inventory',  icon: 'Calendar',      routePaths: ['/portal/expiry-tracker'],    sortOrder: 410, description: 'Per-store expiry tracking with status buckets.' },
  { key: 'label_queue',     name: 'Label Queue',     category: 'Inventory',  icon: 'Tag',           routePaths: ['/portal/label-queue'],       sortOrder: 420, description: 'Auto-detected + manual shelf-label print queue.' },
  { key: 'vendors',         name: 'Vendors',         category: 'Vendors',    icon: 'Truck',         routePaths: ['/portal/vendors', '/portal/vendors/:id'], sortOrder: 500, description: 'Vendor catalog + per-vendor pricing/terms.' },
  { key: 'vendor_payouts',  name: 'Vendor Payouts',  category: 'Vendors',    icon: 'ArrowUpCircle', routePaths: ['/portal/vendor-payouts'],    sortOrder: 510, description: 'Back-office vendor payment + credit tracking.' },
  { key: 'csv_transform',   name: 'CSV Transform',   category: 'Vendors',    icon: 'Upload',        routePaths: ['/csv/upload', '/csv/preview', '/csv/history'], sortOrder: 540, description: 'CSV → POS-ready transform pipeline.' },
  { key: 'transactions',    name: 'Transactions',    category: 'Reports & Analytics', icon: 'Receipt', routePaths: ['/portal/pos-reports'], sortOrder: 600, description: 'Transaction browser + receipt + payouts + balancing.' },
  { key: 'analytics',       name: 'Analytics',       category: 'Reports & Analytics', icon: 'BarChart2', routePaths: ['/portal/analytics'], sortOrder: 610, description: 'Sales, departments, products, period compare.' },
  { key: 'employees',       name: 'Employees',       category: 'Reports & Analytics', icon: 'Users',     routePaths: ['/portal/employees'], sortOrder: 620, description: 'Roster, timesheets, shifts.' },
  { key: 'daily_reports',   name: 'Daily Reports',   category: 'Reports & Analytics', icon: 'FileText',  routePaths: ['/portal/daily-reports'], sortOrder: 630, description: 'End of Day, Daily Sale, Dual Pricing.' },
  { key: 'audit_log',       name: 'Audit Log',       category: 'Reports & Analytics', icon: 'Shield',    routePaths: ['/portal/audit'], sortOrder: 640, description: 'Org-wide audit trail.' },
  { key: 'pos_config',      name: 'POS Configuration', category: 'POS', icon: 'Monitor', routePaths: ['/portal/pos-config'], sortOrder: 900, description: 'Layout, receipts, label design.' },
  { key: 'quick_buttons',   name: 'Quick Buttons',   category: 'POS', icon: 'Layout',   routePaths: ['/portal/quick-buttons'], sortOrder: 910, description: 'Drag-and-drop POS home-screen builder.' },
  { key: 'rules_fees',      name: 'Rules & Fees',    category: 'POS', icon: 'Recycle', routePaths: ['/portal/rules'], sortOrder: 920, description: 'Bottle deposit + tax rules.' },

  // ════════════════════════════════════════════════════════════════════
  // BUSINESS MODULES (12) — addon-gated, toggleable per store.
  // Some have own sidebar (lottery, fuel, exchange, scan_data, vendor_orders).
  // Others are pure parents (ecommerce, marketplace_integration, invoice_ocr,
  // ai_assistant, predictions, loyalty, multi_store_dashboard).
  // ════════════════════════════════════════════════════════════════════
  // 1. Lottery — own sidebar
  { key: 'lottery',         name: 'Lottery',         category: 'Business Modules', icon: 'Ticket',
    routePaths: ['/portal/lottery'],  isBusinessModule: true, sortOrder: 200,
    description: 'Scratch ticket sales, daily inventory + book scanning, end-of-shift reconciliation, weekly settlement, and commission reports.' },

  // 2. Fuel — own sidebar
  { key: 'fuel',            name: 'Fuel',            category: 'Business Modules', icon: 'Fuel',
    routePaths: ['/portal/fuel'],     isBusinessModule: true, sortOrder: 210,
    description: 'Pump-attributed fuel sales, FIFO tank inventory, multi-tank topology with blending, stick reading reconciliation, and fuel-grade reports.' },

  // 3. Tobacco Scan Data — own sidebar
  { key: 'scan_data',       name: 'Tobacco Scan Data', category: 'Business Modules', icon: 'ShieldCheck',
    routePaths: ['/portal/scan-data'], isBusinessModule: true, sortOrder: 220,
    description: 'Altria, RJR, and ITG scan-data programs with daily SFTP submission, manufacturer coupon redemption at the POS, and ack-file reconciliation.' },

  // 4. E-Commerce — pure parent (3 children)
  { key: 'ecommerce',       name: 'E-Commerce / Online Store', category: 'Business Modules', icon: 'ShoppingBag',
    routePaths: [],                    isBusinessModule: true, sortOrder: 700,
    description: 'Branded online storefront with custom theme, real-time product + inventory sync, online order management, and e-commerce sales analytics.' },
  { key: 'ecom_setup',      name: 'Store Setup',     category: 'Online Store', icon: 'Settings2',     routePaths: ['/portal/ecom/setup'],     parentKey: 'ecommerce', sortOrder: 705 },
  { key: 'ecom_orders',     name: 'Online Orders',   category: 'Online Store', icon: 'ShoppingCart',  routePaths: ['/portal/ecom/orders'],    parentKey: 'ecommerce', sortOrder: 710 },
  { key: 'ecom_analytics',  name: 'eCom Analytics',  category: 'Online Store', icon: 'BarChart2',     routePaths: ['/portal/ecom/analytics'], parentKey: 'ecommerce', sortOrder: 720 },

  // 5. Marketplace Integration — pure parent (1 child today; add Postmates / etc. as more launch)
  { key: 'marketplace_integration', name: 'Marketplace Integration', category: 'Business Modules', icon: 'Globe',
    routePaths: [],                    isBusinessModule: true, sortOrder: 730,
    description: 'DoorDash, UberEats, Instacart, and Grubhub inventory + order routing. Auto-sync products with custom markup, accept orders directly into the POS, sync stock across platforms.' },
  { key: 'delivery_platforms', name: 'Delivery Platforms', category: 'Online Store', icon: 'Globe', routePaths: ['/portal/integrations'], parentKey: 'marketplace_integration', sortOrder: 735 },

  // 6. Storeveu Exchange — own sidebar + child wholesale_orders
  { key: 'exchange',        name: 'Storeveu Exchange', category: 'Business Modules', icon: 'Repeat',
    routePaths: ['/portal/exchange'], isBusinessModule: true, sortOrder: 800,
    description: 'B2B trading network between Storeveu stores. Send wholesale POs to partner stores, receive orders, settle balances on a regular cadence — all without leaving the platform.' },
  { key: 'wholesale_orders', name: 'Wholesale Orders', category: 'Storeveu Exchange', icon: 'Handshake', routePaths: ['/portal/exchange/new'], parentKey: 'exchange', sortOrder: 810 },

  // 7. Loyalty — pure parent (gates loyalty tabs in CustomersHub)
  { key: 'loyalty',         name: 'Loyalty Program', category: 'Business Modules', icon: 'Gift',
    routePaths: [],                    isBusinessModule: true, sortOrder: 110,
    description: 'Points accrual on every sale, redemption at checkout, member tiers, charge accounts, and customer-segment campaigns.' },

  // 8. AI Assistant — pure parent (gates the floating widget on all 3 apps + AI sub-pages)
  { key: 'ai_assistant',    name: 'AI Assistant',    category: 'Business Modules', icon: 'Sparkles',
    routePaths: ['/portal/ai-assistant'], isBusinessModule: true, sortOrder: 50,
    description: 'Floating chat widget on portal + cashier-app for feature help, live-store Q&A, and AI-generated promotion suggestions for slow-moving inventory.' },
  // Promo Suggestions is AI-driven → grouped under AI Assistant
  { key: 'promo_suggestions', name: 'AI Promo Suggestions', category: 'Catalog', icon: 'Sparkles', routePaths: ['/portal/promo-suggestions'], parentKey: 'ai_assistant', sortOrder: 340 },

  // 9. Vendor Orders / Auto Reorder — own sidebar
  { key: 'vendor_orders',   name: 'Vendor Orders / Auto Reorder',   category: 'Business Modules', icon: 'Package',
    routePaths: ['/portal/vendor-orders'], isBusinessModule: true, sortOrder: 520,
    description: '14-factor demand-driven purchase order suggestions. Lead-time, safety stock, holiday/weather adjustments, and one-click PO generation per vendor.' },

  // 10. Invoice OCR / Bulk Imports — pure parent (2 children)
  { key: 'invoice_ocr',     name: 'Invoice OCR / Bulk Imports', category: 'Business Modules', icon: 'FileUp',
    routePaths: [],                    isBusinessModule: true, sortOrder: 530,
    description: 'AI-powered invoice OCR with vendor-scoped item mapping + bulk CSV/XLSX product import. Drag-drop a vendor invoice, auto-match line items to your catalog, save to inventory.' },
  { key: 'invoice_import',  name: 'Invoice Import',  category: 'Vendors', icon: 'FileUp',  routePaths: ['/portal/invoice-import'], parentKey: 'invoice_ocr', sortOrder: 535 },
  { key: 'bulk_import',     name: 'Bulk Import',     category: 'Catalog', icon: 'Upload',  routePaths: ['/portal/import'],         parentKey: 'invoice_ocr', sortOrder: 350 },

  // 11. Multi-Store Dashboard — own sidebar
  { key: 'multi_store_dashboard', name: 'Multi-Store Dashboard', category: 'Business Modules', icon: 'LayoutDashboard',
    routePaths: ['/portal/multi-store'], isBusinessModule: true, sortOrder: 60,
    description: 'Cross-store rollup view: aggregate KPIs, store comparison leaderboards, and side-by-side performance metrics. Best on organizations with 2+ stores.' },

  // 12. Sales Predictions — pure parent (gates the Predictions tab in AnalyticsHub)
  { key: 'predictions',     name: 'Sales Predictions', category: 'Business Modules', icon: 'TrendingUp',
    routePaths: ['/portal/analytics?tab=predictions'], isBusinessModule: true, sortOrder: 615,
    description: 'Holt-Winters demand forecasts with weather, holiday, and seasonality adjustments. Plan inventory, staffing, and promotions ahead of busy days.' },

  // 13. Grocery & Scale — own toggle that gates scale config + PLU + ingredients UI
  { key: 'grocery',         name: 'Grocery & Scale Features', category: 'Business Modules', icon: 'Scale',
    routePaths: [],                    isBusinessModule: true, sortOrder: 105,
    description: 'Scale products, tare weights, ingredients, nutrition facts, WIC, and PLU types. Required for full grocery / deli / produce operations.' },
];

// Ordered list of business module keys (for plan/addon resolution)
const BUSINESS_MODULE_KEYS = MODULES
  .filter(m => m.isBusinessModule)
  .map(m => m.key);

// ─────────────────────────────────────────────────
// PLANS — Starter + Pro
// ─────────────────────────────────────────────────
interface PlanSpec {
  slug: string;
  name: string;
  tagline: string;
  description: string;
  /** Static price for flat-priced plans (Starter). Ignored when
   *  `bundleDiscountPercent` is set — the seeder computes basePrice
   *  dynamically from Starter base + Σ Starter addons − discount. */
  basePrice: number;
  /** Static annual price. Auto-recomputed for bundle plans (= basePrice × 12). */
  annualPrice: number;
  includedStores: number;
  includedRegisters: number;
  maxUsers: number | null;
  highlighted?: boolean;
  isDefault?: boolean;
  sortOrder: number;
  /** Module keys this plan grants. Core + base modules added automatically.
   *  '__BUSINESS_ALL__' grants all 12 business modules. */
  moduleKeys: string[];
  /** When set, this plan's basePrice is computed dynamically from the default
   *  plan (Starter) basePrice + addon prices, with this percentage off the bundle.
   *  Admin-editable post-seed. Set to null on flat-priced plans. */
  bundleDiscountPercent?: number | null;
  /** Optional manual override. When set, takes precedence over the dynamic
   *  bundle calc. Lets ops hand-tune for promos without losing the formula. */
  priceOverride?: number | null;
}

// Base modules (always granted to every plan)
const BASE_MODULE_KEYS = [
  'tasks',
  'customers',
  'products', 'product_groups', 'departments', 'promotions',
  'inventory_count', 'expiry_tracker', 'label_queue',
  'vendors', 'vendor_payouts', 'csv_transform',
  'transactions', 'analytics', 'employees', 'daily_reports', 'audit_log',
  'pos_config', 'quick_buttons', 'rules_fees',
];

const PLANS: PlanSpec[] = [
  {
    slug: 'starter',
    name: 'Starter',
    tagline: 'Everything you need to run one store.',
    description: '$39/month per store. Add features as you grow.',
    basePrice: 39,
    annualPrice: 468,
    includedStores: 1,
    includedRegisters: 1,
    maxUsers: 5,
    isDefault: true,
    sortOrder: 10,
    moduleKeys: BASE_MODULE_KEYS,
  },
  {
    slug: 'pro',
    name: 'Pro',
    tagline: 'Full platform. Every module included.',
    description: 'Per-store pricing. All add-ons included by default at a bundle discount.',
    // basePrice + annualPrice are recomputed below from Starter + addons − discount.
    // The literal values here are seed placeholders only.
    basePrice: 0,
    annualPrice: 0,
    includedStores: 1,
    includedRegisters: 5,
    maxUsers: null,
    highlighted: true,
    sortOrder: 20,
    moduleKeys: [...BASE_MODULE_KEYS, '__BUSINESS_ALL__'],
    bundleDiscountPercent: 10, // 10% off (Starter + every addon)
    priceOverride: null,        // admin can set this in the platform admin UI
  },
];

// ─────────────────────────────────────────────────
// ADD-ON CATALOG (12) — each unlocks ONE business module.
// Children resolve automatically via parentKey in the entitlement resolver.
// ─────────────────────────────────────────────────
interface AddonSpec {
  key: string;
  label: string;
  description: string;
  price: number;
  /** Always a single business module key — children cascade via parentKey. */
  moduleKey: string;
}

const STARTER_ADDONS: AddonSpec[] = [
  { key: 'lottery',                label: 'Lottery',                       price: 15, description: 'Scratch ticket sales, daily inventory + book scanning, end-of-shift reconciliation, weekly settlement, and commission reports.', moduleKey: 'lottery' },
  { key: 'fuel',                   label: 'Fuel',                          price: 15, description: 'Pump-attributed fuel sales, FIFO tank inventory, multi-tank topology with blending, stick reading reconciliation, and fuel-grade reports.', moduleKey: 'fuel' },
  { key: 'ecommerce',              label: 'E-Commerce / Online Store',     price: 15, description: 'Branded online storefront with custom theme, real-time product + inventory sync, online order management, and e-commerce sales analytics.', moduleKey: 'ecommerce' },
  { key: 'marketplace',            label: 'Marketplace Integration',       price: 15, description: 'DoorDash, UberEats, Instacart, and Grubhub inventory + order routing. Auto-sync products with custom markup; orders flow directly into the POS.', moduleKey: 'marketplace_integration' },
  { key: 'exchange',               label: 'StoreVeu Exchange',             price: 10, description: 'B2B trading network between Storeveu stores. Send wholesale POs to partners, receive orders, settle balances on a regular cadence.', moduleKey: 'exchange' },
  { key: 'loyalty',                label: 'Loyalty Program',               price: 10, description: 'Points accrual on every sale, redemption at checkout, member tiers, charge accounts, and customer-segment campaigns.', moduleKey: 'loyalty' },
  { key: 'scan_data',              label: 'Tobacco Scan Data',             price: 15, description: 'Altria, RJR, and ITG scan-data programs with daily SFTP submission, manufacturer coupon redemption at the POS, and ack-file reconciliation.', moduleKey: 'scan_data' },
  { key: 'ai_assistant',           label: 'AI Assistant',                  price: 10, description: 'Floating chat widget on portal + cashier-app for feature help, live-store Q&A, and AI-generated promotion suggestions for slow-moving inventory.', moduleKey: 'ai_assistant' },
  { key: 'vendor_orders',          label: 'Vendor Orders / Auto Reorder',  price: 12, description: '14-factor demand-driven purchase order suggestions. Lead-time, safety stock, holiday/weather adjustments, and one-click PO generation per vendor.', moduleKey: 'vendor_orders' },
  { key: 'invoice_ocr',            label: 'Invoice OCR / Bulk Imports',    price: 15, description: 'AI-powered invoice OCR with vendor-scoped item mapping + bulk CSV/XLSX product import. Drag-drop a vendor invoice, auto-match items to your catalog.', moduleKey: 'invoice_ocr' },
  { key: 'multi_store_dashboard',  label: 'Multi-Store Dashboard',         price: 10, description: 'Cross-store rollup view: aggregate KPIs, store comparison leaderboards, and side-by-side performance metrics. Best on organizations with 2+ stores.', moduleKey: 'multi_store_dashboard' },
  { key: 'predictions',            label: 'Sales Predictions',             price: 10, description: 'Holt-Winters demand forecasts with weather, holiday, and seasonality adjustments. Plan inventory, staffing, and promotions ahead of busy days.', moduleKey: 'predictions' },
  { key: 'grocery',                label: 'Grocery & Scale Features',      price: 8,  description: 'Scale products, tare weights, ingredients, nutrition facts, WIC, and PLU types. Required for full grocery / deli / produce operations.', moduleKey: 'grocery' },
];

// ─────────────────────────────────────────────────
// EXECUTE
// ─────────────────────────────────────────────────
async function main() {
  console.log('🌱 Seeding Plan Modules — grouped business-module architecture...\n');

  // ── 1. Upsert PlatformModule catalog ───────────────────────────────────
  console.log('─── Modules ───');
  let mNew = 0, mUpdated = 0;
  for (const m of MODULES) {
    const existing = await prisma.platformModule.findUnique({ where: { key: m.key } });
    const data = {
      name: m.name,
      category: m.category,
      icon: m.icon ?? null,
      routePaths: m.routePaths,
      isCore: !!m.isCore,
      isBusinessModule: !!m.isBusinessModule,
      parentKey: m.parentKey ?? null,
      sortOrder: m.sortOrder ?? 0,
      description: m.description ?? null,
      active: true,
    };
    if (existing) {
      // Use raw SQL for the new fields (parentKey, isBusinessModule) so this
      // works before `prisma generate` has run with the new schema.
      await prisma.$executeRawUnsafe(
        `UPDATE platform_modules SET
            name=$1, category=$2, icon=$3, "routePaths"=$4::text[],
            "isCore"=$5, "isBusinessModule"=$6, "parentKey"=$7,
            "sortOrder"=$8, description=$9, active=true, "updatedAt"=NOW()
         WHERE key=$10`,
        data.name, data.category, data.icon,
        `{${data.routePaths.map(r => `"${r}"`).join(',')}}`,
        data.isCore, data.isBusinessModule, data.parentKey,
        data.sortOrder, data.description, m.key,
      );
      mUpdated++;
    } else {
      await prisma.$executeRawUnsafe(
        `INSERT INTO platform_modules (
           id, key, name, category, icon, "routePaths",
           "isCore", "isBusinessModule", "parentKey",
           "sortOrder", description, active, "createdAt", "updatedAt"
         ) VALUES (
           gen_random_uuid()::text, $1, $2, $3, $4, $5::text[],
           $6, $7, $8,
           $9, $10, true, NOW(), NOW()
         )`,
        m.key, data.name, data.category, data.icon,
        `{${data.routePaths.map(r => `"${r}"`).join(',')}}`,
        data.isCore, data.isBusinessModule, data.parentKey,
        data.sortOrder, data.description,
      );
      mNew++;
    }
  }
  console.log(`  ✓ ${mNew} new, ${mUpdated} updated, ${MODULES.length} total modules`);
  console.log(`  ✓ ${BUSINESS_MODULE_KEYS.length} business modules (toggleable parents)`);

  // ── 2. Deactivate stale legacy modules + plans ─────────────────────────
  // Modules that existed in earlier seeds but are no longer in MODULES[]
  const allDbModules = await prisma.platformModule.findMany({ select: { id: true, key: true, active: true } });
  const validKeys = new Set(MODULES.map(m => m.key));
  const stale = allDbModules.filter(m => !validKeys.has(m.key) && m.active);
  if (stale.length > 0) {
    await prisma.platformModule.updateMany({
      where: { id: { in: stale.map(s => s.id) } },
      data: { active: false },
    });
    console.log(`  ✗ ${stale.length} stale legacy module(s) marked inactive`);
  }

  // Deactivate legacy 3-plan structure (Growth, Enterprise) so they don't
  // appear in pricing pages or admin lists. Existing OrgSubscription rows
  // referencing them keep working — they just stop being public.
  console.log('\n─── Legacy plans ───');
  const legacy = await prisma.subscriptionPlan.findMany({ where: { slug: { in: ['growth', 'enterprise'] } } });
  for (const p of legacy) {
    if (p.isActive || p.isPublic) {
      await prisma.subscriptionPlan.update({
        where: { id: p.id },
        data: { isActive: false, isPublic: false, isDefault: false, highlighted: false },
      });
      console.log(`  ✗ ${p.slug} → inactive (legacy 3-plan structure)`);
    } else {
      console.log(`  · ${p.slug} already inactive`);
    }
  }

  // Drop isDefault from any non-Starter plan to ensure Starter is the unique default.
  await prisma.subscriptionPlan.updateMany({
    where: { slug: { notIn: ['starter'] } },
    data: { isDefault: false },
  });

  // ── 3. Reload module catalog (with new IDs) for plan-module mapping ────
  // Use raw SQL because the Prisma client may not have been regenerated yet
  // after the `db push` (DLL lock during dev). New fields (isBusinessModule,
  // parentKey) are only visible to raw queries until regen.
  const allModulesAfter: any[] = await prisma.$queryRawUnsafe(
    `SELECT id, key, "isCore", "isBusinessModule", "parentKey"
       FROM platform_modules
      WHERE active = true`,
  );
  const moduleByKey = new Map(allModulesAfter.map(m => [m.key, m]));
  const coreModuleIds = allModulesAfter.filter(m => m.isCore).map(m => m.id);
  const baseModuleIds = BASE_MODULE_KEYS
    .map(k => moduleByKey.get(k)?.id)
    .filter(Boolean) as string[];
  const allBusinessIds = allModulesAfter
    .filter(m => m.isBusinessModule)
    .map(m => m.id);
  const allChildIds = allModulesAfter
    .filter(m => m.parentKey)
    .map(m => m.id);

  // ── 4. Upsert Starter + Pro ────────────────────────────────────────────
  console.log('\n─── Plans ───');
  // Resolve Starter spec + addon list once so we can compute Pro's bundle price.
  const starterSpec = PLANS.find(p => p.slug === 'starter')!;
  const planRecords: Record<string, any> = {};
  for (const p of PLANS) {
    const existing = await prisma.subscriptionPlan.findUnique({ where: { slug: p.slug } });

    // Dynamic bundle pricing: when this plan has bundleDiscountPercent, compute
    // basePrice from Starter base + Σ STARTER_ADDONS − discount. Honors any
    // priceOverride already saved on an existing row (so admin edits persist
    // across re-seeds). New rows pick up the seed-default override (null).
    let basePrice = p.basePrice;
    let annualPrice = p.annualPrice;
    let bundleDiscountPercent: number | null = p.bundleDiscountPercent ?? null;
    let priceOverride: number | null = p.priceOverride ?? null;
    if (existing) {
      // Re-seed should NOT clobber an admin's manual override or discount tweak.
      // Existing fields take precedence; seed values are only the initial defaults.
      const existingOverride = (existing as any).priceOverride;
      const existingDiscount = (existing as any).bundleDiscountPercent;
      if (existingOverride !== null && existingOverride !== undefined) {
        priceOverride = Number(existingOverride.toString());
      }
      if (existingDiscount !== null && existingDiscount !== undefined) {
        bundleDiscountPercent = Number(existingDiscount.toString());
      }
    }
    if (bundleDiscountPercent !== null && bundleDiscountPercent !== undefined) {
      const computed = computeBundlePlanPricing(
        { basePrice: starterSpec.basePrice },
        STARTER_ADDONS,
        bundleDiscountPercent,
        priceOverride,
      );
      basePrice = computed.basePrice;
      annualPrice = computed.annualPrice;
      const addonsTotal = STARTER_ADDONS.reduce((s, a) => s + a.price, 0);
      console.log(
        `  ⚡ ${p.slug.padEnd(8)} dynamic: $${starterSpec.basePrice} + $${addonsTotal} addons ` +
        `${bundleDiscountPercent}% off${priceOverride ? ` (override $${priceOverride})` : ''} = $${basePrice}/mo`,
      );
    }

    const data = {
      name: p.name,
      slug: p.slug,
      description: p.description,
      tagline: p.tagline,
      basePrice,
      annualPrice,
      bundleDiscountPercent,
      priceOverride,
      isCustomPriced: false,
      currency: 'USD',
      pricePerStore: 0,
      pricePerRegister: 0,
      includedStores: p.includedStores,
      includedRegisters: p.includedRegisters,
      maxUsers: p.maxUsers,
      // S81 — Trial offering removed. Every new store starts ACTIVE on Starter
      // (or whichever plan admin assigns during contract activation). Set to 0
      // so any code reading trialDays stops creating trial windows.
      trialDays: 0,
      isPublic: true,
      isActive: true,
      highlighted: !!p.highlighted,
      isDefault: !!p.isDefault,
      sortOrder: p.sortOrder,
    };
    const plan = existing
      ? await prisma.subscriptionPlan.update({ where: { id: existing.id }, data })
      : await prisma.subscriptionPlan.create({ data });
    planRecords[p.slug] = plan;
    console.log(`  ✓ ${existing ? '↻' : '+'} ${plan.slug.padEnd(8)} $${plan.basePrice}/mo`);

    // Build target module set: core + base + (business + children if Pro)
    let targetIds = new Set<string>([...coreModuleIds, ...baseModuleIds]);
    if (p.moduleKeys.includes('__BUSINESS_ALL__')) {
      for (const id of allBusinessIds) targetIds.add(id);
      for (const id of allChildIds) targetIds.add(id);
    }
    // Resolve any explicit module keys (Starter has none beyond base — base
    // is already covered, but support explicit overrides for future plans).
    for (const k of p.moduleKeys) {
      if (k === '__BUSINESS_ALL__') continue;
      const m = moduleByKey.get(k);
      if (m) targetIds.add(m.id);
    }

    const currentMappings = await prisma.planModule.findMany({ where: { planId: plan.id } });
    const currentIds = new Set(currentMappings.map(pm => pm.moduleId));
    const toAdd = [...targetIds].filter(id => !currentIds.has(id));
    const toRemove = currentMappings.filter(pm => !targetIds.has(pm.moduleId));

    if (toAdd.length) {
      await prisma.planModule.createMany({
        data: toAdd.map(moduleId => ({ planId: plan.id, moduleId })),
        skipDuplicates: true,
      });
    }
    if (toRemove.length) {
      await prisma.planModule.deleteMany({
        where: { planId: plan.id, moduleId: { in: toRemove.map(pm => pm.moduleId) } },
      });
    }
    console.log(`     → ${targetIds.size} modules (+${toAdd.length}, -${toRemove.length})`);
  }

  // ── 5. Upsert Starter addons (each addon points to ONE business module key) ──
  console.log('\n─── Addons (Starter) ───');
  const starterPlan = planRecords['starter'];
  for (const a of STARTER_ADDONS) {
    if (!moduleByKey.has(a.moduleKey)) {
      console.warn(`  ⚠ Addon '${a.key}' references unknown module '${a.moduleKey}'`);
      continue;
    }
    const existing: any[] = await prisma.$queryRawUnsafe(
      `SELECT id FROM plan_addons WHERE "planId"=$1 AND key=$2`,
      starterPlan.id, a.key,
    );
    const moduleKeysLiteral = `{"${a.moduleKey}"}`;
    if (existing.length > 0) {
      await prisma.$executeRawUnsafe(
        `UPDATE plan_addons SET label=$1, description=$2, price=$3, "moduleKeys"=$4::text[], "isActive"=true, "updatedAt"=NOW() WHERE id=$5`,
        a.label, a.description, a.price, moduleKeysLiteral, existing[0].id,
      );
      console.log(`  ↻ ${a.key.padEnd(24)} $${a.price}/mo  → ${a.moduleKey}`);
    } else {
      await prisma.$executeRawUnsafe(
        `INSERT INTO plan_addons (id, "planId", key, label, description, price, "moduleKeys", "isActive", "createdAt", "updatedAt")
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6::text[], true, NOW(), NOW())`,
        starterPlan.id, a.key, a.label, a.description, a.price, moduleKeysLiteral,
      );
      console.log(`  + ${a.key.padEnd(24)} $${a.price}/mo  → ${a.moduleKey}`);
    }
  }

  // Pro plan has no addons (everything's included). Wipe any pre-existing addon rows.
  const proPlan = planRecords['pro'];
  const proAddonsBefore: any[] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM plan_addons WHERE "planId"=$1`,
    proPlan.id,
  );
  const proAddonCount = proAddonsBefore[0]?.n || 0;
  if (proAddonCount > 0) {
    await prisma.$executeRawUnsafe(`DELETE FROM plan_addons WHERE "planId"=$1`, proPlan.id);
    console.log(`\n  · Wiped ${proAddonCount} legacy Pro addons (Pro includes everything by default)`);
  }

  // ── 6. Migrate every existing Store → Pro StoreSubscription ────────────
  console.log('\n─── Migration: existing stores → Pro ───');
  const allStores = await prisma.store.findMany({
    where: { isActive: true },
    select: { id: true, orgId: true, name: true },
  });
  let migrated = 0;
  let skipped = 0;
  const now = new Date();
  const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  for (const s of allStores) {
    const existing: any[] = await prisma.$queryRawUnsafe(
      `SELECT id FROM store_subscriptions WHERE "storeId"=$1`,
      s.id,
    );
    if (existing.length > 0) {
      skipped++;
      continue;
    }
    await prisma.$executeRawUnsafe(
      `INSERT INTO store_subscriptions (
         id, "storeId", "orgId", "planId", status,
         "trialEndsAt", "currentPeriodStart", "currentPeriodEnd",
         "registerCount", "extraAddons",
         "retryCount", "createdAt", "updatedAt"
       ) VALUES (
         gen_random_uuid()::text, $1, $2, $3, 'active',
         NULL, $4, $5,
         1, '{}'::text[],
         0, NOW(), NOW()
       )`,
      s.id, s.orgId, proPlan.id, now, periodEnd,
    );
    migrated++;
  }
  console.log(`  ✓ ${migrated} stores migrated to Pro, ${skipped} already had a subscription`);
  console.log(`  → All existing customers see ZERO behavior change (Pro = every business module)`);

  // ── 7. S81 — flip existing 'trial' subscriptions to 'active' (no more trials)
  // Trial concept is removed. Stores that were created with the legacy trial
  // path keep their plan but lose the trial window. trialEndsAt → null.
  console.log('\n─── S81 backfill: trial → active ───');
  const trialFlip = await prisma.$executeRawUnsafe(
    `UPDATE store_subscriptions
       SET status='active', "trialEndsAt"=NULL, "updatedAt"=NOW()
     WHERE status='trial'`,
  );
  console.log(`  ✓ Flipped ${trialFlip} StoreSubscription(s) from trial → active`);

  console.log('\n✅ Plan Modules seed complete.\n');
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
