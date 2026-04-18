import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { getChatUnread } from '../services/api';
import StoreveuLogo from './StoreveuLogo';
import {
  Radio,
  Users,
  FileUp,
  BarChart2,
  PieChart,
  TrendingUp,
  ShoppingCart,
  ClipboardList,
  Zap,
  Globe,
  LogOut,
  Menu,
  X,
  Building2,
  Store,
  Package,
  Monitor,
  Tv2,
  Receipt,
  FileText,
  Clock,
  Layers,
  Truck,
  Tag,
  Upload,
  Ticket,
  Fuel,
  Star,
  ArrowUpCircle,
  Recycle,
  Percent,
  LayoutGrid,
  Settings2,
  MessageSquare,
  CreditCard,
  CheckSquare,
  Shield,
} from 'lucide-react';
import StoreSwitcher from './StoreSwitcher';

const menuGroups = [
  {
    label: 'Operations',
    items: [
      { name: 'Live Dashboard', icon: <Radio size={13} />, path: '/portal/realtime' },
      { name: 'Chat', icon: <MessageSquare size={13} />, path: '/portal/chat' },
      { name: 'Tasks', icon: <CheckSquare size={13} />, path: '/portal/tasks' },
    ],
  },
  {
    label: 'Customers',
    items: [
      { name: 'Customers & Loyalty', icon: <Users size={13} />, path: '/portal/customers-hub' },
    ],
  },
  {
    label: 'Lottery',
    items: [
      { name: 'Lottery', icon: <Ticket size={13} />, path: '/portal/lottery' },
    ],
  },
  {
    label: 'Fuel',
    items: [
      { name: 'Fuel', icon: <Fuel size={13} />, path: '/portal/fuel' },
    ],
  },
  {
    label: 'Catalog',
    items: [
      { name: 'Products', icon: <Package size={13} />, path: '/portal/catalog' },
      { name: 'Product Groups', icon: <Users size={13} />, path: '/portal/product-groups' },
      { name: 'Departments', icon: <Layers size={13} />, path: '/portal/departments' },
      { name: 'Promotions', icon: <Tag size={13} />, path: '/portal/promotions' },
      { name: 'Bulk Import', icon: <Upload size={13} />, path: '/portal/import' },
      { name: 'Inventory Count', icon: <BarChart2 size={13} />, path: '/portal/inventory-count' },
      { name: 'Label Queue', icon: <Tag size={13} />, path: '/portal/label-queue' },
    ],
  },
  {
    label: 'Vendors',
    items: [
      { name: 'Vendors', icon: <Truck size={13} />, path: '/portal/vendors' },
      { name: 'Vendor Payouts', icon: <ArrowUpCircle size={13} />, path: '/portal/vendor-payouts' },
      { name: 'Vendor Orders', icon: <Package size={13} />, path: '/portal/vendor-orders' },
      { name: 'Invoice Import', icon: <FileUp size={13} />, path: '/portal/invoice-import' },
      { name: 'CSV Transform', icon: <Upload size={13} />, path: '/csv/upload' },
    ],
  },
  {
    label: 'Reports & Analytics',
    items: [
      { name: 'Transactions', icon: <Receipt size={13} />, path: '/portal/pos-reports' },
      { name: 'Analytics', icon: <BarChart2 size={13} />, path: '/portal/analytics' },
      { name: 'Employees', icon: <Users size={13} />, path: '/portal/employees' },
      { name: 'Reports', icon: <FileText size={13} />, path: '/portal/reports' },
      { name: 'End of Day', icon: <FileText size={13} />, path: '/portal/end-of-day' },
      { name: 'Audit Log', icon: <Shield size={13} />, path: '/portal/audit' },
    ],
  },
  {
    label: 'Online Store',
    items: [
      { name: 'Store Setup',     icon: <Settings2 size={13} />,    path: '/portal/ecom/setup' },
      { name: 'Online Orders',   icon: <ShoppingCart size={13} />,  path: '/portal/ecom/orders' },
      { name: 'Analytics',       icon: <BarChart2 size={13} />,    path: '/portal/ecom/analytics' },
    ],
  },
  {
    label: 'Integrations',
    items: [
      { name: 'POS API', icon: <Zap size={13} />, path: '/portal/pos-api' },
      { name: 'Delivery Platforms', icon: <Globe size={13} />, path: '/portal/integrations' },
    ],
  },
  {
    label: 'Point of Sale',
    items: [
      { name: 'POS Configuration', icon: <Monitor size={13} />, path: '/portal/pos-config' },
      { name: 'Rules & Fees', icon: <Recycle size={13} />, path: '/portal/rules' },
    ],
  },
  {
    label: 'Support & Billing',
    items: [
      { name: 'Support Tickets', icon: <MessageSquare size={13} />, path: '/portal/support-tickets' },
      { name: 'Billing & Plan', icon: <CreditCard size={13} />, path: '/portal/billing' },
    ],
  },
  {
    label: 'Account',
    items: [
      { name: 'Account Settings', icon: <Building2 size={13} />, path: '/portal/account' },
    ],
  },
];

const Sidebar = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [chatUnread, setChatUnread] = useState(0);

  // ── Poll chat unread count every 15 s ────────────────────────────────────
  const fetchUnread = useCallback(() => {
    getChatUnread()
      .then(data => setChatUnread(data?.count || 0))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchUnread();
    const iv = setInterval(fetchUnread, 15000);
    return () => clearInterval(iv);
  }, [fetchUnread]);

  // Clear badge when navigating to chat page
  useEffect(() => {
    if (location.pathname === '/portal/chat') setChatUnread(0);
  }, [location.pathname]);

  // ── Persist sidebar scroll position across route changes ─────────────────
  // Each page mounts its own <Sidebar />, so scrollTop resets on navigation.
  // We save scrollTop to sessionStorage and restore it with useLayoutEffect
  // (before paint) to avoid a flash of scrollTop=0.
  const asideRef = useRef(null);

  useLayoutEffect(() => {
    const saved = sessionStorage.getItem('sidebar-scroll-y');
    if (saved && asideRef.current) {
      asideRef.current.scrollTop = parseInt(saved, 10);
    }
  }, []); // runs once on every mount (= every navigation)

  // Close sidebar whenever the route changes (user tapped a link on mobile)
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  // Prevent body scroll when mobile drawer is open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [mobileOpen]);

  const handleLogout = () => {
    localStorage.removeItem('user');
    localStorage.removeItem('activeStoreId');
    navigate('/login');
  };

  return (
    <>
      {/* ── Hamburger button (mobile only, shown via CSS) ── */}
      <button
        className="mobile-menu-btn"
        onClick={() => setMobileOpen(true)}
        aria-label="Open navigation"
      >
        <Menu size={20} />
      </button>

      {/* ── Tap-to-close overlay ── */}
      {mobileOpen && (
        <div className="sidebar-overlay" onClick={() => setMobileOpen(false)} />
      )}

      {/* ── Sidebar drawer ── */}
      <aside
        ref={asideRef}
        className={`sidebar ${mobileOpen ? 'mobile-open' : ''}`}
        onScroll={e => sessionStorage.setItem('sidebar-scroll-y', e.currentTarget.scrollTop)}
      >

        {/* Mobile close button inside drawer */}
        <button
          className="sidebar-close-btn"
          onClick={() => setMobileOpen(false)}
          aria-label="Close navigation"
        >
          <X size={18} />
        </button>

        {/* Logo */}
        <div style={{ padding: '0.5rem 0.5rem 0.75rem', display: 'flex', justifyContent: 'center' }}>
          <StoreveuLogo height={70} darkMode={false} />
        </div>

        {/* ── Store Switcher ───────────────────────────────────────────── */}
        <StoreSwitcher />

        {/* ── Navigation ──────────────────────────────────────────────── */}
        <nav className="sidebar-menu">
          {menuGroups.map((group) => (
            <div key={group.label} className="nav-group">
              <span className="nav-group-label">{group.label}</span>
              {group.items.map((item) => {
                const badge = item.path === '/portal/chat' && chatUnread > 0 ? chatUnread : 0;
                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                    onClick={(e) => {
                      if (location.pathname === item.path) e.preventDefault();
                    }}
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

export default Sidebar;
