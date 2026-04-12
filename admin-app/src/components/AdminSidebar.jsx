import React, { useState, useEffect, useCallback } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import StoreveuLogo from './StoreveuLogo';
import './AdminSidebar.css';
import {
  LayoutDashboard,
  Users,
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
  Store,
  CreditCard,
  MessageSquare,
} from 'lucide-react';
import api from '../services/api';

const adminMenuGroups = [
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
      { name: 'Users',         icon: <Users size={13} />,     path: '/users' },
      { name: 'Organizations', icon: <Building2 size={13} />, path: '/organizations' },
      { name: 'Stores',        icon: <Store size={13} />,     path: '/stores' },
    ],
  },
  {
    label: 'Payments',
    items: [
      { name: 'Payment Management', icon: <CreditCard size={13} />, path: '/payment' },
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
      { name: 'System Config', icon: <Settings size={13} />,      path: '/config' },
    ],
  },
];

const AdminSidebar = () => {
  const navigate  = useNavigate();
  const location  = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [chatUnread, setChatUnread] = useState(0);

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
          {adminMenuGroups.map((group) => (
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
