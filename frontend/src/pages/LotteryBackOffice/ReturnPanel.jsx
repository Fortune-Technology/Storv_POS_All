// ════════════════════════════════════════════════════════════════════
// Return Panel — supports full and partial returns.
// Extracted from LotteryBackOffice (May 2026 split).
// ════════════════════════════════════════════════════════════════════
import React, { useEffect, useMemo, useState } from 'react';
import { useConfirm } from '../../hooks/useConfirmDialog.jsx';
import { RotateCcw, X } from 'lucide-react';
import { returnLotteryBoxToLotto } from '../../services/api';
import { fmtLottery } from './utils.js';

export default function ReturnPanel({ active, safe, sellDirection = 'desc', date, onClose, onSaved }) {
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
