// ════════════════════════════════════════════════════════════════════
// Counter Row — one book on the counter. Pack-pill + slot + book +
// yesterday/today tickets + sold/amount + ⋮ action menu.
//
// Today column behavior:
//   • Date = today AND scan-mode → blank (fills on scan)
//   • Date = today AND manual    → prefilled with currentTicket
//   • Date != today              → prefilled with currentTicket (historical)
// Extracted from LotteryBackOffice (May 2026 split).
// ════════════════════════════════════════════════════════════════════
import React, { useState } from 'react';
import { Archive, RotateCcw, Package, Ticket } from 'lucide-react';
import ActionMenu from './ActionMenu.jsx';
import { PackPill } from './shared.jsx';
import { fmtLottery } from './utils.js';

export default function CounterRow({
  box, draft, scanMode, sellDirection, isToday, historicalView,
  openingTicket, currentTicket, selectedDate,
  onDraftChange, onSave,
  onRename, onRenameSlot, onSoldout, onReturn, onMoveToSafe,
}) {
  const total    = Number(box.totalTickets || 0);
  const price    = Number(box.ticketPrice || 0);

  // "Yesterday" = openingTicket from the snapshot (prior day's close OR
  // this book's startTicket if it's the first day). Final fallback to
  // legacy fields preserves old behavior when snapshot data is missing.
  //
  // May 2026 — defensive guard: if box.lastShiftEndTicket is a soldout
  // sentinel (-1 for desc, totalTickets for asc) but the book's status
  // is active, the book was restored from soldout. The restore endpoint
  // clears this for new restores, but historical data may still carry
  // the stale sentinel — skip it so yesterday doesn't show -1 → phantom
  // whole-pack sale on this row.
  const lastEndNum = box.lastShiftEndTicket != null && box.lastShiftEndTicket !== ''
    ? Number(box.lastShiftEndTicket) : null;
  const isStaleSentinel =
    box.status === 'active' &&
    lastEndNum != null &&
    ((sellDirection === 'desc' && lastEndNum === -1) ||
      (sellDirection === 'asc'  && total > 0 && lastEndNum === total));
  const lastShiftEndForFallback = isStaleSentinel ? null : box.lastShiftEndTicket;
  const yesterday = (openingTicket != null && openingTicket !== '')
    ? openingTicket
    : (lastShiftEndForFallback ?? box.startTicket ?? (sellDirection === 'asc' ? '0' : String(Math.max(0, total - 1))));

  // "Today" column behavior:
  //   • today + scan mode           → blank (fills on scan)
  //   • today + manual              → prefilled with live currentTicket
  //   • past date (historicalView)  → prefilled with the day's close
  //                                    snapshot value (currentTicket from
  //                                    the snapshot is that day's close);
  //                                    input is read-only — can't edit the past
  const liveCurrent = currentTicket ?? box.currentTicket ?? '';
  const defaultToday = (isToday && scanMode) ? '' : (liveCurrent ?? '');
  const todayVal = draft !== undefined ? draft : defaultToday;

  const yNum = Number(yesterday);
  const tNum = todayVal === '' ? null : Number(todayVal);
  const sold = tNum != null && Number.isFinite(yNum) && Number.isFinite(tNum) ? Math.abs(yNum - tNum) : 0;
  const amt = sold * price;
  // Dirty when the user has typed something different from the current
  // baseline. For historical views the baseline is the day's close; for
  // today, it's box.currentTicket.
  const baseline = historicalView ? (currentTicket ?? '') : (box.currentTicket ?? '');
  const dirty = draft !== undefined && String(draft) !== String(baseline);
  // Inputs editable in manual mode (any date) OR in scan mode for today.
  // Past-date scan-mode is read-only because scanning into history is
  // confusing; manual mode lets manager correct historical close numbers.
  const inputDisabled = scanMode && historicalView;

  // Activation date — "Activated Apr 18" text below the book number.
  const activatedLabel = box.activatedAt
    ? new Date(box.activatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : null;

  // May 2026 — quick-glance audit chips. Helps the manager spot which
  // books had a state change on the SELECTED calendar date without
  // scrolling through the per-row meta. Compares the box's lifecycle
  // timestamps against the selected date, both formatted in browser
  // local tz (matches store tz in 95%+ of cases).
  const localDayOf = (iso) => {
    if (!iso) return null;
    try { return new Date(iso).toLocaleDateString('en-CA'); } catch { return null; }
  };
  const isActivatedToday = selectedDate && localDayOf(box.activatedAt) === selectedDate;
  const isReceivedToday  = selectedDate && localDayOf(box.createdAt)   === selectedDate;

  // Editable slot number + book number (click to toggle)
  const [editingSlot, setEditingSlot] = useState(false);
  const [slotDraft, setSlotDraft]     = useState(box.slotNumber != null ? String(box.slotNumber) : '');
  const saveSlot = () => {
    const n = slotDraft === '' ? null : Number(slotDraft);
    const curr = box.slotNumber != null ? Number(box.slotNumber) : null;
    if (n !== curr) onRenameSlot?.(n);
    setEditingSlot(false);
  };

  const [editingBookNo, setEditingBookNo] = useState(false);
  const [bookDraft, setBookDraft] = useState(box.boxNumber || '');
  const saveBookNo = () => {
    if (bookDraft !== (box.boxNumber || '')) onRename?.(bookDraft);
    setEditingBookNo(false);
  };

  // Apr 2026 — visual state hierarchy so the cashier can see at a glance
  // which rows are scanned vs not:
  //   • dirty     — user has typed unsaved changes (amber, blocks Save All)
  //   • saved     — today's value is committed (green ✓ marker)
  //                 INCLUDES "0 sold today" so the cashier knows every book
  //                 they've physically counted is accounted for. Without
  //                 this, the row went muted/grey when today === yesterday
  //                 and the cashier couldn't tell scanned-but-no-sales apart
  //                 from never-scanned. Per user direction (May 2026):
  //                 green = "I confirmed this book today, even if 0 sold".
  //   • untouched — nothing entered + no live currentTicket (lighter still)
  const todayNum = Number(todayVal);
  const hasTodayValue = todayVal !== '' && Number.isFinite(todayNum);
  const rowState = dirty
    ? 'dirty'
    : (hasTodayValue ? 'saved' : 'untouched');

  return (
    <div className={`lbo-cnt-row lbo-cnt-row--${rowState} ${dirty ? 'dirty' : ''}`}>
      <PackPill price={price} />
      {editingSlot ? (
        <input
          type="text"
          inputMode="numeric"
          className="lbo-cnt-slot-edit"
          value={slotDraft}
          autoFocus
          onChange={e => setSlotDraft(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))}
          onBlur={saveSlot}
          onKeyDown={e => {
            if (e.key === 'Enter')  saveSlot();
            if (e.key === 'Escape') { setSlotDraft(box.slotNumber != null ? String(box.slotNumber) : ''); setEditingSlot(false); }
          }}
        />
      ) : (
        <span
          className={`lbo-cnt-slot lbo-cnt-slot-click ${box.slotNumber == null ? 'lbo-cnt-slot--unassigned' : ''}`}
          onClick={() => setEditingSlot(true)}
          title={box.slotNumber == null
            ? 'Slot not yet assigned — click to set the machine slot number'
            : 'Click to edit slot number'}
        >
          {box.slotNumber ?? '—'}
        </span>
      )}
      <span className="lbo-cnt-book">
        {editingBookNo ? (
          <input
            type="text"
            className="lbo-cnt-book-edit"
            value={bookDraft}
            autoFocus
            onChange={e => setBookDraft(e.target.value)}
            onBlur={saveBookNo}
            onKeyDown={e => {
              if (e.key === 'Enter')  saveBookNo();
              if (e.key === 'Escape') { setBookDraft(box.boxNumber || ''); setEditingBookNo(false); }
            }}
          />
        ) : (
          <strong
            className="lbo-cnt-bookno"
            onClick={() => !historicalView && setEditingBookNo(true)}
            title={historicalView ? 'Viewing a past date (read-only)' : 'Click to edit book number'}
          >
            {box.game?.gameNumber || '—'}-{box.boxNumber || '—'}
            {/* May 2026 — quick-glance audit chips. Only render when the
                box's lifecycle event matches the selected calendar date. */}
            {isActivatedToday && (
              <span className="lbo-day-chip lbo-day-chip--activated" title="Activated on this date">
                ACT
              </span>
            )}
            {isReceivedToday && !isActivatedToday && (
              <span className="lbo-day-chip lbo-day-chip--received" title="Received on this date">
                NEW
              </span>
            )}
          </strong>
        )}
        <small>
          {box.game?.name || ''}
          {activatedLabel && <span className="lbo-cnt-actdate"> · activated {activatedLabel}</span>}
        </small>
      </span>
      <span className="lbo-cnt-tickets">
        <span className="lbo-cnt-y">{yesterday}</span>
        <span className="lbo-cnt-dash">−</span>
        <input
          type="text"
          inputMode="numeric"
          value={todayVal}
          placeholder={String(yesterday)}
          onChange={e => {
            // May 2026 — accept `-` and `-1` as valid intermediate / final
            // values (the SO sentinel for descending books). Anything else
            // negative (e.g. -2, -10) is rejected at the input. Per user
            // direction: only -1 is a valid negative; deeper negatives
            // would corrupt the carry-over math on next day's snapshot.
            const raw = String(e.target.value ?? '').trim();
            const cleaned =
              raw === '' || raw === '-' || raw === '-1'
                ? raw
                : raw.replace(/[^0-9]/g, '');
            onDraftChange(cleaned);
          }}
          onKeyDown={e => e.key === 'Enter' && onSave()}
          disabled={inputDisabled}
          title={
            inputDisabled
              ? 'Switch to Manual mode to correct historical close ticket'
              : (historicalView ? `Closed at ${todayVal || '—'} on this date — edit to correct` : undefined)
          }
        />
      </span>
      <span className="lbo-cnt-sold">{sold || ''}</span>
      <span className="lbo-cnt-amt">{amt > 0 ? fmtLottery(amt) : ''}</span>
      {/* Action column — always show the menu (Session 45 / L8). Previous
          version hid the menu while the row was `dirty` or historical, so
          the cashier couldn't mark a book sold-out mid-edit. The Save tick
          + HIST pill + status chip are COMPLEMENTARY to the menu, not
          exclusive.

          Status chip (Session 46): when viewing a HISTORICAL counter snapshot,
          a book that's since been depleted/returned still shows on the row
          — the chip + filtered menu items signal "this book has moved, you
          can't act on it from here." Without these, a click on Sold Out
          would 400 with "Cannot soldout from status depleted" (Issue B). */}
      <span className="lbo-cnt-act">
        {dirty && (
          <button onClick={onSave} className="lbo-cnt-save" title={historicalView ? 'Save corrected close' : 'Save'}>✓</button>
        )}
        {historicalView && !dirty && (
          <span className="lbo-cnt-histpill" title="Viewing a past date">HIST</span>
        )}
        {box.status === 'depleted' && (
          <span className="lbo-cnt-statuspill lbo-cnt-statuspill--depleted" title="This book is currently in Soldout">SO</span>
        )}
        {box.status === 'returned' && (
          <span className="lbo-cnt-statuspill lbo-cnt-statuspill--returned" title="This book has been returned to Lottery">RET</span>
        )}
        <ActionMenu
          items={(() => {
            // Hide Sold Out / Return / Move-to-Safe when the book's CURRENT
            // state isn't active/inventory — backend would reject anyway,
            // and showing them invites the "Cannot soldout from status X"
            // error users were hitting.
            const isLive = box.status === 'active' || box.status === 'inventory';
            return [
              ...(isLive ? [
                { key: 'so',     label: 'Mark Sold Out (SO)', icon: Archive,   onClick: onSoldout },
                { key: 'return', label: 'Return to Lottery',  icon: RotateCcw, onClick: onReturn },
                { key: 'safe',   label: 'Move to Safe',       icon: Package,   onClick: onMoveToSafe },
                { separator: true },
              ] : []),
              { key: 'slot',   label: 'Change Slot Number', icon: Ticket,    onClick: () => setEditingSlot(true) },
              { key: 'rename', label: 'Edit Book Number',   icon: Ticket,    onClick: () => setEditingBookNo(true) },
            ];
          })()}
        />
      </span>
    </div>
  );
}
