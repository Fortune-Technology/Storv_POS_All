/**
 * CloseShiftModal — Count the closing cash drawer, review variance, and close shift.
 */

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { X, Lock, TrendingDown, TrendingUp, Minus, Printer, CheckCircle, Delete, FileText, Gauge } from 'lucide-react';
import { useShiftStore } from '../../stores/useShiftStore.js';
import { useAuthStore }  from '../../stores/useAuthStore.js';
import { useStationStore } from '../../stores/useStationStore.js';
import { getEndOfDayReport as apiGetEoDReport, getFuelTanks, createFuelStickReading } from '../../api/pos.js';
import { printEoDReport } from '../../services/printerService.js';
import { usePOSConfig }   from '../../hooks/usePOSConfig.js';
import { useFuelSettings } from '../../hooks/useFuelSettings.js';
import './CloseShiftModal.css';

const fmt = (n) => (n == null ? '--' : `$${Number(n).toFixed(2)}`);

const BILLS = [
  { value: 100, label: '$100' }, { value: 50, label: '$50' }, { value: 20, label: '$20' },
  { value: 10, label: '$10' }, { value: 5, label: '$5' }, { value: 2, label: '$2' }, { value: 1, label: '$1' },
];
const COINS = [
  { value: 1, label: '$1 coin' }, { value: 0.25, label: '25c' },
  { value: 0.10, label: '10c' }, { value: 0.05, label: '5c' }, { value: 0.01, label: '1c' },
];
const ALL = [...BILLS, ...COINS];
const initCounts = () => { const m = {}; ALL.forEach(d => { m[String(d.value)] = ''; }); return m; };
const NUMPAD = [['7','8','9'],['4','5','6'],['1','2','3'],['C','0','⌫']];

function DenomRow({ denom, count, active, onClick }) {
  const qty = parseInt(count) || 0;
  const subtotal = denom.value * qty;
  return (
    <div className={`csm-denom-row${active ? ' csm-denom-row--active' : qty > 0 ? ' csm-denom-row--has-qty' : ''}`} onClick={onClick}>
      <span className={`csm-denom-label${active ? ' csm-denom-label--active' : ' csm-denom-label--default'}`}>{denom.label}</span>
      <div className={`csm-denom-count${qty > 0 ? ' csm-denom-count--has-qty' : ' csm-denom-count--empty'}`}>{count || '0'}</div>
      <span className={`csm-denom-subtotal${qty > 0 ? ' csm-denom-subtotal--has-qty' : ' csm-denom-subtotal--empty'}`}>
        {qty > 0 ? `$${subtotal.toFixed(subtotal % 1 ? 2 : 0)}` : '--'}
      </span>
    </div>
  );
}

export function ShiftReportBody({ report }) {
  if (!report) return null;
  const variance = Number(report.variance) || 0;
  const balanced = Math.abs(variance) < 0.005;
  const over = variance > 0;

  // Map reconciliation kind → display color. Pure lookup, zero math —
  // the math is server-side in services/reconciliation/shift/.
  const KIND_COLOR = {
    opening:  'var(--text-primary)',
    incoming: 'var(--green)',
    outgoing: 'var(--amber)',
    subtotal: 'var(--text-primary)',
  };

  // Prefer the unified reconciliation when present (closeShift response,
  // post-Session 45). The `lineItems` array is pre-rendered server-side
  // — order, sign, label, kind are all already correct, lottery rows
  // included. Fall back to the legacy hardcoded rows for shift reports
  // persisted before the unified service shipped.
  const recon = report.reconciliation;
  const rows = (recon?.lineItems?.length)
    ? [
        ...recon.lineItems.map((li) => ({
          label: li.label,
          value: li.amount,
          color: KIND_COLOR[li.kind] || 'var(--text-primary)',
          bold:  li.kind === 'subtotal' || li.kind === 'opening',
          hint:  li.hint,
        })),
        // Counted Total isn't a server-derived line — it's what the cashier
        // typed. Always append after the server's "Expected" line.
        { label: 'Counted Total', value: report.closingAmount, color: 'var(--text-primary)', bold: true },
      ]
    : [
        { label: 'Opening Float',  value: report.openingAmount,  color: 'var(--text-primary)' },
        { label: '+ Cash Sales',   value: report.cashSales,      color: 'var(--green)' },
        { label: '- Cash Refunds', value: report.cashRefunds,    color: 'var(--red)' },
        { label: '- Cash Drops',   value: report.cashDropsTotal, color: 'var(--amber)' },
        { label: '- Paid Outs',    value: report.payoutsTotal,   color: 'var(--amber)' },
        { label: 'Expected Total', value: report.expectedAmount, color: 'var(--text-primary)', bold: true },
        { label: 'Counted Total',  value: report.closingAmount,  color: 'var(--text-primary)', bold: true },
      ];

  return (
    <div className="csm-report-content">
      <div className={`csm-variance-badge${balanced ? ' csm-variance-badge--balanced' : over ? ' csm-variance-badge--over' : ' csm-variance-badge--short'}`}>
        {balanced ? <Minus size={22} color="var(--green)" /> : over ? <TrendingUp size={22} color="var(--blue)" /> : <TrendingDown size={22} color="var(--red)" />}
        <div>
          <div className={`csm-variance-amount${balanced ? ' csm-variance-amount--balanced' : over ? ' csm-variance-amount--over' : ' csm-variance-amount--short'}`}>
            Variance: {variance >= 0 ? '+' : ''}{fmt(variance)}
          </div>
          <div className="csm-variance-status">
            {balanced ? 'Drawer balanced' : over ? 'Drawer is over' : 'Drawer is short'}
          </div>
        </div>
      </div>

      <div className="csm-breakdown">
        {rows.map((r, i) => r.value != null && (
          <div key={i} className={`csm-breakdown-row${i % 2 === 0 ? ' csm-breakdown-row--even' : ' csm-breakdown-row--odd'}${r.bold ? ' csm-breakdown-row--bold' : ''}`}>
            <div className="csm-breakdown-cell">
              <span className={`csm-breakdown-label${r.bold ? ' csm-breakdown-label--bold' : ''}`}>{r.label}</span>
              {r.hint && <span className="csm-breakdown-hint">{r.hint}</span>}
            </div>
            <span className={`csm-breakdown-value${r.bold ? ' csm-breakdown-value--bold' : ''}`} style={{ color: r.color }}>{fmt(r.value)}</span>
          </div>
        ))}
      </div>

      {/* Lottery cash-flow detail panel — only when the shift had any
          lottery activity. Surfaces the un-rung cash + machine numbers
          the new reconciliation captures. */}
      {recon?.lottery && (recon.lottery.unreportedCash > 0
        || recon.lottery.machineDrawSales > 0
        || recon.lottery.machineCashings > 0
        || recon.lottery.instantCashings > 0) && (
        <div className="csm-lottery-detail">
          <div className="csm-lottery-detail-title">Lottery Cash Flow</div>
          <div className="csm-lottery-detail-rows">
            {recon.lottery.unreportedCash > 0 && (
              <div className="csm-lottery-detail-row">
                <span>Un-rung instant cash <small>(ticket-math {fmt(recon.lottery.ticketMathSales)} − rung-up {fmt(recon.lottery.posLotterySales)})</small></span>
                <strong>+{fmt(recon.lottery.unreportedCash)}</strong>
              </div>
            )}
            {recon.lottery.machineDrawSales > 0 && (
              <div className="csm-lottery-detail-row">
                <span>Machine draw sales</span>
                <strong>+{fmt(recon.lottery.machineDrawSales)}</strong>
              </div>
            )}
            {recon.lottery.machineCashings > 0 && (
              <div className="csm-lottery-detail-row">
                <span>Machine cashings</span>
                <strong>-{fmt(recon.lottery.machineCashings)}</strong>
              </div>
            )}
            {recon.lottery.instantCashings > 0 && (
              <div className="csm-lottery-detail-row">
                <span>Instant cashings (online)</span>
                <strong>-{fmt(recon.lottery.instantCashings)}</strong>
              </div>
            )}
            <div className="csm-lottery-detail-total">
              <span>Net lottery cash to drawer</span>
              <strong>{recon.lottery.netLotteryCash >= 0 ? '+' : ''}{fmt(recon.lottery.netLotteryCash)}</strong>
            </div>
          </div>
        </div>
      )}

      {report.drops?.length > 0 && (
        <div>
          <div className="csm-drops-label">CASH DROPS</div>
          {report.drops.map((d, i) => (
            <div key={i} className="csm-drop-row">
              <span className="csm-drop-info">{new Date(d.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}{d.note ? ` -- ${d.note}` : ''}</span>
              <span className="csm-drop-amount">-{fmt(d.amount)}</span>
            </div>
          ))}
        </div>
      )}

      {report.payouts?.length > 0 && (
        <div>
          <div className="csm-drops-label">PAID OUTS</div>
          {report.payouts.map((p, i) => (
            <div key={i} className="csm-drop-row">
              <span className="csm-drop-info">
                {new Date(p.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                {p.recipient ? ` -- ${p.recipient}` : ''}{p.note ? ` (${p.note})` : ''}
                {p.payoutType && <span className={`csm-payout-type-badge${p.payoutType === 'expense' ? ' csm-payout-type-badge--expense' : ' csm-payout-type-badge--merch'}`}>{p.payoutType}</span>}
              </span>
              <span className="csm-drop-amount">-{fmt(p.amount)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="csm-report-meta">
        <div>Opened: {new Date(report.openedAt).toLocaleString()}</div>
        {report.closedAt && <div>Closed: {new Date(report.closedAt).toLocaleString()}</div>}
        {report.closingNote && <div>Note: {report.closingNote}</div>}
      </div>
    </div>
  );
}

function ShiftReportPrintable({ report }) {
  const variance = Number(report.variance) || 0;
  const recon = report.reconciliation;

  // Drive the thermal print from the same `lineItems` array the on-screen
  // breakdown uses — guarantees print matches screen, including the
  // lottery cash-flow rows when the shift had any. Falls back to the
  // legacy hardcoded rows for shift reports persisted before the unified
  // service shipped.
  const rows = (recon?.lineItems?.length)
    ? [
        ...recon.lineItems.map((li) => [li.label, li.amount]),
        ['Counted',  report.closingAmount],
        ['VARIANCE', variance],
      ]
    : [
        ['Opening Float', report.openingAmount], ['Cash Sales', report.cashSales],
        ['Cash Refunds', report.cashRefunds], ['Cash Drops', report.cashDropsTotal],
        ['Paid Outs', report.payoutsTotal], ['Expected', report.expectedAmount],
        ['Counted', report.closingAmount], ['VARIANCE', variance],
      ];

  return (
    <div className="csm-print-content">
      <h2>SHIFT REPORT</h2>
      <p>{new Date(report.openedAt).toLocaleDateString()}</p>
      <p>Cashier: {report.cashierName || '--'}</p>
      <hr />
      <table>
        <tbody>
          {rows.map(([label, val], i) => val != null && (
            <tr key={i}><td>{label}</td><td>${Number(val).toFixed(2)}</td></tr>
          ))}
        </tbody>
      </table>
      {/* Lottery cash flow on its own block so the thermal receipt has a
          dedicated section for the un-rung / online numbers. Only printed
          when the shift had non-zero lottery activity. */}
      {recon?.lottery && (recon.lottery.unreportedCash > 0
        || recon.lottery.machineDrawSales > 0
        || recon.lottery.machineCashings > 0
        || recon.lottery.instantCashings > 0) && (
        <>
          <hr />
          <p><strong>LOTTERY CASH FLOW</strong></p>
          <table>
            <tbody>
              {recon.lottery.unreportedCash > 0 && (
                <tr>
                  <td>+ Un-rung instant</td>
                  <td>${Number(recon.lottery.unreportedCash).toFixed(2)}</td>
                </tr>
              )}
              {recon.lottery.machineDrawSales > 0 && (
                <tr>
                  <td>+ Machine sales</td>
                  <td>${Number(recon.lottery.machineDrawSales).toFixed(2)}</td>
                </tr>
              )}
              {recon.lottery.machineCashings > 0 && (
                <tr>
                  <td>- Machine cashings</td>
                  <td>${Number(recon.lottery.machineCashings).toFixed(2)}</td>
                </tr>
              )}
              {recon.lottery.instantCashings > 0 && (
                <tr>
                  <td>- Instant cashings</td>
                  <td>${Number(recon.lottery.instantCashings).toFixed(2)}</td>
                </tr>
              )}
              <tr>
                <td><strong>Net lottery cash</strong></td>
                <td><strong>{recon.lottery.netLotteryCash >= 0 ? '+' : ''}${Number(recon.lottery.netLotteryCash).toFixed(2)}</strong></td>
              </tr>
            </tbody>
          </table>
        </>
      )}
      <hr />
      <p><strong>{Math.abs(variance) < 0.005 ? 'BALANCED' : variance > 0 ? `OVER $${variance.toFixed(2)}` : `SHORT $${Math.abs(variance).toFixed(2)}`}</strong></p>
      {report.closedAt && <p>Closed: {new Date(report.closedAt).toLocaleString()}</p>}
    </div>
  );
}

export default function CloseShiftModal({ onClose, onClosed }) {
  const { shift, closeShift, loading, error, clearError } = useShiftStore();
  const logout = useAuthStore(s => s.logout);
  const storeId = useStationStore(s => s.station?.storeId);
  const posConfig = usePOSConfig();
  const { settings: fuelSettings } = useFuelSettings();

  const [mode, setMode] = useState('denominations');
  const [counts, setCounts] = useState(initCounts);
  const [activeKey, setActiveKey] = useState(null);
  const [digits, setDigits] = useState('');
  const [note, setNote] = useState('');
  const [report, setReport] = useState(null);
  const [printingEoD, setPrintingEoD] = useState(false);
  const [eodError, setEodError] = useState(null);

  // V1.5: Stick-reading prompt — when fuel is enabled and cadence=shift,
  // fetch active tanks + require cashier to enter a reading (or Skip) before
  // closing the shift.
  const [tanks, setTanks]                   = useState([]);
  const [tankReadings, setTankReadings]     = useState({}); // { tankId: "actual gallons" }
  const [readingsSaved, setReadingsSaved]   = useState(false);
  const [readingsSkipped, setReadingsSkipped] = useState(false);
  const [readingsSaving, setReadingsSaving] = useState(false);
  const [readingsError, setReadingsError]   = useState(null);

  const promptForFuelReadings = Boolean(
    fuelSettings?.enabled
    && fuelSettings?.reconciliationCadence === 'shift'
  );

  useEffect(() => {
    if (!promptForFuelReadings || !storeId) return;
    getFuelTanks(storeId)
      .then(rows => {
        // Only fetch readings for active tanks with positive current level
        const active = Array.isArray(rows) ? rows.filter(t => t.active !== false && !t.deleted) : [];
        setTanks(active);
        if (active.length === 0) setReadingsSkipped(true); // no tanks → auto-skip
      })
      .catch(() => setTanks([]));
  }, [promptForFuelReadings, storeId]);

  const allReadingsEntered = tanks.length > 0
    && tanks.every(t => {
      const v = tankReadings[t.id];
      return v !== '' && v != null && !Number.isNaN(Number(v));
    });

  const readingsGateOk = !promptForFuelReadings
    || tanks.length === 0
    || readingsSaved
    || readingsSkipped;

  const handleSaveReadings = async () => {
    if (!allReadingsEntered) return;
    setReadingsSaving(true);
    setReadingsError(null);
    try {
      for (const t of tanks) {
        await createFuelStickReading({
          storeId,
          tankId:        t.id,
          actualGallons: Number(tankReadings[t.id]),
          shiftId:       shift?.id || undefined,
          notes:         'Recorded at shift close',
        });
      }
      setReadingsSaved(true);
    } catch (err) {
      setReadingsError(err?.response?.data?.error || err?.message || 'Failed to save readings');
    } finally {
      setReadingsSaving(false);
    }
  };

  const denomTotal = useMemo(() => ALL.reduce((s, d) => s + d.value * (parseInt(counts[String(d.value)]) || 0), 0), [counts]);
  const manualAmount = parseInt(digits || '0') / 100;
  const closingAmount = mode === 'manual' ? manualAmount : denomTotal;

  const handleNumpad = useCallback((key) => {
    if (mode === 'manual') {
      if (key === 'C') { setDigits(''); return; }
      if (key === '⌫') { setDigits(d => d.slice(0, -1)); return; }
      setDigits(d => (d + key).replace(/^0+/, '').slice(0, 7));
    } else {
      if (!activeKey) return;
      if (key === 'C') { setCounts(prev => ({ ...prev, [activeKey]: '' })); return; }
      if (key === '⌫') { setCounts(prev => ({ ...prev, [activeKey]: String(prev[activeKey]).slice(0, -1) })); return; }
      setCounts(prev => {
        const next = (String(prev[activeKey] || '') + key).replace(/^0+/, '').slice(0, 4);
        return { ...prev, [activeKey]: next };
      });
    }
  }, [mode, activeKey]);

  const handleClose = async () => {
    clearError();
    const denominations = mode === 'denominations'
      ? Object.fromEntries(Object.entries(counts).filter(([, v]) => parseInt(v) > 0).map(([k, v]) => [k, parseInt(v)]))
      : null;
    const result = await closeShift({ closingAmount, closingDenominations: denominations, closingNote: note.trim() || undefined });
    if (result.ok) setReport(result.report);
  };

  // Print the End-of-Day report to the THERMAL receipt printer (not window.print).
  // Pulls the shift-scoped EoD report from the backend, routes through
  // printerService which picks QZ-Tray (USB) or network-TCP based on POS config.
  const handlePrintEoD = async () => {
    const shiftId = report?.id || shift?.id;
    if (!shiftId) { setEodError('No shift ID — can\'t build the EoD report'); return; }
    setPrintingEoD(true);
    setEodError(null);
    try {
      const eod = await apiGetEoDReport(shiftId);
      await printEoDReport(posConfig, eod);
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || 'Print failed';
      setEodError(msg);
      console.warn('[EoD print] failed:', err);
    } finally {
      setPrintingEoD(false);
    }
  };

  const numpadDisplay = mode === 'manual'
    ? `$${manualAmount.toFixed(2)}`
    : activeKey
      ? `${counts[activeKey] || '0'} x ${parseFloat(activeKey) >= 1 ? `$${parseFloat(activeKey).toFixed(0)}` : `$${parseFloat(activeKey).toFixed(2)}`}`
      : 'Tap a row';

  // Report view
  if (report) {
    return (
      <>
        <div className="csm-print-report"><ShiftReportPrintable report={report} /></div>
        <div className="csm-backdrop">
          <div className="csm-modal csm-modal--report">
            <div className="csm-header csm-header--green">
              <div className="csm-header-left">
                <CheckCircle size={18} color="var(--green)" />
                <span className="csm-header-title csm-header-title--green">Shift Closed</span>
              </div>
            </div>
            <div className="csm-report-body"><ShiftReportBody report={report} /></div>
            {eodError && (
              <div className="csm-eod-error">
                ⚠ Receipt printer error: {eodError}
              </div>
            )}
            <div className="csm-report-footer">
              <button
                className="csm-btn-print"
                onClick={handlePrintEoD}
                disabled={printingEoD}
                title="Print full End-of-Day report (payouts, tenders, transactions) to the receipt printer"
              >
                <FileText size={15} /> {printingEoD ? 'Printing…' : 'Print EoD Receipt'}
              </button>
              <button className="csm-btn-done" onClick={() => { onClosed?.(report); onClose(); logout(); }}>
                Done &amp; Sign Out
              </button>
            </div>
          </div>
        </div>
      </>
    );
  }

  // Count form
  return (
    <div className="csm-backdrop">
      <div className="csm-modal">
        <div className="csm-header csm-header--red">
          <div className="csm-header-left">
            <Lock size={18} color="var(--red)" />
            <div>
              <div className="csm-header-title csm-header-title--red">Close Cash Drawer</div>
              <div className="csm-header-sub">Count your drawer to close the shift</div>
            </div>
          </div>
          <button className="csm-close-btn" onClick={onClose}><X size={16} /></button>
        </div>

        {shift && (
          <div className="csm-shift-strip">
            <span className="csm-shift-item">Cashier: <strong className="csm-shift-value">{shift.cashierName || '--'}</strong></span>
            <span className="csm-shift-item">Opened: <strong className="csm-shift-value">{new Date(shift.openedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong></span>
            <span className="csm-shift-item">Float: <strong className="csm-shift-value--green">{fmt(shift.openingAmount)}</strong></span>
          </div>
        )}

        {/* V1.5: Fuel stick-reading prompt — gates the shift close when
            FuelSettings.reconciliationCadence === 'shift' and active tanks exist. */}
        {promptForFuelReadings && tanks.length > 0 && !readingsSaved && !readingsSkipped && (
          <div className="csm-fuel-reading">
            <div className="csm-fuel-reading-head">
              <Gauge size={16} />
              <div>
                <div className="csm-fuel-reading-title">Tank Readings Required</div>
                <div className="csm-fuel-reading-sub">
                  Measure each active tank with a stick and enter the actual gallons. Your reconciliation cadence is set to per-shift.
                </div>
              </div>
            </div>
            <div className="csm-fuel-reading-grid">
              {tanks.map(t => (
                <div key={t.id} className="csm-fuel-reading-row">
                  <div className="csm-fuel-reading-tank">
                    <div className="csm-fuel-reading-tank-name">{t.name}</div>
                    <div className="csm-fuel-reading-tank-cap">
                      Capacity: {Number(t.capacityGal).toLocaleString()} gal
                    </div>
                  </div>
                  <div className="csm-fuel-reading-input-wrap">
                    <input
                      type="number"
                      min={0}
                      step={0.1}
                      placeholder="Actual gallons"
                      value={tankReadings[t.id] ?? ''}
                      onChange={e => setTankReadings(r => ({ ...r, [t.id]: e.target.value }))}
                      className="csm-fuel-reading-input"
                    />
                    <span className="csm-fuel-reading-unit">gal</span>
                  </div>
                </div>
              ))}
            </div>
            {readingsError && <div className="csm-fuel-reading-err">{readingsError}</div>}
            <div className="csm-fuel-reading-actions">
              <button
                className="csm-fuel-reading-skip"
                onClick={() => setReadingsSkipped(true)}
                disabled={readingsSaving}
              >
                Skip (not recommended)
              </button>
              <button
                className="csm-fuel-reading-save"
                onClick={handleSaveReadings}
                disabled={!allReadingsEntered || readingsSaving}
              >
                {readingsSaving ? 'Saving…' : 'Save Readings'}
              </button>
            </div>
          </div>
        )}

        {promptForFuelReadings && readingsSaved && (
          <div className="csm-fuel-reading-done">
            <CheckCircle size={14} color="#16a34a" /> Tank readings saved — proceed with shift close.
          </div>
        )}

        <div className="csm-mode-tabs">
          {[['denominations', 'Count by Denomination'], ['manual', 'Enter Total']].map(([m, label]) => (
            <button key={m} className={`csm-mode-tab${mode === m ? ' csm-mode-tab--active' : ' csm-mode-tab--inactive'}`}
              onClick={() => { setMode(m); setActiveKey(null); }}>{label}</button>
          ))}
        </div>

        <div className="csm-body">
          <div className="csm-left">
            {mode === 'manual' ? (
              <div className="csm-manual-section">
                <div className="csm-manual-label">CLOSING AMOUNT</div>
                <div className="csm-manual-display">
                  <div className="csm-manual-amount">${manualAmount.toFixed(2)}</div>
                  <div className="csm-manual-hint">Use the numpad to enter the amount</div>
                </div>
                <div className="csm-manual-tip">Tip: type 5 8 9 to enter $5.89</div>
              </div>
            ) : (
              <div className="csm-denom-grid">
                <div>
                  <div className="csm-denom-col-label">BILLS</div>
                  {BILLS.map(d => <DenomRow key={d.value} denom={d} count={counts[String(d.value)]} active={activeKey === String(d.value)} onClick={() => setActiveKey(String(d.value))} />)}
                </div>
                <div>
                  <div className="csm-denom-col-label">COINS</div>
                  {COINS.map(d => <DenomRow key={d.value} denom={d} count={counts[String(d.value)]} active={activeKey === String(d.value)} onClick={() => setActiveKey(String(d.value))} />)}
                </div>
              </div>
            )}
            <div className="csm-note-section">
              <div className="csm-note-label">CLOSING NOTE (optional)</div>
              <input className="csm-note-input" type="text" value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. End of day count" />
            </div>
            {error && <div className="csm-error">{error}</div>}
          </div>

          <div className="csm-right">
            <div className={`csm-numpad-display${mode === 'manual' ? ' csm-numpad-display--manual' : ' csm-numpad-display--denom'}`}>
              {numpadDisplay}
            </div>
            {NUMPAD.map((row, ri) => (
              <div key={ri} className="csm-numpad-row">
                {row.map(key => {
                  const dim = mode === 'denominations' && !activeKey && key !== 'C';
                  return (
                    <button key={key}
                      className={`csm-numpad-btn${key === 'C' ? ' csm-numpad-btn--clear' : key === '⌫' ? ' csm-numpad-btn--back' : ' csm-numpad-btn--digit'}${dim ? ' csm-numpad-btn--dim' : ''}`}
                      onClick={() => handleNumpad(key)} disabled={dim}
                    >
                      {key === '⌫' ? <Delete size={16} /> : key}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        <div className="csm-footer">
          <div className="csm-footer-total">
            <div className="csm-footer-label">COUNTED TOTAL</div>
            <div className="csm-footer-amount">${closingAmount.toFixed(2)}</div>
          </div>
          <button
            className={`csm-close-shift-btn${loading ? ' csm-close-shift-btn--loading' : ' csm-close-shift-btn--active'}`}
            onClick={handleClose}
            disabled={loading || !readingsGateOk}
            title={!readingsGateOk ? 'Complete or skip the tank readings above before closing the shift' : undefined}
          >
            {loading ? 'Calculating...' : (!readingsGateOk ? 'Enter tank readings to continue' : 'Close Shift & See Variance')}
          </button>
        </div>
      </div>
    </div>
  );
}
