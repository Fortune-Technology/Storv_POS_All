// ─────────────────────────────────────────────────
// AdminContracts — S77 Phase 2
// List + detail layout for the contract pipeline.
//   • Status tabs with counts
//   • Per-row click → detail panel with rendered preview
//   • Per-status actions: Send (draft) → Cancel (sent/viewed) → Activate (signed)
// ─────────────────────────────────────────────────
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import {
  FileText, RefreshCw, Loader, Send, X, CheckCircle2, Download, AlertCircle, ExternalLink, Repeat,
} from 'lucide-react';
import {
  adminListContracts,
  adminGetContract,
  adminSendContract,
  adminResendContract,
  adminCancelContract,
  adminActivateContract,
  adminDownloadContractPdf,
  type ContractRecord,
} from '../services/api';
import { useConfirm } from '../hooks/useConfirmDialog';
import './AdminContracts.css';

const STATUS_TABS = [
  { key: '',              label: 'All' },
  { key: 'draft',         label: 'Draft' },
  { key: 'sent',          label: 'Sent' },
  { key: 'viewed',        label: 'Viewed' },
  { key: 'signed',        label: 'Signed' },
  { key: 'countersigned', label: 'Activated' },
  { key: 'cancelled',     label: 'Cancelled' },
];

const STATUS_COLORS: Record<string, string> = {
  draft:          '#64748b',
  sent:           '#3b82f6',
  viewed:         '#a855f7',
  signed:         '#06b6d4',
  countersigned:  '#22c55e',
  cancelled:      '#ef4444',
  expired:        '#94a3b8',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className="ac-badge" style={{
      background: `${STATUS_COLORS[status] || '#64748b'}33`,
      color: STATUS_COLORS[status] || '#64748b',
      borderColor: `${STATUS_COLORS[status] || '#64748b'}66`,
    }}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

interface AdminContractsProps {
  /** Mounted inside a hub (AdminVendorPipeline) — hide the page-level header. */
  embedded?: boolean;
}

export default function AdminContracts({ embedded = false }: AdminContractsProps = {}) {
  // Deep-link support — `?contractId=…` opens that contract on mount.
  // Used by the GenerateContractModal "Open Contract" button after a draft
  // is created, so admins land directly on the new contract's preview.
  const [searchParams, setSearchParams] = useSearchParams();
  const initialContractId = searchParams.get('contractId');

  const [tab, setTab] = useState('');
  const [list, setList] = useState<ContractRecord[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loadingList, setLoadingList] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(initialContractId);
  const [detail, setDetail] = useState<ContractRecord | null>(null);
  const [renderedHtml, setRenderedHtml] = useState('');
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [activateOpen, setActivateOpen] = useState(false);
  // Tracks which action button is currently in-flight so only that button
  // shows a spinner (instead of disabling the entire panel).
  // Values: 'send' | 'resend' | 'cancel' | 'download' | null
  const [busyAction, setBusyAction] = useState<null | 'send' | 'resend' | 'cancel' | 'download'>(null);
  const confirm = useConfirm();

  const loadList = async (status: string) => {
    setLoadingList(true);
    try {
      const res = await adminListContracts(status ? { status } : {});
      setList(res.contracts || []);
      setCounts(res.countsByStatus || {});
      // Honour the deep-link target on first load. Otherwise fall back to
      // the first row so the right pane has something to show.
      if (!selectedId && res.contracts?.length) setSelectedId(res.contracts[0].id);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to load contracts.');
    } finally { setLoadingList(false); }
  };

  // Strip ?contractId once we've consumed it so reloads of the page don't
  // keep clobbering whatever the admin clicks afterwards. Other query
  // params (?tab=, ?status=) are preserved.
  useEffect(() => {
    if (initialContractId) {
      const next = new URLSearchParams(searchParams);
      next.delete('contractId');
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadDetail = async (id: string) => {
    setLoadingDetail(true);
    try {
      const res = await adminGetContract(id);
      setDetail(res.contract);
      setRenderedHtml(res.renderedHtml);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to load contract detail.');
    } finally { setLoadingDetail(false); }
  };

  useEffect(() => { loadList(tab); /* eslint-disable-line */ }, [tab]);
  useEffect(() => { if (selectedId) loadDetail(selectedId); }, [selectedId]);

  const handleSend = async () => {
    if (!detail || busyAction) return;
    const ok = await confirm({
      title: 'Send contract for signature?',
      message: `The vendor (${detail.user?.email}) will see this contract on their awaiting page AND receive an email with a direct sign link.`,
      confirmLabel: 'Send to vendor',
    });
    if (!ok) return;
    setBusyAction('send');
    try {
      const res = await adminSendContract(detail.id);
      setDetail(res.contract);
      // Reload detail to pull the latest events including email_sent / email_failed
      await loadDetail(detail.id);
      await loadList(tab);
      if (res.emailSent) {
        toast.success(`Contract sent. Email delivered to ${detail.user?.email}.`);
      } else {
        toast.warning('Contract status updated, but email delivery failed. Use the Resend button — or check SMTP config.');
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to send.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleResend = async () => {
    if (!detail || busyAction) return;
    const ok = await confirm({
      title: 'Resend contract email?',
      message: `Re-send the sign link email to ${detail.user?.email}? The contract status and signing token are unchanged.`,
      confirmLabel: 'Resend email',
    });
    if (!ok) return;
    setBusyAction('resend');
    try {
      const res = await adminResendContract(detail.id);
      await loadDetail(detail.id); // refresh audit events
      if (res.emailSent) {
        toast.success(`Email re-sent to ${res.recipientEmail}.`);
      } else {
        toast.error('Email could not be sent. Check SMTP_HOST + SMTP_USER in backend .env.');
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to resend.');
    } finally {
      setBusyAction(null);
    }
  };

  // Authenticated PDF download. Native `<a href download>` doesn't work
  // for protected endpoints — the browser navigates without the
  // Authorization header → 401. Fetch via axios (Bearer auto-attached
  // by the request interceptor), then trigger a blob download.
  const handleDownloadPdf = async () => {
    if (!detail || busyAction) return;
    setBusyAction('download');
    try {
      const merchantName = (detail.mergeValues as any)?.merchant?.businessLegalName
        || detail.user?.name || 'contract';
      const safeName = String(merchantName).replace(/[^a-z0-9]+/gi, '-').toLowerCase();
      await adminDownloadContractPdf(detail.id, `${safeName}-${detail.id.slice(-6)}.pdf`);
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message || 'Failed to download PDF.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleCancel = async () => {
    if (!detail || busyAction) return;
    const reason = window.prompt('Reason for cancellation (optional):');
    const ok = await confirm({
      title: 'Cancel this contract?',
      message: 'The vendor will no longer be able to sign this version. You can generate a new contract afterwards.',
      confirmLabel: 'Cancel contract',
      danger: true,
    });
    if (!ok) return;
    setBusyAction('cancel');
    try {
      const res = await adminCancelContract(detail.id, reason || undefined);
      setDetail(res.contract);
      await loadList(tab);
      toast.success('Contract cancelled.');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to cancel.');
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className={`ac-page${embedded ? ' ac-page--embedded' : ''}`}>
      {!embedded && (
        <header className="ac-page-header">
          <div className="ac-page-header-icon"><FileText size={20} /></div>
          <div>
            <h1>Contracts</h1>
            <p>Generate, send, and activate merchant agreements.</p>
          </div>
        </header>
      )}

      <div className="ac-tabs">
        {STATUS_TABS.map(t => (
          <button
            key={t.key}
            className={`ac-tab ${tab === t.key ? 'is-active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {t.key && counts[t.key] > 0 && <span className="ac-tab-count">{counts[t.key]}</span>}
          </button>
        ))}
        <button className="ac-refresh-btn" onClick={() => loadList(tab)} disabled={loadingList} title="Refresh">
          <RefreshCw size={14} className={loadingList ? 'ac-spin' : ''} />
        </button>
      </div>

      <div className="ac-layout">
        <div className="ac-list">
          {loadingList ? (
            <div className="ac-empty"><Loader size={20} className="ac-spin" /></div>
          ) : list.length === 0 ? (
            <div className="ac-empty">No contracts in this category.</div>
          ) : list.map(c => (
            <button
              key={c.id}
              className={`ac-list-item ${selectedId === c.id ? 'is-selected' : ''}`}
              onClick={() => setSelectedId(c.id)}
            >
              <div className="ac-list-item-row">
                <strong>{(c.mergeValues as any)?.merchant?.businessLegalName || c.user?.name || '—'}</strong>
                <StatusBadge status={c.status} />
              </div>
              <div className="ac-list-item-sub">{c.user?.email}</div>
              <div className="ac-list-item-meta">
                {c.template?.name && <span>{c.template.name}</span>}
                {c.sentAt && <span>· sent {new Date(c.sentAt).toLocaleDateString()}</span>}
                {c.signedAt && <span>· signed {new Date(c.signedAt).toLocaleDateString()}</span>}
              </div>
            </button>
          ))}
        </div>

        <div className="ac-detail">
          {!detail ? (
            <div className="ac-empty">Select a contract.</div>
          ) : loadingDetail ? (
            <div className="ac-empty"><Loader size={20} className="ac-spin" /></div>
          ) : (
            <>
              <div className="ac-detail-header">
                <div>
                  <h2>{(detail.mergeValues as any)?.merchant?.businessLegalName || detail.user?.name}</h2>
                  <p className="ac-detail-sub">
                    {detail.template?.name} · v{detail.templateVersion?.versionNumber} · <StatusBadge status={detail.status} />
                  </p>
                </div>
                <div className="ac-detail-actions">
                  {detail.status === 'draft' && (
                    <button
                      className="ac-btn ac-btn-primary"
                      onClick={handleSend}
                      disabled={busyAction !== null}
                    >
                      {busyAction === 'send'
                        ? <><Loader size={14} className="ac-spin" /> Sending…</>
                        : <><Send size={14} /> Send to Vendor</>}
                    </button>
                  )}
                  {/* Resend the contract email — visible while awaiting signature */}
                  {['sent', 'viewed'].includes(detail.status) && (
                    <button
                      className="ac-btn"
                      onClick={handleResend}
                      title="Re-send the sign link email to the vendor"
                      disabled={busyAction !== null}
                    >
                      {busyAction === 'resend'
                        ? <><Loader size={14} className="ac-spin" /> Resending…</>
                        : <><Repeat size={14} /> Resend Email</>}
                    </button>
                  )}
                  {detail.status === 'signed' && (
                    <button className="ac-btn ac-btn-success" onClick={() => setActivateOpen(true)} disabled={busyAction !== null}>
                      <CheckCircle2 size={14} /> Approve &amp; Activate
                    </button>
                  )}
                  {['draft', 'sent', 'viewed'].includes(detail.status) && (
                    <button
                      className="ac-btn ac-btn-danger"
                      onClick={handleCancel}
                      disabled={busyAction !== null}
                    >
                      {busyAction === 'cancel'
                        ? <><Loader size={14} className="ac-spin" /> Cancelling…</>
                        : <><X size={14} /> Cancel</>}
                    </button>
                  )}
                  {detail.signedPdfPath && (
                    <button
                      className="ac-btn"
                      onClick={handleDownloadPdf}
                      disabled={busyAction !== null}
                      title="Download signed PDF"
                    >
                      {busyAction === 'download'
                        ? <><Loader size={14} className="ac-spin" /> Downloading…</>
                        : <><Download size={14} /> PDF</>}
                    </button>
                  )}
                </div>
              </div>

              <div className="ac-meta-strip">
                <span><strong>Generated:</strong> {fmtDate(detail.createdAt)}</span>
                {detail.sentAt   && <span><strong>Sent:</strong> {fmtDate(detail.sentAt)}</span>}
                {detail.viewedAt && <span><strong>First viewed:</strong> {fmtDate(detail.viewedAt)}</span>}
                {detail.signedAt && <span><strong>Signed:</strong> {fmtDate(detail.signedAt)}</span>}
                {detail.activatedAt && <span><strong>Activated:</strong> {fmtDate(detail.activatedAt)}</span>}
              </div>

              {detail.cancelReason && (
                <div className="ac-banner ac-banner--danger">
                  <AlertCircle size={14} /> <strong>Cancellation reason:</strong> {detail.cancelReason}
                </div>
              )}

              {detail.signerName && (
                <div className="ac-banner ac-banner--success">
                  <CheckCircle2 size={14} /> Signed by <strong>{detail.signerName}</strong>{detail.signerTitle ? ` (${detail.signerTitle})` : ''} from IP {detail.signerIp || '—'}
                </div>
              )}

              <details className="ac-events" open={(detail.events?.length || 0) > 0}>
                <summary>Audit trail ({detail.events?.length || 0} events)</summary>
                {detail.events?.length ? (
                  <ul className="ac-event-list">
                    {detail.events.map(e => (
                      <li key={e.id}>
                        <span className="ac-event-type">{e.eventType.replace(/_/g, ' ')}</span>
                        <span className="ac-event-time">{fmtDate(e.createdAt)}</span>
                        {e.actorRole && <span className="ac-event-role">{e.actorRole}</span>}
                      </li>
                    ))}
                  </ul>
                ) : <p className="ac-empty-inline">No events yet.</p>}
              </details>

              <details className="ac-preview-wrap" open>
                <summary>Rendered Preview</summary>
                <div className="ac-preview" dangerouslySetInnerHTML={{ __html: renderedHtml }} />
              </details>
            </>
          )}
        </div>
      </div>

      <ActivateContractModal
        open={activateOpen}
        contract={detail}
        onClose={() => setActivateOpen(false)}
        onActivated={async () => {
          setActivateOpen(false);
          await loadList(tab);
          if (detail) await loadDetail(detail.id);
        }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────
// ActivateContractModal — final step in the pipeline
// ─────────────────────────────────────────────────
import { useEffect as useReEffect, useState as useReState } from 'react';
import api from '../services/api';

interface PricingTierLite { id: string; key: string; name: string; description?: string | null; surchargePercent: any; surchargeFixedFee: any }

function ActivateContractModal({ open, contract, onClose, onActivated }: {
  open: boolean;
  contract: ContractRecord | null;
  onClose: () => void;
  onActivated: () => void;
}) {
  const [tiers, setTiers] = useReState<PricingTierLite[]>([]);
  const [pricingTierId, setPricingTierId] = useReState<string | null>(null);
  const [submitting, setSubmitting] = useReState(false);

  useReEffect(() => {
    if (!open) return;
    api.get('/pricing/tiers').then(r => {
      const list: PricingTierLite[] = (r.data?.tiers || []).filter((t: any) => t.active && t.key !== 'custom');
      setTiers(list);
      // Default to the platform's marked-default tier
      const def = list.find((t: any) => t.isDefault) || list[0];
      if (def) setPricingTierId(def.id);
    }).catch(() => toast.error('Failed to load pricing tiers.'));
  }, [open]);

  if (!open || !contract) return null;

  const submit = async () => {
    setSubmitting(true);
    try {
      await adminActivateContract(contract.id, pricingTierId);
      toast.success('Vendor activated! They can now access the platform.');
      onActivated();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to activate.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="ac-modal-backdrop" onClick={onClose}>
      <div className="ac-modal" onClick={e => e.stopPropagation()}>
        <header className="ac-modal-head">
          <h3><CheckCircle2 size={18} /> Approve &amp; Activate</h3>
          <button className="ac-modal-close" onClick={onClose}><X size={16} /></button>
        </header>
        <div className="ac-modal-body">
          <p>This will activate <strong>{contract.user?.name}</strong> ({contract.user?.email}) on the platform. They'll be able to sign in and create their organisation.</p>

          <label className="ac-modal-label">Assign Pricing Tier</label>
          <div className="ac-tier-list">
            {tiers.length === 0 ? <p className="ac-empty-inline">No active pricing tiers found.</p> : tiers.map(t => (
              <label key={t.id} className={`ac-tier-row ${pricingTierId === t.id ? 'is-selected' : ''}`}>
                <input type="radio" name="tier" value={t.id} checked={pricingTierId === t.id} onChange={() => setPricingTierId(t.id)} />
                <div>
                  <div className="ac-tier-name">{t.name}</div>
                  {t.description && <div className="ac-tier-desc">{t.description}</div>}
                  <div className="ac-tier-meta">{Number(t.surchargePercent)}% + ${Number(t.surchargeFixedFee).toFixed(2)} per tx</div>
                </div>
              </label>
            ))}
            <label className={`ac-tier-row ${pricingTierId === null ? 'is-selected' : ''}`}>
              <input type="radio" name="tier" value="" checked={pricingTierId === null} onChange={() => setPricingTierId(null)} />
              <div>
                <div className="ac-tier-name">No tier (custom / trial)</div>
                <div className="ac-tier-desc">Use the per-store custom override path. Pricing fields on the signed contract apply.</div>
              </div>
            </label>
          </div>
        </div>
        <footer className="ac-modal-foot">
          <button className="ac-btn" onClick={onClose}>Cancel</button>
          <button className="ac-btn ac-btn-success" onClick={submit} disabled={submitting}>
            {submitting ? <Loader size={14} className="ac-spin" /> : <><CheckCircle2 size={14} /> Activate Vendor</>}
          </button>
        </footer>
      </div>
    </div>
  );
}
