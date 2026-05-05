// @ts-nocheck — Same pattern as other seed files. Prisma types are dynamic
// after `db push`; tsc's strictness pegs unresolved generic params here as
// implicit-any. The runtime is correct and verified by smoke tests.
/**
 * S78 — Plan Modules Seeder
 *
 * Idempotent seed for:
 *   1. PlatformModule catalog — every gateable sidebar item
 *   2. SubscriptionPlan rows  — Starter / Growth / Enterprise
 *   3. PlanModule mapping     — which modules each plan unlocks
 *
 * Re-run safely: existing modules/plans are upserted; mappings are diffed
 * (added if missing, removed if no longer in the spec for that plan).
 *
 * Run: npx tsx prisma/seedPlanModules.ts
 */
import prisma from '../src/config/postgres.js';

// ─────────────────────────────────────────────────
// MODULE CATALOG
// Every sidebar item on the portal lives here. The frontend Sidebar filters
// by `key`; the route guard maps a path → module via `routePaths`.
// `isCore: true` modules are always granted to every plan.
// Add new sidebar items here AND in the per-plan moduleKeys arrays below.
// ─────────────────────────────────────────────────
interface ModuleSpec {
  key: string;
  name: string;
  category: string;
  routePaths: string[];
  description?: string;
  icon?: string;
  isCore?: boolean;
  sortOrder?: number;
}

const MODULES: ModuleSpec[] = [
  // ── Operations ──
  { key: 'live_dashboard',  name: 'Live Dashboard',  category: 'Operations', icon: 'Radio',         routePaths: ['/portal/realtime'],          isCore: true,  sortOrder: 10, description: 'Real-time KPIs, sales, top products.' },
  { key: 'chat',            name: 'Chat',            category: 'Operations', icon: 'MessageSquare', routePaths: ['/portal/chat'],              isCore: true,  sortOrder: 20, description: 'Internal team + customer support chat.' },
  { key: 'tasks',           name: 'Tasks',           category: 'Operations', icon: 'CheckSquare',   routePaths: ['/portal/tasks'],             sortOrder: 30, description: 'Assignable to-do items across the team.' },

  // ── Customers ──
  { key: 'customers',       name: 'Customers & Loyalty', category: 'Customers', icon: 'Users',     routePaths: ['/portal/customers-hub'],     sortOrder: 100, description: 'Customer profiles, points, house accounts, loyalty rules.' },

  // ── Vertical Modules ──
  { key: 'lottery',         name: 'Lottery',         category: 'Verticals',  icon: 'Ticket',        routePaths: ['/portal/lottery'],           sortOrder: 200, description: 'Scratch ticket sales, EoD reconciliation, settlement.' },
  { key: 'fuel',            name: 'Fuel',            category: 'Verticals',  icon: 'Fuel',          routePaths: ['/portal/fuel'],              sortOrder: 210, description: 'Pump-attributed sales, FIFO tank inventory.' },
  { key: 'scan_data',       name: 'Tobacco Scan Data', category: 'Verticals', icon: 'ShieldCheck', routePaths: ['/portal/scan-data'],         sortOrder: 220, description: 'Altria/RJR/ITG scan-data + manufacturer coupon redemption.' },

  // ── Catalog ──
  { key: 'products',        name: 'Products',        category: 'Catalog',    icon: 'Package',       routePaths: ['/portal/catalog', '/portal/catalog/edit/:id', '/portal/catalog/new'], sortOrder: 300, description: 'Product catalog with pricing, UPCs, pack sizes.' },
  { key: 'product_groups',  name: 'Product Groups',  category: 'Catalog',    icon: 'Users',         routePaths: ['/portal/product-groups'],    sortOrder: 310, description: 'Group products to share defaults + cascading promotions.' },
  { key: 'departments',     name: 'Departments',     category: 'Catalog',    icon: 'Layers',        routePaths: ['/portal/departments'],       sortOrder: 320, description: 'Departments + per-department defaults.' },
  { key: 'promotions',      name: 'Promotions',      category: 'Catalog',    icon: 'Tag',           routePaths: ['/portal/promotions'],        sortOrder: 330, description: 'BOGO, volume, mix-and-match deals.' },
  { key: 'promo_suggestions', name: 'AI Promo Suggestions', category: 'Catalog', icon: 'Sparkles', routePaths: ['/portal/promo-suggestions'], sortOrder: 340, description: 'AI-generated clearance + dead-stock promos.' },
  { key: 'bulk_import',     name: 'Bulk Import',     category: 'Catalog',    icon: 'Upload',        routePaths: ['/portal/import'],            sortOrder: 350, description: 'CSV/XLSX import for products + groups.' },

  // ── Inventory ──
  { key: 'inventory_count', name: 'Inventory Count', category: 'Inventory',  icon: 'BarChart2',     routePaths: ['/portal/inventory-count'],   sortOrder: 400, description: 'Quick counts, adjustments, shrinkage, stock levels.' },
  { key: 'expiry_tracker',  name: 'Expiry Tracker',  category: 'Inventory',  icon: 'Calendar',      routePaths: ['/portal/expiry-tracker'],    sortOrder: 410, description: 'Per-store expiry tracking with status buckets.' },
  { key: 'label_queue',     name: 'Label Queue',     category: 'Inventory',  icon: 'Tag',           routePaths: ['/portal/label-queue'],       sortOrder: 420, description: 'Auto-detected + manual shelf-label print queue.' },

  // ── Vendors ──
  { key: 'vendors',         name: 'Vendors',         category: 'Vendors',    icon: 'Truck',         routePaths: ['/portal/vendors', '/portal/vendors/:id'], sortOrder: 500, description: 'Vendor catalog + per-vendor pricing/terms.' },
  { key: 'vendor_payouts',  name: 'Vendor Payouts',  category: 'Vendors',    icon: 'ArrowUpCircle', routePaths: ['/portal/vendor-payouts'],    sortOrder: 510, description: 'Back-office vendor payment + credit tracking.' },
  { key: 'vendor_orders',   name: 'Vendor Orders',   category: 'Vendors',    icon: 'Package',       routePaths: ['/portal/vendor-orders'],     sortOrder: 520, description: '14-factor demand-driven purchase orders.' },
  { key: 'invoice_import',  name: 'Invoice Import',  category: 'Vendors',    icon: 'FileUp',        routePaths: ['/portal/invoice-import'],    sortOrder: 530, description: 'AI invoice OCR with vendor-scoped item mapping.' },
  { key: 'csv_transform',   name: 'CSV Transform',   category: 'Vendors',    icon: 'Upload',        routePaths: ['/csv/upload', '/csv/preview', '/csv/history'], sortOrder: 540, description: 'CSV → POS-ready transform pipeline.' },

  // ── Reports & Analytics ──
  { key: 'transactions',    name: 'Transactions',    category: 'Reports & Analytics', icon: 'Receipt', routePaths: ['/portal/pos-reports'], sortOrder: 600, description: 'Transaction browser + receipt + payouts + balancing.' },
  { key: 'analytics',       name: 'Analytics',       category: 'Reports & Analytics', icon: 'BarChart2', routePaths: ['/portal/analytics'], sortOrder: 610, description: 'Sales, departments, products, predictions, period compare.' },
  { key: 'employees',       name: 'Employees',       category: 'Reports & Analytics', icon: 'Users',     routePaths: ['/portal/employees'], sortOrder: 620, description: 'Roster, timesheets, shifts.' },
  { key: 'daily_reports',   name: 'Daily Reports',   category: 'Reports & Analytics', icon: 'FileText',  routePaths: ['/portal/daily-reports'], sortOrder: 630, description: 'End of Day, Daily Sale, Dual Pricing.' },
  { key: 'audit_log',       name: 'Audit Log',       category: 'Reports & Analytics', icon: 'Shield',    routePaths: ['/portal/audit'], sortOrder: 640, description: 'Org-wide audit trail.' },

  // ── Online Store ──
  { key: 'ecom_setup',      name: 'Store Setup',     category: 'Online Store', icon: 'Settings2',     routePaths: ['/portal/ecom/setup'], sortOrder: 700, description: 'Branded online storefront builder.' },
  { key: 'ecom_orders',     name: 'Online Orders',   category: 'Online Store', icon: 'ShoppingCart',  routePaths: ['/portal/ecom/orders'], sortOrder: 710, description: 'Online order management.' },
  { key: 'ecom_analytics',  name: 'eCom Analytics',  category: 'Online Store', icon: 'BarChart2',     routePaths: ['/portal/ecom/analytics'], sortOrder: 720, description: 'Online store revenue + customer analytics.' },
  { key: 'delivery_platforms', name: 'Delivery Platforms', category: 'Online Store', icon: 'Globe', routePaths: ['/portal/integrations'], sortOrder: 730, description: 'DoorDash / UberEats / Instacart integration.' },

  // ── Storeveu Exchange ──
  { key: 'exchange',        name: 'Exchange',        category: 'Storeveu Exchange', icon: 'Repeat',   routePaths: ['/portal/exchange'], sortOrder: 800, description: 'B2B trading network with other stores.' },
  { key: 'wholesale_orders', name: 'Wholesale Orders', category: 'Storeveu Exchange', icon: 'Handshake', routePaths: ['/portal/exchange/new'], sortOrder: 810, description: 'Create + receive wholesale POs from partner stores.' },

  // ── POS ──
  { key: 'pos_config',      name: 'POS Configuration', category: 'POS', icon: 'Monitor', routePaths: ['/portal/pos-config'], sortOrder: 900, description: 'Layout, receipts, label design.' },
  { key: 'quick_buttons',   name: 'Quick Buttons',   category: 'POS', icon: 'Layout',   routePaths: ['/portal/quick-buttons'], sortOrder: 910, description: 'Drag-and-drop POS home-screen builder.' },
  { key: 'rules_fees',      name: 'Rules & Fees',    category: 'POS', icon: 'Recycle', routePaths: ['/portal/rules'], sortOrder: 920, description: 'Bottle deposit + tax rules.' },

  // ── Support & Billing — CORE ──
  { key: 'support_tickets', name: 'Support Tickets', category: 'Support & Billing', icon: 'MessageSquare', routePaths: ['/portal/support-tickets'], isCore: true, sortOrder: 1000, description: 'Submit + track support tickets.' },
  { key: 'billing',         name: 'Billing & Plan',  category: 'Support & Billing', icon: 'CreditCard',     routePaths: ['/portal/billing'], isCore: true, sortOrder: 1010, description: 'Subscription, invoices, payment method.' },

  // ── Account — CORE ──
  { key: 'account',         name: 'Account Settings', category: 'Account', icon: 'Building2', routePaths: ['/portal/account', '/portal/my-profile', '/portal/branding'], isCore: true, sortOrder: 1100, description: 'Org / users / stores / store branding / personal profile.' },
  { key: 'roles',           name: 'Roles & Permissions', category: 'Account', icon: 'Shield', routePaths: ['/portal/roles'], isCore: true, sortOrder: 1110, description: 'Custom RBAC roles.' },
  { key: 'invitations',     name: 'Invitations', category: 'Account', icon: 'Mail', routePaths: ['/portal/invitations'], isCore: true, sortOrder: 1120, description: 'Invite teammates to your org.' },
];

// ─────────────────────────────────────────────────
// PLAN CATALOG
// Each plan lists its module keys explicitly. Core modules (isCore=true)
// are auto-granted to every plan and don't need to be listed.
// ─────────────────────────────────────────────────
interface PlanSpec {
  slug: string;
  name: string;
  tagline: string;
  description: string;
  basePrice: number;        // monthly $
  annualPrice: number;      // pre-discounted yearly $
  isCustomPriced?: boolean;
  includedStores: number;
  includedRegisters: number;
  maxUsers: number | null;  // null = unlimited
  highlighted?: boolean;
  isDefault?: boolean;
  sortOrder: number;
  /** Module keys this plan grants. Core modules added automatically. */
  moduleKeys: string[];
}

const PLANS: PlanSpec[] = [
  {
    slug: 'starter',
    name: 'Starter',
    tagline: 'Single-location retailers — everything you need to run one store.',
    description: '$39/month (or $468 billed annually). 1 store, 1 register included.',
    basePrice: 39,
    annualPrice: 468,
    includedStores: 1,
    includedRegisters: 1,
    maxUsers: 5,
    isDefault: true,
    sortOrder: 10,
    moduleKeys: [
      'tasks',
      'customers',
      'products', 'departments', 'promotions',
      'inventory_count', 'label_queue',
      'vendors', 'vendor_payouts',
      'transactions', 'analytics', 'employees', 'daily_reports',
      'pos_config', 'quick_buttons', 'rules_fees',
    ],
  },
  {
    slug: 'growth',
    name: 'Growth',
    tagline: 'Growing multi-location businesses — unlock advanced operations.',
    description: '$79/month (or $948 billed annually). Up to 3 stores, 3 registers per store.',
    basePrice: 79,
    annualPrice: 948,
    includedStores: 3,
    includedRegisters: 3,
    maxUsers: 25,
    highlighted: true,
    sortOrder: 20,
    moduleKeys: [
      'tasks',
      'customers',
      'lottery', 'fuel',
      'products', 'product_groups', 'departments', 'promotions', 'promo_suggestions', 'bulk_import',
      'inventory_count', 'expiry_tracker', 'label_queue',
      'vendors', 'vendor_payouts', 'vendor_orders', 'invoice_import', 'csv_transform',
      'transactions', 'analytics', 'employees', 'daily_reports', 'audit_log',
      'ecom_setup', 'ecom_orders', 'ecom_analytics', 'delivery_platforms',
      'exchange', 'wholesale_orders',
      'pos_config', 'quick_buttons', 'rules_fees',
    ],
  },
  {
    slug: 'enterprise',
    name: 'Enterprise',
    tagline: 'Large-scale operations with full access — every module, no caps.',
    description: 'Custom pricing. Unlimited stores, unlimited registers, every module enabled.',
    basePrice: 0,
    annualPrice: 0,
    isCustomPriced: true,
    includedStores: 9999,
    includedRegisters: 9999,
    maxUsers: null,
    sortOrder: 30,
    // Empty array → seed will assign every active non-core module + scan_data
    // (and core modules are always granted regardless).
    moduleKeys: ['__ALL__'],
  },
];

async function main() {
  console.log('🌱 Seeding Plan Modules system...\n');

  // ── 1. Upsert PlatformModule catalog ──
  console.log('─── Modules ───');
  let mNew = 0, mUpdated = 0;
  for (const m of MODULES) {
    const existing = await prisma.platformModule.findUnique({ where: { key: m.key } });
    if (existing) {
      await prisma.platformModule.update({
        where: { key: m.key },
        data: {
          name: m.name,
          category: m.category,
          icon: m.icon ?? null,
          routePaths: m.routePaths,
          isCore: !!m.isCore,
          sortOrder: m.sortOrder ?? 0,
          description: m.description ?? null,
          active: true,
        },
      });
      mUpdated++;
    } else {
      await prisma.platformModule.create({
        data: {
          key: m.key,
          name: m.name,
          category: m.category,
          icon: m.icon ?? null,
          routePaths: m.routePaths,
          isCore: !!m.isCore,
          sortOrder: m.sortOrder ?? 0,
          description: m.description ?? null,
          active: true,
        },
      });
      mNew++;
    }
  }
  console.log(`  ✓ ${mNew} new, ${mUpdated} updated, ${MODULES.length} total modules`);

  const allModules = await prisma.platformModule.findMany({ where: { active: true } });
  const moduleByKey = new Map(allModules.map(m => [m.key, m]));
  const coreModuleIds = allModules.filter(m => m.isCore).map(m => m.id);
  const allNonCoreModuleIds = allModules.filter(m => !m.isCore).map(m => m.id);

  // ── 2. Upsert SubscriptionPlan rows ──
  console.log('\n─── Plans ───');
  for (const p of PLANS) {
    const existing = await prisma.subscriptionPlan.findUnique({ where: { slug: p.slug } });
    const data = {
      name: p.name,
      slug: p.slug,
      description: p.description,
      tagline: p.tagline,
      basePrice: p.basePrice,
      annualPrice: p.annualPrice,
      isCustomPriced: !!p.isCustomPriced,
      currency: 'USD',
      pricePerStore: 0,
      pricePerRegister: 0,
      includedStores: p.includedStores,
      includedRegisters: p.includedRegisters,
      maxUsers: p.maxUsers,
      trialDays: 14,
      isPublic: true,
      isActive: true,
      highlighted: !!p.highlighted,
      isDefault: !!p.isDefault,
      sortOrder: p.sortOrder,
    };
    const plan = existing
      ? await prisma.subscriptionPlan.update({ where: { id: existing.id }, data })
      : await prisma.subscriptionPlan.create({ data });
    console.log(`  ✓ ${existing ? 'Updated' : 'Created'} plan: ${plan.name}`);

    // ── 3. Diff plan↔module mappings ──
    // Resolve target module set: core modules + spec-listed modules,
    // OR the special '__ALL__' marker → every active non-core module.
    let targetModuleIds: string[];
    if (p.moduleKeys.includes('__ALL__')) {
      targetModuleIds = [...coreModuleIds, ...allNonCoreModuleIds];
    } else {
      const specIds: string[] = [];
      for (const k of p.moduleKeys) {
        const m = moduleByKey.get(k);
        if (!m) {
          console.warn(`  ⚠ Plan '${p.slug}' references unknown module key '${k}'`);
          continue;
        }
        specIds.push(m.id);
      }
      targetModuleIds = Array.from(new Set([...coreModuleIds, ...specIds]));
    }

    const currentMappings = await prisma.planModule.findMany({ where: { planId: plan.id } });
    const currentIds = new Set(currentMappings.map(pm => pm.moduleId));
    const targetSet = new Set(targetModuleIds);

    const toAdd = targetModuleIds.filter(id => !currentIds.has(id));
    const toRemove = currentMappings.filter(pm => !targetSet.has(pm.moduleId));

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
    console.log(`     → ${targetModuleIds.length} modules (+${toAdd.length}, -${toRemove.length})`);
  }

  console.log('\n✅ Plan Modules seed complete.\n');
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
