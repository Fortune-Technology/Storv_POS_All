/**
 * POSConfig — Tabbed hub for POS configuration pages
 * Tabs: Layout & Settings, Receipt Settings, Quick Keys
 */
import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Monitor, FileText, LayoutGrid } from 'lucide-react';
import Sidebar from '../components/Sidebar';
import POSSettings from './POSSettings';
import ReceiptSettings from './ReceiptSettings';
import QuickAccess from './QuickAccess';
import '../styles/portal.css';

const TABS = [
  { key: 'layout',     label: 'Layout & Settings', icon: <Monitor size={14} /> },
  { key: 'receipts',   label: 'Receipt Settings',  icon: <FileText size={14} /> },
  { key: 'quick-keys', label: 'Quick Keys',        icon: <LayoutGrid size={14} /> },
];

export default function POSConfig() {
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') || 'layout';
  const [tab, setTab] = useState(initialTab);

  return (
    <div className="layout-container">
      <Sidebar />
      <main className="main-content">
        <div className="p-page">
          <div className="p-header">
            <div className="p-header-left">
              <div className="p-header-icon"><Monitor size={22} /></div>
              <div>
                <h1 className="p-title">POS Configuration</h1>
                <p className="p-subtitle">Manage your point of sale layout, receipts, and quick-access keys</p>
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

          {tab === 'layout'     && <POSSettings embedded />}
          {tab === 'receipts'   && <ReceiptSettings embedded />}
          {tab === 'quick-keys' && <QuickAccess embedded />}
        </div>
      </main>
    </div>
  );
}
