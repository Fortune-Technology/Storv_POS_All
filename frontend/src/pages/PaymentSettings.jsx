/**
 * PaymentSettings.jsx (portal)
 *
 * Transaction history view for store managers.
 * Terminal management, merchant credentials, and store payment settings
 * are managed exclusively by POS Admin (superadmin console).
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Loader, Shield, CreditCard, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { toast } from 'react-toastify';
import api from '../services/api';
import { fmtMoney as fmt$ } from '../utils/formatters';
import './PaymentSettings.css';
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString() + ' ' + new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function fmtRelative(iso) {
  if (!iso) return 'never';
  const diffMs = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diffMs / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

const TYPE_COLORS  = { sale: '#3b82f6', void: '#f59e0b', refund: '#a855f7' };
const STATUS_COLORS = { approved: '#22c55e', declined: '#ef4444', voided: '#f59e0b', refunded: '#a855f7', pending: '#94a3b8', error: '#ef4444' };

function Badge({ val, colorMap }) {
  const color = colorMap?.[val] || '#94a3b8';
  return (
    <span className="pms-badge" style={{ background: `${color}22`, border: `1px solid ${color}44`, color }}>
      {val || '—'}
    </span>
  );
}

// ── Read-only payment processor status (Option 4) ─────────────────────────
function MerchantStatusCard({ loading, status, onRefresh }) {
  if (loading) {
    return (
      <div className="pms-status-card pms-status-loading">
        <Loader size={16} className="spin" /> Checking payment processor status…
      </div>
    );
  }

  if (!status || !status.configured) {
    return (
      <div className="pms-status-card pms-status-warn">
        <XCircle size={18} />
        <div className="pms-status-body">
          <div className="pms-status-title">Payment processor not configured</div>
          <div className="pms-status-sub">
            Contact your Storv administrator to set up card processing for this store.
          </div>
        </div>
      </div>
    );
  }

  const s = status.status || 'unknown';
  const tone =
    s === 'active'   ? 'ok'  :
    s === 'pending'  ? 'pending' :
    s === 'disabled' ? 'warn' : 'muted';

  const Icon =
    s === 'active'   ? CheckCircle2 :
    s === 'pending'  ? Clock :
    s === 'disabled' ? XCircle : Shield;

  const tested =
    status.lastTestedAt
      ? `${status.lastTestResult === 'ok' ? 'OK' : 'Failed'} · ${fmtRelative(status.lastTestedAt)}`
      : 'Never tested';

  return (
    <div className={`pms-status-card pms-status-${tone}`}>
      <Icon size={18} />
      <div className="pms-status-body">
        <div className="pms-status-title">
          Payment processor:{' '}
          {s === 'active'   && 'Connected & live'}
          {s === 'pending'  && 'Pending activation'}
          {s === 'disabled' && 'Disabled'}
          {!['active','pending','disabled'].includes(s) && s.toUpperCase()}
        </div>
        <div className="pms-status-meta">
          <span className="pms-status-chip">
            {(status.provider || 'dejavoo').toUpperCase()}
          </span>
          <span className={`pms-status-chip pms-status-chip-${status.environment}`}>
            {status.environment === 'prod' ? 'PRODUCTION' : 'SANDBOX'}
          </span>
          {status.hasTpn && <span className="pms-status-chip">Terminal paired</span>}
          {status.ebtEnabled && <span className="pms-status-chip">EBT</span>}
          {status.debitEnabled && <span className="pms-status-chip">Debit</span>}
          <span className="pms-status-chip pms-status-chip-muted">Last test: {tested}</span>
        </div>
        {s === 'pending' && (
          <div className="pms-status-sub">
            Card payments are paused until your administrator completes the activation.
          </div>
        )}
        {s === 'disabled' && (
          <div className="pms-status-sub">
            Card processing is disabled for this store. Contact your administrator.
          </div>
        )}
      </div>
      <button className="pms-status-refresh" onClick={onRefresh} title="Refresh status">
        <RefreshCw size={14} />
      </button>
    </div>
  );
}

export default function PaymentSettings() {
  const [rows,    setRows]    = useState([]);
  const [total,   setTotal]   = useState(0);
  const [loading, setLoading] = useState(true);
  const [page,    setPage]    = useState(1);
  const [filters, setFilters] = useState({ type: '', status: '', dateFrom: '', dateTo: '' });
  const [status,  setStatus]  = useState(null);       // read-only merchant status
  const [statusLoading, setStatusLoading] = useState(true);
  const limit = 50;

  const activeStoreId = localStorage.getItem('activeStoreId');

  const fetchStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const r = await api.get('/payment/dejavoo/merchant-status');
      setStatus(r.data || null);
    } catch {
      setStatus(null);
    } finally {
      setStatusLoading(false);
    }
  }, [activeStoreId]);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit, ...(activeStoreId ? { storeId: activeStoreId } : {}), ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) };
      const r = await api.get('/payment/transactions', { params });
      const data = r.data;
      setRows(data.data || []);
      setTotal(data.meta?.total || 0);
    } catch {
      toast.error('Failed to load payment history');
    } finally {
      setLoading(false);
    }
  }, [page, filters, activeStoreId]);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="p-page">
      <div className="page-container">
        <div className="p-header">
          <div className="p-header-left">
            <div className="p-header-icon">
              <CreditCard size={22} />
            </div>
            <div>
              <h1 className="p-title">Payment History</h1>
              <p className="p-subtitle">View transaction and payment processing history</p>
            </div>
          </div>
          <div className="p-header-actions"></div>
        </div>

        {/* Admin-managed notice */}
        <div className="pms-notice">
          <Shield size={18} className="pms-notice-icon" />
          <div>
            <div className="pms-notice-title">
              Payment terminals and settings are managed by POS Admin
            </div>
            <div className="pms-notice-desc">
              Merchant credentials, Dejavoo terminal assignments, EBT configuration, and processing settings are controlled exclusively through the POS Admin console for security purposes.
            </div>
          </div>
        </div>

        {/* Read-only merchant status card */}
        <MerchantStatusCard loading={statusLoading} status={status} onRefresh={fetchStatus} />

        {/* Filters */}
        <div className="pms-filters">
          <select
            value={filters.type}
            onChange={e => { setFilters(f => ({ ...f, type: e.target.value })); setPage(1); }}
            className="pms-filter-input"
          >
            <option value="">All Types</option>
            <option value="sale">Sale</option>
            <option value="void">Void</option>
            <option value="refund">Refund</option>
          </select>
          <select
            value={filters.status}
            onChange={e => { setFilters(f => ({ ...f, status: e.target.value })); setPage(1); }}
            className="pms-filter-input"
          >
            <option value="">All Statuses</option>
            <option value="approved">Approved</option>
            <option value="declined">Declined</option>
            <option value="voided">Voided</option>
            <option value="refunded">Refunded</option>
          </select>
          <input type="date" value={filters.dateFrom} onChange={e => { setFilters(f => ({ ...f, dateFrom: e.target.value })); setPage(1); }}
            className="pms-filter-input" />
          <input type="date" value={filters.dateTo} onChange={e => { setFilters(f => ({ ...f, dateTo: e.target.value })); setPage(1); }}
            className="pms-filter-input" />
          <button onClick={fetchHistory} className="pms-btn-refresh">
            <RefreshCw size={13} className={loading ? 'spin' : ''} /> Refresh
          </button>
          <span className="pms-record-count">{total.toLocaleString()} records</span>
        </div>

        {/* Table */}
        <div className="pms-table-wrap">
          <table className="pms-table">
            <thead>
              <tr>
                {['Date', 'Type', 'Card', 'Amount', 'Auth Code', 'Status', 'Mode'].map(h => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="pms-td-loading">
                  <Loader size={20} className="spin pms-td-loading" />Loading...
                </td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="pms-td-empty">No transactions found</td></tr>
              ) : rows.map(r => (
                <tr key={r.id}>
                  <td className="pms-td-date">{fmtDate(r.createdAt)}</td>
                  <td><Badge val={r.type} colorMap={TYPE_COLORS} /></td>
                  <td className="pms-td-card">{r.acctType ? `${r.acctType} ···· ${r.lastFour}` : '—'}</td>
                  <td className={`pms-td-amount ${r.type === 'refund' ? 'pms-td-amount--refund' : ''}`}>{r.type === 'refund' ? '-' : ''}{fmt$(r.amount)}</td>
                  <td className="pms-td-auth">{r.authCode || '—'}</td>
                  <td><Badge val={r.status} colorMap={STATUS_COLORS} /></td>
                  <td className="pms-td-mode">{r.entryMode || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="pms-pagination">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="pms-page-btn">
              ← Prev
            </button>
            <span className="pms-page-info">Page {page} of {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="pms-page-btn">
              Next →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
