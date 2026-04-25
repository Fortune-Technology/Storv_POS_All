/**
 * ScanData.jsx — Scan Data / Tobacco Compliance Portal Page (Session 45)
 *
 * Tabs:
 *   Enrollments     — per-store per-mfr-feed grid; create/edit credentials, status
 *   Tobacco Catalog — list tobacco products, bulk-tag mfr + brand family
 *   Coupons         — coupon catalog (list / create / CSV import); shows redemption count
 *   Submissions     — daily submission log (read-only; populated by Session 47 scheduler)
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ShieldCheck, Plus, X, Edit2, Trash2, RefreshCw, Upload as UploadIcon,
  Tag as TagIcon, Building2, ScanLine, FileText, AlertCircle,
  CheckCircle2, Clock, PauseCircle, XCircle, Lock, Eye, EyeOff,
  BookOpen, Download, Award, Activity, Loader2,
} from 'lucide-react';
import { toast } from 'react-toastify';
import {
  listTobaccoManufacturers,
  listScanDataEnrollments, upsertScanDataEnrollment, updateEnrollmentStatus, deleteScanDataEnrollment,
  listProductMappings, upsertProductMapping, bulkUpsertProductMappings, deleteProductMapping,
  listTobaccoProducts,
  listScanDataSubmissions, getScanDataSubmissionStats,
  getSubmissionAckLines, processSubmissionAck, regenerateScanDataSubmission,
  generateCertSampleFile, getEnrollmentCertChecklist, getCertPlaybookByMfr,
  listManufacturerCoupons, createManufacturerCoupon, deleteManufacturerCoupon,
  importCouponsCsvData, getCouponRedemptionStats,
  getStores,
} from '../services/api';
import './ScanData.css';

const STATUS_BADGES = {
  draft:      { label: 'Draft',      color: '#64748b', icon: Clock },
  certifying: { label: 'Certifying', color: '#0891b2', icon: ScanLine },
  active:     { label: 'Active',     color: '#16a34a', icon: CheckCircle2 },
  suspended:  { label: 'Suspended',  color: '#f59e0b', icon: PauseCircle },
  rejected:   { label: 'Rejected',   color: '#dc2626', icon: XCircle },
};

const fmtDate = (d) => d ? new Date(d).toLocaleDateString() : '—';
const fmtDateTime = (d) => d ? new Date(d).toLocaleString() : '—';
const fmtMoney = (n) => n == null ? '—' : `$${Number(n).toFixed(2)}`;

export default function ScanData() {
  const [tab, setTab] = useState('enrollments');
  const [storeId, setStoreId] = useState(localStorage.getItem('activeStoreId') || '');
  const [stores, setStores] = useState([]);
  const [manufacturers, setManufacturers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  // Reload storeId if active store changes
  useEffect(() => {
    const onStorage = () => setStoreId(localStorage.getItem('activeStoreId') || '');
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Load shared catalogue data once
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const [mfrRes, storesRaw] = await Promise.all([
          listTobaccoManufacturers().catch((e) => ({ data: [], error: e?.response?.data?.error || e.message })),
          getStores().catch(() => []),
        ]);
        if (cancelled) return;
        if (mfrRes.error) {
          setErr(mfrRes.error.includes('permission')
            ? 'You do not have permission to view Scan Data.'
            : `Could not load manufacturer catalog: ${mfrRes.error}`);
        }
        setManufacturers(mfrRes.data || []);
        // getStores() returns an array directly (no wrapper)
        const storesList = Array.isArray(storesRaw) ? storesRaw : (storesRaw?.data || []);
        setStores(storesList.filter((s) => s.isActive !== false));
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        setErr(e?.response?.data?.error || e.message);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="sd-page">
        <div className="sd-loading">Loading Scan Data module…</div>
      </div>
    );
  }

  return (
    <div className="sd-page">
      {/* Header */}
      <div className="sd-header">
        <div className="sd-header-left">
          <div className="sd-header-icon"><ShieldCheck size={20} /></div>
          <div>
            <h2 className="sd-title">Scan Data &amp; Tobacco Compliance</h2>
            <div className="sd-subtitle">
              Daily-batch reporting + digital coupon redemption for Altria, RJR/RAI, and ITG Brands
            </div>
          </div>
        </div>
      </div>

      {err && (
        <div className="sd-error">
          <AlertCircle size={16} />
          <span>{err}</span>
        </div>
      )}

      {/* Tabs */}
      <div className="sd-tabs">
        <button
          className={`sd-tab ${tab === 'enrollments' ? 'sd-tab--active' : ''}`}
          onClick={() => setTab('enrollments')}
        >
          <Building2 size={14} /> Enrollments
        </button>
        <button
          className={`sd-tab ${tab === 'catalog' ? 'sd-tab--active' : ''}`}
          onClick={() => setTab('catalog')}
        >
          <TagIcon size={14} /> Tobacco Catalog
        </button>
        <button
          className={`sd-tab ${tab === 'coupons' ? 'sd-tab--active' : ''}`}
          onClick={() => setTab('coupons')}
        >
          <ScanLine size={14} /> Coupons
        </button>
        <button
          className={`sd-tab ${tab === 'submissions' ? 'sd-tab--active' : ''}`}
          onClick={() => setTab('submissions')}
        >
          <FileText size={14} /> Submissions
        </button>
      </div>

      {tab === 'enrollments'  && <EnrollmentsTab manufacturers={manufacturers} stores={stores} />}
      {tab === 'catalog'      && <TobaccoCatalogTab manufacturers={manufacturers} />}
      {tab === 'coupons'      && <CouponsTab manufacturers={manufacturers} />}
      {tab === 'submissions'  && <SubmissionsTab manufacturers={manufacturers} stores={stores} />}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   ENROLLMENTS TAB
   Per-store per-mfr enrollment grid.
   ═══════════════════════════════════════════════════════════════════════ */

function EnrollmentsTab({ manufacturers, stores }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [editing, setEditing] = useState(null); // { storeId, manufacturerId, ...existing }
  const [certingEnrollment, setCertingEnrollment] = useState(null); // an existing enrollment row to walk cert for

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const res = await listScanDataEnrollments();
      setRows(res.data || []);
      setErr(null);
    } catch (e) {
      setErr(e?.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Build a quick lookup of (storeId, manufacturerId) → enrollment
  const enrollByKey = useMemo(() => {
    const m = {};
    for (const r of rows) m[`${r.storeId}::${r.manufacturerId}`] = r;
    return m;
  }, [rows]);

  // Group manufacturers by parent for cleaner display
  const grouped = useMemo(() => {
    const g = {};
    for (const m of manufacturers) {
      g[m.parentMfrCode] = g[m.parentMfrCode] || [];
      g[m.parentMfrCode].push(m);
    }
    return g;
  }, [manufacturers]);

  if (loading) return <div className="sd-loading">Loading enrollments…</div>;
  if (err) return <div className="sd-error"><AlertCircle size={16} /><span>{err}</span></div>;

  if (stores.length === 0) {
    return (
      <div className="sd-empty">
        <Building2 size={28} />
        <h3>No stores configured</h3>
        <p>Add a store under <strong>Account → Stores</strong> to enroll it in scan data programs.</p>
      </div>
    );
  }

  return (
    <div className="sd-tab-body">
      <div className="sd-tab-toolbar">
        <div className="sd-toolbar-info">
          <strong>{rows.filter(r => r.status === 'active').length}</strong> active &middot;{' '}
          <strong>{rows.filter(r => r.status === 'certifying').length}</strong> certifying &middot;{' '}
          <strong>{rows.filter(r => r.status === 'draft').length}</strong> draft
        </div>
        <button className="sd-btn-secondary" onClick={refresh}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {stores.map((store) => (
        <div key={store.id} className="sd-store-block">
          <div className="sd-store-header">
            <Building2 size={16} />
            <strong>{store.name}</strong>
            {store.address && <span className="sd-store-address">{store.address}</span>}
          </div>

          {Object.entries(grouped).map(([parent, mfrs]) => (
            <div key={parent} className="sd-mfr-group">
              <div className="sd-mfr-group-label">{parent.toUpperCase()}</div>
              <div className="sd-mfr-grid">
                {mfrs.map((mfr) => {
                  const e = enrollByKey[`${store.id}::${mfr.id}`];
                  const status = e?.status || 'unenrolled';
                  return (
                    <EnrollmentCard
                      key={mfr.id}
                      mfr={mfr}
                      enrollment={e}
                      status={status}
                      onEdit={() => setEditing({
                        storeId: store.id,
                        manufacturerId: mfr.id,
                        manufacturer: mfr,
                        ...(e || {}),
                      })}
                      onStatusChange={async (newStatus) => {
                        try {
                          await updateEnrollmentStatus(e.id, newStatus);
                          toast.success(`Status changed to ${newStatus}`);
                          refresh();
                        } catch (err) {
                          toast.error(err?.response?.data?.error || err.message);
                        }
                      }}
                      onOpenCert={() => setCertingEnrollment({ ...e, manufacturer: mfr })}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ))}

      {editing && (
        <EnrollmentModal
          row={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}

      {certingEnrollment && (
        <CertModal
          enrollment={certingEnrollment}
          onClose={() => setCertingEnrollment(null)}
          onChanged={() => { setCertingEnrollment(null); refresh(); }}
        />
      )}
    </div>
  );
}

function EnrollmentCard({ mfr, enrollment, status, onEdit, onStatusChange, onOpenCert }) {
  const badge = STATUS_BADGES[status] || { label: 'Not enrolled', color: '#94a3b8', icon: Plus };
  const Icon = badge.icon;
  return (
    <div className={`sd-mfr-card sd-mfr-card--${status}`}>
      <div className="sd-mfr-card-head">
        <div>
          <div className="sd-mfr-name">{mfr.shortName}</div>
          <div className="sd-mfr-fullname">{mfr.name}</div>
        </div>
        <span className="sd-status-badge" style={{ background: `${badge.color}1a`, color: badge.color, borderColor: `${badge.color}55` }}>
          <Icon size={12} />
          {badge.label}
        </span>
      </div>
      <div className="sd-mfr-meta">
        <span><strong>Format:</strong> {mfr.fileFormat.replace('_', '-')}</span>
        {mfr.brandFamilies?.length > 0 && (
          <span title={mfr.brandFamilies.join(', ')}>
            <strong>Brands:</strong> {mfr.brandFamilies.length} families
          </span>
        )}
      </div>
      {enrollment && (
        <div className="sd-mfr-extra">
          {enrollment.environment === 'production'
            ? <span className="sd-env-prod">PRODUCTION</span>
            : <span className="sd-env-uat">UAT</span>}
          {enrollment.sftpHost && <span className="sd-sftp-host">{enrollment.sftpHost}</span>}
          {enrollment.lastSubmissionAt && (
            <span className="sd-last-sub">Last submitted: {fmtDateTime(enrollment.lastSubmissionAt)}</span>
          )}
        </div>
      )}
      <div className="sd-mfr-actions">
        <button className="sd-btn-secondary sd-btn-sm" onClick={onEdit}>
          {enrollment ? <><Edit2 size={12} /> Edit</> : <><Plus size={12} /> Enroll</>}
        </button>
        {enrollment && (
          <button className="sd-btn-link" onClick={onOpenCert}>
            <Award size={12} /> Cert
          </button>
        )}
        {enrollment && status === 'active' && (
          <button className="sd-btn-link sd-btn-warn" onClick={() => onStatusChange('suspended')}>Suspend</button>
        )}
        {enrollment && status === 'suspended' && (
          <button className="sd-btn-link" onClick={() => onStatusChange('active')}>Resume</button>
        )}
      </div>
    </div>
  );
}

function EnrollmentModal({ row, onClose, onSaved }) {
  const [form, setForm] = useState({
    storeId: row.storeId,
    manufacturerId: row.manufacturerId,
    mfrRetailerId: row.mfrRetailerId || '',
    mfrChainId: row.mfrChainId || '',
    sftpHost: row.sftpHost || row.manufacturer?.uatHost || '',
    sftpPort: row.sftpPort || 22,
    sftpUsername: row.sftpUsername || '',
    sftpPassword: '',
    sftpPath: row.sftpPath || '/upload/',
    environment: row.environment || 'uat',
    notes: row.notes || '',
  });
  const [showPwd, setShowPwd] = useState(false);
  const [saving, setSaving] = useState(false);
  const isExisting = !!row.id;

  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      await upsertScanDataEnrollment({
        ...form,
        sftpPassword: form.sftpPassword || undefined, // only send if entered
      });
      toast.success(isExisting ? 'Enrollment updated' : 'Enrollment created');
      onSaved();
    } catch (e) {
      toast.error(e?.response?.data?.error || e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="sd-modal-backdrop" onClick={onClose}>
      <div className="sd-modal" onClick={(e) => e.stopPropagation()}>
        <div className="sd-modal-head">
          <h3>{isExisting ? 'Edit Enrollment' : 'New Enrollment'} — {row.manufacturer?.shortName}</h3>
          <button className="sd-icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="sd-modal-body">
          <div className="sd-modal-info">
            <strong>{row.manufacturer?.name}</strong>
            <div>{row.manufacturer?.fileFormat?.replace('_', '-')} · {row.manufacturer?.cadence}</div>
            {row.manufacturer?.notes && <em className="sd-modal-info-notes">{row.manufacturer.notes}</em>}
          </div>

          <div className="sd-form-grid">
            <div className="sd-form-row">
              <label>Manufacturer Retailer ID</label>
              <input
                type="text"
                value={form.mfrRetailerId}
                onChange={(e) => setField('mfrRetailerId', e.target.value)}
                placeholder="Assigned by manufacturer (e.g. 7-digit Altria code)"
              />
            </div>
            <div className="sd-form-row">
              <label>Manufacturer Chain ID</label>
              <input
                type="text"
                value={form.mfrChainId}
                onChange={(e) => setField('mfrChainId', e.target.value)}
                placeholder="Optional — required by some mfrs"
              />
            </div>

            <div className="sd-form-section-label">SFTP Connection</div>

            <div className="sd-form-row">
              <label>Environment</label>
              <select value={form.environment} onChange={(e) => setField('environment', e.target.value)}>
                <option value="uat">UAT (Test / Cert)</option>
                <option value="production">Production</option>
              </select>
            </div>
            <div className="sd-form-row">
              <label>SFTP Host</label>
              <input
                type="text"
                value={form.sftpHost}
                onChange={(e) => setField('sftpHost', e.target.value)}
                placeholder="sftp.altria.com"
              />
            </div>
            <div className="sd-form-row">
              <label>Port</label>
              <input
                type="number"
                value={form.sftpPort}
                onChange={(e) => setField('sftpPort', Number(e.target.value))}
              />
            </div>
            <div className="sd-form-row">
              <label>Username</label>
              <input
                type="text"
                value={form.sftpUsername}
                onChange={(e) => setField('sftpUsername', e.target.value)}
                placeholder="retailer-username"
              />
            </div>
            <div className="sd-form-row">
              <label>
                Password
                {row.sftpPasswordSet && <span className="sd-pwd-set"> · stored ({row.sftpUsernameMasked || 'set'})</span>}
              </label>
              <div className="sd-pwd-input">
                <input
                  type={showPwd ? 'text' : 'password'}
                  value={form.sftpPassword}
                  onChange={(e) => setField('sftpPassword', e.target.value)}
                  placeholder={row.sftpPasswordSet ? 'Leave blank to keep existing' : 'Enter SFTP password'}
                  autoComplete="new-password"
                />
                <button type="button" className="sd-icon-btn" onClick={() => setShowPwd(!showPwd)}>
                  {showPwd ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <div className="sd-form-hint">
                <Lock size={11} />
                Encrypted at rest with AES-256-GCM. Plaintext never returned by any endpoint.
              </div>
            </div>
            <div className="sd-form-row">
              <label>Upload Path</label>
              <input
                type="text"
                value={form.sftpPath}
                onChange={(e) => setField('sftpPath', e.target.value)}
                placeholder="/upload/"
              />
            </div>

            <div className="sd-form-row sd-form-row--full">
              <label>Notes</label>
              <textarea
                rows={3}
                value={form.notes}
                onChange={(e) => setField('notes', e.target.value)}
                placeholder="Internal notes (cert contact, ticket numbers, etc.)"
              />
            </div>
          </div>
        </div>
        <div className="sd-modal-foot">
          <button className="sd-btn-secondary" onClick={onClose}>Cancel</button>
          <button className="sd-btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : (isExisting ? 'Save Changes' : 'Create Enrollment')}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   TOBACCO CATALOG TAB
   List tobacco-tagged products + bulk-tag with mfr/brand.
   ═══════════════════════════════════════════════════════════════════════ */

function TobaccoCatalogTab({ manufacturers }) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [unmappedOnly, setUnmappedOnly] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const res = await listTobaccoProducts({ search, unmappedOnly });
      setProducts(res.data || []);
    } catch (e) {
      toast.error(e?.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  }, [search, unmappedOnly]);

  useEffect(() => {
    const t = setTimeout(refresh, 200);
    return () => clearTimeout(t);
  }, [refresh]);

  return (
    <div className="sd-tab-body">
      <div className="sd-tab-toolbar">
        <input
          type="search"
          className="sd-search"
          placeholder="Search by name, UPC, or brand…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label className="sd-checkbox-label">
          <input type="checkbox" checked={unmappedOnly} onChange={(e) => setUnmappedOnly(e.target.checked)} />
          Unmapped only
        </label>
        <button className="sd-btn-secondary" onClick={refresh}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {loading ? (
        <div className="sd-loading">Loading tobacco products…</div>
      ) : products.length === 0 ? (
        <div className="sd-empty">
          <TagIcon size={28} />
          <h3>No tobacco products found</h3>
          <p>
            Tobacco products are detected by <code>taxClass = "tobacco"</code> on the product, or by an
            existing manufacturer mapping. Tag your tobacco products in the Catalog to see them here.
          </p>
        </div>
      ) : (
        <div className="sd-table-wrap">
          <table className="sd-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>UPC</th>
                <th>Brand</th>
                <th>Department</th>
                <th>Mappings</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id}>
                  <td><strong>{p.name}</strong></td>
                  <td><code>{p.upc || '—'}</code></td>
                  <td>{p.brand || '—'}</td>
                  <td>{p.department?.name || '—'}</td>
                  <td>
                    {p.tobaccoProductMaps?.length === 0
                      ? <span className="sd-unmapped-badge">Unmapped</span>
                      : (
                        <div className="sd-map-chips">
                          {p.tobaccoProductMaps.map((m) => (
                            <span key={m.id} className="sd-map-chip">
                              {m.manufacturer.shortName} · {m.brandFamily}
                            </span>
                          ))}
                        </div>
                      )
                    }
                  </td>
                  <td>
                    <button className="sd-btn-link" onClick={() => setEditingProduct(p)}>Manage</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editingProduct && (
        <ProductMappingsModal
          product={editingProduct}
          manufacturers={manufacturers}
          onClose={() => setEditingProduct(null)}
          onSaved={() => {
            setEditingProduct(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function ProductMappingsModal({ product, manufacturers, onClose, onSaved }) {
  const [mappings, setMappings] = useState(product.tobaccoProductMaps || []);
  const [adding, setAdding] = useState({
    manufacturerId: '',
    brandFamily: '',
    mfrProductCode: '',
    fundingType: 'regular',
  });
  const [saving, setSaving] = useState(false);

  const addMapping = async () => {
    if (!adding.manufacturerId || !adding.brandFamily) {
      toast.warn('Pick a manufacturer feed and brand family first');
      return;
    }
    setSaving(true);
    try {
      const res = await upsertProductMapping({
        masterProductId: product.id,
        ...adding,
      });
      setMappings((cur) => {
        const idx = cur.findIndex((m) => m.manufacturerId === adding.manufacturerId);
        if (idx >= 0) {
          const next = [...cur];
          next[idx] = res.data;
          return next;
        }
        return [...cur, res.data];
      });
      setAdding({ manufacturerId: '', brandFamily: '', mfrProductCode: '', fundingType: 'regular' });
      toast.success('Mapping saved');
    } catch (e) {
      toast.error(e?.response?.data?.error || e.message);
    } finally {
      setSaving(false);
    }
  };

  const removeMapping = async (id) => {
    if (!confirm('Remove this mapping? The product will no longer flow on this feed.')) return;
    try {
      await deleteProductMapping(id);
      setMappings((cur) => cur.filter((m) => m.id !== id));
      toast.success('Mapping removed');
    } catch (e) {
      toast.error(e?.response?.data?.error || e.message);
    }
  };

  const selectedMfr = manufacturers.find((m) => m.id === adding.manufacturerId);

  return (
    <div className="sd-modal-backdrop" onClick={onClose}>
      <div className="sd-modal" onClick={(e) => e.stopPropagation()}>
        <div className="sd-modal-head">
          <h3>Mappings — {product.name}</h3>
          <button className="sd-icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="sd-modal-body">
          <div className="sd-modal-info">
            <span><strong>UPC:</strong> {product.upc || '—'}</span>
            <span><strong>Brand:</strong> {product.brand || '—'}</span>
          </div>

          <div className="sd-form-section-label">Existing mappings</div>
          {mappings.length === 0 ? (
            <p className="sd-modal-empty">No mappings yet — add one below to start including this product on a manufacturer feed.</p>
          ) : (
            <ul className="sd-mapping-list">
              {mappings.map((m) => (
                <li key={m.id}>
                  <div>
                    <strong>{m.manufacturer.shortName}</strong>
                    {' · '}
                    <span>{m.brandFamily}</span>
                    {m.mfrProductCode && <span className="sd-mfr-code"> · code {m.mfrProductCode}</span>}
                    {m.fundingType !== 'regular' && (
                      <span className="sd-funding-chip">{m.fundingType}</span>
                    )}
                  </div>
                  <button className="sd-btn-link sd-btn-warn" onClick={() => removeMapping(m.id)}>
                    <Trash2 size={12} /> Remove
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="sd-form-section-label">Add mapping</div>
          <div className="sd-form-grid">
            <div className="sd-form-row">
              <label>Manufacturer Feed</label>
              <select
                value={adding.manufacturerId}
                onChange={(e) => setAdding({ ...adding, manufacturerId: e.target.value, brandFamily: '' })}
              >
                <option value="">— Select feed —</option>
                {manufacturers.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>
            <div className="sd-form-row">
              <label>Brand Family</label>
              <select
                value={adding.brandFamily}
                onChange={(e) => setAdding({ ...adding, brandFamily: e.target.value })}
                disabled={!selectedMfr}
              >
                <option value="">— Select brand family —</option>
                {selectedMfr?.brandFamilies?.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </div>
            <div className="sd-form-row">
              <label>Mfr Product Code (optional)</label>
              <input
                type="text"
                value={adding.mfrProductCode}
                onChange={(e) => setAdding({ ...adding, mfrProductCode: e.target.value })}
                placeholder="Required by some mfrs"
              />
            </div>
            <div className="sd-form-row">
              <label>Funding Type</label>
              <select
                value={adding.fundingType}
                onChange={(e) => setAdding({ ...adding, fundingType: e.target.value })}
              >
                <option value="regular">Regular (submission only)</option>
                <option value="buydown">Buydown (shelf-price funded)</option>
                <option value="multipack">Multipack (funded multipack)</option>
                <option value="promotion">Promotion (time-limited)</option>
              </select>
            </div>
          </div>
        </div>
        <div className="sd-modal-foot">
          <button className="sd-btn-secondary" onClick={onClose}>Done</button>
          <button className="sd-btn-primary" onClick={addMapping} disabled={saving}>
            {saving ? 'Saving…' : 'Add Mapping'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   CERT MODAL (Session 49)
   Per-enrollment cert harness — checklist + sample-file generator + playbook.
   ═══════════════════════════════════════════════════════════════════════ */

const STEP_ICON = {
  done:    { icon: CheckCircle2, color: '#16a34a', bg: 'rgba(22, 163, 74, 0.10)' },
  warning: { icon: AlertCircle,  color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.10)' },
  pending: { icon: Clock,        color: '#94a3b8', bg: 'rgba(148, 163, 184, 0.10)' },
};

function CertModal({ enrollment, onClose, onChanged }) {
  const [tab, setTab]         = useState('checklist'); // 'checklist' | 'sample' | 'playbook'
  const [checklist, setChecklist] = useState(null);
  const [playbook, setPlaybook]   = useState(null);
  const [loading, setLoading]     = useState(true);
  const [err, setErr]             = useState(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const [cRes, pRes] = await Promise.all([
        getEnrollmentCertChecklist(enrollment.id),
        getCertPlaybookByMfr(enrollment.manufacturer.code).catch(() => ({ data: null })),
      ]);
      setChecklist(cRes.data);
      setPlaybook(pRes.data);
      setErr(null);
    } catch (e) {
      setErr(e?.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  }, [enrollment.id, enrollment.manufacturer.code]);

  useEffect(() => { refresh(); }, [refresh]);

  const advanceStatus = async (newStatus) => {
    try {
      await updateEnrollmentStatus(enrollment.id, newStatus);
      toast.success(`Status changed to ${newStatus}`);
      onChanged?.();
    } catch (e) {
      toast.error(e?.response?.data?.error || e.message);
    }
  };

  return (
    <div className="sd-modal-backdrop" onClick={onClose}>
      <div className="sd-modal sd-modal--wide" onClick={(e) => e.stopPropagation()}>
        <div className="sd-modal-head">
          <h3>
            <Award size={18} style={{ verticalAlign: '-3px', marginRight: '6px' }} />
            Cert — {enrollment.manufacturer.name}
          </h3>
          <button className="sd-icon-btn" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="sd-modal-body">
          {loading ? (
            <div className="sd-loading">Loading cert state…</div>
          ) : err ? (
            <div className="sd-error"><AlertCircle size={16} /><span>{err}</span></div>
          ) : checklist ? (
            <>
              {/* Progress strip */}
              <div className="sd-cert-progress">
                <div className="sd-cert-progress-bar">
                  <div className="sd-cert-progress-fill" style={{ width: `${checklist.overallProgress}%` }} />
                </div>
                <div className="sd-cert-progress-meta">
                  <span><strong>{checklist.overallProgress}%</strong> ready</span>
                  <span>·</span>
                  <span>Status: <span className={`sd-sub-status sd-sub-status--${checklist.enrollment.status}`}>{checklist.enrollment.status}</span></span>
                  <span>·</span>
                  <span>Mappings: <strong>{checklist.stats.mappingCount}</strong></span>
                  <span>·</span>
                  <span>Brands: <strong>{checklist.stats.brandFamiliesCovered}/{checklist.stats.brandFamiliesAvailable}</strong></span>
                </div>
              </div>

              {/* Sub-tabs */}
              <div className="sd-tabs" style={{ marginTop: '0.75rem' }}>
                <button
                  className={`sd-tab ${tab === 'checklist' ? 'sd-tab--active' : ''}`}
                  onClick={() => setTab('checklist')}
                ><Activity size={14} /> Checklist</button>
                <button
                  className={`sd-tab ${tab === 'sample' ? 'sd-tab--active' : ''}`}
                  onClick={() => setTab('sample')}
                ><Download size={14} /> Sample File</button>
                <button
                  className={`sd-tab ${tab === 'playbook' ? 'sd-tab--active' : ''}`}
                  onClick={() => setTab('playbook')}
                ><BookOpen size={14} /> Playbook</button>
              </div>

              {tab === 'checklist' && (
                <CertChecklistView checklist={checklist} onRefresh={refresh} onAdvance={advanceStatus} />
              )}
              {tab === 'sample' && (
                <CertSampleView enrollment={enrollment} onSampleGenerated={refresh} />
              )}
              {tab === 'playbook' && (
                <CertPlaybookView playbook={playbook} mfrCode={enrollment.manufacturer.code} />
              )}
            </>
          ) : null}
        </div>

        <div className="sd-modal-foot">
          {checklist?.readyToActivate && checklist.enrollment.status !== 'active' && (
            <button className="sd-btn-primary" onClick={() => advanceStatus('active')}>
              <Award size={14} /> Mark Active (Cert Pass)
            </button>
          )}
          {checklist?.enrollment.status === 'draft' && (
            <button className="sd-btn-secondary" onClick={() => advanceStatus('certifying')}>
              Start Cert
            </button>
          )}
          <button className="sd-btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function CertChecklistView({ checklist, onRefresh, onAdvance }) {
  return (
    <div className="sd-cert-steps">
      {checklist.steps.map((step) => {
        const cfg = STEP_ICON[step.status] || STEP_ICON.pending;
        const Icon = cfg.icon;
        return (
          <div key={step.key} className="sd-cert-step" style={{ borderLeftColor: cfg.color }}>
            <div className="sd-cert-step-icon" style={{ background: cfg.bg, color: cfg.color }}>
              <Icon size={16} />
            </div>
            <div className="sd-cert-step-body">
              <div className="sd-cert-step-label">{step.label}</div>
              {step.detail && <div className="sd-cert-step-detail">{step.detail}</div>}
              {step.action && (
                <div className="sd-cert-step-hint">
                  <strong>{step.action.label}:</strong> {step.action.hint}
                </div>
              )}
            </div>
          </div>
        );
      })}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
        <button className="sd-btn-secondary sd-btn-sm" onClick={onRefresh}>
          <RefreshCw size={12} /> Re-check
        </button>
      </div>
    </div>
  );
}

function CertSampleView({ enrollment, onSampleGenerated }) {
  const [sample, setSample]     = useState(null);
  const [generating, setGen]    = useState(false);
  const [err, setErr]           = useState(null);

  const generate = async () => {
    setGen(true);
    setErr(null);
    try {
      const res = await generateCertSampleFile({
        manufacturerId: enrollment.manufacturerId,
      });
      setSample(res.data);
      onSampleGenerated?.();
    } catch (e) {
      setErr(e?.response?.data?.error || e.message);
    } finally {
      setGen(false);
    }
  };

  const download = () => {
    if (!sample) return;
    const blob = new Blob([sample.body], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = sample.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="sd-cert-sample">
      <p className="sd-form-hint">
        Builds a representative sample file in-memory covering all 9 cert scenarios — single sale, multi-qty, multipack-promo, mfr coupon, void, refund, age-verified, mixed-line, buydown-funded.
        No real transaction data is touched. Use this file as your first UAT submission to the manufacturer.
      </p>

      {err && <div className="sd-error"><AlertCircle size={14} /><span>{err}</span></div>}

      <div style={{ marginTop: '0.75rem' }}>
        <button className="sd-btn-primary" onClick={generate} disabled={generating}>
          {generating ? <><Loader2 size={14} className="sd-spin" /> Generating…</> : <><Download size={14} /> Generate Sample File</>}
        </button>
      </div>

      {sample && (
        <>
          <div className="sd-stats-grid" style={{ marginTop: '1rem' }}>
            <StatCard label="Transactions" value={sample.txCount} />
            <StatCard label="Line Items" value={sample.lineCount} />
            <StatCard label="Coupon Lines" value={sample.couponCount} />
            <StatCard label="Net Total" value={`$${Number(sample.totalAmount || 0).toFixed(2)}`} />
          </div>

          {sample.warnings?.length > 0 && sample.warnings.map((w, i) => (
            <div key={i} className="sd-banner sd-banner--warn" style={{ marginTop: '0.6rem' }}>
              <AlertCircle size={14} /><span>{w}</span>
            </div>
          ))}

          <div className="sd-form-section-label">Cert Scenario Coverage</div>
          <div className="sd-cert-scenarios">
            {sample.scenarios.map((s) => {
              const cfg = STEP_ICON[s.included ? 'done' : 'pending'];
              const Icon = cfg.icon;
              return (
                <div key={s.key} className="sd-cert-scenario" style={{ borderLeftColor: cfg.color }}>
                  <Icon size={14} style={{ color: cfg.color }} />
                  <span>{s.label}</span>
                </div>
              );
            })}
          </div>

          <div className="sd-form-section-label">File Preview</div>
          <pre className="sd-cert-file-preview">
            {sample.body.slice(0, 4000)}{sample.body.length > 4000 ? '\n…(truncated)' : ''}
          </pre>

          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.75rem' }}>
            <button className="sd-btn-secondary" onClick={generate} disabled={generating}>
              <RefreshCw size={14} /> Re-generate
            </button>
            <button className="sd-btn-primary" onClick={download}>
              <Download size={14} /> Download .{sample.manufacturer.fileExtension || 'txt'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function CertPlaybookView({ playbook, mfrCode }) {
  if (!playbook) {
    return (
      <div className="sd-empty">
        <BookOpen size={28} />
        <h3>No playbook for {mfrCode}</h3>
        <p>Cert playbooks exist for ITG, Altria (PMUSA/USSTC/Middleton), and RJR (EDLP/ScanData/VAP).</p>
      </div>
    );
  }

  return (
    <div className="sd-cert-playbook">
      <p className="sd-cert-playbook-overview">{playbook.overview}</p>

      <div className="sd-cert-playbook-meta">
        <div><strong>Estimated duration:</strong> {playbook.estimatedDuration}</div>
        <div><strong>Contact path:</strong> {playbook.contactPath}</div>
      </div>

      <div className="sd-form-section-label">Cert Steps</div>
      <ol className="sd-cert-playbook-steps">
        {playbook.steps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>

      {playbook.commonRejects?.length > 0 && (
        <>
          <div className="sd-form-section-label">Common Rejection Codes</div>
          <div className="sd-table-wrap">
            <table className="sd-table">
              <thead>
                <tr><th>Code</th><th>Meaning</th><th>Fix</th></tr>
              </thead>
              <tbody>
                {playbook.commonRejects.map((r, i) => (
                  <tr key={i}>
                    <td><code>{r.code}</code></td>
                    <td>{r.meaning}</td>
                    <td>{r.fix}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {playbook.notes && (
        <div className="sd-info-banner" style={{ marginTop: '1rem' }}>
          <FileText size={14} /><span>{playbook.notes}</span>
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   COUPONS TAB
   Catalog list + create + CSV import. POS redemption flow ships in S46.
   ═══════════════════════════════════════════════════════════════════════ */

function CouponsTab({ manufacturers }) {
  const [coupons, setCoupons] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState('');

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const [list, s] = await Promise.all([
        listManufacturerCoupons({ search }),
        getCouponRedemptionStats({ days: 30 }).catch(() => ({ data: { total: 0, submitted: 0, reimbursed: 0, pending: 0, totalAmount: 0 } })),
      ]);
      setCoupons(list.data || []);
      setStats(s.data || null);
    } catch (e) {
      toast.error(e?.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    const t = setTimeout(refresh, 200);
    return () => clearTimeout(t);
  }, [refresh]);

  return (
    <div className="sd-tab-body">
      {stats && (
        <div className="sd-stats-grid">
          <StatCard label="Active Catalog" value={coupons.filter(c => c.active).length} />
          <StatCard label="Redemptions (30d)" value={stats.total} />
          <StatCard label="Pending Reimbursement" value={stats.pending} />
          <StatCard label="Reimbursed (30d)" value={fmtMoney(stats.totalAmount)} />
        </div>
      )}

      <div className="sd-tab-toolbar">
        <input
          type="search"
          className="sd-search"
          placeholder="Search by serial, brand, or name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button className="sd-btn-secondary" onClick={refresh}>
          <RefreshCw size={14} /> Refresh
        </button>
        <button className="sd-btn-primary" onClick={() => setShowCreate(true)}>
          <Plus size={14} /> New Coupon
        </button>
      </div>

      {loading ? (
        <div className="sd-loading">Loading coupon catalog…</div>
      ) : coupons.length === 0 ? (
        <div className="sd-empty">
          <ScanLine size={28} />
          <h3>No coupons yet</h3>
          <p>
            Add coupons manually as they arrive from manufacturers, or import a batch via CSV.
            Once added, cashiers can scan or enter the coupon at checkout (Session 46), and the
            redemption is included in the next daily scan-data submission for reimbursement —
            no more mailing physical coupons monthly.
          </p>
          <button className="sd-btn-primary" onClick={() => setShowCreate(true)}>
            <Plus size={14} /> Create your first coupon
          </button>
        </div>
      ) : (
        <div className="sd-table-wrap">
          <table className="sd-table">
            <thead>
              <tr>
                <th>Serial</th>
                <th>Brand / Name</th>
                <th>Mfr Feed</th>
                <th>Discount</th>
                <th>Expires</th>
                <th>Redemptions</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {coupons.map((c) => (
                <tr key={c.id}>
                  <td><code>{c.serialNumber}</code></td>
                  <td>
                    <div><strong>{c.brandFamily}</strong></div>
                    {c.displayName && <div className="sd-row-sub">{c.displayName}</div>}
                  </td>
                  <td>{c.manufacturer?.shortName}</td>
                  <td>
                    {c.discountType === 'percent'
                      ? `${Number(c.discountAmount).toFixed(0)}%`
                      : fmtMoney(c.discountAmount)}
                    {c.requiresMultipack && c.minQty > 1 && (
                      <div className="sd-row-sub">Buy {c.minQty}+</div>
                    )}
                  </td>
                  <td>{fmtDate(c.expirationDate)}</td>
                  <td>{c._count?.redemptions ?? 0}</td>
                  <td>
                    {!c.active
                      ? <span className="sd-status-inactive">Inactive</span>
                      : new Date(c.expirationDate) < new Date()
                        ? <span className="sd-status-expired">Expired</span>
                        : <span className="sd-status-active">Active</span>}
                  </td>
                  <td>
                    <button
                      className="sd-btn-link sd-btn-warn"
                      onClick={async () => {
                        if (!confirm(`Delete coupon ${c.serialNumber}?`)) return;
                        try {
                          await deleteManufacturerCoupon(c.id);
                          toast.success('Coupon deleted');
                          refresh();
                        } catch (err) {
                          toast.error(err?.response?.data?.error || err.message);
                        }
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <CouponCreateModal
          manufacturers={manufacturers}
          onClose={() => setShowCreate(false)}
          onSaved={() => {
            setShowCreate(false);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function CouponCreateModal({ manufacturers, onClose, onSaved }) {
  const [form, setForm] = useState({
    manufacturerId: '',
    serialNumber: '',
    displayName: '',
    brandFamily: '',
    discountType: 'fixed',
    discountAmount: '',
    expirationDate: '',
    minQty: 1,
    requiresMultipack: false,
    qualifyingUpcs: '',
    fundedBy: 'manufacturer',
  });
  const [saving, setSaving] = useState(false);

  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const selectedMfr = manufacturers.find((m) => m.id === form.manufacturerId);

  const save = async () => {
    if (!form.manufacturerId || !form.serialNumber || !form.brandFamily ||
        !form.discountAmount || !form.expirationDate) {
      toast.warn('Fill all required fields');
      return;
    }
    setSaving(true);
    try {
      await createManufacturerCoupon({
        ...form,
        qualifyingUpcs: form.qualifyingUpcs.split(/[\s,;|]+/).filter(Boolean),
        discountAmount: Number(form.discountAmount),
        minQty: Number(form.minQty),
      });
      toast.success('Coupon added');
      onSaved();
    } catch (e) {
      toast.error(e?.response?.data?.error || e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="sd-modal-backdrop" onClick={onClose}>
      <div className="sd-modal" onClick={(e) => e.stopPropagation()}>
        <div className="sd-modal-head">
          <h3>New Manufacturer Coupon</h3>
          <button className="sd-icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="sd-modal-body">
          <div className="sd-form-grid">
            <div className="sd-form-row">
              <label>Manufacturer Feed *</label>
              <select value={form.manufacturerId} onChange={(e) => setField('manufacturerId', e.target.value)}>
                <option value="">— Select feed —</option>
                {manufacturers.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>
            <div className="sd-form-row">
              <label>Brand Family *</label>
              <select
                value={form.brandFamily}
                onChange={(e) => setField('brandFamily', e.target.value)}
                disabled={!selectedMfr}
              >
                <option value="">— Select brand —</option>
                {selectedMfr?.brandFamilies?.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </div>
            <div className="sd-form-row">
              <label>Serial Number *</label>
              <input
                type="text"
                value={form.serialNumber}
                onChange={(e) => setField('serialNumber', e.target.value)}
                placeholder="Coupon barcode / serial"
              />
            </div>
            <div className="sd-form-row">
              <label>Display Name</label>
              <input
                type="text"
                value={form.displayName}
                onChange={(e) => setField('displayName', e.target.value)}
                placeholder="Optional UI label"
              />
            </div>
            <div className="sd-form-row">
              <label>Discount Type *</label>
              <select value={form.discountType} onChange={(e) => setField('discountType', e.target.value)}>
                <option value="fixed">Fixed amount ($)</option>
                <option value="percent">Percent (%)</option>
              </select>
            </div>
            <div className="sd-form-row">
              <label>Discount Amount *</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.discountAmount}
                onChange={(e) => setField('discountAmount', e.target.value)}
                placeholder={form.discountType === 'percent' ? '15' : '1.00'}
              />
            </div>
            <div className="sd-form-row">
              <label>Expiration *</label>
              <input
                type="date"
                value={form.expirationDate}
                onChange={(e) => setField('expirationDate', e.target.value)}
              />
            </div>
            <div className="sd-form-row">
              <label>Min Qty</label>
              <input
                type="number"
                min="1"
                value={form.minQty}
                onChange={(e) => setField('minQty', e.target.value)}
              />
            </div>
            <div className="sd-form-row">
              <label>
                <input
                  type="checkbox"
                  checked={form.requiresMultipack}
                  onChange={(e) => setField('requiresMultipack', e.target.checked)}
                  style={{ marginRight: 8 }}
                />
                Requires multipack
              </label>
            </div>
            <div className="sd-form-row">
              <label>Funded By</label>
              <select value={form.fundedBy} onChange={(e) => setField('fundedBy', e.target.value)}>
                <option value="manufacturer">Manufacturer</option>
                <option value="retailer">Retailer (own promo)</option>
              </select>
            </div>
            <div className="sd-form-row sd-form-row--full">
              <label>Qualifying UPCs (optional, space/comma separated)</label>
              <textarea
                rows={2}
                value={form.qualifyingUpcs}
                onChange={(e) => setField('qualifyingUpcs', e.target.value)}
                placeholder="028200001047 028200001054"
              />
              <div className="sd-form-hint">
                Leave blank to qualify any tobacco product matching the brand family.
              </div>
            </div>
          </div>
        </div>
        <div className="sd-modal-foot">
          <button className="sd-btn-secondary" onClick={onClose}>Cancel</button>
          <button className="sd-btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Add Coupon'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   SUBMISSIONS TAB  (read-only — Session 47 ships file generation)
   ═══════════════════════════════════════════════════════════════════════ */

function SubmissionsTab({ manufacturers, stores }) {
  const [submissions, setSubmissions] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailFor, setDetailFor] = useState(null); // submission row being inspected

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const [list, s] = await Promise.all([
        listScanDataSubmissions({ limit: 200 }),
        getScanDataSubmissionStats({ days: 30 }).catch(() => ({ data: { total: 0, byStatus: {} } })),
      ]);
      setSubmissions(list.data || []);
      setStats(s.data || null);
    } catch (e) {
      toast.error(e?.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <div className="sd-tab-body">
      {stats && (
        <div className="sd-stats-grid">
          <StatCard label="Submissions (30d)" value={stats.total} />
          <StatCard label="Acknowledged" value={stats.byStatus?.acknowledged || 0} />
          <StatCard label="Rejected" value={stats.byStatus?.rejected || 0} />
          <StatCard label="In-flight" value={(stats.byStatus?.queued || 0) + (stats.byStatus?.uploading || 0) + (stats.byStatus?.uploaded || 0)} />
        </div>
      )}

      <div className="sd-tab-toolbar">
        <span className="sd-toolbar-info">
          Click any row to inspect line-by-line ack details, paste a manufacturer ack file for reconciliation, or download the original submission.
        </span>
        <button className="sd-btn-secondary" onClick={refresh}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {loading ? (
        <div className="sd-loading">Loading submission log…</div>
      ) : submissions.length === 0 ? (
        <div className="sd-empty">
          <FileText size={28} />
          <h3>No submissions yet</h3>
          <p>Once at least one enrollment is in <strong>certifying</strong> or <strong>active</strong> state, the nightly scheduler will produce a file per (store × manufacturer × date) here. You can also use <code>POST /scan-data/submissions/regenerate</code> to manually create one for any date range.</p>
        </div>
      ) : (
        <div className="sd-table-wrap">
          <table className="sd-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Store</th>
                <th>Manufacturer</th>
                <th>File</th>
                <th>Tx</th>
                <th>Lines (✓ / ✗)</th>
                <th>Status</th>
                <th>Acknowledged</th>
              </tr>
            </thead>
            <tbody>
              {submissions.map((s) => (
                <tr key={s.id} className="sd-table-row-clickable" onClick={() => setDetailFor(s)}>
                  <td>{fmtDate(s.submissionDate)}</td>
                  <td>{stores.find((st) => st.id === s.storeId)?.name || s.storeId}</td>
                  <td>{s.manufacturer?.shortName}</td>
                  <td><code>{s.fileName}</code></td>
                  <td>{s.txCount}</td>
                  <td>
                    {(s.acceptedCount > 0 || s.rejectedCount > 0)
                      ? <>
                          <span style={{ color: '#16a34a', fontWeight: 600 }}>{s.acceptedCount}</span>
                          {' / '}
                          <span style={{ color: '#dc2626', fontWeight: 600 }}>{s.rejectedCount}</span>
                        </>
                      : '—'}
                  </td>
                  <td><span className={`sd-sub-status sd-sub-status--${s.status}`}>{s.status}</span></td>
                  <td>{s.ackedAt ? fmtDateTime(s.ackedAt) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detailFor && (
        <SubmissionDetailModal
          submissionRow={detailFor}
          onClose={() => setDetailFor(null)}
          onChanged={() => { setDetailFor(null); refresh(); }}
        />
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   SUBMISSION DETAIL MODAL (Session 48)
   Per-line ack status + manual ack paste + download.
   ═══════════════════════════════════════════════════════════════════════ */

function SubmissionDetailModal({ submissionRow, onClose, onChanged }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState(null);
  const [ackText, setAckText] = useState('');
  const [pasting, setPasting] = useState(false);
  const [filter, setFilter]   = useState('all'); // 'all' | 'accepted' | 'rejected' | 'warning'

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const res = await getSubmissionAckLines(submissionRow.id);
        if (cancelled) return;
        setData(res.data);
      } catch (e) {
        if (cancelled) return;
        setErr(e?.response?.data?.error || e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [submissionRow.id]);

  const submitAck = async () => {
    if (!ackText.trim()) {
      toast.warn('Paste the ack file contents first.');
      return;
    }
    setPasting(true);
    try {
      const res = await processSubmissionAck(submissionRow.id, {
        ackContent: ackText,
        fileName:   `manual-${Date.now()}`,
      });
      const r = res.data || {};
      toast.success(
        `Ack processed — ${r.acceptedCount || 0} accepted, ${r.rejectedCount || 0} rejected ` +
        `(${r.redemptionsAccepted || 0} reimbursed, ${r.redemptionsRejected || 0} flagged).`
      );
      setAckText('');
      onChanged?.();
    } catch (e) {
      toast.error(e?.response?.data?.error || e.message);
    } finally {
      setPasting(false);
    }
  };

  const filteredLines = useMemo(() => {
    if (!data) return [];
    if (filter === 'all') return data.ackLines;
    return data.ackLines.filter((l) => l.status === filter);
  }, [data, filter]);

  return (
    <div className="sd-modal-backdrop" onClick={onClose}>
      <div className="sd-modal sd-modal--wide" onClick={(e) => e.stopPropagation()}>
        <div className="sd-modal-head">
          <h3>Submission Detail — {submissionRow.fileName}</h3>
          <button className="sd-icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="sd-modal-body">
          {loading ? (
            <div className="sd-loading">Loading ack details…</div>
          ) : err ? (
            <div className="sd-error"><AlertCircle size={16} /><span>{err}</span></div>
          ) : data ? (
            <>
              <div className="sd-modal-info">
                <span><strong>Manufacturer:</strong> {data.submission.manufacturer?.name}</span>
                <span><strong>Period:</strong> {fmtDate(data.submission.periodStart)} – {fmtDate(data.submission.periodEnd)}</span>
                <span><strong>Status:</strong> <span className={`sd-sub-status sd-sub-status--${data.submission.status}`}>{data.submission.status}</span></span>
                {data.submission.errorMessage && (
                  <span><strong>Error:</strong> <em>{data.submission.errorMessage}</em></span>
                )}
              </div>

              <div className="sd-stats-grid" style={{ marginBottom: '1rem' }}>
                <StatCard label="Tx Submitted"       value={data.submission.txCount} />
                <StatCard label="Coupon Redemptions" value={data.submission.couponCount} />
                <StatCard label="Lines Accepted"     value={data.submission.acceptedCount || 0} />
                <StatCard label="Lines Rejected"     value={data.submission.rejectedCount || 0} />
              </div>

              <div className="sd-form-section-label">Manufacturer Ack File</div>
              {data.ackLines.length === 0 ? (
                <>
                  <p className="sd-form-hint">
                    No ack received yet. The SFTP poller checks the manufacturer's <code>/ack/</code> directory every 30 minutes.
                    During cert (when mfrs deliver acks via email/portal instead of SFTP), paste the ack file contents below to run reconciliation manually.
                  </p>
                  <textarea
                    className="sd-search"
                    style={{ width: '100%', minHeight: '160px', fontFamily: 'monospace', fontSize: '0.78rem' }}
                    placeholder="Paste the manufacturer ack file contents here…"
                    value={ackText}
                    onChange={(e) => setAckText(e.target.value)}
                  />
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                    <button className="sd-btn-primary" onClick={submitAck} disabled={pasting || !ackText.trim()}>
                      {pasting ? 'Processing…' : 'Process Ack'}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="sd-tab-toolbar" style={{ marginBottom: '0.5rem' }}>
                    <span className="sd-toolbar-info">
                      {data.ackLines.length} line{data.ackLines.length === 1 ? '' : 's'} ·
                      Filter:
                    </span>
                    {['all', 'accepted', 'rejected', 'warning'].map((f) => (
                      <button
                        key={f}
                        className={`sd-btn-link ${filter === f ? 'sd-btn-link--active' : ''}`}
                        onClick={() => setFilter(f)}
                      >
                        {f === 'all' ? 'All' :
                          f === 'accepted' ? `Accepted (${data.ackLines.filter(l => l.status === 'accepted').length})` :
                          f === 'rejected' ? `Rejected (${data.ackLines.filter(l => l.status === 'rejected').length})` :
                          `Warning (${data.ackLines.filter(l => l.status === 'warning').length})`}
                      </button>
                    ))}
                  </div>

                  <div className="sd-table-wrap">
                    <table className="sd-table">
                      <thead>
                        <tr>
                          <th>Tx #</th>
                          <th>UPC</th>
                          <th>Status</th>
                          <th>Code</th>
                          <th>Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredLines.map((line, i) => (
                          <tr key={`${line.recordRef}-${i}`}>
                            <td><code>{line.txNumber || '—'}</code></td>
                            <td><code>{line.upc || '—'}</code></td>
                            <td>
                              <span className={`sd-sub-status sd-sub-status--${line.status === 'accepted' ? 'acknowledged' : line.status === 'rejected' ? 'rejected' : 'queued'}`}>
                                {line.status}
                              </span>
                            </td>
                            <td>{line.code ? <code>{line.code}</code> : '—'}</td>
                            <td>{line.reason || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          ) : null}
        </div>
        <div className="sd-modal-foot">
          {data && (
            <a
              className="sd-btn-secondary"
              href={`/api/scan-data/submissions/${submissionRow.id}/download`}
              download={data.submission.fileName}
            >
              Download Submission File
            </a>
          )}
          <button className="sd-btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="sd-stat-card">
      <div className="sd-stat-label">{label}</div>
      <div className="sd-stat-value">{value}</div>
    </div>
  );
}
