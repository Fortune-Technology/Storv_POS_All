// ─────────────────────────────────────────────────
// Admin Vendor Onboarding Review — S77 Phase 1
//
// Status tabs (with counts) → list of submissions → detail panel for the
// selected one. Admin can:
//   • Add internal notes (auto-save)
//   • Mark "reviewed" (acknowledged but not yet contracted)
//   • Reject with reason (locks vendor out + surfaces reason on awaiting page)
//
// Phase 2 will add a "Generate Contract" button here. Phase 3 will add
// "Approve & Activate" (manual plan assignment).
// ─────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import {
  Building2, Mail, Phone, MapPin, Briefcase, Calendar, Hash,
  Store, Cpu, Sparkles, AlertCircle, CheckCircle2, Loader, RefreshCw, FileText, FilePlus,
} from 'lucide-react';
import {
  adminListVendorOnboardings,
  adminGetVendorOnboarding,
  adminUpdateVendorOnboarding,
  type VendorOnboardingRecord,
} from '../services/api';
import { useConfirm } from '../hooks/useConfirmDialog';
// S77 Phase 2 — generate contract from this detail panel
import GenerateContractModal from '../components/GenerateContractModal';
import './AdminVendorOnboardings.css';

const STATUS_TABS = [
  { key: '',                 label: 'All' },
  { key: 'submitted',        label: 'Submitted', accent: '#3b82f6' },
  { key: 'reviewed',         label: 'Reviewed', accent: '#a855f7' },
  { key: 'contract_sent',    label: 'Contract Sent', accent: '#0ea5e9' },
  { key: 'contract_signed',  label: 'Signed', accent: '#06b6d4' },
  { key: 'approved',         label: 'Approved', accent: '#22c55e' },
  { key: 'rejected',         label: 'Rejected', accent: '#ef4444' },
];

const STATUS_COLORS: Record<string, string> = {
  draft:           '#64748b',
  submitted:       '#3b82f6',
  reviewed:        '#a855f7',
  contract_sent:   '#0ea5e9',
  contract_signed: '#06b6d4',
  approved:        '#22c55e',
  rejected:        '#ef4444',
};

const MODULE_LABELS: Record<string, string> = {
  pos_core: 'Core POS', lottery: 'Lottery', fuel: 'Fuel', ecommerce: 'eCommerce',
  marketplace: 'Marketplace', exchange: 'Exchange', loyalty: 'Loyalty',
  scan_data: 'Scan Data (Tobacco)', ai_assistant: 'AI Assistant',
  vendor_orders: 'Vendor Orders', invoice_ocr: 'Invoice OCR',
  multi_store: 'Multi-Store Dashboard', predictions: 'Predictions',
};

const HARDWARE_LABELS: Record<string, string> = {
  posTerminal: 'POS Terminal', receiptPrinter: 'Receipt Printer',
  cashDrawer: 'Cash Drawer', scanner: 'Barcode Scanner',
  cardTerminal: 'Card Terminal', customerDisplay: 'Customer Display',
  labelPrinter: 'Label Printer', fuelIntegration: 'Fuel Integration',
  scaleIntegration: 'Scale Integration',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className="vor-badge" style={{ background: `${STATUS_COLORS[status] || '#64748b'}33`, color: STATUS_COLORS[status] || '#64748b', borderColor: `${STATUS_COLORS[status] || '#64748b'}66` }}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

interface AdminVendorOnboardingsProps {
  /** Mounted inside a hub (AdminVendorPipeline) — hide the page-level header. */
  embedded?: boolean;
}

export default function AdminVendorOnboardings({ embedded = false }: AdminVendorOnboardingsProps = {}) {
  // S77 — accept ?status=… so the admin dashboard's Pending Approval card
  // can deep-link to the right tab.
  const [searchParams] = useSearchParams();
  const initialStatus = searchParams.get('status') || 'submitted';
  const [tab, setTab] = useState<string>(initialStatus);
  const [list, setList] = useState<VendorOnboardingRecord[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loadingList, setLoadingList] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<VendorOnboardingRecord | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);
  const [notes, setNotes] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [showReject, setShowReject] = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);
  const confirm = useConfirm();

  const loadList = async (statusFilter: string) => {
    setLoadingList(true);
    try {
      const res = await adminListVendorOnboardings(statusFilter ? { status: statusFilter } : {});
      setList(res.onboardings);
      setCounts(res.countsByStatus);
      // Auto-select first if nothing selected.
      if (!selectedId && res.onboardings.length > 0) {
        setSelectedId(res.onboardings[0].id);
      } else if (selectedId && !res.onboardings.find(o => o.id === selectedId)) {
        setSelectedId(res.onboardings[0]?.id || null);
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to load onboardings.');
    } finally {
      setLoadingList(false);
    }
  };

  const loadDetail = async (id: string) => {
    setLoadingDetail(true);
    try {
      const res = await adminGetVendorOnboarding(id);
      setDetail(res.onboarding);
      setNotes(res.onboarding.adminNotes || '');
      setRejectionReason(res.onboarding.rejectionReason || '');
      setShowReject(false);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to load onboarding detail.');
    } finally {
      setLoadingDetail(false);
    }
  };

  useEffect(() => { loadList(tab); /* eslint-disable-line */ }, [tab]);
  useEffect(() => { if (selectedId) loadDetail(selectedId); }, [selectedId]);

  const saveNotes = async () => {
    if (!detail) return;
    setSavingNotes(true);
    try {
      const res = await adminUpdateVendorOnboarding(detail.id, { adminNotes: notes });
      setDetail(res.onboarding);
      toast.success('Notes saved.');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to save notes.');
    } finally {
      setSavingNotes(false);
    }
  };

  const markReviewed = async () => {
    if (!detail) return;
    try {
      const res = await adminUpdateVendorOnboarding(detail.id, { status: 'reviewed', adminNotes: notes });
      setDetail(res.onboarding);
      await loadList(tab);
      toast.success('Marked as reviewed.');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to update status.');
    }
  };

  const submitReject = async () => {
    if (!detail) return;
    if (!rejectionReason.trim()) {
      toast.error('Please provide a reason for rejection.');
      return;
    }
    const ok = await confirm({
      title: 'Reject this application?',
      message: 'The vendor will see the rejection reason on their awaiting page and be unable to access the platform. This can be reversed by changing status back later.',
      confirmLabel: 'Reject',
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await adminUpdateVendorOnboarding(detail.id, {
        status: 'rejected',
        rejectionReason,
        adminNotes: notes,
      });
      setDetail(res.onboarding);
      await loadList(tab);
      setShowReject(false);
      toast.success('Application rejected.');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to reject.');
    }
  };

  const visibleHardware = useMemo(() => {
    if (!detail?.hardwareNeeds) return [];
    return Object.entries(detail.hardwareNeeds)
      .filter(([, v]) => v && v !== 0)
      .map(([k, v]) => ({ key: k, label: HARDWARE_LABELS[k] || k, value: v }));
  }, [detail]);

  return (
    <div className={`vor-page${embedded ? ' vor-page--embedded' : ''}`}>
      {!embedded && (
        <header className="vor-page-header">
          <div className="vor-page-header-icon"><FileText size={20} /></div>
          <div>
            <h1>Vendor Onboarding Reviews</h1>
            <p>Business questionnaire submissions awaiting administrator review.</p>
          </div>
        </header>
      )}

      <div className="vor-tabs">
        {STATUS_TABS.map(t => (
          <button
            key={t.key}
            className={`vor-tab ${tab === t.key ? 'is-active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {t.key && counts[t.key] !== undefined && counts[t.key] > 0 && (
              <span className="vor-tab-count">{counts[t.key]}</span>
            )}
          </button>
        ))}
        <button
          className="vor-refresh-btn"
          onClick={() => loadList(tab)}
          disabled={loadingList}
          title="Refresh"
        >
          <RefreshCw size={14} className={loadingList ? 'vor-spin' : ''} />
        </button>
      </div>

      <div className="vor-layout">
        {/* ── List ── */}
        <div className="vor-list">
          {loadingList ? (
            <div className="vor-empty"><Loader size={20} className="vor-spin" /></div>
          ) : list.length === 0 ? (
            <div className="vor-empty">No submissions in this category.</div>
          ) : (
            list.map(o => (
              <button
                key={o.id}
                className={`vor-list-item ${selectedId === o.id ? 'is-selected' : ''}`}
                onClick={() => setSelectedId(o.id)}
              >
                <div className="vor-list-item-row">
                  <strong>{o.businessLegalName || o.fullName || '—'}</strong>
                  <StatusBadge status={o.status} />
                </div>
                <div className="vor-list-item-sub">{o.fullName} · {o.email}</div>
                <div className="vor-list-item-meta">
                  {o.industry && <span>{o.industry.replace(/_/g, ' ')}</span>}
                  {o.numStoresRange && <span>· {o.numStoresRange} store{o.numStoresRange !== '1' ? 's' : ''}</span>}
                  {o.submittedAt && <span>· {new Date(o.submittedAt).toLocaleDateString()}</span>}
                </div>
              </button>
            ))
          )}
        </div>

        {/* ── Detail panel ── */}
        <div className="vor-detail">
          {!detail ? (
            <div className="vor-empty">Select a submission to review.</div>
          ) : loadingDetail ? (
            <div className="vor-empty"><Loader size={20} className="vor-spin" /></div>
          ) : (
            <>
              <div className="vor-detail-header">
                <div>
                  <h2>{detail.businessLegalName || detail.fullName}</h2>
                  <p className="vor-detail-sub">
                    Submitted {fmtDate(detail.submittedAt)} <StatusBadge status={detail.status} />
                  </p>
                </div>
                <div className="vor-detail-actions">
                  {detail.status === 'submitted' && (
                    <button className="vor-btn vor-btn-primary" onClick={markReviewed}>
                      <CheckCircle2 size={14} /> Mark Reviewed
                    </button>
                  )}
                  {/* S77 Phase 2 — Generate Contract */}
                  {detail.status !== 'rejected' && detail.status !== 'approved' && (
                    <button className="vor-btn vor-btn-primary" onClick={() => setShowGenerate(true)}>
                      <FilePlus size={14} /> Generate Contract
                    </button>
                  )}
                  {detail.status !== 'rejected' && detail.status !== 'approved' && (
                    <button className="vor-btn vor-btn-danger" onClick={() => setShowReject(s => !s)}>
                      <AlertCircle size={14} /> Reject
                    </button>
                  )}
                </div>
              </div>

              {showReject && (
                <div className="vor-reject-box">
                  <label>Reason for rejection (visible to vendor)</label>
                  <textarea
                    className="vor-textarea"
                    rows={3}
                    value={rejectionReason}
                    onChange={e => setRejectionReason(e.target.value)}
                    placeholder="e.g. Business type not currently supported in your region…"
                  />
                  <div className="vor-reject-actions">
                    <button className="vor-btn" onClick={() => setShowReject(false)}>Cancel</button>
                    <button className="vor-btn vor-btn-danger" onClick={submitReject}>Confirm Rejection</button>
                  </div>
                </div>
              )}

              <div className="vor-section">
                <h3><Building2 size={14} /> Identity</h3>
                <div className="vor-grid">
                  <Item icon={<Mail size={12} />}     label="Email"        value={detail.email} />
                  <Item icon={<Phone size={12} />}    label="Phone"        value={detail.phone} />
                  <Item icon={<Briefcase size={12} />} label="Business Type" value={detail.businessType} />
                  <Item icon={<Calendar size={12} />} label="Years"        value={detail.yearsInBusiness} />
                  <Item icon={<Hash size={12} />}     label="EIN"          value={detail.ein} />
                  <Item icon={<Building2 size={12} />} label="DBA"         value={detail.dbaName} />
                  <Item icon={<MapPin size={12} />}   label="Address"      value={[detail.businessAddress, detail.businessCity, detail.businessState, detail.businessZip].filter(Boolean).join(', ')} />
                </div>
              </div>

              <div className="vor-section">
                <h3><Store size={14} /> Operations</h3>
                <div className="vor-grid">
                  <Item label="Industry"            value={detail.industry?.replace(/_/g, ' ')} />
                  <Item label="Stores"              value={`${detail.numStoresRange || '—'}${detail.numStoresExact ? ` (${detail.numStoresExact} exact)` : ''}`} />
                  <Item label="Registers/store"     value={detail.numRegistersPerStore} />
                  <Item label="Monthly volume"      value={detail.monthlyVolumeRange} />
                  <Item label="Avg tx/day"          value={detail.avgTxPerDay} />
                  <Item label="Current POS"         value={detail.currentPOS} />
                  <Item label="Go-live timeline"    value={detail.goLiveTimeline} />
                </div>
              </div>

              <div className="vor-section">
                <h3><Sparkles size={14} /> Requested Modules ({detail.requestedModules.length})</h3>
                <div className="vor-chips">
                  {detail.requestedModules.length === 0 ? (
                    <span className="vor-empty-inline">None</span>
                  ) : detail.requestedModules.map(m => (
                    <span key={m} className="vor-chip">{MODULE_LABELS[m] || m}</span>
                  ))}
                </div>
              </div>

              {visibleHardware.length > 0 && (
                <div className="vor-section">
                  <h3><Cpu size={14} /> Hardware Needs</h3>
                  <div className="vor-grid">
                    {visibleHardware.map(h => (
                      <Item key={h.key} label={h.label} value={typeof h.value === 'boolean' ? (h.value ? 'Yes' : '—') : h.value} />
                    ))}
                  </div>
                </div>
              )}

              {(detail.specialRequirements || detail.hearAboutUs) && (
                <div className="vor-section">
                  <h3>Additional Context</h3>
                  <div className="vor-grid">
                    <Item label="How they heard"   value={detail.hearAboutUs} />
                    <Item label="Referral source"  value={detail.referralSource} />
                  </div>
                  {detail.specialRequirements && (
                    <div className="vor-special">
                      <strong>Special requirements:</strong>
                      <p>{detail.specialRequirements}</p>
                    </div>
                  )}
                </div>
              )}

              <div className="vor-section">
                <h3>Internal Notes (admin-only)</h3>
                <textarea
                  className="vor-textarea"
                  rows={4}
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Notes about this vendor — pricing tier discussion, follow-ups, special considerations…"
                />
                <button className="vor-btn vor-btn-secondary" onClick={saveNotes} disabled={savingNotes}>
                  {savingNotes ? <Loader size={14} className="vor-spin" /> : 'Save Notes'}
                </button>
              </div>

              <div className="vor-meta-footer">
                Reviewed by: {detail.reviewedBy?.name || '—'} {detail.reviewedAt && `at ${fmtDate(detail.reviewedAt)}`}
              </div>
            </>
          )}
        </div>
      </div>

      {/* S77 Phase 2 — Generate Contract modal */}
      {detail && (
        <GenerateContractModal
          open={showGenerate}
          onboarding={detail}
          onClose={() => setShowGenerate(false)}
          onCreated={() => { /* admin opens contract from /contracts page */ }}
        />
      )}
    </div>
  );
}

function Item({ icon, label, value }: { icon?: React.ReactNode; label: string; value: any }) {
  const display = (value === null || value === undefined || value === '') ? '—' : String(value);
  return (
    <div className="vor-item">
      <div className="vor-item-label">{icon}{label}</div>
      <div className="vor-item-value">{display}</div>
    </div>
  );
}
