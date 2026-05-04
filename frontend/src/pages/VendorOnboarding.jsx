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
  ShoppingBag, Cpu, MessageSquare, Save, AlertCircle,
} from 'lucide-react';
import { toast } from 'react-toastify';
import StoreveuLogo from '../components/StoreveuLogo';
import {
  getMyVendorOnboarding,
  updateMyVendorOnboarding,
  submitMyVendorOnboarding,
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

const MODULES = [
  { value: 'pos_core',      label: 'Core POS', desc: 'Register, cart, payments, receipts (always included)', required: true },
  { value: 'lottery',       label: 'Lottery', desc: 'Scratch ticket sales, EoD reconciliation, settlement reports' },
  { value: 'fuel',          label: 'Fuel', desc: 'Pump-attributed sales, FIFO tank inventory, BOL deliveries' },
  { value: 'ecommerce',     label: 'eCommerce / Online Storefront', desc: 'Branded online store, customer accounts, online orders' },
  { value: 'marketplace',   label: 'Marketplace Integration', desc: 'DoorDash, UberEats, Instacart sync' },
  { value: 'exchange',      label: 'Storeveu Exchange', desc: 'B2B trading network with other stores' },
  { value: 'loyalty',       label: 'Loyalty / Customer Accounts', desc: 'Points, house accounts, customer profiles' },
  { value: 'scan_data',     label: 'Tobacco Scan Data', desc: 'Altria / RJR / ITG manufacturer reporting + coupon redemption' },
  { value: 'ai_assistant',  label: 'AI Assistant', desc: 'Claude-powered help + AI promo suggestions' },
  { value: 'vendor_orders', label: 'Vendor Orders / Auto-Reorder', desc: '14-factor demand-driven purchase orders' },
  { value: 'invoice_ocr',   label: 'Invoice OCR / Bulk Import', desc: 'AI-extracted vendor invoices, CSV/XLSX import' },
  { value: 'multi_store',   label: 'Multi-Store Dashboard', desc: 'Roll-up reports across multiple locations' },
  { value: 'predictions',   label: 'Sales Predictions', desc: 'Holt-Winters forecasts with weather correlation' },
];

const HARDWARE_ITEMS = [
  { key: 'posTerminal',     label: 'POS Terminal', counted: true },
  { key: 'receiptPrinter',  label: 'Receipt Printer', counted: true },
  { key: 'cashDrawer',      label: 'Cash Drawer', counted: true },
  { key: 'scanner',         label: 'Barcode Scanner', counted: true },
  { key: 'cardTerminal',    label: 'Card Terminal (Dejavoo)', counted: true },
  { key: 'customerDisplay', label: 'Customer Display', counted: true },
  { key: 'labelPrinter',    label: 'Label Printer', counted: true },
  { key: 'fuelIntegration', label: 'Fuel Pump Integration', counted: false },
  { key: 'scaleIntegration', label: 'Scale Integration', counted: false },
];

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
  const [form, setForm] = useState({
    fullName: '', email: '', phone: '',
    businessLegalName: '', dbaName: '',
    businessAddress: '', businessCity: '', businessState: '', businessZip: '',
    businessType: '', ein: '', yearsInBusiness: '',
    industry: '', numStoresRange: '', numStoresExact: '', numRegistersPerStore: '',
    monthlyVolumeRange: '', avgTxPerDay: '', currentPOS: '', goLiveTimeline: '',
    requestedModules: ['pos_core'],
    hardwareNeeds: {},
    hearAboutUs: '', referralSource: '', specialRequirements: '',
    agreedToTerms: false,
  });
  const dirty = useRef(false);

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

  const toggleModule = (value) => {
    if (value === 'pos_core') return; // always required
    dirty.current = true;
    setForm(prev => ({
      ...prev,
      requestedModules: prev.requestedModules.includes(value)
        ? prev.requestedModules.filter(m => m !== value)
        : [...prev.requestedModules, value],
    }));
  };

  // ── Save draft (called on Next) ──
  const saveDraft = async (nextStep = step) => {
    setSaving(true);
    try {
      const payload = { ...form, currentStep: nextStep + 1 };
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
      if (form.requestedModules.length < 1) e.requestedModules = 'Select at least one module';
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
      await submitMyVendorOnboarding({ ...form, currentStep: TOTAL_STEPS });
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

        {/* ── Step 2 — Modules ── */}
        {step === 2 && (
          <div>
            <p className="vob-step-desc">Pick the modules you want enabled for your account. You can change this later.</p>
            {errors.requestedModules && <p className="vob-field-error">{errors.requestedModules}</p>}
            <div className="vob-modules">
              {MODULES.map(m => {
                const checked = form.requestedModules.includes(m.value);
                const disabled = m.required;
                return (
                  <label key={m.value} className={`vob-module ${checked ? 'is-checked' : ''} ${disabled ? 'is-disabled' : ''}`}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => toggleModule(m.value)}
                    />
                    <div>
                      <div className="vob-module-name">{m.label}{m.required && <span className="vob-req-pill">REQUIRED</span>}</div>
                      <div className="vob-module-desc">{m.desc}</div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Step 3 — Hardware ── */}
        {step === 3 && (
          <div>
            <p className="vob-step-desc">How many of each item do you need? Leave 0 if you already have your own. We'll quote pricing in your contract.</p>
            <div className="vob-hardware">
              {HARDWARE_ITEMS.map(item => (
                <div key={item.key} className="vob-hw-row">
                  <span className="vob-hw-label">{item.label}</span>
                  {item.counted ? (
                    <input
                      type="number"
                      min={0}
                      max={999}
                      value={form.hardwareNeeds[item.key] ?? ''}
                      onChange={e => setHw(item.key, e.target.value === '' ? null : Math.max(0, Number(e.target.value)))}
                      className="vob-input vob-hw-input"
                    />
                  ) : (
                    <label className="vob-hw-toggle">
                      <input
                        type="checkbox"
                        checked={!!form.hardwareNeeds[item.key]}
                        onChange={e => setHw(item.key, e.target.checked)}
                      />
                      <span>Yes, I need this</span>
                    </label>
                  )}
                </div>
              ))}
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
                <div><strong>Modules:</strong> {form.requestedModules.length} selected</div>
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
