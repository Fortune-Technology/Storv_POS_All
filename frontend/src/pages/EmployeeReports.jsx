/**
 * EmployeeReports — Back-office employee hours + sales report.
 *
 * Tabs:
 *   Summary       — aggregate cards + per-employee table
 *   Timesheet     — expandable per-employee clock sessions + PDF export
 *   Manage Shifts — full CRUD: add / edit / delete clock sessions manually
 *
 * API: GET /api/reports/employees, GET /api/reports/clock-events, POST/PUT/DELETE /api/reports/clock-events
 */
import React, { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import {
  getClockEvents, createClockSession, updateClockEventEntry, deleteClockEventEntry, getStoreEmployees,
} from '../services/api';
import {
  Users, Clock, ShoppingCart, DollarSign, RefreshCw,
  AlertCircle, FileText, ChevronDown, Plus, Pencil, Trash2, Check, X as XIcon,
} from 'lucide-react';
import Sidebar from '../components/Sidebar';
import './EmployeeReports.css';

// ── Helpers ────────────────────────────────────────────────────────────────
function fmt$(n) {
  return '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function todayStr() { return new Date().toISOString().slice(0, 10); }
function firstOfMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}
function fmtMins(mins) {
  if (!mins && mins !== 0) return '—';
  if (mins < 1) return '<1m';
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
function initials(name) {
  if (!name) return '?';
  return name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
}
// Convert ISO datetime to local datetime-local input value (YYYY-MM-DDTHH:MM)
function isoToDatetimeLocal(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ── PDF Generation ─────────────────────────────────────────────────────────
function buildPDFHTML(employees, from, to) {
  const fmtD = iso => iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
  const fmtT = iso => iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '—';
  const fmtM = m => { if (!m) return '0m'; const h = Math.floor(m / 60), r = m % 60; return h > 0 ? (r > 0 ? `${h}h ${r}m` : `${h}h`) : `${r}m`; };

  const sections = employees.map(emp => {
    const sessions = emp.sessions || [];
    const rows = sessions.length === 0
      ? '<tr><td colspan="4" style="text-align:center;color:#888;padding:12px;">No sessions</td></tr>'
      : sessions.map(s => `<tr><td>${fmtD(s.in)}</td><td>${fmtT(s.in)}</td><td>${s.out ? fmtT(s.out) : '<b style="color:#16a34a">● Active</b>'}</td><td><b>${fmtM(s.minutes)}</b></td></tr>`).join('');
    return `<div class="emp"><div class="name">${emp.name || emp.email}</div><div class="meta">${emp.email || ''}${emp.role ? ' · ' + emp.role : ''}</div>
      <table><thead><tr><th>Date</th><th>Clock In</th><th>Clock Out</th><th>Duration</th></tr></thead><tbody>${rows}</tbody>
      <tfoot><tr><td colspan="3" style="text-align:right;font-weight:700;padding-top:8px;">Total</td><td style="font-weight:800;font-size:1.05em;padding-top:8px;">${(emp.hoursWorked||0).toFixed(1)} hrs</td></tr></tfoot></table></div>`;
  }).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Employee Timesheet</title>
    <style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:12px;color:#111;padding:24px 32px}
    .hdr{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;padding-bottom:12px;border-bottom:2px solid #16a34a}
    .htitle{font-size:18px;font-weight:800}.hperiod{font-size:11px;color:#666;text-align:right}
    .emp{margin-bottom:24px;page-break-inside:avoid}.name{font-size:14px;font-weight:800}.meta{font-size:11px;color:#666;margin-bottom:8px}
    table{width:100%;border-collapse:collapse;margin-top:4px}th{background:#f0fdf4;color:#15803d;text-align:left;padding:7px 10px;font-size:10px;text-transform:uppercase;border-bottom:1px solid #d1fae5}
    td{padding:6px 10px;border-bottom:1px solid #f1f5f9}tfoot td{border-top:1px solid #e2e8f0;border-bottom:none}
    .np{display:block;text-align:center;margin:20px auto}@media print{.np{display:none!important}}</style></head>
    <body><div class="hdr"><div><div class="htitle">Employee Timesheet</div></div>
    <div class="hperiod">Period: ${from} — ${to}<br/>Generated: ${new Date().toLocaleString()}</div></div>
    ${sections}<button class="np" onclick="window.print()" style="padding:10px 24px;background:#16a34a;color:#fff;border:none;border-radius:6px;font-weight:700;cursor:pointer">🖨 Print / Save as PDF</button>
    </body></html>`;
}

function openPDFWindow(employees, from, to) {
  const w = window.open('', '_blank', 'width=860,height=700');
  if (!w) { alert('Pop-up blocked — please allow pop-ups for this site.'); return; }
  w.document.write(buildPDFHTML(employees, from, to));
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 400);
}

// ── Timesheet Employee Card ────────────────────────────────────────────────
function TimesheetCard({ emp, from, to }) {
  const [expanded, setExpanded] = useState(false);
  const sessions = emp.sessions || [];
  return (
    <div className="er-ts-emp-card">
      <div className="er-ts-emp-header" onClick={() => setExpanded(v => !v)}>
        <div className="er-ts-emp-header-left">
          <div className="er-ts-emp-avatar">{initials(emp.name)}</div>
          <div>
            <div className="er-ts-emp-info-name">{emp.name || emp.email}</div>
            <div className="er-ts-emp-info-meta">{emp.email}{emp.role ? ` · ${emp.role}` : ''} · {sessions.length} session{sessions.length !== 1 ? 's' : ''}</div>
          </div>
        </div>
        <div className="er-ts-emp-header-right">
          <span className="er-ts-emp-hours-badge"><Clock size={12} />{(emp.hoursWorked || 0).toFixed(1)} hrs</span>
          <button className="er-ts-emp-pdf-btn" onClick={e => { e.stopPropagation(); openPDFWindow([emp], from, to); }}>
            <FileText size={11} /> PDF
          </button>
          <ChevronDown size={15} className={`er-ts-emp-chevron ${expanded ? 'er-ts-emp-chevron--open' : ''}`} />
        </div>
      </div>
      {expanded && (
        <div className="er-ts-sessions">
          {sessions.length === 0 ? (
            <div className="er-ts-no-sessions">No clock events in this period</div>
          ) : (
            <>
              <div className="er-ts-sessions-head">
                <span>Date</span><span>Clock In</span><span>Clock Out</span><span>Duration</span><span>Status</span>
              </div>
              {sessions.map((s, i) => (
                <div key={i} className="er-ts-session-row">
                  <span className="er-ts-session-date">{fmtDate(s.in)}</span>
                  <span className="er-ts-session-time">{fmtTime(s.in)}</span>
                  <span className="er-ts-session-time-out">{s.out ? fmtTime(s.out) : '—'}</span>
                  <span className="er-ts-session-dur">{fmtMins(s.minutes)}</span>
                  <span>{s.active && <span className="er-ts-session-active"><span className="er-ts-session-dot" />Active</span>}</span>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Manage Shifts — Shift Form ─────────────────────────────────────────────
// Used for both Add (new) and Edit (existing session)
function ShiftForm({ employees, initialData, saving, error, onSave, onCancel }) {
  const [form, setForm] = useState({
    userId:  initialData?.userId  || '',
    inTime:  initialData?.inTime  || '',
    outTime: initialData?.outTime || '',
    note:    initialData?.note    || '',
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const isEdit = Boolean(initialData?.inEventId);

  return (
    <div className="er-ms-form-panel">
      <div className="er-ms-form-title">
        {isEdit ? <><Pencil size={14} /> Edit Shift</> : <><Plus size={14} /> Add Shift</>}
      </div>
      {error && <div className="er-ms-form-error">{error}</div>}
      <div className="er-ms-form-grid">
        {!isEdit && (
          <div className="er-ms-form-field">
            <label className="er-ms-form-label">Employee *</label>
            <select className="er-ms-form-input" value={form.userId} onChange={e => set('userId', e.target.value)}>
              <option value="">Select employee…</option>
              {employees.map(e => (
                <option key={e.id} value={e.id}>{e.name || e.email}</option>
              ))}
            </select>
          </div>
        )}
        <div className="er-ms-form-field">
          <label className="er-ms-form-label">Clock In *</label>
          <input
            type="datetime-local"
            className="er-ms-form-input"
            value={form.inTime}
            onChange={e => set('inTime', e.target.value)}
          />
        </div>
        <div className="er-ms-form-field">
          <label className="er-ms-form-label">Clock Out (optional)</label>
          <input
            type="datetime-local"
            className="er-ms-form-input"
            value={form.outTime}
            onChange={e => set('outTime', e.target.value)}
          />
        </div>
        <div className="er-ms-form-field">
          <label className="er-ms-form-label">Note</label>
          <input
            type="text"
            className="er-ms-form-input"
            value={form.note}
            placeholder="Optional note…"
            onChange={e => set('note', e.target.value)}
          />
        </div>
      </div>
      <div className="er-ms-form-actions">
        <button className="er-ms-form-cancel" onClick={onCancel}>Cancel</button>
        <button
          className="er-ms-form-save"
          disabled={saving || !form.inTime || (!isEdit && !form.userId)}
          onClick={() => onSave(form, initialData)}
        >
          {saving ? <RefreshCw size={13} className="er-spinner" /> : <Check size={13} />}
          {isEdit ? 'Save Changes' : 'Add Shift'}
        </button>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────
export default function EmployeeReports({ embedded }) {
  const user    = (() => { try { return JSON.parse(localStorage.getItem('user')); } catch { return null; } })();
  const storeId = localStorage.getItem('activeStoreId') || user?.storeId;

  const [tab,     setTab]     = useState('summary');
  const [from,    setFrom]    = useState(firstOfMonthStr());
  const [to,      setTo]      = useState(todayStr());
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const [data,    setData]    = useState(null);

  // Manage Shifts state
  const [msEvents,    setMsEvents]    = useState(null);   // raw clock events
  const [msEmployees, setMsEmployees] = useState([]);     // for dropdown
  const [msLoading,   setMsLoading]   = useState(false);
  const [msError,     setMsError]     = useState('');
  const [msFormError, setMsFormError] = useState('');
  const [empFilter,   setEmpFilter]   = useState('');     // userId filter
  const [showForm,    setShowForm]    = useState(false);  // 'add' | edit-object | false
  const [formSaving,  setFormSaving]  = useState(false);

  // Fetch employees list for dropdown on mount
  useEffect(() => {
    if (!storeId) return;
    getStoreEmployees({ storeId }).then(r => setMsEmployees(r.employees || [])).catch(() => {});
  }, [storeId]); // eslint-disable-line

  // ── Summary / Timesheet run ───────────────────────────────────────────────
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

  // ── Manage Shifts: fetch raw events ──────────────────────────────────────
  const loadEvents = useCallback(async () => {
    if (!storeId) return;
    setMsLoading(true); setMsError('');
    try {
      const res = await getClockEvents({ storeId, from, to, ...(empFilter && { userId: empFilter }) });
      setMsEvents(res.events || []);
    } catch (err) {
      setMsError(err.response?.data?.error || 'Failed to load clock events');
    } finally {
      setMsLoading(false);
    }
  }, [storeId, from, to, empFilter]); // eslint-disable-line

  // Auto-load when Manage Shifts tab is active
  useEffect(() => {
    if (tab === 'manage') loadEvents();
  }, [tab, loadEvents]);

  // ── Pair raw events into sessions ─────────────────────────────────────────
  // Groups events by userId, pairs in/out, attaches event IDs for CRUD.
  const msSessions = React.useMemo(() => {
    if (!msEvents) return [];
    const byUser = {};
    msEvents.forEach(e => {
      if (!byUser[e.userId]) byUser[e.userId] = { userId: e.userId, userName: e.userName, userEmail: e.userEmail, events: [] };
      byUser[e.userId].events.push(e);
    });

    const sessions = [];
    Object.values(byUser).forEach(({ userId, userName, userEmail, events }) => {
      let lastIn = null;
      events.forEach(e => {
        if (e.type === 'in') {
          lastIn = e;
        } else if (e.type === 'out') {
          sessions.push({
            userId, userName, userEmail,
            inEventId:  lastIn?.id || null,
            outEventId: e.id,
            inTime:     lastIn?.createdAt || null,
            outTime:    e.createdAt,
            minutes:    lastIn ? Math.round((new Date(e.createdAt) - new Date(lastIn.createdAt)) / 60000) : null,
            active:     false,
          });
          lastIn = null;
        }
      });
      // Unpaired clock-in (still active)
      if (lastIn) {
        sessions.push({
          userId, userName, userEmail,
          inEventId:  lastIn.id,
          outEventId: null,
          inTime:     lastIn.createdAt,
          outTime:    null,
          minutes:    Math.round((Date.now() - new Date(lastIn.createdAt)) / 60000),
          active:     true,
        });
      }
    });
    // Sort by inTime desc (most recent first)
    return sessions.sort((a, b) => new Date(b.inTime) - new Date(a.inTime));
  }, [msEvents]);

  // ── Manage Shifts: Save (add/edit) ────────────────────────────────────────
  const handleFormSave = async (form, editData) => {
    setMsFormError('');
    setFormSaving(true);
    try {
      if (editData?.inEventId) {
        // EDIT — update in-event (and optionally out-event)
        await updateClockEventEntry(editData.inEventId, { timestamp: new Date(form.inTime).toISOString(), note: form.note || null });
        if (editData.outEventId && form.outTime) {
          await updateClockEventEntry(editData.outEventId, { timestamp: new Date(form.outTime).toISOString(), note: form.note || null });
        } else if (!editData.outEventId && form.outTime) {
          // Create a new out event
          await createClockSession({ userId: editData.userId, storeId, inTime: null, outTime: new Date(form.outTime).toISOString(), note: form.note || null });
        }
      } else {
        // ADD — create new session
        await createClockSession({
          userId:  form.userId,
          storeId,
          inTime:  new Date(form.inTime).toISOString(),
          outTime: form.outTime ? new Date(form.outTime).toISOString() : null,
          note:    form.note || null,
        });
      }
      setShowForm(false);
      await loadEvents();
    } catch (err) {
      setMsFormError(err.response?.data?.error || 'Failed to save shift');
    } finally {
      setFormSaving(false);
    }
  };

  // ── Manage Shifts: Delete session (both events) ───────────────────────────
  const handleDelete = async (session) => {
    if (!window.confirm(`Delete this shift for ${session.userName}? This cannot be undone.`)) return;
    try {
      if (session.inEventId)  await deleteClockEventEntry(session.inEventId);
      if (session.outEventId) await deleteClockEventEntry(session.outEventId);
      await loadEvents();
    } catch (err) {
      setMsError(err.response?.data?.error || 'Failed to delete shift');
    }
  };

  const employees    = data?.employees || [];
  const summaryCards = data ? [
    { label: 'Employees',    value: employees.length, icon: Users, color: 'var(--blue, #63b3ed)', bg: 'rgba(99,179,237,.08)', border: 'rgba(99,179,237,.2)' },
    { label: 'Total Hours',  value: employees.reduce((s, e) => s + (e.hoursWorked || 0), 0).toFixed(1) + ' hrs', icon: Clock, color: 'var(--amber, #f59e0b)', bg: 'rgba(245,158,11,.08)', border: 'rgba(245,158,11,.2)' },
    { label: 'Transactions', value: employees.reduce((s, e) => s + (e.transactions || 0), 0), icon: ShoppingCart, color: 'var(--green, var(--accent-primary))', bg: 'var(--brand-08)', border: 'rgba(122,193,67,.2)' },
    { label: 'Total Sales',  value: fmt$(employees.reduce((s, e) => s + (e.totalSales || 0), 0)), icon: DollarSign, color: 'var(--green, var(--accent-primary))', bg: 'var(--brand-08)', border: 'rgba(122,193,67,.2)' },
  ] : [];

  const content = (
    <>
        <div className="er-page">

          {/* Header */}
          <div className="er-header">
            <div className="er-header-icon"><Users size={18} color="var(--green, var(--accent-primary))" /></div>
            <div>
              <h1 className="er-title">Employee Reports</h1>
              <p className="er-subtitle">Clock hours, sales, and shift management</p>
            </div>
          </div>

          {/* Tab bar */}
          <div className="er-tabs">
            {[
              { id: 'summary',   label: 'Summary' },
              { id: 'timesheet', label: '🕐 Timesheet' },
              { id: 'manage',    label: '✏️ Manage Shifts' },
            ].map(t => (
              <button key={t.id} className={`er-tab ${tab === t.id ? 'er-tab--active' : 'er-tab--inactive'}`} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>

          {/* Date filters — shared across Summary + Timesheet tabs */}
          {tab !== 'manage' && (
            <div className="er-filters">
              <div><div className="er-filter-label">From</div><input type="date" value={from} onChange={e => setFrom(e.target.value)} className="er-date-input" /></div>
              <div><div className="er-filter-label">To</div><input type="date" value={to} onChange={e => setTo(e.target.value)} className="er-date-input" /></div>
              <button onClick={run} disabled={loading} className={`er-run-btn ${loading ? 'er-run-btn--loading' : 'er-run-btn--active'}`}>
                <RefreshCw size={14} className={loading ? 'er-spinner' : ''} />
                {loading ? 'Loading…' : 'Run Report'}
              </button>
            </div>
          )}

          {/* Error */}
          {error && <div className="er-error"><AlertCircle size={16} />{error}</div>}

          {/* ── Summary Tab ── */}
          {tab === 'summary' && data && (
            <>
              <div className="er-summary-grid">
                {summaryCards.map(m => (
                  <div key={m.label} className="er-summary-card" style={{ background: m.bg, border: `1px solid ${m.border}` }}>
                    <div className="er-summary-card-header"><m.icon size={15} color={m.color} /><span className="er-summary-card-label">{m.label}</span></div>
                    <div className="er-summary-card-value" style={{ color: m.color }}>{m.value}</div>
                  </div>
                ))}
              </div>
              {employees.length === 0 ? (
                <div className="er-empty">No employee data found for this period.</div>
              ) : (
                <div className="er-table-wrap">
                  <div className="er-table-head">
                    <span>Employee</span><span>Hours Worked</span><span>Sessions</span><span>Transactions</span><span className="er-table-head-right">Total Sales</span>
                  </div>
                  {employees.map(emp => (
                    <div key={emp.userId} className="er-table-row">
                      <div><div className="er-emp-name">{emp.name || emp.email}</div>{emp.name && <div className="er-emp-email">{emp.email}</div>}</div>
                      <div className="er-cell-hours"><Clock size={13} color="var(--amber, #f59e0b)" />{(emp.hoursWorked || 0).toFixed(1)} hrs</div>
                      <div className="er-cell-sessions">{(emp.sessions || []).length}</div>
                      <div className="er-cell-txcount"><ShoppingCart size={13} color="var(--green, var(--accent-primary))" />{emp.transactions || 0}</div>
                      <div className="er-cell-sales" style={{ color: 'var(--green, var(--accent-primary))' }}>{fmt$(emp.totalSales)}</div>
                    </div>
                  ))}
                </div>
              )}
              {data && <div className="er-period-note">Report period: {data.from?.slice(0, 10)} to {data.to?.slice(0, 10)}</div>}
            </>
          )}

          {/* ── Timesheet Tab ── */}
          {tab === 'timesheet' && data && (
            <>
              <div className="er-ts-toolbar">
                <span className="er-ts-toolbar-label">{employees.length} employee{employees.length !== 1 ? 's' : ''} · {from} to {to}</span>
                {employees.length > 0 && (
                  <button className="er-ts-pdf-all-btn" onClick={() => openPDFWindow(employees, from, to)}>
                    <FileText size={13} /> Export All as PDF
                  </button>
                )}
              </div>
              {employees.length === 0
                ? <div className="er-empty">No employee data found for this period.</div>
                : <div className="er-ts-emp-list">{employees.map(emp => <TimesheetCard key={emp.userId} emp={emp} from={from} to={to} />)}</div>
              }
            </>
          )}

          {/* ── Manage Shifts Tab ── */}
          {tab === 'manage' && (
            <>
              {/* Toolbar */}
              <div className="er-ms-toolbar">
                <div className="er-ms-toolbar-left">
                  {/* Date filters for manage tab */}
                  <div><div className="er-filter-label" style={{ fontSize: '0.65rem', marginBottom: 3 }}>From</div><input type="date" value={from} onChange={e => setFrom(e.target.value)} className="er-date-input" style={{ height: 34 }} /></div>
                  <div><div className="er-filter-label" style={{ fontSize: '0.65rem', marginBottom: 3 }}>To</div><input type="date" value={to} onChange={e => setTo(e.target.value)} className="er-date-input" style={{ height: 34 }} /></div>
                  <select className="er-ms-emp-filter" value={empFilter} onChange={e => setEmpFilter(e.target.value)}>
                    <option value="">All Employees</option>
                    {msEmployees.map(e => <option key={e.id} value={e.id}>{e.name || e.email}</option>)}
                  </select>
                  <button onClick={loadEvents} disabled={msLoading} className={`er-run-btn ${msLoading ? 'er-run-btn--loading' : 'er-run-btn--active'}`} style={{ height: 34, padding: '0 1rem' }}>
                    <RefreshCw size={13} className={msLoading ? 'er-spinner' : ''} />
                    {msLoading ? 'Loading…' : 'Refresh'}
                  </button>
                </div>
                <button className="er-ms-add-btn" onClick={() => { setShowForm('add'); setMsFormError(''); }}>
                  <Plus size={14} /> Add Shift
                </button>
              </div>

              {/* Error */}
              {msError && <div className="er-error" style={{ marginBottom: '1rem' }}><AlertCircle size={15} />{msError}</div>}

              {/* Add / Edit form */}
              {showForm && (
                <ShiftForm
                  employees={msEmployees}
                  initialData={showForm === 'add' ? null : showForm}
                  saving={formSaving}
                  error={msFormError}
                  onSave={handleFormSave}
                  onCancel={() => { setShowForm(false); setMsFormError(''); }}
                />
              )}

              {/* Sessions table */}
              {msEvents === null ? (
                <div className="er-ms-run-hint">Select a date range and click <strong>Refresh</strong> to load shifts.</div>
              ) : msLoading ? (
                <div className="er-empty">Loading shifts…</div>
              ) : msSessions.length === 0 ? (
                <div className="er-empty">No shifts found for this period. Use <strong>Add Shift</strong> to create one manually.</div>
              ) : (
                <div className="er-ms-table-wrap">
                  <div className="er-ms-table-head">
                    <span>Employee</span><span>Date</span><span>Clock In</span><span>Clock Out</span><span>Duration</span><span>Actions</span>
                  </div>
                  {msSessions.map((s, i) => (
                    <div key={i} className="er-ms-row">
                      <div>
                        <div className="er-ms-row-emp">{s.userName}</div>
                        {s.userEmail && <div className="er-ms-row-emp-email">{s.userEmail}</div>}
                      </div>
                      <div className="er-ms-row-date">{fmtDate(s.inTime)}</div>
                      <div className="er-ms-row-time">{fmtTime(s.inTime)}</div>
                      <div className="er-ms-row-time">
                        {s.outTime ? fmtTime(s.outTime) : (
                          s.active
                            ? <span className="er-ms-active-badge"><span className="er-ms-active-dot" />Active</span>
                            : <span className="er-ms-orphan-badge">No clock-out</span>
                        )}
                      </div>
                      <div className="er-ms-row-dur">{fmtMins(s.minutes)}</div>
                      <div className="er-ms-row-actions">
                        <button
                          className="er-ms-btn-edit"
                          onClick={() => {
                            setShowForm({
                              userId:     s.userId,
                              inEventId:  s.inEventId,
                              outEventId: s.outEventId,
                              inTime:     isoToDatetimeLocal(s.inTime),
                              outTime:    isoToDatetimeLocal(s.outTime),
                              note:       '',
                            });
                            setMsFormError('');
                            // Scroll to form
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                          }}
                        >
                          <Pencil size={11} /> Edit
                        </button>
                        <button className="er-ms-btn-delete" onClick={() => handleDelete(s)}>
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* Prompt to run when no data yet on summary/timesheet */}
          {tab !== 'manage' && !data && !loading && !error && (
            <div className="er-empty">Select a date range and click <strong>Run Report</strong> to load employee data.</div>
          )}

        </div>
    </>
  );

  if (embedded) return <div className="p-tab-content">{content}</div>;

  return (
    <div className="layout-container">
      <Sidebar />
      <main className="main-content">
        {content}
      </main>
    </div>
  );
}
