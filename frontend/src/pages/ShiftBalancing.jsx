/**
 * ShiftBalancing — Day-by-day shift report with back-office cash adjustment.
 * Allows managers to view and edit closing amounts on closed shifts.
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
  Calendar, DollarSign, Save, RefreshCw, Loader, AlertCircle,
  Check, X, ChevronDown, ChevronUp, Clock, User,
} from 'lucide-react';
import api from '../services/api';
import { toast } from 'react-toastify';
import { downloadCSV, downloadPDF } from '../utils/exportUtils';
import { fmtTime, todayStr } from '../utils/formatters';
import '../styles/portal.css';
import './ShiftBalancing.css';

const fmt  = (n) => n == null ? '--' : `$${Number(n).toFixed(2)}`;
const fmtV = (n) => {
  if (n == null) return '--';
  const v = Number(n);
  const s = `$${Math.abs(v).toFixed(2)}`;
  if (v > 0.01) return `+${s}`;
  if (v < -0.01) return `-${s}`;
  return '$0.00';
};
const fmtDate = (d) => new Date(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

export default function ShiftBalancing({ embedded }) {
  const [date, setDate] = useState(todayStr());
  const [shifts, setShifts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editAmount, setEditAmount] = useState('');
  const [editNote, setEditNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [stationFilter, setStationFilter] = useState('all');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/pos-terminal/shifts', { params: { dateFrom: date, dateTo: date, limit: 50 } });
      setShifts(res.data?.shifts || []);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load shifts');
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (shiftId) => {
    if (!editAmount.trim()) { toast.warn('Enter a closing amount'); return; }
    setSaving(true);
    try {
      await api.put(`/pos-terminal/shift/${shiftId}/balance`, {
        closingAmount: parseFloat(editAmount),
        closingNote: editNote || undefined,
      });
      toast.success('Shift balance updated');
      setEditingId(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to update');
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (shift) => {
    setEditingId(shift.id);
    setEditAmount(shift.closingAmount != null ? String(shift.closingAmount) : '');
    setEditNote(shift.closingNote || '');
  };

  const cancelEdit = () => { setEditingId(null); setEditAmount(''); setEditNote(''); };

  // Station list (unique)
  const stationList = [...new Map(shifts.map(s => [s.stationId || 'none', s.stationName || 'Unassigned'])).entries()];

  // Filtered shifts
  const filteredShifts = stationFilter === 'all' ? shifts : shifts.filter(s => (s.stationId || 'none') === stationFilter);

  // Stats (on filtered)
  const closedShifts = filteredShifts.filter(s => s.status === 'closed');
  const totalVariance = closedShifts.reduce((s, sh) => s + (sh.variance || 0), 0);
  const totalCashSales = closedShifts.reduce((s, sh) => s + (sh.cashSales || 0), 0);

  // Group by station
  const stationGroups = {};
  for (const s of filteredShifts) {
    const key = s.stationId || 'none';
    if (!stationGroups[key]) stationGroups[key] = { stationId: key, stationName: s.stationName || 'Unassigned', shifts: [] };
    stationGroups[key].shifts.push(s);
  }

  const handleExportCSV = () => {
    downloadCSV(shifts, [
      { key: 'cashierName', label: 'Cashier' },
      { key: 'openedAt', label: 'Opened' },
      { key: 'closedAt', label: 'Closed' },
      { key: 'openingAmount', label: 'Opening' },
      { key: 'closingAmount', label: 'Closing' },
      { key: 'expectedAmount', label: 'Expected' },
      { key: 'variance', label: 'Variance' },
      { key: 'status', label: 'Status' },
      { key: 'closingNote', label: 'Note' },
    ], `shift-balancing-${date}`);
  };

  const content = (
    <div className="sb-page">
      {/* Controls */}
      <div className="sb-controls">
        <div className="sb-date-group">
          <Calendar size={14} className="sb-date-icon" />
          <input type="date" className="p-input sb-date-input" value={date} onChange={e => setDate(e.target.value)} />
          {stationList.length > 1 && (
            <select className="p-select sb-station-select" value={stationFilter} onChange={e => setStationFilter(e.target.value)}>
              <option value="all">All Registers ({shifts.length})</option>
              {stationList.map(([id, name]) => (
                <option key={id} value={id}>{name} ({shifts.filter(s => (s.stationId || 'none') === id).length})</option>
              ))}
            </select>
          )}
          <button className="p-btn p-btn-secondary p-btn-sm" onClick={load} disabled={loading}>
            <RefreshCw size={13} className={loading ? 'p-spin' : ''} /> Refresh
          </button>
        </div>
        <div className="sb-controls-right">
          <button className="p-btn p-btn-ghost p-btn-sm" onClick={handleExportCSV} disabled={!shifts.length}>
            CSV
          </button>
          <span className="sb-date-label">{fmtDate(date + 'T12:00:00')}</span>
        </div>
      </div>

      {/* Stats */}
      {shifts.length > 0 && (
        <div className="p-stat-grid sb-stats">
          <div className="p-stat-card">
            <div className="p-stat-label">Shifts</div>
            <div className="p-stat-value">{shifts.length}</div>
            <div className="p-stat-sub">{closedShifts.length} closed, {shifts.length - closedShifts.length} open</div>
          </div>
          <div className="p-stat-card">
            <div className="p-stat-label">Cash Sales</div>
            <div className="p-stat-value" style={{ color: 'var(--success)' }}>{fmt(totalCashSales)}</div>
          </div>
          <div className="p-stat-card">
            <div className="p-stat-label">Total Variance</div>
            <div className="p-stat-value" style={{ color: totalVariance >= 0 ? 'var(--success)' : 'var(--error)' }}>
              {fmtV(totalVariance)}
            </div>
            <div className="p-stat-sub">{totalVariance >= 0 ? 'Over' : 'Short'}</div>
          </div>
        </div>
      )}

      {/* Error */}
      {error && <div className="sb-error"><AlertCircle size={14} /> {error}</div>}

      {/* Loading */}
      {loading && <div className="p-loading"><Loader size={14} className="p-spin" /> Loading shifts...</div>}

      {/* Empty */}
      {!loading && !error && shifts.length === 0 && (
        <div className="p-empty">No shifts found for {fmtDate(date + 'T12:00:00')}.</div>
      )}

      {/* Shift cards — grouped by station */}
      {!loading && Object.values(stationGroups).map(group => (
        <div key={group.stationId} className="sb-station-group">
          {/* Station header */}
          {(stationFilter === 'all' && stationList.length > 1) && (
            <div className="sb-station-header">
              <div className="sb-station-name">{group.stationName}</div>
              <div className="sb-station-summary">
                {group.shifts.length} shift{group.shifts.length !== 1 ? 's' : ''}
                {(() => {
                  const closed = group.shifts.filter(s => s.status === 'closed');
                  const v = closed.reduce((s, sh) => s + (sh.variance || 0), 0);
                  if (closed.length === 0) return null;
                  return (
                    <span className={`sb-variance-badge ${v > 0.01 ? 'sb-var--over' : v < -0.01 ? 'sb-var--short' : 'sb-var--even'}`} style={{ marginLeft: 8 }}>
                      Variance: {fmtV(v)}
                    </span>
                  );
                })()}
              </div>
            </div>
          )}

          {group.shifts.map(shift => {
        const isEditing = editingId === shift.id;
        const isExpanded = expandedId === shift.id;
        const isClosed = shift.status === 'closed';
        const varianceClass = shift.variance == null ? '' : shift.variance > 0.01 ? 'sb-var--over' : shift.variance < -0.01 ? 'sb-var--short' : 'sb-var--even';

        return (
          <div key={shift.id} className={`sb-shift-card ${isClosed ? '' : 'sb-shift-card--open'}`}>
            {/* Header row */}
            <div className="sb-shift-header" onClick={() => setExpandedId(isExpanded ? null : shift.id)}>
              <div className="sb-shift-left">
                <User size={14} className="sb-shift-icon" />
                <div>
                  <div className="sb-cashier-name">
                    {shift.cashierName}
                    {shift.stationName && stationFilter !== 'all' ? null : shift.stationName && (
                      <span className="sb-station-chip">{shift.stationName}</span>
                    )}
                  </div>
                  <div className="sb-shift-time">
                    <Clock size={11} /> {fmtTime(shift.openedAt)}
                    {shift.closedAt && <> → {fmtTime(shift.closedAt)}</>}
                  </div>
                </div>
              </div>
              <div className="sb-shift-right">
                <span className={`p-badge ${isClosed ? 'p-badge-green' : 'p-badge-amber'}`}>
                  {shift.status}
                </span>
                {isClosed && shift.variance != null && (
                  <span className={`sb-variance-badge ${varianceClass}`}>
                    {fmtV(shift.variance)}
                  </span>
                )}
                {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </div>
            </div>

            {/* Expanded details */}
            {isExpanded && (() => {
              const ss = shift.salesSummary || {};
              return (
              <div className="sb-shift-detail">
                {/* Day's total sales for this register */}
                <div className="sb-sales-banner">
                  <div className="sb-sales-total">
                    <span className="sb-sales-total-label">Total Sales</span>
                    <span className="sb-sales-total-value">{fmt(ss.totalSales)}</span>
                    <span className="sb-sales-total-sub">{ss.txCount} transaction{ss.txCount !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="sb-tender-breakdown">
                    <div className="sb-tender-item">
                      <span className="sb-tender-dot sb-tender-dot--cash" />
                      <span className="sb-tender-label">Cash</span>
                      <span className="sb-tender-amount">{fmt(ss.cash)}</span>
                    </div>
                    <div className="sb-tender-item">
                      <span className="sb-tender-dot sb-tender-dot--card" />
                      <span className="sb-tender-label">Card</span>
                      <span className="sb-tender-amount">{fmt(ss.card)}</span>
                    </div>
                    <div className="sb-tender-item">
                      <span className="sb-tender-dot sb-tender-dot--ebt" />
                      <span className="sb-tender-label">EBT</span>
                      <span className="sb-tender-amount">{fmt(ss.ebt)}</span>
                    </div>
                    {ss.other > 0 && (
                      <div className="sb-tender-item">
                        <span className="sb-tender-dot sb-tender-dot--other" />
                        <span className="sb-tender-label">Other</span>
                        <span className="sb-tender-amount">{fmt(ss.other)}</span>
                      </div>
                    )}
                    <div className="sb-tender-item sb-tender-item--tax">
                      <span className="sb-tender-label">Tax</span>
                      <span className="sb-tender-amount">{fmt(ss.totalTax)}</span>
                    </div>
                  </div>
                </div>

                {/* Cash drawer reconciliation */}
                <div className="sb-detail-grid">
                  <div className="sb-detail-item">
                    <span className="sb-detail-label">Opening Float</span>
                    <span className="sb-detail-value">{fmt(shift.openingAmount)}</span>
                  </div>
                  <div className="sb-detail-item">
                    <span className="sb-detail-label">Cash Tendered</span>
                    <span className="sb-detail-value sb-detail-value--green">{fmt(shift.cashSales)}</span>
                  </div>
                  <div className="sb-detail-item">
                    <span className="sb-detail-label">Cash Refunds</span>
                    <span className="sb-detail-value sb-detail-value--red">{fmt(shift.cashRefunds)}</span>
                  </div>
                  <div className="sb-detail-item">
                    <span className="sb-detail-label">Cash Drops</span>
                    <span className="sb-detail-value">{fmt(shift.cashDropsTotal)} ({shift.dropsCount})</span>
                  </div>
                  <div className="sb-detail-item">
                    <span className="sb-detail-label">Payouts</span>
                    <span className="sb-detail-value">{fmt(shift.payoutsTotal)} ({shift.payoutsCount})</span>
                  </div>
                  <div className="sb-detail-item">
                    <span className="sb-detail-label">Expected Cash</span>
                    <span className="sb-detail-value sb-detail-value--brand">{fmt(shift.expectedAmount)}</span>
                  </div>
                </div>

                {/* Closing cash amount — ONLY cash is editable */}
                <div className="sb-closing-section">
                  <div className="sb-closing-header">
                    <span className="sb-closing-title">Actual Cash Count</span>
                    {isClosed && !isEditing && (
                      <button className="p-btn p-btn-ghost p-btn-sm" onClick={(e) => { e.stopPropagation(); startEdit(shift); }}>
                        Edit Cash
                      </button>
                    )}
                  </div>

                  {isEditing ? (
                    <div className="sb-edit-form">
                      <div className="sb-edit-row">
                        <span className="sb-dollar">$</span>
                        <input
                          type="number"
                          step="0.01"
                          className="p-input sb-edit-input"
                          value={editAmount}
                          onChange={e => setEditAmount(e.target.value)}
                          autoFocus
                        />
                      </div>
                      <input
                        className="p-input sb-edit-note"
                        placeholder="Adjustment note (optional)"
                        value={editNote}
                        onChange={e => setEditNote(e.target.value)}
                      />
                      <div className="sb-edit-actions">
                        <button className="p-btn p-btn-ghost p-btn-sm" onClick={cancelEdit}><X size={12} /> Cancel</button>
                        <button className="p-btn p-btn-primary p-btn-sm" onClick={() => handleSave(shift.id)} disabled={saving}>
                          {saving ? <Loader size={12} className="p-spin" /> : <Save size={12} />} Save
                        </button>
                      </div>
                      {editAmount && shift.expectedAmount != null && (
                        <div className="sb-edit-preview">
                          New variance: <strong className={parseFloat(editAmount) - shift.expectedAmount >= 0 ? 'sb-preview--over' : 'sb-preview--short'}>
                            {fmtV(parseFloat(editAmount) - shift.expectedAmount)}
                          </strong>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="sb-closing-display">
                      <span className="sb-closing-value">{fmt(shift.closingAmount)}</span>
                      {shift.variance != null && (
                        <span className={`sb-variance-badge ${varianceClass}`} style={{ marginLeft: 8 }}>
                          {fmtV(shift.variance)}
                        </span>
                      )}
                      {shift.closingNote && <span className="sb-closing-note">Note: {shift.closingNote}</span>}
                    </div>
                  )}
                </div>

                {shift.openingNote && (
                  <div className="sb-note">Opening note: {shift.openingNote}</div>
                )}
              </div>
              );
            })()}
          </div>
        );
      })}
        </div>
      ))}
    </div>
  );

  if (embedded) return <div className="p-tab-content">{content}</div>;
  return content;
}
