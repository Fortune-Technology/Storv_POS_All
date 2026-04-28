import React, { useEffect, useRef } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import './ConfirmModal.css';

/**
 * ConfirmModal — themed replacement for `window.confirm()`.
 *
 * Used directly OR (preferred) via `useConfirm()` from
 * `hooks/useConfirmDialog.jsx`, which exposes an imperative
 * `confirm({ title, message, confirmLabel, danger })` that returns a
 * promise — drop-in replacement for `if (!window.confirm(...)) return;`.
 *
 * Props:
 *   open          — show/hide the modal
 *   title         — short heading (default: "Are you sure?")
 *   message       — body text (string or ReactNode)
 *   confirmLabel  — primary button text (default: "Confirm")
 *   cancelLabel   — secondary button text (default: "Cancel")
 *   danger        — true → red Confirm button (use for destructive actions)
 *   icon          — override the default warning icon (any ReactNode)
 *   onConfirm     — callback fired when user clicks Confirm
 *   onCancel      — callback fired when user clicks Cancel / Esc / backdrop
 *   busy          — disable buttons while an async confirm action is running
 */
export default function ConfirmModal({
  open,
  title = 'Are you sure?',
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  icon,
  onConfirm,
  onCancel,
  busy = false,
}) {
  const cancelBtnRef = useRef(null);
  const confirmBtnRef = useRef(null);

  // Focus + keyboard handling — Esc cancels, Enter confirms (only when the
  // confirm button has focus, so users have to deliberately Tab to confirm).
  useEffect(() => {
    if (!open) return;
    // Default-focus Cancel — prevents accidental Enter-key confirm of a
    // destructive action.
    const t = setTimeout(() => cancelBtnRef.current?.focus(), 30);
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy) onCancel?.();
    };
    window.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); window.removeEventListener('keydown', onKey); };
  }, [open, onCancel, busy]);

  if (!open) return null;

  const stop = (e) => e.stopPropagation();

  return (
    <div
      className="confirm-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
      onClick={() => !busy && onCancel?.()}
    >
      <div className={`confirm-modal-card${danger ? ' confirm-modal-card--danger' : ''}`} onClick={stop}>
        <button
          type="button"
          className="confirm-modal-close"
          onClick={() => !busy && onCancel?.()}
          aria-label="Close"
          disabled={busy}
        >
          <X size={16} />
        </button>

        <div className="confirm-modal-icon" aria-hidden="true">
          {icon || <AlertTriangle size={28} />}
        </div>

        <h3 id="confirm-modal-title" className="confirm-modal-title">{title}</h3>

        {message != null && (
          <div className="confirm-modal-message">
            {typeof message === 'string' ? <p>{message}</p> : message}
          </div>
        )}

        <div className="confirm-modal-actions">
          <button
            ref={cancelBtnRef}
            type="button"
            className="confirm-modal-btn confirm-modal-btn--cancel"
            onClick={() => onCancel?.()}
            disabled={busy}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            className={`confirm-modal-btn confirm-modal-btn--confirm${danger ? ' confirm-modal-btn--danger' : ''}`}
            onClick={() => onConfirm?.()}
            disabled={busy}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
