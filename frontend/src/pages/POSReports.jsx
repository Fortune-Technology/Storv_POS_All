/**
 * POSReports — Tabbed hub for transaction history and reports
 * Tabs: Transactions, Event Log, Employee Reports, Payouts, Employees (timesheet)
 */
import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Receipt, ClipboardList, ArrowUpCircle } from 'lucide-react';
import Transactions from './Transactions';
import PosEventLog from './PosEventLog';
import PayoutsReport from './PayoutsReport';
import '../styles/portal.css';
import './POSReports.css';

const TABS = [
  { key: 'transactions', label: 'Transactions', icon: <Receipt size={14} /> },
  { key: 'events',       label: 'Event Log',    icon: <ClipboardList size={14} /> },
  { key: 'payouts',      label: 'Payouts',      icon: <ArrowUpCircle size={14} /> },
];

export default function POSReports() {
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') || 'transactions';
  const [tab, setTab] = useState(initialTab);

  return (
    <div className="p-page">
      <div className="p-header">
        <div className="p-header-left">
          <div className="p-header-icon"><Receipt size={22} /></div>
          <div>
            <h1 className="p-title">Transactions</h1>
            <p className="p-subtitle">Transaction history, employee performance, event logs, and timesheets</p>
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

      {tab === 'transactions' && <Transactions embedded />}
      {tab === 'events'       && <PosEventLog embedded />}
      {tab === 'payouts'      && <PayoutsReport embedded />}
    </div>
  );
}

