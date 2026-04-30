import React, { useEffect } from 'react';
import { Leaf, X, AlertTriangle } from 'lucide-react';
import './EbtBalanceOverlay.css';

/**
 * EbtBalanceOverlay — themed loading / success / error display for the
 * EBT balance check flow. Sits above ChooserModal (z-index 1500) so the
 * Dejavoo round-trip can take over the screen after the cashier picks
 * which account to check.
 *
 * Props:
 *   state         — 'loading' | 'success' | 'error'
 *   result        — { type, amount, last4 } when state==='success'
 *   error         — string message when state==='error'
 *   loadingHint   — optional override for the loading message
 *   onCheckOther  — optional — re-runs the chooser to pick the other account
 *   onRetry       — optional — re-runs the chooser from the error state
 *   onClose       — closes the overlay
 *
 * Esc and click-outside both close. The Done button auto-focuses on
 * success so Enter dismisses.
 */
export default function EbtBalanceOverlay({
  state,
  result,
  error,
  loadingHint,
  onCheckOther,
  onRetry,
  onClose,
}) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && state !== 'loading') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, state]);

  const stop = (e) => e.stopPropagation();
  const closable = state !== 'loading';

  return (
    <div
      className="ebt-balance-backdrop"
      onClick={() => closable && onClose?.()}
      role="dialog"
      aria-modal="true"
    >
      <div className="ebt-balance-card" onClick={stop}>
        {closable && (
          <button className="ebt-balance-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        )}

        {state === 'loading' && (
          <>
            <div className="ebt-balance-spinner" aria-hidden="true" />
            <h3 className="ebt-balance-title">Checking EBT Balance…</h3>
            <p className="ebt-balance-hint">
              {loadingHint || 'Please ask the customer to swipe their EBT card on the terminal.'}
            </p>
          </>
        )}

        {state === 'success' && result && (
          <>
            <div className="ebt-balance-icon ebt-balance-icon--success" aria-hidden="true">
              <Leaf size={28} />
            </div>
            <div className="ebt-balance-label">Available Balance</div>
            <div
              className={
                'ebt-balance-amount' +
                (Number(result.amount) <= 0 ? ' ebt-balance-amount--zero' : '')
              }
            >
              ${Number(result.amount).toFixed(2)}
            </div>
            <div className="ebt-balance-account-type">{result.type}</div>
            {result.last4 && (
              <div className="ebt-balance-card-last4">Card •••• {result.last4}</div>
            )}
            <div className="ebt-balance-actions">
              {onCheckOther && (
                <button
                  className="ebt-balance-btn ebt-balance-btn--secondary"
                  onClick={onCheckOther}
                >
                  Check Other Account
                </button>
              )}
              <button
                className="ebt-balance-btn ebt-balance-btn--primary"
                onClick={onClose}
                autoFocus
              >
                Done
              </button>
            </div>
          </>
        )}

        {state === 'error' && (
          <>
            <div className="ebt-balance-icon ebt-balance-icon--danger" aria-hidden="true">
              <AlertTriangle size={28} />
            </div>
            <h3 className="ebt-balance-title">Could Not Read Balance</h3>
            <p className="ebt-balance-hint">
              {error || 'Card was not swiped within 30 seconds, or the card was declined. Please try again.'}
            </p>
            <div className="ebt-balance-actions">
              <button
                className="ebt-balance-btn ebt-balance-btn--secondary"
                onClick={onClose}
              >
                Cancel
              </button>
              {onRetry && (
                <button
                  className="ebt-balance-btn ebt-balance-btn--primary"
                  onClick={onRetry}
                  autoFocus
                >
                  Try Again
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
