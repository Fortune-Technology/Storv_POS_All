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
import { useConfirm } from '../hooks/useConfirmDialog.jsx';
import {
  Calendar, ChevronLeft, ChevronRight, Info, Loader2, MoreVertical, Package,
  Play, RotateCcw, ScanLine, Ticket, Trash2, X, Archive, Undo2, Settings,
} from 'lucide-react';
import {
  getLotteryBoxes, getLotteryGames, getDailyLotteryInventory,
  getLotteryOnlineTotal, upsertLotteryOnlineTotal, getLotteryCatalog,
  receiveLotteryBoxOrder, returnLotteryBoxToLotto, updateLotteryBox,
  scanLotteryBarcode, parseLotteryBarcode, closeLotteryDay,
  listPosShifts, getLotterySettings, updateLotterySettings,
  soldoutLotteryBox, restoreLotteryBoxToCounter, moveLotteryBoxToSafe, activateLotteryBox, deleteLotteryBox,
  getLotteryCounterSnapshot, upsertLotteryHistoricalClose,
} from '../services/api';
import './LotteryBackOffice.css';

const fmtMoney = (n) => n == null ? '$0.00' : `$${Number(n).toFixed(2)}`;
// Lottery-specific money formatter — tickets are whole-dollar prices
// ($1/$2/$5/$10/$20/$30/$50), so sums are always whole. Strip the .00
// trailing zeros for cleaner display ($769 instead of $769.00). Only
// shows decimals when an actual cent value exists (e.g. $1113.82 from
// mixed cart with tax — that keeps its full precision).
const fmtLottery = (n) => {
  if (n == null) return '$0';
  const num = Number(n);
  const rounded = Math.round(num * 100) / 100;
  if (Math.abs(rounded - Math.round(rounded)) < 0.005) {
    return `$${Math.round(rounded).toLocaleString()}`;
  }
  return `$${rounded.toFixed(2)}`;
};
const fmtInt   = (n) => n == null ? '0' : Number(n).toLocaleString();
const pad2     = (n) => String(n).padStart(2, '0');
const toDateStr = (d) => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
// Browser-local "today" — NOT UTC. Earlier `new Date().toISOString().slice(0, 10)`
// returned UTC date which broke after ~8pm in Western timezones (page opened to
// tomorrow → empty data). Browser-local matches the store's tz in 95%+ of
// real-world deployments where the manager + store are in the same tz.
const todayStr = () => toDateStr(new Date());

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

  // ── Close the day ───────────────────────────────────────────────────
  const runCloseDay = async () => {
    if (!await confirm({
      title: 'Close lottery day?',
      message: `Close the lottery day for ${date}?`,
      confirmLabel: 'Close Day',
    })) return;
    setSaving(true);
    try {
      await upsertLotteryOnlineTotal({
        date,
        ...online,
        grossSales: manualSales.gross,
        cancels:    manualSales.cancels,
        couponCash: manualSales.coupon,
        discounts:  manualSales.discounts,
      }).catch(() => {});
      await closeLotteryDay({ date });
      showToast('Lottery day closed', 'ok');
      await load();
    } catch (e) {
      showToast(e?.response?.data?.error || e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

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
                <button
                  className="lbo-btn lbo-btn-success lbo-btn-full"
                  onClick={runCloseDay}
                  disabled={saving}
                  title="Save current numbers AND record an end-of-day snapshot per active book"
                >
                  Close the Day
                </button>
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
                      <button className={rightPane === 'safe' ? 'active' : ''} onClick={() => setRightPane('safe')}>
                        Safe <span className="lbo-count-pill">{safe.length}</span>
                      </button>
                      <button className={rightPane === 'soldout' ? 'active' : ''} onClick={() => setRightPane('soldout')}>
                        Soldout <span className="lbo-count-pill">{soldout.length}</span>
                      </button>
                      <button className={rightPane === 'returned' ? 'active' : ''} onClick={() => setRightPane('returned')}>
                        Returned <span className="lbo-count-pill">{returned.length}</span>
                      </button>
                    </div>
                    <BookList
                      books={rightBooks}
                      emptyMsg={`No ${rightPane} books.`}
                      variant={rightPane}
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

// ════════════════════════════════════════════════════════════════════
// Calendar Strip — scrollable horizontally, past dates only
// ════════════════════════════════════════════════════════════════════
function CalendarStrip({ value, onChange }) {
  const [offset, setOffset] = useState(0);   // days from today (0 = today)
  const DAYS_VISIBLE = 14;                   // ~ one scrolling window
  const today = new Date(); today.setHours(0, 0, 0, 0);

  // Build DAYS_VISIBLE days ending at today-offset
  const days = useMemo(() => {
    const arr = [];
    for (let i = DAYS_VISIBLE - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - (offset + i));
      arr.push(d);
    }
    return arr;
  }, [offset, today]);

  const canForward = offset > 0;

  return (
    <div className="lbo-cal-strip">
      <button className="lbo-cal-nav" onClick={() => setOffset(o => o + DAYS_VISIBLE)} title="Earlier">
        <ChevronLeft size={14} />
      </button>
      <div className="lbo-cal-days">
        {days.map(d => {
          const str = toDateStr(d);
          const isSel = str === value;
          const dow = d.toLocaleDateString(undefined, { weekday: 'short' });
          const month = d.toLocaleDateString(undefined, { month: 'short' });
          return (
            <button
              key={str}
              className={`lbo-cal-day ${isSel ? 'sel' : ''} ${str === toDateStr(today) ? 'today' : ''}`}
              onClick={() => onChange(str)}
              title={`${dow}, ${month} ${d.getDate()}`}
            >
              <span className="lbo-cal-dow">{dow}</span>
              <span className="lbo-cal-date">{d.getDate()}</span>
            </button>
          );
        })}
      </div>
      <button className="lbo-cal-nav" onClick={() => setOffset(o => Math.max(0, o - DAYS_VISIBLE))} disabled={!canForward} title="Later">
        <ChevronRight size={14} />
      </button>
      <div className="lbo-cal-today-btn">
        <button onClick={() => { setOffset(0); onChange(toDateStr(today)); }} title="Jump to today">
          <Calendar size={13} /> Today
        </button>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// ActionMenu — reusable per-row dropdown.
// Click `⋮` → pops up a small menu of actions. Click outside closes.
// ════════════════════════════════════════════════════════════════════
function ActionMenu({ items, align = 'right' }) {
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

// ════════════════════════════════════════════════════════════════════
// Counter Row — one book on the counter. Pack-pill + slot + book +
// yesterday/today tickets + sold/amount + ⋮ action menu.
//
// Today column behavior:
//   • Date = today AND scan-mode → blank (fills on scan)
//   • Date = today AND manual    → prefilled with currentTicket
//   • Date != today              → prefilled with currentTicket (historical)
// ════════════════════════════════════════════════════════════════════
function CounterRow({
  box, draft, scanMode, sellDirection, isToday, historicalView,
  openingTicket, currentTicket,
  onDraftChange, onSave,
  onRename, onRenameSlot, onSoldout, onReturn, onMoveToSafe,
}) {
  const total    = Number(box.totalTickets || 0);
  const price    = Number(box.ticketPrice || 0);

  // "Yesterday" = openingTicket from the snapshot (prior day's close OR
  // this book's startTicket if it's the first day). Final fallback to
  // legacy fields preserves old behavior when snapshot data is missing.
  const yesterday = (openingTicket != null && openingTicket !== '')
    ? openingTicket
    : (box.lastShiftEndTicket ?? box.startTicket ?? (sellDirection === 'asc' ? '0' : String(Math.max(0, total - 1))));

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
          onChange={e => onDraftChange(e.target.value.replace(/[^0-9]/g, ''))}
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

// ════════════════════════════════════════════════════════════════════
// Book List — used on right column for Safe / Soldout / Returned.
// Each row has an action menu appropriate to the list's status.
// ════════════════════════════════════════════════════════════════════
function BookList({ books, emptyMsg, variant, onAction }) {
  // Sort: Safe groups books by game number ascending so tickets from the
  // same game cluster together (cashiers usually scan them in batches).
  // Soldout/Returned keep newest-first since they're audit-trail views.
  const sorted = [...books].sort((a, b) => {
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
                <span className="lbo-right-date">{fmtDateShort(b.createdAt)}</span>
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

// ════════════════════════════════════════════════════════════════════
// Receive Panel — inline replacement for the right column
// (replaces the old modal that kept auto-closing)
// ════════════════════════════════════════════════════════════════════
function ReceivePanel({ games, catalog, date, onClose, onSaved }) {
  const confirm = useConfirm();
  const [items, setItems] = useState([]);      // [{ key, source, gameId?, catalogTicketId?, gameName, gameNumber, bookNumber, ticketPrice, totalTickets, value }]
  const [scan, setScan]   = useState('');
  const [err, setErr]     = useState('');
  const [info, setInfo]   = useState('');
  const [saving, setSaving] = useState(false);
  const scanRef = useRef(null);

  useEffect(() => { setTimeout(() => scanRef.current?.focus(), 80); }, []);

  // Listen for scans routed from parent (when the global counter-scan bar is used)
  useEffect(() => {
    const onEv = (e) => handleScan(e.detail?.raw);
    window.addEventListener('lbo-receive-scan', onEv);
    return () => window.removeEventListener('lbo-receive-scan', onEv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const handleScan = async (v) => {
    const raw = String(v ?? scan ?? '').trim();
    if (!raw) return;
    setScan('');
    setErr(''); setInfo('');
    try {
      const res = await parseLotteryBarcode(raw);
      const parsed = res?.parsed;
      if (!parsed?.gameNumber || !parsed?.bookNumber) {
        setErr(`Unrecognised: ${raw}`);
        return;
      }
      const game = games.find(g => String(g.gameNumber) === String(parsed.gameNumber));
      const catRow = !game ? catalog.find(c => String(c.gameNumber) === String(parsed.gameNumber)) : null;
      if (!game && !catRow) {
        setErr(`Game ${parsed.gameNumber} not in catalog. Add it under More → Games, then re-scan.`);
        return;
      }
      const ticketPrice  = Number(game?.ticketPrice || catRow?.ticketPrice || 0);
      // Pack size: prefer barcode (QR positions 15-17), then catalog, then heuristic
      const barcodePack  = Number(parsed.packSize || 0);
      const catPack      = Number(game?.ticketsPerBox || catRow?.ticketsPerBook || 0);
      const totalTickets = barcodePack || (catPack && catPack !== 50 ? catPack : guessPack(ticketPrice));
      const value        = totalTickets * ticketPrice;
      const gameName     = game?.name || catRow?.name || `Game ${parsed.gameNumber}`;
      const dedup        = `${game?.id || catRow?.id}:${parsed.bookNumber}`;
      if (items.some(i => i.key === dedup)) {
        setInfo(`Already added: ${gameName} Book ${parsed.bookNumber}`);
        return;
      }
      // Prepend so the most-recent scan is always at the top of the
      // visible list. (Session 45 / L4) Cashier can confirm the latest
      // book they scanned without scrolling.
      setItems(arr => [{
        key: dedup,
        source: game ? 'game' : 'catalog',
        gameId: game?.id, catalogTicketId: catRow?.id,
        state: parsed.state, gameNumber: parsed.gameNumber,
        gameName, bookNumber: parsed.bookNumber,
        ticketPrice, totalTickets, value,
      }, ...arr]);
      setInfo(`✓ Added ${gameName} Book ${parsed.bookNumber} · pack ${totalTickets} · ${fmtMoney(value)}`);
    } catch (e) {
      setErr(e?.response?.data?.error || e.message);
    } finally {
      setTimeout(() => scanRef.current?.focus(), 0);
    }
  };

  const remove = (key) => setItems(arr => arr.filter(i => i.key !== key));
  const clearAll = async () => {
    if (await confirm({
      title: 'Clear scanned books?',
      message: `Clear ${items.length} books?`,
      confirmLabel: 'Clear',
      danger: true,
    })) setItems([]);
  };

  // Renamed from `confirm` to avoid colliding with the `useConfirm()` hook
  // value of the same name (Session 54). This is the "commit receive order"
  // handler — it actually persists the boxes; the hook is just for dialogs.
  const confirmReceive = async () => {
    if (items.length === 0) return;
    // Apr 2026 — when admin is on a past calendar date, confirm the
    // retroactive receive intent so they don't accidentally back-date
    // a fresh receive when they meant today.
    const today = todayStr();
    if (date && date !== today) {
      const ok = await confirm({
        title: 'Receive on past date?',
        message: `Record these ${items.length} book${items.length === 1 ? '' : 's'} as received on ${date}? Their createdAt will be set to that date so they show up under that day's "Received" total — useful when manager was out and is logging the receive retroactively.`,
        confirmLabel: `Receive on ${date}`,
      });
      if (!ok) return;
    }
    setSaving(true); setErr('');
    try {
      await receiveLotteryBoxOrder({
        boxes: items.map(it => {
          const p = { boxNumber: it.bookNumber, totalTickets: it.totalTickets };
          if (it.gameId) p.gameId = it.gameId;
          if (it.catalogTicketId) p.catalogTicketId = it.catalogTicketId;
          if (it.state) p.state = it.state;
          if (it.gameNumber) p.gameNumber = it.gameNumber;
          return p;
        }),
        // Pass selected calendar date — backend stamps createdAt to that day
        // (defaulting to today's now() when omitted, matching legacy callers).
        date,
      });
      onSaved?.();
    } catch (e) {
      setErr(e?.response?.data?.error || e.message);
    } finally {
      setSaving(false);
    }
  };

  const total = items.reduce((s, i) => s + i.value, 0);

  return (
    <>
      <div className="lbo-right-tabs lbo-right-tabs--single">
        <span className="active"><Package size={13} /> Receive Books</span>
        <button className="lbo-right-close" onClick={onClose} title="Cancel and return to Safe"><X size={14} /></button>
      </div>
      <div className="lbo-pane-body">
        {err && <div className="lbo-inline-err">{err}</div>}
        {info && <div className="lbo-inline-info">{info}</div>}
        <div className="lbo-scan-bar-inline">
          <ScanLine size={15} />
          <input
            ref={scanRef}
            type="text"
            placeholder="Scan book barcode…"
            value={scan}
            onChange={e => setScan(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleScan()}
          />
          <button onClick={() => handleScan()} disabled={!scan.trim()}>Add</button>
        </div>
        {items.length === 0 ? (
          <div className="lbo-empty">Scan a received book to add it. Books land in the Safe on confirm.</div>
        ) : (
          <div className="lbo-receive-list">
            {items.map(i => (
              <div key={i.key} className="lbo-receive-row">
                <PackPill price={i.ticketPrice} />
                <span>
                  <strong>{i.gameNumber}-{i.bookNumber}</strong>
                  <small>{i.gameName} · pack {i.totalTickets}</small>
                </span>
                <span className="lbo-receive-amt">{fmtMoney(i.value)}</span>
                <button onClick={() => remove(i.key)} className="lbo-icon-btn" title="Remove"><X size={12} /></button>
              </div>
            ))}
          </div>
        )}
      </div>
      {items.length > 0 && (
        <div className="lbo-pane-foot">
          <div className="lbo-pane-total">
            {items.length} book{items.length === 1 ? '' : 's'} · <strong>{fmtMoney(total)}</strong>
          </div>
          <div className="lbo-pane-actions">
            <button className="lbo-btn lbo-btn-outline" onClick={clearAll}>Clear</button>
            <button className="lbo-btn lbo-btn-primary" onClick={confirmReceive} disabled={saving}>
              {saving ? 'Saving…' : `Confirm & Send to Safe (${items.length})`}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// ════════════════════════════════════════════════════════════════════
// Return Panel — supports full and partial returns
// ════════════════════════════════════════════════════════════════════
function ReturnPanel({ active, safe, sellDirection = 'desc', date, onClose, onSaved }) {
  const confirm = useConfirm();
  const boxes = [...active, ...safe];
  const [pickId, setPickId] = useState('');
  const [kind, setKind]     = useState('full');   // 'full' | 'partial'
  const [ticketsSold, setTicketsSold] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState('');
  // Tracks whether the user has manually edited the ticketsSold input.
  // We auto-prefill from the live position when a partial-return book is
  // selected, but stop overwriting once the user types their own value.
  const [touched, setTouched] = useState(false);

  // Pre-select a book when the Return drawer is opened via a CounterRow /
  // BookList action menu. The parent dispatches `lbo-return-preselect`
  // with { boxId } so this panel can self-configure without a prop drill.
  useEffect(() => {
    const onEv = (e) => {
      const id = e.detail?.boxId;
      if (id && boxes.some(b => b.id === id)) setPickId(id);
    };
    window.addEventListener('lbo-return-preselect', onEv);
    return () => window.removeEventListener('lbo-return-preselect', onEv);
  }, [boxes]);

  const pick = boxes.find(b => b.id === pickId);
  const total = pick ? Number(pick.totalTickets || 0) : 0;
  const price = pick ? Number(pick.ticketPrice || 0) : 0;

  // Apr 2026 — compute the LIVE sold count from box.currentTicket
  // direction-aware. This is the system's best-known value at the moment
  // the user opens the return panel; matches the SO confirm modal pattern.
  // Used to pre-fill the ticketsSold input AND for the confirm message.
  const liveSoldCount = useMemo(() => {
    if (!pick) return 0;
    const ct = Number(pick.currentTicket);
    if (!Number.isFinite(ct) || total === 0) return 0;
    if (sellDirection === 'asc') {
      // asc: startTicket=0, currentTicket=N means N tickets sold (0..N-1).
      const start = Number(pick.startTicket ?? 0);
      return Math.max(0, Math.min(total, ct - start));
    }
    // desc: startTicket=total-1, currentTicket=N means (start-N) tickets sold.
    const start = Number(pick.startTicket ?? total - 1);
    return Math.max(0, Math.min(total, start - ct));
  }, [pick, total, sellDirection]);

  // Pre-fill ticketsSold when partial mode + book selected + user hasn't typed
  // their own value yet. Reset 'touched' when book or kind changes.
  useEffect(() => {
    setTouched(false);
    if (kind === 'partial' && pick) {
      setTicketsSold(String(liveSoldCount));
    } else {
      setTicketsSold('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickId, kind]);

  const soldN = kind === 'partial' ? Number(ticketsSold || 0) : 0;
  const unsold = Math.max(0, total - soldN);
  const unsoldValue = unsold * price;
  const soldValue = soldN * price;

  const submit = async () => {
    if (!pick) return;
    if (kind === 'partial') {
      if (!Number.isFinite(soldN) || soldN < 0 || soldN > total) {
        setErr(`Tickets sold must be between 0 and ${total}`); return;
      }
    }
    if (!await confirm({
      title: 'Return book?',
      message: kind === 'partial'
        ? `Return ${pick.game?.name} Book ${pick.boxNumber} on ${date}?\n\n` +
          `Sold today: ${soldN} ticket${soldN === 1 ? '' : 's'} (${fmtLottery(soldValue)}) — counted as that day's sales\n` +
          `Unsold: ${unsold} ticket${unsold === 1 ? '' : 's'} (${fmtLottery(unsoldValue)}) — credited back to inventory\n\n` +
          `Cannot be undone without "Restore to Counter".`
        : `Return ${pick.game?.name} Book ${pick.boxNumber} on ${date}?\n\nFull return — no tickets sold from this book. Cannot be undone without "Restore to Counter".`,
      confirmLabel: 'Return',
      danger: true,
    })) return;
    setSaving(true); setErr('');
    try {
      // Apr 2026 — pass selected calendar date so backend dates the return
      // correctly + writes a close_day_snapshot for that date.
      const body = { reason: reason || null, returnType: kind, date };
      if (kind === 'partial') body.ticketsSold = soldN;
      await returnLotteryBoxToLotto(pick.id, body);
      onSaved?.();
    } catch (e) {
      setErr(e?.response?.data?.error || e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="lbo-right-tabs lbo-right-tabs--single">
        <span className="active"><RotateCcw size={13} /> Return Books</span>
        <button className="lbo-right-close" onClick={onClose} title="Cancel and return to Safe"><X size={14} /></button>
      </div>
      <div className="lbo-pane-body">
        {err && <div className="lbo-inline-err">{err}</div>}

        <div className="lbo-return-kind">
          <label className={kind === 'full' ? 'sel' : ''}>
            <input type="radio" name="rk" checked={kind === 'full'} onChange={() => setKind('full')} />
            <span><strong>Full Return</strong><small>Whole book back to lottery commission (no tickets sold)</small></span>
          </label>
          <label className={kind === 'partial' ? 'sel' : ''}>
            <input type="radio" name="rk" checked={kind === 'partial'} onChange={() => setKind('partial')} />
            <span><strong>Partial Return</strong><small>Some tickets sold first — unsold tickets deducted from settlement</small></span>
          </label>
        </div>

        <div className="lbo-field">
          <label>Book</label>
          <select value={pickId} onChange={e => setPickId(e.target.value)}>
            <option value="">— Select a book —</option>
            {boxes.map(b => (
              <option key={b.id} value={b.id}>
                {b.game?.name} · Book {b.boxNumber} · {b.status === 'active' ? `Counter slot ${b.slotNumber}` : 'Safe'} · {b.ticketsSold || 0}/{b.totalTickets}
              </option>
            ))}
          </select>
        </div>

        {pick && kind === 'partial' && (
          <div className="lbo-field">
            <label>Tickets Sold Before Return</label>
            <input
              type="number"
              min="0" max={total}
              value={ticketsSold}
              onChange={e => { setTicketsSold(e.target.value); setTouched(true); }}
              placeholder={`0 – ${total}`}
            />
            <small className="lbo-field-hint">
              Book has {total} tickets.{' '}
              {!touched && liveSoldCount > 0 && (
                <>Pre-filled from live position — system shows <strong>{liveSoldCount}</strong> sold so far. Adjust if needed.</>
              )}
              {touched && (
                <>Enter how many were sold before physical return.</>
              )}
              {Number.isFinite(soldN) && soldN > 0 && soldN <= total && (
                <> <strong>{soldN} sold ({fmtLottery(soldValue)}) · {unsold} unsold ({fmtLottery(unsoldValue)} credited back)</strong></>
              )}
            </small>
          </div>
        )}

        <div className="lbo-field">
          <label>Reason <small>(optional)</small></label>
          <input type="text" value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. game ended, partial return" />
        </div>
      </div>
      <div className="lbo-pane-foot">
        <div className="lbo-pane-actions">
          <button className="lbo-btn lbo-btn-outline" onClick={onClose}>Cancel</button>
          <button className="lbo-btn lbo-btn-warn" disabled={!pick || saving} onClick={submit}>
            {saving ? 'Returning…' : pick ? `Return ${pick.game?.gameNumber}-${pick.boxNumber}` : 'Select a book'}
          </button>
        </div>
      </div>
    </>
  );
}

// ════════════════════════════════════════════════════════════════════
// SETTINGS PANEL — store-level lottery configuration (Phase E, Apr 2026)
// Inline panel so the owner can tune lottery behavior without leaving
// the back-office Daily view (was previously buried under Lottery →
// Settings tab and easy to miss).
// ════════════════════════════════════════════════════════════════════
function SettingsPanel({ settings, onClose, onSaved }) {
  const initial = useMemo(() => ({
    enabled:                    settings?.enabled                    ?? true,
    cashOnly:                   settings?.cashOnly                   ?? false,
    state:                      settings?.state                      ?? '',
    commissionRate:             settings?.commissionRate != null
                                  ? Number(settings.commissionRate) * 100  // store rate is 0.054 → display 5.4
                                  : '',
    scanRequiredAtShiftEnd:     settings?.scanRequiredAtShiftEnd     ?? false,
    sellDirection:              settings?.sellDirection              ?? 'desc',
    allowMultipleActivePerGame: settings?.allowMultipleActivePerGame ?? false,
    shiftVarianceDisplay:       settings?.shiftVarianceDisplay       ?? 'always',
    shiftVarianceThreshold:     settings?.shiftVarianceThreshold != null
                                  ? Number(settings.shiftVarianceThreshold)
                                  : 0,
  }), [settings]);

  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  // Re-init when settings change (e.g. after first load)
  useEffect(() => { setForm(initial); }, [initial]);

  const isDirty = useMemo(() => {
    return Object.keys(initial).some(k => initial[k] !== form[k]);
  }, [initial, form]);

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const submit = async () => {
    setSaving(true); setErr('');
    try {
      const storeId = localStorage.getItem('activeStoreId');
      const payload = {
        enabled:                    Boolean(form.enabled),
        cashOnly:                   Boolean(form.cashOnly),
        state:                      form.state || null,
        commissionRate:             form.commissionRate === '' ? null : Number(form.commissionRate) / 100,
        scanRequiredAtShiftEnd:     Boolean(form.scanRequiredAtShiftEnd),
        sellDirection:              form.sellDirection || 'desc',
        allowMultipleActivePerGame: Boolean(form.allowMultipleActivePerGame),
        shiftVarianceDisplay:       form.shiftVarianceDisplay || 'always',
        shiftVarianceThreshold:     Number(form.shiftVarianceThreshold || 0),
      };
      const saved = await updateLotterySettings(storeId, payload);
      onSaved?.(saved);
    } catch (e) {
      setErr(e?.response?.data?.error || e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="lbo-right-tabs lbo-right-tabs--single">
        <span className="active"><Settings size={13} /> Lottery Settings</span>
        <button className="lbo-right-close" onClick={onClose} title="Close settings"><X size={14} /></button>
      </div>
      <div className="lbo-settings-panel">
      {err && <div className="lbo-settings-err">{err}</div>}

      <div className="lbo-settings-body">
        {/* General */}
        <div className="lbo-settings-section">
          <div className="lbo-settings-section-title">GENERAL</div>
          <SettingsToggle
            label="Lottery module enabled"
            hint="Turn off to hide all lottery UI in the cashier app"
            value={form.enabled}
            onChange={v => set('enabled', v)}
          />
          <SettingsToggle
            label="Cash only at register"
            hint="Restrict lottery transactions to cash tender"
            value={form.cashOnly}
            onChange={v => set('cashOnly', v)}
          />
          <SettingsRow label="State / Province" hint="Determines which catalog tickets appear">
            <select className="lbo-settings-input" value={form.state || ''} onChange={e => set('state', e.target.value)}>
              <option value="">— Select —</option>
              {['MA','ME','NH','VT','CT','RI','NY','NJ','PA','DE','MD','VA','NC','SC','GA','FL','ON','QC'].map(s =>
                <option key={s} value={s}>{s}</option>
              )}
            </select>
          </SettingsRow>
          <SettingsRow label="Commission rate (%)" hint="Store-level rate applied to all lottery sales (e.g. 5.4)">
            <input
              className="lbo-settings-input"
              type="number"
              min="0"
              max="100"
              step="0.01"
              placeholder="e.g. 5.4"
              value={form.commissionRate}
              onChange={e => set('commissionRate', e.target.value)}
            />
          </SettingsRow>
        </div>

        {/* Counter behavior */}
        <div className="lbo-settings-section">
          <div className="lbo-settings-section-title">COUNTER BEHAVIOR</div>
          <SettingsRow label="Sell direction" hint="How tickets are loaded in the dispenser">
            <select className="lbo-settings-input" value={form.sellDirection} onChange={e => set('sellDirection', e.target.value)}>
              <option value="desc">Descending (149 → 0 — top of pack first)</option>
              <option value="asc">Ascending (0 → 149 — bottom of pack first)</option>
            </select>
          </SettingsRow>
          <SettingsToggle
            label="Allow multiple active books per game"
            hint="When OFF, scanning a new book of an active game auto-soldouts the old one"
            value={form.allowMultipleActivePerGame}
            onChange={v => set('allowMultipleActivePerGame', v)}
          />
          <SettingsToggle
            label="Require ticket scan at shift end"
            hint="Cashier must scan every active book before closing their shift"
            value={form.scanRequiredAtShiftEnd}
            onChange={v => set('scanRequiredAtShiftEnd', v)}
          />
        </div>

        {/* Audit / variance display */}
        <div className="lbo-settings-section">
          <div className="lbo-settings-section-title">SHIFT VARIANCE DISPLAY</div>
          <div className="lbo-settings-section-hint">
            How the per-shift Audit view shows cash variance for each shift.
            Day-level rollup is always shown.
          </div>
          <SettingsRow label="Display mode">
            <select className="lbo-settings-input" value={form.shiftVarianceDisplay} onChange={e => set('shiftVarianceDisplay', e.target.value)}>
              <option value="always">Always show variance per shift</option>
              <option value="threshold">Only flag when variance exceeds threshold</option>
              <option value="hidden">Hide per-shift variance (day rollup only)</option>
            </select>
          </SettingsRow>
          {form.shiftVarianceDisplay === 'threshold' && (
            <SettingsRow label="Threshold ($)" hint="Per-shift variance below this is hidden">
              <input
                className="lbo-settings-input"
                type="number"
                min="0"
                step="0.01"
                placeholder="e.g. 5.00"
                value={form.shiftVarianceThreshold}
                onChange={e => set('shiftVarianceThreshold', e.target.value)}
              />
            </SettingsRow>
          )}
        </div>
      </div>

      <div className="lbo-pane-foot">
        <div className="lbo-pane-actions">
          <button className="lbo-btn lbo-btn-outline" onClick={onClose}>Close</button>
          <button
            className="lbo-btn lbo-btn-primary"
            disabled={!isDirty || saving}
            onClick={submit}
          >
            {saving ? 'Saving…' : isDirty ? 'Save Changes' : 'Saved'}
          </button>
        </div>
      </div>
      </div>
    </>
  );
}

function SettingsRow({ label, hint, children }) {
  return (
    <label className="lbo-settings-row">
      <div className="lbo-settings-row-head">
        <span className="lbo-settings-row-label">{label}</span>
        {hint && <span className="lbo-settings-row-hint">{hint}</span>}
      </div>
      <div className="lbo-settings-row-control">{children}</div>
    </label>
  );
}

function SettingsToggle({ label, hint, value, onChange }) {
  return (
    <div className="lbo-settings-toggle-row">
      <div className="lbo-settings-row-head">
        <span className="lbo-settings-row-label">{label}</span>
        {hint && <span className="lbo-settings-row-hint">{hint}</span>}
      </div>
      <button
        type="button"
        className={`lbo-settings-toggle ${value ? 'on' : ''}`}
        onClick={() => onChange(!value)}
        aria-pressed={value}
      >
        <span className="lbo-settings-toggle-knob" />
      </button>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Small building-block components
// ════════════════════════════════════════════════════════════════════
function Metric({ label, value, big, accent, sub }) {
  return (
    <div className={`lbo-metric ${big ? 'big' : ''} ${accent || ''}`}>
      <div className="lbo-metric-label">{label}</div>
      <div className="lbo-metric-value">{value}</div>
      {sub && <div className="lbo-metric-sub">{sub}</div>}
    </div>
  );
}

function Section({ title, total, totalAccent, children }) {
  return (
    <div className="lbo-section">
      <div className="lbo-section-head">
        <span>{title}</span>
        {total !== undefined && <strong className={totalAccent || ''}>{total}</strong>}
      </div>
      <div className="lbo-section-body">{children}</div>
    </div>
  );
}

function EditableField({ label, value, onChange }) {
  return (
    <div className="lbo-kv lbo-kv--edit">
      <span>{label}</span>
      <div className="lbo-kv-input">
        <span>$</span>
        <input
          type="number" step="0.01" min="0"
          value={value}
          onChange={e => onChange(Number(e.target.value))}
        />
      </div>
    </div>
  );
}

function ReadonlyField({ label, value, units, note, accent }) {
  return (
    <div className="lbo-kv lbo-kv--ro">
      <span>{label}</span>
      <strong className={accent || ''}>
        {value}{units ? <small> {units}</small> : null}
      </strong>
      {note && <small className="lbo-kv-note">{note}</small>}
    </div>
  );
}

function ModeToggle({ scanMode, onChange }) {
  return (
    <div className="lbo-mode">
      <button className={scanMode ? 'sel' : ''} onClick={() => onChange(true)}>
        <ScanLine size={13} /> Scan Mode
      </button>
      <button className={!scanMode ? 'sel' : ''} onClick={() => onChange(false)}>
        ✎ Manual Mode
      </button>
    </div>
  );
}

/**
 * Visual indicator for book face-value. Same neutral pill style for all
 * price points (per user spec — not distinct colors per tier); the $ value
 * displayed inside the pill is the ticket price. A small colored strip on
 * the left edge encodes the price band (low/mid/high) for quick at-a-glance
 * recognition without shouting.
 */
function PackPill({ price }) {
  const p = Number(price || 0);
  const band = p >= 30 ? 'hi' : p >= 10 ? 'mid' : 'lo';
  return <span className={`lbo-pack-pill lbo-pack-pill--${band}`}>${p}</span>;
}

// ── helpers ─────────────────────────────────────────────────────────
function fmtDateShort(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: '2-digit', day: '2-digit', year: '2-digit' });
}

function guessPack(price) {
  const p = Number(price || 0);
  if (p <= 1)  return 300;
  if (p <= 2)  return 200;
  if (p <= 3)  return 200;
  if (p <= 5)  return 100;
  if (p <= 10) return 50;
  if (p <= 20) return 30;
  if (p <= 30) return 20;
  return 10;
}
