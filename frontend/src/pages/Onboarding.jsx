import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building2, Store, CheckCircle2, ChevronRight,
  ChevronLeft, Loader, Globe, MapPin,
} from 'lucide-react';
import { createTenant, createStore } from '../services/api';
import { toast } from 'react-toastify';
import logoImg from '../assets/future-foods-logo.jpg';

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

/* ── Step indicator ─────────────────────────────────────────────────────── */
function StepDots({ current, total }) {
  return (
    <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', marginBottom: '2rem' }}>
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          style={{
            width: i === current ? '24px' : '8px',
            height: '8px',
            borderRadius: '4px',
            background: i === current
              ? 'var(--accent-primary)'
              : i < current
                ? 'rgba(122,193,67,0.4)'
                : 'var(--border-color)',
            transition: 'all 0.3s ease',
          }}
        />
      ))}
    </div>
  );
}

/* ── Field component ────────────────────────────────────────────────────── */
function Field({ label, hint, children }) {
  return (
    <div className="form-group">
      <label className="form-label" style={{ display: 'block', marginBottom: '0.35rem' }}>
        {label}
        {hint && <span style={{ color: 'var(--text-muted)', fontWeight: 400, marginLeft: '0.4rem', fontSize: '0.75rem' }}>{hint}</span>}
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
    if (user?.tenantId) navigate('/portal/pos-api', { replace: true });
  }, [navigate]);

  /* ── Step 0 submit — create tenant ─────────────────────────────────────── */
  const handleOrgNext = async (e) => {
    e.preventDefault();
    if (!orgName.trim()) return;
    setLoading(true);
    try {
      const tenant = await createTenant({
        name:         orgName.trim(),
        slug:         slug || toSlug(orgName),
        billingEmail: billing.trim() || undefined,
      });

      // Update stored user with tenantId
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
  const handleFinish = () => navigate('/portal/pos-api', { replace: true });

  /* ── Shared card wrapper ─────────────────────────────────────────────── */
  const card = (content) => (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'radial-gradient(circle at top right, #7ac14310, transparent), radial-gradient(circle at bottom left, #e3061310, transparent)',
      padding: '2rem 1rem',
    }}>
      <div className="glass-card animate-fade-in" style={{
        width: '100%',
        maxWidth: '480px',
        padding: '2.5rem',
        background: '#ffffff',
        boxShadow: '0 10px 30px rgba(0,0,0,0.1)',
      }}>
        <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
          <img src={logoImg} alt="Logo" style={{ maxHeight: '56px', width: 'auto', marginBottom: '1rem' }} />
        </div>
        <StepDots current={step} total={3} />
        {content}
      </div>
    </div>
  );

  /* ── Step 0: Organisation ─────────────────────────────────────────────── */
  if (step === 0) return card(
    <form onSubmit={handleOrgNext}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
        <div style={{
          width: 40, height: 40, borderRadius: '10px',
          background: 'rgba(122,193,67,0.12)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Building2 size={20} color="var(--accent-primary)" />
        </div>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--text-primary)' }}>
            Name your organisation
          </h2>
          <p style={{ margin: 0, fontSize: '0.825rem', color: 'var(--text-muted)' }}>Step 1 of 3</p>
        </div>
      </div>

      <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', margin: '1rem 0 1.5rem' }}>
        This is your brand or company name — the top-level account all your stores will belong to.
      </p>

      <Field label="Organisation name" hint="required">
        <input
          className="form-input"
          placeholder="e.g. Future Foods Inc."
          value={orgName}
          onChange={(e) => setOrgName(e.target.value)}
          required
          autoFocus
        />
      </Field>

      <Field label="URL identifier">
        <div style={{ position: 'relative' }}>
          <span style={{
            position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)',
            color: 'var(--text-muted)', fontSize: '0.8rem', pointerEvents: 'none',
          }}>
            app/
          </span>
          <input
            className="form-input"
            style={{ paddingLeft: '2.75rem' }}
            placeholder="future-foods"
            value={slug}
            onChange={(e) => { setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')); setSlugEdited(true); }}
          />
        </div>
        {slug && (
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.4rem 0 0' }}>
            <Globe size={10} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
            app/{slug}
          </p>
        )}
      </Field>

      <Field label="Billing email" hint="optional">
        <input
          type="email"
          className="form-input"
          placeholder="billing@yourcompany.com"
          value={billing}
          onChange={(e) => setBilling(e.target.value)}
        />
      </Field>

      <button
        type="submit"
        className="btn btn-primary"
        style={{ width: '100%', padding: '0.875rem', marginTop: '0.5rem' }}
        disabled={loading || !orgName.trim()}
      >
        {loading
          ? <Loader size={18} className="animate-spin" />
          : <><span>Continue</span><ChevronRight size={16} style={{ marginLeft: '0.4rem' }} /></>}
      </button>
    </form>
  );

  /* ── Step 1: First store ──────────────────────────────────────────────── */
  if (step === 1) return card(
    <form onSubmit={handleStoreNext}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
        <div style={{
          width: 40, height: 40, borderRadius: '10px',
          background: 'rgba(59,130,246,0.12)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Store size={20} color="#3b82f6" />
        </div>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--text-primary)' }}>
            Set up your first store
          </h2>
          <p style={{ margin: 0, fontSize: '0.825rem', color: 'var(--text-muted)' }}>Step 2 of 3</p>
        </div>
      </div>

      <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', margin: '1rem 0 1.5rem' }}>
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
        <div style={{ position: 'relative' }}>
          <MapPin size={16} style={{
            position: 'absolute', left: '0.875rem', top: '50%', transform: 'translateY(-50%)',
            color: 'var(--text-muted)',
          }} />
          <input
            className="form-input"
            style={{ paddingLeft: '2.5rem' }}
            placeholder="123 Main St, City, State"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
        </div>
      </Field>

      <Field label="Timezone">
        <select
          className="form-input"
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          style={{ cursor: 'pointer' }}
        >
          {TIMEZONES.map((tz) => (
            <option key={tz.value} value={tz.value}>{tz.label}</option>
          ))}
        </select>
      </Field>

      <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
        <button
          type="button"
          className="btn"
          style={{ flex: 1, padding: '0.875rem', background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}
          onClick={() => setStep(0)}
          disabled={loading}
        >
          <ChevronLeft size={16} style={{ marginRight: '0.4rem' }} />Back
        </button>
        <button
          type="submit"
          className="btn btn-primary"
          style={{ flex: 2, padding: '0.875rem' }}
          disabled={loading || !storeName.trim()}
        >
          {loading
            ? <Loader size={18} className="animate-spin" />
            : <><span>Create Store</span><ChevronRight size={16} style={{ marginLeft: '0.4rem' }} /></>}
        </button>
      </div>
    </form>
  );

  /* ── Step 2: Done ─────────────────────────────────────────────────────── */
  return card(
    <div style={{ textAlign: 'center' }}>
      <div style={{
        width: 72, height: 72, borderRadius: '50%',
        background: 'rgba(122,193,67,0.12)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        margin: '0 auto 1.5rem',
      }}>
        <CheckCircle2 size={38} color="var(--accent-primary)" />
      </div>

      <h2 style={{ fontSize: '1.5rem', color: 'var(--text-primary)', marginBottom: '0.5rem' }}>
        You're all set!
      </h2>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem', fontSize: '0.9rem' }}>
        <strong style={{ color: 'var(--text-primary)' }}>{orgName}</strong> is ready.
        Your first store <strong style={{ color: 'var(--text-primary)' }}>{storeName}</strong> has been created.
      </p>

      <div style={{
        background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)',
        padding: '1rem', marginBottom: '2rem', textAlign: 'left',
      }}>
        {[
          ['Invite your team', '/portal/users'],
          ['Add more stores', '/portal/stores'],
          ['Connect your POS', '/portal/pos-api'],
        ].map(([label, path]) => (
          <div key={path} style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '0.5rem 0',
            borderBottom: '1px solid var(--border-color)',
          }}>
            <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>{label}</span>
            <button
              onClick={() => navigate(path)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--accent-primary)', fontSize: '0.8rem', fontWeight: 600,
              }}
            >
              Go →
            </button>
          </div>
        ))}
      </div>

      <button
        className="btn btn-primary"
        style={{ width: '100%', padding: '0.875rem' }}
        onClick={handleFinish}
      >
        Go to Dashboard
      </button>
    </div>
  );
}
