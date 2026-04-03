import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import './analytics.css';
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
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import Sidebar from '../components/Sidebar';
import {
  queueInvoice,
  getInvoiceDrafts,
  getInvoiceHistory,
  confirmInvoice,
  deleteInvoiceDraft,
  saveInvoiceDraft,
  searchPOSProducts,
  updatePOSProductDetails,
  createPOSProduct,
  getPOSTaxesFees,
  fetchPOSDepartments,
  getPOSVendors,
  clearInvoicePOSCache,
} from '../services/api';
import { toast } from 'react-toastify';

// ─── Status config ────────────────────────────────────────────────────────────
const STATUS = {
  processing: { label: 'Processing',      color: '#818cf8', bg: 'rgba(99,102,241,0.12)'  },
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

const MAPPING_BADGE = {
  matched:   { color: '#10b981', label: 'Matched'   },
  unmatched: { color: '#ef4444', label: 'Unmatched' },
  manual:    { color: '#f59e0b', label: 'Manual'    },
  new:       { color: '#a78bfa', label: 'New'       },
};
const MAPPING_CONF = {
  high:   { bg: '#10b981', color: '#fff' },
  medium: { bg: '#f59e0b', color: '#000' },
  low:    { bg: '#ef4444', color: '#fff' },
};
const TIER_LABEL = { upc: 'UPC', vendorMap: 'MAP', sku: 'SKU', fuzzy: 'FUZZY', ai: 'AI', manual: 'MANUAL' };

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
  return (
    <div
      onClick={() => onOpen(inv)}
      style={{
        background: selected ? 'rgba(99,102,241,0.06)' : 'var(--bg-secondary)',
        border: `1px solid ${selected ? 'rgba(99,102,241,0.4)' : 'var(--border-color)'}`,
        borderRadius: '10px', padding: '1rem 1.25rem', cursor: inv.status === 'processing' ? 'default' : 'pointer',
        transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: '1rem',
      }}
    >
      <div style={{ width: '40px', height: '40px', borderRadius: '8px', background: s.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {inv.status === 'processing' && <Loader size={18} color={s.color} style={{ animation: 'spin 1s linear infinite' }} />}
        {inv.status === 'draft'      && <FileText size={18} color={s.color} />}
        {inv.status === 'failed'     && <AlertCircle size={18} color={s.color} />}
        {(inv.status === 'synced' || inv.status === 'processed') && <CheckCircle size={18} color={s.color} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600, fontSize: '0.9rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '220px' }}>
            {inv.vendorName || inv.fileName}
          </span>
          <span style={{ padding: '2px 8px', borderRadius: '999px', fontSize: '0.68rem', fontWeight: 700, background: s.bg, color: s.color, textTransform: 'uppercase', letterSpacing: '0.4px', whiteSpace: 'nowrap' }}>
            {s.label}
          </span>
        </div>
        <div style={{ display: 'flex', gap: '1rem', fontSize: '0.78rem', color: 'var(--text-muted)', flexWrap: 'wrap' }}>
          {inv.vendorName           && <span style={{ color: 'var(--text-secondary)' }}>{inv.fileName}</span>}
          {inv.invoiceNumber        && <span>#{inv.invoiceNumber}</span>}
          {inv.invoiceDate          && <span>{inv.invoiceDate}</span>}
          {inv.totalInvoiceAmount > 0 && <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{fmt(inv.totalInvoiceAmount)}</span>}
          {inv.lineItems?.length > 0 && <span>{inv.lineItems.length} items</span>}
          {inv.status === 'processing' && <span style={{ color: '#818cf8' }}>AI is reading your invoice…</span>}
          {inv.status === 'failed'     && <span style={{ color: '#ef4444' }}>{inv.processingError || 'Extraction failed'}</span>}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0 }}>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{timeAgo(inv.uploadedAt || inv.createdAt)}</span>
        {inv.status === 'draft' && (
          <button onClick={e => { e.stopPropagation(); onOpen(inv); }} className="btn btn-primary btn-sm" style={{ fontSize: '0.78rem', padding: '6px 14px', whiteSpace: 'nowrap' }}>Review →</button>
        )}
        {(inv.status === 'synced' || inv.status === 'processed') && (
          <button onClick={e => { e.stopPropagation(); onOpen(inv); }} className="btn btn-secondary btn-sm" style={{ fontSize: '0.78rem', padding: '6px 14px', whiteSpace: 'nowrap' }}>View</button>
        )}
        {inv.status !== 'synced' && inv.status !== 'processed' && (
          <button onClick={e => onDelete(inv.id, e)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '4px', display: 'flex' }} title="Delete">
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
  isConfirming, isSavingDraft,
  onClose, onConfirm, onSaveDraft,
  onHeaderChange, onItemChange, onApplyVendorToAll,
  onOpenSearch, onUpdatePOS, onCreatePOS,
  readOnly,
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
        fetchPOSDepartments(),
        getPOSVendors(),
        getPOSTaxesFees(),
      ]).then(([dR, vR, tfR]) => {
        // Departments → { success, departments: [...] }
        if (dR.status === 'fulfilled') {
          const d = dR.value?.data;
          setDepartments(d?.departments || (Array.isArray(d) ? d : []));
        }
        // Vendors → array directly (filter deleted)
        if (vR.status === 'fulfilled') {
          const v = vR.value?.data;
          setVendors(Array.isArray(v) ? v.filter(x => !x.deleted) : (v?.vendors || []));
        }
        // Taxes + Fees → { success, taxes: [...], fees: [...] }
        if (tfR.status === 'fulfilled') {
          const tf = tfR.value?.data;
          setTaxes(tf?.taxes || []);
          setFees(tf?.fees   || []);
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
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', flexDirection: 'column', background: 'rgba(100,100,100,0.3)', backdropFilter: 'blur(25px)' }}>

      {/* ── Top bar ── */}
      <div className="review-topbar" style={{ background: 'var(--bg-primary)', borderBottom: '1px solid var(--border-color)', padding: '0.9rem 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, zIndex: 1, boxShadow: '0 2px 8px rgba(0,0,0,0.2)', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', minWidth: 0 }}>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.85rem', whiteSpace: 'nowrap' }}>
            <X size={18} /> Close
          </button>
          <div style={{ width: '1px', height: '20px', background: 'var(--border-color)', flexShrink: 0 }} />
          <div style={{ minWidth: 0 }}>
            <span style={{ fontWeight: 700, fontSize: '1rem' }}>{invoice.vendorName || invoice.fileName}</span>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginLeft: '0.75rem' }}>
              {invoice.fileName}{invoice.invoiceNumber && ` · #${invoice.invoiceNumber}`}{invoice.invoiceDate && ` · ${invoice.invoiceDate}`}
            </span>
          </div>
          {posLoading && <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}><Loader size={12} style={{ animation: 'spin 1s linear infinite' }} /> Loading POS data…</span>}
        </div>
        <div className="review-topbar-actions" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0 }}>
          {!readOnly && (
            <>
              <span style={{ fontSize: '0.8rem', color: unmatchedCount > 0 ? '#f59e0b' : '#10b981' }}>
                {unmatchedCount > 0 ? `⚠ ${unmatchedCount} unmatched` : '✓ All matched'}
              </span>
              <button onClick={onSaveDraft} disabled={isSavingDraft} className="btn btn-secondary"
                style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.875rem' }}>
                {isSavingDraft ? <><Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> Saving…</> : <><Save size={14} /> Save Draft</>}
              </button>
              <button onClick={onConfirm} disabled={isConfirming} className="btn btn-primary"
                style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.875rem' }}>
                {isConfirming ? <><Loader size={15} style={{ animation: 'spin 1s linear infinite' }} /> Syncing & updating POS…</> : <><CheckCircle size={15} /> Confirm & Sync to POS</>}
              </button>
            </>
          )}
          {readOnly && (
            <span style={{ fontSize: '0.8rem', color: '#10b981', background: 'rgba(16,185,129,0.1)', padding: '4px 12px', borderRadius: '999px' }}>
              ✅ Synced — read only
            </span>
          )}
        </div>
      </div>

      {/* ── Body ── */}
      <div className="review-body" style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Left: invoice image */}
        {hasPages && (
          <div className="review-image-pane" style={{ width: '50%', flexShrink: 0, display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border-color)', overflow: 'hidden' }}>
            <InvoiceImageViewer pages={invoice.pages} />
          </div>
        )}

        {/* Right: form */}
        <div className="review-form-pane" style={{ flex: 1, overflowY: 'auto', padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

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
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: '8px', padding: '0.65rem 1rem' }}>
                <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#818cf8', textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap', flexShrink: 0 }}>
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
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            {[
              { label: 'Line Items', value: lineItems.length, icon: <Package size={15} /> },
              { label: 'Unmatched', value: unmatchedCount, icon: <AlertCircle size={15} />, color: unmatchedCount > 0 ? '#ef4444' : '#10b981' },
              { label: 'Total', value: fmt((editData || invoice).totalInvoiceAmount), icon: <DollarSign size={15} /> },
            ].map(c => (
              <div key={c.label} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.6rem 1rem', flex: 1, minWidth: '100px' }}>
                <span style={{ color: c.color || 'var(--text-muted)' }}>{c.icon}</span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.95rem', color: c.color || 'var(--text-primary)' }}>{c.value}</div>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{c.label}</div>
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

                return (
                  <div key={i} style={{ border: `1px solid ${item.mappingStatus === 'unmatched' ? 'rgba(239,68,68,0.3)' : 'var(--border-color)'}`, borderRadius: '10px', background: 'var(--bg-secondary)', overflow: 'hidden' }}>

                    {/* Summary row — click to expand */}
                    <div onClick={() => toggle(i)} style={{ padding: '0.75rem 1rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                      <span style={{ fontSize: '0.62rem', fontWeight: 700, padding: '2px 6px', borderRadius: '4px', background: `${mb.color}22`, color: mb.color, textTransform: 'uppercase', whiteSpace: 'nowrap', flexShrink: 0 }}>
                        {mb.label}
                      </span>
                      {item.confidence && MAPPING_CONF[item.confidence] && (
                        <span style={{ fontSize: '0.58rem', fontWeight: 800, padding: '2px 5px', borderRadius: '3px', background: MAPPING_CONF[item.confidence].bg, color: MAPPING_CONF[item.confidence].color, flexShrink: 0 }}>
                          {item.confidence.toUpperCase()}
                        </span>
                      )}
                      {item.matchTier && <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', flexShrink: 0 }}>{TIER_LABEL[item.matchTier] || item.matchTier}</span>}
                      <span style={{ flex: 1, fontSize: '0.875rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.description || '—'}</span>
                      <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexShrink: 0 }}>
                        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>×{item.quantity}</span>
                        <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>{fmt(item.totalAmount)}</span>
                        {margin !== null && (
                          <span style={{ fontSize: '0.7rem', fontWeight: 700, padding: '2px 5px', borderRadius: '4px',
                            background: margin >= 30 ? 'rgba(16,185,129,0.12)' : margin >= 15 ? 'rgba(245,158,11,0.12)' : 'rgba(239,68,68,0.12)',
                            color:      margin >= 30 ? '#10b981' : margin >= 15 ? '#f59e0b' : '#ef4444' }}>
                            {margin.toFixed(0)}%
                          </span>
                        )}
                        {!readOnly && item.mappingStatus === 'unmatched' ? (
                          <div style={{ display: 'flex', gap: '4px' }} onClick={e => e.stopPropagation()}>
                            <button onClick={() => onOpenSearch(i, 'search')}
                              style={{ background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: '5px', padding: '3px 8px', cursor: 'pointer', fontSize: '0.7rem', color: '#818cf8', display: 'flex', alignItems: 'center', gap: '3px', whiteSpace: 'nowrap', fontWeight: 600 }}>
                              <Search size={11} /> Link
                            </button>
                            <button onClick={() => onOpenSearch(i, 'create')}
                              style={{ background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.3)', borderRadius: '5px', padding: '3px 8px', cursor: 'pointer', fontSize: '0.7rem', color: '#a78bfa', display: 'flex', alignItems: 'center', gap: '3px', whiteSpace: 'nowrap', fontWeight: 600 }}>
                              <PlusCircle size={11} /> New
                            </button>
                          </div>
                        ) : (
                          !readOnly && (
                            <button onClick={e => { e.stopPropagation(); onOpenSearch(i, 'search'); }} title="Re-link to a different POS product"
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '2px', display: 'flex' }}>
                              <Search size={13} />
                            </button>
                          )
                        )}
                        {isExp ? <ChevronUp size={14} color="var(--text-muted)" /> : <ChevronDown size={14} color="var(--text-muted)" />}
                      </div>
                    </div>

                    {/* Vendor vs POS description */}
                    {item.originalVendorDescription && item.originalVendorDescription !== item.description && (
                      <div style={{ padding: '0 1rem 0.5rem', fontSize: '0.72rem', color: 'var(--text-muted)', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                        <span>📄 Invoice: <em>{item.originalVendorDescription}</em></span>
                        {item.originalItemCode && <span>Code: {item.originalItemCode}</span>}
                        <span style={{ color: '#818cf8' }}>→ POS: {item.description}</span>
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
                                    style={{ background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: '6px', padding: '5px 12px', cursor: 'pointer', fontSize: '0.78rem', color: '#818cf8', display: 'flex', alignItems: 'center', gap: '5px', fontWeight: 600 }}>
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
                              {!readOnly && <span style={{ color: '#818cf8', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}> — edits tracked in draft</span>}
                            </p>

                            {/* Description + UPC */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.45rem' }}>
                              <div><label style={lbl}>Description</label>
                                <input style={inpStyle(readOnly)} value={item.description || ''} readOnly={readOnly} onChange={e => onItemChange(i, 'description', e.target.value)} /></div>
                              <div><label style={lbl}>UPC / Barcode</label>
                                <input style={inpStyle(readOnly)} value={item.upc || ''} readOnly={readOnly} onChange={e => onItemChange(i, 'upc', e.target.value)} /></div>
                            </div>

                            {/* Pack + Vendor Item Code */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.45rem' }}>
                              <div><label style={lbl}>Pack (Units / Case)</label>
                                <input style={inpStyle(readOnly)} type="number" min="1" step="1" value={item.packUnits || ''} readOnly={readOnly}
                                  onChange={e => onItemChange(i, 'packUnits', e.target.value)}
                                  onWheel={e => e.target.blur()} /></div>
                              <div><label style={lbl}>Vendor Item Code</label>
                                <input style={inpStyle(readOnly)} value={item.cert_code || item.originalItemCode || ''} readOnly={readOnly} onChange={e => onItemChange(i, 'cert_code', e.target.value)} placeholder="cert_code / SKU" /></div>
                            </div>

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

                            {/* Deposit / Bottle Fees */}
                            <div>
                              <label style={lbl}>
                                Deposit / Bottle Fee
                                {item.packUnits && fees.length > 0 && (
                                  <span style={{ color: '#818cf8', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
                                    {' '}— pack: {item.packUnits}
                                  </span>
                                )}
                              </label>

                              {/* Invoice deposit calculation hint */}
                              {(() => {
                                const dep  = parseFloat(item.depositAmount);
                                const pack = parseFloat(item.packUnits);
                                if (!dep || dep === 0) return null;
                                const perUnit = pack > 0 ? dep / pack : null;
                                return (
                                  <div style={{
                                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                                    background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)',
                                    borderRadius: '6px', padding: '5px 10px', marginBottom: '0.5rem',
                                    flexWrap: 'wrap', fontSize: '0.75rem',
                                  }}>
                                    <span style={{ color: '#10b981', fontWeight: 700, flexShrink: 0 }}>📄 From Invoice</span>
                                    <span style={{ color: 'var(--text-secondary)' }}>
                                      Total deposit: <strong style={{ color: 'var(--text-primary)' }}>${dep.toFixed(2)}</strong>
                                    </span>
                                    {pack > 0 && (
                                      <>
                                        <span style={{ color: 'var(--text-muted)' }}>÷ {pack} pack</span>
                                        <span style={{ color: '#10b981', fontWeight: 700 }}>
                                          = ${perUnit.toFixed(4)} / unit
                                        </span>
                                        {perUnit && (
                                          <span style={{ color: 'var(--text-muted)', fontSize: '0.68rem' }}>
                                            — select the fee closest to this value below
                                          </span>
                                        )}
                                      </>
                                    )}
                                  </div>
                                );
                              })()}

                              {fees.length > 0 ? (
                                /* Fee API available — selectable cards */
                                <>
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                                    {(() => {
                                      // Calculate invoice deposit per unit to highlight the closest fee
                                      const dep    = parseFloat(item.depositAmount);
                                      const pack   = parseFloat(item.packUnits) || 1;
                                      const perUnit = dep > 0 ? dep / pack : null;
                                      return fees.map(f => {
                                        const id        = String(posId(f));
                                        const checked   = hasItemId(item, 'feesId', id);
                                        const amt       = f.amount != null ? Number(f.amount) : null;
                                        const fpack     = f.pack   != null ? Number(f.pack)   : null;
                                        const packMatch = fpack != null && item.packUnits != null
                                          && String(fpack) === String(item.packUnits);
                                        // Closest amount match: within 1 cent of invoice-calculated per-unit deposit
                                        const amtMatch  = perUnit != null && amt != null
                                          && Math.abs(amt - perUnit) < 0.015;
                                        const highlight = packMatch || amtMatch;
                                        return (
                                          <label key={id} style={{
                                            display: 'flex', flexDirection: 'column', gap: '1px',
                                            cursor: readOnly ? 'default' : 'pointer',
                                            background: checked ? 'rgba(99,102,241,0.15)' : highlight ? 'rgba(16,185,129,0.07)' : 'var(--bg-primary)',
                                            border: `1px solid ${checked ? 'var(--accent-primary)' : highlight ? 'rgba(16,185,129,0.4)' : 'var(--border-color)'}`,
                                            borderRadius: '6px', padding: '5px 9px', minWidth: '70px',
                                          }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.72rem' }}>
                                              <input type="checkbox" checked={checked} disabled={readOnly}
                                                onChange={() => !readOnly && toggleItemId(i, 'feesId', id)}
                                                style={{ width: '11px', height: '11px', flexShrink: 0 }} />
                                              <span style={{ fontWeight: checked ? 700 : 400, whiteSpace: 'nowrap' }}>{posName(f)}</span>
                                            </div>
                                            {amt != null && (
                                              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: checked ? 'var(--accent-primary)' : '#10b981', paddingLeft: '15px' }}>
                                                ${amt.toFixed(2)}{fpack != null ? ` / ${fpack}-pk` : ''}
                                              </div>
                                            )}
                                            {highlight && !checked && (
                                              <div style={{ fontSize: '0.62rem', color: '#10b981', paddingLeft: '15px' }}>
                                                {amtMatch ? '✓ matches invoice' : '✓ matches pack'}
                                              </div>
                                            )}
                                          </label>
                                        );
                                      });
                                    })()}
                                  </div>
                                  {(() => {
                                    const sel   = fees.filter(f => hasItemId(item, 'feesId', String(posId(f))));
                                    const total = sel.reduce((s, f) => s + (f.amount != null ? Number(f.amount) : 0), 0);
                                    const qty   = parseFloat(item.quantity || 0);
                                    return sel.length > 0 ? (
                                      <div style={{ marginTop: '0.35rem', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                                        Fee total: <strong style={{ color: 'var(--text-primary)' }}>${total.toFixed(2)}</strong>
                                        {qty > 0 && <> · {qty} cases = <strong style={{ color: '#10b981' }}>${(total * qty).toFixed(2)}</strong> deposit</>}
                                      </div>
                                    ) : null;
                                  })()}
                                </>
                              ) : (
                                /* Fee API not yet available — manual ID entry */
                                <>
                                  <input
                                    style={inpStyle(readOnly)}
                                    value={item.feesId || ''}
                                    readOnly={readOnly}
                                    onChange={e => onItemChange(i, 'feesId', e.target.value)}
                                    placeholder="Enter fee ID(s), comma-separated e.g. 3,7"
                                  />
                                  <div style={{ marginTop: '3px', fontSize: '0.65rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <span style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b', padding: '1px 5px', borderRadius: '3px', fontWeight: 700, flexShrink: 0 }}>PENDING</span>
                                    Deposit fee API not yet confirmed with POS provider — enter fee ID manually for now
                                  </div>
                                </>
                              )}
                            </div>

                            {/* Taxes */}
                            {taxes.length > 0 && (
                              <div>
                                <label style={lbl}>Taxes</label>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                                  {taxes.map(t => {
                                    const id = String(posId(t));
                                    const checked = hasItemId(item, 'taxesId', id);
                                    return (
                                      <label key={id} style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: readOnly ? 'default' : 'pointer',
                                        background: checked ? 'rgba(245,158,11,0.15)' : 'var(--bg-primary)',
                                        border: `1px solid ${checked ? '#f59e0b' : 'var(--border-color)'}`,
                                        borderRadius: '5px', padding: '3px 7px', fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
                                        <input type="checkbox" checked={checked} disabled={readOnly} onChange={() => !readOnly && toggleItemId(i, 'taxesId', id)} style={{ width: '11px', height: '11px' }} />
                                        {posName(t)}{t.rate != null ? ` (${t.rate}%)` : ''}
                                      </label>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Per-item action bar */}
                        {!readOnly && (
                          <div style={{ padding: '0.65rem 1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', background: 'var(--bg-secondary)' }}>
                            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                              💡 Field edits are tracked in draft — use buttons to sync to your catalog
                            </span>
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                              {isMatched && (item.linkedProductId || item.posProductId) ? (
                                <button onClick={() => handleItemUpdatePOS(i, item)} disabled={isPosUpd} className="btn btn-primary btn-sm"
                                  style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.78rem' }}>
                                  {isPosUpd ? <><Loader size={12} style={{ animation: 'spin 1s linear infinite' }} /> Updating…</> : <><RefreshCw size={12} /> Update in POS</>}
                                </button>
                              ) : (
                                <button onClick={() => handleItemCreatePOS(i, item)} disabled={isPosCreate} className="btn btn-primary btn-sm"
                                  style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.78rem', background: '#7c3aed', borderColor: '#7c3aed' }}>
                                  {isPosCreate ? <><Loader size={12} style={{ animation: 'spin 1s linear infinite' }} /> Creating…</> : <><PlusCircle size={12} /> Create in POS</>}
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    </div>
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
                  <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '4px' }}>{p.name}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                    {p.upc         && <span>UPC: {p.upc}</span>}
                    {p.retailPrice != null && <span>Retail: ${p.retailPrice}</span>}
                    {p.costPrice   != null && <span>Cost: ${p.costPrice}</span>}
                    {p.pack        && <span>Pack: {p.pack}</span>}
                    {p.sku         && <span>SKU: {p.sku}</span>}
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
              <div style={{ background: 'rgba(122,193,67,0.08)', border: '1px solid rgba(122,193,67,0.25)', borderRadius: '8px', padding: '0.65rem 1rem', fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
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

  const onDrop = useCallback(async (acceptedFiles) => {
    if (!acceptedFiles.length) return;
    setIsUploading(true);
    for (const file of acceptedFiles) {
      const stubId = `stub-${Date.now()}-${Math.random()}`;
      setInvoices(prev => [{ id: stubId, fileName: file.name, status: 'processing', uploadedAt: new Date().toISOString() }, ...prev]);
      try {
        const fd = new FormData();
        fd.append('invoices', file);
        const { data } = await queueInvoice(fd);
        const real = data.invoices?.[0];
        if (real) setInvoices(prev => prev.map(inv => inv.id === stubId ? real : inv));
      } catch {
        setInvoices(prev => prev.filter(inv => inv._id !== stubId));
        toast.error(`Failed to queue ${file.name}`);
      }
    }
    setIsUploading(false);
    toast.info(`${acceptedFiles.length} invoice${acceptedFiles.length > 1 ? 's' : ''} queued — AI processing in background`);
  }, []);

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

  const handleItemChange = (itemIdx, field, value) => {
    setEditData(prev => {
      const items = [...prev.lineItems];
      const item  = { ...items[itemIdx], [field]: value };
      if (['caseCost', 'packUnits'].includes(field)) {
        const cc = parseFloat(field === 'caseCost' ? value : item.caseCost) || 0;
        const pk = parseFloat(field === 'packUnits' ? value : item.packUnits) || 1;
        item.unitCost = pk > 0 ? cc / pk : 0;
      }
      items[itemIdx] = item;
      return { ...prev, lineItems: items };
    });
  };

  const handleSaveDraft = async () => {
    if (!editData) return;
    setIsSavingDraft(true);
    try {
      await saveInvoiceDraft(editData.id, {
        lineItems: editData.lineItems, vendorName: editData.vendorName, invoiceNumber: editData.invoiceNumber,
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

  const handleConfirm = async () => {
    if (!editData) return;
    setIsConfirming(true);
    try {
      // Step 1 — mark invoice as synced in MongoDB + save vendor-product mappings
      await confirmInvoice({
        id: editData.id, lineItems: editData.lineItems, vendorName: editData.vendorName,
        invoiceNumber: editData.invoiceNumber, invoiceDate: editData.invoiceDate,
        totalInvoiceAmount: editData.totalInvoiceAmount, customerNumber: editData.customerNumber,
        paymentDueDate: editData.paymentDueDate, paymentType: editData.paymentType,
        checkNumber: editData.checkNumber, tax: editData.tax, totalDiscount: editData.totalDiscount,
        totalDeposit: editData.totalDeposit, otherFees: editData.otherFees,
        driverName: editData.driverName, salesRepName: editData.salesRepName, loadNumber: editData.loadNumber,
      });

      // Step 2 — bulk-push all matched items to catalog
      const matchedItems = editData.lineItems.filter(
        item => (item.mappingStatus === 'matched' || item.mappingStatus === 'manual')
          && (item.linkedProductId || item.posProductId)
      );

      if (matchedItems.length > 0) {
        const posResults = await Promise.allSettled(
          matchedItems.map(item =>
            updatePOSProductDetails(item.linkedProductId || item.posProductId, {
              description:  item.description,
              upc:          item.upc,
              pack:         item.packUnits,
              case_cost:    item.caseCost,
              cost:         item.unitCost,
              normal_price: item.suggestedRetailPrice,
              departmentId: item.departmentId,
              vendorId:     item.vendorId,
              cert_code:    item.cert_code || item.originalItemCode,
              fees:         item.feesId  || '',
              taxes:        item.taxesId || '',
              size:         item.containerSize || item.size || '',
            })
          )
        );

        const succeeded = posResults.filter(r => r.status === 'fulfilled').length;
        const failed    = posResults.filter(r => r.status === 'rejected').length;
        const isDevMode = posResults.some(r => r.status === 'fulfilled' && r.value?.data?.testingMode);
        const unmatched = editData.lineItems.length - matchedItems.length;

        if (isDevMode) {
          toast.info(`🔧 Dev mode: invoice synced · ${succeeded} POS updates simulated${unmatched > 0 ? ` · ${unmatched} unmatched skipped` : ''}`);
        } else if (failed > 0) {
          toast.warning(`⚠ Invoice synced · ${succeeded} products updated in POS · ${failed} failed${unmatched > 0 ? ` · ${unmatched} unmatched skipped` : ''}`);
        } else {
          toast.success(`✅ Invoice synced · ${succeeded} products updated${unmatched > 0 ? ` · ${unmatched} unmatched skipped` : ''}`);
        }
      } else {
        // No matched items — just confirm
        const unmatched = editData.lineItems.filter(it => it.mappingStatus === 'unmatched').length;
        toast.success(`✅ ${editData.vendorName || editData.fileName} synced${unmatched > 0 ? ` · ${unmatched} unmatched items skipped` : ''}`);
      }

      closeReview();
      loadInvoices();
    } catch (err) {
      toast.error('Sync failed: ' + (err.response?.data?.error || err.message));
    } finally {
      setIsConfirming(false);
    }
  };

  const handleUpdatePOS = async (posProductId, posFields) => {
    const res = await updatePOSProductDetails(posProductId, posFields);
    if (res.data?.testingMode) {
      toast.info('🔧 Dev mode: POS update simulated — no real change made');
    } else {
      toast.success('✅ Product updated in catalog');
    }
  };

  const handleCreatePOS = async (posFields) => {
    const res = await createPOSProduct(posFields);
    if (res.data?.testingMode) {
      toast.info('🔧 Dev mode: POS create simulated — no real product created');
      return null;
    }
    toast.success('✅ Product created in catalog');
    return res.data?.newProductId || null;
  };

  // Called from SearchModal "Create New" tab — creates product in POS and links it to the line item
  const handleCreateFromSearch = async (formData) => {
    try {
      const pack     = parseFloat(formData.pack)      || 1;
      const caseCost = parseFloat(formData.case_cost) || 0;
      const res = await createPOSProduct({
        description:  formData.description,
        upc:          formData.upc         || '',
        pack,
        case_cost:    caseCost,
        cost:         pack > 0 ? caseCost / pack : 0,
        normal_price: parseFloat(formData.normal_price) || 0,
        cert_code:    formData.cert_code   || '',
      });
      if (res.data?.testingMode) {
        toast.info('🔧 Dev mode: product creation simulated — no real change made');
        setSearchModal({ isOpen: false, itemIdx: null, query: '', results: [], isLoading: false, tab: 'search', itemData: null });
        return;
      }
      const newId = res.data?.newProductId || null;
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
      const { data } = await searchPOSProducts(query);
      setSearchModal(p => ({ ...p, results: data.products || [], isLoading: false }));
    } catch {
      setSearchModal(p => ({ ...p, isLoading: false }));
    }
  };

  const handleSelectProduct = (product) => {
    const { itemIdx } = searchModal;
    setEditData(prev => {
      const items = [...prev.lineItems];
      const item  = { ...items[itemIdx] };
      item.description          = product.name;
      item.upc                  = product.upc;
      item.suggestedRetailPrice = product.retailPrice;
      item.packUnits            = product.pack || 1;
      item.unitCost             = parseFloat(item.caseCost || item.netCost || 0) / (item.packUnits || 1);
      item.mappingStatus        = 'matched';
      item.confidence           = 'high';
      item.linkedProductId      = product.posProductId;
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
    <div className="layout-container">
      <Sidebar />
      <main className="main-content">
        <header style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h1 style={{ fontSize: '1.75rem', fontWeight: 700, marginBottom: '0.3rem' }}>Invoice Import</h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Drop files to instantly queue · AI extracts line items · Review and push to POS when ready</p>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              onClick={handleRefreshPOS}
              disabled={isRefreshingPOS}
              className="btn btn-secondary btn-sm"
              title="Clear cached POS products — forces a fresh fetch on next upload."
              style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem' }}
            >
              {isRefreshingPOS
                ? <><Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> Refreshing…</>
                : <><RefreshCw size={14} /> Refresh POS Data</>}
            </button>
            <button onClick={loadInvoices} className="btn btn-secondary btn-sm" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem' }}>
              <RotateCcw size={14} /> Refresh
            </button>
          </div>
        </header>

        <div {...getRootProps()} style={{ border: `2px dashed ${isDragActive ? 'var(--accent-primary)' : 'var(--border-color)'}`, borderRadius: '12px', padding: '2rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem', cursor: 'pointer', background: isDragActive ? 'rgba(99,102,241,0.06)' : 'var(--bg-secondary)', transition: 'all 0.2s ease', marginBottom: '2rem' }}>
          <input {...getInputProps()} />
          <div style={{ width: '56px', height: '56px', borderRadius: '50%', background: isDragActive ? 'rgba(99,102,241,0.2)' : 'rgba(99,102,241,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-primary)' }}>
            {isUploading ? <Loader size={26} style={{ animation: 'spin 1s linear infinite' }} /> : <UploadIcon size={26} />}
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontWeight: 600, marginBottom: '3px' }}>
              {isDragActive ? 'Drop to queue for AI processing' : isUploading ? 'Uploading…' : 'Drop invoices here or click to browse'}
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>PDF, PNG, JPG — instantly queued, AI processes in background</div>
          </div>
          {invoices.length > 0 && (
            <div style={{ display: 'flex', gap: '2rem', paddingTop: '1rem', borderTop: '1px solid var(--border-color)', width: '100%', justifyContent: 'center', flexWrap: 'wrap' }}>
              {stats.processing > 0 && <span style={{ fontSize: '0.8rem', color: '#818cf8', display: 'flex', alignItems: 'center', gap: '5px' }}><Loader size={13} style={{ animation: 'spin 1s linear infinite' }} /> {stats.processing} processing</span>}
              {stats.draft      > 0 && <span style={{ fontSize: '0.8rem', color: '#f59e0b' }}>📋 {stats.draft} ready to review</span>}
              {stats.synced     > 0 && <span style={{ fontSize: '0.8rem', color: '#10b981' }}>✅ {stats.synced} synced</span>}
              {stats.failed     > 0 && <span style={{ fontSize: '0.8rem', color: '#ef4444' }}>❌ {stats.failed} failed</span>}
            </div>
          )}
        </div>

        {invoices.length > 0 && (
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
            {[
              { key: 'all',        label: `All (${stats.all})` },
              { key: 'processing', label: `Processing (${stats.processing})` },
              { key: 'draft',      label: `Ready to Review (${stats.draft})` },
              { key: 'synced',     label: `Synced (${stats.synced})` },
              ...(stats.failed > 0 ? [{ key: 'failed', label: `Failed (${stats.failed})` }] : []),
            ].map(tab => (
              <button key={tab.key} onClick={() => setFilter(tab.key)} style={{ padding: '5px 14px', borderRadius: '999px', fontSize: '0.8rem', fontWeight: filter === tab.key ? 700 : 400, cursor: 'pointer', background: filter === tab.key ? 'var(--accent-primary)' : 'var(--bg-secondary)', color: filter === tab.key ? 'white' : 'var(--text-secondary)', border: `1px solid ${filter === tab.key ? 'var(--accent-primary)' : 'var(--border-color)'}`, transition: 'all 0.15s' }}>
                {tab.label}
              </button>
            ))}
          </div>
        )}

        {isLoading ? (
          <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-muted)' }}>
            <Loader size={28} style={{ animation: 'spin 1s linear infinite', marginBottom: '1rem' }} />
            <p>Loading invoices…</p>
          </div>
        ) : filteredInvoices.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '4rem 2rem', border: '1px solid var(--border-color)', borderRadius: '12px', background: 'var(--bg-secondary)', color: 'var(--text-muted)' }}>
            <FileText size={40} style={{ marginBottom: '1rem', opacity: 0.3 }} />
            <p style={{ fontWeight: 500 }}>{filter === 'all' ? 'No invoices yet — drop files above to get started' : `No ${filter} invoices`}</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {filteredInvoices.map(inv => (
              <InvoiceCard key={inv.id} inv={inv} selected={selectedId === inv.id} onOpen={openReview} onDelete={handleDelete} />
            ))}
          </div>
        )}
      </main>

      {selectedId && (
        <ReviewPanel
          invoice={selectedInvoice}
          editData={editData}
          isConfirming={isConfirming}
          isSavingDraft={isSavingDraft}
          onClose={closeReview}
          onConfirm={handleConfirm}
          onSaveDraft={handleSaveDraft}
          onHeaderChange={handleHeaderChange}
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
    </div>
  );
};

export default InvoiceImport;
