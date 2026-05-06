import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import './analytics.css';
import './Organisation.css';
import {
  Building2, Save, Loader, AlertCircle, RefreshCw,
  Receipt, CreditCard, Globe, Clock, DollarSign, Gift,
  CheckCircle2, Store, Layers, Zap, X, ArrowRight,
  Users, ShieldCheck, TrendingUp, Phone, Trash2,
} from 'lucide-react';
import { getMyTenant, updateMyTenant, getStoreBillingSummary, updateTenantPlan, deleteMyTenant, listMyStoreSubscriptions, getPublicPlans } from '../services/api';
import { toast } from 'react-toastify';

/* ── Plan styling — colors only. The plans themselves are fetched live ─────
   from the SubscriptionPlan catalog (`getPublicPlans()`). Removing the legacy
   hardcoded PLANS / PLAN_COLORS dictionaries was S81 — they referenced 'trial',
   'basic', 'pro', 'enterprise' which don't match the new Starter / Pro slugs
   and contained marketing copy that drifted from what admin had configured.
   ───────────────────────────────────────────────────────────────────────── */
const PLAN_STYLES = {
  starter:    { bg: 'rgba(59,130,246,0.12)',  color: '#3b82f6', label: 'Starter' },
  pro:        { bg: 'rgba(139,92,246,0.12)',  color: '#8b5cf6', label: 'Pro' },
  // Legacy mappings kept ONLY for the chip color on existing rows that still
  // carry an old enum value in `Organization.plan`. Once those are migrated
  // these can drop entirely.
  trial:      { bg: 'rgba(59,130,246,0.12)',  color: '#3b82f6', label: 'Starter' }, // alias → starter
  basic:      { bg: 'rgba(59,130,246,0.12)',  color: '#3b82f6', label: 'Starter' },
  enterprise: { bg: 'var(--brand-12)',        color: 'var(--accent-primary)', label: 'Pro' },
};
const PLAN_COLORS = PLAN_STYLES; // back-compat alias for the few remaining call sites

/* ── Plan Change Modal ───────────────────────────────────────────────────── */
function PlanModal({ currentPlan, currentSub, onClose, onChanged, navigate }) {
  // S81 — fetches the LIVE SubscriptionPlan catalog (Starter + Pro). The
  // legacy 4-tier modal (Trial/Basic/Pro/Enterprise) was hardcoded with
  // marketing copy that drifted from what admin actually configured. Source
  // of truth is now `prisma.subscriptionPlan` via /api/billing/plans.
  const [plans,    setPlans]    = useState([]);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [selected, setSelected] = useState(currentPlan);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await getPublicPlans();
        const list = Array.isArray(res?.plans) ? res.plans : [];
        if (cancelled) return;
        setPlans(list);
        // Default selection: the user's current plan if it matches one in the
        // catalog, otherwise the live `isDefault` plan (Starter).
        const matched = list.find(p => p.slug === currentPlan);
        if (!matched) {
          const def = list.find(p => p.isDefault) || list[0];
          if (def) setSelected(def.slug);
        }
      } catch {
        toast.error('Could not load plan catalog.');
      } finally {
        if (!cancelled) setLoadingPlans(false);
      }
    })();
    return () => { cancelled = true; };
  }, [currentPlan]);

  const chosen = plans.find(p => p.slug === selected);

  // The Account → Organisation card is org-scoped, but plans now live per-store
  // (S80). We can either: (a) update only the active store's StoreSubscription,
  // (b) redirect to /portal/billing where each store can be edited separately.
  // Path (b) is correct for multi-store orgs. We keep it simple — the modal
  // shows the live plans for confirmation, and on submit we route to the
  // per-store billing page so the user explicitly chooses which store to apply.
  const handleConfirm = async () => {
    if (!chosen) { onClose(); return; }
    if (chosen.slug === currentPlan) { onClose(); return; }
    setSubmitting(true);
    try {
      // Multi-store org → can't blanket-apply. Redirect to billing page where
      // user sees per-store subscriptions and can change each one.
      onClose();
      toast.info(`Pick the store(s) you want to switch to ${chosen.name} on the Billing page.`);
      navigate('/portal/billing');
    } finally {
      setSubmitting(false);
    }
  };

  // Marketing-style copy derived from each plan's actual data — no hardcoded
  // feature lists. Pro shows "all modules included"; Starter shows the addon
  // catalog inline.
  const featureLines = (p) => {
    const isPro = p.slug === 'pro';
    if (isPro) {
      return [
        'All business modules included',
        'Unlimited add-ons',
        'Per-store pricing',
        'Priority support',
      ];
    }
    const addonCount = Array.isArray(p.addons) ? p.addons.length : 0;
    return [
      'Per-store pricing',
      `${addonCount} add-on${addonCount === 1 ? '' : 's'} available (purchased à la carte)`,
      'POS integration',
      'Basic analytics',
    ];
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
        width: '100%', maxWidth: '720px',
        boxShadow: 'var(--shadow-lg)',
        maxHeight: '92vh', overflowY: 'auto',
        animation: 'fadeIn 0.2s ease',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Zap size={20} style={{ color: 'var(--accent-primary)' }} />
              Change plan
            </h2>
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.875rem', color: 'var(--text-muted)' }}>
              {currentSub?.plan?.name
                ? <>Currently on <strong style={{ color: PLAN_STYLES[currentPlan]?.color || 'var(--accent-primary)' }}>{currentSub.plan.name}</strong>. Select a new plan below.</>
                : <>Select a plan below to set your subscription.</>}
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.25rem' }}>
            <X size={22} />
          </button>
        </div>

        {/* Plan cards — driven by live data */}
        {loadingPlans ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            <Loader size={18} className="animate-spin" /> Loading plans…
          </div>
        ) : plans.length === 0 ? (
          <div style={{ padding: '1.5rem', background: 'var(--error-bg)', border: '1px solid var(--error)', borderRadius: 'var(--radius-md)', color: 'var(--error)', fontSize: '0.875rem' }}>
            No active plans found. Contact your administrator.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
            {plans.map(plan => {
              const style = PLAN_STYLES[plan.slug] || PLAN_STYLES.starter;
              const isSelected = selected === plan.slug;
              const isCurrent  = currentPlan === plan.slug;
              const base = Number(plan.basePrice ?? 0);
              return (
                <div
                  key={plan.slug}
                  onClick={() => setSelected(plan.slug)}
                  style={{
                    position: 'relative',
                    border: `2px solid ${isSelected ? style.color : 'var(--border-color)'}`,
                    borderRadius: 'var(--radius-lg)',
                    padding: '1.25rem',
                    cursor: 'pointer',
                    background: isSelected ? style.bg : 'var(--bg-tertiary)',
                    transition: 'all 0.15s',
                    boxShadow: isSelected ? `0 0 0 3px ${style.color}22` : 'none',
                  }}
                >
                  {plan.highlighted && (
                    <div style={{
                      position: 'absolute', top: '-11px', left: '50%', transform: 'translateX(-50%)',
                      background: style.color, color: '#fff',
                      fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
                      padding: '0.2rem 0.65rem', borderRadius: '9999px', whiteSpace: 'nowrap',
                    }}>
                      Most popular
                    </div>
                  )}
                  {isCurrent && (
                    <div style={{
                      position: 'absolute', top: 10, right: 10,
                      background: style.color, color: '#fff',
                      fontSize: '0.6rem', fontWeight: 700,
                      padding: '0.1rem 0.45rem', borderRadius: '9999px',
                    }}>Current</div>
                  )}
                  <div style={{ fontSize: '1rem', fontWeight: 700, color: isSelected ? style.color : 'var(--text-primary)', marginBottom: '0.25rem' }}>
                    {plan.name}
                  </div>
                  {plan.tagline && (
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.5rem', lineHeight: 1.4 }}>
                      {plan.tagline}
                    </div>
                  )}
                  <div style={{ marginBottom: '1rem' }}>
                    <span style={{ fontSize: '1.6rem', fontWeight: 800, color: isSelected ? style.color : 'var(--text-primary)', fontFamily: 'Outfit, sans-serif' }}>
                      ${base.toFixed(2)}
                    </span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '0.25rem' }}>
                      per store / month
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                    {featureLines(plan).map(f => (
                      <div key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.4rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        <CheckCircle2 size={12} style={{ color: style.color, flexShrink: 0, marginTop: '1px' }} />
                        {f}
                      </div>
                    ))}
                  </div>
                  {isSelected && (
                    <div style={{
                      position: 'absolute', bottom: 10, right: 10,
                      width: 22, height: 22, borderRadius: '50%',
                      background: style.color,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <CheckCircle2 size={13} color="#fff" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Per-store pricing notice */}
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: '0.6rem',
          padding: '0.875rem 1rem', marginBottom: '1.25rem',
          background: 'var(--brand-05)', border: '1px solid var(--brand-30)',
          borderRadius: 'var(--radius-md)',
        }}>
          <AlertCircle size={16} style={{ color: 'var(--accent-primary)', flexShrink: 0, marginTop: '1px' }} />
          <div style={{ fontSize: '0.825rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            Plans apply per-store. After confirming, you'll be taken to the <strong>Billing</strong> page to choose which stores to switch to <strong>{chosen?.name || 'this plan'}</strong> and pick add-ons.
          </div>
        </div>

        {/* Action row */}
        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '0.75rem 1.5rem', background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontWeight: 500 }}>
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={submitting || !chosen || selected === currentPlan}
            className="btn btn-primary"
            style={{ padding: '0.75rem 1.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem', opacity: !chosen || selected === currentPlan ? 0.5 : 1 }}
          >
            {submitting
              ? <><Loader size={15} className="animate-spin" />Opening Billing…</>
              : <><ArrowRight size={15} />Continue to Billing</>
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
export default function Organisation({ embedded }) {
  const navigate = useNavigate();
  const [tenant,    setTenant]    = useState(null);
  const [billing,   setBilling]   = useState(null);
  // S81 — live StoreSubscription rows for this org. Source of truth for the
  // "Plan & Subscription" card. The legacy `tenant.plan` field is a free-text
  // string ('trial'/'basic'/'pro'/'enterprise') that doesn't reflect what the
  // org's stores actually pay for under S80's per-store billing model.
  const [storeSubs, setStoreSubs] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState(null);
  const [showPlan,  setShowPlan]  = useState(false);
  const [formErrors, setFormErrors] = useState({});

  // Delete org state
  const [showDeleteModal,  setShowDeleteModal]  = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');
  const [deleting,          setDeleting]          = useState(false);

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
      const [t, b, subsRes] = await Promise.all([
        getMyTenant(),
        getStoreBillingSummary().catch(() => null),
        listMyStoreSubscriptions().catch(() => ({ subscriptions: [] })),
      ]);
      setTenant(t);
      setBilling(b);
      setStoreSubs(Array.isArray(subsRes?.subscriptions) ? subsRes.subscriptions : []);
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

  /* ── Delete org ─────────────────────────────────────────────────────────── */
  const handleDeleteOrg = async () => {
    if (!deleteConfirmName) return;
    setDeleting(true);
    try {
      await deleteMyTenant(deleteConfirmName);
      toast.success('Organisation deleted.');
      localStorage.removeItem('user');
      localStorage.removeItem('token');
      navigate('/login', { replace: true });
    } catch (e) {
      toast.error(e.response?.data?.error || 'Could not delete organisation.');
    } finally {
      setDeleting(false);
    }
  };

  /* ── Plan info ──────────────────────────────────────────────────────────── */
  // S81 — Prefer the live StoreSubscription for the org's first/active store.
  // The legacy `tenant.plan` enum is kept as a fallback for orgs that haven't
  // had a StoreSubscription created yet (rare — every store gets one in S80).
  const liveSub = useMemo(() => {
    if (!Array.isArray(storeSubs) || storeSubs.length === 0) return null;
    // Prefer a non-trial active sub if multiple stores exist; else first one.
    return storeSubs.find(s => s.status === 'active') || storeSubs[0];
  }, [storeSubs]);

  // Map live SubscriptionPlan slug → the legacy PLANS card entry for color/style.
  // Pro→pro, Starter→trial visually (since Starter is the entry-level paid tier).
  // When there's no live sub, fall back to legacy `tenant.plan`.
  const livePlanSlug = liveSub?.plan?.slug || null;
  const plan = livePlanSlug || tenant?.plan || 'trial';
  const planMeta = useMemo(() => {
    if (liveSub?.plan) {
      // Build a synthetic PLANS-shape entry from the live data so the card
      // renders the actual plan name + price without falling back to hardcoded
      // strings. Features are the addon list (or "all modules" for Pro).
      const base = Number(liveSub.plan.basePrice ?? 0);
      const isPro = livePlanSlug === 'pro';
      const addons = Array.isArray(liveSub.purchasedAddons) ? liveSub.purchasedAddons : [];
      const features = isPro
        ? ['All business modules included', 'Unlimited add-ons', 'Per-store pricing', 'POS + integrations']
        : addons.length > 0
          ? [...addons.map(k => `Add-on: ${k}`), 'POS integration', 'Basic analytics']
          : ['Per-store pricing', 'POS integration', 'Basic analytics', 'Add features as you grow'];
      return {
        value: livePlanSlug,
        label: liveSub.plan.name || (isPro ? 'Pro' : 'Starter'),
        price: `$${base.toFixed(2)}`,
        subPrice: liveSub.status === 'trial' ? 'trial / mo' : 'per month',
        maxStores: '∞',
        maxUsers: '∞',
        features,
      };
    }
    // Fallback shape when no live StoreSubscription is available — only used
    // by orgs in the rare state of "no StoreSubscription created yet". Mirrors
    // the original Starter trial appearance without referencing the deleted
    // PLANS dictionary.
    const styleFallback = PLAN_STYLES[plan] || PLAN_STYLES.starter;
    return {
      value: plan,
      label: styleFallback.label,
      price: 'Free',
      subPrice: 'no subscription',
      maxStores: '∞',
      maxUsers: '∞',
      features: ['No active subscription. Visit Billing to choose a plan.'],
    };
  }, [liveSub, livePlanSlug, plan]);
  const planStyle = useMemo(() => {
    if (livePlanSlug === 'pro') return { bg: 'rgba(139,92,246,0.12)', color: '#8b5cf6', label: 'Pro' };
    if (livePlanSlug === 'starter') return { bg: 'rgba(59,130,246,0.12)', color: '#3b82f6', label: 'Starter' };
    return PLAN_COLORS[plan] || PLAN_COLORS.trial;
  }, [livePlanSlug, plan]);

  const trialDaysLeft = liveSub?.status === 'trial' && liveSub?.trialEndsAt
    ? Math.max(0, Math.ceil((new Date(liveSub.trialEndsAt) - Date.now()) / 86_400_000))
    : (tenant?.trialEndsAt
      ? Math.max(0, Math.ceil((new Date(tenant.trialEndsAt) - Date.now()) / 86_400_000))
      : null);

  // No upgrade nudge when on Pro or when live data is in use — vendors should
  // change plans via the dedicated /portal/billing page (each store separately).
  // S81 — Upsell nudge removed. The legacy PLANS array (Trial→Basic→Pro→Enterprise)
  // doesn't match the new Starter/Pro structure; subscription management is
  // per-store at /portal/billing. Vendors can switch plans there directly.
  const nextPlan = null;

  const content = (
    <>

        {/* Header */}
        <div className="p-header">
          <div className="p-header-left">
            <div className="p-header-icon">
              <Building2 size={22} />
            </div>
            <div>
              <h1 className="p-title">Organisation</h1>
              <p className="p-subtitle">Manage your organisation settings and billing</p>
            </div>
          </div>
          <div className="p-header-actions">
            <button className="filter-btn" onClick={load} disabled={loading}
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <RefreshCw size={14} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
              Refresh
            </button>
          </div>
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
            {/* S81 — trial-warning banner removed. Trials are no longer offered;
                every store starts on Starter (or whatever plan admin assigns
                during contract activation). Subscription state is shown by
                the Plan & Subscription card below, which reads live data. */}

            {/* ── Plan & subscription ───────────────────────────────────── */}
            <SectionCard
              icon={<Zap size={16} style={{ color: planStyle.color }} />}
              title="Plan & Subscription"
              action={
                <button
                  onClick={() => liveSub ? navigate('/portal/billing') : setShowPlan(true)}
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

            {/* ── Danger Zone ─────────────────────────────────────────────── */}
            <SectionCard icon={<Trash2 size={18} color="#ef4444" />} title="Danger Zone">
              <div style={{
                border: '1px solid rgba(239,68,68,0.3)',
                borderRadius: 'var(--radius-md)',
                padding: '1.25rem 1.5rem',
                background: 'rgba(239,68,68,0.04)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '1rem',
                flexWrap: 'wrap',
              }}>
                <div>
                  <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
                    Delete Organisation
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    Permanently deactivate this organisation. This action cannot be undone.
                  </div>
                </div>
                <button
                  onClick={() => { setDeleteConfirmName(''); setShowDeleteModal(true); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.4rem',
                    padding: '0.6rem 1.1rem',
                    background: 'rgba(239,68,68,0.1)',
                    color: '#ef4444',
                    border: '1px solid rgba(239,68,68,0.35)',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                  }}
                >
                  <Trash2 size={14} /> Delete Organisation
                </button>
              </div>
            </SectionCard>
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

      {/* Plan change modal */}
      {showPlan && tenant && (
        <PlanModal
          currentPlan={plan}
          currentSub={liveSub}
          onClose={() => setShowPlan(false)}
          onChanged={(updated) => setTenant(updated)}
          navigate={navigate}
        />
      )}

      {/* Delete org confirmation modal */}
      {showDeleteModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '1rem',
        }}>
          <div className="glass-card" style={{
            width: '100%', maxWidth: '460px', padding: '2rem',
            background: 'var(--bg-primary)',
            boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <div style={{
                  width: 36, height: 36, borderRadius: '8px',
                  background: 'rgba(239,68,68,0.12)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Trash2 size={18} color="#ef4444" />
                </div>
                <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--text-primary)' }}>Delete Organisation</h3>
              </div>
              <button onClick={() => setShowDeleteModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                <X size={20} />
              </button>
            </div>

            {/* Warning */}
            <div style={{
              background: 'rgba(239,68,68,0.08)',
              border: '1px solid rgba(239,68,68,0.25)',
              borderRadius: 'var(--radius-sm)',
              padding: '0.875rem 1rem',
              marginBottom: '1.25rem',
              fontSize: '0.875rem',
              color: '#ef4444',
              lineHeight: 1.5,
            }}>
              <strong>Warning:</strong> This will permanently deactivate your organisation, all stores, and all associated data. This action cannot be undone.
            </div>

            {/* Confirm name input */}
            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>
                Type <strong style={{ color: 'var(--text-primary)' }}>{tenant?.name}</strong> to confirm:
              </label>
              <input
                className="form-input"
                placeholder={tenant?.name}
                value={deleteConfirmName}
                onChange={(e) => setDeleteConfirmName(e.target.value)}
                autoFocus
                style={{ borderColor: deleteConfirmName && deleteConfirmName !== tenant?.name ? 'var(--error)' : undefined }}
              />
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowDeleteModal(false)}
                className="btn"
                style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteOrg}
                disabled={deleting || deleteConfirmName !== tenant?.name}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.4rem',
                  padding: '0.6rem 1.25rem',
                  background: deleteConfirmName === tenant?.name ? '#ef4444' : 'rgba(239,68,68,0.3)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  cursor: deleteConfirmName === tenant?.name && !deleting ? 'pointer' : 'not-allowed',
                  fontWeight: 600,
                  fontSize: '0.875rem',
                  transition: 'background 0.2s',
                }}
              >
                {deleting ? <><Loader size={14} className="animate-spin" />Deleting…</> : <><Trash2 size={14} />Delete Organisation</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );

  if (embedded) return <div className="p-tab-content">{content}</div>;

  return content;
}
