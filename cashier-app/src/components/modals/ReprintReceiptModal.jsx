/**
 * ReprintReceiptModal
 * Shows a past transaction as a receipt with a Print button.
 * Works with the transaction data shape from the API:
 *   { txNumber, createdAt, cashierName, lineItems, tenderLines, grandTotal, changeGiven }
 *
 * Also renders a hidden <PrintableReceipt> for window.print().
 */
import React from 'react';
import { X, Printer } from 'lucide-react';
import { fmt$, fmtTxNumber } from '../../utils/formatters.js';
import { useAuthStore } from '../../stores/useAuthStore.js';

// ── Hidden element targeted by @media print CSS ────────────────────────────
function PrintableReceipt({ tx, cashierName }) {
  if (!tx) return null;
  return (
    <div
      className="receipt-print"
      style={{
        position: 'fixed', left: -9999, top: 0,
        width: 320, fontFamily: 'monospace', fontSize: 12,
      }}
    >
      <div style={{ textAlign: 'center', marginBottom: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>RECEIPT</div>
        <div>{fmtTxNumber(tx.txNumber)}</div>
        <div>{new Date(tx.createdAt).toLocaleString()}</div>
      </div>
      <hr />
      {(tx.lineItems || []).map((item, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
          <span>{item.qty > 1 ? `${item.qty}x ` : ''}{item.name}</span>
          <span>{fmt$(item.lineTotal)}</span>
        </div>
      ))}
      <hr />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
        <span>TOTAL</span>
        <span>{fmt$(Math.abs(tx.grandTotal))}</span>
      </div>
      {(tx.tenderLines || []).map((t, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>{t.method.replace('_', ' ').toUpperCase()}</span>
          <span>{fmt$(t.amount)}</span>
        </div>
      ))}
      {tx.changeGiven > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
          <span>CHANGE</span>
          <span>{fmt$(tx.changeGiven)}</span>
        </div>
      )}
      <hr />
      <div style={{ textAlign: 'center', marginTop: 8 }}>
        Cashier: {cashierName}<br />
        Thank you for shopping with us!
      </div>
    </div>
  );
}

// ── Main modal ──────────────────────────────────────────────────────────────
export default function ReprintReceiptModal({ tx, onClose }) {
  const cashier     = useAuthStore(s => s.cashier);
  const cashierName = tx?.cashierName || cashier?.name || cashier?.email || '';

  if (!tx) return null;

  const handlePrint = () => window.print();

  return (
    <>
      {/* Hidden receipt for window.print() */}
      <PrintableReceipt tx={tx} cashierName={cashierName} />

      {/* Modal */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 250,
        background: 'rgba(0,0,0,.8)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1rem',
      }}>
        <div style={{
          width: '100%', maxWidth: 400,
          background: 'var(--bg-panel)', borderRadius: 20,
          border: '1px solid var(--border-light)',
          boxShadow: '0 32px 80px rgba(0,0,0,.65)',
          display: 'flex', flexDirection: 'column',
          maxHeight: '90vh', overflow: 'hidden',
        }}>

          {/* Header */}
          <div style={{
            padding: '1rem 1.25rem',
            borderBottom: '1px solid var(--border)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            flexShrink: 0,
          }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: '1rem' }}>Receipt</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>
                {fmtTxNumber(tx.txNumber)} · {new Date(tx.createdAt).toLocaleString()}
              </div>
            </div>
            <button onClick={onClose} style={{
              background: 'none', border: 'none',
              color: 'var(--text-muted)', cursor: 'pointer',
              padding: 6, display: 'flex', alignItems: 'center',
            }}>
              <X size={16} />
            </button>
          </div>

          {/* Receipt body */}
          <div style={{ padding: '1rem 1.5rem', overflowY: 'auto', flex: 1 }}>

            {/* Line items */}
            <div style={{
              borderBottom: '1px solid var(--border)',
              paddingBottom: '0.75rem', marginBottom: '0.75rem',
            }}>
              {(tx.lineItems || []).map((item, i) => (
                <div key={i} style={{ marginBottom: '0.35rem' }}>
                  <div style={{
                    display: 'flex', justifyContent: 'space-between',
                    fontSize: '0.82rem',
                  }}>
                    <span style={{ color: 'var(--text-primary)' }}>
                      {item.qty > 1 ? `${item.qty}× ` : ''}{item.name}
                    </span>
                    <span style={{ fontWeight: 600 }}>{fmt$(item.lineTotal)}</span>
                  </div>
                  {item.depositTotal > 0 && (
                    <div style={{
                      display: 'flex', justifyContent: 'space-between',
                      fontSize: '0.7rem', color: 'var(--text-muted)', paddingLeft: 12,
                    }}>
                      <span>└ Deposit</span>
                      <span>{fmt$(item.depositTotal)}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Total */}
            <div style={{
              display: 'flex', justifyContent: 'space-between',
              fontWeight: 800, fontSize: '1rem',
              marginBottom: '0.75rem',
            }}>
              <span style={{ color: 'var(--text-primary)' }}>TOTAL</span>
              <span style={{ color: 'var(--green)' }}>{fmt$(Math.abs(tx.grandTotal))}</span>
            </div>

            {/* Tender lines */}
            <div style={{ paddingTop: '0.5rem', borderTop: '1px solid var(--border)' }}>
              {(tx.tenderLines || []).map((t, i) => (
                <div key={i} style={{
                  display: 'flex', justifyContent: 'space-between',
                  fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 3,
                }}>
                  <span>{t.method.replace('_', ' ').toUpperCase()}</span>
                  <span>{fmt$(t.amount)}</span>
                </div>
              ))}
              {tx.changeGiven > 0 && (
                <div style={{
                  display: 'flex', justifyContent: 'space-between',
                  fontWeight: 700, fontSize: '0.85rem',
                  color: 'var(--green)', marginTop: 4,
                }}>
                  <span>CHANGE</span>
                  <span>{fmt$(tx.changeGiven)}</span>
                </div>
              )}
            </div>

            {/* Cashier footer */}
            <div style={{
              marginTop: '0.875rem',
              fontSize: '0.7rem', color: 'var(--text-muted)',
              textAlign: 'center', borderTop: '1px solid var(--border)',
              paddingTop: '0.625rem',
            }}>
              Cashier: {cashierName}<br />
              Thank you for shopping with us!
            </div>
          </div>

          {/* Actions */}
          <div style={{
            padding: '0 1.5rem 1.5rem',
            display: 'flex', gap: 8, flexShrink: 0,
          }}>
            <button
              onClick={handlePrint}
              style={{
                flex: 2, padding: '0.875rem', borderRadius: 10,
                background: 'var(--green)', color: '#fff',
                fontWeight: 800, border: 'none', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}
            >
              <Printer size={15} /> Print Receipt
            </button>
            <button
              onClick={onClose}
              style={{
                flex: 1, padding: '0.875rem', borderRadius: 10,
                background: 'var(--bg-input)', color: 'var(--text-secondary)',
                fontWeight: 600, border: 'none', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
