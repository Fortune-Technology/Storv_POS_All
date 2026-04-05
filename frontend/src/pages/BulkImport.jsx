/**
 * BulkImport.jsx  — Phase 3 (light-theme)
 * Three-step import wizard
 *   Step 1: Upload & Detect
 *   Step 2: Map Columns
 *   Step 3: Validate & Import
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  Upload, FileSpreadsheet, Download, CheckCircle, AlertCircle,
  AlertTriangle, ChevronRight, ChevronLeft, X, RefreshCw,
  Package, Layers, Truck, Tag, Droplets, FileText,
  Clipboard, Store, ArrowRight, RotateCcw, Check,
  Copy, ChevronDown, Hash,
} from 'lucide-react';
import { toast } from 'react-toastify';
import { useNavigate } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import { useStore } from '../contexts/StoreContext';
import { previewImport, commitImport, downloadImportTemplate, getImportHistory, getCatalogDepartments, getCatalogVendors } from '../services/api';

// ─── Constants ────────────────────────────────────────────────────────────────

const IMPORT_TYPES = [
  { id: 'products',      label: 'Products',            icon: Package,  color: '#3d56b5', desc: 'Add or update catalog products' },
  { id: 'departments',   label: 'Departments',         icon: Layers,   color: '#7c3aed', desc: 'Import department structure' },
  { id: 'vendors',       label: 'Vendors',             icon: Truck,    color: '#0891b2', desc: 'Suppliers & distributors' },
  { id: 'promotions',    label: 'Promotions',          icon: Tag,      color: '#d97706', desc: 'Deals, BOGO, mix & match' },
  { id: 'deposits',      label: 'Bottle Deposits',     icon: Droplets, color: '#059669', desc: 'CRV / bottle deposit rules' },
  { id: 'invoice_costs', label: 'Invoice Cost Update', icon: FileText, color: '#dc2626', desc: 'Update costs from vendor invoice' },
];

const DUPLICATE_STRATEGIES = [
  { id: 'overwrite', label: 'Overwrite',   desc: 'Update existing records' },
  { id: 'skip',      label: 'Skip',        desc: 'Keep existing unchanged' },
  { id: 'error',     label: 'Flag errors', desc: 'Treat duplicates as errors' },
];

const FIELD_LABELS = {
  upc: 'UPC / Barcode', plu: 'PLU', sku: 'SKU', itemCode: 'Item Code',
  name: 'Name', brand: 'Brand', description: 'Description',
  size: 'Size', sizeUnit: 'Size Unit', pack: 'Pack Size',
  casePacks: 'Case Packs', sellUnitSize: 'Sell Unit Size',
  departmentId: 'Department', vendorId: 'Vendor',
  defaultCostPrice: 'Cost Price', defaultRetailPrice: 'Retail Price', defaultCasePrice: 'Case Price',
  taxClass: 'Tax Class', ageRequired: 'Age Required', ebtEligible: 'EBT Eligible',
  discountEligible: 'Discount Eligible', taxable: 'Taxable', active: 'Active',
  reorderPoint: 'Reorder Point', reorderQty: 'Reorder Qty',
  id: 'ID (update)', code: 'Code', color: 'Color',
  sortOrder: 'Sort Order', showInPOS: 'Show in POS', bottleDeposit: 'Bottle Deposit',
  contactName: 'Contact Name', email: 'Email', phone: 'Phone',
  website: 'Website', terms: 'Payment Terms', accountNo: 'Account No',
  promoType: 'Promo Type', discountType: 'Discount Type', discountValue: 'Discount Value',
  minQty: 'Min Qty', buyQty: 'Buy Qty', getQty: 'Get Qty',
  productIds: 'Product UPCs', badgeLabel: 'Badge Label', startDate: 'Start Date', endDate: 'End Date',
  depositAmount: 'Deposit Amount', minVolumeOz: 'Min Volume (oz)',
  maxVolumeOz: 'Max Volume (oz)', containerTypes: 'Container Types', state: 'State',
  receivedQty: 'Received Qty',
};

const TYPE_FIELDS = {
  products:      ['upc','name','brand','size','sizeUnit','pack','departmentId','vendorId','defaultCostPrice','defaultRetailPrice','defaultCasePrice','taxClass','ebtEligible','ageRequired','discountEligible','active','sku','itemCode','reorderPoint','reorderQty'],
  departments:   ['id','name','code','description','taxClass','ebtEligible','ageRequired','bottleDeposit','sortOrder','color','showInPOS','active'],
  vendors:       ['id','name','code','contactName','email','phone','website','terms','accountNo','active'],
  promotions:    ['name','promoType','discountType','discountValue','minQty','buyQty','getQty','productIds','departmentId','badgeLabel','startDate','endDate','active'],
  deposits:      ['name','depositAmount','minVolumeOz','maxVolumeOz','containerTypes','state','active'],
  invoice_costs: ['upc','defaultCostPrice','defaultCasePrice','receivedQty','vendorId'],
};

const REQUIRED_FIELDS = {
  products:      ['upc','name'],
  departments:   ['name'],
  vendors:       ['name'],
  promotions:    ['name','promoType'],
  deposits:      ['name','depositAmount'],
  invoice_costs: ['upc','defaultCostPrice'],
};

// ─── Light-theme design tokens ────────────────────────────────────────────────

const T = {
  // Surfaces
  bgPage:    '#f8fafc',
  bgCard:    '#ffffff',
  bgSubtle:  '#f8fafc',
  bgInput:   '#f8fafc',

  // Borders
  border:    'rgba(0,0,0,0.08)',
  borderFocus: '#3d56b5',

  // Text
  textPrimary:   '#0f172a',
  textSecondary: '#334155',
  textMuted:     '#64748b',
  textPlaceholder: '#94a3b8',

  // Brand
  blue:   '#3d56b5',
  blueBg: 'rgba(61,86,181,0.08)',
  blueBorder: 'rgba(61,86,181,0.2)',

  // Status
  green:      '#059669',
  greenBg:    'rgba(5,150,105,0.08)',
  greenBorder:'rgba(5,150,105,0.2)',
  amber:      '#d97706',
  amberBg:    'rgba(217,119,6,0.08)',
  amberBorder:'rgba(217,119,6,0.2)',
  red:        '#dc2626',
  redBg:      'rgba(220,38,38,0.08)',
  redBorder:  'rgba(220,38,38,0.2)',

  // Shadows
  shadow:   '0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)',
  shadowMd: '0 4px 12px rgba(0,0,0,0.08)',
};

// ─── Base style objects ───────────────────────────────────────────────────────

const card = {
  background: T.bgCard,
  border: `1px solid ${T.border}`,
  borderRadius: 12,
  boxShadow: T.shadow,
};

const inputStyle = {
  width: '100%',
  padding: '0.55rem 0.85rem',
  background: T.bgInput,
  border: `1px solid ${T.border}`,
  borderRadius: 8,
  color: T.textPrimary,
  fontSize: '0.84rem',
  outline: 'none',
  transition: 'border-color .15s, box-shadow .15s',
};

const label = {
  display: 'block',
  fontSize: '0.68rem',
  fontWeight: 800,
  color: T.textMuted,
  letterSpacing: '0.07em',
  textTransform: 'uppercase',
  marginBottom: 8,
};

const btn = (variant = 'primary') => ({
  display: 'inline-flex', alignItems: 'center', gap: 7,
  padding: '0.55rem 1.1rem', borderRadius: 8, border: 'none',
  fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer',
  transition: 'all .15s',
  ...(variant === 'primary' && {
    background: T.blue, color: '#fff',
    boxShadow: '0 2px 8px rgba(61,86,181,0.25)',
  }),
  ...(variant === 'ghost' && {
    background: 'transparent', color: T.textSecondary,
    border: `1px solid ${T.border}`,
  }),
  ...(variant === 'danger' && {
    background: T.redBg, color: T.red, border: `1px solid ${T.redBorder}`,
  }),
});

const badge = (color, bg, border) => ({
  display: 'inline-flex', alignItems: 'center', gap: 4,
  fontSize: '0.65rem', fontWeight: 700,
  color, background: bg, border: `1px solid ${border}`,
  padding: '2px 8px', borderRadius: 20,
});

// ─── ID Reference Panel ───────────────────────────────────────────────────────

function IdReferencePanel() {
  const [open,    setOpen]    = useState(false);
  const [tab,     setTab]     = useState('departments'); // 'departments' | 'vendors'
  const [depts,   setDepts]   = useState([]);
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search,  setSearch]  = useState('');
  const [copied,  setCopied]  = useState(null);

  const load = async () => {
    if (depts.length || vendors.length) return; // already loaded
    setLoading(true);
    try {
      const [d, v] = await Promise.all([
        getCatalogDepartments({ limit: 200 }),
        getCatalogVendors({ limit: 200 }),
      ]);
      setDepts(Array.isArray(d) ? d : d?.departments || d?.data || []);
      setVendors(Array.isArray(v) ? v : v?.vendors || v?.data || []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  const handleToggle = () => {
    const next = !open;
    setOpen(next);
    if (next) load();
  };

  const copyId = (id, label) => {
    navigator.clipboard.writeText(String(id));
    setCopied(id);
    toast.success(`${label} ID ${id} copied`, { autoClose: 1200 });
    setTimeout(() => setCopied(null), 1500);
  };

  const rows = tab === 'departments'
    ? depts.filter(d => !search || d.name?.toLowerCase().includes(search.toLowerCase()) || String(d.id).includes(search))
    : vendors.filter(v => !search || v.name?.toLowerCase().includes(search.toLowerCase()) || String(v.id).includes(search));

  const accentColor = tab === 'departments' ? '#7c3aed' : '#3d56b5';
  const accentBg    = tab === 'departments' ? 'rgba(124,58,237,0.1)' : 'rgba(61,86,181,0.1)';
  const accentBord  = tab === 'departments' ? 'rgba(124,58,237,0.22)' : 'rgba(61,86,181,0.22)';

  return (
    <div style={{ ...card, overflow: 'hidden', marginBottom: 4 }}>
      {/* Toggle header */}
      <button
        onClick={handleToggle}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '0.85rem 1.1rem', textAlign: 'left' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <div style={{ width: 28, height: 28, borderRadius: 7, background: T.blueBg, border: `1px solid ${T.blueBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Hash size={13} color={T.blue} />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.85rem', color: T.textPrimary }}>ID Reference</div>
            <div style={{ fontSize: '0.72rem', color: T.textMuted }}>Look up Department & Vendor IDs for your import file</div>
          </div>
        </div>
        <ChevronDown size={15} color={T.textMuted} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s', flexShrink: 0 }} />
      </button>

      {open && (
        <div style={{ borderTop: `1px solid ${T.border}` }}>
          {/* Tab + search bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0.75rem 1.1rem', borderBottom: `1px solid ${T.border}`, background: T.bgSubtle }}>
            <div style={{ display: 'flex', background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 8, overflow: 'hidden', flexShrink: 0 }}>
              {[['departments', 'Departments', '#7c3aed'], ['vendors', 'Vendors', '#3d56b5']].map(([id, lbl, col]) => (
                <button
                  key={id}
                  onClick={() => { setTab(id); setSearch(''); }}
                  style={{ padding: '5px 14px', border: 'none', cursor: 'pointer', fontSize: '0.76rem', fontWeight: 700, background: tab === id ? col : 'transparent', color: tab === id ? '#fff' : T.textMuted, transition: 'all .15s' }}
                >
                  {lbl}
                </button>
              ))}
            </div>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={`Search ${tab}…`}
              style={{ ...inputStyle, flex: 1, padding: '5px 10px', fontSize: '0.8rem' }}
            />
            {rows.length > 0 && (
              <span style={{ fontSize: '0.7rem', color: T.textMuted, whiteSpace: 'nowrap' }}>{rows.length} results</span>
            )}
          </div>

          {/* ID list */}
          <div style={{ maxHeight: 240, overflowY: 'auto' }}>
            {loading ? (
              <div style={{ padding: '1.5rem', textAlign: 'center', color: T.textMuted, fontSize: '0.8rem' }}>
                <RefreshCw size={14} style={{ animation: 'spin 1s linear infinite', marginRight: 6 }} />Loading…
              </div>
            ) : rows.length === 0 ? (
              <div style={{ padding: '1.5rem', textAlign: 'center', color: T.textMuted, fontSize: '0.8rem' }}>No results</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                <thead>
                  <tr style={{ background: T.bgSubtle }}>
                    <th style={{ padding: '6px 14px', textAlign: 'left', fontWeight: 700, fontSize: '0.65rem', letterSpacing: '0.06em', color: T.textMuted, borderBottom: `1px solid ${T.border}`, width: 70 }}>ID</th>
                    <th style={{ padding: '6px 14px', textAlign: 'left', fontWeight: 700, fontSize: '0.65rem', letterSpacing: '0.06em', color: T.textMuted, borderBottom: `1px solid ${T.border}` }}>NAME</th>
                    {tab === 'departments' && <th style={{ padding: '6px 14px', textAlign: 'left', fontWeight: 700, fontSize: '0.65rem', letterSpacing: '0.06em', color: T.textMuted, borderBottom: `1px solid ${T.border}` }}>CODE</th>}
                    {tab === 'vendors'     && <th style={{ padding: '6px 14px', textAlign: 'left', fontWeight: 700, fontSize: '0.65rem', letterSpacing: '0.06em', color: T.textMuted, borderBottom: `1px solid ${T.border}` }}>CODE</th>}
                    <th style={{ padding: '6px 14px', textAlign: 'center', fontWeight: 700, fontSize: '0.65rem', letterSpacing: '0.06em', color: T.textMuted, borderBottom: `1px solid ${T.border}`, width: 60 }}>COPY</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, idx) => {
                    const isCopied = copied === row.id;
                    return (
                      <tr
                        key={row.id}
                        style={{ borderBottom: `1px solid ${T.border}`, background: idx % 2 === 0 ? T.bgCard : T.bgSubtle, cursor: 'pointer', transition: 'background .1s' }}
                        onClick={() => copyId(row.id, tab === 'departments' ? 'Dept' : 'Vendor')}
                        onMouseEnter={e => e.currentTarget.style.background = accentBg}
                        onMouseLeave={e => e.currentTarget.style.background = idx % 2 === 0 ? T.bgCard : T.bgSubtle}
                        title="Click to copy ID"
                      >
                        <td style={{ padding: '7px 14px' }}>
                          <span style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: '0.78rem', color: accentColor, background: accentBg, border: `1px solid ${accentBord}`, padding: '2px 7px', borderRadius: 4 }}>
                            {row.id}
                          </span>
                        </td>
                        <td style={{ padding: '7px 14px', color: T.textPrimary, fontWeight: 500 }}>{row.name}</td>
                        <td style={{ padding: '7px 14px', color: T.textMuted, fontFamily: 'monospace', fontSize: '0.75rem' }}>{row.code || '—'}</td>
                        <td style={{ padding: '7px 14px', textAlign: 'center' }}>
                          {isCopied
                            ? <Check size={14} color={T.green} strokeWidth={3} />
                            : <Copy size={13} color={T.textMuted} />
                          }
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Footer hint */}
          <div style={{ padding: '0.6rem 1.1rem', borderTop: `1px solid ${T.border}`, background: T.bgSubtle, fontSize: '0.7rem', color: T.textMuted }}>
            Click any row to copy its ID · Use these IDs in the <strong>departmentId</strong> or <strong>vendorId</strong> columns of your import file
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Step Bar ─────────────────────────────────────────────────────────────────

function StepBar({ step }) {
  const steps = ['Upload & Detect', 'Map Columns', 'Validate & Import'];
  return (
    <div style={{ display: 'flex', alignItems: 'center', margin: '0 0 1.75rem' }}>
      {steps.map((lbl, i) => {
        const num    = i + 1;
        const done   = step > num;
        const active = step === num;
        return (
          <React.Fragment key={num}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.72rem', fontWeight: 800,
                background: done ? T.green : active ? T.blue : T.bgSubtle,
                color: (done || active) ? '#fff' : T.textMuted,
                border: `2px solid ${done ? T.green : active ? T.blue : T.border}`,
                boxShadow: active ? `0 0 0 3px ${T.blueBg}` : 'none',
                transition: 'all .2s',
              }}>
                {done ? <Check size={12} strokeWidth={3} /> : num}
              </div>
              <span style={{
                fontSize: '0.8rem', fontWeight: active ? 700 : 500,
                color: active ? T.textPrimary : done ? T.green : T.textMuted,
                whiteSpace: 'nowrap',
              }}>{lbl}</span>
            </div>
            {i < steps.length - 1 && (
              <div style={{
                flex: 1, height: 2, margin: '0 12px', minWidth: 24,
                background: done ? T.green : T.border, borderRadius: 2, transition: 'background .3s',
              }} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ─── Drop Zone ────────────────────────────────────────────────────────────────

function DropZone({ file, onFile, onClear }) {
  const [dragging, setDragging] = useState(false);
  const [pasting,  setPasting]  = useState(false);
  const inputRef = useRef(null);

  const handleDrop = useCallback((e) => {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files[0]; if (f) onFile(f);
  }, [onFile]);

  const handlePaste = async () => {
    try {
      setPasting(true);
      const text = await navigator.clipboard.readText();
      if (!text?.trim()) { toast.error('Clipboard is empty'); return; }
      const blob = new Blob([text], { type: 'text/csv' });
      onFile(new File([blob], 'clipboard_paste.csv', { type: 'text/csv' }));
    } catch { toast.error('Clipboard access denied — use the file picker instead'); }
    finally { setPasting(false); }
  };

  if (file) {
    return (
      <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 12, padding: '0.9rem 1.1rem' }}>
        <div style={{ width: 38, height: 38, borderRadius: 10, background: T.blueBg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <FileSpreadsheet size={18} color={T.blue} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: '0.88rem', color: T.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</div>
          <div style={{ fontSize: '0.72rem', color: T.textMuted, marginTop: 2 }}>{(file.size / 1024).toFixed(1)} KB</div>
        </div>
        <button onClick={onClear} style={{ ...btn('ghost'), padding: '5px 9px' }}><X size={13} /></button>
      </div>
    );
  }

  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      style={{
        ...card,
        border: `2px dashed ${dragging ? T.blue : T.border}`,
        background: dragging ? T.blueBg : T.bgCard,
        cursor: 'pointer', textAlign: 'center',
        padding: '2.5rem 1.5rem', transition: 'all .15s',
        boxShadow: 'none',
      }}
    >
      <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls,.tsv,.txt" onChange={e => { if (e.target.files[0]) onFile(e.target.files[0]); }} style={{ display: 'none' }} />
      <div style={{ width: 52, height: 52, borderRadius: 14, background: T.blueBg, border: `1px solid ${T.blueBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
        <Upload size={22} color={T.blue} />
      </div>
      <div style={{ fontWeight: 700, fontSize: '0.95rem', color: T.textPrimary, marginBottom: 4 }}>Drop your file here</div>
      <div style={{ fontSize: '0.8rem', color: T.textMuted, marginBottom: 16 }}>CSV, Excel (.xlsx / .xls), TSV, TXT tab-delimited</div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 12 }}>
        <div style={{ height: 1, width: 40, background: T.border }} />
        <span style={{ fontSize: '0.68rem', color: T.textPlaceholder, fontWeight: 600 }}>OR</span>
        <div style={{ height: 1, width: 40, background: T.border }} />
      </div>
      <button
        onClick={e => { e.stopPropagation(); handlePaste(); }}
        disabled={pasting}
        style={{ ...btn('ghost'), fontSize: '0.76rem', padding: '0.45rem 1rem' }}
      >
        <Clipboard size={12} /> {pasting ? 'Reading…' : 'Paste from clipboard'}
      </button>
      <div style={{ marginTop: 14, fontSize: '0.7rem', color: T.textPlaceholder }}>Max 50,000 rows · 10 MB</div>
    </div>
  );
}

// ─── Mapping Table ────────────────────────────────────────────────────────────

function MappingTable({ importType, allHeaders, mapping, autoDetected, onChange, sampleRows }) {
  const [showPreview, setShowPreview] = useState(false);
  const fields    = TYPE_FIELDS[importType] || [];
  const required  = REQUIRED_FIELDS[importType] || [];

  // reverseMap: csvHeader → schemaField
  const reverseMap = {};
  Object.entries(mapping).forEach(([f, h]) => { reverseMap[h] = f; });

  const mappedCount = Object.keys(mapping).length;

  const handleHeaderChange = (csvHeader, schemaField) => {
    const m = { ...mapping };
    Object.keys(m).forEach(f => { if (m[f] === csvHeader) delete m[f]; });
    if (schemaField && m[schemaField]) delete m[schemaField];
    if (schemaField) m[schemaField] = csvHeader;
    onChange(m);
  };

  return (
    <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '0.9rem 1.1rem', borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, background: T.bgSubtle }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: '0.9rem', color: T.textPrimary }}>Column Mapping</div>
          <div style={{ fontSize: '0.73rem', color: T.textMuted, marginTop: 1 }}>Match your file's headers to import fields</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={badge(T.green, T.greenBg, T.greenBorder)}>
            <Check size={9} strokeWidth={3} /> Auto-detected {mappedCount}/{allHeaders.length}
          </span>
          {sampleRows?.length > 0 && (
            <button onClick={() => setShowPreview(v => !v)} style={{ ...btn('ghost'), padding: '4px 10px', fontSize: '0.72rem' }}>
              {showPreview ? 'Hide' : `Preview ${Math.min(sampleRows.length, 5)} rows`}
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div style={{ overflowY: 'auto', maxHeight: 380 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
          <thead>
            <tr style={{ background: T.bgSubtle }}>
              {['YOUR COLUMN', 'MAPS TO FIELD', 'STATUS'].map(h => (
                <th key={h} style={{ padding: '8px 14px', textAlign: 'left', color: T.textMuted, fontWeight: 700, fontSize: '0.65rem', letterSpacing: '0.07em', borderBottom: `1px solid ${T.border}`, whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {allHeaders.map((header, idx) => {
              const mapped  = reverseMap[header];
              const isReq   = mapped && required.includes(mapped);
              const wasAuto = autoDetected?.[header];
              return (
                <tr key={header} style={{ borderBottom: `1px solid ${T.border}`, background: idx % 2 === 0 ? T.bgCard : T.bgSubtle }}>
                  <td style={{ padding: '8px 14px', maxWidth: 200 }}>
                    <span style={{ fontWeight: 600, color: T.textPrimary, fontSize: '0.82rem' }}>&ldquo;{header}&rdquo;</span>
                  </td>
                  <td style={{ padding: '8px 14px' }}>
                    <select
                      value={mapped || ''}
                      onChange={e => handleHeaderChange(header, e.target.value)}
                      style={{
                        ...inputStyle,
                        padding: '5px 8px',
                        borderColor: mapped ? T.blueBorder : T.border,
                        background: mapped ? T.blueBg : T.bgInput,
                        width: 'auto', minWidth: 170, maxWidth: 240,
                        cursor: 'pointer',
                      }}
                    >
                      <option value="">— Skip —</option>
                      {fields.map(f => (
                        <option key={f} value={f}>{FIELD_LABELS[f] || f}{required.includes(f) ? ' *' : ''}</option>
                      ))}
                    </select>
                  </td>
                  <td style={{ padding: '8px 14px', whiteSpace: 'nowrap' }}>
                    {mapped
                      ? wasAuto
                        ? <span style={badge(T.green, T.greenBg, T.greenBorder)}><Check size={9} strokeWidth={3} /> auto</span>
                        : <span style={badge(T.blue, T.blueBg, T.blueBorder)}><Check size={9} strokeWidth={3} /> mapped</span>
                      : <span style={{ fontSize: '0.72rem', color: T.textPlaceholder }}>not mapped</span>
                    }
                    {isReq && <span style={{ marginLeft: 5, fontSize: '0.62rem', fontWeight: 800, color: T.red }}>REQ</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Preview rows */}
      {showPreview && sampleRows?.length > 0 && (
        <div style={{ borderTop: `1px solid ${T.border}`, overflowX: 'auto' }}>
          <div style={{ padding: '8px 14px', fontSize: '0.65rem', fontWeight: 800, color: T.textMuted, letterSpacing: '0.07em', background: T.bgSubtle, borderBottom: `1px solid ${T.border}` }}>
            FIRST {Math.min(sampleRows.length, 5)} ROWS
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.76rem' }}>
            <thead>
              <tr style={{ background: T.bgSubtle }}>
                {Object.keys(sampleRows[0]).slice(0, 7).map(k => (
                  <th key={k} style={{ padding: '6px 12px', textAlign: 'left', color: T.textMuted, fontWeight: 700, borderBottom: `1px solid ${T.border}`, whiteSpace: 'nowrap' }}>
                    {FIELD_LABELS[k] || k}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sampleRows.slice(0, 5).map((row, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${T.border}`, background: i % 2 === 0 ? T.bgCard : T.bgSubtle }}>
                  {Object.values(row).slice(0, 7).map((val, j) => (
                    <td key={j} style={{ padding: '6px 12px', color: T.textSecondary, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {val === null || val === undefined ? <span style={{ color: T.textPlaceholder }}>—</span> : String(val)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Validate & Import panel (Step 3) ────────────────────────────────────────

function ValidateAndImport({ preview, onImport, committing, progress, result, onReset, onViewCatalog, onDownloadErrors }) {
  const { validCount = 0, invalidCount = 0, warningCount = 0, errors = [], warnings = [] } = preview || {};

  if (result) {
    const allOk = result.failed === 0;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Banner */}
        <div style={{ ...card, background: allOk ? T.greenBg : T.amberBg, borderColor: allOk ? T.greenBorder : T.amberBorder, display: 'flex', alignItems: 'center', gap: 14, padding: '1.1rem 1.25rem' }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: T.shadow }}>
            {allOk ? <CheckCircle size={22} color={T.green} /> : <AlertTriangle size={22} color={T.amber} />}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: '1rem', color: T.textPrimary, marginBottom: 4 }}>
              {allOk ? 'Import Complete' : 'Import Complete with Issues'}
            </div>
            <div style={{ fontSize: '0.82rem', color: T.textSecondary, fontFamily: 'monospace' }}>
              <span style={{ color: T.green, fontWeight: 700 }}>{result.created || 0} created</span>
              {' · '}
              <span style={{ color: T.blue, fontWeight: 700 }}>{result.updated || 0} updated</span>
              {' · '}
              <span>{result.skipped || 0} skipped</span>
              {result.failed > 0 && <>{' · '}<span style={{ color: T.red, fontWeight: 700 }}>{result.failed} failed</span></>}
            </div>
          </div>
        </div>

        {/* Stat grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10 }}>
          {[
            { label: 'Created',  val: result.created || 0,  color: T.green },
            { label: 'Updated',  val: result.updated || 0,  color: T.blue },
            { label: 'Skipped',  val: result.skipped || 0,  color: T.textMuted },
            { label: 'Failed',   val: result.failed  || 0,  color: result.failed > 0 ? T.red : T.textMuted },
          ].map(({ label: lbl, val, color }) => (
            <div key={lbl} style={{ ...card, textAlign: 'center', padding: '1rem 0.5rem' }}>
              <div style={{ fontSize: '1.75rem', fontWeight: 900, color, lineHeight: 1 }}>{val}</div>
              <div style={{ fontSize: '0.7rem', color: T.textMuted, marginTop: 6, fontWeight: 600 }}>{lbl}</div>
            </div>
          ))}
        </div>

        {/* Failed detail */}
        {result.errors?.filter(e => e.type === 'error').length > 0 && (
          <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '0.75rem 1rem', borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', gap: 6, background: T.redBg }}>
              <AlertCircle size={13} color={T.red} />
              <span style={{ fontSize: '0.7rem', fontWeight: 800, color: T.red, letterSpacing: '0.05em' }}>FAILED ROWS</span>
            </div>
            <div style={{ overflowY: 'auto', maxHeight: 180 }}>
              {result.errors.filter(e => e.type === 'error').slice(0, 30).map((e, i) => (
                <div key={i} style={{ padding: '7px 14px', borderBottom: `1px solid ${T.border}`, fontSize: '0.78rem', display: 'flex', gap: 10 }}>
                  <span style={{ color: T.textMuted, flexShrink: 0, fontFamily: 'monospace' }}>Row {e.row}</span>
                  <span style={{ color: T.red }}>{e.message || e.errors?.map(x => x.message).join(', ')}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 10, paddingTop: 4 }}>
          <button onClick={onReset} style={btn('ghost')}><RotateCcw size={13} /> Import Another</button>
          {onViewCatalog && <button onClick={onViewCatalog} style={btn('primary')}>View Catalog <ArrowRight size={13} /></button>}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
        {[
          { label: 'Rows ready',  count: validCount,   color: T.green, bg: T.greenBg, border: T.greenBorder, icon: <CheckCircle size={20} color={T.green} /> },
          { label: 'Warnings',    count: warningCount, color: T.amber, bg: T.amberBg, border: T.amberBorder, icon: <AlertTriangle size={20} color={T.amber} /> },
          { label: 'Errors',      count: invalidCount, color: T.red,   bg: T.redBg,   border: T.redBorder,   icon: <AlertCircle size={20} color={T.red} /> },
        ].map(({ label: lbl, count, color, bg, border, icon }) => (
          <div key={lbl} style={{ ...card, background: bg, borderColor: border, display: 'flex', alignItems: 'center', gap: 14, padding: '1rem 1.1rem' }}>
            <div style={{ width: 42, height: 42, borderRadius: 10, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: T.shadow }}>
              {icon}
            </div>
            <div>
              <div style={{ fontSize: '1.75rem', fontWeight: 900, color, lineHeight: 1 }}>{count.toLocaleString()}</div>
              <div style={{ fontSize: '0.72rem', color, marginTop: 3, fontWeight: 600 }}>{lbl}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Error list */}
      {errors.length > 0 && (
        <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '0.8rem 1rem', borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: T.redBg }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <AlertCircle size={13} color={T.red} />
              <span style={{ fontSize: '0.7rem', fontWeight: 800, color: T.red, letterSpacing: '0.05em' }}>ERRORS — first {Math.min(errors.length, 50)}</span>
            </div>
            {onDownloadErrors && (
              <button onClick={onDownloadErrors} style={{ ...btn('ghost'), padding: '3px 9px', fontSize: '0.7rem' }}>
                <Download size={11} /> Download Error Report
              </button>
            )}
          </div>
          <div style={{ overflowY: 'auto', maxHeight: 200 }}>
            {errors.slice(0, 50).map((e, i) => (
              <div key={i} style={{ padding: '8px 14px', borderBottom: `1px solid ${T.border}`, display: 'flex', gap: 12, fontSize: '0.78rem', background: i % 2 === 0 ? T.bgCard : T.bgSubtle }}>
                <span style={{ color: T.textMuted, flexShrink: 0, fontFamily: 'monospace', fontSize: '0.73rem' }}>Row {e.row}</span>
                <div style={{ flex: 1 }}>
                  {e.errors?.map((err, j) => (
                    <div key={j} style={{ color: T.red }}>
                      <span style={{ fontWeight: 600 }}>{FIELD_LABELS[err.field] || err.field}: </span>{err.message}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Warning list */}
      {warnings.length > 0 && (
        <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '0.8rem 1rem', borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', gap: 6, background: T.amberBg }}>
            <AlertTriangle size={13} color={T.amber} />
            <span style={{ fontSize: '0.7rem', fontWeight: 800, color: T.amber, letterSpacing: '0.05em' }}>WARNINGS — first {Math.min(warnings.length, 20)}</span>
          </div>
          <div style={{ overflowY: 'auto', maxHeight: 160 }}>
            {warnings.slice(0, 20).map((w, i) => (
              <div key={i} style={{ padding: '8px 14px', borderBottom: `1px solid ${T.border}`, display: 'flex', gap: 12, fontSize: '0.78rem', background: i % 2 === 0 ? T.bgCard : T.bgSubtle }}>
                <span style={{ color: T.textMuted, flexShrink: 0, fontFamily: 'monospace', fontSize: '0.73rem' }}>Row {w.row}</span>
                <div style={{ flex: 1 }}>
                  {w.warnings?.map((wr, j) => (
                    <div key={j} style={{ color: T.amber }}>
                      <span style={{ fontWeight: 600 }}>{FIELD_LABELS[wr.field] || wr.field}: </span>{wr.message}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Progress bar */}
      {committing && (
        <div style={{ ...card, padding: '1rem 1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: T.textSecondary, marginBottom: 8 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 600 }}>
              <RefreshCw size={13} color={T.blue} style={{ animation: 'spin 1s linear infinite' }} />
              Importing…
            </span>
            <span style={{ fontFamily: 'monospace', fontWeight: 700, color: T.blue }}>{Math.round(progress)}%</span>
          </div>
          <div style={{ height: 8, background: T.bgSubtle, border: `1px solid ${T.border}`, borderRadius: 99, overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 99,
              background: `linear-gradient(90deg, ${T.blue}, #7b95e0)`,
              width: `${progress}%`, transition: 'width 0.4s ease',
            }} />
          </div>
        </div>
      )}

      {/* Import CTA */}
      {!committing && (
        <div style={{ ...card, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 1.25rem', background: validCount > 0 ? T.blueBg : T.bgSubtle, borderColor: validCount > 0 ? T.blueBorder : T.border }}>
          <div style={{ fontSize: '0.84rem', color: T.textSecondary }}>
            {validCount === 0
              ? <span style={{ color: T.red, fontWeight: 600 }}>No valid rows — fix errors in mapping</span>
              : <><span style={{ color: T.green, fontWeight: 700 }}>{validCount.toLocaleString()} rows</span> ready to import{invalidCount > 0 && <span style={{ color: T.red }}> · {invalidCount} will be skipped</span>}</>
            }
          </div>
          <button
            onClick={onImport}
            disabled={validCount === 0}
            style={{ ...btn('primary'), opacity: validCount === 0 ? 0.4 : 1, fontSize: '0.88rem', padding: '0.65rem 1.4rem' }}
          >
            <CheckCircle size={15} /> Import {validCount.toLocaleString()} rows →
          </button>
        </div>
      )}
    </div>
  );
}

// ─── History Table ────────────────────────────────────────────────────────────

function HistoryTable({ jobs }) {
  if (!jobs?.length) return null;
  const fmt = d => d ? new Date(d).toLocaleString() : '—';
  const STATUS = {
    done:      { color: T.green,   bg: T.greenBg },
    failed:    { color: T.red,     bg: T.redBg },
    importing: { color: T.blue,    bg: T.blueBg },
    pending:   { color: T.amber,   bg: T.amberBg },
  };
  return (
    <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '0.875rem 1.125rem', borderBottom: `1px solid ${T.border}`, background: T.bgSubtle }}>
        <span style={{ fontSize: '0.7rem', fontWeight: 800, color: T.textMuted, letterSpacing: '0.07em' }}>RECENT IMPORTS</span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
          <thead>
            <tr style={{ background: T.bgSubtle }}>
              {['File', 'Type', 'Total', '✓ Success', '✗ Failed', 'Skipped', 'Status', 'Date'].map(h => (
                <th key={h} style={{ padding: '8px 14px', textAlign: 'left', color: T.textMuted, fontWeight: 700, fontSize: '0.67rem', letterSpacing: '0.05em', borderBottom: `1px solid ${T.border}`, whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {jobs.map((j, idx) => {
              const s = STATUS[j.status] || { color: T.textMuted, bg: T.bgSubtle };
              return (
                <tr key={j.id} style={{ borderBottom: `1px solid ${T.border}`, background: idx % 2 === 0 ? T.bgCard : T.bgSubtle }}>
                  <td style={{ padding: '8px 14px', color: T.textPrimary, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>{j.fileName}</td>
                  <td style={{ padding: '8px 14px', color: T.textMuted, whiteSpace: 'nowrap' }}>{j.type}</td>
                  <td style={{ padding: '8px 14px', color: T.textSecondary, textAlign: 'right' }}>{j.totalRows}</td>
                  <td style={{ padding: '8px 14px', color: T.green, fontWeight: 700, textAlign: 'right' }}>{j.successRows}</td>
                  <td style={{ padding: '8px 14px', color: j.failedRows > 0 ? T.red : T.textMuted, fontWeight: j.failedRows > 0 ? 700 : 400, textAlign: 'right' }}>{j.failedRows}</td>
                  <td style={{ padding: '8px 14px', color: T.textMuted, textAlign: 'right' }}>{j.skippedRows}</td>
                  <td style={{ padding: '8px 14px' }}>
                    <span style={{ fontSize: '0.68rem', fontWeight: 700, color: s.color, background: s.bg, padding: '3px 8px', borderRadius: 20 }}>{j.status}</span>
                  </td>
                  <td style={{ padding: '8px 14px', color: T.textMuted, whiteSpace: 'nowrap', fontSize: '0.73rem' }}>{fmt(j.createdAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BulkImport() {
  const navigate = useNavigate();
  const { stores, activeStore } = useStore();

  const [step,                  setStep]                  = useState(1);
  const [importType,            setImportType]            = useState('products');
  const [storeScope,            setStoreScope]            = useState('active');
  const [file,                  setFile]                  = useState(null);
  const [duplicateStrategy,     setDuplicateStrategy]     = useState('overwrite');
  const [unknownDeptStrategy,   setUnknownDeptStrategy]   = useState('skip');
  const [unknownVendorStrategy, setUnknownVendorStrategy] = useState('skip');
  const [preview,           setPreview]           = useState(null);
  const [mapping,           setMapping]           = useState({});
  const [autoDetected,      setAutoDetected]      = useState({});
  const [allHeaders,        setAllHeaders]        = useState([]);
  const [loading,           setLoading]           = useState(false);
  const [committing,        setCommitting]        = useState(false);
  const [progress,          setProgress]          = useState(0);
  const [result,            setResult]            = useState(null);
  const [history,           setHistory]           = useState([]);
  const [historyLoaded,     setHistoryLoaded]     = useState(false);

  const progressRef = useRef(null);
  const typeInfo    = IMPORT_TYPES.find(t => t.id === importType) || IMPORT_TYPES[0];

  useEffect(() => {
    getImportHistory({ limit: 10 })
      .then(d => { setHistory(d?.jobs || []); setHistoryLoaded(true); })
      .catch(() => setHistoryLoaded(true));
  }, []);

  // Progress animation
  const startProgress = () => {
    setProgress(0);
    let cur = 0;
    progressRef.current = setInterval(() => {
      const step = cur < 40 ? 4 : cur < 70 ? 2 : cur < 88 ? 0.5 : 0;
      cur = Math.min(cur + step, 89);
      setProgress(cur);
    }, 120);
  };
  const finishProgress = () => {
    if (progressRef.current) clearInterval(progressRef.current);
    setProgress(100);
  };

  // Template download
  const handleDownloadTemplate = async () => {
    try {
      const blob = await downloadImportTemplate(importType);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url;
      a.download = `storevue_template_${importType}.csv`; a.click();
      URL.revokeObjectURL(url);
    } catch { toast.error('Failed to download template'); }
  };

  // Error report download
  const handleDownloadErrors = () => {
    if (!preview?.errors?.length) return;
    const rows = preview.errors.map(e => `${e.row},"${(e.errors || []).map(x => `${x.field || ''}: ${(x.message || '').replace(/"/g, "'")}`).join('; ')}"`);
    const csv  = ['Row,Errors', ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a'); a.href = url;
    a.download = `import_errors_${importType}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  // Preview API call
  const runPreview = async (f, type, strategy, currentMapping) => {
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append('file', f); fd.append('type', type); fd.append('duplicateStrategy', strategy);
      fd.append('unknownDeptStrategy',   unknownDeptStrategy);
      fd.append('unknownVendorStrategy', unknownVendorStrategy);
      if (currentMapping && Object.keys(currentMapping).length) fd.append('mapping', JSON.stringify(currentMapping));
      const data = await previewImport(fd);
      setPreview(data);
      const applied = data.appliedMapping || data.detectedMapping || {};
      setMapping(applied);
      const headers = [...new Set([...Object.values(applied), ...(data.unmappedHeaders || [])])];
      setAllHeaders(headers);
      const detected = data.detectedMapping || {};
      const autoMap  = {};
      headers.forEach(h => { autoMap[h] = !!Object.keys(detected).find(k => detected[k] === h); });
      setAutoDetected(autoMap);
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Preview failed — check file format');
      setFile(null); setPreview(null);
    } finally { setLoading(false); }
  };

  const handleFile = (f) => {
    setFile(f); setPreview(null); setMapping({}); setAllHeaders([]); setAutoDetected({});
    runPreview(f, importType, duplicateStrategy, null);
  };

  const handleMappingChange = (newMapping) => {
    setMapping(newMapping);
    if (!file) return;
    runPreview(file, importType, duplicateStrategy, newMapping);
  };

  // Commit
  const handleCommit = async () => {
    if (!file) return;
    setCommitting(true); startProgress();
    try {
      const fd = new FormData();
      fd.append('file', file); fd.append('type', importType);
      fd.append('duplicateStrategy',     duplicateStrategy);
      fd.append('unknownDeptStrategy',   unknownDeptStrategy);
      fd.append('unknownVendorStrategy', unknownVendorStrategy);
      fd.append('mapping', JSON.stringify(mapping));
      if (storeScope && storeScope !== 'active' && storeScope !== 'all') fd.append('storeId', storeScope);
      const data = await commitImport(fd);
      finishProgress();
      setTimeout(() => {
        setResult(data);
        getImportHistory({ limit: 10 }).then(d => setHistory(d?.jobs || [])).catch(() => {});
      }, 400);
    } catch (err) {
      finishProgress();
      toast.error(err?.response?.data?.error || 'Import failed');
      setCommitting(false);
    }
  };

  const handleReset = () => {
    if (progressRef.current) clearInterval(progressRef.current);
    setStep(1); setFile(null); setPreview(null);
    setMapping({}); setAllHeaders([]); setAutoDetected({});
    setResult(null); setCommitting(false); setProgress(0);
  };

  const canProceedToStep2 = !!file && !!preview && !loading;
  const canProceedToStep3 = canProceedToStep2 && Object.keys(mapping).length > 0;
  const VIEW_CATALOG = { products: '/portal/catalog', departments: '/portal/departments', vendors: '/portal/vendors', promotions: '/portal/promotions' };

  return (
    <div className="layout-container">
      <Sidebar />

      <div className="main-content" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0, padding: 0 }}>

        {/* ── Header ── */}
        <div style={{ padding: '1.25rem 1.75rem 1.1rem', borderBottom: `1px solid ${T.border}`, flexShrink: 0, background: '#fff' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: T.textPrimary }}>Bulk Import</h1>
              <p style={{ margin: '2px 0 0', fontSize: '0.8rem', color: T.textMuted }}>
                Import products, departments, vendors & more from CSV or Excel
              </p>
            </div>
            <button onClick={handleDownloadTemplate} style={btn('ghost')}>
              <Download size={13} /> Template ({typeInfo.label})
            </button>
          </div>
        </div>

        {/* ── Body ── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem 1.75rem 3rem', background: T.bgPage }}>
          <div style={{ maxWidth: 860, margin: '0 auto' }}>

            <StepBar step={step} />

            {/* ════ STEP 1 ════ */}
            {step === 1 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

                {/* Config row */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  {/* Import type */}
                  <div>
                    <span style={label}>Import Type</span>
                    <div style={{ position: 'relative' }}>
                      <div style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', width: 28, height: 28, borderRadius: 7, background: typeInfo.color + '15', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                        {React.createElement(typeInfo.icon, { size: 13, color: typeInfo.color })}
                      </div>
                      <select value={importType} onChange={e => { setImportType(e.target.value); setFile(null); setPreview(null); setMapping({}); setAllHeaders([]); }} style={{ ...inputStyle, paddingLeft: 46 }}>
                        {IMPORT_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                      </select>
                    </div>
                    <div style={{ fontSize: '0.72rem', color: T.textMuted, marginTop: 5 }}>{typeInfo.desc}</div>
                  </div>

                  {/* Store scope */}
                  <div>
                    <span style={label}>Store Scope</span>
                    <div style={{ position: 'relative' }}>
                      <div style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
                        <Store size={13} color={T.textMuted} />
                      </div>
                      <select value={storeScope} onChange={e => setStoreScope(e.target.value)} style={{ ...inputStyle, paddingLeft: 34 }}>
                        <option value="active">Active store{activeStore ? ` (${activeStore.name})` : ''}</option>
                        <option value="all">All stores (org-wide)</option>
                        {stores.filter(s => !activeStore || s.id !== activeStore.id).map(s => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </div>
                    <div style={{ fontSize: '0.72rem', color: T.textMuted, marginTop: 5 }}>Which store(s) receive this import</div>
                  </div>
                </div>

                {/* Drop zone */}
                <div>
                  <span style={label}>Upload File</span>
                  <DropZone file={file} onFile={handleFile} onClear={() => { setFile(null); setPreview(null); setMapping({}); setAllHeaders([]); }} />
                  {loading && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, color: T.textMuted, fontSize: '0.8rem' }}>
                      <RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} color={T.blue} />
                      Analysing file and detecting columns…
                    </div>
                  )}
                  {file && !loading && preview && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, color: T.green, fontSize: '0.8rem', fontWeight: 600 }}>
                      <CheckCircle size={13} />
                      {preview.totalRows?.toLocaleString()} rows detected · {Object.keys(mapping).length} columns matched
                    </div>
                  )}
                </div>

                {/* Supported formats note */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.73rem', color: T.textPlaceholder, padding: '0 2px' }}>
                  <span>Supported: .csv, .xlsx, .xls, .txt (tab-delimited)</span>
                  <span style={{ opacity: 0.5 }}>·</span>
                  <span>Max rows: 50,000</span>
                </div>

                {/* Duplicate handling */}
                <div>
                  <span style={label}>When a record already exists</span>
                  <div style={{ display: 'flex', gap: 10 }}>
                    {DUPLICATE_STRATEGIES.map(s => (
                      <label key={s.id} style={{
                        ...card, flex: 1, display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '0.8rem 1rem',
                        borderColor: duplicateStrategy === s.id ? T.blue : T.border,
                        background: duplicateStrategy === s.id ? T.blueBg : T.bgCard,
                        transition: 'all .15s',
                      }}>
                        <input type="radio" name="dup" value={s.id} checked={duplicateStrategy === s.id} onChange={() => setDuplicateStrategy(s.id)} style={{ accentColor: T.blue }} />
                        <div>
                          <div style={{ fontWeight: 700, fontSize: '0.82rem', color: T.textPrimary }}>{s.label}</div>
                          <div style={{ fontSize: '0.7rem', color: T.textMuted, marginTop: 2 }}>{s.desc}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Dept / Vendor resolution strategies — only relevant for Products */}
                {importType === 'products' && (
                  <div>
                    <span style={label}>When department or vendor name is not found</span>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      {/* Dept strategy */}
                      <div style={{ ...card, padding: '0.9rem 1rem' }}>
                        <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#7c3aed', marginBottom: 8 }}>DEPARTMENT</div>
                        {[
                          { id: 'skip',   label: 'Skip (no dept)',    desc: 'Import product with no department assigned', icon: '→' },
                          { id: 'error',  label: 'Reject row',        desc: 'Fail the row if dept name not matched', icon: '✗' },
                          { id: 'create', label: 'Auto-create dept',  desc: 'Create a new department with that name',    icon: '+' },
                        ].map(s => (
                          <label key={s.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, cursor: 'pointer', marginBottom: 6, padding: '6px 8px', borderRadius: 7, background: unknownDeptStrategy === s.id ? 'rgba(124,58,237,0.08)' : 'transparent', border: `1px solid ${unknownDeptStrategy === s.id ? 'rgba(124,58,237,0.25)' : 'transparent'}` }}>
                            <input type="radio" name="deptStrat" value={s.id} checked={unknownDeptStrategy === s.id} onChange={() => setUnknownDeptStrategy(s.id)} style={{ accentColor: '#7c3aed', marginTop: 2, flexShrink: 0 }} />
                            <div>
                              <div style={{ fontWeight: 700, fontSize: '0.8rem', color: T.textPrimary }}><span style={{ marginRight: 5, opacity: 0.6 }}>{s.icon}</span>{s.label}</div>
                              <div style={{ fontSize: '0.7rem', color: T.textMuted }}>{s.desc}</div>
                            </div>
                          </label>
                        ))}
                      </div>
                      {/* Vendor strategy */}
                      <div style={{ ...card, padding: '0.9rem 1rem' }}>
                        <div style={{ fontSize: '0.72rem', fontWeight: 700, color: T.blue, marginBottom: 8 }}>VENDOR</div>
                        {[
                          { id: 'skip',   label: 'Skip (no vendor)',  desc: 'Import product with no vendor assigned',    icon: '→' },
                          { id: 'error',  label: 'Reject row',        desc: 'Fail the row if vendor name not matched',   icon: '✗' },
                          { id: 'create', label: 'Auto-create vendor', desc: 'Create a new vendor with that name',       icon: '+' },
                        ].map(s => (
                          <label key={s.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, cursor: 'pointer', marginBottom: 6, padding: '6px 8px', borderRadius: 7, background: unknownVendorStrategy === s.id ? T.blueBg : 'transparent', border: `1px solid ${unknownVendorStrategy === s.id ? T.blueBorder : 'transparent'}` }}>
                            <input type="radio" name="vendorStrat" value={s.id} checked={unknownVendorStrategy === s.id} onChange={() => setUnknownVendorStrategy(s.id)} style={{ accentColor: T.blue, marginTop: 2, flexShrink: 0 }} />
                            <div>
                              <div style={{ fontWeight: 700, fontSize: '0.8rem', color: T.textPrimary }}><span style={{ marginRight: 5, opacity: 0.6 }}>{s.icon}</span>{s.label}</div>
                              <div style={{ fontSize: '0.7rem', color: T.textMuted }}>{s.desc}</div>
                            </div>
                          </label>
                        ))}
                      </div>
                    </div>
                    <div style={{ fontSize: '0.72rem', color: T.textMuted, marginTop: 8, padding: '0 2px' }}>
                      Text names are matched case-insensitively to existing names and codes. Numeric values are matched by ID.
                    </div>
                  </div>
                )}

                {/* ID Reference */}
                <IdReferencePanel />

                {/* Tips */}
                <div style={{ ...card, background: T.blueBg, borderColor: T.blueBorder, padding: '1rem 1.1rem' }}>
                  <div style={{ fontSize: '0.7rem', fontWeight: 800, color: T.blue, letterSpacing: '0.06em', marginBottom: 8 }}>TIPS</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {[
                      'Download the template for the correct column format',
                      'Column headers are auto-detected from 80+ aliases',
                      'UPC is the unique key — re-importing updates existing rows',
                      'departmentId accepts an ID number or department name',
                    ].map((tip, i) => (
                      <div key={i} style={{ display: 'flex', gap: 8, fontSize: '0.78rem', color: T.textSecondary }}>
                        <span style={{ color: T.blue, flexShrink: 0, fontWeight: 700 }}>→</span> {tip}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Next */}
                {canProceedToStep2 && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button onClick={() => setStep(2)} style={btn('primary')}>
                      Map Columns <ChevronRight size={14} />
                    </button>
                  </div>
                )}

                {/* History */}
                {historyLoaded && history.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <span style={label}>Import History</span>
                    <HistoryTable jobs={history} />
                  </div>
                )}
              </div>
            )}

            {/* ════ STEP 2 ════ */}
            {step === 2 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* File bar */}
                <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 12, padding: '0.875rem 1.1rem' }}>
                  <div style={{ width: 36, height: 36, borderRadius: 9, background: T.blueBg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <FileSpreadsheet size={16} color={T.blue} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontWeight: 700, fontSize: '0.88rem', color: T.textPrimary }}>{file?.name}</span>
                    <span style={{ color: T.textMuted, fontSize: '0.78rem', marginLeft: 10 }}>{preview?.totalRows?.toLocaleString()} rows · {allHeaders.length} columns</span>
                  </div>
                  <button onClick={() => setStep(1)} style={{ ...btn('ghost'), padding: '4px 10px', fontSize: '0.73rem' }}>
                    <ChevronLeft size={12} /> Back
                  </button>
                </div>

                <MappingTable importType={importType} allHeaders={allHeaders} mapping={mapping} autoDetected={autoDetected} onChange={handleMappingChange} sampleRows={preview?.sample} />

                {loading && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: T.textMuted, fontSize: '0.8rem' }}>
                    <RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} color={T.blue} />
                    Re-validating with updated mapping…
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 4 }}>
                  <div style={{ fontSize: '0.8rem', color: T.textSecondary }}>
                    {preview?.validCount > 0
                      ? <><span style={{ color: T.green, fontWeight: 700 }}>{preview.validCount.toLocaleString()} rows</span> ready to import</>
                      : <span style={{ color: T.red }}>No valid rows yet</span>}
                  </div>
                  <button onClick={() => setStep(3)} disabled={!canProceedToStep3 || loading} style={{ ...btn('primary'), opacity: (canProceedToStep3 && !loading) ? 1 : 0.4 }}>
                    Validate & Import <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            )}

            {/* ════ STEP 3 ════ */}
            {step === 3 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {!result && (
                  <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 12, padding: '0.875rem 1.1rem' }}>
                    <div style={{ width: 36, height: 36, borderRadius: 9, background: T.blueBg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <FileSpreadsheet size={16} color={T.blue} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <span style={{ fontWeight: 700, fontSize: '0.88rem', color: T.textPrimary }}>{file?.name}</span>
                      <span style={{ color: T.textMuted, fontSize: '0.78rem', marginLeft: 10 }}>{preview?.totalRows?.toLocaleString()} rows</span>
                    </div>
                    {!committing && (
                      <button onClick={() => setStep(2)} style={{ ...btn('ghost'), padding: '4px 10px', fontSize: '0.73rem' }}>
                        <ChevronLeft size={12} /> Back
                      </button>
                    )}
                  </div>
                )}

                <ValidateAndImport
                  preview={preview}
                  onImport={handleCommit}
                  committing={committing}
                  progress={progress}
                  result={result}
                  onReset={handleReset}
                  onViewCatalog={VIEW_CATALOG[importType] ? () => navigate(VIEW_CATALOG[importType]) : null}
                  onDownloadErrors={preview?.errors?.length ? handleDownloadErrors : null}
                />
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}
