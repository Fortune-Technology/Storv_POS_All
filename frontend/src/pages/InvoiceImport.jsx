import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import './analytics.css';
import './InvoiceImport.css';
import {
  Upload as UploadIcon,
  FileText,
  Trash2,
  CheckCircle,
  AlertCircle,
  Loader,
  RotateCcw,
  X,
  Search,
  Package,
  DollarSign,
  Save,
  RefreshCw,
  PlusCircle,
  Plus,
  ChevronDown,
  ChevronUp,
  FileUp,
  Info,
} from 'lucide-react';

import {
  queueInvoice,
  queueMultipageInvoice,
  getInvoiceDrafts,
  getInvoiceHistory,
  confirmInvoice,
  deleteInvoiceDraft,
  saveInvoiceDraft,
  searchCatalogProducts,
  updateCatalogProduct,
  createCatalogProduct,
  getCatalogTaxRules,
  getCatalogDepositRules,
  getCatalogDepartments,
  getCatalogVendors,
  clearInvoicePOSCache,
  adjustStoreStock,
  rematchInvoice,
} from '../services/api';
import { toast } from 'react-toastify';

// ─── Status config ────────────────────────────────────────────────────────────
const STATUS = {
  processing: { label: 'Processing',      color: 'var(--accent-secondary)', bg: 'var(--brand-12)'  },
  draft:      { label: 'Ready to Review', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  failed:     { label: 'Failed',          color: '#ef4444', bg: 'rgba(239,68,68,0.12)'   },
  synced:     { label: 'Synced',          color: '#10b981', bg: 'rgba(16,185,129,0.12)' },
  processed:  { label: 'Processed',       color: '#10b981', bg: 'rgba(16,185,129,0.12)' },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 60000)     return 'just now';
  if (diff < 3600000)   return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000)  return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 172800000) return 'Yesterday';
  return new Date(dateStr).toLocaleDateString();
}

function fmt(n) {
  return n != null ? `$${Number(n).toFixed(2)}` : '—';
}

function toDateInput(val) {
  if (!val) return '';
  const s = String(val);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toISOString().slice(0, 10);
}

function posId(obj)   { return obj?.id   ?? obj?.posId ?? obj?._id  ?? ''; }
function posName(obj) { return obj?.name ?? obj?.description        ?? ''; }

/** Strip spaces, pad with leading zeros to 14 digits. */
function normalizeUPC(raw) {
  if (!raw) return '';
  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return String(raw).trim();
  if (digits.length > 14) return digits.slice(-14);
  return digits.padStart(14, '0');
}

const MAPPING_BADGE = {
  matched:   { color: '#10b981', label: 'Matched'   },
  unmatched: { color: '#ef4444', label: 'Unmatched' },
  manual:    { color: '#f59e0b', label: 'Manual'    },
  new:       { color: '#a78bfa', label: 'New'       },
};
const MAPPING_CONF = {
  high:   { bg: '#10b981', color: '#fff' },
  medium: { bg: '#f59e0b', color: '#fff' },
  low:    { bg: '#ef4444', color: '#fff' },
};
const TIER_LABEL = { upc: 'UPC', vendorMap: 'MAP', sku: 'SKU', fuzzy: 'FUZZY', ai: 'AI', manual: 'MANUAL', costProx: 'COST', global: 'GLOBAL' };

// ─── Match reason tooltips ──────────────────────────────────────────────────
const TIER_TOOLTIP = {
  upc:       'Matched by UPC',
  vendorMap: (item) => `Learned match (confirmed ${item.confirmCount ?? '?'} times)`,
  fuzzy:     (item) => `Fuzzy match (${item.similarityPct ?? item.matchScore ?? '??'}% similarity)`,
  ai:        'AI match',
  costProx:  'Cost proximity match',
  global:    'Cross-store match',
  sku:       'Matched by SKU',
  manual:    'Manual match',
};

// ─── Confidence-based row background colors ─────────────────────────────────
const CONFIDENCE_BG = {
  high:   'rgba(16,185,129,0.05)',
  medium: 'rgba(245,158,11,0.05)',
  low:    'rgba(239,68,68,0.05)',
  null:   'rgba(239,68,68,0.08)',
};

// ─────────────────────────────────────────────────────────────────────────────
// PriceInput — cash-register style: digits shift right, last 2 are always cents
//   Typing "5"    → 0.05
//   Typing "1599" → 15.99
//   Backspace removes the last digit
// ─────────────────────────────────────────────────────────────────────────────
function PriceInput({ value, onChange, readOnly, style, placeholder }) {
  const digitsRef = useRef('');
  const [display, setDisplay] = useState(() => {
    const n = parseFloat(value);
    if (isNaN(n) || n === 0) { digitsRef.current = ''; return ''; }
    const c = Math.round(n * 100);
    digitsRef.current = String(c);
    return (c / 100).toFixed(2);
  });

  // Sync when value changes externally (e.g. auto-calculated unitCost from parent)
  useEffect(() => {
    const n = parseFloat(value);
    const incomingCents = (isNaN(n) || n === 0) ? 0 : Math.round(n * 100);
    const currentCents  = digitsRef.current === '' ? 0 : parseInt(digitsRef.current, 10);
    if (incomingCents !== currentCents) {
      const nd = incomingCents === 0 ? '' : String(incomingCents);
      digitsRef.current = nd;
      setDisplay(incomingCents === 0 ? '' : (incomingCents / 100).toFixed(2));
    }
  }, [value]);

  const commit = (nd) => {
    digitsRef.current = nd;
    if (nd === '') { setDisplay(''); onChange(''); return; }
    const cents = parseInt(nd, 10);
    const formatted = (cents / 100).toFixed(2);
    setDisplay(formatted);
    onChange(formatted);
  };

  const handleKeyDown = (e) => {
    if (readOnly) return;
    if (e.key >= '0' && e.key <= '9') {
      e.preventDefault();
      const raw     = digitsRef.current + e.key;
      const cleaned = raw.replace(/^0+/, '') || '0';
      if (cleaned.length > 8) return; // max $999,999.99
      commit(cleaned);
    } else if (e.key === 'Backspace') {
      e.preventDefault();
      commit(digitsRef.current.slice(0, -1));
    }
    // Tab, Enter, arrow keys pass through naturally
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      value={display}
      readOnly={readOnly}
      onChange={() => {}}        // controlled via onKeyDown; empty handler suppresses React warning
      onKeyDown={handleKeyDown}
      onWheel={e => e.target.blur()}
      onFocus={e => e.target.select()}
      style={style}
      placeholder={placeholder || '0.00'}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// InvoiceCard
// ─────────────────────────────────────────────────────────────────────────────
function InvoiceCard({ inv, selected, onOpen, onDelete }) {
  const s = STATUS[inv.status] || STATUS.draft;
  const isCredit = inv.invoiceType === 'credit_memo';
  return (
    <div
      onClick={() => onOpen(inv)}
      className={`ii-card ${selected ? 'ii-card--selected' : ''} ${inv.status === 'processing' ? 'ii-card--processing' : ''} ${isCredit ? 'ii-card--credit' : ''}`}
    >
      <div className="ii-card-icon" style={{ background: isCredit ? 'rgba(239, 68, 68, 0.14)' : s.bg }}>
        {inv.status === 'processing' && <Loader size={18} color={s.color} className="ii-spin" />}
        {inv.status === 'draft'      && <FileText size={18} color={isCredit ? '#dc2626' : s.color} />}
        {inv.status === 'failed'     && <AlertCircle size={18} color={s.color} />}
        {(inv.status === 'synced' || inv.status === 'processed') && <CheckCircle size={18} color={isCredit ? '#dc2626' : s.color} />}
      </div>
      <div className="ii-card-body">
        <div className="ii-card-title-row">
          <span className="ii-card-name">{inv.vendorName || inv.fileName}</span>
          {isCredit && (
            <span className="ii-card-badge" style={{ background: 'rgba(239, 68, 68, 0.14)', color: '#dc2626', fontWeight: 700 }}>
              CREDIT
            </span>
          )}
          <span className="ii-card-badge" style={{ background: s.bg, color: s.color }}>{s.label}</span>
        </div>
        <div className="ii-card-meta">
          {inv.vendorName           && <span style={{ color: 'var(--text-secondary)' }}>{inv.fileName}</span>}
          {inv.invoiceNumber        && <span>#{inv.invoiceNumber}</span>}
          {inv.invoiceDate          && <span>{inv.invoiceDate}</span>}
          {inv.totalInvoiceAmount > 0 && (
            <span style={{ color: isCredit ? '#dc2626' : 'var(--text-primary)', fontWeight: 600 }}>
              {isCredit ? `−${fmt(inv.totalInvoiceAmount)}` : fmt(inv.totalInvoiceAmount)}
            </span>
          )}
          {inv.lineItems?.length > 0 && <span>{inv.lineItems.length} items</span>}
          {inv.status === 'processing' && <span style={{ color: 'var(--accent-secondary)' }}>AI is reading your invoice...</span>}
          {inv.status === 'failed'     && <span style={{ color: '#ef4444' }}>{inv.processingError || 'Extraction failed'}</span>}
        </div>
      </div>
      <div className="ii-card-actions">
        <span className="ii-card-time">{timeAgo(inv.uploadedAt || inv.createdAt)}</span>
        {inv.status === 'draft' && (
          <button onClick={e => { e.stopPropagation(); onOpen(inv); }} className="btn btn-primary btn-sm">Review &rarr;</button>
        )}
        {(inv.status === 'synced' || inv.status === 'processed') && (
          <button onClick={e => { e.stopPropagation(); onOpen(inv); }} className="btn btn-secondary btn-sm">View</button>
        )}
        {inv.status !== 'synced' && inv.status !== 'processed' && (
          <button onClick={e => onDelete(inv.id, e)} className="ii-card-delete" title="Delete">
            <Trash2 size={15} />
          </button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// InvoiceImageViewer
// ─────────────────────────────────────────────────────────────────────────────
function InvoiceImageViewer({ pages }) {
  const [pageIdx, setPageIdx] = useState(0);
  const [zoom, setZoom] = useState(1);

  if (!pages || pages.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-tertiary)', color: 'var(--text-muted)', gap: '0.75rem' }}>
        <FileText size={40} style={{ opacity: 0.3 }} />
        <p style={{ fontSize: '0.85rem' }}>No preview available</p>
        <p style={{ fontSize: '0.75rem', maxWidth: '200px', textAlign: 'center' }}>Preview is generated from PDF pages.</p>
      </div>
    );
  }

  const src = pages[pageIdx].startsWith('data:') ? pages[pageIdx] : `data:image/png;base64,${pages[pageIdx]}`;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#1a1a2e', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.6rem 1rem', borderBottom: '1px solid rgba(255,255,255,0.08)', flexShrink: 0, gap: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <button onClick={() => setPageIdx(p => Math.max(0, p - 1))} disabled={pageIdx === 0}
            style={{ background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '4px', color: '#fff', padding: '4px 8px', cursor: pageIdx === 0 ? 'not-allowed' : 'pointer', opacity: pageIdx === 0 ? 0.4 : 1 }}>‹</button>
          <span style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.6)', whiteSpace: 'nowrap' }}>Page {pageIdx + 1} / {pages.length}</span>
          <button onClick={() => setPageIdx(p => Math.min(pages.length - 1, p + 1))} disabled={pageIdx === pages.length - 1}
            style={{ background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '4px', color: '#fff', padding: '4px 8px', cursor: pageIdx === pages.length - 1 ? 'not-allowed' : 'pointer', opacity: pageIdx === pages.length - 1 ? 0.4 : 1 }}>›</button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <button onClick={() => setZoom(z => Math.max(0.4, +(z - 0.2).toFixed(1)))} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '4px', color: '#fff', padding: '4px 10px', cursor: 'pointer', fontSize: '1rem' }}>−</button>
          <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.6)', minWidth: '36px', textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(z => Math.min(3, +(z + 0.2).toFixed(1)))} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '4px', color: '#fff', padding: '4px 10px', cursor: 'pointer', fontSize: '1rem' }}>+</button>
          <button onClick={() => setZoom(1)} style={{ background: 'rgba(255,255,255,0.06)', border: 'none', borderRadius: '4px', color: 'rgba(255,255,255,0.5)', padding: '4px 8px', cursor: 'pointer', fontSize: '0.72rem' }}>Reset</button>
        </div>
      </div>
      <div style={{ flex: 1, overflow: 'auto', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '1rem' }}>
        <img src={src} alt={`Invoice page ${pageIdx + 1}`} style={{ width: `${zoom * 100}%`, maxWidth: `${zoom * 100}%`, borderRadius: '4px', boxShadow: '0 4px 24px rgba(0,0,0,0.5)', display: 'block' }} />
      </div>
      {pages.length > 1 && (
        <div style={{ display: 'flex', gap: '6px', padding: '8px 1rem', borderTop: '1px solid rgba(255,255,255,0.08)', overflowX: 'auto', flexShrink: 0 }}>
          {pages.map((p, i) => {
            const t = p.startsWith('data:') ? p : `data:image/png;base64,${p}`;
            return <img key={i} src={t} alt={`Page ${i + 1}`} onClick={() => setPageIdx(i)} style={{ height: '56px', width: 'auto', borderRadius: '3px', cursor: 'pointer', flexShrink: 0, border: `2px solid ${i === pageIdx ? 'var(--accent-primary)' : 'transparent'}`, opacity: i === pageIdx ? 1 : 0.5, transition: 'all 0.15s' }} />;
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ReviewPanel — full-screen split: left = invoice image, right = form
// ─────────────────────────────────────────────────────────────────────────────
function ReviewPanel({
  invoice, editData,
  isConfirming, isSavingDraft, isRematching,
  onClose, onConfirm, onSaveDraft,
  onHeaderChange, onItemChange, onApplyVendorToAll,
  onInvoiceVendorChange, onRematch,
  onOpenSearch, onUpdatePOS, onCreatePOS,
  onDeleteItem, onAddItem, onAcceptAllHigh,
  readOnly, onConfirmWithPO,
}) {
  const [expanded,    setExpanded]    = useState({});
  const [posLoading,  setPosLoading]  = useState(false);
  const [posUpdating, setPosUpdating] = useState({}); // { [idx]: 'update' | 'create' | null }

  const [departments, setDepartments] = useState([]);
  const [vendors,     setVendors]     = useState([]);
  const [fees,        setFees]        = useState([]);
  const [taxes,       setTaxes]       = useState([]);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    if (!readOnly) {
      setPosLoading(true);
      Promise.allSettled([
        getCatalogDepartments(),
        getCatalogVendors(),
        getCatalogTaxRules(),
        getCatalogDepositRules(),
      ]).then(([dR, vR, trR, drR]) => {
        // Departments
        if (dR.status === 'fulfilled') {
          const d = dR.value;
          setDepartments(Array.isArray(d) ? d : (d?.data || []));
        }
        // Vendors
        if (vR.status === 'fulfilled') {
          const v = vR.value;
          setVendors(Array.isArray(v) ? v.filter(x => !x.deleted) : (v?.data || []));
        }
        // Tax rules
        if (trR.status === 'fulfilled') {
          const tr = trR.value;
          setTaxes(Array.isArray(tr) ? tr : (tr?.data || []));
        }
        // Deposit rules → normalise depositAmount → amount for fee card
        if (drR.status === 'fulfilled') {
          const dr = drR.value;
          const rules = Array.isArray(dr) ? dr : (dr?.data || []);
          setFees(rules.map(r => ({
            ...r,
            amount: r.depositAmount != null ? Number(r.depositAmount) : null,
          })));
        }
      }).catch(console.error).finally(() => setPosLoading(false));
    }
    return () => { document.body.style.overflow = 'auto'; };
  }, [readOnly]);

  if (!invoice) return null;

  const lineItems      = editData?.lineItems || invoice.lineItems || [];
  const unmatchedCount = lineItems.filter(it => it.mappingStatus === 'unmatched').length;
  const hasPages       = invoice.pages && invoice.pages.length > 0;

  const toggle = (i) => setExpanded(p => ({ ...p, [i]: !p[i] }));

  // Toggle a fee/tax ID in a comma-separated string field on an item
  const toggleItemId = (itemIdx, field, id) => {
    const item    = editData.lineItems[itemIdx];
    const current = item[field] ? String(item[field]).split(',').map(s => s.trim()).filter(Boolean) : [];
    const sid     = String(id);
    const next    = current.includes(sid) ? current.filter(x => x !== sid) : [...current, sid];
    onItemChange(itemIdx, field, next.join(','));
  };
  const hasItemId = (item, field, id) =>
    item[field] ? String(item[field]).split(',').map(s => s.trim()).includes(String(id)) : false;

  // Per-item "Update in POS"
  const handleItemUpdatePOS = async (i, item) => {
    setPosUpdating(p => ({ ...p, [i]: 'update' }));
    try {
      await onUpdatePOS(item.linkedProductId || item.posProductId, {
        description: item.description, upc: item.upc,
        pack: item.packUnits, case_cost: item.caseCost, cost: item.unitCost,
        normal_price: item.suggestedRetailPrice,
        departmentId: item.departmentId, vendorId: item.vendorId,
        cert_code: item.cert_code || item.originalItemCode,
        fees: item.feesId || '', taxes: item.taxesId || '',
        size: item.containerSize || item.size || '',
      });
    } finally {
      setPosUpdating(p => ({ ...p, [i]: null }));
    }
  };

  // Per-item "Create in POS"
  const handleItemCreatePOS = async (i, item) => {
    setPosUpdating(p => ({ ...p, [i]: 'create' }));
    try {
      const newId = await onCreatePOS({
        description: item.description, upc: item.upc,
        pack: item.packUnits, case_cost: item.caseCost, cost: item.unitCost,
        normal_price: item.suggestedRetailPrice,
        departmentId: item.departmentId, vendorId: item.vendorId,
        cert_code: item.cert_code || item.originalItemCode,
        fees: item.feesId || '', taxes: item.taxesId || '',
        size: item.containerSize || item.size || '',
      });
      if (newId) onItemChange(i, 'linkedProductId', newId);
      onItemChange(i, 'mappingStatus', 'matched');
    } finally {
      setPosUpdating(p => ({ ...p, [i]: null }));
    }
  };

  const inpStyle = (ro = false) => ({
    width: '100%', background: ro ? 'rgba(255,255,255,0.03)' : 'var(--bg-primary)',
    border: '1px solid var(--border-color)', borderRadius: '5px',
    padding: '5px 8px', fontSize: '0.8rem', color: 'var(--text-primary)',
    outline: 'none', boxSizing: 'border-box', colorScheme: 'dark',
    cursor: ro ? 'not-allowed' : 'text', opacity: ro ? 0.7 : 1,
  });
  const lbl = { fontSize: '0.62rem', color: 'var(--text-muted)', display: 'block', marginBottom: '3px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px' };

  return (
    <div className="ii-review-overlay">

      {/* ── Top bar ── */}
      <div className="ii-review-topbar">
        <div className="ii-review-topbar-left">
          <button onClick={onClose} className="ii-review-close">
            <X size={18} /> Close
          </button>
          <div className="ii-review-divider" />
          <div style={{ minWidth: 0 }}>
            <span style={{ fontWeight: 700, fontSize: '1rem' }}>{invoice.vendorName || invoice.fileName}</span>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginLeft: '0.75rem' }}>
              {invoice.fileName}{invoice.invoiceNumber && ` \u00b7 #${invoice.invoiceNumber}`}{invoice.invoiceDate && ` \u00b7 ${invoice.invoiceDate}`}
            </span>
          </div>
          {posLoading && <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}><Loader size={12} className="ii-spin" /> Loading POS data...</span>}
        </div>
        <div className="ii-review-topbar-right">
          {!readOnly && (
            <>
              <span style={{ fontSize: '0.8rem', color: unmatchedCount > 0 ? '#f59e0b' : '#10b981' }}>
                {unmatchedCount > 0 ? `⚠ ${unmatchedCount} unmatched` : '✓ All matched'}
              </span>
              {/* Units-received chip — shows exactly how much inventory will
                  be added when Confirm is pressed. Respects per-line
                  Cases/Units toggle; only counts matched lines. */}
              {(() => {
                const matched = lineItems.filter(
                  it => (it.mappingStatus === 'matched' || it.mappingStatus === 'manual')
                    && parseFloat(it.quantity) > 0
                );
                if (matched.length === 0) return null;
                const unitsToAdd = matched.reduce((s, it) => {
                  const q    = parseFloat(it.quantity) || 0;
                  const pk   = parseFloat(it.packUnits) || 1;
                  const mode = it.receivedAs === 'units' ? 'units' : 'cases';
                  return s + (mode === 'units' ? q : q * pk);
                }, 0);
                return (
                  <span
                    className="ii-receive-chip"
                    title={`On Confirm: inventory (QOH) will increase by ${unitsToAdd} units across ${matched.length} product${matched.length === 1 ? '' : 's'}`}
                  >
                    <Package size={12} />
                    <strong>+{unitsToAdd}</strong> units · {matched.length} product{matched.length === 1 ? '' : 's'}
                  </span>
                );
              })()}
              {(() => {
                const highCount = lineItems.filter(it => it.confidence === 'high' && it.mappingStatus !== 'matched' && it.mappingStatus !== 'manual').length;
                return highCount > 0 ? (
                  <button onClick={onAcceptAllHigh} className="btn btn-secondary"
                    style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', background: 'rgba(16,185,129,0.12)', borderColor: 'rgba(16,185,129,0.3)', color: '#10b981' }}>
                    <CheckCircle size={14} /> Accept All High ({highCount})
                  </button>
                ) : null;
              })()}
              <button onClick={onSaveDraft} disabled={isSavingDraft} className="btn btn-secondary"
                style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.875rem' }}>
                {isSavingDraft ? <><Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> Saving…</> : <><Save size={14} /> Save Draft</>}
              </button>
              {invoice?.linkedPurchaseOrderId && onConfirmWithPO ? (
                <>
                  <button onClick={onConfirmWithPO} disabled={isConfirming} className="btn btn-primary"
                    style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.875rem', background: '#059669', borderColor: '#059669' }}>
                    {isConfirming
                      ? <><Loader size={15} style={{ animation: 'spin 1s linear infinite' }} /> Receiving…</>
                      : <><CheckCircle size={15} /> Confirm &amp; Receive PO</>}
                  </button>
                  <button onClick={onConfirm} disabled={isConfirming} className="btn btn-ghost"
                    style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer', padding: '0.25rem 0.5rem' }}>
                    Confirm only
                  </button>
                </>
              ) : (
                <button onClick={onConfirm} disabled={isConfirming} className="btn btn-primary"
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.875rem' }}>
                  {isConfirming ? <><Loader size={15} style={{ animation: 'spin 1s linear infinite' }} /> Syncing & updating POS…</> : <><CheckCircle size={15} /> Confirm & Sync to POS</>}
                </button>
              )}
            </>
          )}
          {readOnly && (
            <span className="ii-synced-badge">Synced — read only</span>
          )}
        </div>
      </div>

      {/* ── Vendor + Re-match row ── */}
      {!readOnly && (
        <div className="ii-vendor-row">
          <div className="ii-vendor-row-inner">
            <label className="ii-vendor-label">Invoice Vendor</label>
            <select
              className="ii-vendor-select"
              value={editData?.vendorId ? String(editData.vendorId) : ''}
              onChange={e => onInvoiceVendorChange && onInvoiceVendorChange(e.target.value)}
              disabled={isRematching}
            >
              <option value="">— Auto-detect / unknown —</option>
              {vendors.map(v => (
                <option key={posId(v)} value={String(posId(v))}>{posName(v)}</option>
              ))}
            </select>
            {editData?.vendorName && (
              <span className="ii-vendor-ocr-hint" title="Vendor name read from the invoice by OCR">
                OCR read: <em>{editData.vendorName}</em>
              </span>
            )}
            <button
              type="button"
              onClick={() => onRematch && onRematch({ force: false })}
              disabled={isRematching}
              className="ii-rematch-btn"
              title="Re-run product matching with the selected vendor scope. User-confirmed manual matches are preserved."
            >
              {isRematching
                ? <><Loader size={13} className="ii-spin" /> Re-matching…</>
                : <><RefreshCw size={13} /> Re-run matching</>}
            </button>
            <button
              type="button"
              onClick={() => {
                if (window.confirm('Force re-match ALL items — including manual matches you previously confirmed?')) {
                  onRematch && onRematch({ force: true });
                }
              }}
              disabled={isRematching}
              className="ii-rematch-force-btn"
              title="Force re-match ALL items including manual ones (destructive)"
            >
              Force
            </button>
          </div>
        </div>
      )}

      {/* ── Invoice Type Toggle (Purchase / Credit Memo) ── */}
      {!readOnly && (
        <div className="ii-type-row">
          <div className="ii-type-row-inner">
            <label className="ii-type-label">Type</label>
            <div className="ii-type-segmented" role="radiogroup" aria-label="Invoice type">
              <button
                type="button"
                role="radio"
                aria-checked={(editData?.invoiceType || 'purchase') === 'purchase'}
                onClick={() => onHeaderChange('invoiceType', 'purchase')}
                className={`ii-type-opt ${(editData?.invoiceType || 'purchase') === 'purchase' ? 'ii-type-opt--active' : ''}`}
                title="Standard vendor invoice — adds to inventory + vendor cost in P&L"
              >
                📝 Purchase Invoice
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={editData?.invoiceType === 'credit_memo'}
                onClick={() => onHeaderChange('invoiceType', 'credit_memo')}
                className={`ii-type-opt ${editData?.invoiceType === 'credit_memo' ? 'ii-type-opt--active ii-type-opt--credit' : ''}`}
                title="Credit memo / rebate — subtracts from vendor cost in P&L; does not move inventory"
              >
                💳 Credit / Rebate
              </button>
            </div>
            {editData?.invoiceType === 'credit_memo' && (
              <span className="ii-credit-hint">
                Enter the credit as a <strong>positive</strong> amount — the P&amp;L report will subtract it from the vendor's cost total.
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── Credit Memo — optional link to original invoice ── */}
      {!readOnly && editData?.invoiceType === 'credit_memo' && (
        <div className="ii-type-row ii-type-row--credit">
          <div className="ii-type-row-inner">
            <label className="ii-type-label">Link to Original Invoice <span style={{ color: 'var(--text-muted)', fontWeight: 400, marginLeft: 4 }}>(optional)</span></label>
            <input
              type="text"
              className="ii-linked-input"
              placeholder="Invoice # or ID the credit applies to (leave blank if standalone rebate)"
              value={editData?.linkedInvoiceId || ''}
              onChange={e => onHeaderChange('linkedInvoiceId', e.target.value)}
            />
          </div>
        </div>
      )}

      {/* ── PO Match Banner ── */}
      {invoice?.linkedPurchaseOrderId && invoice?.poMatchResult?.matchedPO && (
        <div style={{
          padding: '0.6rem 1rem', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap',
          background: 'rgba(5, 150, 105, 0.08)', borderBottom: '1px solid rgba(5, 150, 105, 0.2)',
          fontSize: '0.82rem',
        }}>
          <span style={{ fontWeight: 700, color: '#059669', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Package size={15} /> PO Matched
          </span>
          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
            {invoice.poMatchResult.matchedPO.poNumber}
          </span>
          <span style={{ color: 'var(--text-muted)' }}>
            {invoice.poMatchResult.matchedPO.vendorName}
          </span>
          <span style={{ fontSize: '0.72rem', color: '#059669' }}>
            {invoice.poMatchResult.summary?.matched || 0} items matched
          </span>
          {(invoice.poMatchResult.summary?.unmatched || 0) > 0 && (
            <span style={{ fontSize: '0.72rem', color: '#f59e0b' }}>
              {invoice.poMatchResult.summary.unmatched} unmatched
            </span>
          )}
          {(invoice.poMatchResult.summary?.totalVariance || 0) > 0 && (
            <span style={{ fontSize: '0.72rem', color: '#ef4444', fontWeight: 600 }}>
              Cost variance: ${Number(invoice.poMatchResult.summary.totalVariance).toFixed(2)}
            </span>
          )}
          {(invoice.poMatchResult.summary?.majorVariances || 0) > 0 && (
            <span style={{ fontSize: '0.65rem', padding: '1px 6px', borderRadius: 4, background: 'rgba(239,68,68,0.12)', color: '#ef4444', fontWeight: 700 }}>
              {invoice.poMatchResult.summary.majorVariances} MAJOR
            </span>
          )}
        </div>
      )}

      {/* ── Credit/Return Items Banner ── */}
      {(() => {
        const creditItems = (editData?.lineItems || []).filter(li => {
          const qty = Number(li.quantity || li.qty || 0);
          const desc = (li.description || li.originalVendorDescription || '').toLowerCase();
          return qty < 0 || /credit|return|adjustment|cr\s?memo|refund/.test(desc);
        });
        if (creditItems.length === 0) return null;
        return (
          <div style={{
            padding: '0.5rem 1rem', display: 'flex', alignItems: 'center', gap: '0.75rem',
            background: 'rgba(139, 92, 246, 0.08)', borderBottom: '1px solid rgba(139, 92, 246, 0.2)',
            fontSize: '0.78rem', color: '#7c3aed',
          }}>
            <span style={{ fontWeight: 700 }}>↩ {creditItems.length} return/credit item{creditItems.length !== 1 ? 's' : ''} detected</span>
            <span style={{ color: 'var(--text-muted)' }}>Will auto-create vendor return on confirm</span>
          </div>
        );
      })()}

      {/* ── Body ── */}
      <div className="ii-review-body">
        {/* Left: invoice image */}
        {hasPages && (
          <div className="ii-review-image-pane">
            <InvoiceImageViewer pages={invoice.pages} />
          </div>
        )}

        {/* Right: form */}
        <div className="ii-review-form-pane">

          {/* ── Invoice header ── */}
          <section>
            <h3 style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '0.75rem' }}>Invoice Details</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '0.6rem' }}>
              {[
                ['Vendor',       'vendorName',         'text'],
                ['Invoice #',    'invoiceNumber',      'text'],
                ['Invoice Date', 'invoiceDate',        'date'],
                ['Due Date',     'paymentDueDate',     'date'],
                ['Total',        'totalInvoiceAmount', 'number'],
                ['Tax',          'tax',                'number'],
                ['Discount',     'totalDiscount',      'number'],
                ['Deposit',      'totalDeposit',       'number'],
                ['Other Fees',   'otherFees',          'number'],
                ['Payment Type', 'paymentType',        'text'],
                ['Driver',       'driverName',         'text'],
                ['Sales Rep',    'salesRepName',       'text'],
              ].map(([label, field, type]) => {
                const raw = (editData || invoice)[field] ?? '';
                const val = type === 'date' ? toDateInput(raw) : raw;
                return (
                  <div key={field}>
                    <label style={lbl}>{label}</label>
                    {type === 'number' ? (
                      <PriceInput
                        value={val}
                        readOnly={readOnly}
                        onChange={v => !readOnly && onHeaderChange(field, v)}
                        style={{ ...inpStyle(readOnly), background: readOnly ? 'var(--bg-tertiary)' : 'var(--bg-secondary)' }}
                      />
                    ) : (
                      <input type={type} value={val} readOnly={readOnly}
                        onChange={e => !readOnly && onHeaderChange(field, e.target.value)}
                        style={{ ...inpStyle(readOnly), background: readOnly ? 'var(--bg-tertiary)' : 'var(--bg-secondary)' }} />
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* ── Common POS Vendor ── */}
          {!readOnly && vendors.length > 0 && (() => {
            // Compute whether all items already share the same vendorId
            const ids = (editData?.lineItems || []).map(it => it.vendorId || '');
            const allSame = ids.length > 0 && ids.every(v => v === ids[0]);
            const commonVendorId = allSame ? (ids[0] || '') : '';
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', background: 'var(--brand-05)', border: '1px solid var(--brand-20)', borderRadius: '8px', padding: '0.65rem 1rem' }}>
                <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--accent-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap', flexShrink: 0 }}>
                  🏭 POS Vendor
                </span>
                <select
                  style={{ ...inpStyle(false), flex: 1, minWidth: '200px', appearance: 'none' }}
                  value={commonVendorId}
                  onChange={e => onApplyVendorToAll(e.target.value)}
                >
                  <option value="">— Select to apply to all {(editData?.lineItems || []).length} items —</option>
                  {vendors.map(v => <option key={posId(v)} value={posId(v)}>{posName(v)}</option>)}
                </select>
                {commonVendorId && (
                  <span style={{ fontSize: '0.72rem', color: '#10b981', whiteSpace: 'nowrap', flexShrink: 0 }}>
                    ✓ All items set
                  </span>
                )}
                {!commonVendorId && ids.some(v => v) && (
                  <span style={{ fontSize: '0.72rem', color: '#f59e0b', whiteSpace: 'nowrap', flexShrink: 0 }}>
                    ⚠ Mixed — select to override all
                  </span>
                )}
              </div>
            );
          })()}

          {/* ── Summary strip ── */}
          <div className="ii-summary-strip">
            {[
              { label: 'Line Items', value: lineItems.length, icon: <Package size={15} /> },
              { label: 'Unmatched', value: unmatchedCount, icon: <AlertCircle size={15} />, color: unmatchedCount > 0 ? '#ef4444' : '#10b981' },
              { label: 'Total', value: fmt((editData || invoice).totalInvoiceAmount), icon: <DollarSign size={15} /> },
            ].map(c => (
              <div key={c.label} className="ii-summary-card">
                <span style={{ color: c.color || 'var(--text-muted)' }}>{c.icon}</span>
                <div>
                  <div className="ii-summary-card-value" style={{ color: c.color || 'var(--text-primary)' }}>{c.value}</div>
                  <div className="ii-summary-card-label">{c.label}</div>
                </div>
              </div>
            ))}
          </div>

          {/* ── Line items ── */}
          <section>
            <h3 style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '0.75rem' }}>
              Line Items ({lineItems.length})
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {lineItems.map((item, i) => {
                const mb          = MAPPING_BADGE[item.mappingStatus] || MAPPING_BADGE.unmatched;
                const isExp       = !!expanded[i];
                const isMatched   = item.mappingStatus === 'matched' || item.mappingStatus === 'manual';
                const packVal     = parseFloat(item.packUnits || 1) || 1;
                const ccVal       = parseFloat(item.caseCost || 0);
                const unitCostCalc = (ccVal / packVal).toFixed(4);
                const retail      = parseFloat(item.suggestedRetailPrice || 0);
                const unitC       = parseFloat(item.unitCost || unitCostCalc || 0);
                const margin      = retail > 0 && unitC > 0 ? ((retail - unitC) / retail * 100) : null;
                const isPosUpd    = posUpdating[i] === 'update';
                const isPosCreate = posUpdating[i] === 'create';

                const confidenceBg = CONFIDENCE_BG[item.confidence] || CONFIDENCE_BG['null'];

                return (
                  <div key={i} style={{ border: `1px solid ${item.mappingStatus === 'unmatched' ? 'rgba(239,68,68,0.3)' : 'var(--border-color)'}`, borderRadius: '10px', background: confidenceBg, overflow: 'hidden' }}>

                    {/* Summary row — click to expand */}
                    <div onClick={() => toggle(i)} style={{ padding: '0.65rem 1rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.55rem', minWidth: 0 }}>

                      {/* ── Status dot + tier pill ── */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                        {/* Pulsing ring for unmatched */}
                        <div style={{ position: 'relative', width: 10, height: 10, flexShrink: 0 }}>
                          <div style={{
                            width: 10, height: 10, borderRadius: '50%',
                            background: mb.color,
                            boxShadow: item.mappingStatus === 'unmatched' ? `0 0 0 2px ${mb.color}44` : 'none',
                          }} title={mb.label} />
                        </div>
                        {item.matchTier && (
                          <span style={{
                            fontSize: '0.52rem', fontWeight: 800, letterSpacing: '0.4px',
                            color: 'var(--text-muted)', textTransform: 'uppercase', lineHeight: 1,
                          }}>
                            {TIER_LABEL[item.matchTier] || item.matchTier}
                          </span>
                        )}
                        {/* Match reason tooltip */}
                        {item.matchTier && TIER_TOOLTIP[item.matchTier] && (
                          <span
                            title={typeof TIER_TOOLTIP[item.matchTier] === 'function' ? TIER_TOOLTIP[item.matchTier](item) : TIER_TOOLTIP[item.matchTier]}
                            style={{ display: 'flex', alignItems: 'center', cursor: 'help', opacity: 0.45 }}
                          >
                            <Info size={10} />
                          </span>
                        )}
                      </div>

                      {/* ── Description ── */}
                      <span style={{ flex: 1, fontSize: '0.875rem', fontWeight: isMatched ? 500 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: isMatched ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                        {item.description || '—'}
                      </span>

                      {/* ── Right cluster ── */}
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexShrink: 0 }}>

                        {/* ×qty */}
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 500, minWidth: 20, textAlign: 'right' }}>
                          ×{item.quantity ?? 1}
                        </span>

                        {/* Separator */}
                        <span style={{ color: 'var(--border-color)', fontSize: '0.7rem' }}>·</span>

                        {/* Case total */}
                        <span style={{ fontSize: '0.85rem', fontWeight: 700, minWidth: 52, textAlign: 'right' }}>
                          {fmt(item.totalAmount)}
                        </span>

                        {/* Retail price */}
                        {retail > 0 && (
                          <>
                            <span style={{ color: 'var(--border-color)', fontSize: '0.7rem' }}>·</span>
                            <span style={{ fontSize: '0.72rem', color: '#10b981', fontWeight: 600, minWidth: 40, textAlign: 'right' }} title="Retail price">
                              ${retail.toFixed(2)}↑
                            </span>
                          </>
                        )}

                        {/* ── Margin number ── */}
                        {margin !== null ? (
                          <span style={{
                            fontSize: '0.72rem', fontWeight: 700, minWidth: 34, textAlign: 'right',
                            color: margin >= 30 ? '#10b981' : margin >= 15 ? '#f59e0b' : '#ef4444',
                          }} title="Gross margin">
                            {margin.toFixed(0)}%
                          </span>
                        ) : (
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', minWidth: 34, textAlign: 'right', opacity: 0.4 }}>—%</span>
                        )}

                        {/* ── Match accuracy bar (5 segments) ── */}
                        {(() => {
                          // Map tier → filled bars out of 5
                          const TIER_BARS = { upc: 5, vendorMap: 4, sku: 4, fuzzy: 3, ai: 2, manual: 5 };
                          const filled = item.mappingStatus === 'unmatched'
                            ? 0
                            : (TIER_BARS[item.matchTier] ?? (item.confidence === 'high' ? 4 : item.confidence === 'medium' ? 3 : 2));
                          const barColor = filled >= 4 ? '#10b981' : filled >= 3 ? 'var(--accent-secondary)' : filled >= 2 ? '#f59e0b' : '#ef4444';
                          // Bar heights grow from left → right for filled, flat for empty
                          const heights = [5, 7, 9, 11, 13];
                          return (
                            <div
                              title={item.mappingStatus === 'unmatched' ? 'Not matched' : `Match accuracy: ${filled}/5 (${item.matchTier || item.confidence || ''})`}
                              style={{ display: 'flex', gap: '2px', alignItems: 'flex-end', padding: '0 1px' }}
                            >
                              {heights.map((h, si) => (
                                <div
                                  key={si}
                                  style={{
                                    width: 4,
                                    height: si < filled ? h : 5,
                                    borderRadius: 2,
                                    background: si < filled ? barColor : 'var(--bg-tertiary)',
                                    opacity: si < filled ? 0.55 + (si / 5) * 0.45 : 0.35,
                                    transition: 'height 0.2s, background 0.2s',
                                  }}
                                />
                              ))}
                            </div>
                          );
                        })()}

                        {/* Link / New buttons (unmatched) or re-link icon (matched) */}
                        {!readOnly && item.mappingStatus === 'unmatched' ? (
                          <div style={{ display: 'flex', gap: '3px' }} onClick={e => e.stopPropagation()}>
                            <button onClick={() => onOpenSearch(i, 'search')}
                              style={{ background: 'var(--brand-12)', border: '1px solid var(--brand-30)', borderRadius: '5px', padding: '3px 7px', cursor: 'pointer', fontSize: '0.67rem', color: 'var(--accent-secondary)', display: 'flex', alignItems: 'center', gap: '2px', whiteSpace: 'nowrap', fontWeight: 700 }}>
                              <Search size={10} /> Link
                            </button>
                            <button onClick={() => onOpenSearch(i, 'create')}
                              style={{ background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.3)', borderRadius: '5px', padding: '3px 7px', cursor: 'pointer', fontSize: '0.67rem', color: '#a78bfa', display: 'flex', alignItems: 'center', gap: '2px', whiteSpace: 'nowrap', fontWeight: 700 }}>
                              <PlusCircle size={10} /> New
                            </button>
                          </div>
                        ) : (
                          !readOnly && (
                            <button onClick={e => { e.stopPropagation(); onOpenSearch(i, 'search'); }} title="Re-link to a different product"
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '2px', display: 'flex', opacity: 0.5 }}>
                              <Search size={12} />
                            </button>
                          )
                        )}

                        {/* Delete line item */}
                        {!readOnly && (
                          <button
                            onClick={e => { e.stopPropagation(); onDeleteItem(i, item); }}
                            title="Delete line item"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '2px', display: 'flex', opacity: 0.4, transition: 'opacity 0.15s' }}
                            onMouseEnter={e => e.currentTarget.style.opacity = '1'}
                            onMouseLeave={e => e.currentTarget.style.opacity = '0.4'}
                          >
                            <Trash2 size={12} color="#ef4444" />
                          </button>
                        )}

                        {isExp ? <ChevronUp size={13} color="var(--text-muted)" /> : <ChevronDown size={13} color="var(--text-muted)" />}
                      </div>
                    </div>

                    {/* Vendor vs POS description */}
                    {item.originalVendorDescription && item.originalVendorDescription !== item.description && (
                      <div style={{ padding: '0 1rem 0.5rem', fontSize: '0.72rem', color: 'var(--text-muted)', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                        <span>📄 Invoice: <em>{item.originalVendorDescription}</em></span>
                        {item.originalItemCode && <span>Code: {item.originalItemCode}</span>}
                        <span style={{ color: 'var(--accent-secondary)' }}>→ POS: {item.description}</span>
                      </div>
                    )}

                    {/* ── Inline expanded edit ── */}
                    {isExp && (
                      <div style={{ borderTop: '1px solid var(--border-color)', background: 'var(--bg-tertiary)' }}>
                        <div className="review-item-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: '1px solid var(--border-color)' }}>

                          {/* Left: invoice reference */}
                          <div style={{ padding: '0.9rem 1rem', borderRight: '1px solid var(--border-color)' }}>
                            <p style={{ fontSize: '0.62rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '0.65rem' }}>📄 From Invoice</p>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                              {[
                                ['Description',  item.originalVendorDescription || item.description || '—'],
                                ['Item Code',    item.originalItemCode || item.itemCode || '—'],
                                ['UPC',          item.upc || '—'],
                                ['Quantity',     item.quantity ?? '—'],
                                ['Case Cost',    item.caseCost   != null ? fmt(item.caseCost)  : '—'],
                                ['Net Cost',     item.netCost    != null ? fmt(item.netCost)   : '—'],
                                ['Unit Cost',    item.unitCost   != null ? `$${Number(item.unitCost).toFixed(4)}` : '—'],
                                ['Pack',         item.packUnits  ?? '—'],
                                ['Retail (orig)',item.suggestedRetailPrice != null ? fmt(item.suggestedRetailPrice) : '—'],
                                ['Total',        item.totalAmount != null ? fmt(item.totalAmount) : '—'],
                                ['Category',     item.category   || '—'],
                                ['Deposit',      item.depositAmount != null ? fmt(item.depositAmount) : '—'],
                              ].map(([l, v]) => (
                                <div key={l} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
                                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', flexShrink: 0 }}>{l}</span>
                                  <span style={{ fontSize: '0.78rem', fontWeight: 500, textAlign: 'right', color: 'var(--text-primary)' }}>{String(v)}</span>
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* Right: POS editable fields */}
                          <div style={{ padding: '0.9rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
                            {/* Unmatched warning banner */}
                            {!readOnly && item.mappingStatus === 'unmatched' && (
                              <div style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.22)', borderRadius: '8px', padding: '0.65rem 0.875rem', marginBottom: '0.1rem' }}>
                                <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#ef4444', marginBottom: '4px' }}>⚠ Not linked to a POS product</div>
                                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.6rem' }}>This item won&apos;t be synced until linked to a product.</div>
                                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                  <button onClick={() => onOpenSearch(i, 'search')}
                                    style={{ background: 'var(--brand-12)', border: '1px solid var(--brand-30)', borderRadius: '6px', padding: '5px 12px', cursor: 'pointer', fontSize: '0.78rem', color: 'var(--accent-secondary)', display: 'flex', alignItems: 'center', gap: '5px', fontWeight: 600 }}>
                                    <Search size={13} /> Search Existing Product
                                  </button>
                                  <button onClick={() => onOpenSearch(i, 'create')}
                                    style={{ background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.3)', borderRadius: '6px', padding: '5px 12px', cursor: 'pointer', fontSize: '0.78rem', color: '#a78bfa', display: 'flex', alignItems: 'center', gap: '5px', fontWeight: 600 }}>
                                    <PlusCircle size={13} /> Create New Product
                                  </button>
                                </div>
                              </div>
                            )}
                            <p style={{ fontSize: '0.62rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '0.15rem' }}>
                              🏪 POS Fields
                              {!readOnly && <span style={{ color: 'var(--accent-secondary)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}> — edits tracked in draft</span>}
                            </p>

                            {/* Description + UPC */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.45rem' }}>
                              <div><label style={lbl}>Description</label>
                                <input style={inpStyle(readOnly)} value={item.description || ''} readOnly={readOnly} onChange={e => onItemChange(i, 'description', e.target.value)} /></div>
                              <div><label style={lbl}>UPC / Barcode</label>
                                <input style={inpStyle(readOnly)} value={item.upc || ''} readOnly={readOnly} onChange={e => onItemChange(i, 'upc', e.target.value)} /></div>
                            </div>

                            {/* Pack + Qty + Cases/Units Toggle + Vendor Item Code */}
                            <div className="ii-qty-row">
                              <div><label style={lbl}>Pack (Units / Case)</label>
                                <input style={inpStyle(readOnly)} type="number" min="1" step="1" value={item.packUnits || ''} readOnly={readOnly}
                                  onChange={e => onItemChange(i, 'packUnits', e.target.value)}
                                  onWheel={e => e.target.blur()} /></div>
                              <div>
                                <label style={lbl}>
                                  Qty ({(item.receivedAs || 'cases') === 'units' ? 'Units' : 'Cases'}) <span style={{ color: '#f59e0b' }}>✎</span>
                                </label>
                                <input style={inpStyle(readOnly)} type="number" min="0" step="1"
                                  value={item.quantity ?? ''}
                                  readOnly={readOnly}
                                  onChange={e => onItemChange(i, 'quantity', e.target.value)}
                                  onWheel={e => e.target.blur()} />
                              </div>
                              {/* Cases ↔ Units toggle */}
                              <div>
                                <label style={lbl}>Received as</label>
                                <div
                                  className={`ii-received-toggle${readOnly ? ' ii-received-toggle--disabled' : ''}`}
                                  role="radiogroup"
                                  aria-label="Received as"
                                >
                                  <button
                                    type="button"
                                    className={`ii-received-opt${(item.receivedAs || 'cases') === 'cases' ? ' ii-received-opt--active' : ''}`}
                                    disabled={readOnly}
                                    onClick={() => onItemChange(i, 'receivedAs', 'cases')}
                                    title="Quantity is in CASES — inventory will be increased by qty × pack"
                                  >
                                    Cases
                                  </button>
                                  <button
                                    type="button"
                                    className={`ii-received-opt${item.receivedAs === 'units' ? ' ii-received-opt--active' : ''}`}
                                    disabled={readOnly}
                                    onClick={() => onItemChange(i, 'receivedAs', 'units')}
                                    title="Quantity is in SINGLE UNITS — inventory will be increased by qty (pack ignored)"
                                  >
                                    Units
                                  </button>
                                </div>
                              </div>
                              <div><label style={lbl}>Vendor Item Code</label>
                                <input style={inpStyle(readOnly)} value={item.cert_code || item.originalItemCode || ''} readOnly={readOnly} onChange={e => onItemChange(i, 'cert_code', e.target.value)} placeholder="Distributor item #" /></div>
                            </div>

                            {/* Received-into-inventory preview */}
                            {(() => {
                              const q   = parseFloat(item.quantity) || 0;
                              const pk  = parseFloat(item.packUnits) || 1;
                              const recAs = item.receivedAs === 'units' ? 'units' : 'cases';
                              const unitsToAdd = recAs === 'units' ? q : q * pk;
                              if (unitsToAdd <= 0) return null;
                              return (
                                <div className="ii-receive-preview">
                                  <span className="ii-receive-preview-label">On confirm, inventory will increase by</span>
                                  <strong className="ii-receive-preview-qty">+{unitsToAdd} unit{unitsToAdd === 1 ? '' : 's'}</strong>
                                  <span className="ii-receive-preview-meta">
                                    ({recAs === 'cases' ? `${q} case${q === 1 ? '' : 's'} × ${pk}/case` : `${q} unit${q === 1 ? '' : 's'} directly`})
                                  </span>
                                </div>
                              );
                            })()}

                            {/* Case Cost + Unit Cost (auto) + Retail */}
                            <div className="review-price-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.45rem' }}>
                              <div><label style={lbl}>Case Cost ($)</label>
                                <PriceInput
                                  style={inpStyle(readOnly)}
                                  value={item.caseCost ?? ''}
                                  readOnly={readOnly}
                                  onChange={v => onItemChange(i, 'caseCost', v)}
                                /></div>
                              <div><label style={lbl}>Unit Cost (auto)</label>
                                <input style={inpStyle(true)} value={unitCostCalc} readOnly title="Case Cost ÷ Pack" /></div>
                              <div><label style={lbl}>Retail Price ($)</label>
                                <PriceInput
                                  style={inpStyle(readOnly)}
                                  value={item.suggestedRetailPrice ?? ''}
                                  readOnly={readOnly}
                                  onChange={v => onItemChange(i, 'suggestedRetailPrice', v)}
                                /></div>
                            </div>

                            {/* Case Deposit */}
                            {(() => {
                              const caseDepVal  = item.caseDeposit ?? item.depositAmount ?? '';
                              const packN       = parseFloat(item.packUnits) || 1;
                              const caseDepN    = parseFloat(caseDepVal);
                              const unitDep     = !isNaN(caseDepN) && caseDepN > 0 ? (caseDepN / packN).toFixed(4) : null;
                              return (
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.45rem' }}>
                                  <div>
                                    <label style={lbl}>
                                      Case Deposit ($)
                                      {item.depositAmount > 0 && !item.caseDeposit && (
                                        <span style={{ color: '#06b6d4', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}> — from invoice</span>
                                      )}
                                    </label>
                                    <PriceInput
                                      style={inpStyle(readOnly)}
                                      value={caseDepVal}
                                      readOnly={readOnly}
                                      onChange={v => onItemChange(i, 'caseDeposit', v)}
                                    />
                                  </div>
                                  <div>
                                    <label style={lbl}>Unit Deposit (auto)</label>
                                    <input
                                      style={{ ...inpStyle(true), color: unitDep ? '#06b6d4' : 'var(--text-muted)' }}
                                      value={unitDep ? `$${unitDep}` : '÷ pack'}
                                      readOnly
                                      title="Case Deposit ÷ Pack"
                                    />
                                  </div>
                                </div>
                              );
                            })()}

                            {/* Department */}
                            <div>
                              <label style={lbl}>
                                Department
                                {departments.length === 0 && !posLoading && <span style={{ color: '#ef4444', textTransform: 'none', fontWeight: 400 }}> (failed to load)</span>}
                              </label>
                              <select style={{ ...inpStyle(readOnly), appearance: 'none' }} value={item.departmentId != null ? String(item.departmentId) : ''} disabled={readOnly} onChange={e => onItemChange(i, 'departmentId', e.target.value)}>
                                <option value="">— Select Department —</option>
                                {departments.map(d => <option key={posId(d)} value={String(posId(d))}>{posName(d)}</option>)}
                              </select>
                            </div>

                            {/* Deposit Rule (catalog) */}
                            {fees.length > 0 && (
                              <div>
                                <label style={lbl}>Deposit Rule</label>
                                <select style={{ ...inpStyle(readOnly), appearance: 'none' }}
                                  value={item.feesId || ''}
                                  disabled={readOnly}
                                  onChange={e => onItemChange(i, 'feesId', e.target.value)}>
                                  <option value="">— No deposit rule —</option>
                                  {fees.map(f => {
                                    const id  = String(posId(f));
                                    const amt = f.amount != null ? ` · $${Number(f.amount).toFixed(2)}/unit` : '';
                                    return (
                                      <option key={id} value={id}>{posName(f)}{amt}</option>
                                    );
                                  })}
                                </select>
                              </div>
                            )}

                            {/* Tax Rule */}
                            <div>
                              <label style={lbl}>Tax Rule</label>
                              <select style={{ ...inpStyle(readOnly), appearance: 'none' }}
                                value={item.taxesId || ''}
                                disabled={readOnly}
                                onChange={e => onItemChange(i, 'taxesId', e.target.value)}>
                                <option value="">— No tax —</option>
                                {taxes.map(t => (
                                  <option key={String(posId(t))} value={String(posId(t))}>
                                    {posName(t)}{t.rate != null ? ` (${t.rate}%)` : ''}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                        </div>

                        {/* Per-item create action (only for unmatched) */}
                        {!readOnly && !isMatched && (
                          <div style={{ padding: '0.5rem 1rem', display: 'flex', justifyContent: 'flex-end', background: 'var(--bg-secondary)' }}>
                            <button onClick={() => handleItemCreatePOS(i, item)} disabled={isPosCreate} className="btn btn-primary btn-sm"
                              style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.78rem', background: '#7c3aed', borderColor: '#7c3aed' }}>
                              {isPosCreate ? <><Loader size={12} style={{ animation: 'spin 1s linear infinite' }} /> Creating…</> : <><PlusCircle size={12} /> Create in Catalog</>}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* ── Add Line Item button ── */}
              {!readOnly && (
                <button
                  onClick={onAddItem}
                  style={{
                    width: '100%', padding: '0.6rem', marginTop: '0.25rem',
                    background: 'var(--brand-05)', border: '1px dashed var(--brand-30)',
                    borderRadius: '10px', cursor: 'pointer', display: 'flex',
                    alignItems: 'center', justifyContent: 'center', gap: '6px',
                    fontSize: '0.82rem', fontWeight: 600, color: 'var(--accent-secondary)',
                    transition: 'background 0.15s, border-color 0.15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--brand-12)'; e.currentTarget.style.borderColor = 'var(--brand-40)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'var(--brand-05)'; e.currentTarget.style.borderColor = 'var(--brand-30)'; }}
                >
                  <Plus size={15} /> Add Line Item
                </button>
              )}
            </div>

            {/* ── Line Items Total ── */}
            {(() => {
              const lineTotal    = lineItems.reduce((s, it) => s + (parseFloat(it.totalAmount || (parseFloat(it.caseCost||0) * parseFloat(it.quantity||0))) || 0), 0);
              const invoiceTotal = parseFloat((editData || invoice).totalInvoiceAmount) || 0;
              const diff         = lineTotal - invoiceTotal;
              const matched      = lineItems.filter(it => it.mappingStatus === 'matched' || it.mappingStatus === 'manual').length;
              return (
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', paddingTop: '0.5rem', borderTop: '1px solid var(--border-color)', marginTop: '0.25rem' }}>
                  <div style={{ flex: 1, display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Line Items Total:</span>
                      <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>${lineTotal.toFixed(2)}</span>
                    </div>
                    {invoiceTotal > 0 && (
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Invoice Total:</span>
                        <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>${invoiceTotal.toFixed(2)}</span>
                      </div>
                    )}
                    {invoiceTotal > 0 && Math.abs(diff) > 0.01 && (
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Difference:</span>
                        <span style={{ fontWeight: 700, fontSize: '0.9rem', color: Math.abs(diff) > 1 ? '#ef4444' : '#f59e0b' }}>
                          {diff > 0 ? '+' : ''}{diff.toFixed(2)}
                        </span>
                      </div>
                    )}
                    {invoiceTotal > 0 && Math.abs(diff) <= 0.01 && (
                      <span style={{ fontSize: '0.72rem', color: '#10b981', fontWeight: 600 }}>✓ Totals match</span>
                    )}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    {matched}/{lineItems.length} matched
                  </div>
                </div>
              );
            })()}
          </section>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MultiPageModal — Ask user whether multiple dropped files are the same invoice
// ─────────────────────────────────────────────────────────────────────────────
function MultiPageModal({ files, onConfirm, onClose }) {
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 400 }} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
        background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '16px',
        zIndex: 401, width: 'min(480px, 92vw)', padding: '2rem',
        boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
      }}>
        {/* Icon + title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--brand-12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <FileText size={22} color="var(--accent-primary)" />
          </div>
          <div>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0 }}>Multiple Files Detected</h3>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '2px 0 0' }}>
              {files.length} files selected
            </p>
          </div>
        </div>

        {/* File list */}
        <div style={{
          background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 10,
          padding: '0.75rem 1rem', marginBottom: '1.25rem',
          display: 'flex', flexDirection: 'column', gap: '0.4rem', maxHeight: 140, overflowY: 'auto',
        }}>
          {files.map((f, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem' }}>
              <FileText size={13} color="var(--text-muted)" />
              <span style={{ color: 'var(--text-primary)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {f.name}
              </span>
            </div>
          ))}
        </div>

        {/* Question */}
        <p style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.4rem' }}>
          Are these pages of the <span style={{ color: 'var(--accent-primary)' }}>same invoice</span>?
        </p>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '1.5rem', lineHeight: 1.6 }}>
          Choose <strong>Yes</strong> to scan all {files.length} pages together as one invoice — great for multi-page delivery receipts.<br />
          Choose <strong>No</strong> to process each file as its own separate invoice.
        </p>

        {/* Action buttons */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <button
            onClick={() => onConfirm(false)}
            className="btn btn-secondary"
            style={{ padding: '0.875rem', borderRadius: 10, fontWeight: 600, fontSize: '0.875rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}
          >
            <span>No — Separate</span>
            <span style={{ fontSize: '0.68rem', fontWeight: 400, opacity: 0.7 }}>{files.length} invoices</span>
          </button>
          <button
            onClick={() => onConfirm(true)}
            className="btn btn-primary"
            style={{ padding: '0.875rem', borderRadius: 10, fontWeight: 700, fontSize: '0.875rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}
          >
            <span>✓ Yes — Same Invoice</span>
            <span style={{ fontSize: '0.68rem', fontWeight: 400, opacity: 0.85 }}>{files.length} pages → 1 invoice</span>
          </button>
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SearchModal — Search existing POS products OR create a new one
// ─────────────────────────────────────────────────────────────────────────────
function SearchModal({ modal, onClose, onSearch, onSelect, onCreateNew, itemData }) {
  const [tab, setTab]           = useState(modal.tab || 'search');
  const [isCreating, setIsCreating] = useState(false);
  const [createForm, setCreateForm] = useState({
    description:  itemData?.description || '',
    upc:          itemData?.upc         || '',
    pack:         String(itemData?.packUnits || 1),
    case_cost:    String(itemData?.caseCost  || ''),
    normal_price: String(itemData?.suggestedRetailPrice || ''),
    cert_code:    itemData?.cert_code || itemData?.originalItemCode || '',
  });

  // Auto-search when modal opens with a pre-filled description
  useEffect(() => {
    if (tab === 'search' && modal.query && modal.results.length === 0 && !modal.isLoading) {
      onSearch(modal.query);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreate = async () => {
    if (!createForm.description.trim()) { toast.error('Description is required'); return; }
    setIsCreating(true);
    try { await onCreateNew(createForm); }
    finally { setIsCreating(false); }
  };

  const inpS = {
    width: '100%', padding: '8px 12px', background: 'var(--bg-secondary)',
    border: '1px solid var(--border-color)', borderRadius: '8px',
    fontSize: '0.875rem', color: 'var(--text-primary)', outline: 'none',
    colorScheme: 'dark', boxSizing: 'border-box',
  };
  const lbl = {
    fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 600,
    display: 'block', marginBottom: '4px',
    textTransform: 'uppercase', letterSpacing: '0.4px',
  };

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 300 }} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
        background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '14px',
        zIndex: 301, width: 'min(560px, 94vw)', maxHeight: '82vh',
        display: 'flex', flexDirection: 'column', boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
        overflow: 'hidden',
      }}>

        {/* ── Header ── */}
        <div style={{ padding: '1.25rem 1.5rem 0', flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.875rem' }}>
            <div>
              <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '2px' }}>Link to POS Product</h3>
              {itemData?.description && (
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  Invoice: <strong style={{ color: 'var(--text-secondary)' }}>{itemData.description}</strong>
                  {itemData?.upc ? ` · UPC: ${itemData.upc}` : ''}
                </p>
              )}
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '4px', flexShrink: 0 }}>
              <X size={18} />
            </button>
          </div>

          {/* ── Tab bar ── */}
          <div style={{ display: 'flex', gap: '4px', background: 'var(--bg-tertiary)', borderRadius: '9px', padding: '3px', marginBottom: '1rem' }}>
            {[['search', '🔍 Search Existing'], ['create', '➕ Create New in POS']].map(([key, label]) => (
              <button key={key} onClick={() => setTab(key)} style={{
                flex: 1, padding: '7px 10px', borderRadius: '6px', border: 'none', cursor: 'pointer',
                fontSize: '0.8rem', fontWeight: tab === key ? 700 : 400,
                background: tab === key ? 'var(--bg-primary)' : 'transparent',
                color: tab === key ? 'var(--text-primary)' : 'var(--text-muted)',
                boxShadow: tab === key ? '0 1px 4px rgba(0,0,0,0.18)' : 'none',
                transition: 'all 0.15s',
              }}>{label}</button>
            ))}
          </div>
        </div>

        {/* ── Body ── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 1.5rem 1.5rem' }}>

          {/* ─ Search tab ─ */}
          {tab === 'search' && (
            <>
              <div style={{ position: 'relative', marginBottom: '1rem' }}>
                <Search size={15} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
                <input
                  autoFocus
                  type="text"
                  value={modal.query}
                  onChange={e => onSearch(e.target.value)}
                  placeholder="Product name, UPC, PLU, or SKU…"
                  style={{ ...inpS, paddingLeft: '34px' }}
                />
              </div>
              {modal.isLoading && (
                <div style={{ textAlign: 'center', padding: '2.5rem' }}>
                  <Loader size={22} style={{ animation: 'spin 1s linear infinite', color: 'var(--text-muted)' }} />
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.75rem' }}>Searching POS…</p>
                </div>
              )}
              {!modal.isLoading && modal.results.map((p, i) => (
                <div key={i} onClick={() => onSelect(p)}
                  style={{ padding: '0.75rem 1rem', borderRadius: '8px', cursor: 'pointer', marginBottom: '0.4rem', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', transition: 'border-color 0.15s' }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent-primary)'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border-color)'}
                >
                  <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '4px' }}>{p.name || p.description}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                    {p.upc && <span>UPC: {p.upc}</span>}
                    {(p.defaultRetailPrice ?? p.retailPrice) != null && <span>Retail: ${Number(p.defaultRetailPrice ?? p.retailPrice).toFixed(2)}</span>}
                    {(p.defaultCostPrice   ?? p.costPrice)   != null && <span>Cost: ${Number(p.defaultCostPrice   ?? p.costPrice).toFixed(2)}</span>}
                    {(p.casePacks || p.unitsPerPack || p.pack) && <span>Pack: {p.casePacks || p.unitsPerPack || p.pack}</span>}
                    {(p.sku || p.itemCode) && <span>SKU: {p.sku || p.itemCode}</span>}
                    {p.brand && <span style={{ color: 'var(--text-secondary)' }}>{p.brand}</span>}
                  </div>
                </div>
              ))}
              {!modal.isLoading && modal.results.length === 0 && modal.query && (
                <div style={{ textAlign: 'center', padding: '2rem 1rem' }}>
                  <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
                    No POS products found for &quot;{modal.query}&quot;
                  </p>
                  <button onClick={() => setTab('create')} className="btn btn-primary btn-sm"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem' }}>
                    <PlusCircle size={14} /> Create New Product Instead
                  </button>
                </div>
              )}
              {!modal.isLoading && modal.results.length === 0 && !modal.query && (
                <div style={{ textAlign: 'center', padding: '2.5rem 1rem', color: 'var(--text-muted)' }}>
                  <Search size={36} style={{ opacity: 0.15, marginBottom: '0.75rem', display: 'block', margin: '0 auto 0.75rem' }} />
                  <p style={{ fontSize: '0.875rem' }}>Type to search catalog products</p>
                </div>
              )}
            </>
          )}

          {/* ─ Create tab ─ */}
          {tab === 'create' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ background: 'var(--brand-08)', border: '1px solid var(--brand-30)', borderRadius: '8px', padding: '0.65rem 1rem', fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                📋 <strong>Pre-filled from invoice</strong> — review fields below then click Create.
                Department, vendor, taxes &amp; fees can be set from the expanded edit view after creating.
              </div>

              <div>
                <label style={lbl}>Description <span style={{ color: '#ef4444' }}>*</span></label>
                <input style={inpS} value={createForm.description}
                  onChange={e => setCreateForm(p => ({ ...p, description: e.target.value }))}
                  placeholder="Product name as it appears in POS" />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.65rem' }}>
                <div>
                  <label style={lbl}>UPC / Barcode</label>
                  <input style={inpS} value={createForm.upc}
                    onChange={e => setCreateForm(p => ({ ...p, upc: e.target.value }))}
                    placeholder="e.g. 012345678901" />
                </div>
                <div>
                  <label style={lbl}>Vendor Item Code (cert_code)</label>
                  <input style={inpS} value={createForm.cert_code}
                    onChange={e => setCreateForm(p => ({ ...p, cert_code: e.target.value }))}
                    placeholder="Vendor SKU / cert_code" />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.65rem' }}>
                <div>
                  <label style={lbl}>Pack (units/case)</label>
                  <input style={inpS} type="number" min="1" step="1"
                    value={createForm.pack}
                    onChange={e => setCreateForm(p => ({ ...p, pack: e.target.value }))}
                    onWheel={e => e.target.blur()} />
                </div>
                <div>
                  <label style={lbl}>Case Cost ($)</label>
                  <input style={inpS} type="number" step="0.01" min="0"
                    value={createForm.case_cost}
                    onChange={e => setCreateForm(p => ({ ...p, case_cost: e.target.value }))}
                    placeholder="0.00" onWheel={e => e.target.blur()} />
                </div>
                <div>
                  <label style={lbl}>Retail Price ($)</label>
                  <input style={inpS} type="number" step="0.01" min="0"
                    value={createForm.normal_price}
                    onChange={e => setCreateForm(p => ({ ...p, normal_price: e.target.value }))}
                    placeholder="0.00" onWheel={e => e.target.blur()} />
                </div>
              </div>

              <button
                onClick={handleCreate}
                disabled={isCreating || !createForm.description.trim()}
                className="btn btn-primary"
                style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontSize: '0.9rem', padding: '0.75rem', marginTop: '0.25rem' }}
              >
                {isCreating
                  ? <><Loader size={16} style={{ animation: 'spin 1s linear infinite' }} /> Creating product…</>
                  : <><PlusCircle size={16} /> Create Product</>}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────
const InvoiceImport = () => {
  const [invoices,      setInvoices]      = useState([]);
  const [isLoading,     setIsLoading]     = useState(true);
  const [isUploading,   setIsUploading]   = useState(false);
  const [selectedId,    setSelectedId]    = useState(null);
  const [editData,      setEditData]      = useState(null);
  const [isConfirming,  setIsConfirming]  = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [filter,        setFilter]        = useState('all');
  const [searchModal,       setSearchModal]       = useState({ isOpen: false, itemIdx: null, query: '', results: [], isLoading: false, tab: 'search', itemData: null });
  const [isRefreshingPOS,   setIsRefreshingPOS]   = useState(false);
  const [multiPageModal,    setMultiPageModal]    = useState(null); // null | { files: File[] }
  const [parentVendors,     setParentVendors]     = useState([]);    // for upload-area vendor picker
  const [uploadVendorId,    setUploadVendorId]    = useState('');    // preselected vendor applied to all queued uploads
  const [isRematching,      setIsRematching]      = useState(false);
  const pollRef = useRef(null);

  const selectedInvoice = invoices.find(inv => inv.id === selectedId) || null;

  const loadInvoices = useCallback(async () => {
    try {
      const [draftsRes, historyRes] = await Promise.all([getInvoiceDrafts(), getInvoiceHistory()]);
      const all = [
        ...(draftsRes.data  || []),
        ...(historyRes.data || []),
      ].sort((a, b) => new Date(b.uploadedAt || b.createdAt) - new Date(a.uploadedAt || a.createdAt));
      setInvoices(all);
    } catch (err) {
      console.error('Failed to load invoices:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadInvoices();
    // Also load vendor list for the upload-area dropdown. Failures are
    // non-fatal; the dropdown just stays empty / falls back to "Auto-detect".
    getCatalogVendors()
      .then(v => {
        const list = Array.isArray(v) ? v : (v?.data || []);
        setParentVendors(list.filter(x => !x.deleted && x.active !== false));
      })
      .catch(err => console.warn('Failed to load vendors for upload picker:', err?.message));
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [loadInvoices]);

  useEffect(() => {
    const hasProcessing = invoices.some(inv => inv.status === 'processing');
    if (hasProcessing && !pollRef.current) {
      pollRef.current = setInterval(loadInvoices, 5000);
    } else if (!hasProcessing && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, [invoices, loadInvoices]);

  // uploadFiles — core upload logic; multipage=true sends all files as one invoice
  const uploadFiles = useCallback(async (files, multipage) => {
    setIsUploading(true);
    // If the user picked a vendor before dropping files, attach it so the
    // matcher can use vendor-scoped item-code lookup on the first pass.
    const selectedVendorId = uploadVendorId ? String(uploadVendorId) : null;
    if (multipage) {
      // All files → one combined invoice
      const stubId  = `stub-${Date.now()}-${Math.random()}`;
      const names   = files.map(f => f.name).join(', ');
      setInvoices(prev => [{ id: stubId, fileName: names, status: 'processing', uploadedAt: new Date().toISOString() }, ...prev]);
      try {
        const fd = new FormData();
        files.forEach(f => fd.append('invoices', f));
        if (selectedVendorId) fd.append('vendorId', selectedVendorId);
        const { data } = await queueMultipageInvoice(fd);
        const real = data.invoices?.[0];
        if (real) setInvoices(prev => prev.map(inv => inv.id === stubId ? real : inv));
        toast.info(`${files.length}-page invoice queued — AI reading all pages together`);
      } catch {
        setInvoices(prev => prev.filter(inv => inv.id !== stubId));
        toast.error('Failed to queue multi-page invoice');
      }
    } else {
      // Each file → its own invoice
      for (const file of files) {
        const stubId = `stub-${Date.now()}-${Math.random()}`;
        setInvoices(prev => [{ id: stubId, fileName: file.name, status: 'processing', uploadedAt: new Date().toISOString() }, ...prev]);
        try {
          const fd = new FormData();
          fd.append('invoices', file);
          if (selectedVendorId) fd.append('vendorId', selectedVendorId);
          const { data } = await queueInvoice(fd);
          const real = data.invoices?.[0];
          if (real) setInvoices(prev => prev.map(inv => inv.id === stubId ? real : inv));
        } catch {
          setInvoices(prev => prev.filter(inv => inv.id !== stubId));
          toast.error(`Failed to queue ${file.name}`);
        }
      }
      toast.info(`${files.length} invoice${files.length > 1 ? 's' : ''} queued — AI processing in background`);
    }
    setIsUploading(false);
  }, [uploadVendorId]);

  const onDrop = useCallback(async (acceptedFiles) => {
    if (!acceptedFiles.length) return;
    if (acceptedFiles.length > 1) {
      // Multiple files — ask user whether they're pages of the same invoice
      setMultiPageModal({ files: acceptedFiles });
      return;
    }
    // Single file — upload immediately
    await uploadFiles(acceptedFiles, false);
  }, [uploadFiles]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop, accept: { 'image/*': ['.png', '.jpg', '.jpeg'], 'application/pdf': ['.pdf'] }, multiple: true,
  });

  const openReview = (inv) => {
    if (inv.status === 'processing') { toast.info('Still processing — check back shortly'); return; }
    setSelectedId(inv.id);
    const canEdit = inv.status === 'draft';
    setEditData(canEdit ? { ...inv, lineItems: JSON.parse(JSON.stringify(inv.lineItems || [])) } : null);
  };
  const closeReview = () => { setSelectedId(null); setEditData(null); };

  const handleHeaderChange = (field, value) => setEditData(p => ({ ...p, [field]: value }));

  const handleApplyVendorToAll = (vendorId) => {
    setEditData(prev => ({
      ...prev,
      lineItems: prev.lineItems.map(item => ({ ...item, vendorId })),
    }));
  };

  // Change the invoice-level vendor. Updates local editData only;
  // the user must click "Re-run matching" to actually re-score line items.
  const handleInvoiceVendorChange = (vendorId) => {
    setEditData(prev => ({ ...prev, vendorId: vendorId ? parseInt(vendorId, 10) : null }));
  };

  // Re-run the matching cascade on the current invoice, scoped to the
  // newly-selected vendor. Preserves user-confirmed manual matches.
  const handleRematch = async ({ force = false } = {}) => {
    if (!editData) return;
    setIsRematching(true);
    try {
      const res = await rematchInvoice(editData.id, {
        vendorId: editData.vendorId || null,
        force,
      });
      if (res?.invoice) {
        // Refresh editData with the server's merged line items
        setEditData({
          ...editData,
          vendorId:   res.invoice.vendorId,
          lineItems:  JSON.parse(JSON.stringify(res.invoice.lineItems || [])),
          matchStats: res.invoice.matchStats,
        });
      }
      const s = res?.stats || {};
      toast.success(`🔁 Re-matched: ${s.matched ?? 0}/${s.total ?? 0} matched · ${s.preserved ?? 0} preserved`);
    } catch (err) {
      toast.error('Re-match failed: ' + (err.response?.data?.error || err.message));
    } finally {
      setIsRematching(false);
    }
  };

  // ── Helpers: line-item / invoice total recomputation ───────────────────────
  // Sum of all line items' totalAmount (fallback to caseCost × qty when blank).
  // Used to keep the invoice's totalInvoiceAmount in sync with the lines.
  const recomputeInvoiceTotal = (items) =>
    items.reduce((s, it) => {
      const explicit = parseFloat(it.totalAmount);
      if (Number.isFinite(explicit)) return s + explicit;
      const cc = parseFloat(it.caseCost) || 0;
      const q  = parseFloat(it.quantity) || 0;
      return s + (cc * q);
    }, 0);

  // Should the line's totalAmount auto-recompute? Only when user has NOT
  // manually overridden it (tracked via `_totalLocked`).
  const recomputeLineTotal = (item) => {
    if (item._totalLocked) return item;
    const cc = parseFloat(item.caseCost) || 0;
    const q  = parseFloat(item.quantity) || 0;
    const t  = cc * q;
    // Only set when we actually have numbers to compute — leave blank otherwise
    if (cc > 0 || q > 0) {
      return { ...item, totalAmount: Number(t.toFixed(4)) };
    }
    return item;
  };

  const handleItemChange = (itemIdx, field, value) => {
    setEditData(prev => {
      const items = [...prev.lineItems];
      const val   = field === 'upc' ? normalizeUPC(value) : value;
      let item    = { ...items[itemIdx], [field]: val };

      // Manual override of totalAmount — lock it so future edits to qty/caseCost
      // don't clobber the user's number.
      if (field === 'totalAmount') {
        item._totalLocked = true;
      }

      // Recompute unitCost whenever caseCost or packUnits change
      if (field === 'caseCost' || field === 'packUnits') {
        const cc = parseFloat(field === 'caseCost'  ? value : item.caseCost)  || 0;
        const pk = parseFloat(field === 'packUnits' ? value : item.packUnits) || 1;
        item.unitCost = pk > 0 ? cc / pk : 0;
      }

      // Recompute line total when qty or caseCost change (unless user locked it)
      if (field === 'quantity' || field === 'caseCost') {
        item = recomputeLineTotal(item);
      }

      items[itemIdx] = item;
      // Always recompute the invoice total so the summary strip stays in sync
      return { ...prev, lineItems: items, totalInvoiceAmount: recomputeInvoiceTotal(items).toFixed(2) };
    });
  };

  // Delete a line item (with confirmation) and recalculate total
  const handleDeleteItem = (itemIdx, item) => {
    if (!window.confirm(`Delete "${item.description || 'this item'}" from the invoice?`)) return;
    setEditData(prev => {
      const items = prev.lineItems.filter((_, idx) => idx !== itemIdx);
      return { ...prev, lineItems: items, totalInvoiceAmount: recomputeInvoiceTotal(items).toFixed(2) };
    });
    toast.info('Line item removed');
  };

  // Add a new empty line item
  const handleAddItem = () => {
    setEditData(prev => {
      const items = [
        ...prev.lineItems,
        {
          description: '',
          quantity: 1,
          caseCost: 0,
          unitCost: 0,
          totalAmount: 0,
          upc: '',
          packUnits: 1,
          receivedAs: 'cases',          // NEW — "cases" | "units" toggle default
          suggestedRetailPrice: '',
          mappingStatus: 'new',
          confidence: null,
          matchTier: null,
        },
      ];
      return { ...prev, lineItems: items, totalInvoiceAmount: recomputeInvoiceTotal(items).toFixed(2) };
    });
  };

  // Accept all high-confidence items — mark them as 'matched'
  const handleAcceptAllHigh = () => {
    const highCount = editData?.lineItems?.filter(it => it.confidence === 'high' && it.mappingStatus !== 'matched' && it.mappingStatus !== 'manual').length || 0;
    if (highCount === 0) { toast.info('No high-confidence items to accept'); return; }
    if (!window.confirm(`Accept ${highCount} high-confidence match${highCount !== 1 ? 'es' : ''} without individual review?`)) return;
    setEditData(prev => ({
      ...prev,
      lineItems: prev.lineItems.map(item =>
        item.confidence === 'high' && item.mappingStatus !== 'matched' && item.mappingStatus !== 'manual'
          ? { ...item, mappingStatus: 'matched' }
          : item
      ),
    }));
    toast.success(`Accepted ${highCount} high-confidence match${highCount !== 1 ? 'es' : ''}`);
  };

  const handleSaveDraft = async () => {
    if (!editData) return;
    setIsSavingDraft(true);
    try {
      await saveInvoiceDraft(editData.id, {
        lineItems: editData.lineItems, vendorName: editData.vendorName, vendorId: editData.vendorId,
        invoiceNumber: editData.invoiceNumber,
        invoiceDate: editData.invoiceDate, paymentDueDate: editData.paymentDueDate, paymentType: editData.paymentType,
        checkNumber: editData.checkNumber, customerNumber: editData.customerNumber,
        totalInvoiceAmount: editData.totalInvoiceAmount, tax: editData.tax,
        totalDiscount: editData.totalDiscount, totalDeposit: editData.totalDeposit,
        otherFees: editData.otherFees, driverName: editData.driverName,
        salesRepName: editData.salesRepName, loadNumber: editData.loadNumber,
      });
      toast.success('Draft saved');
      loadInvoices();
    } catch (err) {
      toast.error('Save failed: ' + (err.response?.data?.message || err.message));
    } finally {
      setIsSavingDraft(false);
    }
  };

  const doConfirm = async (acceptPOMatch = false) => {
    if (!editData) return;
    setIsConfirming(true);
    try {
      const isCredit = editData.invoiceType === 'credit_memo';
      // Credit memos never accept PO matches — they don't move inventory.
      const effectiveAcceptPO = isCredit ? false : acceptPOMatch;

      // Step 1 — mark invoice as synced + save vendor-product mappings + optionally receive PO
      const confirmResult = await confirmInvoice({
        id: editData.id, lineItems: editData.lineItems, vendorName: editData.vendorName,
        invoiceNumber: editData.invoiceNumber, invoiceDate: editData.invoiceDate,
        totalInvoiceAmount: editData.totalInvoiceAmount, customerNumber: editData.customerNumber,
        paymentDueDate: editData.paymentDueDate, paymentType: editData.paymentType,
        checkNumber: editData.checkNumber, tax: editData.tax, totalDiscount: editData.totalDiscount,
        totalDeposit: editData.totalDeposit, otherFees: editData.otherFees,
        driverName: editData.driverName, salesRepName: editData.salesRepName, loadNumber: editData.loadNumber,
        invoiceType:     editData.invoiceType || 'purchase',
        linkedInvoiceId: editData.linkedInvoiceId || null,
        acceptPOMatch:   effectiveAcceptPO,
      });

      // Show PO receive result
      if (confirmResult?.poReceiveResult) {
        const pr = confirmResult.poReceiveResult;
        toast.success(`📦 PO received: ${pr.itemsReceived} items${pr.totalVariance > 0 ? ` · Cost variance: $${pr.totalVariance}` : ''}`);
      }

      // Show auto-return result
      if (confirmResult?.autoReturnResult) {
        const ar = confirmResult.autoReturnResult;
        toast.info(`↩ Auto-return created: ${ar.returnNumber} · ${ar.itemCount} items · $${Number(ar.total).toFixed(2)}`);
      }

      // Step 2 — bulk-push all matched items to catalog
      const matchedItems = editData.lineItems.filter(
        item => (item.mappingStatus === 'matched' || item.mappingStatus === 'manual')
          && (item.linkedProductId || item.posProductId)
      );

      // Credit memos don't push vendor→product mappings to the catalog.
      // A rebate invoice doesn't describe deliverable products.
      if (!isCredit && matchedItems.length > 0) {
        const posResults = await Promise.allSettled(
          matchedItems.map(item => {
            const catalogFields = {};
            if (item.description)          catalogFields.name               = item.description;
            if (item.upc)                  catalogFields.upc                = item.upc;
            if (item.packUnits)            catalogFields.casePacks          = parseInt(item.packUnits) || undefined;
            if (item.caseCost)             catalogFields.defaultCasePrice   = Number(item.caseCost)   || undefined;
            if (item.unitCost)             catalogFields.defaultCostPrice   = Number(item.unitCost)   || undefined;
            if (item.suggestedRetailPrice) catalogFields.defaultRetailPrice = Number(item.suggestedRetailPrice) || undefined;
            if (item.departmentId)         catalogFields.departmentId       = parseInt(item.departmentId) || undefined;
            if (item.vendorId)             catalogFields.vendorId           = parseInt(item.vendorId)     || undefined;
            if (item.cert_code || item.originalItemCode) catalogFields.itemCode = item.cert_code || item.originalItemCode;
            // Map selected deposit rule ID → depositRuleId
            if (item.feesId) {
              const ruleId = parseInt(String(item.feesId).split(',')[0]);
              if (!isNaN(ruleId)) catalogFields.depositRuleId = ruleId;
            }
            return updateCatalogProduct(item.linkedProductId || item.posProductId, catalogFields);
          })
        );

        const succeeded = posResults.filter(r => r.status === 'fulfilled').length;
        const failed    = posResults.filter(r => r.status === 'rejected').length;
        const unmatched = editData.lineItems.length - matchedItems.length;

        if (failed > 0) {
          toast.warning(`⚠ Invoice synced · ${succeeded} products updated · ${failed} failed${unmatched > 0 ? ` · ${unmatched} unmatched skipped` : ''}`);
        } else {
          toast.success(`✅ Invoice synced · ${succeeded} products updated in catalog${unmatched > 0 ? ` · ${unmatched} unmatched skipped` : ''}`);
        }
      } else {
        // No matched items — just confirm
        const unmatched = editData.lineItems.filter(it => it.mappingStatus === 'unmatched').length;
        toast.success(`✅ ${editData.vendorName || editData.fileName} synced${unmatched > 0 ? ` · ${unmatched} unmatched items skipped` : ''}`);
      }

      // Step 3 — update inventory counts for received items.
      //
      // Unit conversion:
      //   receivedAs === 'cases' (default) → adjustment = qty × packUnits
      //   receivedAs === 'units'           → adjustment = qty (pack ignored)
      //
      // The backend's adjustStoreStock does  newQty = currentQty + adjustment,
      // so this implements: New QOH = Old QOH + Units Received.
      const inventoryPayloads = matchedItems
        .filter(item => parseFloat(item.quantity) > 0)
        .map(item => {
          const q    = parseFloat(item.quantity) || 0;
          const pk   = parseFloat(item.packUnits) || 1;
          const mode = item.receivedAs === 'units' ? 'units' : 'cases';
          const unitsReceived = mode === 'units' ? q : q * pk;
          return {
            masterProductId: parseInt(item.linkedProductId || item.posProductId),
            adjustment:      unitsReceived,
            reason:          `Invoice #${editData.invoiceNumber || editData.id} — ${editData.vendorName || 'Invoice import'} (${q} ${mode}${mode === 'cases' ? ` × ${pk}` : ''})`,
          };
        })
        .filter(p => p.adjustment > 0 && Number.isFinite(p.masterProductId));

      const inventoryResults = await Promise.allSettled(
        inventoryPayloads.map(p => adjustStoreStock(p))
      );
      const invOk      = inventoryResults.filter(r => r.status === 'fulfilled').length;
      const invFail    = inventoryResults.filter(r => r.status === 'rejected').length;
      const unitsTotal = inventoryPayloads.reduce((s, p) => s + p.adjustment, 0);
      if (invOk > 0) {
        toast.info(`📦 Inventory updated: +${unitsTotal} unit${unitsTotal === 1 ? '' : 's'} across ${invOk} product${invOk !== 1 ? 's' : ''}${invFail > 0 ? ` (${invFail} failed)` : ''}`);
      }

      closeReview();
      loadInvoices();
    } catch (err) {
      toast.error('Sync failed: ' + (err.response?.data?.error || err.message));
    } finally {
      setIsConfirming(false);
    }
  };

  const handleConfirm = () => doConfirm(false);
  const handleConfirmWithPO = () => doConfirm(true);

  const handleUpdatePOS = async (posProductId, posFields) => {
    // Map legacy POS field names → catalog field names
    const catalogFields = {
      name:               posFields.description || posFields.name,
      upc:                posFields.upc                          || undefined,
      casePacks:          posFields.pack         ? parseInt(posFields.pack)                   : undefined,
      defaultCasePrice:   posFields.case_cost    ? Number(posFields.case_cost)                : undefined,
      defaultCostPrice:   posFields.cost         ? Number(posFields.cost)                     : undefined,
      defaultRetailPrice: posFields.normal_price ? Number(posFields.normal_price)             : undefined,
      departmentId:       posFields.departmentId ? parseInt(posFields.departmentId)           : undefined,
      vendorId:           posFields.vendorId     ? parseInt(posFields.vendorId)               : undefined,
      itemCode:           posFields.cert_code    || undefined,
    };
    // Remove undefined keys
    Object.keys(catalogFields).forEach(k => catalogFields[k] === undefined && delete catalogFields[k]);
    await updateCatalogProduct(posProductId, catalogFields);
    toast.success('✅ Product updated in catalog');
  };

  const handleCreatePOS = async (posFields) => {
    const pack = parseFloat(posFields.pack) || 1;
    const caseCost = parseFloat(posFields.case_cost) || 0;
    const res = await createCatalogProduct({
      name:               posFields.description || posFields.name,
      upc:                posFields.upc          || undefined,
      casePacks:          pack,
      defaultCasePrice:   caseCost               || undefined,
      defaultCostPrice:   posFields.cost         ? Number(posFields.cost)         : (pack > 0 ? caseCost / pack : undefined),
      defaultRetailPrice: posFields.normal_price ? Number(posFields.normal_price) : undefined,
      departmentId:       posFields.departmentId ? parseInt(posFields.departmentId) : undefined,
      vendorId:           posFields.vendorId     ? parseInt(posFields.vendorId)     : undefined,
      itemCode:           posFields.cert_code    || undefined,
    });
    toast.success('✅ Product created in catalog');
    return res?.data?.id != null ? String(res.data.id) : null;
  };

  // Called from SearchModal "Create New" tab — creates product in POS and links it to the line item
  const handleCreateFromSearch = async (formData) => {
    try {
      const pack     = parseFloat(formData.pack)      || 1;
      const caseCost = parseFloat(formData.case_cost) || 0;
      const res = await createCatalogProduct({
        name:               formData.description,
        upc:                formData.upc       || undefined,
        casePacks:          pack,
        defaultCasePrice:   caseCost           || undefined,
        defaultCostPrice:   pack > 0 ? caseCost / pack : undefined,
        defaultRetailPrice: parseFloat(formData.normal_price) || undefined,
        itemCode:           formData.cert_code || undefined,
      });
      // catalog returns { success: true, data: product }
      const newId = res?.data?.id != null ? String(res.data.id) : null;
      const idx   = searchModal.itemIdx;
      if (idx != null) {
        setEditData(prev => {
          const items = [...prev.lineItems];
          const item  = { ...items[idx] };
          if (newId) item.linkedProductId = newId;
          item.mappingStatus        = 'matched';
          item.confidence           = 'high';
          item.matchTier            = 'manual';
          item.description          = formData.description;
          if (formData.upc)          item.upc                  = formData.upc;
          if (formData.normal_price) item.suggestedRetailPrice = formData.normal_price;
          items[idx] = item;
          return { ...prev, lineItems: items };
        });
      }
      toast.success('✅ Product created in catalog and linked to this invoice item');
      setSearchModal({ isOpen: false, itemIdx: null, query: '', results: [], isLoading: false, tab: 'search', itemData: null });
    } catch (err) {
      toast.error('Create failed: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleRefreshPOS = async () => {
    setIsRefreshingPOS(true);
    try {
      await clearInvoicePOSCache();
      toast.success('✅ POS product cache cleared');
    } catch (err) {
      toast.error('Failed to refresh: ' + (err.response?.data?.message || err.message));
    } finally {
      setIsRefreshingPOS(false);
    }
  };

  const handleDelete = async (id, e) => {
    e.stopPropagation();
    if (!window.confirm('Delete this invoice? This cannot be undone.')) return;
    try {
      await deleteInvoiceDraft(id);
      setInvoices(prev => prev.filter(inv => inv.id !== id));
      if (selectedId === id) closeReview();
      toast.success('Deleted');
    } catch (err) {
      toast.error('Delete failed: ' + (err.response?.data?.message || err.message));
    }
  };

  const handleSearch = async (query) => {
    setSearchModal(p => ({ ...p, query, isLoading: true }));
    try {
      const result = await searchCatalogProducts(query);
      // catalog returns { success, data: [...] }
      const products = Array.isArray(result) ? result : (result?.data || []);
      setSearchModal(p => ({ ...p, results: products, isLoading: false }));
    } catch {
      setSearchModal(p => ({ ...p, isLoading: false }));
    }
  };

  const handleSelectProduct = (product) => {
    const { itemIdx } = searchModal;
    setEditData(prev => {
      const items = [...prev.lineItems];
      const item  = { ...items[itemIdx] };
      // Catalog fields: id, name, upc, defaultRetailPrice, casePacks/unitsPerPack, departmentId, vendorId
      item.description          = product.name;
      item.upc                  = normalizeUPC(product.upc || item.upc || '');
      item.suggestedRetailPrice = product.defaultRetailPrice != null ? Number(product.defaultRetailPrice) : (product.retailPrice || '');
      item.packUnits            = product.casePacks || product.unitsPerPack || product.pack || 1;
      item.unitCost             = parseFloat(item.caseCost || item.netCost || 0) / (item.packUnits || 1);
      item.mappingStatus        = 'matched';
      item.confidence           = 'high';
      item.matchTier            = 'manual';
      item.linkedProductId      = String(product.id || product.posProductId || '');
      item.departmentId         = product.departmentId != null ? String(product.departmentId) : (item.departmentId || '');
      item.vendorId             = product.vendorId     != null ? String(product.vendorId)     : (item.vendorId     || '');
      items[itemIdx] = item;
      return { ...prev, lineItems: items };
    });
    setSearchModal({ isOpen: false, itemIdx: null, query: '', results: [], isLoading: false, tab: 'search', itemData: null });
    toast.success('✅ Product linked to invoice item');
  };

  const stats = {
    all:        invoices.length,
    processing: invoices.filter(i => i.status === 'processing').length,
    draft:      invoices.filter(i => i.status === 'draft').length,
    synced:     invoices.filter(i => i.status === 'synced' || i.status === 'processed').length,
    failed:     invoices.filter(i => i.status === 'failed').length,
  };

  const filteredInvoices = filter === 'all'
    ? invoices
    : filter === 'synced'
      ? invoices.filter(i => i.status === 'synced' || i.status === 'processed')
      : invoices.filter(i => i.status === filter);

  return (
      <div className="p-page">
        <div className="p-header">
          <div className="p-header-left">
            <div className="p-header-icon">
              <FileUp size={22} />
            </div>
            <div>
              <h1 className="p-title">Invoice Import</h1>
              <p className="p-subtitle">Drop files to instantly queue · AI extracts line items · Review and push to POS when ready</p>
            </div>
          </div>
          <div className="p-header-actions">
            <button
              onClick={handleRefreshPOS}
              disabled={isRefreshingPOS}
              className="btn btn-secondary btn-sm"
              title="Clear cached POS products — forces a fresh fetch on next upload."
            >
              {isRefreshingPOS
                ? <><Loader size={14} className="ii-spin" /> Refreshing...</>
                : <><RefreshCw size={14} /> Refresh POS Data</>}
            </button>
            <button onClick={loadInvoices} className="btn btn-secondary btn-sm">
              <RotateCcw size={14} /> Refresh
            </button>
          </div>
        </div>

        {/* ── Upload vendor picker — applied to all files queued in this batch ── */}
        <div className="ii-upload-vendor-row">
          <label htmlFor="ii-upload-vendor" className="ii-upload-vendor-label">
            Vendor <span className="ii-upload-vendor-opt">(optional — speeds up matching)</span>
          </label>
          <select
            id="ii-upload-vendor"
            className="ii-upload-vendor-select"
            value={uploadVendorId}
            onChange={e => setUploadVendorId(e.target.value)}
            disabled={isUploading}
          >
            <option value="">— Auto-detect from invoice —</option>
            {parentVendors.map(v => (
              <option key={v.id} value={String(v.id)}>{v.name}</option>
            ))}
          </select>
          {uploadVendorId && (
            <button
              type="button"
              className="ii-upload-vendor-clear"
              onClick={() => setUploadVendorId('')}
              title="Clear vendor selection"
            >
              Clear
            </button>
          )}
          <span className="ii-upload-vendor-hint">
            Pick a vendor to use their item codes for matching, or leave as auto-detect.
          </span>
        </div>

        <div {...getRootProps()} className={`ii-dropzone ${isDragActive ? 'ii-dropzone--active' : ''}`}>
          <input {...getInputProps()} />
          <div className={`ii-dropzone-icon ${isDragActive ? 'ii-dropzone-icon--active' : ''}`}>
            {isUploading ? <Loader size={26} className="ii-spin" /> : <UploadIcon size={26} />}
          </div>
          <div className="ii-dropzone-text">
            <div className="ii-dropzone-text-title">
              {isDragActive ? 'Drop to queue for AI processing' : isUploading ? 'Uploading...' : 'Drop invoices here or click to browse'}
            </div>
            <div className="ii-dropzone-text-sub">PDF (multi-page), PNG, JPG — instantly queued, AI extracts all pages in background</div>
          </div>
          {invoices.length > 0 && (
            <div className="ii-dropzone-stats">
              {stats.processing > 0 && <span className="ii-dropzone-stat" style={{ color: 'var(--accent-secondary)' }}><Loader size={13} className="ii-spin" /> {stats.processing} processing</span>}
              {stats.draft      > 0 && <span className="ii-dropzone-stat" style={{ color: '#f59e0b' }}>{stats.draft} ready to review</span>}
              {stats.synced     > 0 && <span className="ii-dropzone-stat" style={{ color: '#10b981' }}>{stats.synced} synced</span>}
              {stats.failed     > 0 && <span className="ii-dropzone-stat" style={{ color: '#ef4444' }}>{stats.failed} failed</span>}
            </div>
          )}
        </div>

        {invoices.length > 0 && (
          <div className="ii-filters">
            {[
              { key: 'all',        label: `All (${stats.all})` },
              { key: 'processing', label: `Processing (${stats.processing})` },
              { key: 'draft',      label: `Ready to Review (${stats.draft})` },
              { key: 'synced',     label: `Synced (${stats.synced})` },
              ...(stats.failed > 0 ? [{ key: 'failed', label: `Failed (${stats.failed})` }] : []),
            ].map(tab => (
              <button key={tab.key} onClick={() => setFilter(tab.key)} className={`ii-filter-btn ${filter === tab.key ? 'ii-filter-btn--active' : ''}`}>
                {tab.label}
              </button>
            ))}
          </div>
        )}

        {isLoading ? (
          <div className="ii-loading">
            <Loader size={28} className="ii-spin" />
            <p>Loading invoices...</p>
          </div>
        ) : filteredInvoices.length === 0 ? (
          <div className="ii-empty">
            <FileText size={40} style={{ marginBottom: '1rem', opacity: 0.3 }} />
            <p>{filter === 'all' ? 'No invoices yet — drop files above to get started' : `No ${filter} invoices`}</p>
          </div>
        ) : (
          <div className="ii-invoice-list">
            {filteredInvoices.map(inv => (
              <InvoiceCard key={inv.id} inv={inv} selected={selectedId === inv.id} onOpen={openReview} onDelete={handleDelete} />
            ))}
          </div>
        )}

      {selectedId && (
        <ReviewPanel
          invoice={selectedInvoice}
          editData={editData}
          isConfirming={isConfirming}
          isSavingDraft={isSavingDraft}
          isRematching={isRematching}
          onClose={closeReview}
          onConfirm={handleConfirm}
          onConfirmWithPO={handleConfirmWithPO}
          onSaveDraft={handleSaveDraft}
          onHeaderChange={handleHeaderChange}
          onInvoiceVendorChange={handleInvoiceVendorChange}
          onRematch={handleRematch}
          onItemChange={handleItemChange}
          onApplyVendorToAll={handleApplyVendorToAll}
          onOpenSearch={(itemIdx, openTab = 'search') => setSearchModal({
            isOpen: true, itemIdx, tab: openTab,
            query: editData?.lineItems[itemIdx]?.description || '',
            results: [], isLoading: false,
            itemData: editData?.lineItems[itemIdx] || null,
          })}
          onUpdatePOS={handleUpdatePOS}
          onCreatePOS={handleCreatePOS}
          onDeleteItem={handleDeleteItem}
          onAddItem={handleAddItem}
          onAcceptAllHigh={handleAcceptAllHigh}
          readOnly={selectedInvoice?.status === 'synced' || selectedInvoice?.status === 'processed'}
        />
      )}

      {searchModal.isOpen && (
        <SearchModal
          modal={searchModal}
          onClose={() => setSearchModal({ isOpen: false, itemIdx: null, query: '', results: [], isLoading: false, tab: 'search', itemData: null })}
          onSearch={handleSearch}
          onSelect={handleSelectProduct}
          onCreateNew={handleCreateFromSearch}
          itemData={searchModal.itemData}
        />
      )}

      {multiPageModal && (
        <MultiPageModal
          files={multiPageModal.files}
          onConfirm={(isMultipage) => {
            const { files } = multiPageModal;
            setMultiPageModal(null);
            uploadFiles(files, isMultipage);
          }}
          onClose={() => setMultiPageModal(null)}
        />
      )}
    </div>
  );
};

export default InvoiceImport;
