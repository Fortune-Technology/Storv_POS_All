import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
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
  Star,
  ArrowUpCircle,
  Recycle,
  Percent,
  LayoutGrid,
  Settings2,
  MessageSquare,
} from 'lucide-react';
import StoreSwitcher from './StoreSwitcher';

const menuGroups = [
  {
    label: 'Operations',
    items: [
      { name: 'Live Dashboard', icon: <Radio size={13} />, path: '/portal/realtime' },
      { name: 'Customers', icon: <Users size={13} />, path: '/portal/customers' },
    ],
  },
  {
    label: 'Loyalty & Lottery',
    items: [
      { name: 'Loyalty Program', icon: <Star size={13} />, path: '/portal/loyalty' },
      { name: 'Lottery', icon: <Ticket size={13} />, path: '/portal/lottery' },
    ],
  },
  {
    label: 'Catalog',
    items: [
      { name: 'Products', icon: <Package size={13} />, path: '/portal/catalog' },
      { name: 'Departments', icon: <Layers size={13} />, path: '/portal/departments' },
      { name: 'Promotions', icon: <Tag size={13} />, path: '/portal/promotions' },
      { name: 'Bulk Import', icon: <Upload size={13} />, path: '/portal/import' },
      { name: 'Inventory Count', icon: <BarChart2 size={13} />, path: '/portal/inventory-count' },
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
    label: 'Analytics',
    items: [
      { name: 'Sales', icon: <BarChart2 size={13} />, path: '/portal/sales' },
      { name: 'Dept Analytics', icon: <PieChart size={13} />, path: '/portal/departments-analytics' },
      { name: 'Products', icon: <ShoppingCart size={13} />, path: '/portal/products-analytics' },
      { name: 'Predictions', icon: <TrendingUp size={13} />, path: '/portal/predictions' },
    ],
  },
  {
    label: 'Online Store',
    items: [
      { name: 'Store Setup', icon: <Settings2 size={13} />, path: '/portal/ecom/setup' },
      { name: 'Online Orders', icon: <ShoppingCart size={13} />, path: '/portal/ecom/orders' },
      { name: 'Custom Domain', icon: <Globe size={13} />, path: '/portal/ecom/domain' },
    ],
  },
  {
    label: 'Integrations',
    items: [
      { name: 'POS API', icon: <Zap size={13} />, path: '/portal/pos-api' },
      { name: 'eComm', icon: <Globe size={13} />, path: '/portal/ecomm' },
    ],
  },
  {
    label: 'Point of Sale',
    items: [
      { name: 'POS Settings', icon: <Monitor size={13} />, path: '/portal/pos-settings' },
      { name: 'Receipt Settings', icon: <FileText size={13} />, path: '/portal/receipt-settings' },
      { name: 'Stations', icon: <Tv2 size={13} />, path: '/portal/stations' },
      { name: 'Transactions', icon: <Receipt size={13} />, path: '/portal/transactions' },
      { name: 'Event Log', icon: <ClipboardList size={13} />, path: '/portal/pos-event-log' },
      { name: 'Employee Reports', icon: <Clock size={13} />, path: '/portal/employee-reports' },
      { name: 'Payouts Report', icon: <ArrowUpCircle size={13} />, path: '/portal/payouts' },
      { name: 'Deposit Rules', icon: <Recycle size={13} />, path: '/portal/deposit-rules' },
      { name: 'Tax Rules', icon: <Percent size={13} />, path: '/portal/tax-rules' },
      { name: 'Quick Access', icon: <LayoutGrid size={13} />, path: '/portal/quick-access' },
    ],
  },
  {
    label: 'Support',
    items: [
      { name: 'Support Tickets', icon: <MessageSquare size={13} />, path: '/portal/support-tickets' },
    ],
  },
  {
    label: 'Account',
    items: [
      { name: 'Organisation', icon: <Building2 size={13} />, path: '/portal/organisation' },
      { name: 'Users', icon: <Users size={13} />, path: '/portal/users' },
      { name: 'Stores', icon: <Store size={13} />, path: '/portal/stores' },
      { name: 'Store Settings', icon: <Settings2 size={13} />, path: '/portal/store-settings' },
    ],
  },
];

const Sidebar = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

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
              {group.items.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                  onClick={(e) => {
                    // Prevent re-navigation (and page scroll reset) when already on this route
                    if (location.pathname === item.path) e.preventDefault();
                  }}
                >
                  <span className="nav-icon">{item.icon}</span>
                  <span className="nav-text">{item.name}</span>
                </NavLink>
              ))}
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
