import React, { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import api from '../services/api';

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
    <span style={{
      background: c.bg, color: c.text,
      padding: '0.25rem 0.75rem', borderRadius: '999px',
      fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
    }}>
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

  const fmt     = (n) => `$${Number(n || 0).toFixed(2)}`;
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString() : '—';

  return (
    <Layout>
      <div style={{ padding: '1.5rem', maxWidth: '900px' }}>
        <h1 style={{ margin: '0 0 0.25rem', fontSize: '1.5rem', fontWeight: 700 }}>Billing & Subscription</h1>
        <p style={{ margin: '0 0 2rem', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
          Manage your subscription plan and billing history.
        </p>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>Loading…</div>
        ) : !sub ? (
          <div style={{
            background: 'var(--bg-card)', border: '1px solid var(--border-color)',
            borderRadius: '10px', padding: '2rem', textAlign: 'center',
          }}>
            <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>
              No active subscription found. Contact support to set up your plan.
            </p>
            <a
              href="mailto:billing@storveu.com"
              style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}
            >
              billing@storveu.com
            </a>
          </div>
        ) : (
          <>
            {/* Subscription card */}
            <div style={{
              background: 'var(--bg-card)', border: '1px solid var(--border-color)',
              borderRadius: '10px', padding: '1.5rem', marginBottom: '1.5rem',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                    <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700 }}>
                      {sub.plan?.name || 'Custom Plan'}
                    </h2>
                    <StatusBadge status={sub.status} />
                  </div>
                  <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                    {sub.storeCount} store{sub.storeCount !== 1 ? 's' : ''} · {sub.registerCount} register{sub.registerCount !== 1 ? 's' : ''}
                  </p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '1.75rem', fontWeight: 800 }}>
                    {fmt(sub.plan?.basePrice)}<span style={{ fontSize: '0.875rem', fontWeight: 400, color: 'var(--text-muted)' }}>/mo</span>
                  </div>
                </div>
              </div>

              <hr style={{ border: 'none', borderTop: '1px solid var(--border-color)', margin: '1rem 0' }} />

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem' }}>
                {[
                  { label: 'Status',          value: <StatusBadge status={sub.status} /> },
                  { label: 'Trial Ends',       value: fmtDate(sub.trialEndsAt) },
                  { label: 'Current Period',   value: sub.currentPeriodStart ? `${fmtDate(sub.currentPeriodStart)} – ${fmtDate(sub.currentPeriodEnd)}` : '—' },
                  { label: 'Payment Method',   value: sub.paymentMasked ? `${(sub.paymentMethod || '').toUpperCase()} ···${sub.paymentMasked}` : 'Not set' },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.25rem' }}>
                      {label}
                    </div>
                    <div style={{ fontSize: '0.9rem', fontWeight: 500 }}>{value}</div>
                  </div>
                ))}
              </div>

              {sub.discountType && (
                <div style={{
                  marginTop: '1rem', padding: '0.75rem 1rem',
                  background: 'rgba(52, 211, 153, 0.08)', borderRadius: '8px',
                  border: '1px solid rgba(52, 211, 153, 0.2)',
                  fontSize: '0.875rem', color: '#34d399',
                }}>
                  🎁 Discount applied:{' '}
                  {sub.discountType === 'percent' ? `${sub.discountValue}% off` : `$${sub.discountValue} off`}
                  {sub.discountNote && ` — ${sub.discountNote}`}
                  {sub.discountExpiry && ` (until ${fmtDate(sub.discountExpiry)})`}
                </div>
              )}

              {/* Extra add-ons */}
              {sub.extraAddons?.length > 0 && (
                <div style={{ marginTop: '1rem' }}>
                  <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.5rem' }}>
                    Active Add-ons
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    {sub.extraAddons.map(key => {
                      const addon = sub.plan?.addons?.find(a => a.key === key);
                      return (
                        <span key={key} style={{
                          background: 'rgba(96, 165, 250, 0.1)', color: '#60a5fa',
                          padding: '0.2rem 0.65rem', borderRadius: '999px',
                          fontSize: '0.75rem', fontWeight: 600,
                          border: '1px solid rgba(96, 165, 250, 0.2)',
                        }}>
                          {addon?.label || key}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Invoice history */}
            <div style={{
              background: 'var(--bg-card)', border: '1px solid var(--border-color)',
              borderRadius: '10px', overflow: 'hidden',
            }}>
              <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-color)' }}>
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>Invoice History</h3>
              </div>
              {invoices.length === 0 ? (
                <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                  No invoices yet.
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                        {['Invoice #', 'Period', 'Amount', 'Status', 'Date'].map(h => (
                          <th key={h} style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)', fontSize: '0.75rem', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {invoices.map(inv => (
                        <tr key={inv.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                          <td style={{ padding: '0.75rem 1rem', fontFamily: 'monospace', fontSize: '0.8rem' }}>{inv.invoiceNumber}</td>
                          <td style={{ padding: '0.75rem 1rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                            {fmtDate(inv.periodStart)} – {fmtDate(inv.periodEnd)}
                          </td>
                          <td style={{ padding: '0.75rem 1rem', fontWeight: 600 }}>{fmt(inv.totalAmount)}</td>
                          <td style={{ padding: '0.75rem 1rem' }}>
                            <span style={{
                              padding: '0.2rem 0.6rem', borderRadius: '999px', fontSize: '0.7rem', fontWeight: 700,
                              background: inv.status === 'paid' ? '#14352a' : inv.status === 'failed' ? '#3d0000' : inv.status === 'written_off' ? '#1f1f1f' : '#1a2a1a',
                              color:      inv.status === 'paid' ? '#34d399' : inv.status === 'failed' ? '#f87171' : inv.status === 'written_off' ? '#9ca3af' : '#a3e635',
                            }}>
                              {inv.status?.replace('_', ' ')}
                            </span>
                          </td>
                          <td style={{ padding: '0.75rem 1rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{fmtDate(inv.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <p style={{ marginTop: '1.5rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              To update your payment method or plan, contact Storv support at{' '}
              <a href="mailto:billing@storveu.com" style={{ color: 'var(--accent)' }}>billing@storveu.com</a>.
            </p>
          </>
        )}
      </div>
    </Layout>
  );
}
