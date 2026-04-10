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
import { useStore } from '../contexts/StoreContext';
import { previewImport, commitImport, downloadImportTemplate, getImportHistory, getCatalogDepartments, getCatalogVendors } from '../services/api';
import './BulkImport.css';

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

// ─── ID Reference Panel ───────────────────────────────────────────────────────

function IdReferencePanel() {
  const [open,    setOpen]    = useState(false);
  const [tab,     setTab]     = useState('departments');
  const [depts,   setDepts]   = useState([]);
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search,  setSearch]  = useState('');
  const [copied,  setCopied]  = useState(null);

  const load = async () => {
    if (depts.length || vendors.length) return;
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

  return (
    <div className="bi-card bi-card--no-pad bi-ref-panel">
      <button onClick={handleToggle} className="bi-ref-toggle">
        <div className="bi-ref-toggle-left">
          <div className="bi-ref-icon">
            <Hash size={13} color="#3d56b5" />
          </div>
          <div>
            <div className="bi-ref-title">ID Reference</div>
            <div className="bi-ref-subtitle">Look up Department & Vendor IDs for your import file</div>
          </div>
        </div>
        <ChevronDown size={15} color="#64748b" className={`bi-ref-chevron ${open ? 'bi-ref-chevron--open' : ''}`} />
      </button>

      {open && (
        <div className="bi-ref-body">
          <div className="bi-ref-toolbar">
            <div className="bi-ref-tab-group">
              {[['departments', 'Departments', '#7c3aed'], ['vendors', 'Vendors', '#3d56b5']].map(([id, lbl, col]) => (
                <button
                  key={id}
                  onClick={() => { setTab(id); setSearch(''); }}
                  className={`bi-ref-tab-btn ${tab === id ? 'bi-ref-tab-btn--active' : 'bi-ref-tab-btn--inactive'}`}
                  style={tab === id ? { background: col } : undefined}
                >
                  {lbl}
                </button>
              ))}
            </div>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={`Search ${tab}...`}
              className="bi-input bi-input--inline"
            />
            {rows.length > 0 && (
              <span className="bi-ref-count">{rows.length} results</span>
            )}
          </div>

          <div className="bi-ref-list">
            {loading ? (
              <div className="bi-ref-loading">
                <RefreshCw size={14} className="bi-spin" style={{ marginRight: 6 }} />Loading...
              </div>
            ) : rows.length === 0 ? (
              <div className="bi-ref-empty">No results</div>
            ) : (
              <table className="bi-ref-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>NAME</th>
                    <th>CODE</th>
                    <th>COPY</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const isCopied = copied === row.id;
                    return (
                      <tr
                        key={row.id}
                        onClick={() => copyId(row.id, tab === 'departments' ? 'Dept' : 'Vendor')}
                        title="Click to copy ID"
                      >
                        <td>
                          <span className="bi-ref-id-chip" style={{ color: accentColor, background: accentBg, border: `1px solid ${accentBg.replace('0.1)', '0.22)')}` }}>
                            {row.id}
                          </span>
                        </td>
                        <td className="bi-ref-name">{row.name}</td>
                        <td className="bi-ref-code">{row.code || '\u2014'}</td>
                        <td>
                          {isCopied
                            ? <Check size={14} color="#059669" strokeWidth={3} />
                            : <Copy size={13} color="#64748b" />
                          }
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <div className="bi-ref-footer">
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
    <div className="bi-stepbar">
      {steps.map((lbl, i) => {
        const num    = i + 1;
        const done   = step > num;
        const active = step === num;
        return (
          <React.Fragment key={num}>
            <div className="bi-step">
              <div className={`bi-step-num ${done ? 'bi-step-num--done' : active ? 'bi-step-num--active' : 'bi-step-num--idle'}`}>
                {done ? <Check size={12} strokeWidth={3} /> : num}
              </div>
              <span className={`bi-step-label ${active ? 'bi-step-label--active' : done ? 'bi-step-label--done' : 'bi-step-label--idle'}`}>{lbl}</span>
            </div>
            {i < steps.length - 1 && (
              <div className={`bi-step-connector ${done ? 'bi-step-connector--done' : 'bi-step-connector--idle'}`} />
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
      <div className="bi-card bi-file-bar">
        <div className="bi-file-icon">
          <FileSpreadsheet size={18} color="#3d56b5" />
        </div>
        <div className="bi-file-info">
          <div className="bi-file-name">{file.name}</div>
          <div className="bi-file-size">{(file.size / 1024).toFixed(1)} KB</div>
        </div>
        <button onClick={onClear} className="bi-btn bi-btn--ghost bi-btn--sm"><X size={13} /></button>
      </div>
    );
  }

  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      className={`bi-dropzone ${dragging ? 'bi-dropzone--dragging' : ''}`}
    >
      <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls,.tsv,.txt" onChange={e => { if (e.target.files[0]) onFile(e.target.files[0]); }} className="bi-hidden" />
      <div className="bi-dropzone-icon">
        <Upload size={22} color="#3d56b5" />
      </div>
      <div className="bi-dropzone-title">Drop your file here</div>
      <div className="bi-dropzone-sub">CSV, Excel (.xlsx / .xls), TSV, TXT tab-delimited</div>
      <div className="bi-dropzone-divider">
        <div className="bi-dropzone-divider-line" />
        <span className="bi-dropzone-divider-text">OR</span>
        <div className="bi-dropzone-divider-line" />
      </div>
      <button
        onClick={e => { e.stopPropagation(); handlePaste(); }}
        disabled={pasting}
        className="bi-btn bi-btn--ghost bi-btn--sm"
      >
        <Clipboard size={12} /> {pasting ? 'Reading...' : 'Paste from clipboard'}
      </button>
      <div className="bi-dropzone-limit">Max 50,000 rows · 10 MB</div>
    </div>
  );
}

// ─── Mapping Table ────────────────────────────────────────────────────────────

function MappingTable({ importType, allHeaders, mapping, autoDetected, onChange, sampleRows }) {
  const [showPreview, setShowPreview] = useState(false);
  const fields    = TYPE_FIELDS[importType] || [];
  const required  = REQUIRED_FIELDS[importType] || [];

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
    <div className="bi-card bi-card--no-pad">
      <div className="bi-map-header">
        <div>
          <div className="bi-map-title">Column Mapping</div>
          <div className="bi-map-subtitle">Match your file's headers to import fields</div>
        </div>
        <div className="bi-map-actions">
          <span className="bi-badge bi-badge--green">
            <Check size={9} strokeWidth={3} /> Auto-detected {mappedCount}/{allHeaders.length}
          </span>
          {sampleRows?.length > 0 && (
            <button onClick={() => setShowPreview(v => !v)} className="bi-btn bi-btn--ghost bi-btn--sm">
              {showPreview ? 'Hide' : `Preview ${Math.min(sampleRows.length, 5)} rows`}
            </button>
          )}
        </div>
      </div>

      <div className="bi-map-scroll">
        <table className="bi-map-table">
          <thead>
            <tr>
              {['YOUR COLUMN', 'MAPS TO FIELD', 'STATUS'].map(h => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {allHeaders.map((header) => {
              const mapped  = reverseMap[header];
              const isReq   = mapped && required.includes(mapped);
              const wasAuto = autoDetected?.[header];
              return (
                <tr key={header}>
                  <td>
                    <span className="bi-map-col-name">&ldquo;{header}&rdquo;</span>
                  </td>
                  <td>
                    <select
                      value={mapped || ''}
                      onChange={e => handleHeaderChange(header, e.target.value)}
                      className={`bi-input bi-input--sm ${mapped ? 'bi-input--mapped' : ''}`}
                    >
                      <option value="">— Skip —</option>
                      {fields.map(f => (
                        <option key={f} value={f}>{FIELD_LABELS[f] || f}{required.includes(f) ? ' *' : ''}</option>
                      ))}
                    </select>
                  </td>
                  <td className="bi-map-status">
                    {mapped
                      ? wasAuto
                        ? <span className="bi-badge bi-badge--green"><Check size={9} strokeWidth={3} /> auto</span>
                        : <span className="bi-badge bi-badge--blue"><Check size={9} strokeWidth={3} /> mapped</span>
                      : <span className="bi-map-unmapped">not mapped</span>
                    }
                    {isReq && <span className="bi-req-tag">REQ</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showPreview && sampleRows?.length > 0 && (
        <div className="bi-preview-section">
          <div className="bi-preview-header">
            FIRST {Math.min(sampleRows.length, 5)} ROWS
          </div>
          <table className="bi-preview-table">
            <thead>
              <tr>
                {Object.keys(sampleRows[0]).slice(0, 7).map(k => (
                  <th key={k}>{FIELD_LABELS[k] || k}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sampleRows.slice(0, 5).map((row, i) => (
                <tr key={i}>
                  {Object.values(row).slice(0, 7).map((val, j) => (
                    <td key={j}>
                      {val === null || val === undefined ? <span className="bi-preview-null">&mdash;</span> : String(val)}
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
      <div className="bi-vstack">
        <div className={`bi-card bi-result-banner ${allOk ? 'bi-result-banner--ok' : 'bi-result-banner--warn'}`}>
          <div className="bi-result-icon">
            {allOk ? <CheckCircle size={22} color="#059669" /> : <AlertTriangle size={22} color="#d97706" />}
          </div>
          <div>
            <div className="bi-result-title">
              {allOk ? 'Import Complete' : 'Import Complete with Issues'}
            </div>
            <div className="bi-result-meta">
              <span className="bi-text-green">{result.created || 0} created</span>
              {' \u00b7 '}
              <span className="bi-text-blue">{result.updated || 0} updated</span>
              {' \u00b7 '}
              <span>{result.skipped || 0} skipped</span>
              {result.failed > 0 && <>{' \u00b7 '}<span className="bi-text-red">{result.failed} failed</span></>}
            </div>
          </div>
        </div>

        <div className="bi-stat-grid-4">
          {[
            { label: 'Created',  val: result.created || 0,  color: '#059669' },
            { label: 'Updated',  val: result.updated || 0,  color: '#3d56b5' },
            { label: 'Skipped',  val: result.skipped || 0,  color: '#64748b' },
            { label: 'Failed',   val: result.failed  || 0,  color: result.failed > 0 ? '#dc2626' : '#64748b' },
          ].map(({ label: lbl, val, color }) => (
            <div key={lbl} className="bi-card bi-stat-card">
              <div className="bi-stat-val" style={{ color }}>{val}</div>
              <div className="bi-stat-label">{lbl}</div>
            </div>
          ))}
        </div>

        {result.errors?.filter(e => e.type === 'error').length > 0 && (
          <div className="bi-card bi-card--no-pad">
            <div className="bi-error-header bi-error-header--red">
              <AlertCircle size={13} color="#dc2626" />
              <span className="bi-error-title" style={{ color: '#dc2626' }}>FAILED ROWS</span>
            </div>
            <div className="bi-error-list--short">
              {result.errors.filter(e => e.type === 'error').slice(0, 30).map((e, i) => (
                <div key={i} className="bi-error-row bi-error-row--compact">
                  <span className="bi-error-rownum">Row {e.row}</span>
                  <span className="bi-text-red">{e.message || e.errors?.map(x => x.message).join(', ')}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="bi-nav-row" style={{ gap: 10, justifyContent: 'flex-start', paddingTop: 4 }}>
          <button onClick={onReset} className="bi-btn bi-btn--ghost"><RotateCcw size={13} /> Import Another</button>
          {onViewCatalog && <button onClick={onViewCatalog} className="bi-btn bi-btn--primary">View Catalog <ArrowRight size={13} /></button>}
        </div>
      </div>
    );
  }

  return (
    <div className="bi-vstack">
      <div className="bi-stat-grid-3">
        {[
          { label: 'Rows ready',  count: validCount,   color: '#059669', bg: 'rgba(5,150,105,0.08)', icon: <CheckCircle size={20} color="#059669" /> },
          { label: 'Warnings',    count: warningCount, color: '#d97706', bg: 'rgba(217,119,6,0.08)',  icon: <AlertTriangle size={20} color="#d97706" /> },
          { label: 'Errors',      count: invalidCount, color: '#dc2626', bg: 'rgba(220,38,38,0.08)',  icon: <AlertCircle size={20} color="#dc2626" /> },
        ].map(({ label: lbl, count, color, bg, icon }) => (
          <div key={lbl} className="bi-card bi-stat-card--highlight" style={{ background: bg, borderColor: bg.replace('0.08)', '0.2)') }}>
            <div className="bi-stat-icon">{icon}</div>
            <div>
              <div className="bi-stat-val" style={{ color }}>{count.toLocaleString()}</div>
              <div className="bi-stat-label" style={{ color, marginTop: 3 }}>{lbl}</div>
            </div>
          </div>
        ))}
      </div>

      {errors.length > 0 && (
        <div className="bi-card bi-card--no-pad">
          <div className="bi-error-header bi-error-header--red bi-error-header--with-action">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <AlertCircle size={13} color="#dc2626" />
              <span className="bi-error-title" style={{ color: '#dc2626' }}>ERRORS — first {Math.min(errors.length, 50)}</span>
            </div>
            {onDownloadErrors && (
              <button onClick={onDownloadErrors} className="bi-btn bi-btn--ghost bi-btn--sm">
                <Download size={11} /> Download Error Report
              </button>
            )}
          </div>
          <div className="bi-error-list">
            {errors.slice(0, 50).map((e, i) => (
              <div key={i} className="bi-error-row">
                <span className="bi-error-rownum">Row {e.row}</span>
                <div style={{ flex: 1 }}>
                  {e.errors?.map((err, j) => (
                    <div key={j} className="bi-text-red">
                      <span className="bi-error-field">{FIELD_LABELS[err.field] || err.field}: </span>{err.message}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="bi-card bi-card--no-pad">
          <div className="bi-error-header bi-error-header--amber">
            <AlertTriangle size={13} color="#d97706" />
            <span className="bi-error-title" style={{ color: '#d97706' }}>WARNINGS — first {Math.min(warnings.length, 20)}</span>
          </div>
          <div className="bi-error-list--compact">
            {warnings.slice(0, 20).map((w, i) => (
              <div key={i} className="bi-error-row">
                <span className="bi-error-rownum">Row {w.row}</span>
                <div style={{ flex: 1 }}>
                  {w.warnings?.map((wr, j) => (
                    <div key={j} className="bi-text-amber">
                      <span className="bi-error-field">{FIELD_LABELS[wr.field] || wr.field}: </span>{wr.message}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {committing && (
        <div className="bi-card bi-progress-card">
          <div className="bi-progress-header">
            <span className="bi-progress-label">
              <RefreshCw size={13} color="#3d56b5" className="bi-spin" />
              Importing...
            </span>
            <span className="bi-progress-pct">{Math.round(progress)}%</span>
          </div>
          <div className="bi-progress-track">
            <div className="bi-progress-fill" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      {!committing && (
        <div className={`bi-card bi-cta-bar ${validCount > 0 ? 'bi-cta-bar--ready' : 'bi-cta-bar--idle'}`}>
          <div className="bi-cta-msg">
            {validCount === 0
              ? <span className="bi-text-red" style={{ fontWeight: 600 }}>No valid rows — fix errors in mapping</span>
              : <><span className="bi-text-green">{validCount.toLocaleString()} rows</span> ready to import{invalidCount > 0 && <span className="bi-text-red"> · {invalidCount} will be skipped</span>}</>
            }
          </div>
          <button
            onClick={onImport}
            disabled={validCount === 0}
            className="bi-btn bi-btn--primary bi-btn--lg"
          >
            <CheckCircle size={15} /> Import {validCount.toLocaleString()} rows &rarr;
          </button>
        </div>
      )}
    </div>
  );
}

// ─── History Table ────────────────────────────────────────────────────────────

function HistoryTable({ jobs }) {
  if (!jobs?.length) return null;
  const fmt = d => d ? new Date(d).toLocaleString() : '\u2014';
  const STATUS_MAP = {
    done:      { color: '#059669', bg: 'rgba(5,150,105,0.08)' },
    failed:    { color: '#dc2626', bg: 'rgba(220,38,38,0.08)' },
    importing: { color: '#3d56b5', bg: 'rgba(61,86,181,0.08)' },
    pending:   { color: '#d97706', bg: 'rgba(217,119,6,0.08)' },
  };
  return (
    <div className="bi-card bi-card--no-pad">
      <div className="bi-history-header">
        <span className="bi-history-title">RECENT IMPORTS</span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="bi-history-table">
          <thead>
            <tr>
              {['File', 'Type', 'Total', 'Success', 'Failed', 'Skipped', 'Status', 'Date'].map(h => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => {
              const s = STATUS_MAP[j.status] || { color: '#64748b', bg: 'rgba(100,116,139,0.08)' };
              return (
                <tr key={j.id}>
                  <td className="bi-history-file">{j.fileName}</td>
                  <td className="bi-history-type">{j.type}</td>
                  <td className="bi-history-num">{j.totalRows}</td>
                  <td className="bi-history-success">{j.successRows}</td>
                  <td style={{ color: j.failedRows > 0 ? '#dc2626' : '#64748b', fontWeight: j.failedRows > 0 ? 700 : 400, textAlign: 'right', padding: '8px 14px' }}>{j.failedRows}</td>
                  <td className="bi-history-num">{j.skippedRows}</td>
                  <td>
                    <span className="bi-status-badge" style={{ color: s.color, background: s.bg }}>{j.status}</span>
                  </td>
                  <td className="bi-history-date">{fmt(j.createdAt)}</td>
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

  const handleDownloadTemplate = async () => {
    try {
      const blob = await downloadImportTemplate(importType);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url;
      a.download = `storeveu_template_${importType}.csv`; a.click();
      URL.revokeObjectURL(url);
    } catch { toast.error('Failed to download template'); }
  };

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
      <div className="p-page bi-main">

        <div className="p-header">
          <div className="p-header-left">
            <div className="p-header-icon"><Upload size={22} /></div>
            <div>
              <h1 className="p-title">Bulk Import</h1>
              <p className="p-subtitle">Import products, departments, vendors & more from CSV or Excel</p>
            </div>
          </div>
          <div className="p-header-actions">
            <button onClick={handleDownloadTemplate} className="p-btn">
              <Download size={13} /> Template ({typeInfo.label})
            </button>
          </div>
        </div>

        <div className="bi-body">
          <div className="bi-body-inner">

            <StepBar step={step} />

            {/* Step 1 */}
            {step === 1 && (
              <div className="bi-vstack" style={{ gap: 20 }}>

                <div className="bi-config-grid">
                  <div>
                    <span className="bi-label">Import Type</span>
                    <div className="bi-select-icon-wrap">
                      <div className="bi-select-icon" style={{ background: typeInfo.color + '15' }}>
                        {React.createElement(typeInfo.icon, { size: 13, color: typeInfo.color })}
                      </div>
                      <select value={importType} onChange={e => { setImportType(e.target.value); setFile(null); setPreview(null); setMapping({}); setAllHeaders([]); }} className="bi-input bi-input--icon-left">
                        {IMPORT_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                      </select>
                    </div>
                    <div className="bi-field-hint">{typeInfo.desc}</div>
                  </div>

                  <div>
                    <span className="bi-label">Store Scope</span>
                    <div className="bi-select-icon-wrap">
                      <div className="bi-select-icon--sm" style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
                        <Store size={13} color="#64748b" />
                      </div>
                      <select value={storeScope} onChange={e => setStoreScope(e.target.value)} className="bi-input bi-input--icon-left-sm">
                        <option value="active">Active store{activeStore ? ` (${activeStore.name})` : ''}</option>
                        <option value="all">All stores (org-wide)</option>
                        {stores.filter(s => !activeStore || s.id !== activeStore.id).map(s => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="bi-field-hint">Which store(s) receive this import</div>
                  </div>
                </div>

                <div>
                  <span className="bi-label">Upload File</span>
                  <DropZone file={file} onFile={handleFile} onClear={() => { setFile(null); setPreview(null); setMapping({}); setAllHeaders([]); }} />
                  {loading && (
                    <div className="bi-loading-row">
                      <RefreshCw size={13} className="bi-spin" color="#3d56b5" />
                      Analysing file and detecting columns...
                    </div>
                  )}
                  {file && !loading && preview && (
                    <div className="bi-success-row">
                      <CheckCircle size={13} />
                      {preview.totalRows?.toLocaleString()} rows detected · {Object.keys(mapping).length} columns matched
                    </div>
                  )}
                </div>

                <div className="bi-formats-note">
                  <span>Supported: .csv, .xlsx, .xls, .txt (tab-delimited)</span>
                  <span className="bi-sep">·</span>
                  <span>Max rows: 50,000</span>
                </div>

                <div>
                  <span className="bi-label">When a record already exists</span>
                  <div className="bi-dup-row">
                    {DUPLICATE_STRATEGIES.map(s => (
                      <label key={s.id} className={`bi-card bi-dup-option ${duplicateStrategy === s.id ? 'bi-dup-option--selected' : ''}`}>
                        <input type="radio" name="dup" value={s.id} checked={duplicateStrategy === s.id} onChange={() => setDuplicateStrategy(s.id)} />
                        <div>
                          <div className="bi-dup-option-label">{s.label}</div>
                          <div className="bi-dup-option-desc">{s.desc}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                {importType === 'products' && (
                  <div>
                    <span className="bi-label">When department or vendor name is not found</span>
                    <div className="bi-resolve-grid">
                      <div className="bi-card bi-resolve-card">
                        <div className="bi-resolve-title bi-resolve-title--dept">DEPARTMENT</div>
                        {[
                          { id: 'skip',   label: 'Skip (no dept)',    desc: 'Import product with no department assigned', icon: '\u2192' },
                          { id: 'error',  label: 'Reject row',        desc: 'Fail the row if dept name not matched', icon: '\u2717' },
                          { id: 'create', label: 'Auto-create dept',  desc: 'Create a new department with that name',    icon: '+' },
                        ].map(s => (
                          <label key={s.id} className={`bi-resolve-option ${unknownDeptStrategy === s.id ? 'bi-resolve-option--dept-active' : ''}`}>
                            <input type="radio" name="deptStrat" value={s.id} checked={unknownDeptStrategy === s.id} onChange={() => setUnknownDeptStrategy(s.id)} className="bi-radio-dept" />
                            <div>
                              <div className="bi-resolve-option-label"><span>{s.icon}</span>{s.label}</div>
                              <div className="bi-resolve-option-desc">{s.desc}</div>
                            </div>
                          </label>
                        ))}
                      </div>
                      <div className="bi-card bi-resolve-card">
                        <div className="bi-resolve-title bi-resolve-title--vendor">VENDOR</div>
                        {[
                          { id: 'skip',   label: 'Skip (no vendor)',  desc: 'Import product with no vendor assigned',    icon: '\u2192' },
                          { id: 'error',  label: 'Reject row',        desc: 'Fail the row if vendor name not matched',   icon: '\u2717' },
                          { id: 'create', label: 'Auto-create vendor', desc: 'Create a new vendor with that name',       icon: '+' },
                        ].map(s => (
                          <label key={s.id} className={`bi-resolve-option ${unknownVendorStrategy === s.id ? 'bi-resolve-option--vendor-active' : ''}`}>
                            <input type="radio" name="vendorStrat" value={s.id} checked={unknownVendorStrategy === s.id} onChange={() => setUnknownVendorStrategy(s.id)} className="bi-radio-vendor" />
                            <div>
                              <div className="bi-resolve-option-label"><span>{s.icon}</span>{s.label}</div>
                              <div className="bi-resolve-option-desc">{s.desc}</div>
                            </div>
                          </label>
                        ))}
                      </div>
                    </div>
                    <div className="bi-resolve-hint">
                      Text names are matched case-insensitively to existing names and codes. Numeric values are matched by ID.
                    </div>
                  </div>
                )}

                <IdReferencePanel />

                <div className="bi-card bi-tips">
                  <div className="bi-tips-title">TIPS</div>
                  <div className="bi-tips-list">
                    {[
                      'Download the template for the correct column format',
                      'Column headers are auto-detected from 80+ aliases',
                      'UPC is the unique key — re-importing updates existing rows',
                      'departmentId accepts an ID number or department name',
                    ].map((tip, i) => (
                      <div key={i} className="bi-tip">
                        <span className="bi-tip-arrow">&rarr;</span> {tip}
                      </div>
                    ))}
                  </div>
                </div>

                {canProceedToStep2 && (
                  <div className="bi-nav-row">
                    <button onClick={() => setStep(2)} className="bi-btn bi-btn--primary">
                      Map Columns <ChevronRight size={14} />
                    </button>
                  </div>
                )}

                {historyLoaded && history.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <span className="bi-label">Import History</span>
                    <HistoryTable jobs={history} />
                  </div>
                )}
              </div>
            )}

            {/* Step 2 */}
            {step === 2 && (
              <div className="bi-vstack" style={{ gap: 16 }}>
                <div className="bi-card bi-file-bar">
                  <div className="bi-file-icon bi-file-icon--sm">
                    <FileSpreadsheet size={16} color="#3d56b5" />
                  </div>
                  <div className="bi-file-info">
                    <span className="bi-file-name">{file?.name}</span>
                    <span className="bi-file-meta">{preview?.totalRows?.toLocaleString()} rows · {allHeaders.length} columns</span>
                  </div>
                  <button onClick={() => setStep(1)} className="bi-btn bi-btn--ghost bi-btn--sm">
                    <ChevronLeft size={12} /> Back
                  </button>
                </div>

                <MappingTable importType={importType} allHeaders={allHeaders} mapping={mapping} autoDetected={autoDetected} onChange={handleMappingChange} sampleRows={preview?.sample} />

                {loading && (
                  <div className="bi-loading-row">
                    <RefreshCw size={13} className="bi-spin" color="#3d56b5" />
                    Re-validating with updated mapping...
                  </div>
                )}

                <div className="bi-nav-row bi-nav-row--between">
                  <div className="bi-valid-msg">
                    {preview?.validCount > 0
                      ? <><span className="bi-text-green">{preview.validCount.toLocaleString()} rows</span> ready to import</>
                      : <span className="bi-text-red">No valid rows yet</span>}
                  </div>
                  <button onClick={() => setStep(3)} disabled={!canProceedToStep3 || loading} className="bi-btn bi-btn--primary">
                    Validate & Import <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            )}

            {/* Step 3 */}
            {step === 3 && (
              <div className="bi-vstack" style={{ gap: 16 }}>
                {!result && (
                  <div className="bi-card bi-file-bar">
                    <div className="bi-file-icon bi-file-icon--sm">
                      <FileSpreadsheet size={16} color="#3d56b5" />
                    </div>
                    <div className="bi-file-info">
                      <span className="bi-file-name">{file?.name}</span>
                      <span className="bi-file-meta">{preview?.totalRows?.toLocaleString()} rows</span>
                    </div>
                    {!committing && (
                      <button onClick={() => setStep(2)} className="bi-btn bi-btn--ghost bi-btn--sm">
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
  );
}
