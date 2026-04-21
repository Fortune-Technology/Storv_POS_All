/**
 * LotteryDailyScan — Phase 1b
 *
 * The 4-step end-of-day wizard that replaces Elistars' "Daily Lottery Scan":
 *   Reports → Receive → Return → Counter → Close the Day
 *
 * Rendered as an embedded sub-page inside Lottery.jsx under the
 * "Daily Scan" tab. Admin picks the date at the top and walks the steps.
 *
 * Design goals:
 *   - One continuous panel, no page jumps
 *   - Live Scratchoff Inventory math visible on every step
 *   - Scan-first on Receive / Return / Counter (auto-activation via the
 *     Phase 1a scan engine), manual entry always available as fallback
 *   - Close the Day is idempotent — safe to re-run
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, Info, Ticket, Package, RotateCcw, ClipboardCheck } from 'lucide-react';
import {
  getLotteryOnlineTotal, upsertLotteryOnlineTotal,
  getDailyLotteryInventory, closeLotteryDay, getLotteryBoxes,
  scanLotteryBarcode, updateLotteryBox,
} from '../services/api';

const STEPS = [
  { key: 'reports',  label: 'Reports',  icon: ClipboardCheck },
  { key: 'receive',  label: 'Receive',  icon: Package },
  { key: 'return',   label: 'Return',   icon: RotateCcw },
  { key: 'counter',  label: 'Counter',  icon: Ticket },
  { key: 'close',    label: 'Close',    icon: CheckCircle2 },
];

const fmtMoney = (n) => n == null ? '$0.00' : `$${Number(n).toFixed(2)}`;
const todayStr = () => new Date().toISOString().slice(0, 10);

export default function LotteryDailyScan() {
  const [date, setDate] = useState(todayStr());
  const [stepIdx, setStepIdx] = useState(0);
  const step = STEPS[stepIdx];

  const [inventory, setInventory] = useState(null);
  const [onlineTotal, setOnlineTotal] = useState({ instantCashing: 0, machineSales: 0, machineCashing: 0, notes: '' });
  const [onlineSaving, setOnlineSaving] = useState(false);
  const [activeBoxes, setActiveBoxes] = useState([]);
  const [safeBoxes, setSafeBoxes] = useState([]);
  const [closeResult, setCloseResult] = useState(null);

  // Load inventory + online-total when date changes.
  // `lotteryUnwrap` in api.js already strips the `{success, data}` envelope
  // and returns the inner payload, so `inv` is the inventory object directly.
  const loadDate = useCallback(async () => {
    try {
      const [inv, ot, counter, safe] = await Promise.all([
        getDailyLotteryInventory({ date }).catch(() => null),
        getLotteryOnlineTotal({ date }).catch(() => null),
        getLotteryBoxes({ status: 'active' }).catch(() => []),
        getLotteryBoxes({ status: 'inventory' }).catch(() => []),
      ]);
      setInventory(inv && typeof inv === 'object' && 'begin' in inv ? inv : null);
      setOnlineTotal({
        instantCashing: Number(ot?.instantCashing || 0),
        machineSales:   Number(ot?.machineSales   || 0),
        machineCashing: Number(ot?.machineCashing || 0),
        notes:          ot?.notes || '',
      });
      setActiveBoxes(Array.isArray(counter) ? counter : counter?.boxes || []);
      setSafeBoxes(Array.isArray(safe) ? safe : safe?.boxes || []);
    } catch {}
  }, [date]);

  useEffect(() => { loadDate(); }, [loadDate]);

  const saveOnline = async () => {
    setOnlineSaving(true);
    try {
      await upsertLotteryOnlineTotal({ date, ...onlineTotal });
    } catch (e) {
      alert(e?.response?.data?.error || e.message);
    } finally {
      setOnlineSaving(false);
    }
  };

  const runCloseDay = async () => {
    if (!window.confirm(`Close the lottery day for ${date}? This executes any scheduled book moves and snapshots the counter.`)) return;
    try {
      // Save any unsaved online totals first
      await upsertLotteryOnlineTotal({ date, ...onlineTotal });
      const res = await closeLotteryDay({ date });
      setCloseResult(res);
      await loadDate();
    } catch (e) {
      alert(e?.response?.data?.error || e.message);
    }
  };

  return (
    <div className="lds-wrap">
      {/* ── Header: date picker + step dots ─────────────────────── */}
      <div className="lds-header">
        <div className="lds-date">
          <label>Business Day</label>
          <input type="date" value={date} onChange={e => { setDate(e.target.value); setStepIdx(0); setCloseResult(null); }} />
        </div>
        <div className="lds-step-bar">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            return (
              <button
                key={s.key}
                className={`lds-step-dot ${i === stepIdx ? 'active' : ''} ${i < stepIdx ? 'done' : ''}`}
                onClick={() => setStepIdx(i)}
              >
                <Icon size={14} />
                <span className="lds-step-label">{s.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Scratchoff Inventory live panel (sticky above content) ─── */}
      <ScratchoffInventoryPanel inventory={inventory} />

      {/* ── Step content ──────────────────────────────────────────── */}
      <div className="lds-content">
        {step.key === 'reports' && (
          <ReportsStep
            online={onlineTotal}
            setOnline={setOnlineTotal}
            onSave={saveOnline}
            saving={onlineSaving}
            inventory={inventory}
          />
        )}
        {step.key === 'receive' && <ReceiveStep onRefresh={loadDate} />}
        {step.key === 'return'  && <ReturnStep boxes={[...activeBoxes, ...safeBoxes]} onRefresh={loadDate} />}
        {step.key === 'counter' && <CounterStep boxes={activeBoxes} onRefresh={loadDate} />}
        {step.key === 'close'   && <CloseStep date={date} onClose={runCloseDay} result={closeResult} inventory={inventory} />}
      </div>

      {/* ── Nav buttons ───────────────────────────────────────────── */}
      <div className="lds-nav">
        <button className="lt-btn lt-btn-secondary" disabled={stepIdx === 0} onClick={() => setStepIdx(i => Math.max(0, i - 1))}>
          <ArrowLeft size={14} /> Back
        </button>
        <div className="lds-nav-spacer" />
        {stepIdx < STEPS.length - 1 && (
          <button className="lt-btn lt-btn-primary" onClick={() => setStepIdx(i => Math.min(STEPS.length - 1, i + 1))}>
            Next <ArrowRight size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────
 * Scratchoff Inventory Panel — the Elistars-style live math summary
 * ──────────────────────────────────────────────────────────────────── */
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

/* ────────────────────────────────────────────────────────────────────
 * Step 1 — Reports. Captures the 3 daily numbers + settings summary.
 * ──────────────────────────────────────────────────────────────────── */
function ReportsStep({ online, setOnline, onSave, saving, inventory }) {
  const set = (k, v) => setOnline({ ...online, [k]: v });
  return (
    <div className="lds-step">
      <div className="lds-step-intro">
        <Info size={14} />
        <span>Enter today's machine totals. These three numbers come from the lottery terminal printout at end of shift.</span>
      </div>

      <div className="lds-reports-grid">
        <div className="lds-field">
          <label>Instant Cashing</label>
          <div className="lds-hint">Scratch-off winnings paid from the drawer today.</div>
          <div className="lds-dollar-input">
            <span>$</span>
            <input type="number" step="0.01" min="0" value={online.instantCashing}
              onChange={e => set('instantCashing', Number(e.target.value))} />
          </div>
        </div>

        <div className="lds-field">
          <label>Machine Sales</label>
          <div className="lds-hint">Draw-game sales rung on the state terminal (Powerball, Mega Millions, etc.) — total for today.</div>
          <div className="lds-dollar-input">
            <span>$</span>
            <input type="number" step="0.01" min="0" value={online.machineSales}
              onChange={e => set('machineSales', Number(e.target.value))} />
          </div>
        </div>

        <div className="lds-field">
          <label>Machine Ticket Cashings</label>
          <div className="lds-hint">Draw-game winnings paid from the drawer today.</div>
          <div className="lds-dollar-input">
            <span>$</span>
            <input type="number" step="0.01" min="0" value={online.machineCashing}
              onChange={e => set('machineCashing', Number(e.target.value))} />
          </div>
        </div>
      </div>

      <div className="lds-field">
        <label>Notes <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
        <textarea rows={2} value={online.notes} onChange={e => set('notes', e.target.value)}
          placeholder="Anything unusual about today's lottery activity — short staffing, terminal issues, returns due, etc." />
      </div>

      <div className="lds-actions">
        <button className="lt-btn lt-btn-primary" onClick={onSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save Reports'}
        </button>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────
 * Scan bar — shared between Receive / Return / Counter steps.
 * Focused input, fires the scan endpoint, shows outcome inline.
 * ──────────────────────────────────────────────────────────────────── */
function ScanBar({ context, onResult, placeholder = 'Scan a book or ticket barcode…' }) {
  const [raw, setRaw] = useState('');
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState([]);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const submit = async () => {
    const v = raw.trim();
    if (!v) return;
    setBusy(true);
    setRaw('');
    try {
      const res = await scanLotteryBarcode({ raw: v, context });
      const entry = {
        raw: v,
        action: res?.action,
        reason: res?.reason,
        box: res?.box,
        autoSoldout: res?.autoSoldout,
        state: res?.state,
        at: new Date(),
      };
      setLog(l => [entry, ...l].slice(0, 10));
      onResult?.(entry);
    } catch (e) {
      setLog(l => [{ raw: v, action: 'error', reason: e?.response?.data?.error || e.message, at: new Date() }, ...l].slice(0, 10));
    } finally {
      setBusy(false);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  };

  return (
    <div className="lds-scan">
      <div className="lds-scan-row">
        <input
          ref={inputRef}
          className="lds-scan-input"
          type="text"
          value={raw}
          onChange={e => setRaw(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submit()}
          placeholder={placeholder}
          disabled={busy}
        />
        <button className="lt-btn lt-btn-primary" disabled={busy || !raw.trim()} onClick={submit}>
          {busy ? '…' : 'Submit'}
        </button>
      </div>

      {log.length > 0 && (
        <div className="lds-scan-log">
          {log.map((l, i) => (
            <div key={i} className={`lds-scan-entry lds-scan-entry--${l.action || 'error'}`}>
              <code>{l.raw}</code>
              <span className="lds-scan-outcome">
                {l.action === 'activate'        && `✓ Activated: ${l.box?.game?.name || ''} Book ${l.box?.boxNumber || ''} (slot ${l.box?.slotNumber})`}
                {l.action === 'update_current'  && `✓ Updated current ticket → ${l.box?.currentTicket}`}
                {l.action === 'rejected'        && `✗ ${l.reason}`}
                {l.action === 'error'           && `✗ ${l.reason}`}
              </span>
              {l.autoSoldout && (
                <span className="lds-scan-extra">
                  auto-soldout: {l.autoSoldout.game?.name} Book {l.autoSoldout.boxNumber}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────
 * Step 2 — Receive. Scan new books into the Safe.
 * ──────────────────────────────────────────────────────────────────── */
function ReceiveStep({ onRefresh }) {
  return (
    <div className="lds-step">
      <div className="lds-step-intro">
        <Package size={14} />
        <span>Scan each book received today. The system will add them to the Safe automatically. If a code is not recognised, add it manually from the main Safe tab.</span>
      </div>
      <ScanBar context="receive" onResult={() => onRefresh?.()} placeholder="Scan book code — e.g. 498-027632 (MA) or a pack EAN-13" />
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────
 * Step 3 — Return. Select books to return to the lottery commission.
 * Choose from active or safe books; unsold tickets flow to settlement.
 * ──────────────────────────────────────────────────────────────────── */
function ReturnStep({ boxes, onRefresh }) {
  const [pickId, setPickId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const pick = boxes.find(b => b.id === pickId);
  const unsold = pick ? Math.max(0, (pick.totalTickets || 0) - (pick.ticketsSold || 0)) : 0;
  const unsoldValue = pick ? unsold * Number(pick.ticketPrice || 0) : 0;

  const submit = async () => {
    if (!pick) return;
    if (!window.confirm(`Return ${pick.game?.name} Book ${pick.boxNumber} to Lottery? ${unsold} unsold tickets (${fmtMoney(unsoldValue)}) will be deducted.`)) return;
    setBusy(true);
    try {
      const { returnLotteryBoxToLotto } = await import('../services/api');
      await returnLotteryBoxToLotto(pick.id, { reason: note || null });
      setPickId(''); setNote('');
      onRefresh?.();
    } catch (e) {
      alert(e?.response?.data?.error || e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="lds-step">
      <div className="lds-step-intro">
        <RotateCcw size={14} />
        <span>Pick a book being physically returned to the commission. Unsold tickets will be deducted from next week's settlement.</span>
      </div>

      <div className="lds-field">
        <label>Book to Return</label>
        <select value={pickId} onChange={e => setPickId(e.target.value)}>
          <option value="">— Select a book —</option>
          {boxes.map(b => (
            <option key={b.id} value={b.id}>
              {b.game?.name} — Book {b.boxNumber} · {b.status === 'active' ? `Counter slot ${b.slotNumber}` : 'Safe'} · {b.ticketsSold || 0}/{b.totalTickets} sold
            </option>
          ))}
        </select>
      </div>

      {pick && (
        <div className="lds-return-preview">
          <div><strong>{pick.game?.name}</strong> — Book {pick.boxNumber}</div>
          <div className="lds-return-line">
            <span>Unsold tickets</span>
            <span>{unsold} × {fmtMoney(pick.ticketPrice)} = <strong>{fmtMoney(unsoldValue)}</strong></span>
          </div>
          <div className="lds-return-hint">This amount will be deducted from the next weekly settlement.</div>
        </div>
      )}

      <div className="lds-field">
        <label>Reason / Note <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
        <input type="text" value={note} onChange={e => setNote(e.target.value)}
          placeholder="e.g. game ended, partial return" />
      </div>

      <div className="lds-actions">
        <button className="lt-btn lt-btn-danger" disabled={!pick || busy} onClick={submit}>
          {busy ? 'Returning…' : pick ? `Return ${fmtMoney(unsoldValue)}` : 'Select a book'}
        </button>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────
 * Step 4 — Counter. Scan (or manually set) each active book's current
 * next-to-sell ticket so today's sold-count is accurate.
 * ──────────────────────────────────────────────────────────────────── */
function CounterStep({ boxes, onRefresh }) {
  const [draft, setDraft] = useState({}); // boxId -> ticket #
  const [savingId, setSavingId] = useState(null);

  const setTicket = (id, v) => setDraft(d => ({ ...d, [id]: v }));

  const saveOne = async (b) => {
    const val = draft[b.id];
    if (val == null || val === '') return;
    setSavingId(b.id);
    try {
      await updateLotteryBox(b.id, { currentTicket: String(val) });
      setDraft(d => { const n = { ...d }; delete n[b.id]; return n; });
      onRefresh?.();
    } catch (e) {
      alert(e?.response?.data?.error || e.message);
    } finally {
      setSavingId(null);
    }
  };

  const sorted = [...boxes].sort((a, b) => (a.slotNumber || 999) - (b.slotNumber || 999));

  return (
    <div className="lds-step">
      <div className="lds-step-intro">
        <Ticket size={14} />
        <span>Scan the next-to-sell ticket from each book on the counter. Or edit the number directly. Books you skip keep their current value.</span>
      </div>

      <ScanBar context="eod" onResult={() => onRefresh?.()} placeholder="Scan the next-to-sell ticket of any book on the counter" />

      <div className="lds-counter-table">
        <div className="lds-counter-head">
          <span>Slot</span><span>Game</span><span>Book #</span><span>Start</span><span>Current</span><span>Sold</span><span></span>
        </div>
        {sorted.length === 0 && (
          <div className="lds-empty">No active books on the counter.</div>
        )}
        {sorted.map(b => {
          const draftVal = draft[b.id];
          const dirty = draftVal !== undefined && String(draftVal) !== String(b.currentTicket || '');
          const ticketsSoldToday = b.ticketsSold || 0;
          return (
            <div key={b.id} className={`lds-counter-row ${dirty ? 'dirty' : ''}`}>
              <span className="lds-counter-slot">{b.slotNumber ?? '—'}</span>
              <span>{b.game?.name || 'Unknown'}</span>
              <span><code>{b.boxNumber || '—'}</code></span>
              <span>{b.startTicket ?? '—'}</span>
              <span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={draftVal ?? (b.currentTicket ?? '')}
                  onChange={e => setTicket(b.id, e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && saveOne(b)}
                  placeholder="next #"
                />
              </span>
              <span>{ticketsSoldToday}</span>
              <span>
                {dirty && (
                  <button className="lt-btn lt-btn-primary lt-btn-sm" disabled={savingId === b.id} onClick={() => saveOne(b)}>
                    {savingId === b.id ? '…' : 'Save'}
                  </button>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────
 * Step 5 — Close the Day. Final review + the button.
 * ──────────────────────────────────────────────────────────────────── */
function CloseStep({ date, onClose, result, inventory }) {
  return (
    <div className="lds-step">
      <div className="lds-step-intro">
        <CheckCircle2 size={14} />
        <span>Final review. Closing the day executes any scheduled moves and snapshots the counter positions to the audit log. It's safe to run more than once.</span>
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

      {result ? (
        <div className="lds-close-result">
          <CheckCircle2 size={24} />
          <div>
            <strong>Day closed.</strong><br />
            Executed {result.pendingMoveSweep?.executed || 0} pending move{(result.pendingMoveSweep?.executed || 0) === 1 ? '' : 's'}.<br />
            Snapshotted {result.snapshotCount || 0} active book position{(result.snapshotCount || 0) === 1 ? '' : 's'}.
          </div>
        </div>
      ) : (
        <div className="lds-actions">
          <button className="lt-btn lt-btn-success" onClick={onClose}>
            <CheckCircle2 size={14} /> Close the Day
          </button>
        </div>
      )}
    </div>
  );
}
