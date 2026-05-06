/**
 * CustomersHub — Tabbed hub for customer management + loyalty program
 * Tabs: Customers, Loyalty Settings, Loyalty Earn Rules, Loyalty Rewards
 */
import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Users, Settings, Zap, Gift } from 'lucide-react';
import Customers from './Customers';
import LoyaltyProgram from './LoyaltyProgram';
import usePlanModules from '../hooks/usePlanModules';
import '../styles/portal.css';

// S80 — `module` field gates the tab. Loyalty tabs hidden if module not subscribed.
const TABS = [
  { key: 'customers',        label: 'Customers',            icon: <Users size={14} />,    loyaltyTab: null,         module: null },
  { key: 'loyalty-settings', label: 'Loyalty Settings',     icon: <Settings size={14} />, loyaltyTab: 'settings',   module: 'loyalty' },
  { key: 'loyalty-earn',     label: 'Loyalty Earn Rules',   icon: <Zap size={14} />,      loyaltyTab: 'earn-rules', module: 'loyalty' },
  { key: 'loyalty-rewards',  label: 'Loyalty Rewards',      icon: <Gift size={14} />,     loyaltyTab: 'rewards',    module: 'loyalty' },
];

// Legacy alias — old "loyalty" key lands on Settings
const LEGACY_MAP = { loyalty: 'loyalty-settings' };

export default function CustomersHub() {
  const [searchParams] = useSearchParams();
  const { has } = usePlanModules();
  const visibleTabs = TABS.filter(t => !t.module || has(t.module));
  const rawInitial = searchParams.get('tab') || 'customers';
  const initialTab = LEGACY_MAP[rawInitial] || rawInitial;
  const [tab, setTab] = useState(
    visibleTabs.some(t => t.key === initialTab) ? initialTab : 'customers'
  );

  const activeTab = visibleTabs.find(t => t.key === tab) || visibleTabs[0];

  return (
    <div className="p-page">
      <div className="p-header">
        <div className="p-header-left">
          <div className="p-header-icon"><Users size={22} /></div>
          <div>
            <h1 className="p-title">Customers & Loyalty</h1>
            <p className="p-subtitle">Manage your customer database and loyalty rewards program</p>
          </div>
        </div>
      </div>

      <div className="p-tabs">
        {visibleTabs.map(t => (
          <button key={t.key} className={`p-tab ${activeTab?.key === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {activeTab?.key === 'customers' && <Customers embedded />}
      {activeTab?.loyaltyTab && has('loyalty') && (
        <LoyaltyProgram embedded hideHeader forceTab={activeTab.loyaltyTab} />
      )}
    </div>
  );
}
