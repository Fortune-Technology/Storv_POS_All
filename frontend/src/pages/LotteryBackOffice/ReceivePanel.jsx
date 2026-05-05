// ════════════════════════════════════════════════════════════════════
// Receive Panel — inline replacement for the right column
// (replaces the old modal that kept auto-closing)
// Extracted from LotteryBackOffice (May 2026 split).
// ════════════════════════════════════════════════════════════════════
import React, { useEffect, useRef, useState } from 'react';
import { useConfirm } from '../../hooks/useConfirmDialog.jsx';
import { Package, ScanLine, X } from 'lucide-react';
import { receiveLotteryBoxOrder, parseLotteryBarcode } from '../../services/api';
import { PackPill } from './shared.jsx';
import { fmtMoney, todayStr, guessPack } from './utils.js';

export default function ReceivePanel({ games, catalog, date, onClose, onSaved }) {
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
