import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import './ChooserModal.css';

/**
 * ChooserModal — themed multi-option chooser.
 *
 * Like ConfirmModal, but with N labeled buttons instead of a binary
 * affirm/cancel. Use when both choices are equally affirmative actions
 * (e.g. SNAP vs Cash Benefit, Pickup vs Delivery, Print vs Email).
 *
 * Preferred usage is via `useChooser()` from `hooks/useChooserDialog.jsx`,
 * which exposes an imperative `choose({ options })` returning a promise
 * that resolves to the chosen value or `null` on cancel.
 *
 * Props:
 *   open           — show/hide the modal
 *   title          — short heading
 *   message        — body text (string or ReactNode)
 *   icon           — ReactNode rendered inside the icon circle (e.g. <Leaf size={28} />)
 *   iconAccent     — 'primary' | 'success' | 'warn' | 'danger' (tints icon circle)
 *   options        — [{ label, value, accent, icon? }] — accent picks a button style
 *   cancelLabel    — text for the bottom Cancel link (default 'Cancel')
 *   showCancel     — show Cancel link + close X (default true)
 *   onChoose       — callback fired with the chosen option's `value`
 *   onCancel       — callback fired on Esc / backdrop / Cancel / X
 *   busy           — disable buttons while an async action is running
 *
 * Option accents:
 *   primary-blue / secondary-blue
 *   primary-success / secondary-success
 *   primary-warn / secondary-warn
 *   primary-danger / secondary-danger
 */
export default function ChooserModal({
  open,
  title,
  message,
  icon,
  iconAccent = 'primary',
  options = [],
  cancelLabel = 'Cancel',
  showCancel = true,
  onChoose,
  onCancel,
  busy = false,
}) {
  const firstOptRef = useRef(null);

  // Focus first option so Enter triggers the most-likely choice.
  // Esc cancels (returns null via onCancel).
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => firstOptRef.current?.focus(), 30);
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy && showCancel) onCancel?.();
    };
    window.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); window.removeEventListener('keydown', onKey); };
  }, [open, onCancel, busy, showCancel]);

  if (!open) return null;

  const stop = (e) => e.stopPropagation();

  return (
    <div
      className="chooser-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="chooser-modal-title"
      onClick={() => !busy && showCancel && onCancel?.()}
    >
      <div className="chooser-modal-card" onClick={stop}>
        {showCancel && (
          <button
            type="button"
            className="chooser-modal-close"
            onClick={() => !busy && onCancel?.()}
            aria-label="Close"
            disabled={busy}
          >
            <X size={16} />
          </button>
        )}

        {icon && (
          <div className={`chooser-modal-icon chooser-modal-icon--${iconAccent}`} aria-hidden="true">
            {icon}
          </div>
        )}

        {title && <h3 id="chooser-modal-title" className="chooser-modal-title">{title}</h3>}

        {message != null && (
          <div className="chooser-modal-message">
            {typeof message === 'string' ? <p>{message}</p> : message}
          </div>
        )}

        <div className="chooser-modal-options">
          {options.map((opt, i) => (
            <button
              key={opt.value}
              ref={i === 0 ? firstOptRef : null}
              type="button"
              className={`chooser-modal-option chooser-modal-option--${opt.accent || 'primary-blue'}`}
              onClick={() => !busy && onChoose?.(opt.value)}
              disabled={busy}
            >
              {opt.icon && <span className="chooser-modal-option-icon">{opt.icon}</span>}
              <span>{opt.label}</span>
            </button>
          ))}
        </div>

        {showCancel && (
          <button
            type="button"
            className="chooser-modal-cancel"
            onClick={() => !busy && onCancel?.()}
            disabled={busy}
          >
            {cancelLabel}
          </button>
        )}
      </div>
    </div>
  );
}
