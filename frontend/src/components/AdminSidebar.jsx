import React, { useState, useEffect } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import StoreveuLogo from './StoreveuLogo';
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
} from 'lucide-react';

const adminMenuGroups = [
  {
    label: 'Overview',
    items: [
      { name: 'Dashboard', icon: <LayoutDashboard size={13} />, path: '/admin' },
    ],
  },
  {
    label: 'Analytics',
    items: [
      { name: 'Analytics Dashboard',    icon: <BarChart2 size={13} />,    path: '/admin/analytics' },
      { name: 'Organization Analytics', icon: <PieChart size={13} />,     path: '/admin/analytics/organizations' },
      { name: 'Store Performance',      icon: <TrendingUp size={13} />,   path: '/admin/analytics/stores' },
      { name: 'User Activity',          icon: <Activity size={13} />,     path: '/admin/analytics/users' },
    ],
  },
  {
    label: 'Management',
    items: [
      { name: 'Users',         icon: <Users size={13} />,     path: '/admin/users' },
      { name: 'Organizations', icon: <Building2 size={13} />, path: '/admin/organizations' },
    ],
  },
  {
    label: 'Content',
    items: [
      { name: 'CMS Pages', icon: <FileText size={13} />,  path: '/admin/cms' },
      { name: 'Careers',   icon: <Briefcase size={13} />, path: '/admin/careers' },
    ],
  },
  {
    label: 'Support',
    items: [
      { name: 'Tickets',       icon: <Ticket size={13} />,   path: '/admin/tickets' },
      { name: 'System Config', icon: <Settings size={13} />,  path: '/admin/config' },
    ],
  },
];

const AdminSidebar = () => {
  const navigate  = useNavigate();
  const location  = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

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
    localStorage.removeItem('user');
    localStorage.removeItem('activeStoreId');
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
        <div style={{ padding: '0.5rem 0.5rem 0.75rem', display: 'flex', justifyContent: 'center' }}>
          <StoreveuLogo height={70} darkMode={false} />
        </div>

        {/* Admin badge */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.375rem',
          padding: '0.375rem 0.75rem', margin: '0 0.75rem 0.75rem',
          background: 'rgba(239, 68, 68, 0.08)', borderRadius: '6px',
          color: '#ef4444', fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.05em',
          border: '1px solid rgba(239, 68, 68, 0.15)',
        }}>
          <Shield size={11} />
          SUPER ADMIN PANEL
        </div>

        {/* Navigation */}
        <nav className="sidebar-menu">
          {adminMenuGroups.map((group) => (
            <div key={group.label} className="nav-group">
              <span className="nav-group-label">{group.label}</span>
              {group.items.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  end
                  className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
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

export default AdminSidebar;
