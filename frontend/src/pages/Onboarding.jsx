import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building2, Store, CheckCircle2, ChevronRight,
  ChevronLeft, Loader, Globe, MapPin,
} from 'lucide-react';
import { createTenant, createStore } from '../services/api';
import { toast } from 'react-toastify';
import StoreveuLogo from '../components/StoreveuLogo';
import './Onboarding.css';

const TIMEZONES = [
  { label: 'Eastern  (ET)',  value: 'America/New_York'   },
  { label: 'Central  (CT)',  value: 'America/Chicago'    },
  { label: 'Mountain (MT)',  value: 'America/Denver'     },
  { label: 'Pacific  (PT)',  value: 'America/Los_Angeles'},
  { label: 'Arizona  (AZ)',  value: 'America/Phoenix'    },
  { label: 'Alaska   (AK)',  value: 'America/Anchorage'  },
  { label: 'Hawaii   (HI)',  value: 'Pacific/Honolulu'   },
];

const toSlug = (str) =>
  str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const validateEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email?.trim());

/* ── Step indicator ─────────────────────────────────────────────────────── */
function StepDots({ current, total }) {
  return (
    <div className="ob-step-dots">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={`ob-dot ${i === current ? 'ob-dot--active' : i < current ? 'ob-dot--done' : 'ob-dot--pending'}`}
        />
      ))}
    </div>
  );
}

/* ── Field component ────────────────────────────────────────────────────── */
function Field({ label, hint, children }) {
  return (
    <div className="form-group">
      <label className="form-label ob-field-label">
        {label}
        {hint && <span className="ob-field-hint">{hint}</span>}
      </label>
      {children}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════ */
export default function Onboarding() {
  const navigate = useNavigate();
  const [step,    setStep]    = useState(0);
  const [loading, setLoading] = useState(false);
  const [errors,  setErrors]  = useState({});

  // Step 0 — org
  const [orgName,   setOrgName]   = useState('');
  const [slug,      setSlug]      = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [billing,   setBilling]   = useState('');

  // Step 1 — store
  const [storeName, setStoreName] = useState('');
  const [address,   setAddress]   = useState('');
  const [timezone,  setTimezone]  = useState('America/New_York');

  // Slugs auto-follow org name until user manually edits it
  useEffect(() => {
    if (!slugEdited) setSlug(toSlug(orgName));
  }, [orgName, slugEdited]);

  // Skip onboarding if user already has a tenant
  useEffect(() => {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (user?.tenantId) navigate('/portal/realtime', { replace: true });
  }, [navigate]);

  /* ── Step 0 submit — create tenant ─────────────────────────────────────── */
  const handleOrgNext = async (e) => {
    e.preventDefault();
    if (!orgName.trim()) return;
    if (billing && !validateEmail(billing)) {
      setErrors(prev => ({ ...prev, billing: 'Please enter a valid email address' }));
      return;
    }
    setErrors(prev => ({ ...prev, billing: '' }));
    setLoading(true);
    try {
      const tenant = await createTenant({
        name:         orgName.trim(),
        slug:         slug || toSlug(orgName),
        billingEmail: billing.trim() || undefined,
      });

      const user = JSON.parse(localStorage.getItem('user') || '{}');
      localStorage.setItem('user', JSON.stringify({ ...user, tenantId: tenant._id }));

      setStep(1);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not create organisation.');
    } finally {
      setLoading(false);
    }
  };

  /* ── Step 1 submit — create first store ──────────────────────────────── */
  const handleStoreNext = async (e) => {
    e.preventDefault();
    if (!storeName.trim()) return;
    setLoading(true);
    try {
      await createStore({
        name:     storeName.trim(),
        address:  address.trim() || null,
        timezone,
      });
      setStep(2);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not create store.');
    } finally {
      setLoading(false);
    }
  };

  /* ── Step 2 — finish ──────────────────────────────────────────────────── */
  const handleFinish = () => {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (user.status === 'pending') {
      localStorage.removeItem('user');
      toast.info('Your account is under review. You will be notified when approved.');
      navigate('/login', { replace: true });
    } else {
      navigate('/portal/realtime', { replace: true });
    }
  };

  /* ── Shared card wrapper ─────────────────────────────────────────────── */
  const card = (content) => (
    <div className="ob-page">
      <div className="glass-card animate-fade-in ob-card">
        <div className="ob-card-header">
          <div className="ob-logo-row"><StoreveuLogo height={40} darkMode={true} /></div>
        </div>
        <StepDots current={step} total={3} />
        {content}
      </div>
    </div>
  );

  /* ── Step 0: Organisation ─────────────────────────────────────────────── */
  if (step === 0) return card(
    <form onSubmit={handleOrgNext}>
      <div className="ob-step-row">
        <div className="ob-step-icon ob-step-icon--brand">
          <Building2 size={20} color="var(--accent-primary)" />
        </div>
        <div>
          <h2 className="ob-step-title">Name your organisation</h2>
          <p className="ob-step-label">Step 1 of 3</p>
        </div>
      </div>

      <p className="ob-step-desc">
        This is your brand or company name — the top-level account all your stores will belong to.
      </p>

      <Field label="Organisation name" hint="required">
        <input
          className="form-input"
          placeholder="e.g. My Store Inc."
          value={orgName}
          onChange={(e) => setOrgName(e.target.value)}
          required
          autoFocus
        />
      </Field>

      <Field label="URL identifier">
        <div className="ob-input-wrap">
          <span className="ob-input-prefix">app/</span>
          <input
            className="form-input ob-input-prefix-pad"
            placeholder="my-store"
            value={slug}
            onChange={(e) => { setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')); setSlugEdited(true); }}
          />
        </div>
        {slug && (
          <p className="ob-slug-preview">
            <Globe size={10} className="ob-btn-icon--left ob-icon-valign" />
            app/{slug}
          </p>
        )}
      </Field>

      <Field label="Billing email" hint="optional">
        <input
          type="email"
          className={`form-input ${errors.billing ? 'ob-input--error' : ''}`}
          placeholder="billing@yourcompany.com"
          value={billing}
          onChange={(e) => setBilling(e.target.value)}
          onBlur={() => {
            if (billing && !validateEmail(billing)) {
              setErrors(prev => ({ ...prev, billing: 'Please enter a valid email address' }));
            } else {
              setErrors(prev => ({ ...prev, billing: '' }));
            }
          }}
        />
        {errors.billing && <p className="ob-field-error">{errors.billing}</p>}
      </Field>

      <button
        type="submit"
        className="btn btn-primary ob-submit"
        disabled={loading || !orgName.trim()}
      >
        {loading
          ? <Loader size={18} className="animate-spin" />
          : <><span>Continue</span><ChevronRight size={16} className="ob-btn-icon" /></>}
      </button>
    </form>
  );

  /* ── Step 1: First store ──────────────────────────────────────────────── */
  if (step === 1) return card(
    <form onSubmit={handleStoreNext}>
      <div className="ob-step-row">
        <div className="ob-step-icon ob-step-icon--blue">
          <Store size={20} color="#3b82f6" />
        </div>
        <div>
          <h2 className="ob-step-title">Set up your first store</h2>
          <p className="ob-step-label">Step 2 of 3</p>
        </div>
      </div>

      <p className="ob-step-desc">
        You can add more store locations later from the Stores page.
      </p>

      <Field label="Store name" hint="required">
        <input
          className="form-input"
          placeholder="e.g. Downtown Location"
          value={storeName}
          onChange={(e) => setStoreName(e.target.value)}
          required
          autoFocus
        />
      </Field>

      <Field label="Address" hint="optional">
        <div className="ob-input-wrap">
          <MapPin size={16} className="ob-input-icon" />
          <input
            className="form-input ob-input-icon-pad"
            placeholder="123 Main St, City, State"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
        </div>
      </Field>

      <Field label="Timezone">
        <select
          className="form-input ob-cursor-pointer"
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
        >
          {TIMEZONES.map((tz) => (
            <option key={tz.value} value={tz.value}>{tz.label}</option>
          ))}
        </select>
      </Field>

      <div className="ob-btn-row">
        <button
          type="button"
          className="btn ob-btn-back"
          onClick={() => setStep(0)}
          disabled={loading}
        >
          <ChevronLeft size={16} className="ob-btn-icon--left" />Back
        </button>
        <button
          type="submit"
          className="btn btn-primary ob-btn-next"
          disabled={loading || !storeName.trim()}
        >
          {loading
            ? <Loader size={18} className="animate-spin" />
            : <><span>Create Store</span><ChevronRight size={16} className="ob-btn-icon" /></>}
        </button>
      </div>
    </form>
  );

  /* ── Step 2: Done ─────────────────────────────────────────────────────── */
  return card(
    <div className="ob-done">
      <div className="ob-done-icon">
        <CheckCircle2 size={38} color="var(--accent-primary)" />
      </div>

      <h2 className="ob-done-title">You're all set!</h2>
      <p className="ob-done-msg">
        <strong className="ob-done-highlight">{orgName}</strong> is ready.
        Your first store <strong className="ob-done-highlight">{storeName}</strong> has been created.
      </p>

      <div className="ob-next-steps">
        {[
          ['Invite your team', '/portal/users'],
          ['Add more stores', '/portal/stores'],
          ['Go to Live Dashboard', '/portal/realtime'],
        ].map(([label, path]) => (
          <div key={path} className="ob-next-step-row">
            <span className="ob-next-step-label">{label}</span>
            <button
              onClick={() => navigate(path)}
              className="ob-next-step-btn"
            >
              Go →
            </button>
          </div>
        ))}
      </div>

      <button
        className="btn btn-primary ob-finish-btn"
        onClick={handleFinish}
      >
        Go to Dashboard
      </button>
    </div>
  );
}
