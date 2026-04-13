/**
 * PayoutsReport — Back-office view of all vendor payouts (expense + merchandise).
 * GET /api/pos-terminal/payouts?storeId=&dateFrom=&dateTo=&payoutType=&limit=
 */
import React, { useState, useCallback } from 'react';
import api from '../services/api';
import {
  ArrowUpCircle, DollarSign, ShoppingCart, RefreshCw,
  AlertCircle, Search, Filter, ChevronDown, Wallet,
} from 'lucide-react';
import { fmt$, todayStr, firstOfMonthStr } from '../utils/formatters';
import './PayoutsReport.css';

// ── helpers ────────────────────────────────────────────────────────────────
function fmtDatetime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// ── style helpers ──────────────────────────────────────────────────────────
const inputStyle = {
  padding: '0.5rem 0.75rem',
  borderRadius: 8,
  border: '1px solid var(--border-color, #2a2a3a)',
  background: 'var(--bg-tertiary, #1a1a2a)',
  color: 'var(--text-primary, #e2e8f0)',
  fontSize: '0.875rem',
  height: 38,
  outline: 'none',
};

const selectStyle = { ...inputStyle, paddingRight: '2rem', cursor: 'pointer' };

function TypeBadge({ type }) {
  const isMerch = type === 'merchandise';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '0.2rem 0.6rem',
      borderRadius: 20,
      fontSize: '0.7rem', fontWeight: 700,
      letterSpacing: '0.04em',
      background: isMerch ? 'rgba(168,85,247,.12)' : 'rgba(245,158,11,.12)',
      color: isMerch ? '#a855f7' : '#f59e0b',
      border: `1px solid ${isMerch ? 'rgba(168,85,247,.3)' : 'rgba(245,158,11,.3)'}`,
    }}>
      {isMerch ? <ShoppingCart size={10} /> : <DollarSign size={10} />}
      {isMerch ? 'Merchandise' : type ? type.charAt(0).toUpperCase() + type.slice(1) : 'Expense'}
    </span>
  );
}

// ── Summary card ───────────────────────────────────────────────────────────
function SummaryCard({ label, value, icon: Icon, color, bg }) {
  return (
    <div style={{
      flex: 1, minWidth: 160,
      padding: '1rem 1.25rem',
      background: bg || 'var(--bg-secondary, #111827)',
      border: '1px solid var(--border-color, #1f2937)',
      borderRadius: 12,
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: 10, flexShrink: 0,
        background: `${color}18`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon size={16} color={color} />
      </div>
      <div>
        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted, #6b7280)', fontWeight: 600, marginBottom: 2 }}>
          {label}
        </div>
        <div style={{ fontSize: '1.1rem', fontWeight: 800, color: color }}>
          {value}
        </div>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────
export default function PayoutsReport({ embedded }) {
  const user    = (() => { try { return JSON.parse(localStorage.getItem('user')); } catch { return null; } })();
  const storeId = localStorage.getItem('activeStoreId') || user?.storeId;

  const [dateFrom,    setDateFrom]    = useState(firstOfMonthStr());
  const [dateTo,      setDateTo]      = useState(todayStr());
  const [payoutType,  setPayoutType]  = useState('');   // '' | 'expense' | 'merchandise'
  const [search,      setSearch]      = useState('');
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState('');
  const [payouts,     setPayouts]     = useState(null);  // null = not yet loaded
  const [summary,     setSummary]     = useState(null);

  const run = useCallback(async () => {
    if (!storeId) { setError('No store selected. Please select a store first.'); return; }
    setLoading(true);
    setError('');
    try {
      const params = { storeId, dateFrom, dateTo, limit: 500 };
      if (payoutType) params.payoutType = payoutType;
      const res = await api.get('/pos-terminal/payouts', { params });
      setPayouts(res.data.payouts || []);
      setSummary(res.data.summary || {});
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load payouts');
    } finally {
      setLoading(false);
    }
  }, [storeId, dateFrom, dateTo, payoutType]);

  // Filtered rows by search term
  const rows = (payouts || []).filter(p => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (p.vendorName || '').toLowerCase().includes(q) ||
      (p.notes || '').toLowerCase().includes(q) ||
      (p.cashierName || '').toLowerCase().includes(q) ||
      (p.payoutType || '').toLowerCase().includes(q)
    );
  });

  const content = (
    <>

      {/* ── Header ── */}
      <div className="p-header">
        <div className="p-header-left">
          <div className="p-header-icon">
            <Wallet size={22} />
          </div>
          <div>
            <h1 className="p-title">Payouts Report</h1>
            <p className="p-subtitle">Vendor expenses &amp; merchandise payouts from cash drawer</p>
          </div>
        </div>
        <div className="p-header-actions"></div>
      </div>

      {/* ── Filters row ── */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end',
        marginBottom: '1.25rem',
        padding: '1rem 1.25rem',
        background: 'var(--bg-secondary, #111827)',
        border: '1px solid var(--border-color, #1f2937)',
        borderRadius: 12,
      }}>
        {/* Date From */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted, #6b7280)', letterSpacing: '0.06em' }}>
            FROM
          </label>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={inputStyle} />
        </div>

        {/* Date To */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted, #6b7280)', letterSpacing: '0.06em' }}>
            TO
          </label>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={inputStyle} />
        </div>

        {/* Payout type filter */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted, #6b7280)', letterSpacing: '0.06em' }}>
            TYPE
          </label>
          <div style={{ position: 'relative' }}>
            <select value={payoutType} onChange={e => setPayoutType(e.target.value)} style={selectStyle}>
              <option value="">All Types</option>
              <option value="expense">Expense</option>
              <option value="merchandise">Merchandise</option>
            </select>
            <ChevronDown size={12} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-muted, #6b7280)' }} />
          </div>
        </div>

        {/* Run button */}
        <button
          onClick={run}
          disabled={loading}
          style={{
            height: 38, padding: '0 1.25rem',
            background: 'var(--accent-primary, #6366f1)',
            border: 'none', borderRadius: 8,
            color: '#fff', fontWeight: 700, fontSize: '0.875rem',
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.7 : 1,
            display: 'flex', alignItems: 'center', gap: 6,
            alignSelf: 'flex-end',
          }}
        >
          <RefreshCw size={14} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
          {loading ? 'Loading…' : 'Run Report'}
        </button>
      </div>

      {/* ── Error ── */}
      {error && (
        <div style={{
          padding: '0.75rem 1rem', borderRadius: 8, marginBottom: '1rem',
          background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)',
          color: '#f87171', fontSize: '0.85rem', fontWeight: 600,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <AlertCircle size={15} /> {error}
        </div>
      )}

      {/* ── Summary cards ── */}
      {summary && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: '1.25rem' }}>
          <SummaryCard
            label="Total Expenses"
            value={fmt$(summary.totalExpense)}
            icon={DollarSign}
            color="#f59e0b"
          />
          <SummaryCard
            label="Merchandise"
            value={fmt$(summary.totalMerchandise)}
            icon={ShoppingCart}
            color="#a855f7"
          />
          <SummaryCard
            label="Total Paid Out"
            value={fmt$(summary.total)}
            icon={ArrowUpCircle}
            color="#34d399"
          />
          <SummaryCard
            label="Transactions"
            value={summary.count || 0}
            icon={Filter}
            color="var(--text-secondary, #9ca3af)"
          />
        </div>
      )}

      {/* ── Results table ── */}
      {payouts !== null && (
        <div style={{
          background: 'var(--bg-secondary, #111827)',
          border: '1px solid var(--border-color, #1f2937)',
          borderRadius: 12, overflow: 'hidden',
        }}>

          {/* Table toolbar */}
          <div style={{
            padding: '0.75rem 1rem',
            borderBottom: '1px solid var(--border-color, #1f2937)',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <div style={{ position: 'relative', flex: 1, maxWidth: 320 }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted, #6b7280)', pointerEvents: 'none' }} />
              <input
                type="text"
                placeholder="Search vendor, notes, cashier…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ ...inputStyle, paddingLeft: 32, width: '100%', boxSizing: 'border-box' }}
              />
            </div>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted, #6b7280)', fontWeight: 600 }}>
              {rows.length} record{rows.length !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Table */}
          {rows.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted, #6b7280)', fontSize: '0.875rem' }}>
              <AlertCircle size={28} style={{ marginBottom: 8, opacity: 0.35 }} /><br />
              {payouts.length === 0 ? 'No payouts found for the selected period.' : 'No results match your search.'}
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-color, #1f2937)' }}>
                    {['Date & Time', 'Type', 'Vendor / Payee', 'Notes', 'Cashier', 'Amount'].map(h => (
                      <th key={h} style={{
                        padding: '0.625rem 1rem',
                        textAlign: h === 'Amount' ? 'right' : 'left',
                        fontSize: '0.7rem', fontWeight: 700,
                        color: 'var(--text-muted, #6b7280)',
                        letterSpacing: '0.06em', whiteSpace: 'nowrap',
                        background: 'var(--bg-tertiary, #0f172a)',
                      }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p, i) => (
                    <tr
                      key={p.id || i}
                      style={{
                        borderBottom: '1px solid var(--border-color, #1f2937)',
                        background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,.018)',
                        transition: 'background .1s',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,.04)'}
                      onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,.018)'}
                    >
                      <td style={{ padding: '0.625rem 1rem', fontSize: '0.8rem', color: 'var(--text-secondary, #9ca3af)', whiteSpace: 'nowrap' }}>
                        {fmtDatetime(p.createdAt)}
                      </td>
                      <td style={{ padding: '0.625rem 1rem' }}>
                        <TypeBadge type={p.payoutType} />
                      </td>
                      <td style={{ padding: '0.625rem 1rem', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary, #e2e8f0)' }}>
                        {p.vendorName || <span style={{ color: 'var(--text-muted, #6b7280)', fontStyle: 'italic' }}>—</span>}
                      </td>
                      <td style={{ padding: '0.625rem 1rem', fontSize: '0.82rem', color: 'var(--text-secondary, #9ca3af)', maxWidth: 260 }}>
                        <span title={p.notes || ''} style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {p.notes || <span style={{ color: 'var(--text-muted, #6b7280)', fontStyle: 'italic' }}>No notes</span>}
                        </span>
                      </td>
                      <td style={{ padding: '0.625rem 1rem', fontSize: '0.82rem', color: 'var(--text-secondary, #9ca3af)', whiteSpace: 'nowrap' }}>
                        {p.cashierName || '—'}
                      </td>
                      <td style={{ padding: '0.625rem 1rem', textAlign: 'right', fontWeight: 800, fontSize: '0.9rem', color: '#f87171', whiteSpace: 'nowrap' }}>
                        -{fmt$(p.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                {/* Footer total */}
                <tfoot>
                  <tr style={{ borderTop: '2px solid var(--border-color, #1f2937)', background: 'var(--bg-tertiary, #0f172a)' }}>
                    <td colSpan={5} style={{ padding: '0.625rem 1rem', fontWeight: 700, fontSize: '0.8rem', color: 'var(--text-secondary, #9ca3af)' }}>
                      Total ({rows.length} records)
                    </td>
                    <td style={{ padding: '0.625rem 1rem', textAlign: 'right', fontWeight: 900, fontSize: '0.95rem', color: '#f87171' }}>
                      -{fmt$(rows.reduce((s, p) => s + Number(p.amount), 0))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Initial prompt ── */}
      {payouts === null && !loading && !error && (
        <div style={{
          textAlign: 'center', padding: '4rem 2rem',
          background: 'var(--bg-secondary, #111827)',
          border: '1px solid var(--border-color, #1f2937)',
          borderRadius: 12,
          color: 'var(--text-muted, #6b7280)', fontSize: '0.875rem',
        }}>
          <ArrowUpCircle size={36} style={{ marginBottom: 12, opacity: 0.25 }} /><br />
          Select a date range and click <strong style={{ color: 'var(--text-secondary, #9ca3af)' }}>Run Report</strong> to view payouts.
        </div>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </>
  );

  if (embedded) return <div className="p-tab-content">{content}</div>;

  return (
    <div className="pr-container">
      {content}
    </div>
  );
}
