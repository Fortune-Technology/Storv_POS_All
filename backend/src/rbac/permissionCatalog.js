/**
 * Permission catalog — master list of all permission keys.
 *
 * Format: key = "module.action" (e.g. "products.edit").
 * scope = 'org' (available to tenant roles) or 'admin' (superadmin-only).
 *
 * Actions: view | create | edit | delete | manage
 *   - `manage` is a catch-all used where a module has complex operations
 *     that don't fit cleanly into CRUD (e.g. shift close, refund approval)
 */

export const ACTIONS = ['view', 'create', 'edit', 'delete'];

// ─── Org-scoped modules (store / manager / cashier / custom roles) ───────
// `surface` indicates where the permission is enforced in the UI:
//   - 'back-office'  : portal only (localhost:5173)
//   - 'cashier-app'  : cashier/POS app only (localhost:5174)
//   - 'both'         : exposed in BOTH surfaces (the Role editor lists the
//                      permission under each tab so admins can see it clearly)
const ORG_MODULES = [
  { module: 'dashboard',       label: 'Live Dashboard',      actions: ['view'],                                            surface: 'back-office' },
  { module: 'pos',             label: 'POS Terminal',        actions: ['view', 'manage'],                                  surface: 'cashier-app', desc: 'Ring up sales on the cashier app' },
  { module: 'products',        label: 'Products',            actions: ['view','create','edit','delete'],                   surface: 'both' },
  { module: 'departments',     label: 'Departments',         actions: ['view','create','edit','delete'],                   surface: 'back-office' },
  { module: 'promotions',      label: 'Promotions',          actions: ['view','create','edit','delete'],                   surface: 'back-office' },
  { module: 'inventory',       label: 'Inventory Count',     actions: ['view','edit'],                                     surface: 'back-office' },
  { module: 'vendors',         label: 'Vendors',             actions: ['view','create','edit','delete'],                   surface: 'back-office' },
  { module: 'vendor_payouts',  label: 'Vendor Payouts',      actions: ['view','create','edit','delete'],                   surface: 'back-office' },
  { module: 'vendor_orders',   label: 'Vendor Orders / PO',  actions: ['view','create','edit','delete','manage'],          surface: 'back-office' },
  { module: 'invoices',        label: 'Invoice Import',      actions: ['view','create','edit','delete'],                   surface: 'back-office' },
  { module: 'lottery',         label: 'Lottery',             actions: ['view','create','edit','delete','manage'],          surface: 'both' },
  { module: 'fuel',            label: 'Fuel',                actions: ['view','create','edit','delete'],                   surface: 'both' },
  { module: 'customers',       label: 'Customers',           actions: ['view','create','edit','delete'],                   surface: 'both' },
  { module: 'loyalty',         label: 'Loyalty Program',     actions: ['view','edit'],                                     surface: 'both' },
  { module: 'transactions',    label: 'Transactions',        actions: ['view','manage'],                                   surface: 'both', desc: 'View or void/refund past sales' },
  { module: 'shifts',          label: 'Shifts / Drawer',     actions: ['view','manage'],                                   surface: 'both' },
  { module: 'reports',         label: 'Reports',             actions: ['view','manage'],                                   surface: 'back-office' },
  { module: 'analytics',       label: 'Analytics',           actions: ['view'],                                            surface: 'back-office' },
  { module: 'predictions',     label: 'Sales Predictions',   actions: ['view'],                                            surface: 'back-office' },
  { module: 'users',           label: 'Users',               actions: ['view','create','edit','delete'],                   surface: 'back-office' },
  { module: 'roles',           label: 'Roles & Permissions', actions: ['view','create','edit','delete'],                   surface: 'back-office' },
  { module: 'stores',          label: 'Stores',              actions: ['view','create','edit','delete'],                   surface: 'back-office' },
  { module: 'organization',    label: 'Organization Settings', actions: ['view','edit'],                                   surface: 'back-office' },
  { module: 'pos_config',      label: 'POS Configuration',   actions: ['view','edit'],                                     surface: 'back-office' },
  { module: 'rules_fees',      label: 'Rules & Fees',        actions: ['view','edit'],                                     surface: 'back-office' },
  { module: 'ecom',            label: 'Online Store / E-commerce', actions: ['view','edit','manage'],                      surface: 'back-office' },
  { module: 'exchange',        label: 'StoreVeu Exchange (B2B)', actions: ['view','create','receive','settle','manage'],       surface: 'back-office', desc: 'Send wholesale POs to trading partners, confirm incoming orders, record settlements' },
  { module: 'support',         label: 'Support Tickets',     actions: ['view','create','edit'],                            surface: 'back-office' },
  { module: 'billing',         label: 'Billing & Plan',      actions: ['view','edit'],                                     surface: 'back-office' },
  { module: 'audit',           label: 'Audit Log',           actions: ['view'],                                            surface: 'back-office' },
  { module: 'tasks',           label: 'Tasks',               actions: ['view','create','edit','delete'],                   surface: 'both' },
  { module: 'chat',            label: 'Chat',                actions: ['view','create'],                                   surface: 'both' },
  { module: 'ai_assistant',    label: 'AI Support Assistant', actions: ['view','manage'],                                   surface: 'both', desc: 'Use the AI chatbot for feature help + live-data queries. "manage" grants access to the 👎 feedback review queue.' },
];

// ─── Admin-scoped modules (superadmin panel only) ─────────────────────────
const ADMIN_MODULES = [
  { module: 'admin_dashboard',    label: 'Admin Dashboard',    actions: ['view'] },
  { module: 'admin_users',        label: 'All Users',          actions: ['view','create','edit','delete'] },
  { module: 'admin_organizations',label: 'Organizations',      actions: ['view','create','edit','delete'] },
  { module: 'admin_stores',       label: 'All Stores',         actions: ['view','create','edit','delete'] },
  { module: 'admin_analytics',    label: 'Platform Analytics', actions: ['view'] },
  { module: 'admin_cms',          label: 'CMS Pages',          actions: ['view','create','edit','delete'] },
  { module: 'admin_careers',      label: 'Careers',            actions: ['view','create','edit','delete'] },
  { module: 'admin_tickets',      label: 'Support Tickets (all orgs)', actions: ['view','create','edit','delete'] },
  { module: 'admin_chat',         label: 'Admin Chat',         actions: ['view','create'] },
  { module: 'admin_billing',      label: 'Billing Console',    actions: ['view','edit'] },
  { module: 'admin_payments',     label: 'Payment Merchants',  actions: ['view','create','edit','delete'] },
  { module: 'admin_system',       label: 'System Config',      actions: ['view','edit','manage'] },
  { module: 'admin_backup',       label: 'Database Backup',    actions: ['view','manage'] },
  { module: 'admin_roles',        label: 'System Roles',       actions: ['view','create','edit','delete'] },
];

function expand(modules, scope) {
  const out = [];
  for (const m of modules) {
    for (const action of m.actions) {
      out.push({
        key: `${m.module}.${action}`,
        module: m.module,
        moduleLabel: m.label,
        action,
        label: `${actionLabel(action)} — ${m.label}`,
        description: m.desc || null,
        scope,
        // surface classifies org-scope permissions as back-office, cashier-app,
        // or both — used by the Role editor UI to split checkboxes into two
        // tabs. Admin-scope permissions are always 'back-office' (admin panel).
        surface: m.surface || (scope === 'admin' ? 'back-office' : 'back-office'),
      });
    }
  }
  return out;
}

function actionLabel(a) {
  return {
    view: 'View', create: 'Create', edit: 'Edit', delete: 'Delete',
    manage: 'Manage', receive: 'Receive / Confirm', settle: 'Record Settlement',
  }[a] || a;
}

export const ALL_PERMISSIONS = [
  ...expand(ORG_MODULES, 'org'),
  ...expand(ADMIN_MODULES, 'admin'),
];

// ─── Built-in system roles and their default permission grants ────────────
// Maps legacy `User.role` value → array of permission keys.
// '*' means "every org-scope permission" (admin/owner); 'admin:*' means
// "every admin-scope permission" (superadmin).
export const SYSTEM_ROLES = [
  {
    key: 'superadmin',
    name: 'Super Admin',
    scope: 'admin',
    description: 'Full platform access including system configuration and billing.',
    permissions: ['admin:*', '*'],
  },
  {
    key: 'owner',
    name: 'Owner',
    scope: 'org',
    description: 'Org owner with full access to their organization and stores.',
    permissions: ['*'],
  },
  {
    key: 'admin',
    name: 'Admin',
    scope: 'org',
    description: 'Store/org admin with access to most org operations.',
    permissions: ['*'],
  },
  {
    key: 'manager',
    name: 'Manager',
    scope: 'org',
    description: 'Day-to-day operations: inventory, staff, reports, refunds.',
    permissions: [
      'dashboard.view', 'pos.view', 'pos.manage',
      'products.view','products.create','products.edit',
      'departments.view','departments.edit',
      'promotions.view','promotions.create','promotions.edit',
      'inventory.view','inventory.edit',
      'vendors.view','vendors.create','vendors.edit',
      'vendor_payouts.view','vendor_payouts.create','vendor_payouts.edit',
      'vendor_orders.view','vendor_orders.create','vendor_orders.edit','vendor_orders.manage',
      'invoices.view','invoices.create','invoices.edit',
      'lottery.view','lottery.create','lottery.edit','lottery.manage',
      'fuel.view','fuel.edit',
      'customers.view','customers.create','customers.edit',
      'loyalty.view','loyalty.edit',
      'transactions.view','transactions.manage',
      'shifts.view','shifts.manage',
      'reports.view','reports.manage',
      'analytics.view','predictions.view',
      'users.view','users.create','users.edit',
      // Managers need to see stores to scope POS config / reports / etc. to
      // the right location — without stores.view the StoreSwitcher is empty
      // and every store-scoped endpoint returns 403. Create/edit/delete
      // remain owner-only.
      'stores.view',
      'organization.view',
      'pos_config.view','pos_config.edit',
      'rules_fees.view','rules_fees.edit',
      'support.view','support.create','support.edit',
      'audit.view',
      'tasks.view','tasks.create','tasks.edit','tasks.delete',
      'chat.view','chat.create',
      'exchange.view','exchange.create','exchange.receive',
      'ai_assistant.view','ai_assistant.manage',
    ],
  },
  {
    key: 'cashier',
    name: 'Cashier',
    scope: 'org',
    description: 'POS terminal + customer lookup. Read-only elsewhere.',
    permissions: [
      'pos.view','pos.manage',
      'products.view','customers.view','customers.create','customers.edit',
      'loyalty.view','lottery.view','lottery.create','fuel.view','fuel.create',
      'transactions.view','shifts.view','shifts.manage',
      'chat.view','chat.create',
      'ai_assistant.view',
    ],
  },
  {
    key: 'staff',
    name: 'Staff',
    scope: 'org',
    description: 'Minimal view-only access. Promoted once onboarded.',
    permissions: ['dashboard.view'],
  },
];

// Expand wildcard grants against the permission catalog.
// '*'        → all org-scope permissions
// 'admin:*'  → all admin-scope permissions
// plain keys → literal match
export function expandPermissionGrants(grants) {
  const out = new Set();
  for (const g of grants) {
    if (g === '*') {
      for (const p of ALL_PERMISSIONS) if (p.scope === 'org') out.add(p.key);
    } else if (g === 'admin:*') {
      for (const p of ALL_PERMISSIONS) if (p.scope === 'admin') out.add(p.key);
    } else {
      out.add(g);
    }
  }
  return [...out];
}

export default { ALL_PERMISSIONS, SYSTEM_ROLES, expandPermissionGrants };
