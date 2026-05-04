// ─────────────────────────────────────────────────
// VendorOnboardingViewModal — S77 Phase 1
// Read-only modal showing the vendor's submitted questionnaire. Mountable
// from anywhere — pass either an onboarding id or a user id and it'll fetch.
//
// Used by:
//   • AdminOrgStoreUser  → eye button on each user row
//   • AdminVendorOnboardings → can be reused for "open in modal" later
// ─────────────────────────────────────────────────
import { useEffect, useState } from 'react';
import {
  X, Building2, Mail, Phone, MapPin, Briefcase, Calendar, Hash,
  Store, Cpu, Sparkles, Loader, FileText, AlertCircle, FilePlus,
} from 'lucide-react';
import { toast } from 'react-toastify';
import {
  adminGetVendorOnboarding,
  adminGetVendorOnboardingByUser,
  type VendorOnboardingRecord,
} from '../services/api';
// S77 Phase 2 — generate contract action
import GenerateContractModal from './GenerateContractModal';
import './VendorOnboardingViewModal.css';

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

const TIMELINE_LABELS: Record<string, string> = {
  immediate: 'Immediately (within 2 weeks)',
  '1month': 'Within 1 month',
  '3months': 'Within 3 months',
  exploring: 'Just exploring',
};

const VOLUME_LABELS: Record<string, string> = {
  '0-50k': 'Under $50k / month',
  '50k-200k': '$50k – $200k / month',
  '200k-500k': '$200k – $500k / month',
  '500k-1m': '$500k – $1M / month',
  '1m+': '$1M+ / month',
};

function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

interface Props {
  open: boolean;
  // Pass either:
  onboardingId?: string;
  userId?: string;
  // For the header — pre-populated so the modal can show a friendly title
  // immediately while fetching the body.
  fallbackName?: string;
  fallbackEmail?: string;
  onClose: () => void;
}

export default function VendorOnboardingViewModal({ open, onboardingId, userId, fallbackName, fallbackEmail, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<VendorOnboardingRecord | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);

  useEffect(() => {
    if (!open) return;
    setData(null);
    setNotFound(false);
    if (!onboardingId && !userId) return;

    let cancelled = false;
    setLoading(true);
    const fetcher = onboardingId
      ? adminGetVendorOnboarding(onboardingId)
      : adminGetVendorOnboardingByUser(userId!);

    fetcher
      .then(res => { if (!cancelled) setData(res.onboarding); })
      .catch(err => {
        if (cancelled) return;
        if (err.response?.status === 404) {
          setNotFound(true);
        } else {
          toast.error(err.response?.data?.error || 'Failed to load onboarding details.');
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [open, onboardingId, userId]);

  // Esc to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const visibleHardware = data?.hardwareNeeds
    ? Object.entries(data.hardwareNeeds).filter(([, v]) => v && v !== 0)
    : [];

  return (
    <div className="vovm-backdrop" onClick={onClose}>
      <div className="vovm-modal" onClick={e => e.stopPropagation()}>
        <header className="vovm-head">
          <div className="vovm-head-left">
            <div className="vovm-head-icon"><FileText size={18} /></div>
            <div>
              <h3>Vendor Onboarding Details</h3>
              <p className="vovm-head-sub">
                {data?.businessLegalName || data?.fullName || fallbackName || '—'}
                {' · '}
                {data?.email || fallbackEmail || '—'}
              </p>
            </div>
          </div>
          <button className="vovm-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>

        <div className="vovm-body">
          {loading ? (
            <div className="vovm-empty"><Loader size={20} className="vovm-spin" /></div>
          ) : notFound ? (
            <div className="vovm-empty">
              <AlertCircle size={28} className="vovm-empty-icon" />
              <p>This user hasn't submitted the onboarding questionnaire yet.</p>
              <p className="vovm-empty-sub">They'll be prompted to fill it in next time they sign in.</p>
            </div>
          ) : !data ? (
            <div className="vovm-empty">No data.</div>
          ) : (
            <>
              <div className="vovm-status-row">
                <span className="vovm-badge" style={{ background: `${STATUS_COLORS[data.status] || '#64748b'}33`, color: STATUS_COLORS[data.status] || '#64748b', borderColor: `${STATUS_COLORS[data.status] || '#64748b'}66` }}>
                  {data.status.replace(/_/g, ' ')}
                </span>
                <span className="vovm-status-meta">
                  Submitted {fmtDate(data.submittedAt)}
                  {data.reviewedAt && (<>{' · '}Reviewed {fmtDate(data.reviewedAt)}{data.reviewedBy?.name ? ` by ${data.reviewedBy.name}` : ''}</>)}
                </span>
              </div>

              {data.rejectionReason && (
                <div className="vovm-reject-banner">
                  <strong>Rejection reason:</strong> {data.rejectionReason}
                </div>
              )}

              <Section icon={<Building2 size={14} />} title="Identity">
                <Item icon={<Mail size={11} />}     label="Email"          value={data.email} />
                <Item icon={<Phone size={11} />}    label="Phone"          value={data.phone} />
                <Item icon={<Briefcase size={11} />} label="Business Type" value={data.businessType} />
                <Item icon={<Calendar size={11} />} label="Years"          value={data.yearsInBusiness} />
                <Item icon={<Hash size={11} />}     label="EIN"            value={data.ein} />
                <Item icon={<Building2 size={11} />} label="DBA"           value={data.dbaName} />
                <Item
                  icon={<MapPin size={11} />}
                  label="Address"
                  value={[data.businessAddress, data.businessCity, data.businessState, data.businessZip].filter(Boolean).join(', ')}
                  wide
                />
              </Section>

              <Section icon={<Store size={14} />} title="Operations">
                <Item label="Industry"            value={data.industry?.replace(/_/g, ' ')} />
                <Item label="Stores"              value={`${data.numStoresRange || '—'}${data.numStoresExact ? ` (${data.numStoresExact} exact)` : ''}`} />
                <Item label="Registers/store"     value={data.numRegistersPerStore} />
                <Item label="Monthly volume"      value={data.monthlyVolumeRange ? VOLUME_LABELS[data.monthlyVolumeRange] || data.monthlyVolumeRange : null} />
                <Item label="Avg tx/day"          value={data.avgTxPerDay} />
                <Item label="Current POS"         value={data.currentPOS} />
                <Item label="Go-live timeline"    value={data.goLiveTimeline ? TIMELINE_LABELS[data.goLiveTimeline] || data.goLiveTimeline : null} />
              </Section>

              <Section icon={<Sparkles size={14} />} title={`Requested Modules (${data.requestedModules.length})`}>
                <div className="vovm-chips">
                  {data.requestedModules.length === 0
                    ? <span className="vovm-empty-inline">None selected</span>
                    : data.requestedModules.map(m => (
                        <span key={m} className="vovm-chip">{MODULE_LABELS[m] || m}</span>
                      ))}
                </div>
              </Section>

              {visibleHardware.length > 0 && (
                <Section icon={<Cpu size={14} />} title="Hardware Needs">
                  {visibleHardware.map(([key, value]) => (
                    <Item
                      key={key}
                      label={HARDWARE_LABELS[key] || key}
                      value={typeof value === 'boolean' ? (value ? 'Yes' : '—') : value as number}
                    />
                  ))}
                </Section>
              )}

              {(data.specialRequirements || data.hearAboutUs || data.referralSource) && (
                <Section title="Additional Context">
                  <Item label="How they heard"   value={data.hearAboutUs} />
                  <Item label="Referral source"  value={data.referralSource} />
                  {data.specialRequirements && (
                    <div className="vovm-special-wide">
                      <div className="vovm-item-label">Special requirements</div>
                      <p className="vovm-special-text">{data.specialRequirements}</p>
                    </div>
                  )}
                </Section>
              )}

              {data.adminNotes && (
                <Section title="Internal Admin Notes">
                  <div className="vovm-special-wide">
                    <p className="vovm-special-text">{data.adminNotes}</p>
                  </div>
                </Section>
              )}
            </>
          )}
        </div>

        <footer className="vovm-foot">
          <span className="vovm-foot-hint">Read-only view. Use the Vendor Onboardings page to update status or notes.</span>
          <div className="vovm-foot-actions">
            {data && data.status !== 'rejected' && (
              <button
                className="vovm-foot-btn vovm-foot-btn--primary"
                onClick={() => setShowGenerate(true)}
              >
                <FilePlus size={14} /> Generate Contract
              </button>
            )}
            <button className="vovm-foot-btn" onClick={onClose}>Close</button>
          </div>
        </footer>
      </div>

      {data && (
        <GenerateContractModal
          open={showGenerate}
          onboarding={data}
          onClose={() => setShowGenerate(false)}
          onCreated={(contractId) => {
            // Leave the success screen visible — admin closes when done.
            void contractId;
          }}
        />
      )}
    </div>
  );
}

/* ── Internal helpers ── */
function Section({ icon, title, children }: { icon?: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="vovm-section">
      <h4 className="vovm-section-title">{icon}{title}</h4>
      <div className="vovm-grid">{children}</div>
    </section>
  );
}

function Item({ icon, label, value, wide = false }: { icon?: React.ReactNode; label: string; value: any; wide?: boolean }) {
  const display = (value === null || value === undefined || value === '') ? '—' : String(value);
  return (
    <div className={`vovm-item ${wide ? 'is-wide' : ''}`}>
      <div className="vovm-item-label">{icon}{label}</div>
      <div className="vovm-item-value">{display}</div>
    </div>
  );
}
