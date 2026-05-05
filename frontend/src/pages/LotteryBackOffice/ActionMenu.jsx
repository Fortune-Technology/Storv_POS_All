// ActionMenu — reusable per-row dropdown.
// Click `⋮` → pops up a small menu of actions. Click outside closes.
// Extracted from LotteryBackOffice (May 2026 split).
import React, { useEffect, useRef, useState } from 'react';
import { MoreVertical } from 'lucide-react';

export default function ActionMenu({ items, align = 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <span className="lbo-actmenu" ref={ref}>
      <button
        type="button"
        className="lbo-actmenu-btn"
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
        title="Actions"
      >
        <MoreVertical size={14} />
      </button>
      {open && (
        <div className={`lbo-actmenu-pop lbo-actmenu-pop--${align}`}>
          {items.map((it, i) => it.separator ? (
            <div key={`sep-${i}`} className="lbo-actmenu-sep" />
          ) : (
            <button
              key={it.key || it.label}
              type="button"
              className={`lbo-actmenu-item ${it.danger ? 'danger' : ''}`}
              onClick={() => { setOpen(false); it.onClick?.(); }}
              disabled={it.disabled}
            >
              {it.icon && <it.icon size={13} />}
              <span>{it.label}</span>
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
