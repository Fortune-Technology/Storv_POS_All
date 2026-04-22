/**
 * Single source of truth: which permission key each portal route requires.
 *
 * Used by:
 *   • <PermissionRoute>    — blocks navigation to a route the user can't view
 *   • <Sidebar />          — hides nav links the user can't view
 *
 * Convention: paths with dynamic segments use a ":param" placeholder.
 * Match order: exact match first, then prefix match.
 *
 * Routes without an entry are treated as "authenticated only" (any logged-in
 * user can visit) — e.g. /portal/chat which is communication for everyone.
 */
export const PORTAL_ROUTE_PERMISSIONS = {
  // Operations
  '/portal/realtime':          'dashboard.view',
  '/portal/tasks':             'tasks.view',
  '/portal/audit':             'audit.view',

  // Customers / Loyalty
  '/portal/customers-hub':     'customers.view',

  // Catalog
  '/portal/catalog':           'products.view',
  '/portal/catalog/new':       'products.create',
  '/portal/catalog/edit/:id':  'products.edit',
  '/portal/product-groups':    'products.view',
  '/portal/departments':       'departments.view',
  '/portal/promotions':        'promotions.view',
  '/portal/import':            'products.create',
  '/portal/inventory-count':   'inventory.view',
  '/portal/label-queue':       'products.view',
  '/portal/price-update':      'products.edit',

  // Vendors
  '/portal/vendors':           'vendors.view',
  '/portal/vendors/:id':       'vendors.view',
  '/portal/vendor-payouts':    'vendor_payouts.view',
  '/portal/vendor-orders':     'vendor_orders.view',
  '/portal/invoice-import':    'invoices.view',

  // Reports & Analytics
  '/portal/analytics':         'analytics.view',
  '/portal/pos-reports':       'transactions.view',
  '/portal/end-of-day':        'reports.view',
  '/portal/daily-sale':        'reports.view',
  '/portal/reports':           'reports.view',
  '/portal/employees':         'users.view',

  // Lottery / Fuel
  '/portal/lottery':           'lottery.view',
  '/portal/fuel':              'fuel.view',

  // Online Store
  '/portal/ecom/setup':        'ecom.view',
  '/portal/ecom/orders':       'ecom.view',
  '/portal/ecom/analytics':    'ecom.view',
  '/portal/branding':          'ecom.view',

  // StoreVeu Exchange (B2B wholesale)
  '/portal/exchange':              'exchange.view',
  '/portal/exchange/new':          'exchange.create',
  '/portal/exchange/orders/:id':   'exchange.view',

  // Integrations
  '/portal/integrations':      'pos_config.view',

  // POS
  '/portal/pos-config':        'pos_config.view',
  '/portal/quick-buttons':     'pos_config.view',
  '/portal/rules':             'rules_fees.view',
  '/portal/fees-mappings':     'rules_fees.edit',

  // Support & Billing
  '/portal/support-tickets':   'support.view',
  '/portal/billing':           'billing.view',

  // Account
  '/portal/account':           'organization.view',
  '/portal/roles':             'roles.view',
  '/portal/invitations':       'users.view',
};

/**
 * Lookup the required permission for a given path. Supports dynamic segments
 * like /portal/catalog/edit/:id by matching against the template key.
 */
export function getRoutePermission(pathname) {
  if (PORTAL_ROUTE_PERMISSIONS[pathname]) return PORTAL_ROUTE_PERMISSIONS[pathname];

  for (const pattern of Object.keys(PORTAL_ROUTE_PERMISSIONS)) {
    if (!pattern.includes(':')) continue;
    const regex = new RegExp('^' + pattern.replace(/:[^/]+/g, '[^/]+') + '$');
    if (regex.test(pathname)) return PORTAL_ROUTE_PERMISSIONS[pattern];
  }

  return null;
}
