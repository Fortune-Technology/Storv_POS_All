/**
 * ShiftManagement — Full CRUD for clock sessions (add / edit / delete).
 *
 * Extracted from EmployeeReports "Manage Shifts" tab.
 *
 * API: GET/POST/PUT/DELETE /api/reports/clock-events
 *      GET /api/reports/employees/list
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  getClockEvents, createClockSession, updateClockEventEntry, deleteClockEventEntry, getStoreEmployees,
} from '../services/api';
import {
  Clock, RefreshCw, AlertCircle, Plus, Pencil, Trash2, Check, X as XIcon,
} from 'lucide-react';
import { todayStr, firstOfMonthStr } from '../utils/formatters';
import '../styles/portal.css';
import './ShiftManagement.css';

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
function isoToDatetimeLocal(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* ── ShiftForm — Add / Edit shift ────────────────────────────────────────── */
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
    <div className="p-card sm-form-panel">
      <div className="sm-form-title">
        {isEdit ? <><Pencil size={14} /> Edit Shift</> : <><Plus size={14} /> Add Shift</>}
      </div>
      {error && <div className="sm-form-error"><AlertCircle size={13} />{error}</div>}
      <div className="sm-form-grid">
        {!isEdit && (
          <div className="sm-form-field">
            <label className="sm-form-label">Employee *</label>
            <select className="p-input sm-select" value={form.userId} onChange={e => set('userId', e.target.value)}>
              <option value="">Select employee\u2026</option>
              {employees.map(e => (
                <option key={e.id} value={e.id}>{e.name || e.email}</option>
              ))}
            </select>
          </div>
        )}
        <div className="sm-form-field">
          <label className="sm-form-label">Clock In *</label>
          <input
            type="datetime-local"
            className="p-input"
            value={form.inTime}
            onChange={e => set('inTime', e.target.value)}
          />
        </div>
        <div className="sm-form-field">
          <label className="sm-form-label">Clock Out (optional)</label>
          <input
            type="datetime-local"
            className="p-input"
            value={form.outTime}
            onChange={e => set('outTime', e.target.value)}
          />
        </div>
        <div className="sm-form-field">
          <label className="sm-form-label">Note</label>
          <input
            type="text"
            className="p-input"
            value={form.note}
            placeholder="Optional note\u2026"
            onChange={e => set('note', e.target.value)}
          />
        </div>
      </div>
      <div className="sm-form-actions">
        <button className="p-btn-secondary p-btn-sm" onClick={onCancel}>Cancel</button>
        <button
          className="p-btn-primary p-btn-sm sm-form-save"
          disabled={saving || !form.inTime || (!isEdit && !form.userId)}
          onClick={() => onSave(form, initialData)}
        >
          {saving ? <RefreshCw size={13} className="sm-spinner" /> : <Check size={13} />}
          {isEdit ? 'Save Changes' : 'Add Shift'}
        </button>
      </div>
    </div>
  );
}

/* ── Main Component ──────────────────────────────────────────────────────── */
export default function ShiftManagement({ embedded }) {
  const user    = (() => { try { return JSON.parse(localStorage.getItem('user')); } catch { return null; } })();
  const storeId = localStorage.getItem('activeStoreId') || user?.storeId;

  const [from,       setFrom]       = useState(firstOfMonthStr());
  const [to,         setTo]         = useState(todayStr());
  const [empFilter,  setEmpFilter]  = useState('');
  const [employees,  setEmployees]  = useState([]);
  const [events,     setEvents]     = useState(null);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState('');
  const [formError,  setFormError]  = useState('');
  const [showForm,   setShowForm]   = useState(false);   // 'add' | edit-object | false
  const [formSaving, setFormSaving] = useState(false);

  // Fetch employee list for dropdown on mount
  useEffect(() => {
    if (!storeId) return;
    getStoreEmployees({ storeId }).then(r => setEmployees(r.employees || [])).catch(() => {});
  }, [storeId]);

  // Load raw clock events
  const loadEvents = useCallback(async () => {
    if (!storeId) return;
    setLoading(true); setError('');
    try {
      const res = await getClockEvents({ storeId, from, to, ...(empFilter && { userId: empFilter }) });
      setEvents(res.events || []);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load clock events');
    } finally {
      setLoading(false);
    }
  }, [storeId, from, to, empFilter]);

  // Auto-load on mount
  useEffect(() => { loadEvents(); }, [loadEvents]);

  // Pair raw events into sessions
  const sessions = useMemo(() => {
    if (!events) return [];
    const byUser = {};
    events.forEach(e => {
      if (!byUser[e.userId]) byUser[e.userId] = { userId: e.userId, userName: e.userName, userEmail: e.userEmail, events: [] };
      byUser[e.userId].events.push(e);
    });

    const result = [];
    Object.values(byUser).forEach(({ userId, userName, userEmail, events: evts }) => {
      let lastIn = null;
      evts.forEach(e => {
        if (e.type === 'in') {
          lastIn = e;
        } else if (e.type === 'out') {
          result.push({
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
        result.push({
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
    return result.sort((a, b) => new Date(b.inTime) - new Date(a.inTime));
  }, [events]);

  // Save (add/edit)
  const handleFormSave = async (form, editData) => {
    setFormError('');
    setFormSaving(true);
    try {
      if (editData?.inEventId) {
        await updateClockEventEntry(editData.inEventId, { timestamp: new Date(form.inTime).toISOString(), note: form.note || null });
        if (editData.outEventId && form.outTime) {
          await updateClockEventEntry(editData.outEventId, { timestamp: new Date(form.outTime).toISOString(), note: form.note || null });
        } else if (!editData.outEventId && form.outTime) {
          await createClockSession({ userId: editData.userId, storeId, inTime: null, outTime: new Date(form.outTime).toISOString(), note: form.note || null });
        }
      } else {
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
      setFormError(err.response?.data?.error || 'Failed to save shift');
    } finally {
      setFormSaving(false);
    }
  };

  // Delete session
  const handleDelete = async (session) => {
    if (!window.confirm(`Delete this shift for ${session.userName}? This cannot be undone.`)) return;
    try {
      if (session.inEventId)  await deleteClockEventEntry(session.inEventId);
      if (session.outEventId) await deleteClockEventEntry(session.outEventId);
      await loadEvents();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete shift');
    }
  };

  const content = (
    <div className="sm-page p-page">

      {/* Header */}
      <div className="p-header sm-header">
        <div className="p-header-left">
          <div className="p-header-icon sm-header-icon"><Clock size={18} /></div>
          <div>
            <h1 className="sm-title">Manage Shifts</h1>
            <p className="sm-subtitle">Add, edit, and delete employee clock sessions</p>
          </div>
        </div>
        <div className="p-header-actions">
          <button className="p-btn-primary p-btn-sm sm-add-btn" onClick={() => { setShowForm('add'); setFormError(''); }}>
            <Plus size={14} /> Add Shift
          </button>
        </div>
      </div>

      {/* Filters toolbar */}
      <div className="p-card sm-filters">
        <div className="sm-filter-group">
          <label className="sm-filter-label">From</label>
          <input type="date" className="p-input sm-date-input" value={from} onChange={e => setFrom(e.target.value)} />
        </div>
        <div className="sm-filter-group">
          <label className="sm-filter-label">To</label>
          <input type="date" className="p-input sm-date-input" value={to} onChange={e => setTo(e.target.value)} />
        </div>
        <div className="sm-filter-group">
          <label className="sm-filter-label">Employee</label>
          <select className="p-input sm-emp-select" value={empFilter} onChange={e => setEmpFilter(e.target.value)}>
            <option value="">All Employees</option>
            {employees.map(e => <option key={e.id} value={e.id}>{e.name || e.email}</option>)}
          </select>
        </div>
        <button onClick={loadEvents} disabled={loading} className={`p-btn-secondary p-btn-sm sm-refresh-btn ${loading ? 'sm-refresh-btn--loading' : ''}`}>
          <RefreshCw size={13} className={loading ? 'sm-spinner' : ''} />
          {loading ? 'Loading\u2026' : 'Refresh'}
        </button>
      </div>

      {/* Error */}
      {error && <div className="sm-error"><AlertCircle size={15} />{error}</div>}

      {/* Add / Edit form */}
      {showForm && (
        <ShiftForm
          employees={employees}
          initialData={showForm === 'add' ? null : showForm}
          saving={formSaving}
          error={formError}
          onSave={handleFormSave}
          onCancel={() => { setShowForm(false); setFormError(''); }}
        />
      )}

      {/* Sessions table */}
      {events === null ? (
        <div className="p-empty">
          <Clock size={36} />
          <div>Select a date range and click <strong>Refresh</strong> to load shifts.</div>
        </div>
      ) : loading ? (
        <div className="p-empty">Loading shifts\u2026</div>
      ) : sessions.length === 0 ? (
        <div className="p-empty">
          <Clock size={36} />
          <div>No shifts found for this period. Use <strong>Add Shift</strong> to create one manually.</div>
        </div>
      ) : (
        <div className="p-card sm-table-wrap">
          <div className="sm-table-head">
            <span>Employee</span><span>Date</span><span>Clock In</span><span>Clock Out</span><span>Duration</span><span>Actions</span>
          </div>
          {sessions.map((s, i) => (
            <div key={i} className="sm-row">
              <div>
                <div className="sm-row-emp">{s.userName}</div>
                {s.userEmail && <div className="sm-row-email">{s.userEmail}</div>}
              </div>
              <div className="sm-row-date">{fmtDate(s.inTime)}</div>
              <div className="sm-row-time">{fmtTime(s.inTime)}</div>
              <div className="sm-row-time">
                {s.outTime ? fmtTime(s.outTime) : (
                  s.active
                    ? <span className="p-badge p-badge-green sm-active-badge"><span className="sm-active-dot" />Active</span>
                    : <span className="p-badge p-badge-red sm-orphan-badge">No clock-out</span>
                )}
              </div>
              <div className="sm-row-dur">{fmtMins(s.minutes)}</div>
              <div className="sm-row-actions">
                <button
                  className="p-btn-ghost p-btn-sm sm-btn-edit"
                  onClick={() => {
                    setShowForm({
                      userId:     s.userId,
                      inEventId:  s.inEventId,
                      outEventId: s.outEventId,
                      inTime:     isoToDatetimeLocal(s.inTime),
                      outTime:    isoToDatetimeLocal(s.outTime),
                      note:       '',
                    });
                    setFormError('');
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                >
                  <Pencil size={11} /> Edit
                </button>
                <button className="p-btn-ghost p-btn-sm sm-btn-delete" onClick={() => handleDelete(s)}>
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  if (embedded) return content;
  return content;
}
