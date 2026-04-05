import React, { useState, useEffect, useCallback } from 'react';
import Sidebar from '../components/Sidebar';
import './analytics.css';
import {
  Building2, Save, Loader, AlertCircle, RefreshCw,
  Receipt, CreditCard, Globe, Clock, DollarSign, Gift,
  CheckCircle2, Store, Layers, Zap, X, ArrowRight,
  Users, ShieldCheck, TrendingUp, Phone,
} from 'lucide-react';
import { getMyTenant, updateMyTenant, getStoreBillingSummary, updateTenantPlan } from '../services/api';
import { toast } from 'react-toastify';

/* ── Plan definitions ────────────────────────────────────────────────────── */
const PLANS = [
  {
    value:    'trial',
    label:    'Trial',
    price:    'Free',
    subPrice: '14-day trial',
    color:    '#f59e0b',
    bg:       'rgba(245,158,11,0.12)',
    maxStores: 1,
    maxUsers:  3,
    features: [
      '1 store location',
      'Up to 3 users',
      'POS integration',
      'Basic analytics',
      'Email support',
    ],
  },
  {
    value:    'basic',
    label:    'Basic',
    price:    '$49',
    subPrice: 'per month',
    color:    '#3b82f6',
    bg:       'rgba(59,130,246,0.12)',
    maxStores: 3,
    maxUsers:  10,
    features: [
      'Up to 3 store locations',
      'Up to 10 users',
      'POS + eComm integration',
      'Full analytics suite',
      'Invoice import',
      'Priority email support',
    ],
  },
  {
    value:    'pro',
    label:    'Pro',
    price:    '$149',
    subPrice: 'per month',
    color:    '#8b5cf6',
    bg:       'rgba(139,92,246,0.12)',
    popular:  true,
    maxStores: 25,
    maxUsers:  100,
    features: [
      'Up to 25 store locations',
      'Up to 100 users',
      'All Basic features',
      'Sales predictions (AI)',
      'Multi-store reporting',
      'API access',
      'Phone & chat support',
    ],
  },
  {
    value:    'enterprise',
    label:    'Enterprise',
    price:    'Custom',
    subPrice: 'contact us',
    color:    'var(--accent-primary)',
    bg:       'var(--brand-12)',
    maxStores: '∞',
    maxUsers:  '∞',
    features: [
      'Unlimited store locations',
      'Unlimited users',
      'All Pro features',
      'Dedicated account manager',
      'Custom integrations',
      'SLA guarantee',
      'On-site onboarding',
    ],
  },
];

const PLAN_COLORS = Object.fromEntries(
  PLANS.map(p => [p.value, { bg: p.bg, color: p.color, label: p.label }])
);

/* ── Plan Change Modal ───────────────────────────────────────────────────── */
function PlanModal({ currentPlan, onClose, onChanged }) {
  const [selected,  setSelected]  = useState(currentPlan);
  const [loading,   setLoading]   = useState(false);

  const current = PLANS.find(p => p.value === currentPlan);
  const chosen  = PLANS.find(p => p.value === selected);

  const isDowngrade = PLANS.findIndex(p => p.value === selected) <
                      PLANS.findIndex(p => p.value === currentPlan);

  const handleConfirm = async () => {
    if (selected === currentPlan) { onClose(); return; }
    if (selected === 'enterprise') {
      toast.info('Please contact us at sales@storeveu.com to set up an Enterprise plan.');
      onClose();
      return;
    }
    setLoading(true);
    try {
      const updated = await updateTenantPlan(selected);
      toast.success(`Plan changed to ${chosen.label}.`);
      onChanged(updated);
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not change plan.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '1rem',
    }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: 'var(--bg-secondary)',
        borderRadius: 'var(--radius-lg)',
        padding: '2rem',
        width: '100%', maxWidth: '860px',
        boxShadow: 'var(--shadow-lg)',
        maxHeight: '92vh', overflowY: 'auto',
        animation: 'fadeIn 0.2s ease',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.75rem' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Zap size={20} style={{ color: 'var(--accent-primary)' }} />
              Change plan
            </h2>
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.875rem', color: 'var(--text-muted)' }}>
              Currently on <strong style={{ color: current?.color }}>{current?.label}</strong>. Select a new plan below.
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.25rem' }}>
            <X size={22} />
          </button>
        </div>

        {/* Plan cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.75rem' }}>
          {PLANS.map(plan => {
            const isSelected = selected === plan.value;
            const isCurrent  = currentPlan === plan.value;
            return (
              <div
                key={plan.value}
                onClick={() => setSelected(plan.value)}
                style={{
                  position: 'relative',
                  border: `2px solid ${isSelected ? plan.color : 'var(--border-color)'}`,
                  borderRadius: 'var(--radius-lg)',
                  padding: '1.25rem',
                  cursor: 'pointer',
                  background: isSelected ? plan.bg : 'var(--bg-tertiary)',
                  transition: 'all 0.15s',
                  boxShadow: isSelected ? `0 0 0 3px ${plan.color}22` : 'none',
                }}
              >
                {/* Popular badge */}
                {plan.popular && (
                  <div style={{
                    position: 'absolute', top: '-11px', left: '50%', transform: 'translateX(-50%)',
                    background: plan.color, color: '#fff',
                    fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
                    padding: '0.2rem 0.65rem', borderRadius: '9999px', whiteSpace: 'nowrap',
                  }}>
                    Most popular
                  </div>
                )}

                {/* Current indicator */}
                {isCurrent && (
                  <div style={{
                    position: 'absolute', top: 10, right: 10,
                    background: plan.color, color: '#fff',
                    fontSize: '0.6rem', fontWeight: 700,
                    padding: '0.1rem 0.45rem', borderRadius: '9999px',
                  }}>Current</div>
                )}

                {/* Plan name */}
                <div style={{ fontSize: '1rem', fontWeight: 700, color: isSelected ? plan.color : 'var(--text-primary)', marginBottom: '0.25rem' }}>
                  {plan.label}
                </div>

                {/* Price */}
                <div style={{ marginBottom: '1rem' }}>
                  <span style={{ fontSize: '1.6rem', fontWeight: 800, color: isSelected ? plan.color : 'var(--text-primary)', fontFamily: 'Outfit, sans-serif' }}>
                    {plan.price}
                  </span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '0.25rem' }}>
                    {plan.subPrice}
                  </span>
                </div>

                {/* Limits */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', marginBottom: '1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                    <Store size={12} style={{ color: plan.color }} />
                    {plan.maxStores === '∞' ? 'Unlimited stores' : `${plan.maxStores} store${plan.maxStores !== 1 ? 's' : ''}`}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                    <Users size={12} style={{ color: plan.color }} />
                    {plan.maxUsers === '∞' ? 'Unlimited users' : `${plan.maxUsers} user${plan.maxUsers !== 1 ? 's' : ''}`}
                  </div>
                </div>

                {/* Feature list */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                  {plan.features.map(f => (
                    <div key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.4rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      <CheckCircle2 size={12} style={{ color: plan.color, flexShrink: 0, marginTop: '1px' }} />
                      {f}
                    </div>
                  ))}
                </div>

                {/* Selected check */}
                {isSelected && (
                  <div style={{
                    position: 'absolute', bottom: 10, right: 10,
                    width: 22, height: 22, borderRadius: '50%',
                    background: plan.color,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <CheckCircle2 size={13} color="#fff" />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Downgrade warning */}
        {isDowngrade && selected !== currentPlan && (
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: '0.6rem',
            padding: '0.875rem 1rem', marginBottom: '1.25rem',
            background: 'var(--error-bg)', border: '1px solid var(--error)',
            borderRadius: 'var(--radius-md)',
          }}>
            <AlertCircle size={16} style={{ color: 'var(--error)', flexShrink: 0, marginTop: '1px' }} />
            <div style={{ fontSize: '0.825rem', color: 'var(--error)' }}>
              <strong>Downgrading to {chosen?.label}</strong> — if you have more stores or users than the plan allows, the change will be blocked. Deactivate extra stores or remove users first.
            </div>
          </div>
        )}

        {/* Enterprise contact note */}
        {selected === 'enterprise' && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '0.6rem',
            padding: '0.875rem 1rem', marginBottom: '1.25rem',
            background: 'var(--brand-05)', border: '1px solid var(--brand-30)',
            borderRadius: 'var(--radius-md)',
          }}>
            <Phone size={16} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
            <div style={{ fontSize: '0.825rem', color: 'var(--text-secondary)' }}>
              Enterprise plans are set up with our team. Clicking confirm will direct you to contact sales.
            </div>
          </div>
        )}

        {/* Action row */}
        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '0.75rem 1.5rem', background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontWeight: 500 }}>
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading || selected === currentPlan}
            className="btn btn-primary"
            style={{ padding: '0.75rem 1.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem', opacity: selected === currentPlan ? 0.5 : 1 }}
          >
            {loading
              ? <><Loader size={15} className="animate-spin" />Changing…</>
              : selected === 'enterprise'
                ? <><Phone size={15} />Contact sales</>
                : <><ArrowRight size={15} />Confirm {chosen?.label} plan</>
            }
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Validation helpers ──────────────────────────────────────────────────── */
const validateEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email?.trim());

/* ── Shared helpers ───────────────────────────────────────────────────────── */
const TIMEZONES = [
  { label: 'Eastern  (ET)',  value: 'America/New_York'    },
  { label: 'Central  (CT)',  value: 'America/Chicago'     },
  { label: 'Mountain (MT)',  value: 'America/Denver'      },
  { label: 'Pacific  (PT)',  value: 'America/Los_Angeles' },
  { label: 'Arizona  (AZ)',  value: 'America/Phoenix'     },
  { label: 'Alaska   (AK)',  value: 'America/Anchorage'   },
  { label: 'Hawaii   (HI)',  value: 'Pacific/Honolulu'    },
];

function SectionCard({ icon, title, action, children }) {
  return (
    <div className="analytics-chart-card" style={{ marginBottom: '1.5rem' }}>
      <div className="analytics-chart-title" style={{ marginBottom: '1.5rem' }}>
        {icon}
        {title}
        {action && <div style={{ marginLeft: 'auto' }}>{action}</div>}
      </div>
      {children}
    </div>
  );
}

function Toggle({ checked, onChange, label }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', padding: '0.75rem 0', borderBottom: '1px solid var(--border-color)' }}>
      <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>{label}</span>
      <div
        onClick={() => onChange(!checked)}
        style={{
          width: 40, height: 22, borderRadius: 11,
          background: checked ? 'var(--accent-primary)' : 'var(--border-color)',
          position: 'relative', transition: 'background 0.2s',
          flexShrink: 0,
        }}
      >
        <div style={{
          position: 'absolute',
          top: 3, left: checked ? 21 : 3,
          width: 16, height: 16, borderRadius: '50%',
          background: '#fff',
          transition: 'left 0.2s',
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        }} />
      </div>
    </label>
  );
}

function BillingRow({ store, isLast }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr auto auto auto',
      gap: '1rem',
      alignItems: 'center',
      padding: '0.75rem 0',
      borderBottom: isLast ? 'none' : '1px solid var(--border-color)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <Store size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        <span style={{ fontSize: '0.875rem', color: 'var(--text-primary)', fontWeight: 500 }}>{store.name}</span>
      </div>
      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'right', whiteSpace: 'nowrap' }}>
        {store.stationCount} station{store.stationCount !== 1 ? 's' : ''}
      </span>
      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'right', whiteSpace: 'nowrap' }}>
        ${store.monthlyRatePerStation}/mo each
      </span>
      <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--accent-primary)', textAlign: 'right', whiteSpace: 'nowrap' }}>
        ${store.monthlyTotal.toFixed(2)}/mo
      </span>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════ */
export default function Organisation() {
  const [tenant,    setTenant]    = useState(null);
  const [billing,   setBilling]   = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState(null);
  const [showPlan,  setShowPlan]  = useState(false);
  const [formErrors, setFormErrors] = useState({});

  // Editable fields
  const [name,           setName]           = useState('');
  const [billingEmail,   setBillingEmail]   = useState('');
  const [timezone,       setTimezone]       = useState('America/New_York');
  const [currency,       setCurrency]       = useState('USD');
  const [receiptFooter,  setReceiptFooter]  = useState('');
  const [loyaltyEnabled, setLoyaltyEnabled] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [t, b] = await Promise.all([
        getMyTenant(),
        getStoreBillingSummary().catch(() => null),
      ]);
      setTenant(t);
      setBilling(b);
      setName(t.name || '');
      setBillingEmail(t.billingEmail || '');
      setTimezone(t.settings?.timezone || 'America/New_York');
      setCurrency(t.settings?.currency || 'USD');
      setReceiptFooter(t.settings?.receiptFooter || '');
      setLoyaltyEnabled(t.settings?.loyaltyEnabled || false);
    } catch (e) {
      setError(e.response?.data?.error || 'Could not load organisation.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (billingEmail && !validateEmail(billingEmail)) {
      setFormErrors(prev => ({ ...prev, billingEmail: 'Please enter a valid email address' }));
      return;
    }
    setFormErrors(prev => ({ ...prev, billingEmail: '' }));
    setSaving(true);
    try {
      const updated = await updateMyTenant({
        name,
        billingEmail,
        settings: { timezone, currency, receiptFooter, loyaltyEnabled },
      });
      setTenant(updated);
      toast.success('Organisation settings saved.');
    } catch (e) {
      toast.error(e.response?.data?.error || 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  /* ── Plan info ──────────────────────────────────────────────────────────── */
  const plan      = tenant?.plan || 'trial';
  const planMeta  = PLANS.find(p => p.value === plan) || PLANS[0];
  const planStyle = PLAN_COLORS[plan] || PLAN_COLORS.trial;

  const trialDaysLeft = tenant?.trialEndsAt
    ? Math.max(0, Math.ceil((new Date(tenant.trialEndsAt) - Date.now()) / 86_400_000))
    : null;

  const nextPlan = PLANS[PLANS.findIndex(p => p.value === plan) + 1] || null;

  return (
    <div className="layout-container">
      <Sidebar />
      <main className="main-content animate-fade-in">

        {/* Header */}
        <div className="analytics-header">
          <div>
            <h1 className="analytics-title" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <Building2 size={26} style={{ color: 'var(--accent-primary)' }} />
              Organisation
            </h1>
            <p className="analytics-subtitle">Manage your organisation settings and billing</p>
          </div>
          <button className="filter-btn" onClick={load} disabled={loading}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <RefreshCw size={14} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
            Refresh
          </button>
        </div>

        {error && (
          <div className="analytics-error" style={{ marginBottom: '1.5rem' }}>
            <AlertCircle size={16} /><span>{error}</span>
          </div>
        )}

        {loading && !tenant ? (
          <div className="analytics-loading">
            <div className="analytics-loading-spinner" />
            <span>Loading organisation…</span>
          </div>
        ) : tenant ? (
          <>
            {/* ── Trial banner ──────────────────────────────────────────── */}
            {plan === 'trial' && trialDaysLeft !== null && (
              <div className="weather-setup-banner" style={{
                marginBottom: '1.5rem',
                borderColor: trialDaysLeft <= 3 ? 'var(--error)' : 'rgba(245,158,11,0.4)',
                background:  trialDaysLeft <= 3 ? 'var(--error-bg)' : 'rgba(245,158,11,0.06)',
              }}>
                <CreditCard size={15} style={{ color: trialDaysLeft <= 3 ? 'var(--error)' : '#f59e0b' }} />
                <span style={{ color: trialDaysLeft <= 3 ? 'var(--error)' : '#f59e0b' }}>
                  {trialDaysLeft > 0
                    ? <><strong>{trialDaysLeft} day{trialDaysLeft !== 1 ? 's' : ''}</strong> remaining on your free trial.</>
                    : <><strong>Trial expired.</strong> Upgrade to continue using all features.</>}
                </span>
                <button className="btn btn-primary" onClick={() => setShowPlan(true)}
                  style={{ padding: '0.35rem 0.9rem', fontSize: '0.8rem', marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <ArrowRight size={13} />Upgrade now
                </button>
              </div>
            )}

            {/* ── Plan & subscription ───────────────────────────────────── */}
            <SectionCard
              icon={<Zap size={16} style={{ color: planStyle.color }} />}
              title="Plan & Subscription"
              action={
                <button
                  onClick={() => setShowPlan(true)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.4rem',
                    padding: '0.4rem 0.9rem', fontSize: '0.8rem', fontWeight: 600,
                    background: planStyle.bg, color: planStyle.color,
                    border: `1px solid ${planStyle.color}40`,
                    borderRadius: 'var(--radius-md)', cursor: 'pointer',
                    transition: 'opacity 0.15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.opacity = '0.8'}
                  onMouseLeave={e => e.currentTarget.style.opacity = '1'}
                >
                  <ArrowRight size={13} />Change plan
                </button>
              }
            >
              {/* Current plan hero row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
                <div style={{
                  padding: '0.5rem 1.25rem', borderRadius: '9999px', fontSize: '1rem', fontWeight: 800,
                  background: planStyle.bg, color: planStyle.color,
                  border: `1.5px solid ${planStyle.color}40`,
                  fontFamily: 'Outfit, sans-serif',
                }}>
                  {planMeta.label}
                </div>
                <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Price</div>
                    <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                      {planMeta.price}<span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 400 }}> {planMeta.subPrice}</span>
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Store limit</div>
                    <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                      {tenant.maxStores >= 9999 ? '∞' : tenant.maxStores}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>User limit</div>
                    <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                      {tenant.maxUsers >= 9999 ? '∞' : tenant.maxUsers}
                    </div>
                  </div>
                  {plan === 'trial' && trialDaysLeft !== null && (
                    <div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Trial ends</div>
                      <div style={{ fontSize: '1rem', fontWeight: 700, color: trialDaysLeft <= 3 ? 'var(--error)' : 'var(--text-primary)' }}>
                        {trialDaysLeft} day{trialDaysLeft !== 1 ? 's' : ''}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Features included */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: nextPlan ? '1.25rem' : 0 }}>
                {planMeta.features.map(f => (
                  <span key={f} style={{
                    display: 'flex', alignItems: 'center', gap: '0.3rem',
                    fontSize: '0.75rem', color: planStyle.color, fontWeight: 600,
                    background: planStyle.bg, padding: '0.2rem 0.65rem', borderRadius: '9999px',
                  }}>
                    <CheckCircle2 size={11} />{f}
                  </span>
                ))}
              </div>

              {/* Upgrade nudge (only if not enterprise) */}
              {nextPlan && (
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '0.75rem 1rem', marginTop: '0.5rem',
                  background: `${nextPlan.color}08`,
                  border: `1px solid ${nextPlan.color}25`,
                  borderRadius: 'var(--radius-md)',
                  flexWrap: 'wrap', gap: '0.75rem',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <TrendingUp size={16} style={{ color: nextPlan.color }} />
                    <div>
                      <span style={{ fontSize: '0.825rem', fontWeight: 600, color: nextPlan.color }}>Upgrade to {nextPlan.label}</span>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>
                        — {nextPlan.maxStores === '∞' ? 'unlimited' : nextPlan.maxStores} stores · {nextPlan.maxUsers === '∞' ? 'unlimited' : nextPlan.maxUsers} users
                      </span>
                    </div>
                  </div>
                  <button onClick={() => setShowPlan(true)} style={{
                    display: 'flex', alignItems: 'center', gap: '0.35rem',
                    padding: '0.4rem 0.9rem', fontSize: '0.8rem', fontWeight: 600,
                    background: nextPlan.color, color: '#fff',
                    border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer',
                  }}>
                    <ArrowRight size={13} />Upgrade
                  </button>
                </div>
              )}
            </SectionCard>

            {/* ── General info ──────────────────────────────────────────── */}
            <SectionCard icon={<Building2 size={16} style={{ color: 'var(--accent-primary)' }} />} title="General Information">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">Organisation name</label>
                  <input className="form-input" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">Billing email</label>
                  <input
                    type="email"
                    className="form-input"
                    style={{ borderColor: formErrors.billingEmail ? 'var(--error)' : undefined }}
                    value={billingEmail}
                    onChange={(e) => setBillingEmail(e.target.value)}
                    onBlur={() => {
                      if (billingEmail && !validateEmail(billingEmail)) {
                        setFormErrors(prev => ({ ...prev, billingEmail: 'Please enter a valid email address' }));
                      } else {
                        setFormErrors(prev => ({ ...prev, billingEmail: '' }));
                      }
                    }}
                    placeholder="billing@company.com"
                  />
                  {formErrors.billingEmail && <p style={{ color: 'var(--error)', fontSize: '0.75rem', margin: '0.25rem 0 0' }}>{formErrors.billingEmail}</p>}
                </div>
              </div>
            </SectionCard>

            {/* ── Settings ──────────────────────────────────────────────── */}
            <SectionCard icon={<Globe size={16} style={{ color: '#3b82f6' }} />} title="Settings">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label"><Clock size={13} style={{ marginRight: '0.3rem', verticalAlign: 'middle' }} />Default timezone</label>
                  <select className="form-input" value={timezone} onChange={(e) => setTimezone(e.target.value)} style={{ cursor: 'pointer' }}>
                    {TIMEZONES.map((tz) => (
                      <option key={tz.value} value={tz.value}>{tz.label}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label"><DollarSign size={13} style={{ marginRight: '0.3rem', verticalAlign: 'middle' }} />Currency</label>
                  <select className="form-input" value={currency} onChange={(e) => setCurrency(e.target.value)} style={{ cursor: 'pointer' }}>
                    {['USD', 'CAD', 'EUR', 'GBP', 'AUD'].map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Receipt footer text</label>
                <textarea
                  className="form-input"
                  rows={2}
                  style={{ resize: 'vertical', fontFamily: 'inherit' }}
                  placeholder="Thank you for shopping with us!"
                  value={receiptFooter}
                  onChange={(e) => setReceiptFooter(e.target.value)}
                />
              </div>

              <Toggle
                label={<><Gift size={13} style={{ marginRight: '0.4rem', verticalAlign: 'middle' }} />Loyalty points programme</>}
                checked={loyaltyEnabled}
                onChange={setLoyaltyEnabled}
              />
            </SectionCard>

            {/* ── Billing Summary ───────────────────────────────────────── */}
            <SectionCard icon={<Receipt size={16} style={{ color: '#8b5cf6' }} />} title="Billing Summary">
              {billing && billing.stores?.length > 0 ? (
                <>
                  {/* Column headers */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: '1rem', paddingBottom: '0.5rem', borderBottom: '2px solid var(--border-color)', marginBottom: '0.25rem' }}>
                    {['Store', 'Stations', 'Rate', 'Monthly'].map((h, i) => (
                      <span key={h} style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: i > 0 ? 'right' : 'left' }}>{h}</span>
                    ))}
                  </div>

                  {billing.stores.map((s, i) => (
                    <BillingRow key={s.storeId} store={s} isLast={i === billing.stores.length - 1} />
                  ))}

                  {/* Totals */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: '1rem', alignItems: 'center', marginTop: '0.5rem', paddingTop: '0.75rem', borderTop: '2px solid var(--border-color)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <Layers size={14} style={{ color: 'var(--text-muted)' }} />
                      <span style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--text-primary)' }}>Total</span>
                    </div>
                    <span style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--text-primary)', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {billing.totalStations} station{billing.totalStations !== 1 ? 's' : ''}
                    </span>
                    <span />
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--accent-primary)', whiteSpace: 'nowrap' }}>${billing.totalMonthly.toFixed(2)}/mo</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>${billing.totalAnnual.toFixed(2)}/yr</div>
                    </div>
                  </div>

                  {/* KPI chips */}
                  <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem', flexWrap: 'wrap' }}>
                    {[
                      { label: 'Active stores',  value: billing.stores.length,               icon: <Store size={13} />,    color: '#3b82f6' },
                      { label: 'Total stations', value: billing.totalStations,               icon: <Layers size={13} />,   color: '#8b5cf6' },
                      { label: 'Monthly total',  value: `$${billing.totalMonthly.toFixed(2)}`, icon: <DollarSign size={13} />, color: 'var(--accent-primary)' },
                      { label: 'Annual total',   value: `$${billing.totalAnnual.toFixed(2)}`,  icon: <Receipt size={13} />,  color: '#f59e0b' },
                    ].map(({ label, value, icon, color }) => (
                      <div key={label} style={{ flex: '1 1 140px', background: 'var(--bg-secondary)', borderRadius: '0.75rem', padding: '0.75rem 1rem', border: '1px solid var(--border-color)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color, marginBottom: '0.25rem' }}>
                          {icon}
                          <span style={{ fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
                        </div>
                        <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>{value}</div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', padding: '1rem 0' }}>
                  No active stores found. Add stores to see your billing breakdown.
                </p>
              )}
            </SectionCard>

            {/* Save button */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 1.5rem' }}>
                {saving
                  ? <><Loader size={16} className="animate-spin" />Saving…</>
                  : <><Save size={16} />Save changes</>}
              </button>
            </div>
          </>
        ) : (
          /* No tenant yet */
          <div className="analytics-chart-card" style={{ textAlign: 'center', padding: '3rem' }}>
            <Building2 size={40} style={{ opacity: 0.2, marginBottom: '1rem' }} />
            <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
              You haven't set up an organisation yet.
            </p>
            <a href="/onboarding" className="btn btn-primary" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
              <CheckCircle2 size={16} />Set up organisation
            </a>
          </div>
        )}
      </main>

      {/* Plan change modal */}
      {showPlan && tenant && (
        <PlanModal
          currentPlan={plan}
          onClose={() => setShowPlan(false)}
          onChanged={(updated) => setTenant(updated)}
        />
      )}
    </div>
  );
}
