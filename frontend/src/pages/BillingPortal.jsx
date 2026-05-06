// BillingPortal — S80 Phase 3
//
// Per-store subscription management. One card per store with:
//   - Current plan + status + trial info + monthly total
//   - Plan switcher (Starter ↔ Pro)
//   - Addon picker (Starter only — Pro includes everything)
//   - Save changes
//
// Reads from /billing/store-subscriptions, writes via PUT /billing/store-subscriptions/:storeId.
import React, { useState, useEffect, useMemo } from 'react';
import { CreditCard, Check, Plus } from 'lucide-react';
import { toast } from 'react-toastify';
import { fmtMoney } from '../utils/formatters';
import {
  listMyStoreSubscriptions, updateStoreSubscription, getPublicPlans,
  listMyStoreInvoices,
} from '../services/api';
import './BillingPortal.css';

const STATUS_COLORS = {
  trial:     { bg: 'rgba(96,165,250,0.15)',  text: '#3b82f6' },
  active:    { bg: 'rgba(52,211,153,0.15)',  text: '#10b981' },
  past_due:  { bg: 'rgba(251,191,36,0.15)',  text: '#d97706' },
  suspended: { bg: 'rgba(248,113,113,0.15)', text: '#dc2626' },
  cancelled: { bg: 'rgba(156,163,175,0.15)', text: '#6b7280' },
};

function StatusBadge({ status }) {
  const c = STATUS_COLORS[status] || STATUS_COLORS.cancelled;
  return (
    <span className="bp-status-badge" style={{ background: c.bg, color: c.text }}>
      {status?.replace('_', ' ')}
    </span>
  );
}

function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString() : 'N/A';
}

export default function BillingPortal() {
  const [subs, setSubs]       = useState([]);
  const [plans, setPlans]     = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    try {
      const [subsRes, plansRes] = await Promise.all([
        listMyStoreSubscriptions().catch(() => ({ subscriptions: [] })),
        getPublicPlans().catch(() => []),
      ]);
      setSubs(subsRes.subscriptions || []);
      setPlans(Array.isArray(plansRes) ? plansRes : []);
    } finally { setLoading(false); }
  };

  useEffect(() => { refresh(); }, []);

  return (
    <div className="p-page">
      <div className="bp-container">
        <div className="p-header">
          <div className="p-header-left">
            <div className="p-header-icon"><CreditCard size={22} /></div>
            <div>
              <h1 className="p-title">Billing &amp; Plan</h1>
              <p className="p-subtitle">
                Manage subscriptions for each of your stores. Each store has its own plan and add-ons.
              </p>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="bp-loading">Loading subscriptions…</div>
        ) : subs.length === 0 ? (
          <div className="bp-no-sub">
            <p>No store subscriptions yet. Add a store to get started.</p>
          </div>
        ) : (
          <>
            {subs.map(sub => (
              <StoreSubCard key={sub.storeId} sub={sub} plans={plans} onSaved={refresh} />
            ))}
          </>
        )}

        <p className="bp-footer">
          Need help with billing? Contact{' '}
          <a href="mailto:billing@storeveu.com">billing@storeveu.com</a>.
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────
// Per-store subscription card
// ─────────────────────────────────────────────────
function StoreSubCard({ sub, plans, onSaved }) {
  const [draftPlan, setDraftPlan] = useState(sub.plan?.slug || 'starter');
  const [draftAddons, setDraftAddons] = useState(new Set(sub.purchasedAddons || []));
  const [busy, setBusy] = useState(false);
  const [invoices, setInvoices] = useState([]);
  const [invLoading, setInvLoading] = useState(true);

  // Load invoices for this store
  useEffect(() => {
    setInvLoading(true);
    listMyStoreInvoices(sub.storeId)
      .then(rows => setInvoices(Array.isArray(rows) ? rows : []))
      .catch(() => setInvoices([]))
      .finally(() => setInvLoading(false));
  }, [sub.storeId, sub.status, sub.currentPeriodEnd]);

  // Resolve the catalog version of the draft plan (so addons reflect the right plan)
  const draftPlanCatalog = useMemo(() => {
    return plans.find(p => p.slug === draftPlan) || null;
  }, [plans, draftPlan]);

  const dirty = (
    draftPlan !== (sub.plan?.slug || 'starter') ||
    JSON.stringify([...draftAddons].sort()) !== JSON.stringify([...(sub.purchasedAddons || [])].sort())
  );

  // Live monthly total from draft state
  const liveTotal = useMemo(() => {
    const base = Number(draftPlanCatalog?.basePrice || 0);
    const addons = (draftPlanCatalog?.addons || [])
      .filter(a => draftAddons.has(a.key))
      .reduce((acc, a) => acc + Number(a.price || 0), 0);
    return base + addons;
  }, [draftPlanCatalog, draftAddons]);

  const toggleAddon = (key) => {
    setDraftAddons(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handlePlanChange = (newSlug) => {
    setDraftPlan(newSlug);
    // When switching to Pro, all addons are included → wipe selection.
    // When switching to Starter, keep prior addon selection.
    if (newSlug === 'pro') setDraftAddons(new Set());
  };

  const save = async () => {
    setBusy(true);
    try {
      await updateStoreSubscription(sub.storeId, {
        planSlug: draftPlan,
        addonKeys: [...draftAddons],
      });
      // Bust entitlement cache so <Gate> components re-render across the app
      window.dispatchEvent(new CustomEvent('storv:plan-change', { detail: { storeId: sub.storeId } }));
      toast.success(`${sub.storeName} updated`);
      await onSaved?.();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bp-sub-card">
      <div className="bp-sub-header">
        <div>
          <div className="bp-plan-header">
            <h2 className="bp-plan-name">{sub.storeName}</h2>
            <StatusBadge status={sub.status} />
          </div>
          <p className="bp-store-count">
            {sub.plan?.name || 'No plan'} &middot; {sub.registerCount} register{sub.registerCount !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="bp-price-wrap">
          <div className="bp-price">
            {fmtMoney(liveTotal)}<span className="bp-price-period">/mo</span>
          </div>
          {dirty && (
            <div className="bp-price-was">
              was {fmtMoney(sub.monthlyTotal)}
            </div>
          )}
        </div>
      </div>

      <hr className="bp-divider" />

      {/* Status / trial / period info */}
      <div className="bp-details-grid">
        {[
          { label: 'Status',         value: <StatusBadge status={sub.status} /> },
          { label: 'Trial Ends',     value: fmtDate(sub.trialEndsAt) },
          { label: 'Current Period', value: sub.currentPeriodStart ? `${fmtDate(sub.currentPeriodStart)} – ${fmtDate(sub.currentPeriodEnd)}` : 'N/A' },
          { label: 'Registers',      value: sub.registerCount },
        ].map(({ label, value }) => (
          <div key={label}>
            <div className="bp-detail-label">{label}</div>
            <div className="bp-detail-value">{value}</div>
          </div>
        ))}
      </div>

      <hr className="bp-divider" />

      {/* Plan picker */}
      <div className="bp-section-title">Plan</div>
      <div className="bp-plan-picker">
        {plans.length === 0 ? (
          <div className="bp-empty">No plans available.</div>
        ) : (
          plans.map(p => {
            const selected = draftPlan === p.slug;
            return (
              <button
                key={p.slug}
                type="button"
                className={`bp-plan-tile ${selected ? 'bp-plan-tile--sel' : ''}`}
                onClick={() => handlePlanChange(p.slug)}
              >
                <div className="bp-plan-tile-name">
                  {p.name}
                  {selected && <Check size={14} />}
                </div>
                <div className="bp-plan-tile-price">
                  {fmtMoney(p.basePrice)}<span>/mo</span>
                </div>
                {p.tagline && <div className="bp-plan-tile-tagline">{p.tagline}</div>}
                {p.slug === 'pro' && <div className="bp-plan-tile-pill">All add-ons included</div>}
              </button>
            );
          })
        )}
      </div>

      {/* Addon picker — only visible on Starter (Pro includes all) */}
      {draftPlan === 'starter' && draftPlanCatalog?.addons?.length > 0 && (
        <>
          <div className="bp-section-title" style={{ marginTop: '1.5rem' }}>
            Add-ons
            <span className="bp-section-hint">Pick the modules you need. You can change anytime.</span>
          </div>
          <div className="bp-addon-grid">
            {draftPlanCatalog.addons.map(a => {
              const sel = draftAddons.has(a.key);
              return (
                <button
                  key={a.key}
                  type="button"
                  className={`bp-addon-tile ${sel ? 'bp-addon-tile--sel' : ''}`}
                  onClick={() => toggleAddon(a.key)}
                >
                  <div className="bp-addon-tile-head">
                    <div className="bp-addon-tile-label">
                      {sel ? <Check size={14} /> : <Plus size={14} />}
                      {a.label}
                    </div>
                    <div className="bp-addon-tile-price">+{fmtMoney(a.price)}/mo</div>
                  </div>
                  {a.description && <div className="bp-addon-tile-desc">{a.description}</div>}
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* Save action */}
      <div className="bp-actions-row">
        <button
          type="button"
          className="p-btn p-btn-primary"
          disabled={!dirty || busy}
          onClick={save}
        >
          {busy ? 'Saving…' : dirty ? 'Save Changes' : 'Saved'}
        </button>
        {dirty && (
          <button
            type="button"
            className="p-btn p-btn-ghost"
            onClick={() => {
              setDraftPlan(sub.plan?.slug || 'starter');
              setDraftAddons(new Set(sub.purchasedAddons || []));
            }}
          >
            Discard
          </button>
        )}
      </div>

      {/* Invoices for this store */}
      <hr className="bp-divider" />
      <div className="bp-section-title">Invoices</div>
      {invLoading ? (
        <div className="bp-empty">Loading…</div>
      ) : invoices.length === 0 ? (
        <div className="bp-empty">No invoices yet for this store.</div>
      ) : (
        <table className="bp-invoice-table">
          <thead>
            <tr>
              <th>Invoice #</th>
              <th>Period</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map(inv => {
              const statusColor = inv.status === 'paid' ? '#10b981'
                : inv.status === 'failed' ? '#dc2626'
                : inv.status === 'written_off' ? '#6b7280'
                : '#3b82f6';
              return (
                <tr key={inv.id}>
                  <td className="bp-td-inv-num">{inv.invoiceNumber}</td>
                  <td className="bp-td-period">{fmtDate(inv.periodStart)} – {fmtDate(inv.periodEnd)}</td>
                  <td className="bp-td-amount">{fmtMoney(inv.totalAmount)}</td>
                  <td>
                    <span className="bp-inv-status" style={{
                      background: `${statusColor}20`,
                      color: statusColor,
                    }}>
                      {String(inv.status).replace('_',' ')}
                    </span>
                  </td>
                  <td className="bp-td-date">{fmtDate(inv.createdAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
