import { useState, useEffect, useCallback, useMemo, ReactNode } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import StoreveuLogo from './StoreveuLogo';
import './AdminSidebar.css';
import {
  LayoutDashboard,
  Building2,
  FileText,
  Briefcase,
  Ticket,
  Settings,
  LogOut,
  Menu,
  X,
  Shield,
  BarChart2,
  PieChart,
  TrendingUp,
  Activity,
  CreditCard,
  MessageSquare,
  Calculator,
  MapPin,
  Sparkles,
  Megaphone,
  BookOpen,
  Compass,
  Percent,
  UserCircle,
} from 'lucide-react';
import api from '../services/api';
import { getRoutePermission } from '../rbac/routePermissions';

interface MenuItem {
  name: string;
  icon: ReactNode;
  path: string;
}

interface MenuGroup {
  label: string;
  items: MenuItem[];
}

interface AdminUser {
  token?: string;
  role?: string;
  permissions?: string[];
  [key: string]: unknown;
}

const adminMenuGroups: MenuGroup[] = [
  {
    label: 'Overview',
    items: [
      { name: 'Dashboard', icon: <LayoutDashboard size={13} />, path: '/dashboard' },
    ],
  },
  {
    label: 'Analytics',
    items: [
      { name: 'Analytics Dashboard',    icon: <BarChart2 size={13} />,    path: '/analytics' },
      { name: 'Organization Analytics', icon: <PieChart size={13} />,     path: '/analytics/organizations' },
      { name: 'Store Performance',      icon: <TrendingUp size={13} />,   path: '/analytics/stores' },
      { name: 'User Activity',          icon: <Activity size={13} />,     path: '/analytics/users' },
    ],
  },
  {
    label: 'Management',
    items: [
      { name: 'Organization / Store', icon: <Building2 size={13} />, path: '/org-store' },
      { name: 'Vendor Onboardings', icon: <FileText size={13} />, path: '/vendor-onboardings' },
      { name: 'Contracts',          icon: <FileText size={13} />, path: '/contracts' },
      { name: 'States',           icon: <MapPin size={13} />,    path: '/states' },
      { name: 'Vendor Templates', icon: <FileText size={13} />,  path: '/vendor-templates' },
      { name: 'Roles',            icon: <Shield size={13} />,    path: '/roles' },
    ],
  },
  {
    label: 'Payments',
    items: [
      { name: 'Merchants (Dejavoo)', icon: <CreditCard size={13} />, path: '/merchants' },
      { name: 'Payment Models',      icon: <Percent size={13} />,    path: '/payment-models' },
      { name: 'Pricing Tiers',       icon: <Percent size={13} />,    path: '/pricing-tiers' },
      { name: 'Subscription Plans',  icon: <CreditCard size={13} />, path: '/plans' },
      { name: 'SaaS Margin',         icon: <Percent size={13} />,    path: '/saas-margin' },
    ],
  },
  {
    label: 'Sales Tools',
    items: [
      { name: 'Price Calculator', icon: <Calculator size={13} />, path: '/price-calculator' },
    ],
  },
  {
    label: 'Lottery',
    items: [
      { name: 'Ticket Catalog',   icon: <Ticket size={13} />, path: '/lottery' },
    ],
  },
  {
    label: 'Content',
    items: [
      { name: 'CMS Pages', icon: <FileText size={13} />,  path: '/cms' },
      { name: 'Careers',   icon: <Briefcase size={13} />, path: '/careers' },
    ],
  },
  {
    label: 'Billing',
    items: [
      { name: 'Billing Console', icon: <FileText size={13} />, path: '/billing' },
    ],
  },
  {
    label: 'Support',
    items: [
      { name: 'Chat',          icon: <MessageSquare size={13} />, path: '/chat' },
      { name: 'Tickets',       icon: <Ticket size={13} />,        path: '/tickets' },
      { name: 'Notifications', icon: <Megaphone size={13} />,     path: '/notifications' },
      { name: 'AI Review Queue', icon: <Sparkles size={13} />,    path: '/ai-reviews' },
      { name: 'AI Knowledge Base', icon: <BookOpen size={13} />,  path: '/ai-kb' },
      { name: 'AI Product Tours',  icon: <Compass size={13} />,   path: '/ai-tours' },
      { name: 'System Config', icon: <Settings size={13} />,      path: '/config' },
    ],
  },
  {
    label: 'Account',
    items: [
      { name: 'My Profile', icon: <UserCircle size={13} />, path: '/profile' },
    ],
  },
];

const AdminSidebar = () => {
  const navigate  = useNavigate();
  const location  = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [chatUnread, setChatUnread] = useState(0);

  // Read effective permissions once on mount (written to localStorage by
  // /login and refreshed by <PermissionRoute>). Superadmins see everything.
  const user = useMemo<AdminUser | null>(() => {
    try { return JSON.parse(localStorage.getItem('admin_user') || 'null'); } catch { return null; }
  }, []);
  const perms = user?.permissions || [];
  const canView = useCallback((path: string) => {
    if (user?.role === 'superadmin') return true;
    const required = getRoutePermission(path);
    return !required || perms.includes(required);
  }, [user, perms]);

  const visibleMenuGroups = useMemo(() => (
    adminMenuGroups
      .map(g => ({ ...g, items: g.items.filter(i => canView(i.path)) }))
      .filter(g => g.items.length > 0)
  ), [canView]);

  const fetchUnread = useCallback(() => {
    api.get('/chat/unread')
      .then(res => setChatUnread(res.data?.count || 0))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchUnread();
    const iv = setInterval(fetchUnread, 15000);
    return () => clearInterval(iv);
  }, [fetchUnread]);

  useEffect(() => {
    if (location.pathname === '/chat') setChatUnread(0);
  }, [location.pathname]);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [mobileOpen]);

  const handleLogout = () => {
    localStorage.removeItem('admin_user');
    navigate('/login');
  };

  return (
    <>
      <button
        className="mobile-menu-btn"
        onClick={() => setMobileOpen(true)}
        aria-label="Open navigation"
      >
        <Menu size={20} />
      </button>

      {mobileOpen && (
        <div className="sidebar-overlay" onClick={() => setMobileOpen(false)} />
      )}

      <aside className={`sidebar ${mobileOpen ? 'mobile-open' : ''}`}>
        <button
          className="sidebar-close-btn"
          onClick={() => setMobileOpen(false)}
          aria-label="Close navigation"
        >
          <X size={18} />
        </button>

        {/* Logo */}
        <div className="asb-logo-wrap">
          <StoreveuLogo height={70} darkMode={false} />
        </div>

        {/* Admin badge */}
        <div className="asb-admin-badge">
          <Shield size={11} />
          SUPER ADMIN PANEL
        </div>

        {/* Navigation */}
        <nav className="sidebar-menu">
          {visibleMenuGroups.map((group) => (
            <div key={group.label} className="nav-group">
              <span className="nav-group-label">{group.label}</span>
              {group.items.map((item) => {
                const badge = item.path === '/chat' && chatUnread > 0 ? chatUnread : 0;
                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    end
                    className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                  >
                    <span className="nav-icon">{item.icon}</span>
                    <span className="nav-text">{item.name}</span>
                    {badge > 0 && <span className="nav-badge">{badge > 99 ? '99+' : badge}</span>}
                  </NavLink>
                );
              })}
            </div>
          ))}

          <button
            onClick={handleLogout}
            className="nav-link nav-link-logout"
          >
            <span className="nav-icon"><LogOut size={13} /></span>
            <span className="nav-text">Logout</span>
          </button>
        </nav>
      </aside>
    </>
  );
};

export default AdminSidebar;
