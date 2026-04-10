import React from 'react';
import { fmt$ } from '../../utils/formatters.js';

export default function CartTotals({ totals, itemCount, bagCount = 0 }) {
  const { subtotal, discountAmount, ebtTotal, depositTotal, taxTotal, grandTotal, bagTotal } = totals;

  return (
    <div style={{
      padding: '0.875rem 0.875rem 0',
      borderTop: '1px solid var(--border)',
    }}>
      <Row label={`Subtotal (${itemCount} item${itemCount !== 1 ? 's' : ''})`} value={fmt$(subtotal)} />

      {discountAmount > 0 && (
        <Row
          label="Discount"
          value={`-${fmt$(discountAmount)}`}
          valueColor="var(--amber)"
          labelStyle={{ color: 'var(--amber)', fontWeight: 600 }}
        />
      )}

      {totals.promoSaving > 0 && (
        <Row
          label="Promo Savings"
          value={`-${fmt$(totals.promoSaving)}`}
          valueColor="#10b981"
          labelStyle={{ color: '#10b981', fontWeight: 600 }}
          note="Auto-applied"
        />
      )}

      {ebtTotal > 0 && (
        <Row
          label="EBT Eligible"
          value={fmt$(ebtTotal)}
          valueColor="var(--green)"
          labelStyle={{ color: 'var(--green)', fontWeight: 600 }}
        />
      )}

      {depositTotal > 0 && (
        <Row
          label="Bottle Deposits"
          value={fmt$(depositTotal)}
          valueColor="var(--text-deposit)"
          note="No Tax"
        />
      )}

      {bagTotal > 0 && (
        <Row
          label={`Bags (${bagCount})`}
          value={fmt$(bagTotal)}
          valueColor="var(--text-secondary)"
          note="No Tax"
        />
      )}

      {taxTotal > 0 && <Row label="Tax" value={fmt$(taxTotal)} />}

      {/* Grand total */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginTop: '0.5rem', paddingTop: '0.5rem',
        borderTop: '1px solid var(--border-light)',
      }}>
        <span style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
          TOTAL
        </span>
        <span style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--green)', fontFamily: 'Inter, sans-serif' }}>
          {fmt$(grandTotal)}
        </span>
      </div>
    </div>
  );
}

function Row({ label, value, valueColor, note, labelStyle }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      marginBottom: '0.3rem',
    }}>
      <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', ...labelStyle }}>
        {label}
        {note && <span style={{ marginLeft: 6, fontSize: '0.65rem', color: 'var(--text-muted)' }}>({note})</span>}
      </span>
      <span style={{ fontSize: '0.85rem', fontWeight: 600, color: valueColor || 'var(--text-primary)' }}>
        {value}
      </span>
    </div>
  );
}
