/**
 * Transactions.jsx — Full transaction browser with advanced filters + receipt view.
 *
 * Filter architecture
 *   Server-side  : dateFrom, dateTo, cashierId, stationId, status, amountMin, amountMax
 *   Client-side  : search (txn#/cashier/item), timeFrom, timeTo, tenderType, dept, product
 *
 * Detail modal   : two-panel — thermal receipt (printable) + transaction metadata
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Sidebar from '../components/Sidebar';
import { useSetupStatus } from '../hooks/useSetupStatus';
import { getTransactions, getStoreEmployees } from '../services/api';
import {
  Receipt, Search, ChevronLeft, ChevronRight, RefreshCw, X,
  AlertCircle, Filter, ChevronDown, ChevronUp, Printer,
} from 'lucide-react';
import './Transactions.css';

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt$ = (v) => {
  if (v == null || v === '') return '—';
  const n = Number(v);
  return (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2);
};

const toLocalDateStr = (d = new Date()) => {
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
};

const shiftDays = (dateStr, n) => {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return toLocalDateStr(d);
};

const startOfMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
};

const METHOD_LABELS = {
  cash: 'Cash', card: 'Card', ebt: 'EBT',
  manual_card: 'Manual Card', manual_ebt: 'Manual EBT', other: 'Other',
};

const TENDER_PILL_CLASS = (method) => {
  if (method === 'cash') return 'txn-tender-cash';
  if (method === 'card' || method === 'manual_card') return 'txn-tender-card';
  if (method === 'ebt'  || method === 'manual_ebt')  return 'txn-tender-ebt';
  return 'txn-tender-other';
};

const STATUS_CLASS = (s) => {
  if (s === 'complete') return 'txn-status-complete';
  if (s === 'refund')   return 'txn-status-refund';
  if (s === 'voided')   return 'txn-status-voided';
  return 'txn-status-pending';
};

const STATUS_LABEL = { complete: 'Sale', refund: 'Refund', voided: 'Void' };

const itemCount = (tx) =>
  (tx.lineItems || []).reduce((s, i) => s + (i.qty || 1), 0);

// ── FinRow ────────────────────────────────────────────────────────────────────

function FinRow({ label, value, bold, muted }) {
  return (
    <div className={`txn-fin-row${bold ? ' bold' : muted ? ' muted' : ''}`}>
      <span>{label}</span>
      <span className="txn-fin-val">{value}</span>
    </div>
  );
}

// ── Receipt (printable) ───────────────────────────────────────────────────────

function TxReceipt({ tx, storeInfo }) {
  const items   = tx.lineItems   || [];
  const tenders = tx.tenderLines || [];
  const divider = '─'.repeat(36);

  return (
    <div className="txn-receipt-paper">
      {/* Store header */}
      <div className="txn-receipt-store-name">{storeInfo?.name || 'Store'}</div>
      {storeInfo?.address && (
        <div className="txn-receipt-store-addr">{storeInfo.address}</div>
      )}
      {storeInfo?.phone && (
        <div className="txn-receipt-store-phone">{storeInfo.phone}</div>
      )}

      <div className="txn-receipt-div">{divider}</div>

      {/* Meta */}
      <div className="txn-receipt-two-col">
        <span className="txn-receipt-label">Date</span>
        <span className="txn-receipt-val">{new Date(tx.createdAt).toLocaleDateString()}</span>
      </div>
      <div className="txn-receipt-two-col">
        <span className="txn-receipt-label">Time</span>
        <span className="txn-receipt-val">
          {new Date(tx.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
      <div className="txn-receipt-two-col">
        <span className="txn-receipt-label">Receipt #</span>
        <span className="txn-receipt-val">{tx.txNumber}</span>
      </div>
      <div className="txn-receipt-two-col">
        <span className="txn-receipt-label">Cashier</span>
        <span className="txn-receipt-val">{tx.cashierName || '—'}</span>
      </div>
      {tx.stationId && (
        <div className="txn-receipt-two-col">
          <span className="txn-receipt-label">Lane</span>
          <span className="txn-receipt-val">{tx.stationId}</span>
        </div>
      )}

      <div className="txn-receipt-div">{divider}</div>
      <div className="txn-receipt-section-hdr">Items</div>

      {items.map((item, i) => (
        <div key={i} className="txn-receipt-item">
          <div className="txn-receipt-item-name">{item.name || 'Item'}</div>
          <div className="txn-receipt-item-detail">
            <span>
              {item.qty > 1
                ? `${item.qty} × ${fmt$(item.unitPrice)}`
                : `  ${fmt$(item.unitPrice)}`}
            </span>
            <span>{fmt$(item.lineTotal)}</span>
          </div>
          {item.depositAmount > 0 && (
            <div className="txn-receipt-item-deposit">
              <span>  Deposit</span>
              <span>{fmt$(item.depositAmount)}</span>
            </div>
          )}
        </div>
      ))}

      <div className="txn-receipt-div">{divider}</div>

      {/* Totals */}
      {tx.subtotal > 0 && (
        <div className="txn-receipt-two-col">
          <span className="txn-receipt-label">Subtotal</span>
          <span className="txn-receipt-val">{fmt$(tx.subtotal)}</span>
        </div>
      )}
      {tx.taxTotal > 0 && (
        <div className="txn-receipt-two-col">
          <span className="txn-receipt-label">Tax</span>
          <span className="txn-receipt-val">{fmt$(tx.taxTotal)}</span>
        </div>
      )}
      {tx.depositTotal > 0 && (
        <div className="txn-receipt-two-col">
          <span className="txn-receipt-label">Deposit</span>
          <span className="txn-receipt-val">{fmt$(tx.depositTotal)}</span>
        </div>
      )}

      <div className="txn-receipt-grand">
        <span>TOTAL</span>
        <span>{fmt$(Math.abs(tx.grandTotal))}</span>
      </div>

      <div className="txn-receipt-div">{divider}</div>

      {/* Tender */}
      {tenders.map((t, i) => (
        <div key={i} className="txn-receipt-two-col">
          <span className="txn-receipt-label">{METHOD_LABELS[t.method] || t.method}</span>
          <span className="txn-receipt-val">{fmt$(t.amount)}</span>
        </div>
      ))}
      {tx.changeGiven > 0 && (
        <div className="txn-receipt-two-col">
          <span className="txn-receipt-label">Change</span>
          <span className="txn-receipt-val">-{fmt$(tx.changeGiven)}</span>
        </div>
      )}

      {/* Status notices */}
      {tx.status === 'refund' && (
        <>
          <div className="txn-receipt-div">{divider}</div>
          <div className="txn-receipt-notice refund">** REFUND **</div>
        </>
      )}
      {tx.status === 'voided' && (
        <>
          <div className="txn-receipt-div">{divider}</div>
          <div className="txn-receipt-notice voided">** VOIDED **</div>
        </>
      )}

      {/* Footer */}
      <div className="txn-receipt-div">{divider}</div>
      <div className="txn-receipt-footer-text">
        {storeInfo?.receiptFooter || 'Thank you for shopping with us!'}
      </div>
    </div>
  );
}

// ── Detail Modal ──────────────────────────────────────────────────────────────

function TxDetail({ tx, onClose, storeInfo }) {
  if (!tx) return null;

  const items   = tx.lineItems   || [];
  const tenders = tx.tenderLines || [];

  // Dept breakdown
  const deptMap = {};
  items.forEach(item => {
    const dept = item.departmentName || 'Uncategorized';
    deptMap[dept] = (deptMap[dept] || 0) + (Number(item.lineTotal) || 0);
  });
  const depts    = Object.entries(deptMap).sort((a, b) => b[1] - a[1]);
  const maxDept  = depts[0]?.[1] || 1;

  return (
    <div className="txn-modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="txn-modal">

        {/* Header */}
        <div className="txn-modal-header">
          <div className="txn-modal-title-group">
            <span className="txn-modal-txnum">{tx.txNumber}</span>
            <span className={`txn-status-badge ${STATUS_CLASS(tx.status)}`}>
              {STATUS_LABEL[tx.status] || tx.status}
            </span>
            <span className="txn-modal-date">
              {new Date(tx.createdAt).toLocaleString()}
            </span>
          </div>
          <div className="txn-modal-actions">
            <button className="txn-btn txn-btn-icon" onClick={() => window.print()} title="Print receipt">
              <Printer size={15} />
            </button>
            <button className="txn-btn txn-btn-icon" onClick={onClose} title="Close">
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="txn-modal-body">

          {/* Left — Receipt */}
          <div className="txn-receipt-panel">
            <TxReceipt tx={tx} storeInfo={storeInfo} />
          </div>

          {/* Right — Details */}
          <div className="txn-detail-panel">

            <div className="txn-detail-section-title">Transaction Details</div>
            <div className="txn-detail-grid">
              <div className="txn-detail-item full">
                <div className="txn-detail-lbl">Transaction ID</div>
                <div className="txn-detail-val mono">{tx.id}</div>
              </div>
              <div className="txn-detail-item">
                <div className="txn-detail-lbl">Cashier</div>
                <div className="txn-detail-val">{tx.cashierName || '—'}</div>
              </div>
              <div className="txn-detail-item">
                <div className="txn-detail-lbl">Lane / Station</div>
                <div className="txn-detail-val">{tx.stationId || '—'}</div>
              </div>
              <div className="txn-detail-item">
                <div className="txn-detail-lbl">Items Sold</div>
                <div className="txn-detail-val">
                  {itemCount(tx)} units · {items.length} line{items.length !== 1 ? 's' : ''}
                </div>
              </div>
              <div className="txn-detail-item">
                <div className="txn-detail-lbl">Status</div>
                <div className="txn-detail-val">
                  <span className={`txn-status-badge ${STATUS_CLASS(tx.status)}`}>
                    {STATUS_LABEL[tx.status] || tx.status}
                  </span>
                </div>
              </div>
              {tx.offlineCreatedAt && new Date(tx.offlineCreatedAt).getTime() !== new Date(tx.createdAt).getTime() && (
                <div className="txn-detail-item full">
                  <div className="txn-detail-lbl">Offline Created</div>
                  <div className="txn-detail-val">{new Date(tx.offlineCreatedAt).toLocaleString()}</div>
                </div>
              )}
              {tx.refundOf && (
                <div className="txn-detail-item full">
                  <div className="txn-detail-lbl">Refund Of (Transaction ID)</div>
                  <div className="txn-detail-val mono">{tx.refundOf}</div>
                </div>
              )}
              {tx.voidedAt && (
                <div className="txn-detail-item full">
                  <div className="txn-detail-lbl">Voided At</div>
                  <div className="txn-detail-val">{new Date(tx.voidedAt).toLocaleString()}</div>
                </div>
              )}
              {tx.notes && (
                <div className="txn-detail-item full">
                  <div className="txn-detail-lbl">Notes</div>
                  <div className="txn-detail-val">{tx.notes}</div>
                </div>
              )}
            </div>

            {/* Financial summary */}
            <div className="txn-detail-section-title">Financial Summary</div>
            {tx.subtotal > 0    && <FinRow label="Subtotal"           value={fmt$(tx.subtotal)} />}
            {tx.taxTotal > 0    && <FinRow label="Tax"                value={fmt$(tx.taxTotal)} />}
            {tx.depositTotal > 0 && <FinRow label="Container Deposit" value={fmt$(tx.depositTotal)} />}
            {tx.ebtTotal > 0    && <FinRow label="EBT Eligible"       value={fmt$(tx.ebtTotal)} muted />}
            <FinRow label="Grand Total" value={fmt$(Math.abs(tx.grandTotal))} bold />

            {/* Payment breakdown */}
            <div className="txn-detail-section-title">Payment Breakdown</div>
            {tenders.map((t, i) => (
              <FinRow key={i} label={METHOD_LABELS[t.method] || t.method} value={fmt$(t.amount)} />
            ))}
            {tx.changeGiven > 0 && (
              <FinRow label="Change Given" value={`-${fmt$(tx.changeGiven)}`} muted />
            )}

            {/* By department */}
            {depts.length > 1 && (
              <>
                <div className="txn-detail-section-title">By Department</div>
                {depts.map(([name, total]) => (
                  <div key={name} className="txn-dept-row">
                    <div className="txn-dept-label">{name}</div>
                    <div className="txn-dept-bar-wrap">
                      <div
                        className="txn-dept-bar"
                        style={{ width: `${(total / maxDept) * 100}%` }}
                      />
                    </div>
                    <div className="txn-dept-amt">{fmt$(total)}</div>
                  </div>
                ))}
              </>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

const PER_PAGE = 50;

export default function Transactions() {
  const today   = toLocalDateStr();
  const setup   = useSetupStatus();

  // ── Filter state ────────────────────────────────────────────────────────────
  const [dateFrom,    setDateFrom]    = useState(today);
  const [dateTo,      setDateTo]      = useState(today);
  const [search,      setSearch]      = useState('');
  const [showAdv,     setShowAdv]     = useState(false);
  const [fCashierId,  setFCashierId]  = useState('');
  const [fStation,    setFStation]    = useState('');
  const [fStatus,     setFStatus]     = useState('');
  const [fAmountMin,  setFAmountMin]  = useState('');
  const [fAmountMax,  setFAmountMax]  = useState('');
  const [fTimeFrom,   setFTimeFrom]   = useState('');
  const [fTimeTo,     setFTimeTo]     = useState('');
  const [fTender,     setFTender]     = useState('');
  const [fDept,       setFDept]       = useState('');
  const [fProduct,    setFProduct]    = useState('');

  // ── Data state ───────────────────────────────────────────────────────────────
  const [txs,      setTxs]      = useState([]);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);
  const [page,     setPage]     = useState(1);
  const [detail,   setDetail]   = useState(null);
  const [cashiers, setCashiers] = useState([]);

  const isToday    = dateFrom === today && dateTo === today;
  const refreshRef = useRef(null);

  // ── Store info for receipt header ────────────────────────────────────────────
  const activeStoreId = localStorage.getItem('activeStoreId');
  const activeStore   = setup.stores?.find(s => String(s.id) === String(activeStoreId))
                     || setup.stores?.[0];

  const storeInfo = activeStore ? {
    name:          activeStore.name,
    address:       activeStore.address,
    phone:         activeStore.phone,
    receiptFooter: activeStore.branding?.receiptFooter || activeStore.receiptFooter,
  } : null;

  // ── Load cashiers ────────────────────────────────────────────────────────────
  useEffect(() => {
    getStoreEmployees({ limit: 200 })
      .then(d => setCashiers(Array.isArray(d) ? d : (d.employees || [])))
      .catch(() => {});
  }, []);

  // ── Server fetch ─────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setPage(1);
    try {
      const params = { dateFrom, dateTo, limit: 500 };
      if (fCashierId) params.cashierId = fCashierId;
      if (fStation)   params.stationId = fStation;
      if (fStatus)    params.status    = fStatus;
      if (fAmountMin) params.amountMin = fAmountMin;
      if (fAmountMax) params.amountMax = fAmountMax;

      const data = await getTransactions(params);
      const list = Array.isArray(data) ? data : (data.transactions || data.data || []);
      setTxs([...list].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
    } catch (err) {
      setError(err?.response?.data?.error || err.message || 'Failed to load transactions');
      setTxs([]);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, fCashierId, fStation, fStatus, fAmountMin, fAmountMax]);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh every 60 s when viewing today
  useEffect(() => {
    if (!isToday) return;
    refreshRef.current = setInterval(load, 60_000);
    return () => clearInterval(refreshRef.current);
  }, [isToday, load]);

  // ── Client-side filter ───────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return txs.filter(tx => {
      // text search: TXN #, cashier, item name
      if (search.trim()) {
        const q   = search.toLowerCase();
        const ok  =
          String(tx.txNumber || '').toLowerCase().includes(q) ||
          (tx.cashierName || '').toLowerCase().includes(q) ||
          (tx.lineItems || []).some(i => (i.name || '').toLowerCase().includes(q));
        if (!ok) return false;
      }
      // time-of-day
      if (fTimeFrom || fTimeTo) {
        const d    = new Date(tx.createdAt);
        const mins = d.getHours() * 60 + d.getMinutes();
        if (fTimeFrom) {
          const [h, m] = fTimeFrom.split(':').map(Number);
          if (mins < h * 60 + m) return false;
        }
        if (fTimeTo) {
          const [h, m] = fTimeTo.split(':').map(Number);
          if (mins > h * 60 + m) return false;
        }
      }
      // tender type
      if (fTender) {
        const has = (tx.tenderLines || []).some(t =>
          t.method === fTender ||
          (fTender === 'card' && t.method === 'manual_card') ||
          (fTender === 'ebt'  && t.method === 'manual_ebt')
        );
        if (!has) return false;
      }
      // department
      if (fDept.trim()) {
        const q  = fDept.toLowerCase();
        const ok = (tx.lineItems || []).some(i =>
          (i.departmentName || '').toLowerCase().includes(q)
        );
        if (!ok) return false;
      }
      // product
      if (fProduct.trim()) {
        const q  = fProduct.toLowerCase();
        const ok = (tx.lineItems || []).some(i =>
          (i.name || '').toLowerCase().includes(q)
        );
        if (!ok) return false;
      }
      return true;
    });
  }, [txs, search, fTimeFrom, fTimeTo, fTender, fDept, fProduct]);

  // ── Summary stats ────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const sales = filtered.filter(t => t.status !== 'voided');
    const rev   = sales.reduce((s, t) => s + Math.abs(t.grandTotal || 0), 0);
    const cash  = sales.reduce((s, t) =>
      s + (t.tenderLines || []).filter(l => l.method === 'cash')
           .reduce((ss, l) => ss + (l.amount || 0), 0), 0);
    const card  = sales.reduce((s, t) =>
      s + (t.tenderLines || []).filter(l => l.method === 'card' || l.method === 'manual_card')
           .reduce((ss, l) => ss + (l.amount || 0), 0), 0);
    const ebt   = sales.reduce((s, t) =>
      s + (t.tenderLines || []).filter(l => l.method === 'ebt' || l.method === 'manual_ebt')
           .reduce((ss, l) => ss + (l.amount || 0), 0), 0);
    return {
      count:    filtered.length,
      revenue:  rev,
      avg:      sales.length ? rev / sales.length : 0,
      cash, card, ebt,
      refunds:  filtered.filter(t => t.status === 'refund').length,
      voided:   filtered.filter(t => t.status === 'voided').length,
    };
  }, [filtered]);

  // ── Pagination ───────────────────────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const paginated  = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  // ── Active advanced filters (for chips) ───────────────────────────────────────
  const advChips = useMemo(() => {
    const chips = [];
    if (fCashierId) {
      const c = cashiers.find(u => u.id === fCashierId);
      chips.push({ key: 'cashier', label: `Cashier: ${c?.name || fCashierId}`, clear: () => setFCashierId('') });
    }
    if (fStation)   chips.push({ key: 'station',   label: `Lane: ${fStation}`,            clear: () => setFStation('') });
    if (fStatus)    chips.push({ key: 'status',    label: `Status: ${STATUS_LABEL[fStatus] || fStatus}`, clear: () => setFStatus('') });
    if (fTimeFrom)  chips.push({ key: 'timeFrom',  label: `From: ${fTimeFrom}`,             clear: () => setFTimeFrom('') });
    if (fTimeTo)    chips.push({ key: 'timeTo',    label: `To: ${fTimeTo}`,                 clear: () => setFTimeTo('') });
    if (fTender)    chips.push({ key: 'tender',    label: `Tender: ${METHOD_LABELS[fTender] || fTender}`, clear: () => setFTender('') });
    if (fAmountMin) chips.push({ key: 'amtMin',    label: `Min $${fAmountMin}`,             clear: () => setFAmountMin('') });
    if (fAmountMax) chips.push({ key: 'amtMax',    label: `Max $${fAmountMax}`,             clear: () => setFAmountMax('') });
    if (fDept)      chips.push({ key: 'dept',      label: `Dept: ${fDept}`,                 clear: () => setFDept('') });
    if (fProduct)   chips.push({ key: 'product',   label: `Product: ${fProduct}`,           clear: () => setFProduct('') });
    return chips;
  }, [fCashierId, fStation, fStatus, fTimeFrom, fTimeTo, fTender, fAmountMin, fAmountMax, fDept, fProduct, cashiers]);

  const clearAll = () => {
    setFCashierId(''); setFStation(''); setFStatus('');
    setFTimeFrom(''); setFTimeTo(''); setFTender('');
    setFAmountMin(''); setFAmountMax('');
    setFDept(''); setFProduct(''); setSearch('');
  };

  // ── Preset date ranges ────────────────────────────────────────────────────────
  const setPreset = (preset) => {
    setPage(1);
    if (preset === 'today')     { setDateFrom(today);             setDateTo(today); }
    if (preset === 'yesterday') { const y = shiftDays(today, -1); setDateFrom(y); setDateTo(y); }
    if (preset === '7d')        { setDateFrom(shiftDays(today, -6)); setDateTo(today); }
    if (preset === '30d')       { setDateFrom(shiftDays(today, -29)); setDateTo(today); }
    if (preset === 'month')     { setDateFrom(startOfMonth());    setDateTo(today); }
  };

  const activePreset = (() => {
    if (dateFrom === today && dateTo === today) return 'today';
    const yest = shiftDays(today, -1);
    if (dateFrom === yest && dateTo === yest) return 'yesterday';
    if (dateFrom === shiftDays(today, -6)  && dateTo === today) return '7d';
    if (dateFrom === shiftDays(today, -29) && dateTo === today) return '30d';
    if (dateFrom === startOfMonth()        && dateTo === today) return 'month';
    return 'custom';
  })();

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="layout-container">
      <Sidebar />
      <div className="main-content txn-page">

        {/* Page header */}
        <div className="txn-header">
          <div className="txn-header-left">
            <Receipt size={22} className="txn-header-icon" />
            <div>
              <h1 className="txn-title">Transactions</h1>
              <p className="txn-subtitle">
                {isToday && <span className="txn-live-dot" />}
                {isToday ? 'Live · auto-refreshes every 60 s' : `${dateFrom} → ${dateTo}`}
              </p>
            </div>
          </div>
          <div className="txn-header-right">
            <button className="txn-btn" onClick={load} disabled={loading}>
              <RefreshCw size={13} className={loading ? 'txn-spin' : ''} />
              {loading ? 'Loading…' : 'Refresh'}
            </button>
          </div>
        </div>

        {/* ── Filter card ── */}
        <div className="txn-filter-card">
          <div className="txn-filter-quick">

            {/* Search */}
            <div className="txn-search-wrap">
              <Search size={13} className="txn-search-icon" />
              <input
                className="txn-input"
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }}
                placeholder="Search TXN #, cashier, item…"
              />
            </div>

            {/* Date range */}
            <div className="txn-date-group">
              <input
                type="date" className="txn-input-date"
                value={dateFrom} max={today}
                onChange={e => { setDateFrom(e.target.value); setPage(1); }}
              />
              <span className="txn-date-sep">→</span>
              <input
                type="date" className="txn-input-date"
                value={dateTo} min={dateFrom} max={today}
                onChange={e => { setDateTo(e.target.value); setPage(1); }}
              />
            </div>

            {/* Presets */}
            <div className="txn-presets">
              {[
                { id: 'today',     label: 'Today' },
                { id: 'yesterday', label: 'Yesterday' },
                { id: '7d',        label: '7d' },
                { id: '30d',       label: '30d' },
                { id: 'month',     label: 'Month' },
              ].map(p => (
                <button
                  key={p.id}
                  className={`txn-preset${activePreset === p.id ? ' active' : ''}`}
                  onClick={() => setPreset(p.id)}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Status quick pick */}
            <select
              className="txn-select"
              value={fStatus}
              onChange={e => { setFStatus(e.target.value); setPage(1); }}
            >
              <option value="">All Status</option>
              <option value="complete">Sales</option>
              <option value="refund">Refunds</option>
              <option value="voided">Voided</option>
            </select>

            {/* Advanced toggle */}
            <button
              className={`txn-adv-toggle${showAdv ? ' open' : ''}`}
              onClick={() => setShowAdv(v => !v)}
            >
              <Filter size={12} />
              Advanced
              {showAdv ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              {advChips.length > 0 && (
                <span style={{ marginLeft: 2, background: 'var(--accent-primary)', color: '#fff',
                  borderRadius: '99px', padding: '0 5px', fontSize: '0.65rem', fontWeight: 800 }}>
                  {advChips.length}
                </span>
              )}
            </button>
          </div>

          {/* ── Advanced panel ── */}
          {showAdv && (
            <div className="txn-filter-adv">

              {/* Cashier */}
              <div className="txn-filter-field">
                <div className="txn-filter-label">Cashier</div>
                <select
                  className="txn-select"
                  value={fCashierId}
                  onChange={e => { setFCashierId(e.target.value); setPage(1); }}
                >
                  <option value="">All Cashiers</option>
                  {cashiers.map(u => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              </div>

              {/* Station / Lane */}
              <div className="txn-filter-field">
                <div className="txn-filter-label">Lane / Station</div>
                <input
                  className={`txn-input txn-input-plain`}
                  value={fStation}
                  onChange={e => { setFStation(e.target.value); setPage(1); }}
                  placeholder="Station ID"
                />
              </div>

              {/* Time From */}
              <div className="txn-filter-field">
                <div className="txn-filter-label">Time From</div>
                <input
                  type="time" className="txn-input txn-input-plain"
                  value={fTimeFrom}
                  onChange={e => { setFTimeFrom(e.target.value); setPage(1); }}
                />
              </div>

              {/* Time To */}
              <div className="txn-filter-field">
                <div className="txn-filter-label">Time To</div>
                <input
                  type="time" className="txn-input txn-input-plain"
                  value={fTimeTo}
                  onChange={e => { setFTimeTo(e.target.value); setPage(1); }}
                />
              </div>

              {/* Tender Type */}
              <div className="txn-filter-field">
                <div className="txn-filter-label">Tender Type</div>
                <select
                  className="txn-select"
                  value={fTender}
                  onChange={e => { setFTender(e.target.value); setPage(1); }}
                >
                  <option value="">All Tenders</option>
                  <option value="cash">Cash</option>
                  <option value="card">Card (incl. manual)</option>
                  <option value="ebt">EBT (incl. manual)</option>
                  <option value="other">Other</option>
                </select>
              </div>

              {/* Amount range */}
              <div className="txn-filter-field">
                <div className="txn-filter-label">Amount ($)</div>
                <div className="txn-filter-row-group">
                  <input
                    type="number" step="0.01" min="0"
                    className="txn-input txn-input-plain"
                    value={fAmountMin}
                    onChange={e => { setFAmountMin(e.target.value); setPage(1); }}
                    placeholder="Min"
                  />
                  <span className="txn-date-sep">–</span>
                  <input
                    type="number" step="0.01" min="0"
                    className="txn-input txn-input-plain"
                    value={fAmountMax}
                    onChange={e => { setFAmountMax(e.target.value); setPage(1); }}
                    placeholder="Max"
                  />
                </div>
              </div>

              {/* Department */}
              <div className="txn-filter-field">
                <div className="txn-filter-label">Department</div>
                <input
                  className="txn-input txn-input-plain"
                  value={fDept}
                  onChange={e => { setFDept(e.target.value); setPage(1); }}
                  placeholder="e.g. Grocery"
                />
              </div>

              {/* Product */}
              <div className="txn-filter-field">
                <div className="txn-filter-label">Product</div>
                <input
                  className="txn-input txn-input-plain"
                  value={fProduct}
                  onChange={e => { setFProduct(e.target.value); setPage(1); }}
                  placeholder="Product name"
                />
              </div>

            </div>
          )}

          {/* Active filter chips */}
          {advChips.length > 0 && (
            <div className="txn-chip-strip">
              {advChips.map(chip => (
                <span key={chip.key} className="txn-chip">
                  {chip.label}
                  <span className="txn-chip-x" onClick={chip.clear}><X size={10} /></span>
                </span>
              ))}
              <button className="txn-clear-all" onClick={clearAll}>Clear all</button>
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="txn-error">
            <AlertCircle size={15} /> {error}
          </div>
        )}

        {/* ── Summary cards ── */}
        <div className="txn-summary-grid">
          <div className="txn-summary-card">
            <div className="txn-summary-label">Transactions</div>
            <div className="txn-summary-value">{stats.count}</div>
          </div>
          <div className="txn-summary-card">
            <div className="txn-summary-label">Total Revenue</div>
            <div className="txn-summary-value accent">{fmt$(stats.revenue)}</div>
          </div>
          <div className="txn-summary-card">
            <div className="txn-summary-label">Avg Sale</div>
            <div className="txn-summary-value">{stats.avg ? fmt$(stats.avg) : '—'}</div>
          </div>
          <div className="txn-summary-card">
            <div className="txn-summary-label">Cash</div>
            <div className="txn-summary-value green">{fmt$(stats.cash)}</div>
          </div>
          <div className="txn-summary-card">
            <div className="txn-summary-label">Card</div>
            <div className="txn-summary-value blue">{fmt$(stats.card)}</div>
          </div>
          <div className="txn-summary-card">
            <div className="txn-summary-label">EBT</div>
            <div className="txn-summary-value purple">{fmt$(stats.ebt)}</div>
          </div>
          <div className="txn-summary-card">
            <div className="txn-summary-label">Refunds</div>
            <div className={`txn-summary-value${stats.refunds > 0 ? ' red' : ' muted'}`}>
              {stats.refunds}
            </div>
          </div>
          <div className="txn-summary-card">
            <div className="txn-summary-label">Voided</div>
            <div className={`txn-summary-value${stats.voided > 0 ? ' red' : ' muted'}`}>
              {stats.voided}
            </div>
          </div>
        </div>

        {/* ── Table ── */}
        <div className="txn-table-card">
          {loading ? (
            <div className="txn-empty">
              <div className="txn-empty-icon"><RefreshCw size={30} className="txn-spin" /></div>
              Loading transactions…
            </div>
          ) : paginated.length === 0 ? (
            <div className="txn-empty">
              <div className="txn-empty-icon"><Receipt size={34} /></div>
              {txs.length === 0 ? 'No transactions for this period.' : 'No results match your filters.'}
            </div>
          ) : (
            <>
              <div className="txn-table-header">
                <span>Date / Time</span>
                <span>TXN #</span>
                <span>Cashier</span>
                <span>Station</span>
                <span>Items</span>
                <span>Payment</span>
                <span style={{ textAlign: 'right' }}>Total</span>
              </div>

              {paginated.map(tx => (
                <div
                  key={tx.id}
                  className={`txn-table-row${tx.status === 'voided' ? ' voided' : ''}`}
                  onClick={() => setDetail(tx)}
                >
                  <div>
                    <div className="txn-cell-time">
                      {new Date(tx.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                    </div>
                    <div className="txn-cell-time">
                      {new Date(tx.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                  <div>
                    <div className="txn-cell-txnum">{tx.txNumber}</div>
                    {tx.status !== 'complete' && (
                      <span className={`txn-status-badge ${STATUS_CLASS(tx.status)}`} style={{ marginTop: 2, display: 'inline-block' }}>
                        {STATUS_LABEL[tx.status] || tx.status}
                      </span>
                    )}
                  </div>
                  <div className="txn-cell-cashier">{tx.cashierName || '—'}</div>
                  <div className="txn-cell-station">{tx.stationId || '—'}</div>
                  <div className="txn-cell-items">{itemCount(tx)}</div>
                  <div className="txn-cell-payment">
                    {[...new Set((tx.tenderLines || []).map(t => t.method))].map(m => (
                      <span key={m} className={`txn-tender-pill ${TENDER_PILL_CLASS(m)}`}>
                        {METHOD_LABELS[m] || m}
                      </span>
                    ))}
                  </div>
                  <div className="txn-cell-total">
                    {tx.status === 'voided'
                      ? <span style={{ color: 'var(--text-muted)', textDecoration: 'line-through' }}>{fmt$(Math.abs(tx.grandTotal))}</span>
                      : fmt$(Math.abs(tx.grandTotal))}
                  </div>
                </div>
              ))}

              {totalPages > 1 && (
                <div className="txn-pagination">
                  <button
                    className="txn-btn txn-btn-icon"
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <span className="txn-page-info">
                    Page {page} of {totalPages} · {filtered.length} results
                  </span>
                  <button
                    className="txn-btn txn-btn-icon"
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Detail modal */}
        {detail && (
          <TxDetail
            tx={detail}
            onClose={() => setDetail(null)}
            storeInfo={storeInfo}
          />
        )}
      </div>
    </div>
  );
}
