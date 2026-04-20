/**
 * Admin-app route → permission mapping.
 * Superadmins always pass via the usePermissions() hook.
 */
export const ADMIN_ROUTE_PERMISSIONS = {
  '/dashboard':                    'admin_dashboard.view',
  '/analytics':                    'admin_analytics.view',
  '/analytics/organizations':      'admin_analytics.view',
  '/analytics/stores':             'admin_analytics.view',
  '/analytics/users':              'admin_analytics.view',
  '/users':                        'admin_users.view',
  '/organizations':                'admin_organizations.view',
  '/stores':                       'admin_stores.view',
  '/roles':                        'admin_roles.view',
  '/merchants':                    'admin_payments.view',
  '/cms':                          'admin_cms.view',
  '/careers':                      'admin_careers.view',
  '/careers/:id/applications':     'admin_careers.view',
  '/tickets':                      'admin_tickets.view',
  '/config':                       'admin_system.view',
  '/billing':                      'admin_billing.view',
  '/chat':                         'admin_chat.view',
  '/price-calculator':             'admin_system.view',
  '/states':                       'admin_system.view',
  '/vendor-templates':             'admin_system.view',
};

export function getRoutePermission(pathname) {
  if (ADMIN_ROUTE_PERMISSIONS[pathname]) return ADMIN_ROUTE_PERMISSIONS[pathname];
  for (const pattern of Object.keys(ADMIN_ROUTE_PERMISSIONS)) {
    if (!pattern.includes(':')) continue;
    const regex = new RegExp('^' + pattern.replace(/:[^/]+/g, '[^/]+') + '$');
    if (regex.test(pathname)) return ADMIN_ROUTE_PERMISSIONS[pattern];
  }
  return null;
}
