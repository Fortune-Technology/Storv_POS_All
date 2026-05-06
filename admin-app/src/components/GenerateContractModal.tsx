// ─────────────────────────────────────────────────
// GenerateContractModal — S77 Phase 2
//
// Mountable from anywhere admin needs to spin up a contract for a user
// (currently: VendorOnboardingViewModal "Generate Contract" button).
//
// Pre-fills mergeValues from:
//   • the user's vendor onboarding (merchant identity + hardware needs)
//   • a default pricing config (SaaS $79, IC+ rates from contract template defaults)
//
// Saves as a draft (status='draft'). The admin then opens the dedicated
// /contracts/:id page to review the rendered preview, tweak, and Send.
// ─────────────────────────────────────────────────
import { useState, useEffect } from 'react';
import { X, FileText, Loader, CheckCircle2 } from 'lucide-react';
import { toast } from 'react-toastify';
import {
  adminCreateContract,
  adminListPlans,
  adminListEquipmentProducts,
  type VendorOnboardingRecord,
} from '../services/api';
import './GenerateContractModal.css';

interface Props {
  open: boolean;
  onboarding: VendorOnboardingRecord;
  onClose: () => void;
  onCreated?: (contractId: string) => void;
}

// Plan + addons resolved at modal-open time and threaded into buildInitialMergeValues
// so SaaS Subscription is pre-filled with the plan the prospect actually picked
// (instead of a hardcoded $79/0). Falls back to the legacy $79 if the lookup fails.
interface PlanResolution {
  planSlug: string | null;
  planLabel: string;          // 'Starter' | 'Pro' | '—' (display only)
  baseMonthlyFee: number;     // SubscriptionPlan.basePrice (Pro = computed bundle)
  addonsTotalMonthly: number; // sum of selected addon prices (Starter only)
  addonLines: Array<{ key: string; label: string; price: number }>; // for hint UI
  source: 'plan' | 'fallback';
}

function emptyResolution(): PlanResolution {
  return { planSlug: null, planLabel: '—', baseMonthlyFee: 79, addonsTotalMonthly: 0, addonLines: [], source: 'fallback' };
}

// `numStoresRange` is captured as a string like "1", "2-5", "6-10", "11+".
// When the prospect didn't fill in `numStoresExact`, parse the lower bound of
// the range so the contract's # Locations starts with the right minimum
// instead of always defaulting to 1.
function inferLocationCount(o: VendorOnboardingRecord): number {
  if (typeof o.numStoresExact === 'number' && o.numStoresExact > 0) return o.numStoresExact;
  const r = (o.numStoresRange || '').trim();
  if (!r) return 1;
  const m = r.match(/^(\d+)/);
  if (m) return Math.max(1, Number(m[1]) || 1);
  return 1;
}

// Convert hardwareNeeds → contract hardware line items.
//
// Reality of the data model:
//   • Counted devices are keyed by `EquipmentProduct.slug` (kebab-case like
//     'card-terminal', 'receipt-printer') — the same catalog the onboarding
//     wizard uses. The slug map is authoritative; we look up the live product
//     to get the real `name` + `price` instead of guessing with a hardcoded
//     dictionary.
//   • Integration toggles (`fuelIntegration`, `scaleIntegration`) are
//     booleans, not counts. These are surfaced as $0 line items so the
//     contract reflects them — admin can set the actual fee inline.
//
// Legacy fallback:
//   Older onboarding data (pre S81) wrote camelCase keys into hardwareNeeds.
//   We map those to their kebab equivalents before lookup so existing
//   submissions keep working.
const LEGACY_KEY_MAP: Record<string, string> = {
  posTerminal:     'pos-terminal',
  receiptPrinter:  'receipt-printer',
  cashDrawer:      'cash-drawer',
  scanner:         'barcode-scanner',
  cardTerminal:    'card-terminal',
  customerDisplay: 'customer-display',
  labelPrinter:    'label-printer',
};
// Last-resort labels for slugs that the equipment catalog doesn't include —
// e.g. discontinued items still referenced on old onboardings.
const FALLBACK_LABELS: Record<string, string> = {
  'pos-terminal':     'POS Terminal',
  'receipt-printer':  'Receipt Printer',
  'cash-drawer':      'Cash Drawer',
  'barcode-scanner':  'Barcode Scanner',
  'card-terminal':    'Card Terminal',
  'customer-display': 'Customer Display',
  'label-printer':    'Label Printer',
};

interface EquipmentLookup {
  bySlug: Map<string, { name: string; price: number }>;
}

function buildHardwareLines(o: VendorOnboardingRecord, eq: EquipmentLookup) {
  const hardware: Array<{ description: string; qty: number; unitPrice: number; total: number }> = [];
  const hw = (o.hardwareNeeds || {}) as Record<string, number | boolean | null>;

  // Track which slugs we've already added so a legacy camelCase entry doesn't
  // duplicate a kebab-case one if both somehow exist on the same record.
  const seenSlugs = new Set<string>();

  const pushSlug = (slug: string, qty: number) => {
    if (qty <= 0 || seenSlugs.has(slug)) return;
    seenSlugs.add(slug);
    const live = eq.bySlug.get(slug);
    const description = live?.name || FALLBACK_LABELS[slug] || slug;
    const unitPrice = live?.price ?? 0;
    hardware.push({ description, qty, unitPrice, total: qty * unitPrice });
  };

  for (const [rawKey, rawVal] of Object.entries(hw)) {
    // Integration toggles are handled as $0 line items below — skip here.
    if (rawKey === 'fuelIntegration' || rawKey === 'scaleIntegration') continue;
    if (typeof rawVal !== 'number' || rawVal <= 0) continue;
    const slug = LEGACY_KEY_MAP[rawKey] || rawKey; // camelCase legacy → kebab; otherwise pass through
    pushSlug(slug, rawVal);
  }

  // Surface integration toggles so the contract reflects what the prospect
  // asked for. Admin can set the real $ fee on the line.
  if (hw.fuelIntegration === true) {
    hardware.push({ description: 'Fuel Pump Integration', qty: 1, unitPrice: 0, total: 0 });
  }
  if (hw.scaleIntegration === true) {
    hardware.push({ description: 'Scale Integration',     qty: 1, unitPrice: 0, total: 0 });
  }

  return hardware;
}

// Build a sensible mergeValues blob from onboarding data.
function buildInitialMergeValues(o: VendorOnboardingRecord, plan: PlanResolution, eq: EquipmentLookup) {
  const hardware = buildHardwareLines(o, eq);

  return {
    merchant: {
      businessLegalName: o.businessLegalName || '',
      dbaName:           o.dbaName || '',
      address:           o.businessAddress || '',
      cityStateZip:      [o.businessCity, o.businessState, o.businessZip].filter(Boolean).join(', '),
      phone:             o.phone || '',
      email:             o.email || '',
      website:           '',
      ein:               o.ein || '',
      businessType:      o.businessType || '',
      stateOfIncorporation: o.businessState || '',
      numLocations:      inferLocationCount(o),
      ownerName:         o.fullName || '',
      ownerSsnLast4:     '',
      ownerDob:          '',
      ownerPhone:        o.phone || '',
      mccCode:           'TBD',
    },
    agreementDate: new Date().toISOString().slice(0, 10),
    pricing: {
      saas: {
        baseMonthlyFee: plan.baseMonthlyFee,
        additionalLicenseFee: 0,
        addonsTotalMonthly: plan.addonsTotalMonthly,
      },
      hardware,
      processing: {
        model: 'IC+',
        icplusMarkupPercent: 0.05,
        icplusInStorePerTx: 0.05,
        icplusOnlinePerTx: 0.15,
        batchFee: 0.05,
        pciFee: 19.95,
        breachFee: 6.95,
        gatewayFee: 10.00,
        aofFee: 5.00,
        chargebackFee: 25.00,
        retrievalFee: 25.00,
        achReturnFee: 25.00,
        voiceAuthFee: 0.75,
        intlCardPercent: 0.40,
        cashDiscountPercent: null,
        cardSurchargePercent: null,
      },
    },
  };
}

export default function GenerateContractModal({ open, onboarding, onClose, onCreated }: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [mergeValues, setMergeValues] = useState<Record<string, any>>({});
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [planResolution, setPlanResolution] = useState<PlanResolution>(emptyResolution());

  // Resolve the prospect's plan + addons + equipment catalog once when the
  // modal opens. Plan lookup gives us the authoritative basePrice (which
  // respects bundleDiscountPercent / priceOverride for Pro) and addon prices
  // to sum for Starter. Equipment catalog gives us live names + prices so
  // hardware lines pull real data instead of a hardcoded camelCase dictionary
  // that didn't match the kebab-case slugs the onboarding wizard actually writes.
  useEffect(() => {
    let cancelled = false;
    if (!open || !onboarding) return;
    setCreatedId(null);

    (async () => {
      // Run plan + equipment fetches in parallel — they're independent.
      const [planRes, equipRes] = await Promise.allSettled([
        adminListPlans(),
        adminListEquipmentProducts(),
      ]);

      // Plan resolution
      let resolution: PlanResolution = emptyResolution();
      if (planRes.status === 'fulfilled') {
        const r = planRes.value;
        const plans = r?.plans ?? [];
        const slug = onboarding.selectedPlanSlug;
        const matched = slug ? plans.find((p: any) => p.slug === slug) : null;
        if (matched) {
          const base = Number(matched.basePrice ?? 0);
          const allAddons = (matched.addons || []) as Array<{ key: string; label?: string; name?: string; price?: number; monthlyPrice?: number }>;
          const wanted = new Set(onboarding.selectedAddonKeys || []);
          const selected = allAddons
            .filter(a => wanted.has(a.key))
            .map(a => ({
              key: a.key,
              label: a.label || a.name || a.key,
              price: Number(a.price ?? a.monthlyPrice ?? 0),
            }));
          // Pro includes everything by default — addon picker is hidden in
          // onboarding so selectedAddonKeys is empty. Don't double-charge.
          const addonsTotal = slug === 'pro' ? 0 : selected.reduce((s, a) => s + a.price, 0);
          resolution = {
            planSlug: slug,
            planLabel: matched.name || (slug === 'pro' ? 'Pro' : 'Starter'),
            baseMonthlyFee: base > 0 ? base : 79,
            addonsTotalMonthly: addonsTotal,
            addonLines: selected,
            source: 'plan',
          };
        }
      }

      // Equipment catalog — flatten into a slug → {name, price} map. On error
      // we still proceed with an empty map; buildHardwareLines falls back to
      // FALLBACK_LABELS so the admin sees something rather than nothing.
      const bySlug = new Map<string, { name: string; price: number }>();
      if (equipRes.status === 'fulfilled') {
        const list = (equipRes.value || []) as Array<{ slug: string; name: string; price: any; isActive?: boolean }>;
        for (const item of list) {
          if (!item?.slug) continue;
          // Decimal arrives as a string — coerce defensively.
          const priceNum = Number(item.price ?? 0);
          bySlug.set(item.slug, { name: item.name || item.slug, price: Number.isFinite(priceNum) ? priceNum : 0 });
        }
      }

      if (cancelled) return;
      setPlanResolution(resolution);
      setMergeValues(buildInitialMergeValues(onboarding, resolution, { bySlug }));
    })();

    return () => { cancelled = true; };
  }, [open, onboarding]);

  // Esc to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const setMv = (path: string, value: any) => {
    setMergeValues(prev => {
      const copy = JSON.parse(JSON.stringify(prev));
      const parts = path.split('.');
      let cur = copy;
      for (let i = 0; i < parts.length - 1; i++) {
        if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
        cur = cur[parts[i]];
      }
      cur[parts[parts.length - 1]] = value;
      return copy;
    });
  };

  const setHwField = (idx: number, field: 'description' | 'qty' | 'unitPrice', value: any) => {
    setMergeValues(prev => {
      const copy = JSON.parse(JSON.stringify(prev));
      const arr = copy.pricing?.hardware || [];
      if (!arr[idx]) return prev;
      const v = field === 'description' ? value : Number(value) || 0;
      arr[idx][field] = v;
      arr[idx].total = (Number(arr[idx].qty) || 0) * (Number(arr[idx].unitPrice) || 0);
      return copy;
    });
  };
  const addHwRow = () => setMergeValues(prev => {
    const copy = JSON.parse(JSON.stringify(prev));
    if (!copy.pricing) copy.pricing = {};
    if (!Array.isArray(copy.pricing.hardware)) copy.pricing.hardware = [];
    copy.pricing.hardware.push({ description: '', qty: 1, unitPrice: 0, total: 0 });
    return copy;
  });
  const removeHwRow = (idx: number) => setMergeValues(prev => {
    const copy = JSON.parse(JSON.stringify(prev));
    if (Array.isArray(copy.pricing?.hardware)) copy.pricing.hardware.splice(idx, 1);
    return copy;
  });

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const res = await adminCreateContract({
        userId: onboarding.userId,
        vendorOnboardingId: onboarding.id,
        mergeValues,
      });
      setCreatedId(res.contract.id);
      toast.success('Draft contract created.');
      if (onCreated) onCreated(res.contract.id);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to create contract.');
    } finally {
      setSubmitting(false);
    }
  };

  const merchant = mergeValues.merchant || {};
  const saas     = mergeValues.pricing?.saas || {};
  const proc     = mergeValues.pricing?.processing || {};
  const hardware: any[] = mergeValues.pricing?.hardware || [];

  return (
    <div className="gcm-backdrop" onClick={onClose}>
      <div className="gcm-modal" onClick={(e) => e.stopPropagation()}>
        <header className="gcm-head">
          <div className="gcm-head-left">
            <div className="gcm-head-icon"><FileText size={18} /></div>
            <div>
              <h3>Generate Contract</h3>
              <p className="gcm-head-sub">{onboarding.businessLegalName || onboarding.fullName}</p>
            </div>
          </div>
          <button className="gcm-close" onClick={onClose}><X size={18} /></button>
        </header>

        <div className="gcm-body">
          {createdId ? (
            <div className="gcm-success">
              <CheckCircle2 size={48} className="gcm-success-icon" />
              <h3>Draft saved</h3>
              <p>The contract has been created in <strong>draft</strong> status. Open it from the Contracts page to review the rendered preview, fine-tune any fields, and send to the merchant for signature.</p>
              <div className="gcm-success-actions">
                <button className="gcm-btn" onClick={onClose}>Close</button>
                <a className="gcm-btn gcm-btn--primary" href={`/vendor-pipeline?tab=contracts&contractId=${createdId}`}>Open Contract</a>
              </div>
            </div>
          ) : (
            <>
              <p className="gcm-intro">
                Pre-filled from the vendor's onboarding submission. Edit any field before saving.
                After saving, you'll be able to review the rendered contract and send it to the vendor for signature.
              </p>

              {/* Read-only context panel — surfaces the rest of the onboarding
                  data (industry, volume, current POS, etc.) that doesn't go on
                  the contract but is useful for choosing processing tier +
                  hardware quantities. Hidden when the prospect provided
                  nothing in this section. */}
              {(onboarding.industry || onboarding.numStoresRange || onboarding.monthlyVolumeRange ||
                onboarding.avgTxPerDay || onboarding.currentPOS || onboarding.goLiveTimeline ||
                onboarding.yearsInBusiness || onboarding.specialRequirements) && (
                <div className="gcm-context">
                  <div className="gcm-context-title">Onboarding Context (read-only)</div>
                  <div className="gcm-context-grid">
                    {onboarding.industry && <div><span>Industry:</span> {onboarding.industry.replace(/_/g, ' ')}</div>}
                    {onboarding.yearsInBusiness && <div><span>Years in Business:</span> {onboarding.yearsInBusiness}</div>}
                    {onboarding.numStoresRange && (
                      <div>
                        <span># Stores:</span> {onboarding.numStoresRange}
                        {onboarding.numStoresExact ? ` (${onboarding.numStoresExact} exact)` : ''}
                      </div>
                    )}
                    {onboarding.numRegistersPerStore && <div><span>Registers/Store:</span> {onboarding.numRegistersPerStore}</div>}
                    {onboarding.monthlyVolumeRange && <div><span>Monthly Volume:</span> {onboarding.monthlyVolumeRange}</div>}
                    {onboarding.avgTxPerDay && <div><span>Avg Tx/Day:</span> {onboarding.avgTxPerDay}</div>}
                    {onboarding.currentPOS && <div><span>Current POS:</span> {onboarding.currentPOS}</div>}
                    {onboarding.goLiveTimeline && <div><span>Go-Live Timeline:</span> {onboarding.goLiveTimeline}</div>}
                  </div>
                  {onboarding.specialRequirements && (
                    <div className="gcm-context-special">
                      <strong>Special requirements from prospect:</strong>
                      <p>{onboarding.specialRequirements}</p>
                    </div>
                  )}
                </div>
              )}

              <div className="gcm-vendor-hint">
                <strong>Note:</strong> after you send this contract, the vendor can edit Merchant Identity, Owner, and Bank fields on the signing page before signing. Pricing, hardware quantities, and processing terms are <em>locked</em> for the vendor — only the admin can change those before send.
              </div>

              <Section title="Merchant Identity">
                <Grid>
                  <Field label="Legal Business Name" required value={merchant.businessLegalName} onChange={v => setMv('merchant.businessLegalName', v)} />
                  <Field label="DBA" value={merchant.dbaName} onChange={v => setMv('merchant.dbaName', v)} />
                  <Field label="Business Address" wide value={merchant.address} onChange={v => setMv('merchant.address', v)} />
                  <Field label="City / State / ZIP" value={merchant.cityStateZip} onChange={v => setMv('merchant.cityStateZip', v)} />
                  <Field label="Phone" value={merchant.phone} onChange={v => setMv('merchant.phone', v)} />
                  <Field label="Email" value={merchant.email} onChange={v => setMv('merchant.email', v)} />
                  <Field label="EIN" value={merchant.ein} onChange={v => setMv('merchant.ein', v)} />
                  <Field label="Business Type" value={merchant.businessType} onChange={v => setMv('merchant.businessType', v)} type="select" options={['LLC', 'Corp', 'Sole Prop', 'Partnership']} />
                  <Field label="Owner Name" value={merchant.ownerName} onChange={v => setMv('merchant.ownerName', v)} />
                  <Field label="Owner Phone" value={merchant.ownerPhone} onChange={v => setMv('merchant.ownerPhone', v)} />
                  <Field label="Owner DOB" type="date" value={merchant.ownerDob} onChange={v => setMv('merchant.ownerDob', v)} />
                  <Field label="Owner SSN/EIN (last 4)" value={merchant.ownerSsnLast4} onChange={v => setMv('merchant.ownerSsnLast4', v)} />
                  <Field label="State of Incorporation" value={merchant.stateOfIncorporation} onChange={v => setMv('merchant.stateOfIncorporation', v)} />
                  <Field label="# Locations" type="number" value={merchant.numLocations} onChange={v => setMv('merchant.numLocations', Number(v) || 1)} />
                  <Field label="MCC Code" value={merchant.mccCode} onChange={v => setMv('merchant.mccCode', v)} />
                  <Field label="Agreement Date" type="date" value={mergeValues.agreementDate} onChange={v => setMv('agreementDate', v)} />
                </Grid>
              </Section>

              <Section title="SaaS Subscription">
                {planResolution.source === 'plan' ? (
                  <div className="gcm-plan-banner">
                    <strong>Plan Selected:</strong> {planResolution.planLabel}
                    {planResolution.planSlug === 'pro' && ' — all modules included'}
                    {planResolution.addonLines.length > 0 && (
                      <>
                        {' '}— add-ons:{' '}
                        {planResolution.addonLines.map((a, i) => (
                          <span key={a.key}>
                            {i > 0 && ', '}
                            {a.label} (${a.price.toFixed(2)})
                          </span>
                        ))}
                      </>
                    )}
                  </div>
                ) : onboarding.selectedPlanSlug ? (
                  <div className="gcm-plan-banner gcm-plan-banner-warn">
                    Could not load plan catalog — showing default fallback values. Please verify before sending.
                  </div>
                ) : null}
                <Grid>
                  <Field label="Base Monthly Fee ($)" type="number" value={saas.baseMonthlyFee} onChange={v => setMv('pricing.saas.baseMonthlyFee', Number(v) || 0)} />
                  <Field label="Per-Additional-License ($)" type="number" value={saas.additionalLicenseFee} onChange={v => setMv('pricing.saas.additionalLicenseFee', Number(v) || 0)} />
                  <Field label="Add-ons Total ($/mo)" type="number" value={saas.addonsTotalMonthly} onChange={v => setMv('pricing.saas.addonsTotalMonthly', Number(v) || 0)} />
                </Grid>
              </Section>

              <Section title="Hardware Order">
                <table className="gcm-hw-table">
                  <thead>
                    <tr><th>Description</th><th>Qty</th><th>Unit Price</th><th>Total</th><th></th></tr>
                  </thead>
                  <tbody>
                    {hardware.length === 0 && (
                      <tr><td colSpan={5} className="gcm-empty">No hardware ordered.</td></tr>
                    )}
                    {hardware.map((h, idx) => (
                      <tr key={idx}>
                        <td><input className="gcm-input" value={h.description || ''} onChange={e => setHwField(idx, 'description', e.target.value)} /></td>
                        <td><input className="gcm-input gcm-w-60" type="number" min={0} value={h.qty || 0} onChange={e => setHwField(idx, 'qty', e.target.value)} /></td>
                        <td><input className="gcm-input gcm-w-90" type="number" min={0} step={0.01} value={h.unitPrice || 0} onChange={e => setHwField(idx, 'unitPrice', e.target.value)} /></td>
                        <td className="gcm-cell-num">${Number(h.total || 0).toFixed(2)}</td>
                        <td><button className="gcm-row-del" onClick={() => removeHwRow(idx)}>×</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button className="gcm-btn gcm-btn-add" onClick={addHwRow}>+ Add Item</button>
              </Section>

              <Section title="Payment Processing">
                <Grid>
                  <Field label="Processing Model" type="select" options={[{ value: 'IC+', label: 'Interchange Plus (IC+)' }, { value: 'dual_pricing', label: 'Dual Pricing' }]} value={proc.model} onChange={v => setMv('pricing.processing.model', v)} />
                  <Field label="IC+ Volume Markup (%)" type="number" step={0.001} value={proc.icplusMarkupPercent} onChange={v => setMv('pricing.processing.icplusMarkupPercent', Number(v) || 0)} />
                  <Field label="In-Store Per Tx ($)" type="number" step={0.01} value={proc.icplusInStorePerTx} onChange={v => setMv('pricing.processing.icplusInStorePerTx', Number(v) || 0)} />
                  <Field label="Online Per Tx ($)" type="number" step={0.01} value={proc.icplusOnlinePerTx} onChange={v => setMv('pricing.processing.icplusOnlinePerTx', Number(v) || 0)} />
                  <Field label="Batch Fee ($)" type="number" step={0.01} value={proc.batchFee} onChange={v => setMv('pricing.processing.batchFee', Number(v) || 0)} />
                  <Field label="PCI Fee ($/mo)" type="number" step={0.01} value={proc.pciFee} onChange={v => setMv('pricing.processing.pciFee', Number(v) || 0)} />
                  <Field label="Breach Coverage ($/mo)" type="number" step={0.01} value={proc.breachFee} onChange={v => setMv('pricing.processing.breachFee', Number(v) || 0)} />
                  <Field label="Gateway/Terminal ($/mo)" type="number" step={0.01} value={proc.gatewayFee} onChange={v => setMv('pricing.processing.gatewayFee', Number(v) || 0)} />
                  <Field label="Account on File ($/mo)" type="number" step={0.01} value={proc.aofFee} onChange={v => setMv('pricing.processing.aofFee', Number(v) || 0)} />
                  <Field label="Chargeback ($)" type="number" step={0.01} value={proc.chargebackFee} onChange={v => setMv('pricing.processing.chargebackFee', Number(v) || 0)} />
                  <Field label="Retrieval ($)" type="number" step={0.01} value={proc.retrievalFee} onChange={v => setMv('pricing.processing.retrievalFee', Number(v) || 0)} />
                  <Field label="ACH Return ($)" type="number" step={0.01} value={proc.achReturnFee} onChange={v => setMv('pricing.processing.achReturnFee', Number(v) || 0)} />
                  <Field label="Voice Auth ($)" type="number" step={0.01} value={proc.voiceAuthFee} onChange={v => setMv('pricing.processing.voiceAuthFee', Number(v) || 0)} />
                  <Field label="International Card (%)" type="number" step={0.01} value={proc.intlCardPercent} onChange={v => setMv('pricing.processing.intlCardPercent', Number(v) || 0)} />
                  {proc.model === 'dual_pricing' && (
                    <>
                      <Field label="Cash Discount %" type="number" step={0.01} value={proc.cashDiscountPercent} onChange={v => setMv('pricing.processing.cashDiscountPercent', v === '' ? null : Number(v))} />
                      <Field label="Card Surcharge %" type="number" step={0.01} value={proc.cardSurchargePercent} onChange={v => setMv('pricing.processing.cardSurchargePercent', v === '' ? null : Number(v))} />
                    </>
                  )}
                </Grid>
              </Section>
            </>
          )}
        </div>

        {!createdId && (
          <footer className="gcm-foot">
            <button className="gcm-btn" onClick={onClose}>Cancel</button>
            <button className="gcm-btn gcm-btn--primary" onClick={handleSubmit} disabled={submitting}>
              {submitting ? <Loader size={14} className="gcm-spin" /> : 'Save Draft & Continue'}
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}

// ── Internal layout helpers ──
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="gcm-section">
      <h4 className="gcm-section-title">{title}</h4>
      {children}
    </section>
  );
}
function Grid({ children }: { children: React.ReactNode }) {
  return <div className="gcm-grid">{children}</div>;
}
interface FieldProps {
  label: string;
  value: any;
  onChange: (v: any) => void;
  type?: 'text' | 'number' | 'date' | 'select';
  options?: Array<string | { value: string; label: string }>;
  step?: number;
  required?: boolean;
  wide?: boolean;
}
function Field({ label, value, onChange, type = 'text', options, step, required, wide }: FieldProps) {
  const v = value ?? '';
  return (
    <div className={`gcm-field ${wide ? 'is-wide' : ''}`}>
      <label>{label}{required && <span className="gcm-req">*</span>}</label>
      {type === 'select' ? (
        <select className="gcm-input" value={v} onChange={e => onChange(e.target.value)}>
          <option value="">— select —</option>
          {(options || []).map((opt) => {
            if (typeof opt === 'string') return <option key={opt} value={opt}>{opt}</option>;
            return <option key={opt.value} value={opt.value}>{opt.label}</option>;
          })}
        </select>
      ) : (
        <input
          className="gcm-input"
          type={type}
          step={step}
          value={v}
          onChange={e => onChange(e.target.value)}
        />
      )}
    </div>
  );
}
