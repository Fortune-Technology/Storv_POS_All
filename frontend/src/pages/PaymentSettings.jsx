/**
 * PaymentSettings.jsx (portal)
 *
 * Transaction history view for store managers.
 * Terminal management, merchant credentials, and store payment settings
 * are managed exclusively by POS Admin (superadmin console).
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Loader, Shield } from 'lucide-react';
import { toast } from 'react-toastify';
import Layout from '../components/Layout';
import api from '../services/api';

function fmt$(n) { return `$${Number(n || 0).toFixed(2)}`; }
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString() + ' ' + new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const TYPE_COLORS  = { sale: '#3b82f6', void: '#f59e0b', refund: '#a855f7' };
const STATUS_COLORS = { approved: '#22c55e', declined: '#ef4444', voided: '#f59e0b', refunded: '#a855f7', pending: '#94a3b8', error: '#ef4444' };

function Badge({ val, colorMap }) {
  const color = colorMap?.[val] || '#94a3b8';
  return (
    <span style={{ padding: '2px 9px', borderRadius: 10, background: `${color}22`, border: `1px solid ${color}44`, color, fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
      {val || '—'}
    </span>
  );
}

export default function PaymentSettings() {
  const [rows,    setRows]    = useState([]);
  const [total,   setTotal]   = useState(0);
  const [loading, setLoading] = useState(true);
  const [page,    setPage]    = useState(1);
  const [filters, setFilters] = useState({ type: '', status: '', dateFrom: '', dateTo: '' });
  const limit = 50;

  const activeStoreId = localStorage.getItem('activeStoreId');

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
    <Layout>
      <div className="page-container">
        <div className="page-header">
          <h1 className="page-title">Payment History</h1>
        </div>

        {/* Admin-managed notice */}
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 12,
          padding: '14px 18px', borderRadius: 10, marginBottom: 24,
          background: 'rgba(59,130,246,.07)', border: '1px solid rgba(59,130,246,.2)',
        }}>
          <Shield size={18} style={{ color: '#3b82f6', flexShrink: 0, marginTop: 1 }} />
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.87rem', color: 'var(--text-primary)', marginBottom: 3 }}>
              Payment terminals and settings are managed by POS Admin
            </div>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              Merchant credentials, CardPointe terminal assignments, signature thresholds, and surcharge configuration are controlled exclusively through the POS Admin console for security purposes.
            </div>
          </div>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <select
            value={filters.type}
            onChange={e => { setFilters(f => ({ ...f, type: e.target.value })); setPage(1); }}
            style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: '0.85rem' }}
          >
            <option value="">All Types</option>
            <option value="sale">Sale</option>
            <option value="void">Void</option>
            <option value="refund">Refund</option>
          </select>
          <select
            value={filters.status}
            onChange={e => { setFilters(f => ({ ...f, status: e.target.value })); setPage(1); }}
            style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: '0.85rem' }}
          >
            <option value="">All Statuses</option>
            <option value="approved">Approved</option>
            <option value="declined">Declined</option>
            <option value="voided">Voided</option>
            <option value="refunded">Refunded</option>
          </select>
          <input type="date" value={filters.dateFrom} onChange={e => { setFilters(f => ({ ...f, dateFrom: e.target.value })); setPage(1); }}
            style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: '0.85rem' }} />
          <input type="date" value={filters.dateTo} onChange={e => { setFilters(f => ({ ...f, dateTo: e.target.value })); setPage(1); }}
            style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: '0.85rem' }} />
          <button onClick={fetchHistory} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.85rem' }}>
            <RefreshCw size={13} className={loading ? 'spin' : ''} /> Refresh
          </button>
          <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>{total.toLocaleString()} records</span>
        </div>

        {/* Table */}
        <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 12, background: 'var(--bg-panel)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Date', 'Type', 'Card', 'Amount', 'Auth Code', 'Status', 'Mode'].map(h => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 700, fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>
                  <Loader size={20} className="spin" style={{ marginRight: 8 }} />Loading...
                </td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>No transactions found</td></tr>
              ) : rows.map(r => (
                <tr key={r.id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                  <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', color: 'var(--text-muted)', fontSize: '0.8rem' }}>{fmtDate(r.createdAt)}</td>
                  <td style={{ padding: '10px 14px' }}><Badge val={r.type} colorMap={TYPE_COLORS} /></td>
                  <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontSize: '0.82rem' }}>{r.acctType ? `${r.acctType} ···· ${r.lastFour}` : '—'}</td>
                  <td style={{ padding: '10px 14px', fontWeight: 700, color: r.type === 'refund' ? '#ef4444' : 'var(--text-primary)' }}>{r.type === 'refund' ? '-' : ''}{fmt$(r.amount)}</td>
                  <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--text-muted)' }}>{r.authCode || '—'}</td>
                  <td style={{ padding: '10px 14px' }}><Badge val={r.status} colorMap={STATUS_COLORS} /></td>
                  <td style={{ padding: '10px 14px', color: 'var(--text-muted)', fontSize: '0.8rem' }}>{r.entryMode || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16, justifyContent: 'center' }}>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              style={{ padding: '6px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-secondary)', cursor: page === 1 ? 'not-allowed' : 'pointer', opacity: page === 1 ? 0.5 : 1 }}>
              ← Prev
            </button>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Page {page} of {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              style={{ padding: '6px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-secondary)', cursor: page === totalPages ? 'not-allowed' : 'pointer', opacity: page === totalPages ? 0.5 : 1 }}>
              Next →
            </button>
          </div>
        )}
      </div>
    </Layout>
  );
}
