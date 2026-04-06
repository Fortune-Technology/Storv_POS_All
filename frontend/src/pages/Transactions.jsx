/**
 * Transactions.jsx — Store Dashboard: browse and search all POS transactions
 */
import React, { useState, useEffect, useCallback } from 'react';
import Sidebar from '../components/Sidebar';
import { getTransactions } from '../services/api';
import {
  Receipt, Search, ChevronLeft, ChevronRight,
  Calendar, RefreshCw, X, AlertCircle,
} from 'lucide-react';

// ── Helpers ──────────────────────────────────────────────────────────────────
const fmt$ = (v) => {
  if (v == null) return '—';
  const n = Number(v);
  return (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2);
};

const fmtTxNumber = (n) => n ? String(n) : '—';

const toLocalDateStr = (d = new Date()) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
};

const shiftDate = (dateStr, days) => {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return toLocalDateStr(d);
};

const METHOD_LABELS = {
  cash: 'Cash', card: 'Card', ebt: 'EBT',
  manual_card: 'Manual Card', manual_ebt: 'Manual EBT', other: 'Other',
};

const paymentSummary = (tx) => {
  const lines = tx.tenderLines || [];
  if (!lines.length) return '—';
  return lines.map(t => METHOD_LABELS[t.method] || t.method).join(' + ');
};

// ── Detail panel ─────────────────────────────────────────────────────────────
function TxDetail({ tx, onClose }) {
  if (!tx) return null;
  const lines = tx.tenderLines || [];
  const items = tx.lineItems   || [];
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 400,
      background: 'rgba(0,0,0,.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '1rem',
    }}>
      <div style={{
        width: '100%', maxWidth: 480,
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: '0 24px 64px rgba(0,0,0,.3)',
        display: 'flex', flexDirection: 'column',
        maxHeight: '90vh', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '1rem 1.25rem',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          flexShrink: 0,
        }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>
              {fmtTxNumber(tx.txNumber)}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>
              {new Date(tx.createdAt).toLocaleString()} · {tx.cashierName || 'Unknown'}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 6, display: 'flex' }}>
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '1rem 1.25rem', overflowY: 'auto', flex: 1 }}>
          {/* Line items */}
          <div style={{ marginBottom: '1rem' }}>
            <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.08em', marginBottom: 6, textTransform: 'uppercase' }}>Items</div>
            {items.map((item, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.83rem', marginBottom: 4, color: 'var(--text-primary)' }}>
                <span>{item.qty > 1 ? `${item.qty}× ` : ''}{item.name}</span>
                <span style={{ fontWeight: 600 }}>{fmt$(item.lineTotal)}</span>
              </div>
            ))}
          </div>

          {/* Totals */}
          <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '0.75rem', marginBottom: '0.75rem' }}>
            {tx.subtotal   != null && <Row label="Subtotal" value={fmt$(tx.subtotal)} />}
            {tx.taxTotal   != null && tx.taxTotal > 0 && <Row label="Tax" value={fmt$(tx.taxTotal)} />}
            {tx.depositTotal != null && tx.depositTotal > 0 && <Row label="Deposit" value={fmt$(tx.depositTotal)} />}
            {tx.discountTotal != null && tx.discountTotal > 0 && <Row label="Discount" value={`-${fmt$(tx.discountTotal)}`} muted />}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: '0.95rem', marginTop: 4, color: 'var(--text-primary)' }}>
              <span>TOTAL</span>
              <span style={{ color: 'var(--accent-primary)' }}>{fmt$(Math.abs(tx.grandTotal))}</span>
            </div>
          </div>

          {/* Tender */}
          <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '0.75rem' }}>
            <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.08em', marginBottom: 6, textTransform: 'uppercase' }}>Payment</div>
            {lines.map((t, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.83rem', color: 'var(--text-secondary)', marginBottom: 3 }}>
                <span>{METHOD_LABELS[t.method] || t.method}</span>
                <span>{fmt$(t.amount)}</span>
              </div>
            ))}
            {tx.changeGiven > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.83rem', fontWeight: 700, color: 'var(--accent-primary)', marginTop: 4 }}>
                <span>Change</span>
                <span>{fmt$(tx.changeGiven)}</span>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '0.75rem 1.25rem', borderTop: '1px solid var(--border-color)', flexShrink: 0 }}>
          <button onClick={onClose} className="btn btn-primary" style={{ width: '100%' }}>Close</button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, muted }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.83rem', color: muted ? 'var(--text-muted)' : 'var(--text-secondary)', marginBottom: 3 }}>
      <span>{label}</span><span>{value}</span>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Transactions() {
  const today = toLocalDateStr();
  const [date,    setDate]    = useState(today);
  const [txs,     setTxs]     = useState([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);
  const [search,  setSearch]  = useState('');
  const [detail,  setDetail]  = useState(null);
  const [page,    setPage]    = useState(1);
  const PER_PAGE = 50;

  const load = useCallback(async (d) => {
    setLoading(true);
    setError(null);
    setPage(1);
    try {
      const data = await getTransactions({ date: d, limit: 300 });
      const list = Array.isArray(data) ? data : (data.transactions || data.data || []);
      // Newest first
      setTxs([...list].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
    } catch (err) {
      setError(err?.response?.data?.error || err.message || 'Failed to load transactions');
      setTxs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(date); }, [date, load]);

  const filtered = txs.filter(tx => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (tx.txNumber && String(tx.txNumber).toLowerCase().includes(q)) ||
      (tx.cashierName && tx.cashierName.toLowerCase().includes(q)) ||
      (tx.lineItems || []).some(i => i.name?.toLowerCase().includes(q))
    );
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const paginated  = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  const dailyTotal = txs.reduce((sum, tx) => sum + (tx.grandTotal || 0), 0);

  return (
    <div className="layout-container">
      <Sidebar />
      <div className="main-content" style={{ padding: '2rem', background: 'var(--bg-primary)', minHeight: '100vh' }}>

        {/* Page header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Receipt size={22} color="var(--accent-primary)" />
            <div>
              <h1 style={{ margin: 0, fontSize: '1.35rem', fontWeight: 800, color: 'var(--text-primary)' }}>Transactions</h1>
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>Browse all POS sales by date</p>
            </div>
          </div>

          {/* Date nav */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button onClick={() => setDate(d => shiftDate(d, -1))} style={navBtn}>
              <ChevronLeft size={16} />
            </button>
            <div style={{ position: 'relative' }}>
              <Calendar size={13} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
              <input
                type="date" value={date}
                onChange={e => setDate(e.target.value)}
                style={{ paddingLeft: 28, paddingRight: 10, paddingTop: 7, paddingBottom: 7, borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '0.85rem', cursor: 'pointer' }}
              />
            </div>
            <button onClick={() => setDate(d => shiftDate(d, 1))} disabled={date >= today} style={{ ...navBtn, opacity: date >= today ? 0.4 : 1 }}>
              <ChevronRight size={16} />
            </button>
            {date !== today && (
              <button onClick={() => setDate(today)} style={{ ...navBtn, fontSize: '0.72rem', padding: '6px 10px', fontWeight: 600 }}>Today</button>
            )}
            <button onClick={() => load(date)} style={navBtn}>
              <RefreshCw size={14} />
            </button>
          </div>
        </div>

        {/* Summary cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: '1.5rem' }}>
          <SummaryCard label="Transactions" value={txs.length} />
          <SummaryCard label="Daily Total" value={fmt$(dailyTotal)} accent />
          <SummaryCard label="Avg Sale" value={txs.length ? fmt$(dailyTotal / txs.length) : '—'} />
          <SummaryCard
            label="Cash"
            value={fmt$(txs.filter(tx => tx.tenderLines?.some(t => t.method === 'cash')).reduce((s, tx) => s + (tx.grandTotal || 0), 0))}
          />
        </div>

        {/* Search */}
        <div style={{ position: 'relative', marginBottom: '1rem' }}>
          <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
          <input
            value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search by TXN #, cashier, or item…"
            style={{ width: '100%', paddingLeft: 36, paddingRight: 12, paddingTop: 9, paddingBottom: 9, borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '0.875rem', boxSizing: 'border-box' }}
          />
        </div>

        {/* Error */}
        {error && (
          <div style={{ background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 'var(--radius-md)', padding: '0.75rem 1rem', color: '#ef4444', display: 'flex', alignItems: 'center', gap: 8, marginBottom: '1rem', fontSize: '0.85rem' }}>
            <AlertCircle size={16} /> {error}
          </div>
        )}

        {/* Table */}
        <div className="card" style={{ overflow: 'hidden', padding: 0 }}>
          {loading ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              <RefreshCw size={22} style={{ animation: 'spin 1s linear infinite', marginBottom: 10 }} /><br />Loading transactions…
            </div>
          ) : paginated.length === 0 ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              <Receipt size={32} style={{ marginBottom: 12, opacity: 0.3 }} /><br />
              {txs.length === 0 ? 'No transactions found for this date.' : 'No results match your search.'}
            </div>
          ) : (
            <>
              {/* Table header */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr 1fr 1fr', padding: '0.6rem 1.1rem', borderBottom: '1px solid var(--border-color)', fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                <span>Time</span>
                <span>TXN #</span>
                <span>Cashier</span>
                <span>Payment</span>
                <span style={{ textAlign: 'right' }}>Total</span>
              </div>

              {paginated.map((tx) => (
                <div
                  key={tx.id}
                  onClick={() => setDetail(tx)}
                  style={{
                    display: 'grid', gridTemplateColumns: '1fr 2fr 1fr 1fr 1fr',
                    padding: '0.7rem 1.1rem',
                    borderBottom: '1px solid var(--border-color)',
                    cursor: 'pointer', transition: 'background .1s',
                    alignItems: 'center',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-tertiary)'}
                  onMouseLeave={e => e.currentTarget.style.background = ''}
                >
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    {new Date(tx.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--accent-primary)' }}>
                    {fmtTxNumber(tx.txNumber)}
                  </span>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    {tx.cashierName || '—'}
                  </span>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                    {paymentSummary(tx)}
                  </span>
                  <span style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)', textAlign: 'right' }}>
                    {fmt$(Math.abs(tx.grandTotal))}
                  </span>
                </div>
              ))}

              {/* Pagination */}
              {totalPages > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '0.875rem', borderTop: '1px solid var(--border-color)' }}>
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} style={navBtn}>
                    <ChevronLeft size={14} />
                  </button>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    Page {page} of {totalPages} · {filtered.length} results
                  </span>
                  <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} style={navBtn}>
                    <ChevronRight size={14} />
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Detail modal */}
        {detail && <TxDetail tx={detail} onClose={() => setDetail(null)} />}
      </div>
    </div>
  );
}

function SummaryCard({ label, value, accent }) {
  return (
    <div className="card" style={{ padding: '0.875rem 1rem' }}>
      <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: '1.25rem', fontWeight: 800, color: accent ? 'var(--accent-primary)' : 'var(--text-primary)' }}>{value}</div>
    </div>
  );
}

const navBtn = {
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border-color)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  padding: '6px 10px',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontSize: '0.8rem',
};
