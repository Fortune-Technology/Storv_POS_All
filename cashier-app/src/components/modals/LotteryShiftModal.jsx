/**
 * LotteryShiftModal — End-of-shift lottery reconciliation wizard (Phase 3g).
 *
 * 3-step flow per user spec:
 *   1. Counter Scan — active books sorted by ticket value high → low.
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
import { scanLotteryBarcode, upsertLotteryOnlineTotal, getLotteryBoxes, soldoutLotteryBox } from '../../api/pos';
import './LotteryShiftModal.css';

const fmt = (n) => `$${Number(n || 0).toFixed(2)}`;
const numInput = (v) => String(v || '').replace(/[^0-9]/g, '');
const todayISO = () => new Date().toISOString().slice(0, 10);

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
  const scanInputRef = useRef(null);

  // Load active boxes + sort by ticket value desc when the modal opens
  useEffect(() => {
    if (!open) return;
    const sorted = [...(activeBoxes || [])].sort((a, b) => {
      const va = Number(a.totalValue || (a.totalTickets || 0) * (a.game?.ticketPrice || a.ticketPrice || 0));
      const vb = Number(b.totalValue || (b.totalTickets || 0) * (b.game?.ticketPrice || b.ticketPrice || 0));
      return vb - va;
    });
    setBoxes(sorted);
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
          // New book from safe — add to the list
          setBoxes(prev => prev.some(b => b.id === boxId) ? prev : [...prev, res.box].sort((a, b) => {
            const va = Number(a.totalValue || 0), vb = Number(b.totalValue || 0);
            return vb - va;
          }));
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

  const toggleSoldout = (boxId) => {
    setSoldout(prev => ({ ...prev, [boxId]: !prev[boxId] }));
  };

  // ── Per-box computed data ───────────────────────────────────────────────
  const boxData = useMemo(() => boxes.map(box => {
    const startNum = parseInt(box.startTicket || box.lastShiftEndTicket || '0', 10);
    const yesterdayEnd = box.lastShiftEndTicket || box.startTicket || '—';
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
    // If soldout, assume 100% sold for accounting.
    const soldoutAmount = isSoldout ? Number(box.totalValue || 0) : null;
    const rowComplete = isSoldout || (endNum !== null && !Number.isNaN(endNum));
    return {
      ...box,
      startNum, yesterdayEnd, endNum, isSoldout, price,
      ticketsSold, calcAmount, soldoutAmount, rowComplete,
    };
  }), [boxes, endTickets, soldout]);

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
  const report = useMemo(() => {
    const instantSales    = scannedTotal;
    const instantCashings = onlineNums.instantCashing;
    // Online sales (net) = gross − cancels − pays/cashes − coupon − discounts
    // Matches the back-office Online Sales formula.
    const onlineSalesNet =
      onlineNums.grossSales -
      onlineNums.cancels -
      onlineNums.machineCashing -
      onlineNums.couponCash -
      onlineNums.discounts;
    // Daily Due = (Instant sales − Instant cashings) + Online sales (net)
    const dailyDue = (instantSales - instantCashings) + onlineSalesNet;
    return {
      instantSales,
      instantCashings,
      // Per-field cumulative readings (snapshotted at this shift close)
      grossSales:     onlineNums.grossSales,
      cancels:        onlineNums.cancels,
      machineCashing: onlineNums.machineCashing,
      couponCash:     onlineNums.couponCash,
      discounts:      onlineNums.discounts,
      // Net machine sales (post-deductions, used for top-line summary)
      onlineSalesNet: Math.round(onlineSalesNet * 100) / 100,
      dailyDue:       Math.round(dailyDue * 100) / 100,
    };
  }, [scannedTotal, onlineNums.grossSales, onlineNums.cancels, onlineNums.machineCashing, onlineNums.couponCash, onlineNums.discounts, onlineNums.instantCashing]);

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
        ticketsSold: b.isSoldout ? (Number(b.totalTickets) - (b.ticketsSold || 0)) : b.ticketsSold,
        amount:      b.isSoldout ? b.soldoutAmount : b.calcAmount,
        soldout:     b.isSoldout,
      }));
      await onSave?.({
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
                    Sorted by ticket value (highest first) · {boxData.filter(b => b.rowComplete).length} / {boxData.length} complete
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
                        <span className="lsm-book-game">
                          <strong>{b.game?.name || 'Unknown'}</strong>
                          <small>Book {b.boxNumber || '—'}{b.slotNumber ? ` · Slot ${b.slotNumber}` : ''}</small>
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
                        <span className="lsm-book-sold">{b.isSoldout ? 'ALL' : (b.ticketsSold ?? '—')}</span>
                        <span className="lsm-book-amt">{b.isSoldout ? fmt(b.soldoutAmount) : (b.calcAmount !== null ? fmt(b.calcAmount) : '—')}</span>
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
                    <strong>{fmt(scannedTotal)}</strong>
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
                  <strong>{fmt(report.onlineSalesNet)}</strong>
                </div>
                <div className="lsm-online-formula-hint">
                  Gross − Cancels − Pays/Cashes − Coupon − Discounts
                </div>
              </div>
              <div className="lsm-online-preview">
                <div>
                  <span>Daily Due Running Total</span>
                  <strong>{fmt(report.dailyDue)}</strong>
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
                <ReportRow label="Instant Sales (scanned)"   value={fmt(report.instantSales)}    good />
                <ReportRow label="Instant Pays / Cashes"     value={fmt(report.instantCashings)} warn />
                <ReportRow label="Gross Sales"               value={fmt(report.grossSales)}     good />
                <ReportRow label="Cancels"                   value={fmt(report.cancels)}        warn />
                <ReportRow label="Pays / Cashes"             value={fmt(report.machineCashing)} warn />
                <ReportRow label="Coupon Cash"               value={fmt(report.couponCash)}     warn />
                <ReportRow label="Discounts"                 value={fmt(report.discounts)}      warn />
                <ReportRow label="Online Sales (net)"        value={fmt(report.onlineSalesNet)} good />
              </div>

              <div className="lsm-formula">
                Daily Due = (Instant sales − Instant cashings) + Online sales (net)
              </div>

              <div className="lsm-grand-due">
                <span>Total Due to Lottery</span>
                <strong className={report.dailyDue >= 0 ? '' : 'lsm-grand-due--neg'}>
                  {fmt(report.dailyDue)}
                </strong>
              </div>

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
