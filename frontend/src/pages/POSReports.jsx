/**
 * POSReports — Tabbed hub for transaction history and reports
 * Tabs: Transactions, Event Log, Employee Reports, Payouts, Employees (timesheet)
 */
import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Receipt, ClipboardList, Clock, ArrowUpCircle, UserCheck } from 'lucide-react';
import Sidebar from '../components/Sidebar';
import Transactions from './Transactions';
import PosEventLog from './PosEventLog';
import EmployeeReports from './EmployeeReports';
import PayoutsReport from './PayoutsReport';
import '../styles/portal.css';

const TABS = [
  { key: 'transactions', label: 'Transactions',     icon: <Receipt size={14} /> },
  { key: 'events',       label: 'Event Log',        icon: <ClipboardList size={14} /> },
  { key: 'employee',     label: 'Employee Reports', icon: <Clock size={14} /> },
  { key: 'payouts',      label: 'Payouts',          icon: <ArrowUpCircle size={14} /> },
  { key: 'employees',    label: 'Employees',        icon: <UserCheck size={14} /> },
];

export default function POSReports() {
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') || 'transactions';
  const [tab, setTab] = useState(initialTab);

  return (
    <div className="layout-container">
      <Sidebar />
      <main className="main-content">
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
          {tab === 'employee'     && <EmployeeReports embedded />}
          {tab === 'payouts'      && <PayoutsReport embedded />}
          {tab === 'employees'    && <EmployeesTab />}
        </div>
      </main>
    </div>
  );
}

/* ── Employees Timesheet Tab (placeholder — ready for implementation) ──── */
function EmployeesTab() {
  return (
    <div className="p-card" style={{ textAlign: 'center', padding: '3rem 1.5rem' }}>
      <UserCheck size={48} color="var(--text-muted)" style={{ opacity: 0.25, marginBottom: 12 }} />
      <h3 style={{ margin: '0 0 6px', color: 'var(--text-primary)', fontWeight: 700 }}>Employee Timesheet Management</h3>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>
        Clock-in/out tracking, shift schedules, and timesheet approvals — coming soon.
      </p>
    </div>
  );
}
