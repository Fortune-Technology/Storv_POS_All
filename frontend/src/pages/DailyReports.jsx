/**
 * DailyReports — Tabbed hub for the three daily-close report surfaces.
 *
 * Session 66 — consolidated three formerly standalone single-page sidebar
 * entries (End of Day / Daily Sale / Dual Pricing Report) into one hub.
 * Each child page accepts `embedded` to skip its own page-header chrome
 * so the hub owns the page title.
 *
 * Tab keys map to the legacy URLs as redirect targets:
 *   /portal/end-of-day          → /portal/daily-reports?tab=eod
 *   /portal/daily-sale          → /portal/daily-reports?tab=sale
 *   /portal/dual-pricing-report → /portal/daily-reports?tab=dual-pricing
 */
import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarCheck, FileText, Calculator, Percent } from 'lucide-react';
import EndOfDayReport from './EndOfDayReport';
import DailySale from './DailySale';
import DualPricingReport from './DualPricingReport';
import '../styles/portal.css';

const TABS = [
  { key: 'eod',          label: 'End of Day',   icon: <FileText size={14} /> },
  { key: 'sale',         label: 'Daily Sale',   icon: <Calculator size={14} /> },
  { key: 'dual-pricing', label: 'Dual Pricing', icon: <Percent size={14} /> },
];

export default function DailyReports() {
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') || 'eod';
  const [tab, setTab] = useState(initialTab);

  return (
    <div className="p-page">
      <div className="p-header">
        <div className="p-header-left">
          <div className="p-header-icon"><CalendarCheck size={22} /></div>
          <div>
            <h1 className="p-title">Daily Reports</h1>
            <p className="p-subtitle">End-of-day reconciliation, daily sale entry, and dual-pricing surcharge audit</p>
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

      {tab === 'eod'          && <EndOfDayReport embedded />}
      {tab === 'sale'         && <DailySale embedded />}
      {tab === 'dual-pricing' && <DualPricingReport embedded />}
    </div>
  );
}
