import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import ConfirmModal from '../components/ConfirmModal.jsx';

/**
 * useConfirm() — promise-returning replacement for `window.confirm()`.
 *
 * Wrap your app once with `<ConfirmDialogProvider>` (already done in
 * App.jsx). Then anywhere inside the tree:
 *
 *   const confirm = useConfirm();
 *   ...
 *   const ok = await confirm({
 *     title: 'Delete department?',
 *     message: 'This will permanently remove the department.',
 *     confirmLabel: 'Delete',
 *     danger: true,
 *   });
 *   if (!ok) return;
 *
 * Drop-in replacement for:
 *   if (!window.confirm('Delete?')) return;
 *
 * Multiple concurrent calls are NOT queued — only one dialog at a time.
 * The hook resolves the most recent call's promise.
 *
 * Pass a plain string for the simplest case:
 *   const ok = await confirm('Delete department?');
 */

const ConfirmDialogContext = createContext(null);

export function ConfirmDialogProvider({ children }) {
  // Use a ref for the resolver so consecutive calls don't race React state
  const resolverRef = useRef(null);
  const [opts, setOpts] = useState(null);
  const [busy, setBusy] = useState(false);

  const close = useCallback((value) => {
    setOpts(null);
    setBusy(false);
    resolverRef.current?.(value);
    resolverRef.current = null;
  }, []);

  const confirm = useCallback((arg) => {
    // String shortcut → simple "Yes / No" dialog with the string as the message.
    const next = typeof arg === 'string' ? { message: arg } : (arg || {});

    // If a previous dialog was somehow still open, resolve it as `false` so
    // it doesn't leak.
    if (resolverRef.current) {
      try { resolverRef.current(false); } catch { /* ignore */ }
      resolverRef.current = null;
    }

    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setOpts(next);
    });
  }, []);

  const handleConfirm = useCallback(() => {
    // Allow caller to pass an async `onBeforeConfirm` if it wants to keep
    // the modal open while the action runs. Default behaviour: close
    // immediately and resolve true.
    if (typeof opts?.onBeforeConfirm === 'function') {
      setBusy(true);
      Promise.resolve(opts.onBeforeConfirm())
        .then(() => close(true))
        .catch((err) => {
          console.warn('[useConfirm] onBeforeConfirm threw:', err);
          close(false);
        });
      return;
    }
    close(true);
  }, [close, opts]);

  const handleCancel = useCallback(() => close(false), [close]);

  return (
    <ConfirmDialogContext.Provider value={confirm}>
      {children}
      <ConfirmModal
        open={!!opts}
        title={opts?.title}
        message={opts?.message}
        confirmLabel={opts?.confirmLabel}
        cancelLabel={opts?.cancelLabel}
        danger={!!opts?.danger}
        icon={opts?.icon}
        busy={busy}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </ConfirmDialogContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmDialogContext);
  if (!ctx) {
    // Graceful fallback — if someone forgets to mount the provider, we
    // log a warn and fall through to window.confirm so the action still
    // works rather than silently no-op.
    if (typeof window !== 'undefined') {
      console.warn(
        '[useConfirm] No <ConfirmDialogProvider> in tree — falling back to window.confirm. ' +
        'Wrap your app with <ConfirmDialogProvider> in App.jsx.',
      );
    }
    return (arg) => {
      const msg = typeof arg === 'string' ? arg : (arg?.message || 'Are you sure?');
      // eslint-disable-next-line no-alert
      return Promise.resolve(window.confirm(msg));
    };
  }
  return ctx;
}

export default useConfirm;
