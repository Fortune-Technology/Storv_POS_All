import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import './ReasonModal.css';

/**
 * ReasonModal — collect a mandatory free-text reason before a destructive action.
 *
 * Used by the unified vendor pipeline for both the onboarding-reject and
 * contract-cancel paths, both of which previously had inconsistent UX
 * (one used a textarea inline, the other used `window.prompt`). Same
 * shape as ConfirmModal but with a required textarea.
 *
 * Props:
 *   open         — show/hide
 *   title        — heading (default: "Reason required")
 *   message      — body copy above the textarea
 *   placeholder  — textarea placeholder
 *   confirmLabel — primary button (default: "Confirm")
 *   cancelLabel  — secondary button (default: "Cancel")
 *   minLength    — minimum characters before Confirm enables (default 4)
 *   onConfirm    — called with the reason string when admin confirms
 *   onCancel     — called when admin dismisses
 *   busy         — disable buttons while an async action is in flight
 */
export default function ReasonModal({
  open,
  title = 'Reason required',
  message = 'Please describe why.',
  placeholder = 'Enter reason…',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  minLength = 4,
  onConfirm,
  onCancel,
  busy = false,
}) {
  const [reason, setReason] = useState('');
  const textareaRef = useRef(null);

  // Reset state every time the modal opens — leaving stale text from a prior
  // open is the kind of thing that produces ghost reasons in audit logs.
  useEffect(() => {
    if (open) {
      setReason('');
      // requestAnimationFrame so the focus call happens after the modal
      // mounts + any focus-trap library has settled.
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [open]);

  // Esc dismisses; Enter without modifier inserts a newline (the default for
  // <textarea>). Cmd/Ctrl+Enter submits if the reason is long enough.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy) onCancel?.();
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        if (reason.trim().length >= minLength && !busy) onConfirm?.(reason.trim());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, reason, minLength, busy, onConfirm, onCancel]);

  if (!open) return null;

  const trimmed = reason.trim();
  const canConfirm = trimmed.length >= minLength && !busy;

  return (
    <div className="reason-modal-backdrop" onClick={!busy ? onCancel : undefined}>
      <div className="reason-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="reason-modal-head">
          <div className="reason-modal-icon"><AlertTriangle size={18} /></div>
          <h3>{title}</h3>
          <button
            type="button"
            className="reason-modal-close"
            onClick={onCancel}
            disabled={busy}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <div className="reason-modal-body">
          {message && <p className="reason-modal-message">{message}</p>}
          <textarea
            ref={textareaRef}
            className="reason-modal-textarea"
            rows={4}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={placeholder}
            disabled={busy}
          />
          <div className="reason-modal-hint">
            {trimmed.length === 0
              ? `Required — at least ${minLength} characters.`
              : trimmed.length < minLength
                ? `${minLength - trimmed.length} more character(s) required.`
                : 'Cmd/Ctrl + Enter to confirm.'}
          </div>
        </div>
        <div className="reason-modal-foot">
          <button type="button" className="reason-modal-btn" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className="reason-modal-btn reason-modal-btn-danger"
            onClick={() => onConfirm?.(trimmed)}
            disabled={!canConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
