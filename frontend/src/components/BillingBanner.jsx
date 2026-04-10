import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';

export default function BillingBanner() {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    api.get('/billing/subscription')
      .then(r => setStatus(r.data?.status))
      .catch(() => {});
  }, []);

  if (!status || (status !== 'past_due' && status !== 'suspended')) return null;

  const isPastDue = status === 'past_due';

  return (
    <div style={{
      background: isPastDue ? '#7c3a00' : '#5a0000',
      color: '#fff',
      padding: '0.65rem 1.25rem',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '1rem',
      fontSize: '0.875rem',
      fontWeight: 500,
      borderBottom: '1px solid rgba(255,255,255,0.15)',
      flexShrink: 0,
    }}>
      <span>
        {isPastDue
          ? '⚠️ Your subscription payment is past due. Please update your payment method to avoid service interruption.'
          : '🚫 Your account has been suspended due to failed payments. Update your billing info to restore access.'}
      </span>
      <Link
        to="/portal/billing"
        style={{
          background: 'rgba(255,255,255,0.2)',
          color: '#fff',
          padding: '0.35rem 0.85rem',
          borderRadius: '6px',
          textDecoration: 'none',
          whiteSpace: 'nowrap',
          fontWeight: 600,
          fontSize: '0.8rem',
          border: '1px solid rgba(255,255,255,0.3)',
        }}
      >
        Update Billing
      </Link>
    </div>
  );
}
