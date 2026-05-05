/**
 * Admin-app route → permission mapping.
 * Superadmins always pass via the usePermissions() hook.
 */
export const ADMIN_ROUTE_PERMISSIONS: Record<string, string> = {
  '/dashboard':                    'admin_dashboard.view',
  '/analytics':                    'admin_analytics.view',
  '/analytics/organizations':      'admin_analytics.view',
  '/analytics/stores':             'admin_analytics.view',
  '/analytics/users':              'admin_analytics.view',
  // Unified Org → Store → User drill-down (replaces /users, /organizations, /stores)
  '/org-store':                    'admin_organizations.view',
  '/roles':                        'admin_roles.view',
  '/merchants':                    'admin_payments.view',
  '/cms':                          'admin_cms.view',
  '/careers':                      'admin_careers.view',
  '/careers/:id/applications':     'admin_careers.view',
  '/tickets':                      'admin_tickets.view',
  '/notifications':                'admin_system.view',
  '/config':                       'admin_system.view',
  '/billing':                      'admin_billing.view',
  '/chat':                         'admin_chat.view',
  '/price-calculator':             'admin_system.view',
  '/states':                       'admin_system.view',
  '/vendor-templates':             'admin_system.view',
  '/ai-reviews':                   'ai_assistant.manage',
  '/ai-kb':                        'ai_assistant.manage',
  '/ai-tours':                     'ai_assistant.manage',
  '/lottery':                      'lottery.manage',
  // Session 50 — Dual Pricing / Cash Discount per-store config
  '/payment-models':               'admin_pricing_model.view',
  '/payment-models/:storeId':      'admin_pricing_model.view',
  '/pricing-tiers':                'admin_pricing_tiers.view',
  '/saas-margin':                  'admin_pricing_model.view',
  // S77 — Vendor pipeline hub (Onboardings + Contracts in one tabbed
  // page). Reuses admin_organizations since it gates org creation
  // prerequisites. Legacy paths kept so the redirect routes evaluate
  // RBAC consistently before falling through to <Navigate>.
  '/vendor-pipeline':              'admin_organizations.view',
  '/vendor-onboardings':           'admin_organizations.view',
  '/contracts':                    'admin_organizations.view',
  '/contracts/:id':                'admin_organizations.view',
  // S78 — Subscription plans + module catalog (uses pricing-tier perm family)
  '/plans':                        'admin_pricing_tiers.view',
};

export function getRoutePermission(pathname: string): string | null {
  if (ADMIN_ROUTE_PERMISSIONS[pathname]) return ADMIN_ROUTE_PERMISSIONS[pathname];
  for (const pattern of Object.keys(ADMIN_ROUTE_PERMISSIONS)) {
    if (!pattern.includes(':')) continue;
    const regex = new RegExp('^' + pattern.replace(/:[^/]+/g, '[^/]+') + '$');
    if (regex.test(pathname)) return ADMIN_ROUTE_PERMISSIONS[pattern];
  }
  return null;
}
