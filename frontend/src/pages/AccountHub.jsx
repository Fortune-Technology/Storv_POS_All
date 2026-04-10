/**
 * AccountHub — Tabbed hub for account/organisation settings
 * Tabs: Organisation, Users, Stores, Store Settings
 */
import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Building2, Users, Store, Settings2 } from 'lucide-react';
import Organisation from './Organisation';
import UserManagement from './UserManagement';
import StoreManagement from './StoreManagement';
import StoreSettings from './StoreSettings';
import '../styles/portal.css';

const TABS = [
  { key: 'organisation', label: 'Organisation',  icon: <Building2 size={14} /> },
  { key: 'users',        label: 'Users',         icon: <Users size={14} /> },
  { key: 'stores',       label: 'Stores',        icon: <Store size={14} /> },
  { key: 'settings',     label: 'Store Settings', icon: <Settings2 size={14} /> },
];

export default function AccountHub() {
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') || 'organisation';
  const [tab, setTab] = useState(initialTab);

  return (
    <div className="p-page">
      <div className="p-header">
        <div className="p-header-left">
          <div className="p-header-icon"><Building2 size={22} /></div>
          <div>
            <h1 className="p-title">Account Settings</h1>
            <p className="p-subtitle">Manage your organisation, team members, stores, and store-level settings</p>
          </div>
        </div>
      </div>

      <div className="p-tabs">
        {TABS.map(t => (
          <button key={t.key} className={`p-tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab === 'organisation' && <Organisation embedded />}
      {tab === 'users'        && <UserManagement embedded />}
      {tab === 'stores'       && <StoreManagement embedded />}
      {tab === 'settings'     && <StoreSettings embedded />}
    </div>
  );
}
