// ─────────────────────────────────────────────────
// Vendor Onboarding Wizard — S77 Phase 1
// 5-step business questionnaire shown after signup, before portal access.
// Step 1 prefilled from signup; Steps 2-5 capture business + module + hardware
// + context. On submit, user is locked out of portal until admin approval.
// ─────────────────────────────────────────────────
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronLeft, ChevronRight, Loader, CheckCircle2, Building2, Store,
  ShoppingBag, Cpu, MessageSquare, Save, AlertCircle, Plus, Minus,
} from 'lucide-react';
import { toast } from 'react-toastify';
import StoreveuLogo from '../components/StoreveuLogo';
import {
  getMyVendorOnboarding,
  updateMyVendorOnboarding,
  submitMyVendorOnboarding,
  listEquipmentProducts,
  resolveStaticUrl,
  getPublicPlans,   // S80 Phase 3 — dynamic plan + addon catalog for Step 3
} from '../services/api';
import './VendorOnboarding.css';

// ── Option lists (mirror backend enum guards) ──
const BUSINESS_TYPES   = ['LLC', 'Corp', 'SoleProp', 'Partnership', 'Nonprofit', 'Other'];
const YEARS_IN_BUSINESS = ['<1', '1-3', '3-5', '5-10', '10+'];
const INDUSTRIES = [
  { value: 'convenience',  label: 'Convenience Store' },
  { value: 'liquor',       label: 'Liquor Store' },
  { value: 'grocery',      label: 'Grocery / Supermarket' },
  { value: 'gas_station',  label: 'Gas Station' },
  { value: 'restaurant',   label: 'Restaurant / QSR' },
  { value: 'smoke_shop',   label: 'Smoke Shop' },
  { value: 'other',        label: 'Other' },
];
const STORE_RANGES  = ['1', '2-5', '6-10', '11+'];
const VOLUME_RANGES = [
  { value: '0-50k',     label: 'Under $50k / month' },
  { value: '50k-200k',  label: '$50k – $200k / month' },
  { value: '200k-500k', label: '$200k – $500k / month' },
  { value: '500k-1m',   label: '$500k – $1M / month' },
  { value: '1m+',       label: '$1M+ / month' },
];
const POS_VENDORS = ['None', 'NCR', 'Verifone', 'Square', 'Clover', 'Shopify', 'Other'];
const TIMELINES = [
  { value: 'immediate', label: 'Immediately (within 2 weeks)' },
  { value: '1month',    label: 'Within 1 month' },
  { value: '3months',   label: 'Within 3 months' },
  { value: 'exploring', label: 'Just exploring' },
];

// S80 Phase 3 — MODULES list removed. Step 3 now loads the plan + addon
// catalog from /api/billing/plans (see `getPublicPlans()` in services/api).
// New addons added by admin show up automatically.

// Hardware items are fetched live from /api/equipment/products (the same
// catalog the admin Billing → Equipment tab manages). Fuel + Scale
// integrations are rendered separately as toggles below the device grid.

const HEAR_ABOUT_OPTIONS = [
  { value: 'search',   label: 'Search engine' },
  { value: 'referral', label: 'Referral from another store owner' },
  { value: 'event',    label: 'Trade show / event' },
  { value: 'social',   label: 'Social media' },
  { value: 'partner',  label: 'Partner / distributor' },
  { value: 'other',    label: 'Other' },
];

const TOTAL_STEPS = 5;

// ── Step indicator ──
function StepDots({ current }) {
  return (
    <div className="vob-steps">
      {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
        <div key={i} className="vob-step-cell">
          <div className={`vob-step-dot ${i === current ? 'is-active' : i < current ? 'is-done' : ''}`}>
            {i < current ? <CheckCircle2 size={14} /> : i + 1}
          </div>
          <span className="vob-step-label">
            {['Identity', 'Operations', 'Modules', 'Hardware', 'Review'][i]}
          </span>
        </div>
      ))}
    </div>
  );
}

function Field({ label, hint, required, children, error }) {
  return (
    <div className="vob-field">
      <label className="vob-label">
        {label}
        {required && <span className="vob-req">*</span>}
        {hint && <span className="vob-hint">{hint}</span>}
      </label>
      {children}
      {error && <p className="vob-field-error">{error}</p>}
    </div>
  );
}

export default function VendorOnboarding() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState({});
  const [devices, setDevices] = useState([]); // active EquipmentProduct rows
  const [form, setForm] = useState({
    fullName: '', email: '', phone: '',
    businessLegalName: '', dbaName: '',
    businessAddress: '', businessCity: '', businessState: '', businessZip: '',
    businessType: '', ein: '', yearsInBusiness: '',
    industry: '', numStoresRange: '', numStoresExact: '', numRegistersPerStore: '',
    monthlyVolumeRange: '', avgTxPerDay: '', currentPOS: '', goLiveTimeline: '',
    requestedModules: ['pos_core'],
    // S80 Phase 3 — plan + addon picker (interest-only at this stage; admin
    // sees the picks at approval time and can apply them to the resulting
    // StoreSubscription, but they aren't auto-applied today).
    selectedPlanSlug: 'starter',
    selectedAddonKeys: [],
    hardwareNeeds: {},
    hearAboutUs: '', referralSource: '', specialRequirements: '',
    agreedToTerms: false,
  });
  const dirty = useRef(false);

  // S80 Phase 3 — live plan + addon catalog from /api/billing/plans.
  // Falls back to a small static set if the API is unreachable so the form
  // still renders during signup before the backend is reachable.
  const [planCatalog, setPlanCatalog] = useState([]);

  // ── Load equipment catalog (single source of truth — same data the
  //    Billing → Equipment tab manages). Failure is non-fatal: vendors
  //    can still submit; admin will follow up about hardware separately. ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await listEquipmentProducts();
        if (cancelled) return;
        const rows = Array.isArray(list) ? list : (list?.data || []);
        setDevices(rows.filter(d => d.isActive !== false));
      } catch (err) {
        if (!cancelled) console.warn('[VendorOnboarding] device catalog fetch failed', err);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Load plan catalog (S80 Phase 3 — drives the dynamic plan + addon picker).
  //    Same /api/billing/plans the marketing pricing page reads, so any new
  //    add-on added by admin shows up here automatically. ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await getPublicPlans();
        if (cancelled) return;
        const plans = Array.isArray(list) ? list : (list?.plans || []);
        setPlanCatalog(plans.filter(p => p.isActive !== false));
      } catch (err) {
        if (!cancelled) console.warn('[VendorOnboarding] plan catalog fetch failed', err);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Initial load ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getMyVendorOnboarding();
        if (cancelled) return;

        // If they've already submitted, kick to the awaiting page.
        if (data.userFlags?.onboardingSubmitted) {
          navigate('/vendor-onboarding/awaiting', { replace: true });
          return;
        }

        const o = data.onboarding;
        setForm(prev => ({
          ...prev,
          fullName: o.fullName || '',
          email: o.email || '',
          phone: o.phone || '',
          businessLegalName: o.businessLegalName || '',
          dbaName: o.dbaName || '',
          businessAddress: o.businessAddress || '',
          businessCity: o.businessCity || '',
          businessState: o.businessState || '',
          businessZip: o.businessZip || '',
          businessType: o.businessType || '',
          ein: o.ein || '',
          yearsInBusiness: o.yearsInBusiness || '',
          industry: o.industry || '',
          numStoresRange: o.numStoresRange || '',
          numStoresExact: o.numStoresExact ?? '',
          numRegistersPerStore: o.numRegistersPerStore ?? '',
          monthlyVolumeRange: o.monthlyVolumeRange || '',
          avgTxPerDay: o.avgTxPerDay ?? '',
          currentPOS: o.currentPOS || '',
          goLiveTimeline: o.goLiveTimeline || '',
          requestedModules: o.requestedModules?.length ? o.requestedModules : ['pos_core'],
          // S80 Phase 3 — restore prior picks if vendor saved a draft earlier
          selectedPlanSlug: o.selectedPlanSlug || 'starter',
          selectedAddonKeys: Array.isArray(o.selectedAddonKeys) ? o.selectedAddonKeys : [],
          hardwareNeeds: o.hardwareNeeds || {},
          hearAboutUs: o.hearAboutUs || '',
          referralSource: o.referralSource || '',
          specialRequirements: o.specialRequirements || '',
          agreedToTerms: o.agreedToTerms || false,
        }));
        if (typeof o.currentStep === 'number') {
          setStep(Math.max(0, Math.min(TOTAL_STEPS - 1, o.currentStep - 1)));
        }
      } catch (err) {
        toast.error(err.response?.data?.error || 'Failed to load onboarding form.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [navigate]);

  // ── beforeunload guard ──
  useEffect(() => {
    const handler = (e) => {
      if (dirty.current) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  const set = (k, v) => {
    dirty.current = true;
    setForm(prev => ({ ...prev, [k]: v }));
    if (errors[k]) setErrors(prev => ({ ...prev, [k]: null }));
  };

  const setHw = (key, value) => {
    dirty.current = true;
    setForm(prev => ({ ...prev, hardwareNeeds: { ...prev.hardwareNeeds, [key]: value } }));
  };

  // Live cart calculation for the hardware step. Recomputes on every qty
  // change so the total card stays in sync with the +/- buttons. Numeric-
  // counted devices use slug → qty × price; integration toggles are
  // intentionally excluded (not billable hardware — quoted separately).
  const cart = useMemo(() => {
    const lines = [];
    let total = 0;
    let totalUnits = 0;
    for (const d of devices) {
      const qty = Number(form.hardwareNeeds[d.slug] || 0);
      if (qty <= 0) continue;
      const unit  = Number(d.price || 0);
      const lineTotal = unit * qty;
      lines.push({ id: d.id, slug: d.slug, name: d.name, qty, unit, lineTotal });
      total += lineTotal;
      totalUnits += qty;
    }
    return { lines, total, totalUnits };
  }, [devices, form.hardwareNeeds]);

  // ── S80 Phase 3 — plan + addon picker handlers ──
  const selectedPlan = useMemo(() => {
    return planCatalog.find(p => p.slug === form.selectedPlanSlug) || null;
  }, [planCatalog, form.selectedPlanSlug]);

  const selectPlan = (slug) => {
    dirty.current = true;
    setForm(prev => ({
      ...prev,
      selectedPlanSlug: slug,
      // When switching to Pro, wipe addons (Pro includes everything by default)
      selectedAddonKeys: slug === 'pro' ? [] : prev.selectedAddonKeys,
    }));
  };

  const toggleAddon = (key) => {
    dirty.current = true;
    setForm(prev => ({
      ...prev,
      selectedAddonKeys: prev.selectedAddonKeys.includes(key)
        ? prev.selectedAddonKeys.filter(k => k !== key)
        : [...prev.selectedAddonKeys, key],
    }));
  };

  // Live monthly total — base price + selected addon prices.
  const subscriptionTotal = useMemo(() => {
    if (!selectedPlan) return { base: 0, addons: 0, total: 0, addonLines: [] };
    const base = Number(selectedPlan.basePrice ?? 0);
    if (form.selectedPlanSlug === 'pro') {
      // Pro = everything included, no addons
      return { base, addons: 0, total: base, addonLines: [] };
    }
    const addonLines = (selectedPlan.addons || [])
      .filter(a => form.selectedAddonKeys.includes(a.key))
      .map(a => ({ key: a.key, label: a.label || a.name || a.key, price: Number(a.price ?? a.monthlyPrice ?? 0) }));
    const addons = addonLines.reduce((s, a) => s + a.price, 0);
    return { base, addons, total: base + addons, addonLines };
  }, [selectedPlan, form.selectedPlanSlug, form.selectedAddonKeys]);

  // ── Save draft (called on Next) ──
  const saveDraft = async (nextStep = step) => {
    setSaving(true);
    try {
      const payload = {
        ...form,
        currentStep: nextStep + 1,
        // S80 Phase 3 — mirror live cart total to the saved record so admin
        // can see the monthly estimate without recomputing on the server.
        estimatedMonthlyTotal: subscriptionTotal.total,
      };
      await updateMyVendorOnboarding(payload);
      dirty.current = false;
      return true;
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save draft.');
      return false;
    } finally {
      setSaving(false);
    }
  };

  // ── Step validators ──
  const validateStep = (idx) => {
    const e = {};
    if (idx === 0) {
      if (!form.fullName.trim())          e.fullName = 'Required';
      if (!form.email.trim())             e.email = 'Required';
      if (!form.businessLegalName.trim()) e.businessLegalName = 'Required';
      if (!form.businessType)             e.businessType = 'Please select';
    }
    if (idx === 1) {
      if (!form.industry)           e.industry = 'Please select';
      if (!form.numStoresRange)     e.numStoresRange = 'Please select';
      if (!form.monthlyVolumeRange) e.monthlyVolumeRange = 'Please select';
      if (!form.goLiveTimeline)     e.goLiveTimeline = 'Please select';
    }
    if (idx === 2) {
      // S80 Phase 3 — must pick a plan (Starter or Pro). Addons optional.
      if (!form.selectedPlanSlug) e.selectedPlanSlug = 'Please pick a plan';
    }
    if (idx === 4) {
      if (!form.agreedToTerms) e.agreedToTerms = 'You must agree to continue';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleNext = async () => {
    if (!validateStep(step)) return;
    const ok = await saveDraft(step + 1);
    if (!ok) return;
    if (step < TOTAL_STEPS - 1) setStep(step + 1);
  };

  const handleBack = async () => {
    if (step > 0) {
      await saveDraft(step - 1);
      setStep(step - 1);
    }
  };

  const handleSubmit = async () => {
    if (!validateStep(4)) return;
    setSubmitting(true);
    try {
      await submitMyVendorOnboarding({
        ...form,
        currentStep: TOTAL_STEPS,
        estimatedMonthlyTotal: subscriptionTotal.total,
      });
      // Update localStorage user flag so ProtectedRoute can route correctly.
      const u = JSON.parse(localStorage.getItem('user') || '{}');
      u.onboardingSubmitted = true;
      localStorage.setItem('user', JSON.stringify(u));
      window.dispatchEvent(new Event('storv:auth-change'));
      toast.success('Submitted! Your account is now under review.');
      navigate('/vendor-onboarding/awaiting', { replace: true });
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to submit onboarding.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Step content renderers ──
  const stepIcon = useMemo(() => [
    <Building2 key="0" size={22} />,
    <Store     key="1" size={22} />,
    <ShoppingBag key="2" size={22} />,
    <Cpu       key="3" size={22} />,
    <MessageSquare key="4" size={22} />,
  ], []);
  const stepTitle = ['Tell us about your business', 'How do you operate today?', 'Which modules interest you?', 'Hardware needs', 'Anything else?'];

  if (loading) {
    return (
      <div className="vob-page">
        <div className="vob-card">
          <div className="vob-loading"><Loader size={28} className="vob-spinner" /></div>
        </div>
      </div>
    );
  }

  return (
    <div className="vob-page">
      <div className="vob-card">
        <div className="vob-header">
          <StoreveuLogo height={36} darkMode={false} />
          <button
            type="button"
            className="vob-save-btn"
            onClick={() => saveDraft(step).then(ok => ok && toast.success('Draft saved.'))}
            disabled={saving}
          >
            {saving ? <Loader size={14} className="vob-spinner" /> : <Save size={14} />}
            Save draft
          </button>
        </div>

        <StepDots current={step} />

        <div className="vob-step-head">
          <div className="vob-step-icon">{stepIcon[step]}</div>
          <div>
            <h2 className="vob-step-title">{stepTitle[step]}</h2>
            <p className="vob-step-subtitle">Step {step + 1} of {TOTAL_STEPS}</p>
          </div>
        </div>

        {/* ── Step 0 — Identity ── */}
        {step === 0 && (
          <div className="vob-grid">
            <Field label="Full name" required error={errors.fullName}>
              <input className="vob-input" value={form.fullName} onChange={e => set('fullName', e.target.value)} />
            </Field>
            <Field label="Email" required error={errors.email}>
              <input className="vob-input" type="email" value={form.email} onChange={e => set('email', e.target.value)} />
            </Field>
            <Field label="Phone">
              <input className="vob-input" value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="+1 (555) 000-0000" />
            </Field>
            <Field label="Business legal name" required hint="As shown on tax docs" error={errors.businessLegalName}>
              <input className="vob-input" value={form.businessLegalName} onChange={e => set('businessLegalName', e.target.value)} />
            </Field>
            <Field label="Doing business as (DBA)" hint="If different from legal name">
              <input className="vob-input" value={form.dbaName} onChange={e => set('dbaName', e.target.value)} />
            </Field>
            <Field label="EIN / Tax ID" hint="Optional">
              <input className="vob-input" value={form.ein} onChange={e => set('ein', e.target.value)} />
            </Field>
            <Field label="Business address" hint="Street">
              <input className="vob-input" value={form.businessAddress} onChange={e => set('businessAddress', e.target.value)} />
            </Field>
            <Field label="City">
              <input className="vob-input" value={form.businessCity} onChange={e => set('businessCity', e.target.value)} />
            </Field>
            <Field label="State">
              <input className="vob-input" maxLength={2} placeholder="NY" value={form.businessState} onChange={e => set('businessState', e.target.value.toUpperCase())} />
            </Field>
            <Field label="ZIP">
              <input className="vob-input" value={form.businessZip} onChange={e => set('businessZip', e.target.value)} />
            </Field>
            <Field label="Business type" required error={errors.businessType}>
              <select className="vob-input" value={form.businessType} onChange={e => set('businessType', e.target.value)}>
                <option value="">— select —</option>
                {BUSINESS_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Years in business">
              <select className="vob-input" value={form.yearsInBusiness} onChange={e => set('yearsInBusiness', e.target.value)}>
                <option value="">— select —</option>
                {YEARS_IN_BUSINESS.map(y => <option key={y} value={y}>{y} years</option>)}
              </select>
            </Field>
          </div>
        )}

        {/* ── Step 1 — Operations ── */}
        {step === 1 && (
          <div className="vob-grid">
            <Field label="Industry" required error={errors.industry}>
              <select className="vob-input" value={form.industry} onChange={e => set('industry', e.target.value)}>
                <option value="">— select —</option>
                {INDUSTRIES.map(i => <option key={i.value} value={i.value}>{i.label}</option>)}
              </select>
            </Field>
            <Field label="Number of stores" required error={errors.numStoresRange}>
              <select className="vob-input" value={form.numStoresRange} onChange={e => set('numStoresRange', e.target.value)}>
                <option value="">— select —</option>
                {STORE_RANGES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </Field>
            <Field label="Exact store count" hint="Optional">
              <input className="vob-input" type="number" min={1} max={9999} value={form.numStoresExact} onChange={e => set('numStoresExact', e.target.value)} />
            </Field>
            <Field label="Registers per store" hint="Average">
              <input className="vob-input" type="number" min={1} max={99} value={form.numRegistersPerStore} onChange={e => set('numRegistersPerStore', e.target.value)} />
            </Field>
            <Field label="Avg monthly transaction volume" required error={errors.monthlyVolumeRange}>
              <select className="vob-input" value={form.monthlyVolumeRange} onChange={e => set('monthlyVolumeRange', e.target.value)}>
                <option value="">— select —</option>
                {VOLUME_RANGES.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
              </select>
            </Field>
            <Field label="Avg transactions / day" hint="Optional">
              <input className="vob-input" type="number" min={0} max={99999} value={form.avgTxPerDay} onChange={e => set('avgTxPerDay', e.target.value)} />
            </Field>
            <Field label="Current POS system">
              <select className="vob-input" value={form.currentPOS} onChange={e => set('currentPOS', e.target.value)}>
                <option value="">— select —</option>
                {POS_VENDORS.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </Field>
            <Field label="When do you want to go live?" required error={errors.goLiveTimeline}>
              <select className="vob-input" value={form.goLiveTimeline} onChange={e => set('goLiveTimeline', e.target.value)}>
                <option value="">— select —</option>
                {TIMELINES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </Field>
          </div>
        )}

        {/* ── Step 2 — Plan + Add-on picker (S80 Phase 3) ──
            Dynamic from /api/billing/plans so any add-on the admin enables
            shows up here automatically. Captures interest only — admin
            applies the picks at approval time when creating the
            StoreSubscription. ── */}
        {step === 2 && (
          <div>
            <p className="vob-step-desc">
              Pick the plan that fits your store. You're not charged today — onboarding
              starts a 14-day free trial after admin approval.
            </p>

            {/* Plan tiles */}
            <div className="vob-plan-tiles">
              {planCatalog.length === 0 ? (
                <div className="vob-plan-empty">Loading plan catalog…</div>
              ) : planCatalog.map(p => {
                const sel = form.selectedPlanSlug === p.slug;
                return (
                  <button
                    key={p.slug}
                    type="button"
                    className={`vob-plan-tile ${sel ? 'is-selected' : ''} ${p.highlighted ? 'is-highlighted' : ''}`}
                    onClick={() => selectPlan(p.slug)}
                  >
                    <div className="vob-plan-tile-head">
                      <span className="vob-plan-tile-name">{p.name}</span>
                      {p.highlighted && <span className="vob-plan-tile-badge">Most Popular</span>}
                    </div>
                    <div className="vob-plan-tile-price">
                      ${Number(p.basePrice ?? 0)}<span className="vob-plan-tile-period">/mo per store</span>
                    </div>
                    {p.tagline && <div className="vob-plan-tile-tagline">{p.tagline}</div>}
                    {p.slug === 'pro' && (
                      <div className="vob-plan-tile-pro-pill">All add-ons included</div>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Add-ons — only when Starter selected (Pro = all included) */}
            {form.selectedPlanSlug === 'starter' && selectedPlan && (
              <>
                <div className="vob-addons-header">
                  <h3 className="vob-addons-title">Add-ons</h3>
                  <span className="vob-addons-hint">Add only what you need. Skip if you're not sure — you can add anytime.</span>
                </div>
                <div className="vob-addons-grid">
                  {(selectedPlan.addons || []).map(a => {
                    const sel = form.selectedAddonKeys.includes(a.key);
                    return (
                      <label key={a.key} className={`vob-addon-card ${sel ? 'is-checked' : ''}`}>
                        <input
                          type="checkbox"
                          checked={sel}
                          onChange={() => toggleAddon(a.key)}
                        />
                        <div className="vob-addon-card-body">
                          <div className="vob-addon-card-head">
                            <span className="vob-addon-card-name">{a.label || a.name}</span>
                            <span className="vob-addon-card-price">+${Number(a.price ?? a.monthlyPrice ?? 0)}/mo</span>
                          </div>
                          {a.description && <div className="vob-addon-card-desc">{a.description}</div>}
                        </div>
                      </label>
                    );
                  })}
                </div>
              </>
            )}

            {form.selectedPlanSlug === 'pro' && (
              <div className="vob-pro-summary">
                <strong>Pro includes everything</strong> — Lottery, Fuel, E-Commerce, Marketplace,
                Loyalty, AI Assistant, Tobacco Scan Data, and every other module. No add-ons to pick.
              </div>
            )}

            {/* Live cart — estimated monthly subscription */}
            <div className="vob-sub-cart">
              <div className="vob-sub-cart-title">Your monthly subscription estimate</div>
              <div className="vob-sub-cart-line">
                <span>{selectedPlan?.name || 'No plan selected'}</span>
                <span>${subscriptionTotal.base.toFixed(2)}</span>
              </div>
              {subscriptionTotal.addonLines.map(a => (
                <div key={a.key} className="vob-sub-cart-line vob-sub-cart-addon">
                  <span>+ {a.label}</span>
                  <span>+${a.price.toFixed(2)}</span>
                </div>
              ))}
              <div className="vob-sub-cart-total">
                <span>Total</span>
                <span>${subscriptionTotal.total.toFixed(2)} / month</span>
              </div>
              <div className="vob-sub-cart-note">
                14-day free trial · No credit card required · Cancel anytime.
              </div>
            </div>
          </div>
        )}

        {/* ── Step 3 — Hardware ── */}
        {step === 3 && (
          <div>
            <p className="vob-step-desc">How many of each item do you need? Leave 0 if you already have your own. We'll quote pricing in your contract.</p>

            {/* Devices fetched from /api/equipment/products — same catalog
                the admin Billing → Equipment tab manages. Use the device
                slug as the storage key so admins can add new device types
                without code changes. */}
            <div className="vob-device-grid">
              {devices.length === 0 ? (
                <div className="vob-device-empty">
                  <Loader size={16} className="spin" /> Loading equipment catalog…
                </div>
              ) : devices.map(d => {
                const qty = Number(form.hardwareNeeds[d.slug] || 0);
                const img = Array.isArray(d.images) && d.images.length > 0 ? d.images[0] : '';
                return (
                  <div key={d.id} className={`vob-device-card${qty > 0 ? ' vob-device-card--selected' : ''}`}>
                    <div className="vob-device-img">
                      {img
                        ? <img src={resolveStaticUrl(img)} alt={d.name} onError={e => { e.target.style.opacity = '0.3'; }} />
                        : <div className="vob-device-img-empty">No image</div>}
                    </div>
                    <div className="vob-device-body">
                      <div className="vob-device-name">{d.name}</div>
                      {d.description && <div className="vob-device-desc">{d.description}</div>}
                      {d.price != null && <div className="vob-device-price">${Number(d.price).toFixed(2)}</div>}
                    </div>
                    <div className="vob-device-qty">
                      <button
                        type="button"
                        className="vob-qty-btn"
                        onClick={() => setHw(d.slug, Math.max(0, qty - 1))}
                        disabled={qty <= 0}
                        aria-label={`Decrease ${d.name}`}
                      >
                        <Minus size={14} />
                      </button>
                      <input
                        type="number"
                        min={0}
                        max={999}
                        className="vob-qty-input"
                        value={qty}
                        onChange={e => {
                          const v = e.target.value === '' ? 0 : Math.max(0, Math.min(999, Number(e.target.value)));
                          setHw(d.slug, v);
                        }}
                      />
                      <button
                        type="button"
                        className="vob-qty-btn"
                        onClick={() => setHw(d.slug, Math.min(999, qty + 1))}
                        aria-label={`Increase ${d.name}`}
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Integration toggles — stay separate from the device catalog,
                per spec. Fuel + Scale integrations live on their respective
                modules and aren't billable hardware items. */}
            <div className="vob-integrations">
              <h4 className="vob-integrations-title">Integrations</h4>
              <div className="vob-hardware">
                <div className="vob-hw-row">
                  <span className="vob-hw-label">Fuel Pump Integration</span>
                  <label className="vob-hw-toggle">
                    <input
                      type="checkbox"
                      checked={!!form.hardwareNeeds.fuelIntegration}
                      onChange={e => setHw('fuelIntegration', e.target.checked)}
                    />
                    <span>Yes, I need this</span>
                  </label>
                </div>
                <div className="vob-hw-row">
                  <span className="vob-hw-label">Scale Integration</span>
                  <label className="vob-hw-toggle">
                    <input
                      type="checkbox"
                      checked={!!form.hardwareNeeds.scaleIntegration}
                      onChange={e => setHw('scaleIntegration', e.target.checked)}
                    />
                    <span>Yes, I need this</span>
                  </label>
                </div>
              </div>
            </div>

            {/* Live order summary — updates as +/- buttons / qty input fire.
                Empty state when nothing selected so the card doesn't clutter
                the screen prematurely. */}
            <div className="vob-cart">
              <div className="vob-cart-head">
                <h4 className="vob-cart-title">Estimated Hardware Total</h4>
                <span className="vob-cart-sub">
                  {cart.lines.length === 0
                    ? 'No equipment selected'
                    : `${cart.lines.length} item${cart.lines.length === 1 ? '' : 's'} · ${cart.totalUnits} unit${cart.totalUnits === 1 ? '' : 's'}`}
                </span>
              </div>

              {cart.lines.length === 0 ? (
                <div className="vob-cart-empty">
                  Use the <Plus size={12} /> buttons above to add equipment to your order.
                </div>
              ) : (
                <>
                  <div className="vob-cart-lines">
                    {cart.lines.map(line => (
                      <div key={line.id} className="vob-cart-line">
                        <span className="vob-cart-line-name">{line.name}</span>
                        <span className="vob-cart-line-qty">
                          ${line.unit.toFixed(2)} × {line.qty}
                        </span>
                        <span className="vob-cart-line-total">${line.lineTotal.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="vob-cart-total-row">
                    <span className="vob-cart-total-label">Estimated Total</span>
                    <span className="vob-cart-total-value">${cart.total.toFixed(2)}</span>
                  </div>
                  <p className="vob-cart-note">
                    This is a non-binding estimate based on current list prices.
                    Final pricing — including bundle discounts, taxes, shipping, and
                    integration fees — is confirmed in your contract.
                  </p>
                </>
              )}
            </div>
          </div>
        )}

        {/* ── Step 4 — Review + Submit ── */}
        {step === 4 && (
          <div>
            <Field label="How did you hear about us?">
              <select className="vob-input" value={form.hearAboutUs} onChange={e => set('hearAboutUs', e.target.value)}>
                <option value="">— select —</option>
                {HEAR_ABOUT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
            {(form.hearAboutUs === 'referral' || form.hearAboutUs === 'partner') && (
              <Field label={form.hearAboutUs === 'referral' ? 'Who referred you?' : 'Which partner?'}>
                <input className="vob-input" value={form.referralSource} onChange={e => set('referralSource', e.target.value)} />
              </Field>
            )}
            <Field label="Anything else we should know?" hint="Optional — special requirements, integrations, timelines">
              <textarea
                className="vob-input vob-textarea"
                rows={4}
                value={form.specialRequirements}
                onChange={e => set('specialRequirements', e.target.value)}
              />
            </Field>

            <div className="vob-summary">
              <div className="vob-summary-title">Quick summary</div>
              <div className="vob-summary-grid">
                <div><strong>Business:</strong> {form.businessLegalName || '—'}</div>
                <div><strong>Industry:</strong> {INDUSTRIES.find(i => i.value === form.industry)?.label || '—'}</div>
                <div><strong>Stores:</strong> {form.numStoresRange || '—'}</div>
                <div><strong>Volume:</strong> {VOLUME_RANGES.find(v => v.value === form.monthlyVolumeRange)?.label || '—'}</div>
                <div><strong>Go-live:</strong> {TIMELINES.find(t => t.value === form.goLiveTimeline)?.label || '—'}</div>
                <div><strong>Plan:</strong> {selectedPlan?.name || '—'}</div>
                <div><strong>Add-ons:</strong> {form.selectedAddonKeys.length > 0 ? form.selectedAddonKeys.length + ' selected' : (form.selectedPlanSlug === 'pro' ? 'all included' : 'none')}</div>
                <div><strong>Est. Monthly:</strong> ${subscriptionTotal.total.toFixed(2)}/mo</div>
              </div>
            </div>

            <label className={`vob-terms ${errors.agreedToTerms ? 'has-error' : ''}`}>
              <input
                type="checkbox"
                checked={form.agreedToTerms}
                onChange={e => set('agreedToTerms', e.target.checked)}
              />
              <span>
                I confirm the information above is accurate. I understand my account will be reviewed by an administrator
                before access to the platform is granted, and that a contract will need to be signed before activation.
              </span>
            </label>
            {errors.agreedToTerms && <p className="vob-field-error vob-terms-error"><AlertCircle size={12}/> {errors.agreedToTerms}</p>}
          </div>
        )}

        {/* ── Footer ── */}
        <div className="vob-footer">
          <button
            type="button"
            className="vob-btn vob-btn-back"
            onClick={handleBack}
            disabled={step === 0 || saving || submitting}
          >
            <ChevronLeft size={16} /> Back
          </button>

          {step < TOTAL_STEPS - 1 ? (
            <button
              type="button"
              className="vob-btn vob-btn-primary"
              onClick={handleNext}
              disabled={saving}
            >
              {saving ? <Loader size={16} className="vob-spinner" /> : <>Continue <ChevronRight size={16} /></>}
            </button>
          ) : (
            <button
              type="button"
              className="vob-btn vob-btn-submit"
              onClick={handleSubmit}
              disabled={submitting}
            >
              {submitting ? <Loader size={16} className="vob-spinner" /> : <>Submit for review <CheckCircle2 size={16} /></>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
