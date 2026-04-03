import React from 'react';
import { CheckCircle, Printer, RefreshCw } from 'lucide-react';
import { fmt$, fmtDate, fmtTime, fmtTxNumber } from '../../utils/formatters.js';
import { useAuthStore } from '../../stores/useAuthStore.js';

export default function ReceiptModal({ tx, totals, change, onDone }) {
  const cashier = useAuthStore(s => s.cashier);

  const print = () => window.print();

  return (
    <div className="modal-backdrop">
      <div className="modal-box" style={{ maxWidth: 420, maxHeight: '90vh', overflowY: 'auto' }}>
        {/* Success header */}
        <div style={{ textAlign: 'center', padding: '1.5rem 1.5rem 0.5rem' }}>
          <div style={{
            width: 56, height: 56, borderRadius: '50%',
            background: 'var(--green-dim)', border: '2px solid var(--green-border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 0.75rem',
          }}>
            <CheckCircle size={28} color="var(--green)" />
          </div>
          <div style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--green)' }}>Sale Complete</div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 2 }}>
            {fmtTxNumber(tx.txNumber)} · {fmtDate()} {fmtTime()}
          </div>
        </div>

        {/* Receipt body — also used for print */}
        <div style={{ padding: '1rem 1.5rem' }} className="receipt-print">
          {/* Line items */}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: '0.75rem', marginBottom: '0.75rem' }}>
            {tx.lineItems?.map((item, i) => (
              <div key={i} style={{ marginBottom: '0.4rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                  <span style={{ color: 'var(--text-primary)' }}>
                    {item.qty > 1 ? `${item.qty}× ` : ''}{item.name}
                  </span>
                  <span style={{ fontWeight: 600 }}>{fmt$(item.lineTotal)}</span>
                </div>
                {item.depositTotal > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem',
                    color: 'var(--text-deposit)', paddingLeft: 12 }}>
                    <span>  └ Deposit</span>
                    <span>{fmt$(item.depositTotal)}</span>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Totals */}
          {[
            ['Subtotal',        fmt$(totals.subtotal)],
            totals.ebtTotal > 0 ? ['EBT Applied', fmt$(totals.ebtTotal)] : null,
            totals.depositTotal > 0 ? ['Deposits', fmt$(totals.depositTotal)] : null,
            totals.taxTotal > 0 ? ['Tax', fmt$(totals.taxTotal)] : null,
          ].filter(Boolean).map(([label, val]) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between',
              fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 3 }}>
              <span>{label}</span><span>{val}</span>
            </div>
          ))}
          <div style={{
            display: 'flex', justifyContent: 'space-between',
            fontWeight: 800, fontSize: '1rem', color: 'var(--text-primary)',
            borderTop: '1px solid var(--border)', marginTop: 6, paddingTop: 6,
          }}>
            <span>TOTAL</span><span style={{ color: 'var(--green)' }}>{fmt$(totals.grandTotal)}</span>
          </div>

          {/* Tender */}
          <div style={{ marginTop: '0.75rem', paddingTop: '0.5rem', borderTop: '1px solid var(--border)' }}>
            {tx.tenderLines?.map((t, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between',
                fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 3 }}>
                <span>{t.method.toUpperCase()}</span>
                <span>{fmt$(t.amount)}</span>
              </div>
            ))}
            {change > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between',
                fontWeight: 700, fontSize: '0.85rem', color: 'var(--green)', marginTop: 4 }}>
                <span>CHANGE</span><span>{fmt$(change)}</span>
              </div>
            )}
          </div>

          {/* Cashier */}
          <div style={{ marginTop: '0.75rem', fontSize: '0.7rem', color: 'var(--text-muted)', textAlign: 'center' }}>
            Cashier: {cashier?.name || cashier?.email}<br />
            Thank you for shopping with us!
          </div>
        </div>

        {/* Actions */}
        <div style={{ padding: '0 1.5rem 1.5rem', display: 'flex', gap: 8 }}>
          <button onClick={print} style={{
            flex: 1, padding: '0.875rem', borderRadius: 10,
            background: 'var(--bg-input)', color: 'var(--text-secondary)',
            fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}>
            <Printer size={15} /> Print
          </button>
          <button onClick={onDone} style={{
            flex: 2, padding: '0.875rem', borderRadius: 10,
            background: 'var(--green)', color: '#fff',
            fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}>
            <RefreshCw size={15} /> New Sale
          </button>
        </div>
      </div>
    </div>
  );
}
