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
import {
  Calendar, ChevronLeft, ChevronRight, Info, Loader2, MoreVertical, Package,
  Play, RotateCcw, ScanLine, Ticket, Trash2, X, Archive, Undo2,
} from 'lucide-react';
import {
  getLotteryBoxes, getLotteryGames, getDailyLotteryInventory,
  getLotteryOnlineTotal, upsertLotteryOnlineTotal, getLotteryCatalog,
  receiveLotteryBoxOrder, returnLotteryBoxToLotto, updateLotteryBox,
  scanLotteryBarcode, parseLotteryBarcode, closeLotteryDay,
  listPosShifts, getLotterySettings,
  soldoutLotteryBox, moveLotteryBoxToSafe, activateLotteryBox, deleteLotteryBox,
  getLotteryCounterSnapshot,
} from '../services/api';
import './LotteryBackOffice.css';

const fmtMoney = (n) => n == null ? '$0.00' : `$${Number(n).toFixed(2)}`;
const fmtInt   = (n) => n == null ? '0' : Number(n).toLocaleString();
const todayStr = () => new Date().toISOString().slice(0, 10);
const pad2     = (n) => String(n).padStart(2, '0');
const toDateStr = (d) => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;

// ════════════════════════════════════════════════════════════════════
// Main page
// ════════════════════════════════════════════════════════════════════
export default function LotteryBackOffice() {
  const [searchParams, setSearchParams] = useSearchParams();

  // ── Date + mode (URL-backed so refresh preserves state)
  const urlDate  = searchParams.get('date') || todayStr();
  const urlPane  = searchParams.get('pane') || 'safe';
  const urlMode  = searchParams.get('mode');
  const [scanMode, setScanModeState] = useState(urlMode !== 'manual');   // default scan

  const setDate = (d) => {
    const n = new URLSearchParams(searchParams);
    if (d && d !== todayStr()) n.set('date', d); else n.delete('date');
    setSearchParams(n, { replace: true });
  };
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
    setOnline({
      instantCashing: Number(ot?.instantCashing || 0),
      machineSales:   Number(ot?.machineSales   || 0),
      machineCashing: Number(ot?.machineCashing || 0),
      notes:          ot?.notes || '',
    });
    setSettings(sets);
    setGames(Array.isArray(gs) ? gs : gs?.games || []);
    setCatalog(Array.isArray(cat) ? cat : cat?.data || []);
    // Cash balance for this day = sum of closed shifts' cash-collected
    const shiftList = Array.isArray(shifts) ? shifts : (shifts?.shifts || []);
    const cashSum = shiftList.reduce((s, sh) => s + Number(sh.cashSales || 0) - Number(sh.cashRefunds || 0), 0);
    setCashBalance(Math.round(cashSum * 100) / 100);
  }, [date]);

  useEffect(() => { setLoading(true); load().finally(() => setLoading(false)); }, [load]);

  // Auto-focus scan input when we're on a scan-driven pane
  useEffect(() => {
    if (scanMode && (rightPane === 'safe' || rightPane === 'receive')) {
      setTimeout(() => scanRef.current?.focus(), 100);
    }
  }, [scanMode, rightPane]);

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
      await updateLotteryBox(boxId, { currentTicket: String(draft) });
      await load();
    } catch (e) {
      showToast(e?.response?.data?.error || e.message, 'error');
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
        if (!window.confirm(`Mark ${box.game?.name || 'book'} ${box.boxNumber} as sold out?`)) return;
        await soldoutLotteryBox(box.id, { reason: 'manual_mark_soldout' });
        showToast('Book marked sold out');
      } else if (kind === 'safe') {
        await moveLotteryBoxToSafe(box.id, { date: todayStr() });
        showToast('Book moved back to safe');
      } else if (kind === 'activate') {
        // Quick activate from Safe — uses defaults. ActivateBoxModal on the
        // advanced page is available for full control (slot, date override).
        await activateLotteryBox(box.id, {});
        showToast('Book activated on counter');
      } else if (kind === 'return-ui') {
        // Open the Return drawer on the right column, prefilled for this box
        setRightPane('return');
        window.dispatchEvent(new CustomEvent('lbo-return-preselect', { detail: { boxId: box.id } }));
      } else if (kind === 'return') {
        // Quick full-return (no partial — route through return-ui for partials)
        if (!window.confirm(`Return ${box.game?.name} Book ${box.boxNumber} to lottery commission?`)) return;
        await returnLotteryBoxToLotto(box.id, { returnType: 'full' });
        showToast('Book returned');
      } else if (kind === 'delete') {
        if (!window.confirm(`Delete ${box.game?.name} Book ${box.boxNumber}? This cannot be undone.`)) return;
        await deleteLotteryBox(box.id);
        showToast('Book deleted');
      }
      await load();
    } catch (e) {
      showToast(e?.response?.data?.error || e.message, 'error');
    }
  };

  // ── Machine totals save ─────────────────────────────────────────────
  const saveOnline = async () => {
    setSaving(true);
    try {
      await upsertLotteryOnlineTotal({ date, ...online });
      showToast('Machine totals saved', 'ok');
    } catch (e) {
      showToast(e?.response?.data?.error || e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  // ── Close the day ───────────────────────────────────────────────────
  const runCloseDay = async () => {
    if (!window.confirm(`Close the lottery day for ${date}?`)) return;
    setSaving(true);
    try {
      await upsertLotteryOnlineTotal({ date, ...online }).catch(() => {});
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
  const counterSorted = useMemo(() =>
    [...active].sort((a, b) => {
      const va = Number(a.totalValue || 0);
      const vb = Number(b.totalValue || 0);
      if (vb !== va) return vb - va;
      return (a.slotNumber || 999) - (b.slotNumber || 999);
    }),
  [active]);

  const instantSalesAuto = Number(inventory?.sold || 0);
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
      </div>

      {loading && !inventory ? (
        <div className="lbo-loading"><Loader2 className="lbo-spin" size={18} /> Loading lottery data…</div>
      ) : (
        <div className="lbo-grid">
              {/* ─────────────────── LEFT COLUMN: REPORT ─────────────────── */}
              <section className="lbo-col lbo-col-report">
                <div className="lbo-col-title">Report</div>

                <Metric label="Cash Balance" value={fmtMoney(cashBalance)} big accent="green" sub="Auto from closed shifts today" />

                <Section title="Online Sales" total={
                  fmtMoney(
                    Number(manualSales.gross) - Number(manualSales.cancels) - Number(online.machineCashing) + Number(online.machineSales) - Number(manualSales.coupon) - Number(manualSales.discounts)
                  )}>
                  <EditableField label="Gross Sales"     value={manualSales.gross}    onChange={v => setManualSales({...manualSales, gross: v})} />
                  <EditableField label="Cancels"         value={manualSales.cancels}  onChange={v => setManualSales({...manualSales, cancels: v})} />
                  <EditableField label="Pays/Cashes"     value={online.machineCashing} onChange={v => setOnline({...online, machineCashing: v})} />
                  <EditableField label="Coupon Cash"     value={manualSales.coupon}   onChange={v => setManualSales({...manualSales, coupon: v})} />
                  <EditableField label="Discounts"       value={manualSales.discounts} onChange={v => setManualSales({...manualSales, discounts: v})} />
                </Section>

                <Section title="Instant Sales" total={fmtMoney(instantSalesAuto - Number(online.instantCashing))} totalAccent="green">
                  <ReadonlyField label="Today Sold" value={fmtMoney(instantSalesAuto)} note="Auto — from POS" />
                  <EditableField label="Pays/Cashes" value={online.instantCashing} onChange={v => setOnline({...online, instantCashing: v})} />
                </Section>

                <Section title="Scratchoff Counts">
                  <ReadonlyField label="Received"     value={fmtMoney(inventory?.received || 0)} />
                  <ReadonlyField label="Activated"    value={fmtInt(inventory?.activated || 0)} units="books" />
                  <ReadonlyField label="Partial Rtn"  value={fmtMoney(inventory?.returnPart || 0)} />
                  <ReadonlyField label="Full Rtn"     value={fmtMoney(inventory?.returnFull || 0)} />
                  <ReadonlyField label="End Inv."     value={fmtMoney(inventory?.end || 0)} accent="green" />
                </Section>

                <div className="lbo-actions">
                  <button className={`lbo-btn ${rightPane === 'receive' ? 'lbo-btn-primary' : 'lbo-btn-outline'}`} onClick={() => setRightPane(rightPane === 'receive' ? 'safe' : 'receive')}>
                    <Package size={14} /> Receive Books
                  </button>
                  <button className={`lbo-btn ${rightPane === 'return' ? 'lbo-btn-warn' : 'lbo-btn-outline'}`} onClick={() => setRightPane(rightPane === 'return' ? 'safe' : 'return')}>
                    <RotateCcw size={14} /> Return Books
                  </button>
                </div>

                <ModeToggle scanMode={scanMode} onChange={setScanMode} />

                <button className="lbo-btn lbo-btn-primary lbo-btn-full" onClick={saveOnline} disabled={saving}>
                  {saving ? 'Saving…' : 'Save Machine Totals'}
                </button>
                <button className="lbo-btn lbo-btn-success lbo-btn-full" onClick={runCloseDay} disabled={saving}>
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
                  {counterSorted.length === 0 && <div className="lbo-empty">No active books on the counter.</div>}
                  {counterSorted.map(b => (
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
                    onClose={() => setRightPane('safe')}
                    onSaved={() => { setRightPane('safe'); load(); }}
                  />
                )}
                {rightPane === 'return' && (
                  <ReturnPanel
                    active={active}
                    safe={safe}
                    onClose={() => setRightPane('safe')}
                    onSaved={() => { setRightPane('safe'); load(); }}
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
  const dirty = !historicalView && draft !== undefined && String(draft) !== String(box.currentTicket ?? '');

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

  return (
    <div className={`lbo-cnt-row ${dirty ? 'dirty' : ''}`}>
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
          className="lbo-cnt-slot lbo-cnt-slot-click"
          onClick={() => setEditingSlot(true)}
          title="Click to edit slot number"
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
          disabled={historicalView || (scanMode && !dirty && !isToday)}
          title={historicalView ? `Closed at ${todayVal || '—'} on this date (read-only)` : undefined}
        />
      </span>
      <span className="lbo-cnt-sold">{sold || ''}</span>
      <span className="lbo-cnt-amt">{amt > 0 ? fmtMoney(amt) : ''}</span>
      <span className="lbo-cnt-act">
        {historicalView ? (
          <span className="lbo-cnt-histpill" title="Viewing a past date">HIST</span>
        ) : dirty ? (
          <button onClick={onSave} className="lbo-cnt-save" title="Save">✓</button>
        ) : (
          <ActionMenu
            items={[
              { key: 'so',     label: 'Mark Sold Out (SO)', icon: Archive,   onClick: onSoldout },
              { key: 'return', label: 'Return to Lottery',  icon: RotateCcw, onClick: onReturn },
              { key: 'safe',   label: 'Move to Safe',       icon: Package,   onClick: onMoveToSafe },
              { separator: true },
              { key: 'slot',   label: 'Change Slot Number', icon: Ticket,    onClick: () => setEditingSlot(true) },
              { key: 'rename', label: 'Edit Book Number',   icon: Ticket,    onClick: () => setEditingBookNo(true) },
            ]}
          />
        )}
      </span>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Book List — used on right column for Safe / Soldout / Returned.
// Each row has an action menu appropriate to the list's status.
// ════════════════════════════════════════════════════════════════════
function BookList({ books, emptyMsg, variant, onAction }) {
  const sorted = [...books].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
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
        { key: 'return', label: 'Return to Lottery', icon: RotateCcw, onClick: () => onAction?.('return', b) },
      ];
    }
    if (variant === 'returned') {
      // Returned books are terminal — view only. No actions.
      return [];
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
            Total <strong>{fmtMoney(total)}</strong>
          </div>
          {sorted.map(b => {
            const menu = menuFor(b);
            return (
              <div key={b.id} className="lbo-right-row">
                <PackPill price={Number(b.ticketPrice || 0)} />
                <span className="lbo-right-book">
                  <strong>{b.game?.gameNumber || '—'}-{b.boxNumber || '—'}</strong>
                  <small>{b.game?.name || ''}</small>
                </span>
                <span className="lbo-right-date">{fmtDateShort(b.createdAt)}</span>
                <span className="lbo-right-amt">{fmtMoney(b.totalValue)}</span>
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
function ReceivePanel({ games, catalog, onClose, onSaved }) {
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
      setItems(arr => [...arr, {
        key: dedup,
        source: game ? 'game' : 'catalog',
        gameId: game?.id, catalogTicketId: catRow?.id,
        state: parsed.state, gameNumber: parsed.gameNumber,
        gameName, bookNumber: parsed.bookNumber,
        ticketPrice, totalTickets, value,
      }]);
      setInfo(`✓ Added ${gameName} Book ${parsed.bookNumber} · pack ${totalTickets} · ${fmtMoney(value)}`);
    } catch (e) {
      setErr(e?.response?.data?.error || e.message);
    } finally {
      setTimeout(() => scanRef.current?.focus(), 0);
    }
  };

  const remove = (key) => setItems(arr => arr.filter(i => i.key !== key));
  const clearAll = () => { if (window.confirm(`Clear ${items.length} books?`)) setItems([]); };

  const confirm = async () => {
    if (items.length === 0) return;
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
            <button className="lbo-btn lbo-btn-primary" onClick={confirm} disabled={saving}>
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
function ReturnPanel({ active, safe, onClose, onSaved }) {
  const boxes = [...active, ...safe];
  const [pickId, setPickId] = useState('');
  const [kind, setKind]     = useState('full');   // 'full' | 'partial'
  const [ticketsSold, setTicketsSold] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState('');

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
  const soldN = kind === 'partial' ? Number(ticketsSold || 0) : 0;
  const unsold = Math.max(0, total - soldN);
  const unsoldValue = unsold * price;

  const submit = async () => {
    if (!pick) return;
    if (kind === 'partial') {
      if (!Number.isFinite(soldN) || soldN < 0 || soldN > total) {
        setErr(`Tickets sold must be between 0 and ${total}`); return;
      }
    }
    if (!window.confirm(`Return ${pick.game?.name} Book ${pick.boxNumber}?\n\n${kind === 'partial' ? `${soldN} sold · ${unsold} unsold → ${fmtMoney(unsoldValue)} deducted from settlement` : 'Full return'}`)) return;
    setSaving(true); setErr('');
    try {
      const body = { reason: reason || null, returnType: kind };
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
              onChange={e => setTicketsSold(e.target.value)}
              placeholder={`0 – ${total}`}
            />
            <small className="lbo-field-hint">
              Book has {total} tickets. Enter how many were sold before physical return.
              {Number.isFinite(soldN) && soldN > 0 && soldN <= total && (
                <> <strong>{unsold} tickets unsold · {fmtMoney(unsoldValue)} credited back</strong></>
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
