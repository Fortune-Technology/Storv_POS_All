// ─────────────────────────────────────────────────
// Admin Vendor Pipeline — UNIFIED single-flow view (S80 rewrite)
//
// Replaces the prior tabbed hub (Onboardings | Contracts) with one row per
// vendor and a single derived `pipelineStatus`. Tabs are stages:
//   All / Submitted / Drafts / Sent / Signed / Activated / Rejected
//
// Each row shows the vendor (from VendorOnboarding) plus the latest contract
// (when one exists). The detail panel switches between onboarding-only mode
// (when there's no contract yet — admin can mark reviewed, generate contract,
// or reject) and contract mode (admin can send / resend / cancel / activate /
// download PDF). All destructive actions go through <ReasonModal>.
//
// Renames (label-only — backend enums unchanged):
//   contract.status='countersigned' → display "Activated"
//   contract.status='cancelled'     → display "Rejected" (consolidated with
//                                     onboarding rejected)
//   onboarding.status='reviewed'    → label "Drafts" tab in the spec, but
//                                     here Drafts is mapped to contract.draft.
// ─────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import {
  Workflow, Loader, RefreshCw, Eye, FilePlus, Send, X, Repeat, CheckCircle2, Download, AlertCircle,
  Building2, Mail, Phone, Briefcase, Calendar, Hash, MapPin, Store, Cpu, Sparkles, FileText,
  Tag, DollarSign,
} from 'lucide-react';
import {
  adminListVendorPipeline,
  adminGetVendorOnboarding,
  adminUpdateVendorOnboarding,
  adminGetContract,
  adminSendContract,
  adminResendContract,
  adminCancelContract,
  adminActivateContract,
  adminDownloadContractPdf,
  adminListPlans,
  type VendorPipelineRow,
  type PipelineStatus,
  type VendorOnboardingRecord,
  type ContractRecord,
} from '../services/api';
import api from '../services/api';
import { useConfirm } from '../hooks/useConfirmDialog';
import GenerateContractModal from '../components/GenerateContractModal';
import ReasonModal from '../components/ReasonModal';
import './AdminVendorPipeline.css';

// ─── Tab config ─────────────────────────────────────────────────────────
const TABS: { key: '' | PipelineStatus; label: string; accent?: string }[] = [
  { key: '',          label: 'All' },
  { key: 'submitted', label: 'Submitted', accent: '#3b82f6' },
  { key: 'drafts',    label: 'Drafts',    accent: '#a855f7' },
  { key: 'sent',      label: 'Sent',      accent: '#0ea5e9' },
  { key: 'signed',    label: 'Signed',    accent: '#06b6d4' },
  { key: 'activated', label: 'Activated', accent: '#22c55e' },
  { key: 'rejected',  label: 'Rejected',  accent: '#ef4444' },
];

const STATUS_LABEL: Record<PipelineStatus, string> = {
  submitted: 'Submitted',
  drafts:    'Drafts',
  sent:      'Sent',
  signed:    'Signed',
  activated: 'Activated',
  rejected:  'Rejected',
};
const STATUS_COLOR: Record<PipelineStatus, string> = {
  submitted: '#3b82f6',
  drafts:    '#a855f7',
  sent:      '#0ea5e9',
  signed:    '#06b6d4',
  activated: '#22c55e',
  rejected:  '#ef4444',
};

// Module + hardware label maps (preserved from former AdminVendorOnboardings page)
const MODULE_LABELS: Record<string, string> = {
  pos_core: 'Core POS', lottery: 'Lottery', fuel: 'Fuel', ecommerce: 'eCommerce',
  marketplace: 'Marketplace', exchange: 'Exchange', loyalty: 'Loyalty',
  scan_data: 'Scan Data (Tobacco)', ai_assistant: 'AI Assistant',
  vendor_orders: 'Vendor Orders', invoice_ocr: 'Invoice OCR',
  multi_store: 'Multi-Store Dashboard', predictions: 'Predictions',
};
// Plan add-on keys come from PlanAddon.key (see backend/prisma/seedPlanModules.ts
// STARTER_ADDONS). Kept in sync with the seeder; falls back to the raw key.
const ADDON_LABELS: Record<string, string> = {
  lottery: 'Lottery',
  fuel: 'Fuel',
  ecommerce: 'E-Commerce / Online Store',
  marketplace: 'Marketplace Integration',
  exchange: 'StoreVeu Exchange',
  loyalty: 'Loyalty Program',
  scan_data: 'Tobacco Scan Data',
  ai_assistant: 'AI Assistant',
  vendor_orders: 'Vendor Orders / Auto Reorder',
  invoice_ocr: 'Invoice OCR / Bulk Imports',
  multi_store_dashboard: 'Multi-Store Dashboard',
  predictions: 'Sales Predictions',
  grocery: 'Grocery & Scale Features',
};
const PLAN_LABELS: Record<string, string> = {
  starter: 'Starter',
  pro: 'Pro',
};
const HARDWARE_LABELS: Record<string, string> = {
  posTerminal: 'POS Terminal', receiptPrinter: 'Receipt Printer',
  cashDrawer: 'Cash Drawer', scanner: 'Barcode Scanner',
  cardTerminal: 'Card Terminal', customerDisplay: 'Customer Display',
  labelPrinter: 'Label Printer', fuelIntegration: 'Fuel Integration',
  scaleIntegration: 'Scale Integration',
};

function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

function StatusBadge({ status }: { status: PipelineStatus }) {
  const color = STATUS_COLOR[status];
  return (
    <span
      className="vp-badge"
      style={{ background: `${color}1f`, color, borderColor: `${color}66` }}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────
export default function AdminVendorPipeline() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const confirm = useConfirm();

  // ── Tab state, URL-synced ──
  const queryTab = params.get('tab');
  const initialTab = (TABS.some(t => t.key === queryTab) ? queryTab : '') as '' | PipelineStatus;
  const [tab, setTab] = useState<'' | PipelineStatus>(initialTab);
  useEffect(() => {
    const next = new URLSearchParams(params);
    if (tab) next.set('tab', tab); else next.delete('tab');
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // ── List state ──
  const [rows, setRows] = useState<VendorPipelineRow[]>([]);
  const [counts, setCounts] = useState<Record<PipelineStatus, number>>({
    submitted: 0, drafts: 0, sent: 0, signed: 0, activated: 0, rejected: 0,
  });
  const [loadingList, setLoadingList] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // ── Detail state — onboarding always loaded; contract loaded only when present ──
  const [detailOnboarding, setDetailOnboarding] = useState<VendorOnboardingRecord | null>(null);
  const [detailContract, setDetailContract] = useState<ContractRecord | null>(null);
  const [renderedHtml, setRenderedHtml] = useState('');
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [notes, setNotes] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [busyAction, setBusyAction] = useState<null | 'send' | 'resend' | 'cancel' | 'download' | 'reviewed'>(null);

  // ── Modal state ──
  const [showGenerate, setShowGenerate] = useState(false);
  const [showActivate, setShowActivate] = useState(false);
  // Mandatory-reason modal — used by both onboarding-reject + contract-cancel.
  // Discriminated by `kind` so the same modal serves both flows.
  const [reasonModal, setReasonModal] = useState<null | { kind: 'reject_onboarding' | 'cancel_contract' }>(null);
  const [reasonBusy, setReasonBusy] = useState(false);

  // ── List loader ──
  const loadList = async (status: '' | PipelineStatus, preserveSelection = true) => {
    setLoadingList(true);
    try {
      const res = await adminListVendorPipeline(status ? { status } : {});
      setRows(res.rows);
      setCounts(res.countsByStatus);
      // Preserve current selection if it's still in the filtered list,
      // otherwise fall back to the first row.
      if (preserveSelection && selectedId && res.rows.some(r => r.id === selectedId)) {
        // selection preserved
      } else if (res.rows.length > 0) {
        setSelectedId(res.rows[0].id);
      } else {
        setSelectedId(null);
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to load pipeline.');
    } finally {
      setLoadingList(false);
    }
  };

  // ── Detail loader — gets onboarding + (when present) latest contract. ──
  const loadDetail = async (onboardingId: string) => {
    setLoadingDetail(true);
    try {
      const ob = await adminGetVendorOnboarding(onboardingId);
      setDetailOnboarding(ob.onboarding);
      setNotes(ob.onboarding.adminNotes || '');

      // Find this row in the list to know whether a contract exists.
      const row = rows.find(r => r.id === onboardingId);
      if (row?.latestContract) {
        const c = await adminGetContract(row.latestContract.id);
        setDetailContract(c.contract);
        setRenderedHtml(c.renderedHtml);
      } else {
        setDetailContract(null);
        setRenderedHtml('');
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to load detail.');
    } finally {
      setLoadingDetail(false);
    }
  };

  useEffect(() => { loadList(tab); /* eslint-disable-line */ }, [tab]);
  useEffect(() => { if (selectedId) loadDetail(selectedId); /* eslint-disable-line */ }, [selectedId, rows]);

  // ── Actions ──

  const saveNotes = async () => {
    if (!detailOnboarding) return;
    setSavingNotes(true);
    try {
      const res = await adminUpdateVendorOnboarding(detailOnboarding.id, { adminNotes: notes });
      setDetailOnboarding(res.onboarding);
      toast.success('Notes saved.');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to save notes.');
    } finally {
      setSavingNotes(false);
    }
  };

  const markReviewed = async () => {
    if (!detailOnboarding) return;
    setBusyAction('reviewed');
    try {
      const res = await adminUpdateVendorOnboarding(detailOnboarding.id, {
        status: 'reviewed', adminNotes: notes,
      });
      setDetailOnboarding(res.onboarding);
      await loadList(tab);
      toast.success('Marked as reviewed.');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to update status.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleSendContract = async () => {
    if (!detailContract || busyAction) return;
    const ok = await confirm({
      title: 'Send contract for signature?',
      message: `The vendor (${detailContract.user?.email}) will receive an email with a direct sign link.`,
      confirmLabel: 'Send to vendor',
    });
    if (!ok) return;
    setBusyAction('send');
    try {
      const res = await adminSendContract(detailContract.id);
      await loadDetail(selectedId!);
      await loadList(tab);
      if (res.emailSent) {
        toast.success(`Contract sent. Email delivered to ${detailContract.user?.email}.`);
      } else {
        toast.warning('Contract status updated, but email delivery failed. Use Resend or check SMTP config.');
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to send.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleResendContract = async () => {
    if (!detailContract || busyAction) return;
    const ok = await confirm({
      title: 'Resend contract email?',
      message: `Re-send the sign link email to ${detailContract.user?.email}? The contract status and signing token are unchanged.`,
      confirmLabel: 'Resend email',
    });
    if (!ok) return;
    setBusyAction('resend');
    try {
      const res = await adminResendContract(detailContract.id);
      await loadDetail(selectedId!);
      if (res.emailSent) toast.success(`Email re-sent to ${res.recipientEmail}.`);
      else toast.error('Email could not be sent. Check SMTP_HOST + SMTP_USER in backend .env.');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to resend.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleDownloadPdf = async () => {
    if (!detailContract || busyAction) return;
    setBusyAction('download');
    try {
      const merchantName = (detailContract.mergeValues as any)?.merchant?.businessLegalName
        || detailContract.user?.name || 'contract';
      const safeName = String(merchantName).replace(/[^a-z0-9]+/gi, '-').toLowerCase();
      await adminDownloadContractPdf(detailContract.id, `${safeName}-${detailContract.id.slice(-6)}.pdf`);
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message || 'Failed to download PDF.');
    } finally {
      setBusyAction(null);
    }
  };

  // ── Reject / Cancel via ReasonModal ──

  const openReject = () => setReasonModal({ kind: 'reject_onboarding' });
  const openCancel = () => setReasonModal({ kind: 'cancel_contract' });

  const submitReason = async (reason: string) => {
    if (!reasonModal || !selectedId) return;
    setReasonBusy(true);
    try {
      if (reasonModal.kind === 'reject_onboarding' && detailOnboarding) {
        const res = await adminUpdateVendorOnboarding(detailOnboarding.id, {
          status: 'rejected',
          rejectionReason: reason,
          adminNotes: notes,
        });
        setDetailOnboarding(res.onboarding);
        toast.success('Application rejected.');
      } else if (reasonModal.kind === 'cancel_contract' && detailContract) {
        await adminCancelContract(detailContract.id, reason);
        await loadDetail(selectedId);
        toast.success('Contract cancelled.');
      }
      await loadList(tab);
      setReasonModal(null);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Action failed.');
    } finally {
      setReasonBusy(false);
    }
  };

  const visibleHardware = useMemo(() => {
    if (!detailOnboarding?.hardwareNeeds) return [];
    return Object.entries(detailOnboarding.hardwareNeeds)
      .filter(([, v]) => v && v !== 0)
      .map(([k, v]) => ({ key: k, label: HARDWARE_LABELS[k] || k, value: v }));
  }, [detailOnboarding]);

  // Selected row (for the right-pane derived view count + activity)
  const selectedRow = rows.find(r => r.id === selectedId) || null;

  return (
    <div className="vp-page">
      <header className="vp-header">
        <div className="vp-header-icon"><Workflow size={20} /></div>
        <div>
          <h1>Vendor Pipeline</h1>
          <p>One unified flow from submission through activation.</p>
        </div>
      </header>

      {/* Tab bar */}
      <div className="vp-tabs">
        {TABS.map(t => {
          const isActive = tab === t.key;
          const count = t.key ? counts[t.key] : Object.values(counts).reduce((a, b) => a + b, 0);
          return (
            <button
              key={t.key || 'all'}
              className={`vp-tab ${isActive ? 'is-active' : ''}`}
              onClick={() => setTab(t.key)}
              style={isActive && t.accent ? { borderColor: t.accent, color: t.accent } : undefined}
            >
              {t.label}
              {count > 0 && <span className="vp-tab-count">{count}</span>}
            </button>
          );
        })}
        <button
          className="vp-refresh"
          onClick={() => loadList(tab, true)}
          disabled={loadingList}
          title="Refresh"
        >
          <RefreshCw size={14} className={loadingList ? 'vp-spin' : ''} />
        </button>
      </div>

      {/* Two-column layout */}
      <div className="vp-layout">
        {/* List */}
        <div className="vp-list">
          {loadingList ? (
            <div className="vp-empty"><Loader size={20} className="vp-spin" /></div>
          ) : rows.length === 0 ? (
            <div className="vp-empty">No vendors in this stage.</div>
          ) : rows.map(r => (
            <button
              key={r.id}
              className={`vp-list-item ${selectedId === r.id ? 'is-selected' : ''}`}
              onClick={() => setSelectedId(r.id)}
            >
              <div className="vp-list-item-row">
                <strong>{r.businessName}</strong>
                <StatusBadge status={r.pipelineStatus} />
              </div>
              <div className="vp-list-item-sub">{r.userName} · {r.userEmail}</div>
              <div className="vp-list-item-meta">
                {/* Eye icon + count for Sent rows. Visible only when there's signal. */}
                {r.pipelineStatus === 'sent' && (
                  <span className="vp-views" title={`${r.viewCount} contract view${r.viewCount === 1 ? '' : 's'}`}>
                    <Eye size={12} /> {r.viewCount}
                  </span>
                )}
                {r.lastActivityAt && (
                  <span>· Last activity {new Date(r.lastActivityAt).toLocaleDateString()}</span>
                )}
              </div>
            </button>
          ))}
        </div>

        {/* Detail */}
        <div className="vp-detail">
          {!detailOnboarding ? (
            <div className="vp-empty">Select a vendor to review.</div>
          ) : loadingDetail ? (
            <div className="vp-empty"><Loader size={20} className="vp-spin" /></div>
          ) : (
            <>
              {/* Header — name + status + action row */}
              <div className="vp-detail-header">
                <div>
                  <h2>{detailOnboarding.businessLegalName || detailOnboarding.fullName}</h2>
                  <p className="vp-detail-sub">
                    Submitted {fmtDate(detailOnboarding.submittedAt)}
                    {selectedRow && (<>&nbsp;<StatusBadge status={selectedRow.pipelineStatus} /></>)}
                    {selectedRow?.pipelineStatus === 'sent' && (
                      <span className="vp-views vp-views--inline" title={`${selectedRow.viewCount} contract view${selectedRow.viewCount === 1 ? '' : 's'}`}>
                        <Eye size={12} /> {selectedRow.viewCount} view{selectedRow.viewCount === 1 ? '' : 's'}
                      </span>
                    )}
                  </p>
                </div>
                <div className="vp-detail-actions">
                  {/* Onboarding-only actions (no contract yet) */}
                  {!detailContract && (
                    <>
                      {detailOnboarding.status === 'submitted' && (
                        <button className="vp-btn vp-btn-secondary" onClick={markReviewed} disabled={busyAction !== null}>
                          {busyAction === 'reviewed' ? <Loader size={14} className="vp-spin" /> : <CheckCircle2 size={14} />}
                          Mark Reviewed
                        </button>
                      )}
                      {detailOnboarding.status !== 'rejected' && detailOnboarding.status !== 'approved' && (
                        <button className="vp-btn vp-btn-primary" onClick={() => setShowGenerate(true)}>
                          <FilePlus size={14} /> Generate Contract
                        </button>
                      )}
                      {detailOnboarding.status !== 'rejected' && detailOnboarding.status !== 'approved' && (
                        <button className="vp-btn vp-btn-danger" onClick={openReject}>
                          <AlertCircle size={14} /> Reject
                        </button>
                      )}
                    </>
                  )}
                  {/* Contract actions (latest contract present) */}
                  {detailContract && detailContract.status === 'draft' && (
                    <button className="vp-btn vp-btn-primary" onClick={handleSendContract} disabled={busyAction !== null}>
                      {busyAction === 'send'
                        ? <><Loader size={14} className="vp-spin" /> Sending…</>
                        : <><Send size={14} /> Send to Vendor</>}
                    </button>
                  )}
                  {detailContract && ['sent', 'viewed'].includes(detailContract.status) && (
                    <button className="vp-btn" onClick={handleResendContract} disabled={busyAction !== null}>
                      {busyAction === 'resend'
                        ? <><Loader size={14} className="vp-spin" /> Resending…</>
                        : <><Repeat size={14} /> Resend Email</>}
                    </button>
                  )}
                  {detailContract && detailContract.status === 'signed' && (
                    <button className="vp-btn vp-btn-success" onClick={() => setShowActivate(true)} disabled={busyAction !== null}>
                      <CheckCircle2 size={14} /> Approve & Activate
                    </button>
                  )}
                  {detailContract && ['draft', 'sent', 'viewed'].includes(detailContract.status) && (
                    <button className="vp-btn vp-btn-danger" onClick={openCancel} disabled={busyAction !== null}>
                      <X size={14} /> Cancel Contract
                    </button>
                  )}
                  {detailContract?.signedPdfPath && (
                    <button className="vp-btn" onClick={handleDownloadPdf} disabled={busyAction !== null} title="Download signed PDF">
                      {busyAction === 'download'
                        ? <><Loader size={14} className="vp-spin" /> Downloading…</>
                        : <><Download size={14} /> PDF</>}
                    </button>
                  )}
                </div>
              </div>

              {/* Banners — rejection reason, signature info, onboarding rejection from above */}
              {selectedRow?.rejectionReason && selectedRow.pipelineStatus === 'rejected' && (
                <div className="vp-banner vp-banner--danger">
                  <AlertCircle size={14} /> <strong>Reason:</strong> {selectedRow.rejectionReason}
                </div>
              )}
              {detailContract?.signerName && (
                <div className="vp-banner vp-banner--success">
                  <CheckCircle2 size={14} /> Signed by <strong>{detailContract.signerName}</strong>
                  {detailContract.signerTitle ? ` (${detailContract.signerTitle})` : ''}
                  {detailContract.signerIp ? ` from IP ${detailContract.signerIp}` : ''}
                </div>
              )}

              {/* Contract metadata strip — only when a contract exists */}
              {detailContract && (
                <div className="vp-meta-strip">
                  <span><strong>Contract:</strong> {detailContract.template?.name || '—'}</span>
                  {detailContract.sentAt   && <span><strong>Sent:</strong> {fmtDate(detailContract.sentAt)}</span>}
                  {detailContract.viewedAt && <span><strong>First viewed:</strong> {fmtDate(detailContract.viewedAt)}</span>}
                  {detailContract.signedAt && <span><strong>Signed:</strong> {fmtDate(detailContract.signedAt)}</span>}
                  {detailContract.activatedAt && <span><strong>Activated:</strong> {fmtDate(detailContract.activatedAt)}</span>}
                </div>
              )}

              {/* Vendor identity / operations / modules / hardware — always shown */}
              <div className="vp-section">
                <h3><Building2 size={14} /> Identity</h3>
                <div className="vp-grid">
                  <Item icon={<Mail size={12} />} label="Email" value={detailOnboarding.email} />
                  <Item icon={<Phone size={12} />} label="Phone" value={detailOnboarding.phone} />
                  <Item icon={<Briefcase size={12} />} label="Business Type" value={detailOnboarding.businessType} />
                  <Item icon={<Calendar size={12} />} label="Years" value={detailOnboarding.yearsInBusiness} />
                  <Item icon={<Hash size={12} />} label="EIN" value={detailOnboarding.ein} />
                  <Item icon={<Building2 size={12} />} label="DBA" value={detailOnboarding.dbaName} />
                  <Item icon={<MapPin size={12} />} label="Address" value={[detailOnboarding.businessAddress, detailOnboarding.businessCity, detailOnboarding.businessState, detailOnboarding.businessZip].filter(Boolean).join(', ')} />
                </div>
              </div>

              <div className="vp-section">
                <h3><Store size={14} /> Operations</h3>
                <div className="vp-grid">
                  <Item label="Industry" value={detailOnboarding.industry?.replace(/_/g, ' ')} />
                  <Item label="Stores" value={`${detailOnboarding.numStoresRange || '—'}${detailOnboarding.numStoresExact ? ` (${detailOnboarding.numStoresExact} exact)` : ''}`} />
                  <Item label="Registers/store" value={detailOnboarding.numRegistersPerStore} />
                  <Item label="Monthly volume" value={detailOnboarding.monthlyVolumeRange} />
                  <Item label="Avg tx/day" value={detailOnboarding.avgTxPerDay} />
                  <Item label="Current POS" value={detailOnboarding.currentPOS} />
                  <Item label="Go-live timeline" value={detailOnboarding.goLiveTimeline} />
                </div>
              </div>

              {/* Plan + add-on interest captured during onboarding (S80 Phase 3).
                  Distinct from Requested Modules below — this reflects what they
                  put in their cart at submit time. Requested Modules is the legacy
                  multi-select kept for back-compat. Show both so the admin can
                  reconcile. */}
              {(detailOnboarding.selectedPlanSlug || detailOnboarding.selectedAddonKeys.length > 0 || detailOnboarding.estimatedMonthlyTotal != null) && (
                <div className="vp-section">
                  <h3><Tag size={14} /> Plan Selection</h3>
                  <div className="vp-grid">
                    <Item
                      icon={<Sparkles size={12} />}
                      label="Selected Plan"
                      value={
                        detailOnboarding.selectedPlanSlug
                          ? `${PLAN_LABELS[detailOnboarding.selectedPlanSlug] || detailOnboarding.selectedPlanSlug}${
                              detailOnboarding.selectedPlanSlug === 'starter' && detailOnboarding.selectedAddonKeys.length > 0
                                ? ` + ${detailOnboarding.selectedAddonKeys.length} add-on${detailOnboarding.selectedAddonKeys.length === 1 ? '' : 's'}`
                                : detailOnboarding.selectedPlanSlug === 'pro'
                                  ? ' (all modules included)'
                                  : ''
                            }`
                          : '—'
                      }
                    />
                    <Item
                      icon={<DollarSign size={12} />}
                      label="Estimated Monthly"
                      value={
                        detailOnboarding.estimatedMonthlyTotal == null
                          ? '—'
                          : `$${Number(detailOnboarding.estimatedMonthlyTotal).toFixed(2)}/mo`
                      }
                    />
                  </div>
                  {detailOnboarding.selectedAddonKeys.length > 0 && (
                    <>
                      <div className="vp-subhead">Selected Add-ons ({detailOnboarding.selectedAddonKeys.length})</div>
                      <div className="vp-chips">
                        {detailOnboarding.selectedAddonKeys.map(k => (
                          <span key={k} className="vp-chip">{ADDON_LABELS[k] || k}</span>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}

              <div className="vp-section">
                <h3><Sparkles size={14} /> Requested Modules ({detailOnboarding.requestedModules.length})</h3>
                <div className="vp-chips">
                  {detailOnboarding.requestedModules.length === 0 ? (
                    <span className="vp-empty-inline">None</span>
                  ) : detailOnboarding.requestedModules.map(m => (
                    <span key={m} className="vp-chip">{MODULE_LABELS[m] || m}</span>
                  ))}
                </div>
              </div>

              {visibleHardware.length > 0 && (
                <div className="vp-section">
                  <h3><Cpu size={14} /> Hardware Needs</h3>
                  <div className="vp-grid">
                    {visibleHardware.map(h => (
                      <Item key={h.key} label={h.label} value={typeof h.value === 'boolean' ? (h.value ? 'Yes' : '—') : h.value} />
                    ))}
                  </div>
                </div>
              )}

              {(detailOnboarding.specialRequirements || detailOnboarding.hearAboutUs) && (
                <div className="vp-section">
                  <h3>Additional Context</h3>
                  <div className="vp-grid">
                    <Item label="How they heard" value={detailOnboarding.hearAboutUs} />
                    <Item label="Referral source" value={detailOnboarding.referralSource} />
                  </div>
                  {detailOnboarding.specialRequirements && (
                    <div className="vp-special">
                      <strong>Special requirements:</strong>
                      <p>{detailOnboarding.specialRequirements}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Internal admin notes */}
              <div className="vp-section">
                <h3><FileText size={14} /> Internal Notes (admin-only)</h3>
                <textarea
                  className="vp-textarea"
                  rows={3}
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Notes about this vendor — pricing tier discussion, follow-ups, special considerations…"
                />
                <button className="vp-btn vp-btn-secondary" onClick={saveNotes} disabled={savingNotes}>
                  {savingNotes ? <Loader size={14} className="vp-spin" /> : 'Save Notes'}
                </button>
              </div>

              {/* Contract preview + audit trail — only when a contract exists */}
              {detailContract && (
                <>
                  <details className="vp-events" open={(detailContract.events?.length || 0) > 0}>
                    <summary>Audit trail ({detailContract.events?.length || 0} events)</summary>
                    {detailContract.events?.length ? (
                      <ul className="vp-event-list">
                        {detailContract.events.map(e => (
                          <li key={e.id}>
                            <span className="vp-event-type">{e.eventType.replace(/_/g, ' ')}</span>
                            <span className="vp-event-time">{fmtDate(e.createdAt)}</span>
                            {e.actorRole && <span className="vp-event-role">{e.actorRole}</span>}
                          </li>
                        ))}
                      </ul>
                    ) : <p className="vp-empty-inline">No events yet.</p>}
                  </details>

                  <details className="vp-preview-wrap" open>
                    <summary>Contract preview</summary>
                    <div className="vp-preview" dangerouslySetInnerHTML={{ __html: renderedHtml }} />
                  </details>
                </>
              )}

              <div className="vp-meta-footer">
                Reviewed by: {detailOnboarding.reviewedBy?.name || '—'}
                {detailOnboarding.reviewedAt && ` at ${fmtDate(detailOnboarding.reviewedAt)}`}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Generate Contract modal — opens onboarding-only flow into contract */}
      {detailOnboarding && (
        <GenerateContractModal
          open={showGenerate}
          onboarding={detailOnboarding}
          onClose={() => setShowGenerate(false)}
          onCreated={async () => {
            setShowGenerate(false);
            await loadList(tab);
            // After list refresh, the row's `latestContract` is populated;
            // re-load detail to switch into contract mode.
            if (selectedId) await loadDetail(selectedId);
          }}
        />
      )}

      {/* Activate modal — only fires when contract.status='signed' */}
      <ActivateContractModal
        open={showActivate}
        contract={detailContract}
        onboarding={detailOnboarding}
        onClose={() => setShowActivate(false)}
        onActivated={async () => {
          setShowActivate(false);
          await loadList(tab);
          if (selectedId) await loadDetail(selectedId);
        }}
      />

      {/* Mandatory-reason modal — single instance for both reject + cancel */}
      <ReasonModal
        open={!!reasonModal}
        title={reasonModal?.kind === 'reject_onboarding' ? 'Reject application' : 'Cancel contract'}
        message={
          reasonModal?.kind === 'reject_onboarding'
            ? 'The vendor will see this reason on their awaiting page and be unable to access the platform until you change status. This is recorded in the audit log.'
            : 'The vendor will no longer be able to sign this contract version. This action is logged with the reason you provide.'
        }
        placeholder="Enter reason (visible to vendor)…"
        confirmLabel={reasonModal?.kind === 'reject_onboarding' ? 'Reject application' : 'Cancel contract'}
        onCancel={() => !reasonBusy && setReasonModal(null)}
        onConfirm={submitReason}
        busy={reasonBusy}
      />
    </div>
  );
}

// ─── Helper components ─────────────────────────────────────────────────
function Item({ icon, label, value }: { icon?: React.ReactNode; label: string; value: any }) {
  const display = (value === null || value === undefined || value === '') ? '—' : String(value);
  return (
    <div className="vp-item">
      <div className="vp-item-label">{icon}{label}</div>
      <div className="vp-item-value">{display}</div>
    </div>
  );
}

// ─── Activate modal — preserved from former AdminContracts page ─────────
interface PricingTierLite { id: string; key: string; name: string; description?: string | null; surchargePercent: any; surchargeFixedFee: any; isDefault?: boolean; }
interface PlanLite {
  id: string | number;
  slug: string;
  name: string;
  basePrice: any;
  description?: string;
  bundleDiscountPercent?: any;
  priceOverride?: any;
  addons?: Array<{ id: string | number; key: string; label?: string; name?: string; price?: any; monthlyPrice?: any; description?: string }>;
}

function ActivateContractModal({
  open, contract, onboarding, onClose, onActivated,
}: {
  open: boolean;
  contract: ContractRecord | null;
  onboarding: VendorOnboardingRecord | null;
  onClose: () => void;
  onActivated: () => void;
}) {
  const [tiers, setTiers] = useState<PricingTierLite[]>([]);
  const [pricingTierId, setPricingTierId] = useState<string | null>(null);
  const [plans, setPlans] = useState<PlanLite[]>([]);
  const [planSlug, setPlanSlug] = useState<string | null>(null);
  const [addonKeys, setAddonKeys] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    // Load surcharge tiers and subscription plans in parallel.
    api.get('/pricing/tiers').then(r => {
      const list: PricingTierLite[] = (r.data?.tiers || []).filter((t: PricingTierLite) => (t as any).active && t.key !== 'custom');
      setTiers(list);
      const def = list.find(t => t.isDefault) || list[0];
      if (def) setPricingTierId(def.id);
    }).catch(() => toast.error('Failed to load pricing tiers.'));

    adminListPlans().then(r => {
      const list = (r?.plans || []) as PlanLite[];
      // Show only public/active plans, sorted by sortOrder.
      const visible = list.filter((p: any) => p.isActive !== false && p.isPublic !== false);
      setPlans(visible);
      // Default plan + addons from the prospect's onboarding picks. If they
      // skipped the picker, fall back to the seeded default ('starter').
      const prospectSlug = onboarding?.selectedPlanSlug || null;
      const fallback = visible.find((p: any) => p.isDefault)?.slug || visible[0]?.slug || null;
      const initialSlug = prospectSlug && visible.some(p => p.slug === prospectSlug) ? prospectSlug : fallback;
      setPlanSlug(initialSlug);
      // Pro includes everything — addon list stays empty.
      setAddonKeys(initialSlug === 'pro' ? [] : (onboarding?.selectedAddonKeys || []));
    }).catch(() => toast.error('Failed to load subscription plans.'));
  }, [open, onboarding]);

  // Live monthly total — re-derived whenever plan or addon selection changes.
  const monthlyTotal = useMemo(() => {
    const plan = plans.find(p => p.slug === planSlug);
    if (!plan) return 0;
    const base = Number(plan.basePrice ?? 0);
    if (planSlug === 'pro') return base; // Pro already bundles every addon
    const wanted = new Set(addonKeys);
    const addonsTotal = (plan.addons || [])
      .filter(a => wanted.has(a.key))
      .reduce((s, a) => s + Number(a.price ?? a.monthlyPrice ?? 0), 0);
    return base + addonsTotal;
  }, [plans, planSlug, addonKeys]);

  const selectedPlan = useMemo(() => plans.find(p => p.slug === planSlug) || null, [plans, planSlug]);

  if (!open || !contract) return null;

  const toggleAddon = (key: string) => {
    setAddonKeys(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  };

  const handlePlanChange = (slug: string) => {
    setPlanSlug(slug);
    // Pro auto-includes — clear the explicit addon selection.
    if (slug === 'pro') setAddonKeys([]);
    else if (onboarding?.selectedPlanSlug === slug) {
      // Switching back to the prospect's original choice → restore their addon picks.
      setAddonKeys(onboarding.selectedAddonKeys || []);
    }
  };

  const submit = async () => {
    if (!planSlug) { toast.error('Please pick a subscription plan.'); return; }
    setSubmitting(true);
    try {
      await adminActivateContract(contract.id, pricingTierId, {
        subscriptionPlanSlug: planSlug,
        subscriptionAddonKeys: planSlug === 'pro' ? [] : addonKeys,
      });
      toast.success('Vendor activated! They can now access the platform.');
      onActivated();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to activate.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="vp-modal-backdrop" onClick={onClose}>
      <div className="vp-modal vp-modal-wide" onClick={e => e.stopPropagation()}>
        <header className="vp-modal-head">
          <h3><CheckCircle2 size={18} /> Approve & Activate</h3>
          <button className="vp-modal-close" onClick={onClose}><X size={16} /></button>
        </header>
        <div className="vp-modal-body">
          <p>This will activate <strong>{contract.user?.name}</strong> ({contract.user?.email}) on the platform.</p>

          {/* Subscription plan picker — defaults to prospect's onboarding choice */}
          <label className="vp-modal-label">Subscription Plan</label>
          {onboarding?.selectedPlanSlug && (
            <p className="vp-plan-hint">
              Prospect picked <strong>{onboarding.selectedPlanSlug === 'pro' ? 'Pro' : 'Starter'}</strong>
              {onboarding.selectedAddonKeys.length > 0 && ` with ${onboarding.selectedAddonKeys.length} add-on${onboarding.selectedAddonKeys.length === 1 ? '' : 's'}`}
              {onboarding.estimatedMonthlyTotal != null && ` (~$${Number(onboarding.estimatedMonthlyTotal).toFixed(2)}/mo)`}.
              You can override below before activating.
            </p>
          )}
          <div className="vp-plan-grid">
            {plans.length === 0 ? (
              <p className="vp-empty-inline">No subscription plans found.</p>
            ) : plans.map(p => {
              const base = Number(p.basePrice ?? 0);
              const isProspectPick = onboarding?.selectedPlanSlug === p.slug;
              return (
                <label key={p.slug} className={`vp-plan-card ${planSlug === p.slug ? 'is-selected' : ''}`}>
                  <input type="radio" name="plan" value={p.slug} checked={planSlug === p.slug} onChange={() => handlePlanChange(p.slug)} />
                  <div className="vp-plan-card-body">
                    <div className="vp-plan-card-head">
                      <span className="vp-plan-name">{p.name}</span>
                      {isProspectPick && <span className="vp-plan-badge">Prospect's choice</span>}
                    </div>
                    <div className="vp-plan-price">${base.toFixed(2)}/mo</div>
                    {p.description && <div className="vp-plan-desc">{p.description}</div>}
                  </div>
                </label>
              );
            })}
          </div>

          {/* Addon picker — only meaningful for Starter (Pro includes every addon) */}
          {selectedPlan && planSlug !== 'pro' && (selectedPlan.addons || []).length > 0 && (
            <>
              <label className="vp-modal-label vp-modal-label-tight">Add-ons (Starter only)</label>
              <div className="vp-addon-grid">
                {(selectedPlan.addons || []).map(a => {
                  const key = a.key;
                  const price = Number(a.price ?? a.monthlyPrice ?? 0);
                  const checked = addonKeys.includes(key);
                  const isProspectPick = onboarding?.selectedAddonKeys.includes(key);
                  return (
                    <label key={key} className={`vp-addon-row ${checked ? 'is-checked' : ''}`}>
                      <input type="checkbox" checked={checked} onChange={() => toggleAddon(key)} />
                      <div className="vp-addon-body">
                        <div className="vp-addon-head">
                          <span className="vp-addon-label">{a.label || a.name || key}</span>
                          {isProspectPick && <span className="vp-addon-pick-mark">★</span>}
                        </div>
                        <span className="vp-addon-price">+${price.toFixed(2)}/mo</span>
                      </div>
                    </label>
                  );
                })}
              </div>
            </>
          )}
          {planSlug === 'pro' && (
            <p className="vp-plan-hint vp-plan-hint-info">
              Pro includes every business module — no add-ons needed.
            </p>
          )}

          {/* Live total */}
          {selectedPlan && (
            <div className="vp-total-row">
              <span>Monthly Total:</span>
              <strong>${monthlyTotal.toFixed(2)}/mo</strong>
            </div>
          )}

          {/* Surcharge tier — separate concept from subscription plan */}
          <label className="vp-modal-label">Payment Processing Tier</label>
          <div className="vp-tier-list">
            {tiers.length === 0 ? <p className="vp-empty-inline">No active pricing tiers found.</p> : tiers.map(t => (
              <label key={t.id} className={`vp-tier-row ${pricingTierId === t.id ? 'is-selected' : ''}`}>
                <input type="radio" name="tier" value={t.id} checked={pricingTierId === t.id} onChange={() => setPricingTierId(t.id)} />
                <div>
                  <div className="vp-tier-name">{t.name}</div>
                  {t.description && <div className="vp-tier-desc">{t.description}</div>}
                  <div className="vp-tier-meta">{Number(t.surchargePercent)}% + ${Number(t.surchargeFixedFee).toFixed(2)} per tx</div>
                </div>
              </label>
            ))}
            <label className={`vp-tier-row ${pricingTierId === null ? 'is-selected' : ''}`}>
              <input type="radio" name="tier" value="" checked={pricingTierId === null} onChange={() => setPricingTierId(null)} />
              <div>
                <div className="vp-tier-name">No tier (custom / trial)</div>
                <div className="vp-tier-desc">Use the per-store custom override path.</div>
              </div>
            </label>
          </div>
        </div>
        <footer className="vp-modal-foot">
          <button className="vp-btn" onClick={onClose}>Cancel</button>
          <button className="vp-btn vp-btn-success" onClick={submit} disabled={submitting || !planSlug}>
            {submitting ? <Loader size={14} className="vp-spin" /> : <><CheckCircle2 size={14} /> Activate Vendor</>}
          </button>
        </footer>
      </div>
    </div>
  );
}
