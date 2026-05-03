/**
 * PortalNavbar — top bar visible across every /portal/* page.
 *
 * Mounted in Layout.jsx above the sidebar + main-content row.
 * Hosts the "signed in as" user card, the notification bell, and the
 * logout button. Replaces what used to live at the bottom of Sidebar.
 */

import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import NotificationBell from './NotificationBell';
import './PortalNavbar.css';

const ROLE_LABEL = {
  superadmin: 'Super Admin',
  admin:      'Admin',
  owner:      'Owner',
  manager:    'Manager',
  cashier:    'Cashier',
  staff:      'Staff',
};

function readUser() {
  try {
    const raw = localStorage.getItem('user');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export default function PortalNavbar() {
  const navigate = useNavigate();

  // Read once on mount — sidebar's user card has the same pattern.
  const currentUser = React.useMemo(readUser, []);

  if (!currentUser) return null;

  const roleLabel = ROLE_LABEL[currentUser.role] || currentUser.role || '';
  const initials = (currentUser.name || currentUser.email || '?')
    .split(/[\s@]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0].toUpperCase())
    .join('');

  const handleLogout = () => {
    localStorage.removeItem('user');
    localStorage.removeItem('activeStoreId');
    navigate('/login');
  };

  return (
    <header className="portal-navbar">
      {/* Spacer pushes everything to the right.
          The left side stays empty here — the sidebar already shows the
          brand logo, so duplicating it would steal horizontal space. */}
      <div className="portal-navbar-spacer" />

      <div className="portal-navbar-actions">
        <NotificationBell />

        <NavLink
          to="/portal/my-profile"
          className="portal-navbar-user"
          title={`${currentUser.email || ''} — click to edit your profile`}
        >
          <div className="portal-navbar-avatar">{initials}</div>
          <div className="portal-navbar-user-meta">
            <div className="portal-navbar-user-name">
              {currentUser.name || currentUser.email || 'User'}
            </div>
            <div className="portal-navbar-user-role">
              {roleLabel}
              {currentUser.email && (
                <span className="portal-navbar-user-email"> · {currentUser.email}</span>
              )}
            </div>
          </div>
        </NavLink>

        <button
          type="button"
          className="portal-navbar-logout"
          onClick={handleLogout}
          title="Sign out"
        >
          <LogOut size={15} />
          <span>Logout</span>
        </button>
      </div>
    </header>
  );
}
