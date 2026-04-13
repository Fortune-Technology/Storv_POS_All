import React, { useState, useEffect } from 'react';
import { CreditCard } from 'lucide-react';
import api from '../services/api';
import { fmtMoney } from '../utils/formatters';
import './BillingPortal.css';

const STATUS_COLORS = {
  trial:     { bg: '#1a3a5c', text: '#60a5fa' },
  active:    { bg: '#14352a', text: '#34d399' },
  past_due:  { bg: '#3d2a00', text: '#fbbf24' },
  suspended: { bg: '#3d0000', text: '#f87171' },
  cancelled: { bg: '#1f1f1f', text: '#9ca3af' },
};

function StatusBadge({ status }) {
  const c = STATUS_COLORS[status] || STATUS_COLORS.cancelled;
  return (
    <span className="bp-status-badge" style={{ background: c.bg, color: c.text }}>
      {status?.replace('_', ' ')}
    </span>
  );
}

export default function BillingPortal() {
  const [sub, setSub]           = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/billing/subscription').then(r => setSub(r.data)).catch(() => {}),
      api.get('/billing/invoices').then(r => setInvoices(r.data || [])).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, []);

  const fmt     = fmtMoney;
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString() : '—';

  return (
    <div className="p-page">
      <div className="bp-container">
        <div className="p-header">
          <div className="p-header-left">
            <div className="p-header-icon">
              <CreditCard size={22} />
            </div>
            <div>
              <h1 className="p-title">Billing & Subscription</h1>
              <p className="p-subtitle">Manage your subscription plan and billing history.</p>
            </div>
          </div>
          <div className="p-header-actions"></div>
        </div>

        {loading ? (
          <div className="bp-loading">Loading…</div>
        ) : !sub ? (
          <div className="bp-no-sub">
            <p>
              No active subscription found. Contact support to set up your plan.
            </p>
            <a href="mailto:billing@storveu.com">billing@storveu.com</a>
          </div>
        ) : (
          <>
            {/* Subscription card */}
            <div className="bp-sub-card">
              <div className="bp-sub-header">
                <div>
                  <div className="bp-plan-header">
                    <h2 className="bp-plan-name">
                      {sub.plan?.name || 'Custom Plan'}
                    </h2>
                    <StatusBadge status={sub.status} />
                  </div>
                  <p className="bp-store-count">
                    {sub.storeCount} store{sub.storeCount !== 1 ? 's' : ''} · {sub.registerCount} register{sub.registerCount !== 1 ? 's' : ''}
                  </p>
                </div>
                <div className="bp-price-wrap">
                  <div className="bp-price">
                    {fmt(sub.plan?.basePrice)}<span className="bp-price-period">/mo</span>
                  </div>
                </div>
              </div>

              <hr className="bp-divider" />

              <div className="bp-details-grid">
                {[
                  { label: 'Status',          value: <StatusBadge status={sub.status} /> },
                  { label: 'Trial Ends',       value: fmtDate(sub.trialEndsAt) },
                  { label: 'Current Period',   value: sub.currentPeriodStart ? `${fmtDate(sub.currentPeriodStart)} – ${fmtDate(sub.currentPeriodEnd)}` : '—' },
                  { label: 'Payment Method',   value: sub.paymentMasked ? `${(sub.paymentMethod || '').toUpperCase()} ···${sub.paymentMasked}` : 'Not set' },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <div className="bp-detail-label">{label}</div>
                    <div className="bp-detail-value">{value}</div>
                  </div>
                ))}
              </div>

              {sub.discountType && (
                <div className="bp-discount">
                  Discount applied:{' '}
                  {sub.discountType === 'percent' ? `${sub.discountValue}% off` : `$${sub.discountValue} off`}
                  {sub.discountNote && ` — ${sub.discountNote}`}
                  {sub.discountExpiry && ` (until ${fmtDate(sub.discountExpiry)})`}
                </div>
              )}

              {/* Extra add-ons */}
              {sub.extraAddons?.length > 0 && (
                <div className="bp-addons">
                  <div className="bp-addons-label">Active Add-ons</div>
                  <div className="bp-addon-list">
                    {sub.extraAddons.map(key => {
                      const addon = sub.plan?.addons?.find(a => a.key === key);
                      return (
                        <span key={key} className="bp-addon-badge">
                          {addon?.label || key}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Invoice history */}
            <div className="bp-invoice-card">
              <div className="bp-invoice-header">
                <h3 className="bp-invoice-title">Invoice History</h3>
              </div>
              {invoices.length === 0 ? (
                <div className="bp-invoice-empty">No invoices yet.</div>
              ) : (
                <div className="bp-invoice-scroll">
                  <table className="bp-invoice-table">
                    <thead>
                      <tr>
                        {['Invoice #', 'Period', 'Amount', 'Status', 'Date'].map(h => (
                          <th key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {invoices.map(inv => {
                        const invStatusBg = inv.status === 'paid' ? '#14352a' : inv.status === 'failed' ? '#3d0000' : inv.status === 'written_off' ? '#1f1f1f' : '#1a2a1a';
                        const invStatusColor = inv.status === 'paid' ? '#34d399' : inv.status === 'failed' ? '#f87171' : inv.status === 'written_off' ? '#9ca3af' : '#a3e635';
                        return (
                          <tr key={inv.id}>
                            <td className="bp-td-inv-num">{inv.invoiceNumber}</td>
                            <td className="bp-td-period">
                              {fmtDate(inv.periodStart)} – {fmtDate(inv.periodEnd)}
                            </td>
                            <td className="bp-td-amount">{fmt(inv.totalAmount)}</td>
                            <td>
                              <span className="bp-inv-status" style={{ background: invStatusBg, color: invStatusColor }}>
                                {inv.status?.replace('_', ' ')}
                              </span>
                            </td>
                            <td className="bp-td-date">{fmtDate(inv.createdAt)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <p className="bp-footer">
              To update your payment method or plan, contact Storv support at{' '}
              <a href="mailto:billing@storveu.com">billing@storveu.com</a>.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
