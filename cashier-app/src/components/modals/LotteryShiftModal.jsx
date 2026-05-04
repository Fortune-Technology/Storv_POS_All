/**
 * LotteryShiftModal — End-of-shift lottery reconciliation wizard (Phase 3g).
 *
 * 3-step flow per user spec:
 *   1. Counter Scan — active books sorted by slot number ascending
 *      (matches the physical dispenser order so cashiers can scan
 *      left-to-right across the counter without hunting).
 *      Yesterday-end column (prev shift's end or start). Scan input at top
 *      auto-fills the matching book's today-end OR auto-activates a
 *      new-book scan. Each row also has a Soldout button.
 *      Every row MUST have an end-ticket OR be soldout before Next.
 *   2. Online Sales — 6 cumulative-day readings off the lottery terminal
 *      (grossSales, cancels, machineCashing, couponCash, discounts,
 *      instantCashing). All values are day-to-date totals (the terminal
 *      shows running daily totals — per-shift activity is later computed
 *      by delta-ing chronologically-ordered shifts in the same day).
 *      Persists into LotteryOnlineTotal (day) AND LotteryShiftReport
 *      (per-shift snapshot) so the back-office audit view can reconstruct
 *      per-shift deltas.
 *   3. Confirm — final report with all numbers + net due formula.
 *      Confirm saves LotteryShiftReport + LotteryOnlineTotal + flips any
 *      soldout boxes to depleted.
 *
 * Props preserved for back-compat with POSScreen:
 *   open, shiftId, activeBoxes, sessionSales, sessionPayouts, scanRequired,
 *   pendingShiftClose, onSave, onClose.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Ticket, Check, AlertCircle, ChevronRight, ChevronLeft, ScanLine, Trash2 } from 'lucide-react';
import { scanLotteryBarcode, upsertLotteryOnlineTotal, getLotteryBoxes, soldoutLotteryBox, getLotteryYesterdayCloses, getLotterySettings, getDailyLotteryInventory, getPreviousShiftReadings } from '../../api/pos';
import useConfirm from '../../hooks/useConfirmDialog.jsx';
import './LotteryShiftModal.css';

const fmtL = (n) => {
  const num = Number(n || 0);
  const r = Math.round(num * 100) / 100;
  return Math.abs(r - Math.round(r)) < 0.005
    ? `$${Math.round(r).toLocaleString()}`
    : `$${r.toFixed(2)}`;
};

const fmt = (n) => `$${Number(n || 0).toFixed(2)}`;
const numInput = (v) => String(v || '').replace(/[^0-9]/g, '');
// Browser-local "today" — NOT UTC. Earlier `new Date().toISOString().slice(0, 10)`
// returned UTC date which broke after ~8pm in Western timezones — the wizard
// would stamp LotteryOnlineTotal under tomorrow's date and fetch authoritative
// total for tomorrow (returning $0 while local Step 1 sum showed actual sales).
// Browser-local matches the back-office in 95%+ of real-world deployments
// where the cashier register and back-office are in the same tz.
const _pad2 = (n) => String(n).padStart(2, '0');
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${_pad2(d.getMonth() + 1)}-${_pad2(d.getDate())}`;
};

// Slot-number comparator used for the EoD wizard's counter list. Books
// without a slot number fall to the end. Tiebreak by gameNumber + bookNumber
// so the order is stable when two books share a slot or both lack one.
function byslot(a, b) {
  const sa = a?.slotNumber == null ? Number.MAX_SAFE_INTEGER : Number(a.slotNumber);
  const sb = b?.slotNumber == null ? Number.MAX_SAFE_INTEGER : Number(b.slotNumber);
  if (sa !== sb) return sa - sb;
  const ga = String(a?.game?.gameNumber || a?.gameNumber || '');
  const gb = String(b?.game?.gameNumber || b?.gameNumber || '');
  if (ga !== gb) return ga.localeCompare(gb);
  const ba = String(a?.boxNumber || '');
  const bb = String(b?.boxNumber || '');
  return ba.localeCompare(bb);
}

const STEPS = ['Counter Scan', 'Online Sales', 'Confirm & Save'];

export default function LotteryShiftModal({
  open,
  shiftId,
  activeBoxes       = [],
  sessionSales      = 0,
  sessionPayouts    = 0,
  scanRequired      = false,
  pendingShiftClose = false,
  onSave,
  onClose,
  storeId,
}) {
  const confirm = useConfirm();
  const [step, setStep]     = useState(0);
  const [boxes, setBoxes]   = useState([]);                   // mutable local copy (supports new-book activation mid-flow)
  const [endTickets, setEndTickets] = useState({});           // {boxId: "079"}
  const [soldout, setSoldout]       = useState({});           // {boxId: true}
  const [notes, setNotes]           = useState('');
  const [scanValue, setScanValue]   = useState('');
  const [scanLog, setScanLog]       = useState([]);           // recent scans for operator feedback
  const [online, setOnline]         = useState({
    grossSales:     '',
    cancels:        '',
    machineCashing: '',
    couponCash:     '',
    discounts:      '',
    instantCashing: '',
  });
  const [saving, setSaving]         = useState(false);
  const [err, setErr]               = useState('');
  // Per-box yesterday-close map (boxId → { ticket, ticketsSold, closedAt }).
  // Fetched from /lottery/yesterday-closes on open so the YESTERDAY column
  // shows the SAME value the back-office Counter view shows. The legacy
  // fallback (lastShiftEndTicket → startTicket → '—') runs when a box
  // has no prior close_day_snapshot (fresh activation today).
  const [yesterdayCloses, setYesterdayCloses] = useState({});
  // Store sellDirection — drives the SO sentinel value (-1 for desc,
  // totalTickets for asc). Fetched on open; defaults to 'desc' (the most
  // common). Matches backend's snapshotSales.priorPosition default.
  const [sellDirection, setSellDirection] = useState('desc');
  // After save, the backend's authoritative daily sales number — shown on
  // the success screen so the cashier sees what got recorded (which is
  // the same number the back-office Daily page will show).
  const [authoritativeTotal, setAuthoritativeTotal] = useState(null);
  // Apr 2026 — save warnings + write stats from the backend response.
  // Surfaced on the Step 3 confirm screen when any per-box update or
  // snapshot insert failed during the save (previously these failures
  // were silently logged on the server and the cashier saw "Saved!").
  const [saveWarnings, setSaveWarnings] = useState(null);
  const [writeStats, setWriteStats] = useState(null);
  // Apr 2026 — Fix #3: previous shift's saved cumulative readings (today),
  // used to compute Shift 2+'s incremental contribution. For Shift 1 of
  // the day, all zeros (no prior shift). The wizard subtracts these from
  // the cashier's typed cumulative readings so the Daily Due reflects ONLY
  // this shift's drawer contribution, not the whole day.
  const [prevShiftReadings, setPrevShiftReadings] = useState({
    grossSales: 0, cancels: 0, machineCashing: 0,
    couponCash: 0, discounts: 0, instantCashing: 0,
  });
  const [hasPreviousShift, setHasPreviousShift] = useState(false);
  const scanInputRef = useRef(null);

  // Load active boxes + sort by slot number when the modal opens.
  // (Apr 2026 — switched from ticket-value-desc to slot ascending so the
  // wizard list matches the physical dispenser order, making scan flow
  // natural for cashiers reading left-to-right across the counter.)
  useEffect(() => {
    if (!open) return;
    const sorted = [...(activeBoxes || [])].sort(byslot);
    setBoxes(sorted);
    // Fetch yesterday-close snapshots so the YESTERDAY column has data
    // even for boxes whose lastShiftEndTicket / startTicket are missing
    // (legacy data, auto-activated books, etc.). Mirrors back-office.
    getLotteryYesterdayCloses({ date: todayISO() })
      .then((closes) => setYesterdayCloses(closes || {}))
      .catch(() => setYesterdayCloses({}));
    // Fetch sellDirection so the soldout-amount math uses the SAME
    // sentinel as the backend (-1 for desc, totalTickets for asc).
    // Without this, the wizard's per-row soldout total can drift from
    // the back-office aggregate by hundreds of dollars per book.
    if (storeId) {
      getLotterySettings(storeId)
        .then((s) => setSellDirection(s?.sellDirection === 'asc' ? 'asc' : 'desc'))
        .catch(() => setSellDirection('desc'));
    }
    // Fetch prior shift's saved readings (today) for per-shift online delta
    // math. For Shift 1 of the day this returns all-zeros (no hasPrevious).
    if (shiftId) {
      getPreviousShiftReadings({ excludeShiftId: shiftId })
        .then((r) => {
          setHasPreviousShift(!!r?.hasPrevious);
          setPrevShiftReadings(r?.readings || {
            grossSales: 0, cancels: 0, machineCashing: 0,
            couponCash: 0, discounts: 0, instantCashing: 0,
          });
        })
        .catch(() => {
          setHasPreviousShift(false);
          setPrevShiftReadings({
            grossSales: 0, cancels: 0, machineCashing: 0,
            couponCash: 0, discounts: 0, instantCashing: 0,
          });
        });
    }
    setAuthoritativeTotal(null);
    setSaveWarnings(null);
    setWriteStats(null);
    // Reset wizard state each open
    setStep(0);
    setEndTickets({});
    setSoldout({});
    setNotes('');
    setScanValue('');
    setScanLog([]);
    setOnline({
      grossSales:     '',
      cancels:        '',
      machineCashing: '',
      couponCash:     '',
      discounts:      '',
      instantCashing: '',
    });
    setErr('');
    setTimeout(() => scanInputRef.current?.focus(), 100);
  }, [open, activeBoxes]);

  if (!open) return null;

  // ── Scan handler — routes to scan engine, updates local state ───────────
  const handleScan = async (raw) => {
    const v = String(raw || scanValue || '').trim();
    if (!v) return;
    setScanValue('');
    try {
      const res = await scanLotteryBarcode(v, 'eod');
      const now = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      if (res?.box) {
        const boxId = res.box.id;
        if (res.action === 'activate') {
          // New book from safe — add to the list (sorted by slot)
          setBoxes(prev => prev.some(b => b.id === boxId) ? prev : [...prev, res.box].sort(byslot));
          // Auto-fill its today-end = scanned ticket (next-to-sell)
          if (res.parsed?.ticketNumber != null) {
            setEndTickets(prev => ({ ...prev, [boxId]: String(res.parsed.ticketNumber) }));
          }
          setScanLog(l => [{ t: now, msg: `✓ Activated ${res.box.game?.name} Book ${res.box.boxNumber}`, ok: true }, ...l].slice(0, 5));
        } else if (res.action === 'update_current') {
          if (res.parsed?.ticketNumber != null) {
            setEndTickets(prev => ({ ...prev, [boxId]: String(res.parsed.ticketNumber) }));
          }
          setScanLog(l => [{ t: now, msg: `✓ ${res.box.game?.name || 'Book'} → ticket ${res.parsed?.ticketNumber ?? '—'}`, ok: true }, ...l].slice(0, 5));
        } else {
          // Prefer the human-friendly message when the backend provides one
          // (e.g. "Book 498-027632 is not in your store's inventory…").
          const msg = res.message || res.reason || 'Rejected';
          setScanLog(l => [{ t: now, msg: `✗ ${msg}`, ok: false }, ...l].slice(0, 5));
        }
      } else {
        // No box AND no parsed info — backend couldn't decode the barcode at
        // all. Fall back to the generic "unknown" message with the raw scan.
        const msg = res?.message || res?.reason || `Unknown barcode: ${v}`;
        setScanLog(l => [{ t: now, msg: `✗ ${msg}`, ok: false }, ...l].slice(0, 5));
      }
    } catch (e) {
      setScanLog(l => [{ t: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), msg: `✗ ${e?.response?.data?.error || e.message}`, ok: false }, ...l].slice(0, 5));
    }
    setTimeout(() => scanInputRef.current?.focus(), 10);
  };

  const toggleSoldout = async (boxId) => {
    // Toggling OFF (un-marking) — no confirm needed.
    if (soldout[boxId]) {
      setSoldout(prev => ({ ...prev, [boxId]: false }));
      return;
    }
    // Toggling ON — confirm with the dollar impact so an accidental click
    // doesn't silently inflate the day's sales when the wizard saves.
    // (The actual DB write doesn't happen until the cashier clicks "Save"
    // at Step 3, but it's easier to catch the mistake here than there.)
    const box = boxes.find(b => b.id === boxId);
    if (!box) return;
    // Apr 2026 — Fix #2: compute remaining from currentTicket direction-aware,
    // not from stale box.ticketsSold. See LotteryBackOffice.jsx for the same
    // fix on the back-office SO confirm.
    const ct = Number(box.currentTicket);
    const total = Number(box.totalTickets || 0);
    const price = Number(box.ticketPrice || box.game?.ticketPrice || 0);
    let remainingTickets;
    if (Number.isFinite(ct) && total > 0) {
      remainingTickets = sellDirection === 'asc'
        ? Math.max(0, total - ct)        // asc: ct..total-1 remaining
        : Math.max(0, ct + 1);            // desc: 0..ct remaining
    } else {
      remainingTickets = Math.max(0, total - Number(box.ticketsSold || 0));
    }
    const remainingValue = remainingTickets * price;
    const ok = await confirm({
      title: 'Mark book sold out?',
      message: `Mark ${box.game?.name || 'book'} ${box.boxNumber} as sold out?\n\nThis will count the remaining ${remainingTickets} ticket${remainingTickets === 1 ? '' : 's'} (${fmtL(remainingValue)}) as sold today. Cannot be undone after the shift saves.`,
      confirmLabel: 'Mark Sold Out',
      danger: true,
    });
    if (!ok) return;
    setSoldout(prev => ({ ...prev, [boxId]: true }));
  };

  // ── Per-box computed data ───────────────────────────────────────────────
  const boxData = useMemo(() => boxes.map(box => {
    // Yesterday-end resolution priority (most authoritative first).
    // (Apr 2026 — Fix #1: lastShiftEndTicket promoted to FIRST so Shift 2's
    // wizard correctly starts from Shift 1's same-day close. Previously
    // /yesterday-closes won and Shift 2 saw actual prior-day's close as its
    // baseline, double-counting Shift 1's sales into Shift 2's drawer.)
    //
    //   1. box.lastShiftEndTicket — set by saveLotteryShiftReport on prior
    //      shift close. For Shift 2 of the day this is Shift 1's end. For
    //      Shift 1 this falls through to step 2 (the actual prior day).
    //   2. close_day_snapshot before today (yesterday's actual close)
    //   3. startTicket (fresh book activated today, never closed)
    //   4. currentTicket (last-resort live fallback)
    //   5. '—' (truly no data)
    const snapTicket = yesterdayCloses[box.id]?.ticket;
    const yesterdayEnd =
      (box.lastShiftEndTicket != null && box.lastShiftEndTicket !== ''
        ? String(box.lastShiftEndTicket)
        : null) ||
      (snapTicket != null && snapTicket !== '' ? String(snapTicket) : null) ||
      box.startTicket ||
      (box.currentTicket != null && box.currentTicket !== '' ? String(box.currentTicket) : null) ||
      '—';

    // CRITICAL: startNum must track yesterdayEnd, NOT box.startTicket. The
    // ticketsSold delta (|start − end|) needs to base off the SAME number
    // shown in the YESTERDAY column. If we used box.startTicket here, a
    // 50-pack with yesterday=11 and today=11 (no sales) would compute as
    // |49 − 11| = 38 sold (49 being the fresh-pack start). Matching the
    // displayed yesterday makes the math reflect what the user sees.
    const yEndForCalc = yesterdayEnd === '—' ? null : parseInt(yesterdayEnd, 10);
    const startNum = (yEndForCalc != null && !Number.isNaN(yEndForCalc))
      ? yEndForCalc
      : parseInt(box.startTicket || box.lastShiftEndTicket || '0', 10);
    const endRaw = endTickets[box.id] || '';
    const endNum = endRaw ? parseInt(endRaw, 10) : null;
    const isSoldout = !!soldout[box.id];
    const price = Number(box.game?.ticketPrice || box.ticketPrice || 0);
    // Tickets sold = |start - end| regardless of direction. User-specified
    // sellDirection on the store keeps start ≥ end (desc) or start ≤ end (asc).
    const ticketsSold = !isSoldout && endNum !== null && !Number.isNaN(endNum)
      ? Math.abs(startNum - endNum)
      : null;
    const calcAmount = ticketsSold !== null ? ticketsSold * price : null;
    // Soldout amount — must match the backend's snapshotSales math so
    // wizard total and back-office total can never diverge:
    //   sold = |yesterdayEnd − sentinel| × price
    //   sentinel = -1 (desc) or totalTickets (asc)
    // (Previously this was box.totalValue (full pack), which over-counted
    // by hundreds of dollars per soldout-with-prior-history book. See
    // Phase 2 doc for the full rationale.)
    const totalT = Number(box.totalTickets || 0);
    const sentinel = sellDirection === 'asc' ? totalT : -1;
    const soldoutTickets = isSoldout && !Number.isNaN(startNum)
      ? Math.abs(startNum - sentinel)
      : null;
    const soldoutAmount = isSoldout && soldoutTickets != null
      ? soldoutTickets * price
      : null;
    const rowComplete = isSoldout || (endNum !== null && !Number.isNaN(endNum));
    return {
      ...box,
      startNum, yesterdayEnd, endNum, isSoldout, price,
      ticketsSold, calcAmount, soldoutTickets, soldoutAmount, rowComplete,
    };
  }), [boxes, endTickets, soldout, yesterdayCloses, sellDirection]);

  const allComplete = boxData.every(b => b.rowComplete);
  const scannedTotal = boxData.reduce((s, b) => s + (b.isSoldout ? (b.soldoutAmount || 0) : (b.calcAmount || 0)), 0);

  // ── Step 2 → numeric online totals (cumulative-day readings off the terminal) ─
  const onlineNums = {
    grossSales:     Number(online.grossSales     || 0),
    cancels:        Number(online.cancels        || 0),
    machineCashing: Number(online.machineCashing || 0),
    couponCash:     Number(online.couponCash     || 0),
    discounts:      Number(online.discounts      || 0),
    instantCashing: Number(online.instantCashing || 0),
  };

  // ── Step 3 → final report totals ────────────────────────────────────────
  // Apr 2026 — Fix #3: per-shift online deltas. The cashier reads CUMULATIVE-
  // DAY totals off the lottery terminal. For Shift 2+, the terminal shows the
  // FULL DAY's running totals — not just this shift's. To compute this
  // shift's drawer contribution correctly, we subtract the previous shift's
  // saved cumulative readings.
  //
  //   Shift 1 of day:  prev = (0, 0, 0, 0, 0, 0)  — no prior shift
  //                    → shift delta = full reading entered by cashier
  //   Shift 2 of day:  prev = Shift 1's saved readings
  //                    → shift delta = current reading − Shift 1's reading
  //
  // The DB still stores the cumulative reading (LotteryOnlineTotal records
  // last-write-wins → end-of-day cumulative = last shift's reading). Only
  // the WIZARD'S DAILY DUE display uses the delta — the cashier sees how
  // much THEIR shift contributed to the drawer.
  const report = useMemo(() => {
    const instantSales = scannedTotal;
    // Per-shift instant cashings = current reading − prev shift's reading
    const instantCashings =
      Math.max(0, onlineNums.instantCashing - (prevShiftReadings.instantCashing || 0));
    // Per-shift online deltas (against prev shift's saved cumulative reading)
    const shiftGross    = Math.max(0, onlineNums.grossSales     - (prevShiftReadings.grossSales || 0));
    const shiftCancels  = Math.max(0, onlineNums.cancels        - (prevShiftReadings.cancels || 0));
    const shiftPays     = Math.max(0, onlineNums.machineCashing - (prevShiftReadings.machineCashing || 0));
    const shiftCoupon   = Math.max(0, onlineNums.couponCash     - (prevShiftReadings.couponCash || 0));
    const shiftDiscount = Math.max(0, onlineNums.discounts      - (prevShiftReadings.discounts || 0));
    // Online sales (net) for THIS shift only = shift gross − shift deductions
    const onlineSalesNet = shiftGross - shiftCancels - shiftPays - shiftCoupon - shiftDiscount;
    // Daily Due = (this shift's instant sales − this shift's instant cashings)
    //           + (this shift's online net)
    const dailyDue = (instantSales - instantCashings) + onlineSalesNet;
    return {
      instantSales,
      instantCashings,
      // Per-field cumulative readings (the raw numbers entered, used for
      // the Step 3 line-item display so cashier sees what they entered)
      grossSales:     onlineNums.grossSales,
      cancels:        onlineNums.cancels,
      machineCashing: onlineNums.machineCashing,
      couponCash:     onlineNums.couponCash,
      discounts:      onlineNums.discounts,
      // Per-shift deltas (used for the Daily Due math)
      shiftGross:    Math.round(shiftGross * 100) / 100,
      shiftCancels:  Math.round(shiftCancels * 100) / 100,
      shiftPays:     Math.round(shiftPays * 100) / 100,
      shiftCoupon:   Math.round(shiftCoupon * 100) / 100,
      shiftDiscount: Math.round(shiftDiscount * 100) / 100,
      // Net machine sales (post-deductions, used for top-line summary).
      // For Shift 1 = full day's online net. For Shift 2 = Shift 2's contribution.
      onlineSalesNet: Math.round(onlineSalesNet * 100) / 100,
      dailyDue:       Math.round(dailyDue * 100) / 100,
    };
  }, [scannedTotal, onlineNums.grossSales, onlineNums.cancels, onlineNums.machineCashing, onlineNums.couponCash, onlineNums.discounts, onlineNums.instantCashing, prevShiftReadings]);

  // ── Step navigation ─────────────────────────────────────────────────────
  const canNext = () => {
    if (step === 0) return allComplete || !scanRequired;
    if (step === 1) return true; // online fields are optional — can be zero
    return true;
  };

  const next = () => setStep(s => Math.min(s + 1, STEPS.length - 1));
  const back = () => setStep(s => Math.max(s - 1, 0));

  // ── Final save ──────────────────────────────────────────────────────────
  const handleConfirm = async () => {
    setSaving(true); setErr('');
    try {
      // 1. Save each soldout flag → flip box to depleted. Surface
      // failures (Session 45 / L8) — the previous swallow-all-errors
      // catch hid cases where the API rejected the soldout (e.g. the
      // book was already depleted/returned/settled).
      const soldoutErrors = [];
      for (const b of boxData) {
        if (b.isSoldout) {
          try {
            await soldoutLotteryBox(b.id, { reason: 'eod_so_button' });
          } catch (e) {
            soldoutErrors.push(`${b.gameNumber || b.gameName || b.id}: ${e?.response?.data?.error || e.message}`);
          }
        }
      }
      if (soldoutErrors.length) {
        // Don't block the rest of the EoD save — but warn the user.
        console.warn('[LotteryShiftModal] some soldout calls failed:', soldoutErrors);
        setErr(`Some soldouts didn't apply:\n${soldoutErrors.slice(0, 3).join('\n')}`);
      }

      // 2. Save day-level online totals (LotteryOnlineTotal — keyed by date)
      // The lottery terminal shows running daily totals — every shift close
      // overwrites this row with the latest cumulative reading. The LAST
      // shift of the day's reading IS the day total.
      const anyOnlineEntered =
        onlineNums.grossSales > 0 || onlineNums.cancels > 0 ||
        onlineNums.machineCashing > 0 || onlineNums.couponCash > 0 ||
        onlineNums.discounts > 0 || onlineNums.instantCashing > 0;
      if (anyOnlineEntered) {
        await upsertLotteryOnlineTotal({
          date:            todayISO(),
          grossSales:      onlineNums.grossSales,
          cancels:         onlineNums.cancels,
          machineCashing:  onlineNums.machineCashing,
          couponCash:      onlineNums.couponCash,
          discounts:       onlineNums.discounts,
          instantCashing:  onlineNums.instantCashing,
          // Legacy "machineSales" — keep populated as the net so older
          // back-office views that still read it stay consistent.
          machineSales:    report.onlineSalesNet,
        }).catch(() => {});
      }

      // 3. Save shift report via onSave callback (parent triggers saveLotteryShiftReport)
      // Per-shift row also stores the SNAPSHOT of cumulative readings so the
      // back-office Shift Reports tab can compute per-shift deltas later.
      const boxScans = boxData.map(b => ({
        boxId:       b.id,
        gameId:      b.gameId,
        gameName:    b.game?.name || 'Unknown',
        slotNumber:  b.slotNumber,
        startTicket: b.startTicket,
        endTicket:   b.isSoldout ? 'SO' : (endTickets[b.id] || null),
        // Apr 2026 — for soldouts, ticketsSold is the delta from yesterday's
        // close to the SO sentinel (matches backend's snapshotSales math).
        // For non-soldouts, the per-row delta as the user entered it.
        // (Was incorrectly `totalTickets − ticketsSold` previously, which
        // double-counted prior-day sales whenever a book had history.)
        ticketsSold: b.isSoldout ? (b.soldoutTickets ?? 0) : b.ticketsSold,
        amount:      b.isSoldout ? b.soldoutAmount : b.calcAmount,
        soldout:     b.isSoldout,
      }));
      // Capture the save response so we can surface backend warnings.
      // The response shape (Apr 2026) is:
      //   { success, data, writeStats: {boxesScanned, boxesUpdated, snapshotsWritten}, warnings }
      // where `warnings` is null on a clean save, or an object with
      // boxUpdateFailures / snapshotInsertFailures / summary when any
      // per-box write didn't land. This is the diagnostic for "I scanned
      // but back-office shows old numbers" — the response now tells the
      // cashier-app exactly what didn't commit.
      const saveResp = await onSave?.({
        shiftId,
        scannedAmount:  scannedTotal,
        boxScans,
        totalSales:     sessionSales,
        totalPayouts:   sessionPayouts,
        // Legacy fields kept for back-compat
        machineAmount:  report.onlineSalesNet,
        digitalAmount:  onlineNums.instantCashing + onlineNums.machineCashing,
        notes:          notes.trim() || undefined,
        // Cumulative-day readings (per-shift snapshot — used by audit view)
        grossSalesReading:     onlineNums.grossSales,
        cancelsReading:        onlineNums.cancels,
        machineCashingReading: onlineNums.machineCashing,
        couponCashReading:     onlineNums.couponCash,
        discountsReading:      onlineNums.discounts,
        instantCashingReading: onlineNums.instantCashing,
      });
      if (saveResp?.warnings) setSaveWarnings(saveResp.warnings);
      if (saveResp?.writeStats) setWriteStats(saveResp.writeStats);

      // 4. Fetch the backend's authoritative daily total — same number
      // the back-office Daily page will show. Lets the cashier see
      // immediately whether their entries match the recorded number.
      // (Apr 2026 — Phase 2 architectural fix: ONE source of truth for
      // the daily total. Wizard's local sum is an estimate; this fetch
      // is canonical.)
      try {
        const inv = await getDailyLotteryInventory({ date: todayISO() });
        setAuthoritativeTotal(inv?.sold ?? null);
      } catch (e) {
        console.warn('[LotteryShiftModal] could not fetch authoritative total', e?.message);
      }
    } catch (e) {
      setErr(e?.response?.data?.error || e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="lsm-backdrop">
      <div className="lsm-modal lsm-modal--wide">

        {/* Header + step indicator */}
        <div className="lsm-header">
          <div className="lsm-header-left">
            <div className="lsm-header-icon"><Ticket size={18} color="#16a34a" /></div>
            <div>
              <div className="lsm-header-title">Lottery End of Shift</div>
              <div className="lsm-header-sub">Step {step + 1} of {STEPS.length} · {STEPS[step]}</div>
            </div>
          </div>
          <button className="lsm-close-btn" onClick={onClose}><X size={20} /></button>
        </div>

        <div className="lsm-steps-bar">
          {STEPS.map((s, i) => (
            <button
              key={s}
              type="button"
              className={`lsm-step-pill ${i === step ? 'lsm-step-pill--active' : ''} ${i < step ? 'lsm-step-pill--done' : ''}`}
              onClick={() => { if (i < step) setStep(i); }}
            >
              {i < step ? <Check size={11} /> : <span className="lsm-step-num">{i + 1}</span>}
              <span>{s}</span>
            </button>
          ))}
        </div>

        <div className="lsm-body">

          {pendingShiftClose && (
            <div className="lsm-pending-close-banner">
              <AlertCircle size={16} />
              Scan required before closing the shift. Complete reconciliation to proceed.
            </div>
          )}

          {err && <div className="lsm-pending-close-banner" style={{ background: 'rgba(239,68,68,.12)', borderColor: 'rgba(239,68,68,.3)', color: '#dc2626' }}>{err}</div>}

          {/* ── STEP 1: Counter Scan ─────────────────────────────────── */}
          {step === 0 && (
            <>
              {/* Scan bar */}
              <div className="lsm-scan-bar">
                <ScanLine size={18} />
                <input
                  ref={scanInputRef}
                  className="lsm-scan-input-main"
                  type="text"
                  placeholder="Scan the next-to-sell ticket of each active book…"
                  value={scanValue}
                  onChange={e => setScanValue(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleScan(scanValue); }}
                  inputMode="numeric"
                />
                <button
                  type="button"
                  className="lsm-scan-submit"
                  onClick={() => handleScan(scanValue)}
                  disabled={!scanValue.trim()}
                >Scan</button>
              </div>

              {scanLog.length > 0 && (
                <div className="lsm-scan-log">
                  {scanLog.map((l, i) => (
                    <div key={i} className={`lsm-scan-log-row ${l.ok ? 'lsm-scan-log-row--ok' : 'lsm-scan-log-row--err'}`}>
                      <span>{l.t}</span><span>{l.msg}</span>
                    </div>
                  ))}
                </div>
              )}

              {boxData.length === 0 ? (
                <div className="lsm-empty">No active books on the counter.</div>
              ) : (
                <>
                  <div className="lsm-sort-hint">
                    Sorted by slot number · {boxData.filter(b => b.rowComplete).length} / {boxData.length} complete
                  </div>

                  <div className="lsm-book-table">
                    <div className="lsm-book-head">
                      <span>Game</span>
                      <span>Price</span>
                      <span>Yesterday</span>
                      <span>Today</span>
                      <span>Sold</span>
                      <span>Amount</span>
                      <span></span>
                    </div>
                    {boxData.map(b => (
                      <div key={b.id} className={`lsm-book-row ${b.rowComplete ? 'lsm-book-row--done' : ''} ${b.isSoldout ? 'lsm-book-row--soldout' : ''}`}>
                        {/* Apr 2026 — book number gets visual priority so the
                            cashier can quickly cross-reference the physical
                            book against this row. Game name kept secondary
                            since slot+book# is what cashiers scan against. */}
                        <span className="lsm-book-game">
                          <strong className="lsm-book-no">
                            #{b.boxNumber || '—'}
                            {b.slotNumber ? <span className="lsm-book-slot"> · slot {b.slotNumber}</span> : null}
                          </strong>
                          <small>{b.game?.name || 'Unknown'}</small>
                        </span>
                        <span className="lsm-book-price">{fmt(b.price)}</span>
                        <span className="lsm-book-yest">{b.yesterdayEnd}</span>
                        <span className="lsm-book-today">
                          <input
                            type="text"
                            inputMode="numeric"
                            disabled={b.isSoldout}
                            placeholder="scan or type"
                            value={endTickets[b.id] || ''}
                            onChange={e => setEndTickets(prev => ({ ...prev, [b.id]: numInput(e.target.value) }))}
                          />
                        </span>
                        {/* Show ACTUAL ticket count for soldouts (not "ALL")
                            so cashier sees exactly what's being attributed to
                            today's sale. e.g., a book with yesterday=1 and
                            SO clicked → "2 SO" (2 tickets sold today via the
                            soldout sentinel) — matches the dollar amount the
                            backend will record. */}
                        <span className="lsm-book-sold">
                          {b.isSoldout
                            ? (b.soldoutTickets != null ? `${b.soldoutTickets} SO` : 'SO')
                            : (b.ticketsSold ?? '—')}
                        </span>
                        <span className="lsm-book-amt">{b.isSoldout ? fmtL(b.soldoutAmount) : (b.calcAmount !== null ? fmtL(b.calcAmount) : '—')}</span>
                        <span className="lsm-book-actions">
                          <button
                            type="button"
                            className={`lsm-soldout-btn ${b.isSoldout ? 'lsm-soldout-btn--active' : ''}`}
                            onClick={() => toggleSoldout(b.id)}
                            title="Mark entire book as sold out"
                          >
                            SO
                          </button>
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="lsm-total-strip">
                    <span>Instant Sales Total (from counter scans)</span>
                    <strong>{fmtL(scannedTotal)}</strong>
                  </div>
                </>
              )}
            </>
          )}

          {/* ── STEP 2: Online Sales ─────────────────────────────────── */}
          {/* Six cumulative-day readings off the lottery terminal. Cashier
              enters whatever the machine display shows — these are running
              daily totals, not per-shift activity. Per-shift deltas are
              computed later in the back-office audit view. */}
          {step === 1 && (
            <div className="lsm-online-grid">
              <div className="lsm-online-section-hint">
                Enter the cumulative day totals exactly as shown on the lottery terminal printout.
                These are <strong>running totals for today</strong>, not just your shift.
              </div>
              {hasPreviousShift && (
                <div className="lsm-online-shift2-hint">
                  ⓘ A previous shift already closed today (gross&nbsp;{fmtL(prevShiftReadings.grossSales)},
                  pays&nbsp;{fmtL(prevShiftReadings.machineCashing)}). Your shift's contribution
                  is auto-computed as the delta — your Daily Due reflects YOUR shift only.
                </div>
              )}

              <OnlineField
                label="Gross Sales"
                hint="Total online machine sales for today"
                value={online.grossSales}
                onChange={v => setOnline(p => ({ ...p, grossSales: v }))}
              />
              <OnlineField
                label="Cancels"
                hint="Cancelled / voided online tickets"
                value={online.cancels}
                onChange={v => setOnline(p => ({ ...p, cancels: v }))}
              />
              <OnlineField
                label="Pays / Cashes"
                hint="Online winnings paid from the drawer"
                value={online.machineCashing}
                onChange={v => setOnline(p => ({ ...p, machineCashing: v }))}
              />
              <OnlineField
                label="Coupon Cash"
                hint="Coupons redeemed against online sales"
                value={online.couponCash}
                onChange={v => setOnline(p => ({ ...p, couponCash: v }))}
              />
              <OnlineField
                label="Discounts"
                hint="Discounts given on online tickets"
                value={online.discounts}
                onChange={v => setOnline(p => ({ ...p, discounts: v }))}
              />
              <OnlineField
                label="Instant Pays / Cashes"
                hint="Scratch-off winnings paid from the drawer"
                value={online.instantCashing}
                onChange={v => setOnline(p => ({ ...p, instantCashing: v }))}
              />

              <div className="lsm-online-preview">
                <div>
                  <span>Online Sales (net)</span>
                  <strong>{fmtL(report.onlineSalesNet)}</strong>
                </div>
                <div className="lsm-online-formula-hint">
                  Gross − Cancels − Pays/Cashes − Coupon − Discounts
                </div>
              </div>
              <div className="lsm-online-preview">
                <div>
                  <span>Daily Due Running Total</span>
                  <strong>{fmtL(report.dailyDue)}</strong>
                </div>
                <div className="lsm-online-formula-hint">
                  (Instant sales − Instant cashings) + Online sales (net)
                </div>
              </div>
            </div>
          )}

          {/* ── STEP 3: Confirm ──────────────────────────────────────── */}
          {step === 2 && (
            <div className="lsm-confirm">
              <div className="lsm-confirm-head">Final Report</div>

              <div className="lsm-confirm-grid">
                <ReportRow label="Instant Sales (scanned)"   value={fmtL(report.instantSales)}    good />
                <ReportRow label="Instant Pays / Cashes"     value={fmtL(report.instantCashings)} warn />
                <ReportRow label="Gross Sales"               value={fmtL(report.grossSales)}     good />
                <ReportRow label="Cancels"                   value={fmtL(report.cancels)}        warn />
                <ReportRow label="Pays / Cashes"             value={fmtL(report.machineCashing)} warn />
                <ReportRow label="Coupon Cash"               value={fmtL(report.couponCash)}     warn />
                <ReportRow label="Discounts"                 value={fmtL(report.discounts)}      warn />
                <ReportRow label="Online Sales (net)"        value={fmtL(report.onlineSalesNet)} good />
              </div>

              <div className="lsm-formula">
                Daily Due = (Instant sales − Instant cashings) + Online sales (net)
              </div>

              <div className="lsm-grand-due">
                <span>Total Due to Lottery</span>
                <strong className={report.dailyDue >= 0 ? '' : 'lsm-grand-due--neg'}>
                  {fmtL(report.dailyDue)}
                </strong>
              </div>

              {/* Apr 2026 — Save warnings strip. Shown when the backend
                  reports per-box update or snapshot-insert failures during
                  saveLotteryShiftReport. Without this, those failures
                  would be silently logged on the server and the cashier
                  would think everything saved (= the "back-office shows
                  old ticket numbers" bug). */}
              {saveWarnings && (
                <div className="lsm-save-warnings">
                  <div className="lsm-save-warnings-head">
                    ⚠ Save partially failed
                  </div>
                  <div className="lsm-save-warnings-summary">
                    {saveWarnings.summary}
                  </div>
                  {saveWarnings.boxUpdateFailures?.length > 0 && (
                    <div className="lsm-save-warnings-list">
                      <strong>Box updates that didn't commit:</strong>
                      <ul>
                        {saveWarnings.boxUpdateFailures.slice(0, 5).map((f, i) => (
                          <li key={i}>
                            <code>{f.boxId.slice(-8)}</code> → ticket {f.attemptedTicket}: {f.error}
                          </li>
                        ))}
                        {saveWarnings.boxUpdateFailures.length > 5 && (
                          <li>… and {saveWarnings.boxUpdateFailures.length - 5} more</li>
                        )}
                      </ul>
                    </div>
                  )}
                  {saveWarnings.snapshotInsertFailures?.length > 0 && (
                    <div className="lsm-save-warnings-list">
                      <strong>Snapshot writes that didn't commit:</strong>
                      <ul>
                        {saveWarnings.snapshotInsertFailures.slice(0, 5).map((f, i) => (
                          <li key={i}>
                            <code>{f.boxId.slice(-8)}</code>: {f.error}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="lsm-save-warnings-tip">
                    The back-office may show stale data for these boxes. Tell your manager.
                  </div>
                </div>
              )}

              {/* Apr 2026 — Write stats. Always shown when save succeeded
                  (even on clean save) so cashier sees the count of what
                  was committed. Useful confirmation. */}
              {writeStats && !saveWarnings && (
                <div className="lsm-write-stats">
                  ✓ Saved {writeStats.boxesUpdated} of {writeStats.boxesScanned} books · {writeStats.snapshotsWritten} snapshot{writeStats.snapshotsWritten === 1 ? '' : 's'} written
                </div>
              )}

              {/* Post-save reconciliation strip (Apr 2026 — Phase 2).
                  Shows the AUTHORITATIVE daily total fetched from the
                  backend after save, so the cashier can verify their
                  entries match the recorded number that will appear in
                  the back-office Daily page tomorrow. If wizard total
                  and authoritative differ, surfaces the variance. */}
              {authoritativeTotal != null && (
                <div className={`lsm-auth-total ${
                  Math.abs(Number(authoritativeTotal) - report.instantSales) > 0.01
                    ? 'lsm-auth-total--diff'
                    : 'lsm-auth-total--match'
                }`}>
                  <div className="lsm-auth-total-row">
                    <span>Recorded by system (Instant Sales)</span>
                    <strong>{fmtL(authoritativeTotal)}</strong>
                  </div>
                  {Math.abs(Number(authoritativeTotal) - report.instantSales) > 0.01 && (
                    <div className="lsm-auth-total-hint">
                      Differs from your scan total ({fmtL(report.instantSales)}) by{' '}
                      {fmtL(Math.abs(Number(authoritativeTotal) - report.instantSales))}.
                      The recorded number is what appears in back-office reports.
                    </div>
                  )}
                </div>
              )}

              <input
                type="text"
                placeholder="Notes (optional)"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                className="lsm-notes-input"
              />
            </div>
          )}

          {/* Step navigation */}
          <div className="lsm-wizard-nav">
            {step > 0 && (
              <button type="button" className="lsm-btn-back" onClick={back} disabled={saving}>
                <ChevronLeft size={14} /> Back
              </button>
            )}
            <div className="lsm-nav-spacer" />

            {step < STEPS.length - 1 && (
              <button
                type="button"
                className={`lsm-btn-next ${canNext() ? '' : 'lsm-btn-next--disabled'}`}
                disabled={!canNext()}
                onClick={next}
                title={!canNext() ? 'Every active book must have a today-end ticket OR be marked Soldout before you can continue' : undefined}
              >
                Next <ChevronRight size={14} />
              </button>
            )}

            {step === STEPS.length - 1 && (
              <button
                type="button"
                className={`lsm-btn-save ${saving ? 'lsm-btn-save--disabled' : 'lsm-btn-save--active'}`}
                disabled={saving}
                onClick={handleConfirm}
              >
                {saving ? 'Saving…' : pendingShiftClose ? 'Save & Continue to Close Shift' : 'Save & Close Lottery'}
              </button>
            )}
          </div>

          {step === 0 && scanRequired && !allComplete && (
            <div className="lsm-scan-required-msg">
              Every active book needs a today-end ticket OR a Soldout mark before you can continue
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────── */

function OnlineField({ label, hint, value, onChange }) {
  return (
    <div className="lsm-online-field">
      <label>{label}</label>
      <div className="lsm-online-input">
        <span>$</span>
        <input
          type="number"
          step="0.01"
          min="0"
          placeholder="0.00"
          value={value}
          onChange={e => onChange(e.target.value)}
        />
      </div>
      <small>{hint}</small>
    </div>
  );
}

function ReportRow({ label, value, good, warn }) {
  return (
    <div className={`lsm-report-row ${good ? 'lsm-report-row--good' : ''} ${warn ? 'lsm-report-row--warn' : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
