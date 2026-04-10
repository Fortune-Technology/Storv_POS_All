/**
 * RulesAndFees — Tabbed hub for deposit and tax rule management
 * Tabs: Deposit Rules, Tax Rules
 */
import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Recycle, Percent } from 'lucide-react';
import Sidebar from '../components/Sidebar';
import DepositRules from './DepositRules';
import TaxRules from './TaxRules';
import '../styles/portal.css';

const TABS = [
  { key: 'deposits', label: 'Deposit Rules', icon: <Recycle size={14} /> },
  { key: 'tax',      label: 'Tax Rules',     icon: <Percent size={14} /> },
];

export default function RulesAndFees() {
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') || 'deposits';
  const [tab, setTab] = useState(initialTab);

  return (
    <div className="layout-container">
      <Sidebar />
      <main className="main-content">
        <div className="p-page">
          <div className="p-header">
            <div className="p-header-left">
              <div className="p-header-icon"><Recycle size={22} /></div>
              <div>
                <h1 className="p-title">Rules & Fees</h1>
                <p className="p-subtitle">Manage container deposit rules and sales tax configuration</p>
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

          {tab === 'deposits' && <DepositRules embedded />}
          {tab === 'tax'      && <TaxRules embedded />}
        </div>
      </main>
    </div>
  );
}
