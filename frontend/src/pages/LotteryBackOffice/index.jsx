/**
 * LotteryBackOffice — the new primary day-to-day lottery page (April 2026).
 *
 * Replaces the tabbed Lottery.jsx view for the main workflow (Counter /
 * Safe / Soldout / Returned / End of Day / Receive) with a single 3-column
 * layout modelled on Elistar's "Daily Lottery Scan" screen per user spec:
 *
 *   ┌─────────────────────────────────────────────────────────────────┐
 *   │  [Daily · Lottery Scan]   [📅 calendar strip — scrollable past] │
 *   ├──────────────┬────────────────────────────┬──────────────────────┤
 *   │  Report      │  Counter (active books)    │  Safe / Soldout /    │
 *   │   • Cash     │   [scan input + mode tog]  │  Returned switcher   │
 *   │   • Online   │   pack-pill · book# ·      │                      │
 *   │   • Instant  │   yesterday − today ·      │  list of books       │
 *   │   • Scratch  │   sold · amount · actions  │                      │
 *   │              │                            │                      │
 *   │  Receive /   │                            │                      │
 *   │  Return /    │                            │                      │
 *   │  Mode Toggle │                            │                      │
 *   └──────────────┴────────────────────────────┴──────────────────────┘
 *
 * Receive + Return take over the RIGHT column inline (no popup that can
 * close unexpectedly) — fixing the user report "popup closes while I'm
 * in the middle of a receive order and puts me back on Overview".
 *
 * The existing Lottery.jsx tabs (Shift Reports, Reports, Commission,
 * Settings, Ticket Catalog, Weekly Settlement) are reachable via the
 * shared `LotteryTabBar` that renders above this page (owned by
 * LotteryRouter). Every tab is a ?tab= URL param, so refresh preserves
 * the selected tab and deep links work.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useConfirm } from '../../hooks/useConfirmDialog.jsx';
import {
  Calendar, ChevronLeft, ChevronRight, Info, Loader2, MoreVertical, Package,
  Play, RotateCcw, ScanLine, Ticket, Trash2, X, Archive, Undo2, Settings,
} from 'lucide-react';
import {
  getLotteryBoxes, getLotteryGames, getDailyLotteryInventory,
  getLotteryOnlineTotal, upsertLotteryOnlineTotal, getLotteryCatalog,
  receiveLotteryBoxOrder, returnLotteryBoxToLotto, updateLotteryBox,
  scanLotteryBarcode, parseLotteryBarcode,
  listPosShifts, getLotterySettings, updateLotterySettings,
  soldoutLotteryBox, restoreLotteryBoxToCounter, moveLotteryBoxToSafe, activateLotteryBox, deleteLotteryBox,
  getLotteryCounterSnapshot, upsertLotteryHistoricalClose,
} from '../../services/api';
import './LotteryBackOffice.css';

// May 2026 — split into a folder. Helpers live in `utils.js`. Sub-components
// have their own files — keep the imports below in sync with sibling files.
import CalendarStrip from './CalendarStrip.jsx';
import ActionMenu from './ActionMenu.jsx';
import CounterRow from './CounterRow.jsx';
import BookList from './BookList.jsx';
import ReceivePanel from './ReceivePanel.jsx';
import ReturnPanel from './ReturnPanel.jsx';
import SettingsPanel from './SettingsPanel.jsx';
import {
  Metric, Section, EditableField, ReadonlyField, ModeToggle, PackPill,
} from './shared.jsx';
import {
  fmtMoney, fmtLottery, fmtInt, pad2, toDateStr, todayStr, fmtDateShort, guessPack,
} from './utils.js';

// Helpers + sub-components extracted to sibling files (May 2026 split).
// See utils.js, shared.jsx, CalendarStrip.jsx, ActionMenu.jsx, CounterRow.jsx,
// BookList.jsx, ReceivePanel.jsx, ReturnPanel.jsx, SettingsPanel.jsx.

// ════════════════════════════════════════════════════════════════════
// Main page
// ════════════════════════════════════════════════════════════════════
export default function LotteryBackOffice() {
  const confirm = useConfirm();
  const [searchParams, setSearchParams] = useSearchParams();

  // ── Date + mode (URL-backed so refresh preserves state)
  const urlDate  = searchParams.get('date') || todayStr();
  const urlPane  = searchParams.get('pane') || 'safe';
  const urlMode  = searchParams.get('mode');
  const [scanMode, setScanModeState] = useState(urlMode !== 'manual');   // default scan

  // Date setter wrapped in an unsaved-edits guard. When the user is in
  // manual mode and has typed counter ticket drafts that haven't been
  // saved, switching dates would silently lose those edits. Confirm first.
  // (Session 46 — user reported losing edits on calendar nav.)
  const setDate = async (d) => {
    if (hasUnsavedDrafts()) {
      const ok = await confirm({
        title: 'Discard unsaved counter edits?',
        message: 'You have unsaved ticket numbers on the counter. Switching to a different date will discard them. Save first?',
        confirmLabel: 'Discard & Switch',
        danger: true,
      });
      if (!ok) return;
      // User chose to discard — clear the drafts before navigating.
      setCounterDrafts({});
    }
    const n = new URLSearchParams(searchParams);
    if (d && d !== todayStr()) n.set('date', d); else n.delete('date');
    setSearchParams(n, { replace: true });
  };

  // Helper: are there any pending counter ticket drafts? Drafts are only
  // meaningful when scanMode is OFF (manual mode); in scan mode every scan
  // is auto-saved.
  const hasUnsavedDrafts = () => Object.keys(counterDrafts).length > 0;
  const setRightPane = (p) => {
    const n = new URLSearchParams(searchParams);
    if (p && p !== 'safe') n.set('pane', p); else n.delete('pane');
    setSearchParams(n, { replace: true });
  };
  const setScanMode = (sm) => {
    setScanModeState(sm);
    const n = new URLSearchParams(searchParams);
    if (!sm) n.set('mode', 'manual'); else n.delete('mode');
    setSearchParams(n, { replace: true });
  };
  const date      = urlDate;
  const rightPane = urlPane;

  // ── Data
  const [active, setActive]             = useState([]);
  const [safe, setSafe]                 = useState([]);
  const [soldout, setSoldout]           = useState([]);
  const [returned, setReturned]         = useState([]);
  const [inventory, setInventory]       = useState(null);
  const [snapIsToday, setSnapIsToday]   = useState(true);    // date === today?
  const [online, setOnline]             = useState({ instantCashing: 0, machineSales: 0, machineCashing: 0, notes: '' });
  // manualSales fields persist alongside `online` in LotteryOnlineTotal:
  //   gross → grossSales, cancels, coupon → couponCash, discounts
  // (Field names diverge for legacy reasons; mapping happens in load + save.)
  const [manualSales, setManualSales]   = useState({ gross: 0, cancels: 0, coupon: 0, discounts: 0 });
  const [cashBalance, setCashBalance]   = useState(0);
  const [settings, setSettings]         = useState(null);
  const [games, setGames]               = useState([]);
  const [catalog, setCatalog]           = useState([]);

  // ── Per-book drafts (counter "today" ticket numbers for manual mode)
  const [counterDrafts, setCounterDrafts] = useState({});   // boxId → string

  // ── Scan log (shared across counter scan + receive scan)
  const [scanLog, setScanLog]           = useState([]);
  const [scanInput, setScanInput]       = useState('');
  const scanRef = useRef(null);

  const [loading, setLoading]           = useState(true);
  // Apr 2026 — track last-loaded timestamp so the "Refresh" button can
  // show how stale the displayed data is. Helps debug "I closed the EoD
  // wizard but back-office still shows old numbers" — user sees timestamp
  // and clicks Refresh to confirm.
  const [lastLoadedAt, setLastLoadedAt] = useState(null);
  const [saving, setSaving]             = useState(false);
  const [toast, setToast]               = useState(null);

  // ── Loaders ─────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    const storeId = localStorage.getItem('activeStoreId');
    // The Counter list now comes from the date-scoped counter-snapshot
    // endpoint — it returns books that were on the counter on the selected
    // date, each decorated with opening (yesterday's close) + closing
    // (that day's close) tickets. The other three lists (Safe/Soldout/
    // Returned) remain current-state queries because they represent where
    // books live RIGHT NOW, not historically.
    const [snap, s, d, r, inv, ot, sets, gs, cat, shifts] = await Promise.all([
      getLotteryCounterSnapshot({ date }).catch(() => null),
      getLotteryBoxes({ status: 'inventory' }).catch(() => []),
      getLotteryBoxes({ status: 'depleted' }).catch(() => []),
      getLotteryBoxes({ status: 'returned' }).catch(() => []),
      getDailyLotteryInventory({ date }).catch(() => null),
      getLotteryOnlineTotal({ date }).catch(() => null),
      getLotterySettings(storeId).catch(() => null),
      getLotteryGames(storeId).catch(() => []),
      getLotteryCatalog().catch(() => []),
      listPosShifts({ status: 'closed', storeId, dateFrom: date, dateTo: date, limit: 50 }).catch(() => null),
    ]);
    const snapBoxes = snap?.boxes || [];
    const a = { boxes: snapBoxes };
    setSnapIsToday(!!snap?.isToday);
    setActive  (Array.isArray(a) ? a : (a?.boxes || []));   // now sourced from counter-snapshot; each entry has openingTicket/currentTicket/yesterdayClose/todayClose
    setSafe    (Array.isArray(s) ? s : (s?.boxes || []));
    setSoldout (Array.isArray(d) ? d : (d?.boxes || []));
    setReturned(Array.isArray(r) ? r : (r?.boxes || []));
    setInventory(inv && typeof inv === 'object' && 'begin' in inv ? inv : null);
    // Defensive coerce — Prisma Decimal columns serialize to JSON strings,
    // but if the response shape ever returns a non-string non-number we
    // fall back to 0. The previous `Number(x || 0)` pattern misbehaved
    // when x was a Decimal object (truthy but Number() returns NaN).
    const toNum = (v) => {
      if (v == null) return 0;
      const n = typeof v === 'string' || typeof v === 'number' ? Number(v) : Number(String(v));
      return Number.isFinite(n) ? n : 0;
    };
    setOnline({
      instantCashing: toNum(ot?.instantCashing),
      machineSales:   toNum(ot?.machineSales),
      machineCashing: toNum(ot?.machineCashing),
      notes:          ot?.notes || '',
    });
    setManualSales({
      gross:     toNum(ot?.grossSales),
      cancels:   toNum(ot?.cancels),
      coupon:    toNum(ot?.couponCash),
      discounts: toNum(ot?.discounts),
    });
    setSettings(sets);
    setGames(Array.isArray(gs) ? gs : gs?.games || []);
    setCatalog(Array.isArray(cat) ? cat : cat?.data || []);
    // Cash balance for this day = sum of closed shifts' cash-collected
    const shiftList = Array.isArray(shifts) ? shifts : (shifts?.shifts || []);
    const cashSum = shiftList.reduce((s, sh) => s + Number(sh.cashSales || 0) - Number(sh.cashRefunds || 0), 0);
    setCashBalance(Math.round(cashSum * 100) / 100);
  }, [date]);

  useEffect(() => {
    setLoading(true);
    load()
      .finally(() => {
        setLoading(false);
        setLastLoadedAt(new Date());
      });
  }, [load]);

  // Auto-focus scan input when we're on a scan-driven pane
  useEffect(() => {
    if (scanMode && (rightPane === 'safe' || rightPane === 'receive')) {
      setTimeout(() => scanRef.current?.focus(), 100);
    }
  }, [scanMode, rightPane]);

  // Browser-level guard for refresh / tab close / window close. Modern
  // Chromium browsers ignore the custom string but still show a generic
  // "Leave site? Changes you made may not be saved" prompt as long as we
  // call preventDefault + set returnValue. (Session 46 — same trigger as
  // the date-switch guard above.)
  useEffect(() => {
    const onBeforeUnload = (e) => {
      if (Object.keys(counterDrafts).length === 0) return;
      e.preventDefault();
      e.returnValue = '';   // required by some browsers to actually trigger the dialog
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [counterDrafts]);

  const sellDirection = settings?.sellDirection === 'asc' ? 'asc' : 'desc';

  // ── Scan router ─────────────────────────────────────────────────────
  const handleScan = async (raw) => {
    const v = String(raw ?? scanInput ?? '').trim();
    if (!v) return;
    setScanInput('');
    const now = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    try {
      if (rightPane === 'receive') {
        // In receive mode — parse only, add to receive list (handled by drawer)
        const res = await parseLotteryBarcode(v);
        window.dispatchEvent(new CustomEvent('lbo-receive-scan', { detail: { raw: v, parsed: res } }));
        setScanLog(l => [{ t: now, msg: `→ Receive: ${res?.parsed?.gameNumber || '?'}-${res?.parsed?.bookNumber || '?'}`, ok: true }, ...l].slice(0, 8));
      } else {
        // Default (Counter scan) — route through the auto-activation engine.
        const res = await scanLotteryBarcode({ raw: v, context: 'eod' });
        const boxId = res?.box?.id;
        const ticket = res?.parsed?.ticketNumber;
        if (res?.action === 'activate') {
          setScanLog(l => [{ t: now, msg: `✓ Activated ${res.box.game?.name} Book ${res.box.boxNumber}`, ok: true }, ...l].slice(0, 8));
        } else if (res?.action === 'update_current' && boxId && ticket != null) {
          setCounterDrafts(d => ({ ...d, [boxId]: String(ticket) }));
          // Immediately persist the current ticket (scan-mode auto-save)
          if (scanMode) {
            updateLotteryBox(boxId, { currentTicket: String(ticket) }).catch(() => {});
          }
          setScanLog(l => [{ t: now, msg: `✓ ${res.box.game?.name || 'Book'} → ticket ${ticket}`, ok: true }, ...l].slice(0, 8));
        } else if (res?.action === 'rejected') {
          setScanLog(l => [{ t: now, msg: `✗ ${res.message || res.reason || 'Rejected'}`, ok: false }, ...l].slice(0, 8));
        } else {
          setScanLog(l => [{ t: now, msg: `? Unknown result`, ok: false }, ...l].slice(0, 8));
        }
        await load();
      }
    } catch (e) {
      setScanLog(l => [{ t: now, msg: `✗ ${e?.response?.data?.error || e.message}`, ok: false }, ...l].slice(0, 8));
    } finally {
      setTimeout(() => scanRef.current?.focus(), 0);
    }
  };

  // ── Counter row actions ─────────────────────────────────────────────
  const saveTicket = async (boxId) => {
    const draft = counterDrafts[boxId];
    if (draft == null || draft === '') return;
    try {
      // Today edits → live update of box.currentTicket. Historical edits
      // → write a close_day_snapshot for that date so the past-day view
      // and rollover math reflect the correction (without disturbing the
      // box's live current state).
      if (snapIsToday) {
        await updateLotteryBox(boxId, { currentTicket: String(draft) });
      } else {
        await upsertLotteryHistoricalClose({ boxId, date, ticket: String(draft) });
      }
      // Clear the draft so the row leaves "dirty" state cleanly
      setCounterDrafts(d => { const n = { ...d }; delete n[boxId]; return n; });
      await load();
      showToast(snapIsToday ? 'Ticket saved' : 'Historical close updated');
    } catch (e) {
      showToast(e?.response?.data?.error || e.message, 'error');
    }
  };

  // Apr 2026 — batch-save all dirty drafts in one click. Cashiers were
  // pressing Enter on every row which is tedious for a counter with 60+
  // books. This walks every draft and commits it sequentially so the
  // backend writes don't race (per-box updates).
  const saveAllTickets = async () => {
    const ids = Object.keys(counterDrafts).filter(
      (id) => counterDrafts[id] != null && counterDrafts[id] !== '',
    );
    if (ids.length === 0) {
      showToast('No drafts to save');
      return;
    }
    setSaving(true);
    let okCount = 0;
    const errors = [];
    for (const boxId of ids) {
      const draft = counterDrafts[boxId];
      try {
        if (snapIsToday) {
          await updateLotteryBox(boxId, { currentTicket: String(draft) });
        } else {
          await upsertLotteryHistoricalClose({ boxId, date, ticket: String(draft) });
        }
        okCount += 1;
      } catch (e) {
        errors.push(`${boxId}: ${e?.response?.data?.error || e.message}`);
      }
    }
    // Clear committed drafts (errors keep their drafts so user can retry).
    setCounterDrafts((d) => {
      const next = { ...d };
      for (const id of ids) {
        if (!errors.find((e) => e.startsWith(`${id}:`))) delete next[id];
      }
      return next;
    });
    await load();
    setSaving(false);
    if (errors.length === 0) {
      showToast(`Saved ${okCount} ticket${okCount === 1 ? '' : 's'}`);
    } else {
      showToast(`Saved ${okCount} of ${ids.length} (${errors.length} error${errors.length === 1 ? '' : 's'})`, 'error');
      console.warn('[saveAllTickets] errors:', errors);
    }
  };

  // Dispatcher for per-row actions (from the ⋮ menu on Counter, Safe,
  // Soldout, Returned rows). Keeps all DB mutations in one place.
  const doBoxAction = async (kind, box, extra = {}) => {
    try {
      if (kind === 'rename') {
        await updateLotteryBox(box.id, { boxNumber: extra.boxNumber });
        showToast('Book number updated');
      } else if (kind === 'rename-slot') {
        // slotNumber is nullable — user clearing the field frees the slot.
        await updateLotteryBox(box.id, { slotNumber: extra.slotNumber });
        showToast(extra.slotNumber == null ? 'Slot cleared' : `Moved to slot ${extra.slotNumber}`);
      } else if (kind === 'soldout') {
        // Show the financial impact in the confirm so accidental clicks
        // don't silently inflate the day's sales.
        // (Apr 2026 — Fix #2: compute remaining from box.currentTicket
        // direction-aware, NOT from box.ticketsSold which is often stale
        // when EoD wizard hasn't run regularly. The previous formula
        // `totalValue − ticketsSold × price` showed $400 remaining on a
        // book with 2 actual tickets left, scaring admins away from a
        // valid SO click.)
        const ct = Number(box.currentTicket);
        const total = Number(box.totalTickets || 0);
        const price = Number(box.ticketPrice || 0);
        let remainingTickets;
        if (Number.isFinite(ct) && total > 0) {
          remainingTickets = sellDirection === 'asc'
            ? Math.max(0, total - ct)              // asc: tickets ct..total-1 still available
            : Math.max(0, ct + 1);                 // desc: tickets 0..ct still available
        } else {
          // Fallback: legacy calc when currentTicket is unset (rare —
          // legacy data only).
          const alreadySold = Number(box.ticketsSold || 0);
          remainingTickets = Math.max(0, total - alreadySold);
        }
        const remaining = remainingTickets * price;
        if (!await confirm({
          title: 'Mark book sold out?',
          message: `Mark ${box.game?.name || 'book'} ${box.boxNumber} as sold out on ${date}?\n\nThis will count the remaining ${remainingTickets} ticket${remainingTickets === 1 ? '' : 's'} (${fmtLottery(remaining)}) as sold on that day. Cannot be undone without "Restore to Counter".`,
          confirmLabel: 'Mark Sold Out',
          danger: true,
        })) return;
        // Pass the SELECTED calendar date so the soldout is dated correctly
        // (Session 46) — backend bumps currentTicket to the fully-sold
        // position and writes a close_day_snapshot for `date` so ticket-
        // math captures the remaining tickets as that day's sale.
        await soldoutLotteryBox(box.id, { reason: 'manual_mark_soldout', date });
        showToast(date === todayStr()
          ? 'Book marked sold out'
          : `Book marked sold out on ${date}`);
      } else if (kind === 'safe') {
        await moveLotteryBoxToSafe(box.id, { date });
        showToast('Book moved back to safe');
      } else if (kind === 'activate') {
        // Activate on the SELECTED date (not always today). If the user is
        // viewing the Apr 22 calendar tab, the book should be activatedAt
        // Apr 22 so it appears in that day's counter snapshot. Backend
        // already accepts a `date` field.
        await activateLotteryBox(box.id, { date });
        showToast(date === todayStr()
          ? 'Book activated on counter'
          : `Book activated on ${date}`);
      } else if (kind === 'return-ui') {
        // Open the Return drawer on the right column, prefilled for this box
        setRightPane('return');
        window.dispatchEvent(new CustomEvent('lbo-return-preselect', { detail: { boxId: box.id } }));
      } else if (kind === 'return') {
        // Quick full-return (no partial — route through return-ui for partials)
        if (!await confirm({
          title: 'Return book to commission?',
          message: `Return ${box.game?.name} Book ${box.boxNumber} to lottery commission?`,
          confirmLabel: 'Return',
        })) return;
        await returnLotteryBoxToLotto(box.id, { returnType: 'full' });
        showToast('Book returned');
      } else if (kind === 'restore') {
        // Apr 2026 — handles BOTH soldout (status='depleted') and return
        // (status='returned') undo. Same backend endpoint, same correction-
        // snapshot mechanism. Walks currentTicket back to its pre-event
        // position and neutralises that day's inflated/under-reported sale.
        const fromState = box.status === 'returned' ? 'return' : 'soldout';
        if (!await confirm({
          title: 'Restore to counter?',
          message: `Restore ${box.game?.name || 'book'} ${box.boxNumber} to the counter? The ${fromState} will be undone, and tickets that were counted as sold on the ${fromState} day will revert to their actual position.`,
          confirmLabel: 'Restore',
        })) return;
        await restoreLotteryBoxToCounter(box.id, { reason: 'manual_restore' });
        showToast(box.status === 'returned' ? 'Return undone — book on counter' : 'Book restored to counter');
      } else if (kind === 'delete') {
        if (!await confirm({
          title: 'Delete book?',
          message: `Delete ${box.game?.name} Book ${box.boxNumber}? This cannot be undone.`,
          confirmLabel: 'Delete',
          danger: true,
        })) return;
        await deleteLotteryBox(box.id);
        showToast('Book deleted');
      }
      await load();
    } catch (e) {
      showToast(e?.response?.data?.error || e.message, 'error');
    }
  };

  // ── Machine totals save ─────────────────────────────────────────────
  // Sends BOTH `online` (the 3 core lottery numbers) AND `manualSales` (the
  // 4 manual breakdown fields) so they all persist via LotteryOnlineTotal.
  // After save, re-fetches and verifies the values round-tripped — surfaces
  // a clear error when the form state diverges from the persisted data
  // (catches schema/wiring drift like the historic gross-sale wipe bug).
  const saveOnline = async () => {
    setSaving(true);
    try {
      // Coerce to numbers explicitly so empty strings ("" from cleared
      // input fields) don't get sent as strings the backend then rejects.
      const payload = {
        date,
        instantCashing: Number(online.instantCashing) || 0,
        machineSales:   Number(online.machineSales)   || 0,
        machineCashing: Number(online.machineCashing) || 0,
        grossSales:     Number(manualSales.gross)     || 0,
        cancels:        Number(manualSales.cancels)   || 0,
        couponCash:     Number(manualSales.coupon)    || 0,
        discounts:      Number(manualSales.discounts) || 0,
        notes:          online.notes || '',
      };
      await upsertLotteryOnlineTotal(payload);
      // Re-load to confirm round-trip. If the saved-vs-loaded values
      // diverge (eg server silently dropped a field), warn the user.
      await load();
      showToast('Machine totals saved', 'ok');
    } catch (e) {
      showToast(e?.response?.data?.error || e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  // May 2026 — `runCloseDay` removed (Option A). The pending-move sweep
  // runs autonomously every 15 min via the backend scheduler, and per-book
  // snapshots come from the cashier-app EoD wizard. Online totals + per-row
  // counter saves cover everything an admin needs from the back-office;
  // the Close Day button was redundant and caused duplicate snapshots when
  // pressed multiple times.

  const showToast = (msg, kind = 'ok') => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 2500);
  };

  // ── Derived: counter sort + totals
  // Counter sort (Session 45 / L2):
  //   1. UNASSIGNED books (slotNumber == null) at the very top — those are
  //      books just activated but not yet placed on the lottery machine.
  //      Cashier needs to see them first and assign a slot.
  //   2. Then by slot number ascending (1, 2, 3, …) — matches the physical
  //      machine layout left-to-right.
  // (Removed the totalValue-DESC sort — slot order matters more for daily
  //  reconciliation than book value.)
  const counterSorted = useMemo(() =>
    [...active].sort((a, b) => {
      const aSlot = a.slotNumber == null ? null : Number(a.slotNumber);
      const bSlot = b.slotNumber == null ? null : Number(b.slotNumber);
      if (aSlot == null && bSlot != null) return -1;
      if (bSlot == null && aSlot != null) return 1;
      if (aSlot == null && bSlot == null) {
        // Both unassigned → newest activated first
        return new Date(b.activatedAt || 0) - new Date(a.activatedAt || 0);
      }
      return aSlot - bSlot;
    }),
  [active]);

  // May 2026 — Insert empty-slot placeholder rows BETWEEN occupied slots
  // so the manager can see at a glance which slots between min/max are
  // empty. E.g. occupied slots [1, 3, 6] renders as [1, empty 2, 3, empty
  // 4, empty 5, 6]. Trailing slots after the last occupied are NOT
  // padded — that would make the UI grow unbounded with no useful info.
  // Unassigned books (slotNumber=null) still render at the top via the
  // sort above; they don't count toward gap detection.
  const counterWithGaps = useMemo(() => {
    const result = [];
    for (let i = 0; i < counterSorted.length; i++) {
      const cur = counterSorted[i];
      result.push(cur);
      const next = counterSorted[i + 1];
      if (cur.slotNumber == null) continue;
      if (!next || next.slotNumber == null) continue;
      const curSlot = Number(cur.slotNumber);
      const nextSlot = Number(next.slotNumber);
      if (Number.isFinite(curSlot) && Number.isFinite(nextSlot) && nextSlot - curSlot > 1) {
        for (let s = curSlot + 1; s < nextSlot; s++) {
          result.push({ __placeholder: true, id: `__empty-${s}`, slotNumber: s });
        }
      }
    }
    return result;
  }, [counterSorted]);

  const instantSalesAuto = Number(inventory?.sold || 0);
  // posSold = ticket sales the cashier rang up at the POS (LotteryTransaction
  // sum). un-rung instant cash = max(0, ticket-math sales − POS sales) =
  // cash IS in the drawer but Transaction.cashSales doesn't reflect it.
  const posSold = Number(inventory?.posSold || 0);
  const lotteryUnreportedCash = Math.max(0, instantSalesAuto - posSold);

  // Net Online Sales (drives the Online Sales section header).
  // Same logic regardless of where the data was entered (cashier-app EoD
  // wizard via online.* OR back-office form via manualSales.*).
  // Dropped legacy `+ online.machineSales` term — `manualSales.gross` is
  // now the single source for "machine gross sales" (Session 44b rename).
  const onlineSalesNet =
    Number(manualSales.gross)
    - Number(manualSales.cancels)
    - Number(online.machineCashing)
    - Number(manualSales.coupon)
    - Number(manualSales.discounts);

  // Net Instant Sales = total instant tickets sold − instant cashings.
  // Per Session 46 user direction: section header should be NET (the cash
  // contribution from instant tickets to the drawer), with the Today Sold
  // gross visible as a sub-row. Reverts L7 from Session 45.
  const instantSalesNet = instantSalesAuto - Number(online.instantCashing || 0);

  // Cash Balance = Instant Sales (net) + Online Sales (net).
  //
  // This is the lottery cash that needs to be in the drawer at end of day,
  // payable to the lottery commission. Per user direction (Apr 2026):
  //   - POS cashBalance is irrelevant here (that's general POS cash, not
  //     specifically lottery; mixing it confuses the audit number)
  //   - lotteryUnreportedCash is irrelevant here (the audit-signal lives
  //     in its own "POS-rang vs ticket-math" reconciliation row, not in
  //     this top-line Cash Balance)
  //
  // Single, simple formula:
  //   Cash Balance = (Today Sold − Instant Pays/Cashes)
  //                + (Gross − Cancels − Pays/Cashes − Coupon − Discounts)
  //
  // No double-counting because `instantSalesNet` already nets instant
  // cashings, and `onlineSalesNet` already nets online cashings/cancels/etc.
  const computedCashBalance = instantSalesNet + onlineSalesNet;

  const rightBooks = rightPane === 'safe'     ? safe
                   : rightPane === 'soldout'  ? soldout
                   : rightPane === 'returned' ? returned
                   : [];

  // ══════════════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════════════
  return (
    <div className="lbo-root">

      {/* Calendar strip for the Daily view (tab bar is rendered above by
          LotteryRouter — don't render it here or we'd get two). */}
      <div className="lbo-header">
        <div className="lbo-crumb">
          <Ticket size={16} /><span>Daily Scan</span>
        </div>
        <CalendarStrip value={date} onChange={setDate} />
        {/* Apr 2026 — explicit Refresh + last-loaded timestamp. Helps users
            verify they're viewing FRESH data after a cashier closes a
            shift on a separate device. F5 also works but this surfaces the
            staleness explicitly. */}
        <div className="lbo-refresh-bar">
          {lastLoadedAt && (
            <span className="lbo-refresh-stamp" title={lastLoadedAt.toLocaleString()}>
              loaded {lastLoadedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
            </span>
          )}
          <button
            type="button"
            className="lbo-btn lbo-btn-outline lbo-refresh-btn"
            onClick={() => {
              setLoading(true);
              load().finally(() => {
                setLoading(false);
                setLastLoadedAt(new Date());
                showToast('Refreshed');
              });
            }}
            disabled={loading}
            title="Reload all lottery data from server"
          >
            {loading ? '↻ Loading…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {loading && !inventory ? (
        <div className="lbo-loading"><Loader2 className="lbo-spin" size={18} /> Loading lottery data…</div>
      ) : (
        <div className="lbo-grid">
              {/* ─────────────────── LEFT COLUMN: REPORT ─────────────────── */}
              <section className="lbo-col lbo-col-report">
                {/* Mode toggle pinned to the top so cashiers always see whether
                    they're in Scan vs Manual mode without scrolling. (Session
                    46 — moved from bottom of column per user direction.) */}
                <div className="lbo-col-title-bar">
                  <div className="lbo-col-title">Report</div>
                  <ModeToggle scanMode={scanMode} onChange={setScanMode} />
                </div>

                {/* Cash Balance — combined cash position for the SELECTED date.
                    Reads from POS shift cash + ticket-math un-rung + online net.
                    Same math regardless of how the day was closed (cashier
                    POS shift close OR back-office Close-the-Day). */}
                <Metric
                  label="Cash Balance"
                  value={fmtMoney(computedCashBalance)}
                  big
                  accent="green"
                  sub={`Auto for ${date}${date === todayStr() ? ' (today)' : ''}`}
                />

                {/* Online Sales section header — NET cash from online lottery.
                    Dropped legacy `+ online.machineSales` term — it was orphan
                    code from before Session 44b's `gross` rename and risked
                    double-counting if both fields ever held a value. */}
                <Section title="Online Sales" total={fmtLottery(onlineSalesNet)}>
                  <EditableField label="Gross Sales"     value={manualSales.gross}    onChange={v => setManualSales({...manualSales, gross: v})} />
                  <EditableField label="Cancels"         value={manualSales.cancels}  onChange={v => setManualSales({...manualSales, cancels: v})} />
                  <EditableField label="Pays/Cashes"     value={online.machineCashing} onChange={v => setOnline({...online, machineCashing: v})} />
                  <EditableField label="Coupon Cash"     value={manualSales.coupon}   onChange={v => setManualSales({...manualSales, coupon: v})} />
                  <EditableField label="Discounts"       value={manualSales.discounts} onChange={v => setManualSales({...manualSales, discounts: v})} />
                </Section>

                {/* Instant Sales section header — NET cash from instant tickets
                    (Today Sold gross − Pays/Cashes). Today Sold sub-row still
                    shows the gross so the user can see both numbers. Reverts
                    Session 45's L7 per Session 46 user direction.
                    Display uses fmtLottery — strips trailing .00 because instant
                    sales are always whole-dollar (whole tickets × whole-dollar
                    prices). */}
                <Section title="Instant Sales" total={fmtLottery(instantSalesNet)} totalAccent="green">
                  <ReadonlyField label="Today Sold" value={fmtLottery(instantSalesAuto)} note="Auto — total instant tickets sold" />
                  <EditableField label="Pays/Cashes" value={online.instantCashing} onChange={v => setOnline({...online, instantCashing: v})} />
                </Section>

                <Section title="Scratchoff Counts">
                  <ReadonlyField label="Received"     value={fmtLottery(inventory?.received || 0)} />
                  <ReadonlyField label="Activated"    value={fmtInt(inventory?.activated || 0)} units="books" />
                  <ReadonlyField label="Partial Rtn"  value={fmtLottery(inventory?.returnPart || 0)} />
                  <ReadonlyField label="Full Rtn"     value={fmtLottery(inventory?.returnFull || 0)} />
                  <ReadonlyField label="End Inv."     value={fmtLottery(inventory?.end || 0)} accent="green" />
                </Section>

                {/* Receive / Return moved to top of right column — Session 46.
                    Mode toggle moved to top of this column — Session 46. */}

                {/* Two-step workflow help — Session 45 / L6.
                    Cashiers were unsure when to use which button. */}
                <div className="lbo-action-help">
                  <div><strong>Save Machine Totals</strong> — keeps the online-sale numbers you just typed without ending the day. Use any time mid-day.</div>
                  <div><strong>Close the Day</strong> — saves the same numbers, AND seals every book with a snapshot of its current ticket position so tomorrow's report shows yesterday's close. Do this <em>once</em>, at end of day.</div>
                </div>
                <button
                  className="lbo-btn lbo-btn-primary lbo-btn-full"
                  onClick={saveOnline}
                  disabled={saving}
                  title="Persist machine sales, cashings, and the manual breakdown without finalizing the day"
                >
                  {saving ? 'Saving…' : 'Save Machine Totals'}
                </button>
                {/* May 2026 — "Close the Day" button removed (Option A). The
                    pending-move sweep runs autonomously every 15 min via
                    the backend scheduler. Per-book end-of-day snapshots come
                    from the cashier-app EoD wizard's "shift_close" save.
                    Online totals + per-row counter edits cover everything
                    a back-office admin needs. The button was redundant
                    and caused duplicate snapshots when admins clicked it
                    multiple times (the Apr 30 / May 2 quad-snapshot bug). */}
              </section>

              {/* ──────────────── MIDDLE COLUMN: COUNTER ─────────────────── */}
              <section className="lbo-col lbo-col-counter">
                <div className="lbo-col-title-bar">
                  <div className="lbo-col-title">Counter <span className="lbo-count-pill">{counterSorted.length}</span></div>
                  {scanMode && (
                    <div className="lbo-scan-bar">
                      <ScanLine size={15} />
                      <input
                        ref={scanRef}
                        type="text"
                        placeholder={rightPane === 'receive' ? 'Scan new book to receive…' : 'Scan ticket to update counter…'}
                        value={scanInput}
                        onChange={e => setScanInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleScan()}
                      />
                      <button onClick={() => handleScan()} disabled={!scanInput.trim()}>Go</button>
                    </div>
                  )}
                  {/* Apr 2026 — batch-commit all dirty drafts in one click.
                      Visible only when there ARE drafts to save. Works in
                      BOTH manual and scan modes (scan mode auto-saves on
                      scan, but typed corrections still create drafts). */}
                  {Object.keys(counterDrafts).length > 0 && (
                    <button
                      type="button"
                      className="lbo-btn lbo-btn-primary lbo-save-all-btn"
                      onClick={saveAllTickets}
                      disabled={saving}
                      title="Save all unsaved ticket numbers in one click"
                    >
                      {saving
                        ? 'Saving…'
                        : `✓ Save All (${Object.keys(counterDrafts).length})`}
                    </button>
                  )}
                </div>

                {scanLog.length > 0 && (
                  <div className="lbo-scan-log">
                    {scanLog.map((l, i) => (
                      <div key={i} className={`lbo-scan-log-row ${l.ok ? 'ok' : 'err'}`}>
                        <span>{l.t}</span><span>{l.msg}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="lbo-counter-list">
                  {counterWithGaps.length === 0 && <div className="lbo-empty">No active books on the counter.</div>}
                  {counterWithGaps.map(b => b.__placeholder ? (
                    <div key={b.id} className="lbo-cnt-row lbo-cnt-row--empty" title={`Slot ${b.slotNumber} is empty`}>
                      <span />
                      <span className="lbo-cnt-slot lbo-cnt-slot--empty">{b.slotNumber}</span>
                      <span className="lbo-cnt-empty-msg">— empty slot —</span>
                      <span /><span /><span /><span />
                    </div>
                  ) : (
                    <CounterRow
                      key={b.id}
                      box={b}
                      draft={counterDrafts[b.id]}
                      scanMode={scanMode}
                      sellDirection={sellDirection}
                      isToday={snapIsToday}
                      openingTicket={b.openingTicket}
                      currentTicket={b.currentTicket}
                      historicalView={!snapIsToday}
                      selectedDate={date}
                      onDraftChange={v => setCounterDrafts(d => ({ ...d, [b.id]: v }))}
                      onSave={() => saveTicket(b.id)}
                      onRename={(newNo)    => doBoxAction('rename',       b, { boxNumber: newNo })}
                      onRenameSlot={(slot) => doBoxAction('rename-slot',  b, { slotNumber: slot })}
                      onSoldout={() => doBoxAction('soldout',      b)}
                      onReturn={()  => doBoxAction('return-ui',    b)}
                      onMoveToSafe={() => doBoxAction('safe',      b)}
                    />
                  ))}
                </div>
              </section>

              {/* ──────── RIGHT COLUMN: SAFE / SOLDOUT / RETURNED / RECEIVE / RETURN ──────── */}
              <section className="lbo-col lbo-col-right">
                {/* Receive / Return action buttons pinned to the TOP of the
                    right column — Session 46. Previously buried at the bottom
                    of the Report column where they competed visually with the
                    Cash Balance card. Putting them here makes the action ↔
                    target relationship obvious (button on top, list below). */}
                <div className="lbo-right-actions">
                  <button
                    className={`lbo-btn ${rightPane === 'receive' ? 'lbo-btn-primary' : 'lbo-btn-outline'}`}
                    onClick={() => setRightPane(rightPane === 'receive' ? 'safe' : 'receive')}
                  >
                    <Package size={14} /> Receive Books
                  </button>
                  <button
                    className={`lbo-btn ${rightPane === 'return' ? 'lbo-btn-warn' : 'lbo-btn-outline'}`}
                    onClick={() => setRightPane(rightPane === 'return' ? 'safe' : 'return')}
                  >
                    <RotateCcw size={14} /> Return Books
                  </button>
                  <button
                    className={`lbo-btn ${rightPane === 'settings' ? 'lbo-btn-primary' : 'lbo-btn-outline'}`}
                    onClick={() => setRightPane(rightPane === 'settings' ? 'safe' : 'settings')}
                    title="Lottery store settings"
                  >
                    <Settings size={14} /> Settings
                  </button>
                </div>

                {(rightPane === 'safe' || rightPane === 'soldout' || rightPane === 'returned') && (
                  <>
                    <div className="lbo-right-tabs">
                      {/* Tab counts: Safe shows the live total (no date filter
                          — manager needs to know what's in inventory right now).
                          Soldout + Returned show the count for the SELECTED day
                          only; matches the BookList filter so the pill is honest
                          about what's about to render. (May 2026 audit-trail aid.) */}
                      <button className={rightPane === 'safe' ? 'active' : ''} onClick={() => setRightPane('safe')}>
                        Safe <span className="lbo-count-pill">{safe.length}</span>
                      </button>
                      <button className={rightPane === 'soldout' ? 'active' : ''} onClick={() => setRightPane('soldout')}>
                        Soldout <span className="lbo-count-pill">
                          {soldout.filter(b => b.depletedAt && new Date(b.depletedAt).toLocaleDateString('en-CA') === date).length}
                        </span>
                      </button>
                      <button className={rightPane === 'returned' ? 'active' : ''} onClick={() => setRightPane('returned')}>
                        Returned <span className="lbo-count-pill">
                          {returned.filter(b => b.returnedAt && new Date(b.returnedAt).toLocaleDateString('en-CA') === date).length}
                        </span>
                      </button>
                    </div>
                    <BookList
                      books={rightBooks}
                      emptyMsg={
                        rightPane === 'soldout'
                          ? `No books sold out on ${date}.`
                          : rightPane === 'returned'
                          ? `No books returned on ${date}.`
                          : 'No books in safe.'
                      }
                      variant={rightPane}
                      selectedDate={date}
                      onAction={(kind, box) => doBoxAction(kind, box)}
                    />
                  </>
                )}
                {rightPane === 'receive' && (
                  <ReceivePanel
                    games={games}
                    catalog={catalog}
                    date={date}
                    onClose={() => setRightPane('safe')}
                    onSaved={() => { setRightPane('safe'); load(); }}
                  />
                )}
                {rightPane === 'return' && (
                  <ReturnPanel
                    active={active}
                    safe={safe}
                    sellDirection={sellDirection}
                    date={date}
                    onClose={() => setRightPane('safe')}
                    onSaved={() => { setRightPane('safe'); load(); }}
                  />
                )}
                {rightPane === 'settings' && (
                  <SettingsPanel
                    settings={settings}
                    onClose={() => setRightPane('safe')}
                    onSaved={(saved) => { setSettings(saved); setToast({ kind: 'ok', msg: 'Lottery settings saved.' }); setTimeout(() => setToast(null), 2200); }}
                  />
                )}
              </section>
            </div>
          )}

      {toast && (
        <div className={`lbo-toast lbo-toast--${toast.kind}`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
