/**
 * LotteryDailyScan — RENAMED IN PURPOSE to "End of Day" (file kept to
 * preserve existing imports; the tab label in Lottery.jsx now reads
 * "End of Day").
 *
 * Option A collapse (April 2026): the old 5-step wizard (Reports / Receive /
 * Return / Counter / Close) was almost entirely duplicates of top-level tabs
 * and modals elsewhere in the Lottery module. Stripped down to 3 sections:
 *
 *   1. Scratchoff Inventory  — live math summary for the selected day
 *   2. Daily Machine Totals  — the 3 numbers off the state terminal printout
 *                              (instantCashing, machineSales, machineCashing)
 *                              plus a notes field, with a Save button.
 *   3. Open Shifts           — any cashier shift that's still open at the
 *                              active store. Manager can close one from
 *                              back office when the cashier forgot (reuses
 *                              the existing /pos-terminal/shift/:id/close
 *                              endpoint).
 *   4. Close the Day         — executes any pending scheduled book moves,
 *                              snapshots counter ticket positions to the
 *                              audit log, and upserts today's online-total
 *                              record. Idempotent.
 *
 * Receive / Return / per-book Counter scans were REMOVED — the Receive
 * Books modal (Scan + Manual tabs), the Counter tab (which now shows
 * current tickets), and the cashier-app LotteryShiftModal (Phase 3g EoD
 * wizard) already cover those paths.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useConfirm } from '../hooks/useConfirmDialog.jsx';
import { CheckCircle2, Info, Loader2, Lock, Plus, ScanLine, Ticket, Wallet, X } from 'lucide-react';
import {
  getLotteryOnlineTotal, upsertLotteryOnlineTotal,
  getDailyLotteryInventory, closeLotteryDay,
  listPosShifts, closePosShift, openPosShift, listPosStations,
  getLotteryBoxes, updateLotteryBox, scanLotteryBarcode,
  getStoreEmployees,
} from '../services/api';

const fmtMoney = (n) => n == null ? '$0.00' : `$${Number(n).toFixed(2)}`;
// Browser-local "today" — NOT UTC. `new Date().toISOString().slice(0, 10)`
// returned UTC date, breaking the date filter after ~8pm in Western timezones
// (page opened to tomorrow → empty data).
const pad2 = (n) => String(n).padStart(2, '0');
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

export default function LotteryDailyScan() {
  const confirm = useConfirm();
  const [date, setDate]                   = useState(todayStr());
  const [inventory, setInventory]         = useState(null);
  const [onlineTotal, setOnlineTotal]     = useState({ instantCashing: 0, machineSales: 0, machineCashing: 0, notes: '' });
  const [onlineSaving, setOnlineSaving]   = useState(false);
  const [onlineSaved, setOnlineSaved]     = useState(false);
  const [closeResult, setCloseResult]     = useState(null);
  const [closing, setClosing]             = useState(false);
  const [openShifts, setOpenShifts]       = useState([]);
  const [shiftToClose, setShiftToClose]   = useState(null);
  const [openShiftOpen, setOpenShiftOpen] = useState(false);   // "Open Shift" modal visibility
  const [counterScanOpen, setCounterScanOpen] = useState(false); // Counter Scan wizard visibility

  // Load inventory + online totals + open shifts.
  const loadDate = useCallback(async () => {
    const storeId = localStorage.getItem('activeStoreId');
    try {
      const [inv, ot, shifts] = await Promise.all([
        getDailyLotteryInventory({ date }).catch(() => null),
        getLotteryOnlineTotal({ date }).catch(() => null),
        listPosShifts({ status: 'open', storeId, limit: 20 }).catch(() => null),
      ]);
      setInventory(inv && typeof inv === 'object' && 'begin' in inv ? inv : null);
      setOnlineTotal({
        instantCashing: Number(ot?.instantCashing || 0),
        machineSales:   Number(ot?.machineSales   || 0),
        machineCashing: Number(ot?.machineCashing || 0),
        notes:          ot?.notes || '',
      });
      const shiftList = Array.isArray(shifts) ? shifts : (shifts?.shifts || []);
      setOpenShifts(shiftList);
    } catch {}
  }, [date]);

  useEffect(() => { loadDate(); }, [loadDate]);

  const saveOnline = async () => {
    setOnlineSaving(true); setOnlineSaved(false);
    try {
      await upsertLotteryOnlineTotal({ date, ...onlineTotal });
      setOnlineSaved(true);
      await loadDate();
      setTimeout(() => setOnlineSaved(false), 2500);
    } catch (e) {
      alert(e?.response?.data?.error || e.message);
    } finally {
      setOnlineSaving(false);
    }
  };

  const runCloseDay = async () => {
    if (!await confirm({
      title: 'Close lottery day?',
      message: `Close the lottery day for ${date}?\n\n` +
        '• Saves any unsaved machine totals\n' +
        '• Executes scheduled book moves\n' +
        '• Snapshots active books to audit log\n\n' +
        'Safe to re-run.',
      confirmLabel: 'Close Day',
    })) return;
    setClosing(true);
    try {
      await upsertLotteryOnlineTotal({ date, ...onlineTotal }).catch(() => {});
      const res = await closeLotteryDay({ date });
      setCloseResult(res);
      await loadDate();
    } catch (e) {
      alert(e?.response?.data?.error || e.message);
    } finally {
      setClosing(false);
    }
  };

  return (
    <div className="lds-wrap">
      {/* ── Header: date picker ─────────────────────────────────────── */}
      <div className="lds-header">
        <div className="lds-date">
          <label>Business Day</label>
          <input
            type="date"
            value={date}
            onChange={e => { setDate(e.target.value); setCloseResult(null); }}
          />
        </div>
        <div className="lds-header-hint">
          <Info size={14} />
          <span>Manager-only end-of-day finalization. Fill the machine totals from the terminal printout, close any cashier shifts that are still open, then click Close the Day.</span>
        </div>
      </div>

      {/* ── 1. Scratchoff Inventory live panel ──────────────────────── */}
      <ScratchoffInventoryPanel inventory={inventory} />

      {/* ── 2. Daily Machine Totals ─────────────────────────────────── */}
      <section className="lds-card">
        <div className="lds-card-head">
          <Wallet size={16} />
          <div>
            <div className="lds-card-title">Daily Machine Totals</div>
            <div className="lds-card-sub">The three numbers off the state lottery terminal's end-of-day printout.</div>
          </div>
        </div>
        <div className="lds-reports-grid">
          <Field
            label="Instant Cashing"
            hint="Scratch-off winnings paid from the drawer today"
            value={onlineTotal.instantCashing}
            onChange={v => setOnlineTotal({ ...onlineTotal, instantCashing: v })}
          />
          <Field
            label="Machine Sales"
            hint="Draw-game sales rung on the state terminal (Powerball, Mega Millions, Keno…)"
            value={onlineTotal.machineSales}
            onChange={v => setOnlineTotal({ ...onlineTotal, machineSales: v })}
          />
          <Field
            label="Machine Ticket Cashings"
            hint="Draw-game winnings paid from the drawer today"
            value={onlineTotal.machineCashing}
            onChange={v => setOnlineTotal({ ...onlineTotal, machineCashing: v })}
          />
        </div>

        <div className="lds-field">
          <label>Notes <span className="lds-optional">(optional)</span></label>
          <textarea
            rows={2}
            value={onlineTotal.notes}
            onChange={e => setOnlineTotal({ ...onlineTotal, notes: e.target.value })}
            placeholder="Anything unusual about today's lottery activity"
          />
        </div>

        <div className="lds-actions">
          <button className="lt-btn lt-btn-primary" onClick={saveOnline} disabled={onlineSaving}>
            {onlineSaving ? <><Loader2 size={14} className="lds-spin" /> Saving…</> : 'Save Machine Totals'}
          </button>
          {onlineSaved && (
            <span className="lds-save-ok"><CheckCircle2 size={14} /> Saved</span>
          )}
        </div>
      </section>

      {/* ── 3. Cashier shifts (open + close from back office) ──────── */}
      <section className="lds-card">
        <div className="lds-card-head lds-card-head--with-action">
          <div className="lds-card-head-left">
            <Ticket size={16} />
            <div>
              <div className="lds-card-title">Cashier Shifts</div>
              <div className="lds-card-sub">Open a shift on behalf of a cashier, or close one they forgot to close. Variance is auto-computed from transactions + drops + payouts.</div>
            </div>
          </div>
          <button className="lt-btn lt-btn-primary lt-btn-sm" onClick={() => setOpenShiftOpen(true)}>
            <Plus size={13} /> Open Shift
          </button>
        </div>
        {openShifts.length === 0 ? (
          <div className="lds-empty-card">
            <CheckCircle2 size={20} color="#16a34a" />
            <span>No open shifts at this store.</span>
          </div>
        ) : (
          <div className="lds-shift-list">
            {openShifts.map(s => (
              <OpenShiftRow key={s.id} shift={s} onClose={() => setShiftToClose(s)} />
            ))}
          </div>
        )}
      </section>

      {/* ── 3b. Counter Scan (manager-driven scanning of active books) ── */}
      <section className="lds-card">
        <div className="lds-card-head lds-card-head--with-action">
          <div className="lds-card-head-left">
            <ScanLine size={16} />
            <div>
              <div className="lds-card-title">Counter Scan</div>
              <div className="lds-card-sub">Scan each active book's next-to-sell ticket to record the day's current positions. Same flow as the cashier app — but lets a manager do it from back office.</div>
            </div>
          </div>
          <button className="lt-btn lt-btn-primary lt-btn-sm" onClick={() => setCounterScanOpen(true)}>
            <ScanLine size={13} /> Run Counter Scan
          </button>
        </div>
        <div className="lds-card-sub" style={{ margin: '4px 0 0' }}>
          Opens a popup just like the cashier's end-of-shift wizard. Scan or type the current ticket for each book — when you're done, positions are saved.
        </div>
      </section>

      {/* ── 4. Close the Day ────────────────────────────────────────── */}
      <section className="lds-card">
        <div className="lds-card-head">
          <Lock size={16} />
          <div>
            <div className="lds-card-title">Close the Lottery Day</div>
            <div className="lds-card-sub">Finalizes all lottery activity for this date. Safe to run more than once.</div>
          </div>
        </div>

        <div className="lds-close-summary">
          <div><span>Business day</span><strong>{date}</strong></div>
          {inventory && (
            <>
              <div><span>Today's sold</span><strong>{fmtMoney(inventory.sold)}</strong></div>
              <div><span>Today's received</span><strong>{fmtMoney(inventory.received)}</strong></div>
              <div><span>End-of-day inventory</span><strong>{fmtMoney(inventory.end)}</strong></div>
              <div><span>Active books</span><strong>{inventory.counts?.active ?? 0}</strong></div>
            </>
          )}
        </div>

        {closeResult ? (
          <div className="lds-close-result">
            <CheckCircle2 size={22} />
            <div>
              <strong>Day closed.</strong>
              <div>Executed {closeResult.pendingMoveSweep?.executed || 0} pending move{(closeResult.pendingMoveSweep?.executed || 0) === 1 ? '' : 's'}.</div>
              <div>Snapshotted {closeResult.snapshotCount || 0} active book position{(closeResult.snapshotCount || 0) === 1 ? '' : 's'}.</div>
            </div>
          </div>
        ) : (
          <div className="lds-actions">
            <button className="lt-btn lt-btn-success" onClick={runCloseDay} disabled={closing}>
              {closing ? <><Loader2 size={14} className="lds-spin" /> Closing…</> : <><CheckCircle2 size={14} /> Close the Day</>}
            </button>
          </div>
        )}
      </section>

      {/* Back-office shift-close modal */}
      {shiftToClose && (
        <CloseShiftFromBackOfficeModal
          shift={shiftToClose}
          onClose={() => setShiftToClose(null)}
          onClosed={() => { setShiftToClose(null); loadDate(); }}
        />
      )}

      {/* Back-office open-shift modal */}
      {openShiftOpen && (
        <OpenShiftBackOfficeModal
          onClose={() => setOpenShiftOpen(false)}
          onOpened={() => { setOpenShiftOpen(false); loadDate(); }}
        />
      )}

      {/* Manager counter-scan wizard — inherits the End-of-Day page's
          selected business day so backdated reconciliation works. */}
      {counterScanOpen && (
        <CounterScanModal
          date={date}
          onClose={() => setCounterScanOpen(false)}
          onSaved={() => { setCounterScanOpen(false); loadDate(); }}
        />
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
 * Subcomponents
 * ════════════════════════════════════════════════════════════════════ */

function ScratchoffInventoryPanel({ inventory }) {
  if (!inventory) return <div className="lds-inv-panel lds-inv-panel--loading">Loading inventory…</div>;
  const rows = [
    { k: 'Begin',       v: inventory.begin,      kind: 'normal' },
    { k: 'Received',    v: inventory.received,   kind: inventory.received > 0 ? 'highlight' : 'normal' },
    { k: 'Return Part', v: inventory.returnPart, kind: 'normal' },
    { k: 'Return Full', v: inventory.returnFull, kind: 'normal' },
    { k: 'Sold',        v: inventory.sold,       kind: inventory.sold > 0 ? 'highlight' : 'normal' },
  ];
  return (
    <div className="lds-inv-panel">
      <div className="lds-inv-title">Scratchoff Inventory</div>
      <div className="lds-inv-rows">
        {rows.map(r => (
          <div key={r.k} className={`lds-inv-row ${r.kind === 'highlight' ? 'highlight' : ''}`}>
            <span className="lds-inv-key">{r.k}</span>
            <span className="lds-inv-val">{fmtMoney(r.v)}</span>
          </div>
        ))}
        <div className="lds-inv-row lds-inv-row--total">
          <span className="lds-inv-key">End</span>
          <span className="lds-inv-val">{fmtMoney(inventory.end)}</span>
        </div>
        <div className="lds-inv-row lds-inv-row--muted">
          <span className="lds-inv-key">Activated today</span>
          <span className="lds-inv-val">{inventory.activated}</span>
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, value, onChange }) {
  return (
    <div className="lds-field">
      <label>{label}</label>
      <div className="lds-hint">{hint}</div>
      <div className="lds-dollar-input">
        <span>$</span>
        <input
          type="number"
          step="0.01"
          min="0"
          value={value}
          onChange={e => onChange(Number(e.target.value))}
        />
      </div>
    </div>
  );
}

function OpenShiftRow({ shift, onClose }) {
  // Shift fields we can display; `listShifts` already attaches cashierName + stationName
  const cashier   = shift.cashierName || shift.cashier?.name || '—';
  const station   = shift.stationName || shift.station?.name || shift.stationId || '—';
  const openingAmount = Number(shift.openingAmount || 0);
  const openedAgo = humanizeAgo(shift.openedAt);
  const crossedMidnight = shift.openedAt && (new Date(shift.openedAt) < startOfToday());
  return (
    <div className={`lds-shift-row ${crossedMidnight ? 'lds-shift-row--stale' : ''}`}>
      <div className="lds-shift-meta">
        <div className="lds-shift-cashier">{cashier}</div>
        <div className="lds-shift-sub">
          Station: {station} · Opened {openedAgo}{crossedMidnight ? ' · crossed midnight' : ''}
        </div>
        <div className="lds-shift-sub">Opening cash: <strong>{fmtMoney(openingAmount)}</strong></div>
      </div>
      <button className="lt-btn lt-btn-danger" onClick={onClose}>Close Shift</button>
    </div>
  );
}

function CloseShiftFromBackOfficeModal({ shift, onClose, onClosed }) {
  const [closingAmount, setClosingAmount] = useState('');
  const [note, setNote]   = useState('');
  const [busy, setBusy]   = useState(false);
  const [err, setErr]     = useState('');

  const submit = async () => {
    const amt = Number(closingAmount);
    if (!Number.isFinite(amt) || amt < 0) {
      setErr('Enter the physical cash count ($0 or more).');
      return;
    }
    setBusy(true); setErr('');
    try {
      await closePosShift(shift.id, {
        closingAmount: amt,
        closingNote: note || '[Back-office close by manager]',
      });
      onClosed?.();
    } catch (e) {
      setErr(e?.response?.data?.error || e.message || 'Failed to close shift');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="lt-modal-overlay">
      <div className="lt-modal">
        <div className="lt-modal-header">
          <div>
            <div className="lt-modal-title">Close Shift (Back Office)</div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 2 }}>
              {shift.cashierName || '—'} · Station {shift.stationName || shift.stationId || '—'} · Opened {humanizeAgo(shift.openedAt)}
            </div>
          </div>
          <button className="lt-modal-close" onClick={onClose}>×</button>
        </div>
        <div className="lt-modal-info">
          Opening cash: <strong>{fmtMoney(Number(shift.openingAmount || 0))}</strong>.
          Enter the counted cash in the drawer right now — the backend computes the expected amount and variance automatically.
        </div>
        {err && <div className="lt-error">{err}</div>}
        <div className="lds-field">
          <label>Counted Cash in Drawer ($)</label>
          <input
            type="number" step="0.01" min="0"
            value={closingAmount}
            onChange={e => setClosingAmount(e.target.value)}
            placeholder="0.00"
            autoFocus
          />
        </div>
        <div className="lds-field">
          <label>Note (optional)</label>
          <input
            type="text"
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Why are you closing this shift from back office?"
          />
        </div>
        <div className="lt-form-actions">
          <button className="lt-btn lt-btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="lt-btn lt-btn-danger" onClick={submit} disabled={busy}>
            {busy ? 'Closing…' : 'Close Shift'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
 * OpenShiftBackOfficeModal
 * Manager opens a shift on behalf of a cashier. Picks the station +
 * cashier, enters the opening cash float, submits to /shift/open with
 * cashierId so the shift is owned by the right user (not the manager).
 * ════════════════════════════════════════════════════════════════════ */
function OpenShiftBackOfficeModal({ onClose, onOpened }) {
  const storeId = localStorage.getItem('activeStoreId');
  const [stations, setStations] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [stationId, setStationId] = useState('');
  const [cashierId, setCashierId] = useState('');
  const [openingAmount, setOpeningAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [st, em] = await Promise.all([
          listPosStations(storeId).catch(() => ({ stations: [] })),
          getStoreEmployees({ storeId }).catch(() => ({ employees: [] })),
        ]);
        const stList  = st.stations || [];
        const empList = em.employees || [];
        setStations(stList);
        setEmployees(empList);
        // Sensible defaults — first station + first cashier
        if (stList.length > 0) setStationId(stList[0].id);
        if (empList.length > 0) setCashierId(empList[0].id);
      } catch (e) {
        setErr('Failed to load stations/cashiers');
      } finally {
        setLoading(false);
      }
    })();
  }, [storeId]);

  const submit = async () => {
    const amt = Number(openingAmount);
    if (!cashierId)                              { setErr('Pick a cashier');  return; }
    if (!Number.isFinite(amt) || amt < 0)        { setErr('Enter opening cash ($0 or more)'); return; }
    setBusy(true); setErr('');
    try {
      await openPosShift({
        storeId,
        stationId: stationId || null,
        cashierId,
        openingAmount: amt,
        openingNote: note || '[Opened by manager from back office]',
      });
      onOpened?.();
    } catch (e) {
      // Backend returns a useful 409 when there's already an open shift
      const msg = e?.response?.data?.error || e.message || 'Failed to open shift';
      setErr(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="lt-modal-overlay">
      <div className="lt-modal">
        <div className="lt-modal-header">
          <div>
            <div className="lt-modal-title">Open Shift (Back Office)</div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 2 }}>
              Opens a cash-drawer shift on behalf of a cashier. Same variance math as the cashier-app.
            </div>
          </div>
          <button className="lt-modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        {err && <div className="lt-error">{err}</div>}
        {loading ? (
          <div style={{ padding: '1rem 0', color: 'var(--text-muted)' }}>Loading…</div>
        ) : (
          <>
            <div className="lds-field">
              <label>Station</label>
              {stations.length === 0 ? (
                <div className="lds-hint">No registered stations at this store. Shift will open with no station.</div>
              ) : (
                <select value={stationId} onChange={e => setStationId(e.target.value)}>
                  {stations.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="lds-field">
              <label>Cashier</label>
              {employees.length === 0 ? (
                <div className="lds-hint">No cashiers with PIN found at this store.</div>
              ) : (
                <select value={cashierId} onChange={e => setCashierId(e.target.value)}>
                  {employees.map(u => (
                    <option key={u.id} value={u.id}>
                      {u.name}{u.role ? ` · ${u.role}` : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="lds-field">
              <label>Opening Cash ($)</label>
              <input
                type="number" step="0.01" min="0"
                value={openingAmount}
                onChange={e => setOpeningAmount(e.target.value)}
                placeholder="0.00"
                autoFocus
              />
            </div>
            <div className="lds-field">
              <label>Note <span className="lds-optional">(optional)</span></label>
              <input
                type="text" value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="Why are you opening this shift from back office?"
              />
            </div>
          </>
        )}
        <div className="lt-form-actions">
          <button className="lt-btn lt-btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="lt-btn lt-btn-primary" onClick={submit} disabled={busy || loading || !cashierId}>
            {busy ? 'Opening…' : 'Open Shift'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
 * CounterScanModal
 * Manager-level counter scan. Same "feel" as the cashier-app Phase 3g
 * wizard Step 1 — big scan input, list of active books sorted by ticket
 * value, auto-fills the current ticket on scan, per-row manual edit.
 * On save, bulk-updates each book's currentTicket via the existing
 * updateLotteryBox endpoint.
 *
 * Exported so the Counter tab can trigger the same popup without having
 * to reimplement it.
 * ════════════════════════════════════════════════════════════════════ */
export function CounterScanModal({ onClose, onSaved, date: initialDate }) {
  // Backdating support — pre-filled from the End-of-Day page's date when
  // opened from there; defaults to today when the Counter-tab button
  // triggers it without a hint. Manager can edit freely.
  const [scanDate, setScanDate] = useState(initialDate || todayStr());
  const [boxes, setBoxes] = useState([]);
  const [drafts, setDrafts] = useState({});  // boxId → draft current ticket
  const [scanValue, setScanValue] = useState('');
  const [scanLog, setScanLog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const scanRef = useRef(null);

  // Load active books, sort by totalValue descending (matches EoD wizard UX)
  useEffect(() => {
    (async () => {
      try {
        const r = await getLotteryBoxes({ status: 'active' });
        const list = Array.isArray(r) ? r : (r?.boxes || []);
        const sorted = [...list].sort((a, b) => {
          const va = Number(a.totalValue || (Number(a.totalTickets)||0) * Number(a.ticketPrice || 0));
          const vb = Number(b.totalValue || (Number(b.totalTickets)||0) * Number(b.ticketPrice || 0));
          return vb - va;
        });
        setBoxes(sorted);
      } catch (e) {
        setErr(e?.response?.data?.error || 'Failed to load active books');
      } finally {
        setLoading(false);
        setTimeout(() => scanRef.current?.focus(), 80);
      }
    })();
  }, []);

  const setDraft = (boxId, val) => setDrafts(d => ({ ...d, [boxId]: val }));

  const handleScan = async () => {
    const v = scanValue.trim();
    if (!v) return;
    setScanValue('');
    setErr('');
    try {
      const res = await scanLotteryBarcode({ raw: v, context: 'eod' });
      const now = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      const boxId = res?.box?.id;
      const ticket = res?.parsed?.ticketNumber;
      if (boxId && ticket != null) {
        setDraft(boxId, String(ticket));
        setScanLog(l => [{
          t: now,
          msg: `✓ ${res.box.game?.name || 'Book'} Book ${res.box.boxNumber || '?'} → ticket ${ticket}`,
          ok: true,
        }, ...l].slice(0, 5));
      } else if (res?.action === 'rejected') {
        setScanLog(l => [{
          t: now,
          msg: `✗ ${res.message || res.reason || 'Rejected'}`,
          ok: false,
        }, ...l].slice(0, 5));
      } else {
        setScanLog(l => [{ t: now, msg: `? Unknown result for ${v}`, ok: false }, ...l].slice(0, 5));
      }
    } catch (e) {
      setScanLog(l => [{
        t: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
        msg: `✗ ${e?.response?.data?.error || e.message}`,
        ok: false,
      }, ...l].slice(0, 5));
    } finally {
      setTimeout(() => scanRef.current?.focus(), 0);
    }
  };

  const saveAll = async () => {
    const changes = Object.entries(drafts).filter(([id, v]) => {
      const box = boxes.find(b => b.id === id);
      return box && v !== '' && String(v) !== String(box.currentTicket ?? '');
    });
    if (changes.length === 0) {
      setErr('No changes to save — scan or type a current ticket on at least one book.');
      return;
    }
    setSaving(true); setErr('');
    try {
      await Promise.all(changes.map(([id, ticket]) =>
        updateLotteryBox(id, { currentTicket: String(ticket) })
      ));
      onSaved?.();
    } catch (e) {
      setErr(e?.response?.data?.error || e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const dirtyCount = useMemo(
    () => Object.entries(drafts).filter(([id, v]) => {
      const box = boxes.find(b => b.id === id);
      return box && v !== '' && String(v) !== String(box.currentTicket ?? '');
    }).length,
    [drafts, boxes]
  );

  return (
    <div className="lt-modal-overlay">
      <div className="lt-modal lt-modal-lg">
        <div className="lt-modal-header">
          <div>
            <div className="lt-modal-title">Counter Scan</div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 2 }}>
              Scan each book's next-to-sell ticket. Same flow as the cashier's end-of-shift wizard.
            </div>
          </div>
          <button className="lt-modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        {/* Date selector — supports backdating historical EoD scans. The
            date itself doesn't change what's scanned (a book's currentTicket
            is a single value), it's a label for the snapshot the manager
            is recording. Persists on the Close-the-Day audit log too. */}
        <div className="lds-scan-date-bar">
          <label>Business day</label>
          <input
            type="date"
            value={scanDate}
            onChange={e => setScanDate(e.target.value)}
            max={todayStr()}
          />
          {scanDate !== todayStr() && (
            <span className="lds-scan-date-warn">
              ⚠ Backdating — this snapshot will be tagged {scanDate} in the audit log
            </span>
          )}
        </div>

        {err && <div className="lt-error">{err}</div>}

        {/* Scan bar */}
        <div className="lsm-scan-bar" style={{ marginBottom: 10 }}>
          <ScanLine size={18} />
          <input
            ref={scanRef}
            className="lsm-scan-input-main"
            type="text"
            placeholder="Scan the next-to-sell ticket of each book…"
            value={scanValue}
            onChange={e => setScanValue(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleScan(); }}
          />
          <button
            type="button"
            className="lsm-scan-submit"
            onClick={handleScan}
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

        {loading ? (
          <div style={{ padding: '1rem', color: 'var(--text-muted)' }}>Loading active books…</div>
        ) : boxes.length === 0 ? (
          <div className="lds-empty-card">
            <Info size={16} /> No active books on the counter — nothing to scan.
          </div>
        ) : (
          <div className="lds-counter-scan-list">
            {boxes.map(b => {
              const draft = drafts[b.id];
              const current = draft !== undefined ? draft : (b.currentTicket ?? '');
              const dirty = draft !== undefined && String(draft) !== String(b.currentTicket ?? '');
              return (
                <div key={b.id} className={`lds-counter-scan-row ${dirty ? 'lds-counter-scan-row--dirty' : ''}`}>
                  <span className="lds-counter-scan-slot">{b.slotNumber ?? '—'}</span>
                  <span className="lds-counter-scan-game">
                    <strong>{b.game?.name || 'Unknown'}</strong>
                    <small>Book {b.boxNumber || '—'} · {b.totalTickets || 0} tickets</small>
                  </span>
                  <span className="lds-counter-scan-start">Start {b.startTicket ?? '—'}</span>
                  <span className="lds-counter-scan-input">
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="next #"
                      value={current}
                      onChange={e => setDraft(b.id, e.target.value.replace(/[^0-9]/g, ''))}
                    />
                  </span>
                </div>
              );
            })}
          </div>
        )}

        <div className="lt-form-actions" style={{ marginTop: 10 }}>
          <button className="lt-btn lt-btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button
            className="lt-btn lt-btn-primary"
            onClick={saveAll}
            disabled={saving || dirtyCount === 0}
          >
            {saving ? 'Saving…' : `Save ${dirtyCount || ''} change${dirtyCount === 1 ? '' : 's'}`.trim()}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── helpers ─────────────────────────────────────────────────────── */
function humanizeAgo(iso) {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 'in the future';
  const mins = Math.floor(ms / 60000);
  if (mins < 1)   return 'just now';
  if (mins < 60)  return `${mins}m ago`;
  const hrs  = Math.floor(mins / 60);
  if (hrs < 24)   return `${hrs}h ${mins % 60}m ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ${hrs % 24}h ago`;
}
function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
