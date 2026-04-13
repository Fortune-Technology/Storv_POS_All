/**
 * EmployeeReports — Back-office employee hours + sales report.
 *
 * Unified view (no tabs):
 *   - Date range filters + Run Report
 *   - Summary stat cards (Employees, Total Hours, Transactions, Total Sales)
 *   - Employee table with expandable rows (clock sessions + per-employee PDF)
 *   - Export All as PDF
 *
 * API: GET /api/reports/employees
 */
import React, { useState } from 'react';
import api from '../services/api';
import {
  Users, Clock, ShoppingCart, DollarSign, RefreshCw,
  AlertCircle, FileText, ChevronDown,
} from 'lucide-react';
import { fmt$, todayStr, firstOfMonthStr } from '../utils/formatters';
import '../styles/portal.css';
import './EmployeeReports.css';

/* ── Helpers ─────────────────────────────────────────────────────────────── */
function fmtDate(iso) {
  if (!iso) return '\u2014';
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
function fmtTime(iso) {
  if (!iso) return '\u2014';
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}
function fmtMins(mins) {
  if (!mins && mins !== 0) return '\u2014';
  if (mins < 1) return '<1m';
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
function initials(name) {
  if (!name) return '?';
  return name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
}

/* ── PDF Generation ──────────────────────────────────────────────────────── */
function buildPDFHTML(employees, from, to) {
  const fmtD = iso => iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '\u2014';
  const fmtT = iso => iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '\u2014';
  const fmtM = m => { if (!m) return '0m'; const h = Math.floor(m / 60), r = m % 60; return h > 0 ? (r > 0 ? `${h}h ${r}m` : `${h}h`) : `${r}m`; };

  const sections = employees.map(emp => {
    const sessions = emp.sessions || [];
    const rows = sessions.length === 0
      ? '<tr><td colspan="4" style="text-align:center;color:#888;padding:12px;">No sessions</td></tr>'
      : sessions.map(s => `<tr><td>${fmtD(s.in)}</td><td>${fmtT(s.in)}</td><td>${s.out ? fmtT(s.out) : '<b style="color:#16a34a">\u25cf Active</b>'}</td><td><b>${fmtM(s.minutes)}</b></td></tr>`).join('');
    return `<div class="emp"><div class="name">${emp.name || emp.email}</div><div class="meta">${emp.email || ''}${emp.role ? ' \u00b7 ' + emp.role : ''}</div>
      <table><thead><tr><th>Date</th><th>Clock In</th><th>Clock Out</th><th>Duration</th></tr></thead><tbody>${rows}</tbody>
      <tfoot><tr><td colspan="3" style="text-align:right;font-weight:700;padding-top:8px;">Total</td><td style="font-weight:800;font-size:1.05em;padding-top:8px;">${(emp.hoursWorked||0).toFixed(1)} hrs</td></tr></tfoot></table></div>`;
  }).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Employee Timesheet</title>
    <style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:12px;color:#111;padding:24px 32px}
    .hdr{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;padding-bottom:12px;border-bottom:2px solid #3d56b5}
    .htitle{font-size:18px;font-weight:800}.hperiod{font-size:11px;color:#666;text-align:right}
    .emp{margin-bottom:24px;page-break-inside:avoid}.name{font-size:14px;font-weight:800}.meta{font-size:11px;color:#666;margin-bottom:8px}
    table{width:100%;border-collapse:collapse;margin-top:4px}th{background:#eaecf5;color:#3d56b5;text-align:left;padding:7px 10px;font-size:10px;text-transform:uppercase;border-bottom:1px solid #d1d5db}
    td{padding:6px 10px;border-bottom:1px solid #f1f5f9}tfoot td{border-top:1px solid #e2e8f0;border-bottom:none}
    .np{display:block;text-align:center;margin:20px auto}@media print{.np{display:none!important}}</style></head>
    <body><div class="hdr"><div><div class="htitle">Employee Timesheet</div></div>
    <div class="hperiod">Period: ${from} \u2014 ${to}<br/>Generated: ${new Date().toLocaleString()}</div></div>
    ${sections}<button class="np" onclick="window.print()" style="padding:10px 24px;background:#3d56b5;color:#fff;border:none;border-radius:6px;font-weight:700;cursor:pointer">Print / Save as PDF</button>
    </body></html>`;
}

function openPDFWindow(employees, from, to) {
  const w = window.open('', '_blank', 'width=860,height=700');
  if (!w) { alert('Pop-up blocked \u2014 please allow pop-ups for this site.'); return; }
  w.document.write(buildPDFHTML(employees, from, to));
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 400);
}

/* ── TimesheetCard — Expandable employee accordion row ───────────────────── */
function TimesheetCard({ emp, from, to }) {
  const [expanded, setExpanded] = useState(false);
  const sessions = emp.sessions || [];
  return (
    <div className={`er-accordion ${expanded ? 'er-accordion--open' : ''}`}>
      <div className="er-accordion-header" onClick={() => setExpanded(v => !v)}>
        <div className="er-accordion-left">
          <div className="er-avatar">{initials(emp.name)}</div>
          <div>
            <div className="er-emp-name">{emp.name || emp.email}</div>
            <div className="er-emp-meta">
              {emp.email}{emp.role ? ` \u00b7 ${emp.role}` : ''} \u00b7 {sessions.length} session{sessions.length !== 1 ? 's' : ''}
            </div>
          </div>
        </div>
        <div className="er-accordion-right">
          <span className="p-badge p-badge-amber er-hours-badge">
            <Clock size={12} />{(emp.hoursWorked || 0).toFixed(1)} hrs
          </span>
          {emp.transactions > 0 && (
            <span className="p-badge p-badge-green er-txn-badge">
              <ShoppingCart size={12} />{emp.transactions}
            </span>
          )}
          {emp.totalSales > 0 && (
            <span className="er-sales-value">{fmt$(emp.totalSales)}</span>
          )}
          <button className="p-btn-ghost p-btn-sm er-pdf-btn" onClick={e => { e.stopPropagation(); openPDFWindow([emp], from, to); }}>
            <FileText size={11} /> PDF
          </button>
          <ChevronDown size={15} className={`er-chevron ${expanded ? 'er-chevron--open' : ''}`} />
        </div>
      </div>
      {expanded && (
        <div className="er-accordion-body">
          {sessions.length === 0 ? (
            <div className="er-no-sessions">No clock events in this period</div>
          ) : (
            <>
              <div className="er-sessions-head">
                <span>Date</span><span>Clock In</span><span>Clock Out</span><span>Duration</span><span>Status</span>
              </div>
              {sessions.map((s, i) => (
                <div key={i} className="er-session-row">
                  <span className="er-session-date">{fmtDate(s.in)}</span>
                  <span className="er-session-time">{fmtTime(s.in)}</span>
                  <span className="er-session-time-out">{s.out ? fmtTime(s.out) : '\u2014'}</span>
                  <span className="er-session-dur">{fmtMins(s.minutes)}</span>
                  <span>{s.active && <span className="p-badge p-badge-green er-active-badge"><span className="er-dot" />Active</span>}</span>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Main Component ──────────────────────────────────────────────────────── */
export default function EmployeeReports({ embedded }) {
  const user    = (() => { try { return JSON.parse(localStorage.getItem('user')); } catch { return null; } })();
  const storeId = localStorage.getItem('activeStoreId') || user?.storeId;

  const [from,    setFrom]    = useState(firstOfMonthStr());
  const [to,      setTo]      = useState(todayStr());
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const [data,    setData]    = useState(null);

  const run = async () => {
    if (!storeId) { setError('No store selected.'); return; }
    setLoading(true); setError('');
    try {
      const res = await api.get('/reports/employees', { params: { storeId, from, to } });
      setData(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load employee report');
    } finally {
      setLoading(false);
    }
  };

  const employees    = data?.employees || [];
  const totalHours   = employees.reduce((s, e) => s + (e.hoursWorked || 0), 0);
  const totalTxns    = employees.reduce((s, e) => s + (e.transactions || 0), 0);
  const totalSales   = employees.reduce((s, e) => s + (e.totalSales || 0), 0);

  const stats = [
    { label: 'Employees',    value: employees.length,         icon: Users },
    { label: 'Total Hours',  value: totalHours.toFixed(1) + ' hrs', icon: Clock },
    { label: 'Transactions', value: totalTxns,                icon: ShoppingCart },
    { label: 'Total Sales',  value: fmt$(totalSales),         icon: DollarSign },
  ];

  const content = (
    <div className="er-page p-page">

      {/* Header */}
      <div className="p-header er-header">
        <div className="p-header-left">
          <div className="p-header-icon er-header-icon"><Users size={18} /></div>
          <div>
            <h1 className="er-title">Employee Reports</h1>
            <p className="er-subtitle">Clock hours, sales performance, and timesheet export</p>
          </div>
        </div>
        {data && employees.length > 0 && (
          <div className="p-header-actions">
            <button className="p-btn-secondary p-btn-sm er-export-all-btn" onClick={() => openPDFWindow(employees, from, to)}>
              <FileText size={13} /> Export All as PDF
            </button>
          </div>
        )}
      </div>

      {/* Date filters */}
      <div className="p-card er-filters">
        <div className="er-filter-group">
          <label className="er-filter-label">From</label>
          <input type="date" className="p-input er-date-input" value={from} onChange={e => setFrom(e.target.value)} />
        </div>
        <div className="er-filter-group">
          <label className="er-filter-label">To</label>
          <input type="date" className="p-input er-date-input" value={to} onChange={e => setTo(e.target.value)} />
        </div>
        <button
          onClick={run}
          disabled={loading}
          className={`p-btn-primary er-run-btn ${loading ? 'er-run-btn--loading' : ''}`}
        >
          <RefreshCw size={14} className={loading ? 'er-spinner' : ''} />
          {loading ? 'Loading\u2026' : 'Run Report'}
        </button>
      </div>

      {/* Error */}
      {error && <div className="er-error"><AlertCircle size={16} />{error}</div>}

      {/* Stat cards */}
      {data && (
        <div className="p-stat-grid">
          {stats.map(s => (
            <div key={s.label} className="p-stat-card">
              <div className="er-stat-header">
                <s.icon size={15} className="er-stat-icon" />
                <span className="p-stat-label">{s.label}</span>
              </div>
              <div className="p-stat-value">{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Employee accordion list */}
      {data && (
        <>
          {employees.length === 0 ? (
            <div className="p-empty">
              <Users size={36} />
              <div>No employee data found for this period.</div>
            </div>
          ) : (
            <div className="er-employee-list">
              {employees.map(emp => (
                <TimesheetCard key={emp.userId} emp={emp} from={from} to={to} />
              ))}
            </div>
          )}
          {data && employees.length > 0 && (
            <div className="er-period-note">
              Report period: {data.from?.slice(0, 10)} to {data.to?.slice(0, 10)}
            </div>
          )}
        </>
      )}

      {/* Prompt to run when no data yet */}
      {!data && !loading && !error && (
        <div className="p-empty">
          <Users size={36} />
          <div>Select a date range and click <strong>Run Report</strong> to load employee data.</div>
        </div>
      )}
    </div>
  );

  if (embedded) return content;
  return content;
}
