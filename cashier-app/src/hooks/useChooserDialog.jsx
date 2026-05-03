import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import ChooserModal from '../components/ChooserModal.jsx';

/**
 * useChooser() — promise-returning multi-option chooser.
 *
 * Sibling to useConfirm() — use when both choices are equally affirmative
 * actions (not affirm/cancel). Resolves to the chosen `value`, or `null`
 * if the user cancels (Esc / backdrop / Cancel / X).
 *
 * Wrap your app once with `<ChooserDialogProvider>` (already done in
 * App.jsx). Then anywhere inside the tree:
 *
 *   const choose = useChooser();
 *   ...
 *   const value = await choose({
 *     title: 'EBT Balance Check',
 *     message: 'Which account would you like to check?',
 *     icon: <Leaf size={28} />,
 *     iconAccent: 'success',
 *     options: [
 *       { label: 'Food Stamp (SNAP)', value: 'ebt_food', accent: 'primary-success' },
 *       { label: 'Cash Benefit',      value: 'ebt_cash', accent: 'secondary-success' },
 *     ],
 *   });
 *   if (!value) return; // user cancelled
 *
 * Multiple concurrent calls are NOT queued — only one dialog at a time.
 * A new call resolves the previous one as `null` so it doesn't leak.
 */

const ChooserDialogContext = createContext(null);

export function ChooserDialogProvider({ children }) {
  const resolverRef = useRef(null);
  const [opts, setOpts] = useState(null);

  const close = useCallback((value) => {
    setOpts(null);
    resolverRef.current?.(value);
    resolverRef.current = null;
  }, []);

  const choose = useCallback((arg) => {
    if (!arg || !Array.isArray(arg.options) || arg.options.length === 0) {
      throw new Error('useChooser({ options: [...] }) requires a non-empty options array');
    }

    // If a previous dialog was somehow still open, resolve it as `null`.
    if (resolverRef.current) {
      try { resolverRef.current(null); } catch { /* ignore */ }
      resolverRef.current = null;
    }

    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setOpts(arg);
    });
  }, []);

  return (
    <ChooserDialogContext.Provider value={choose}>
      {children}
      <ChooserModal
        open={!!opts}
        title={opts?.title}
        message={opts?.message}
        icon={opts?.icon}
        iconAccent={opts?.iconAccent}
        options={opts?.options || []}
        cancelLabel={opts?.cancelLabel}
        showCancel={opts?.showCancel !== false}
        onChoose={(value) => close(value)}
        onCancel={() => close(null)}
      />
    </ChooserDialogContext.Provider>
  );
}

export function useChooser() {
  const ctx = useContext(ChooserDialogContext);
  if (!ctx) {
    // Graceful fallback — if someone forgets to mount the provider, we log
    // a warn and return the first option so the action still resolves rather
    // than silently hang.
    if (typeof window !== 'undefined') {
      console.warn(
        '[useChooser] No <ChooserDialogProvider> in tree — falling back to first option. ' +
        'Wrap your app with <ChooserDialogProvider> in App.jsx.',
      );
    }
    return (arg) => Promise.resolve(arg?.options?.[0]?.value ?? null);
  }
  return ctx;
}

export default useChooser;
