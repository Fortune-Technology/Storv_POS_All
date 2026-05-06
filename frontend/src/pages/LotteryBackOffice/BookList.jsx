// ════════════════════════════════════════════════════════════════════
// Book List — used on right column for Safe / Soldout / Returned.
// Each row has an action menu appropriate to the list's status.
// Extracted from LotteryBackOffice (May 2026 split).
//
// May 2026 (audit-trail aid) — when `selectedDate` is supplied:
//   • variant='soldout'  → list is FILTERED to books depletedAt on that day
//   • variant='returned' → list is FILTERED to books returnedAt on that day
//   • variant='safe'     → all books shown, but a small "received today"
//                          chip is rendered next to books whose createdAt
//                          falls on the selected date.
// Helps after-the-fact reconciliation: see at a glance what changed today
// without scrolling through historical records.
// ════════════════════════════════════════════════════════════════════
import React from 'react';
import { Play, RotateCcw, Trash2 } from 'lucide-react';
import ActionMenu from './ActionMenu.jsx';
import { PackPill } from './shared.jsx';
import { fmtLottery, fmtDateShort } from './utils.js';

// Format an ISO timestamp as YYYY-MM-DD in the BROWSER's local tz.
// Matches the `date` calendar selection (also browser-local YYYY-MM-DD)
// in 95%+ of cases where the manager is in the same tz as the store.
// `en-CA` produces `YYYY-MM-DD` consistently across browsers.
function localDayOf(iso) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString('en-CA');
  } catch {
    return null;
  }
}

export default function BookList({ books, emptyMsg, variant, onAction, selectedDate }) {
  // Date-filter for soldout + returned: only show books whose
  // depletedAt / returnedAt falls on the selected calendar date. Without
  // this, the lists grow unbounded over time and lose audit signal.
  const filteredBooks = (() => {
    if (!selectedDate) return books;
    if (variant === 'soldout') {
      return books.filter((b) => localDayOf(b.depletedAt) === selectedDate);
    }
    if (variant === 'returned') {
      return books.filter((b) => localDayOf(b.returnedAt) === selectedDate);
    }
    return books;
  })();
  // Sort: Safe groups books by game number ascending so tickets from the
  // same game cluster together (cashiers usually scan them in batches).
  // Soldout/Returned keep newest-first since they're audit-trail views.
  const sorted = [...filteredBooks].sort((a, b) => {
    if (variant === 'safe') {
      const ag = String(a.game?.gameNumber || '').padStart(8, '0');
      const bg = String(b.game?.gameNumber || '').padStart(8, '0');
      if (ag !== bg) return ag < bg ? -1 : 1;
      // Same game → sort by box number ascending
      const an = String(a.boxNumber || '').padStart(8, '0');
      const bn = String(b.boxNumber || '').padStart(8, '0');
      if (an !== bn) return an < bn ? -1 : 1;
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    }
    return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
  });
  const total = sorted.reduce((s, b) => s + Number(b.totalValue || 0), 0);

  const menuFor = (b) => {
    if (variant === 'safe') {
      return [
        { key: 'activate', label: 'Activate on Counter', icon: Play,     onClick: () => onAction?.('activate', b) },
        { key: 'return',   label: 'Return to Lottery',   icon: RotateCcw, onClick: () => onAction?.('return',   b) },
        { separator: true },
        { key: 'delete',   label: 'Delete book',          icon: Trash2,  danger: true, onClick: () => onAction?.('delete',  b) },
      ];
    }
    if (variant === 'soldout') {
      return [
        // Undo soldout — flips back to active, restores currentTicket to
        // its pre-soldout position, neutralises that day's inflated sale.
        // (Session 46 — handles the "I hit Sold Out by mistake" case.)
        { key: 'restore', label: 'Restore to Counter',  icon: Play,      onClick: () => onAction?.('restore', b) },
        { separator: true },
        { key: 'return',  label: 'Return to Lottery',   icon: RotateCcw, onClick: () => onAction?.('return',  b) },
        { separator: true },
        // Apr 2026 — Delete option for cases where the book was a complete
        // mistake (test data, duplicate, wrong receive). Different from
        // Restore (which keeps the book and undoes the SO event); Delete
        // removes the entire book record with its full audit history.
        { key: 'delete',  label: 'Delete book',         icon: Trash2,    danger: true, onClick: () => onAction?.('delete', b) },
      ];
    }
    if (variant === 'returned') {
      // Apr 2026 — undo a return (parity with soldout restore). Same backend
      // endpoint handles both depleted and returned. Writes a correction
      // snapshot to neutralise the return's day-sales contribution.
      return [
        { key: 'restore', label: 'Restore to Counter',  icon: Play,    onClick: () => onAction?.('restore', b) },
        { separator: true },
        { key: 'delete',  label: 'Delete book',         icon: Trash2,  danger: true, onClick: () => onAction?.('delete', b) },
      ];
    }
    return [];
  };

  return (
    <div className="lbo-right-list">
      {sorted.length === 0 ? (
        <div className="lbo-empty">{emptyMsg}</div>
      ) : (
        <>
          <div className="lbo-right-total">
            Total <strong>{fmtLottery(total)}</strong>
          </div>
          {sorted.map(b => {
            const menu = menuFor(b);
            // May 2026 — small "today" chip on the date column. Helps the
            // manager spot at-a-glance which books were received / returned
            // / depleted on the SELECTED calendar date. Only Safe variant
            // gets this since soldout/returned lists are already filtered.
            const isReceivedToday =
              variant === 'safe' && selectedDate && localDayOf(b.createdAt) === selectedDate;
            return (
              <div key={b.id} className="lbo-right-row">
                <PackPill price={Number(b.ticketPrice || 0)} />
                {/* Game # badge — ALWAYS visible. Pinpoints the game for
                    safe management. (Session 45 / L3) */}
                <span className="lbo-right-game-no">
                  #{b.game?.gameNumber || '—'}
                </span>
                <span className="lbo-right-book">
                  <strong>Book {b.boxNumber || '—'}</strong>
                  <small>{b.game?.name || '—'}</small>
                </span>
                <span className="lbo-right-date">
                  {fmtDateShort(b.createdAt)}
                  {isReceivedToday && (
                    <span
                      className="lbo-day-chip lbo-day-chip--received"
                      title="Received today"
                    >
                      NEW
                    </span>
                  )}
                </span>
                <span className="lbo-right-amt">{fmtLottery(b.totalValue)}</span>
                {menu.length > 0 ? <ActionMenu items={menu} /> : <span />}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
