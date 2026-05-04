/**
 * EndOfDayModal — Manager-only end-of-day summary on the cashier app.
 *
 * Renders the SAME response shape as the back-office /portal/end-of-day page
 * (header / payouts / tenders / transactions / fuel / reconciliation / totals)
 * so what the cashier prints from the register matches what the manager sees
 * in the back office.
 *
 * Print path: thermal receipt printer via `printEoDReport(config, report)`
 * — formatted by `buildEoDReceiptString` in printerService.js (also includes
 * the fuel section).
 *
 * Gated behind manager PIN at the ActionBar level (mgr('End of Day', ...)).
 */
import React, { useState, useEffect, useCallback } from 'react';
import { X, BarChart2, Printer, RefreshCw, CreditCard, AlertCircle } from 'lucide-react';
import {
  getEndOfDayReport,
  dejavooSettle,
  dejavooMerchantStatus,
} from '../../api/pos.js';
import { fmt$ } from '../../utils/formatters.js';
import { useStationStore } from '../../stores/useStationStore.js';
import { useHardware } from '../../hooks/useHardware.js';
import { usePOSConfig } from '../../hooks/usePOSConfig.js';
import { useConfirm } from '../../hooks/useConfirmDialog.jsx';
import { printEoDReport } from '../../services/printerService.js';
import './EndOfDayModal.css';

// Local-day "YYYY-MM-DD" string for the API
const todayLocal = () => {
  const d = new Date();
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const fmtNum3 = (n) => Number(n || 0).toFixed(3);

export default function EndOfDayModal({ onClose }) {
  const confirm = useConfirm();
  const station   = useStationStore(s => s.station);
  const storeId   = station?.storeId;
  const posConfig = usePOSConfig();

  const [date,         setDate]         = useState(todayLocal());
  const [report,       setReport]       = useState(null);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState(null);
  const [printing,     setPrinting]     = useState(false);
  const [settling,     setSettling]     = useState(false);
  const [settleResult, setSettleResult] = useState(null);
  const [hasDejavoo,   setHasDejavoo]   = useState(false);

  const { hasReceiptPrinter } = useHardware();

  // ── Load report ───────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!storeId) return;
    setLoading(true);
    setError(null);
    try {
      const r = await getEndOfDayReport(null, { storeId, date });
      setReport(r);
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Failed to load report');
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [storeId, date]);

  useEffect(() => { load(); }, [load]);

  // Detect Dejavoo (for Close Batch button)
  useEffect(() => {
    dejavooMerchantStatus()
      .then(s => setHasDejavoo(!!(s?.configured && s?.provider === 'dejavoo' && s?.hasTpn)))
      .catch(() => setHasDejavoo(false));
  }, []);

  // ── Print thermal receipt ─────────────────────────────────────────────────
  const handlePrint = useCallback(async () => {
    if (!report) return;
    setPrinting(true);
    try {
      await printEoDReport(posConfig, report);
    } catch (err) {
      console.warn('EoD print failed:', err.message);
    } finally {
      setPrinting(false);
    }
  }, [report, posConfig]);

  // ── Close Batch (Dejavoo) ─────────────────────────────────────────────────
  const handleCloseBatch = useCallback(async () => {
    if (settling) return;
    if (!station?.id) {
      setSettleResult({ success: false, message: 'No station — cannot settle' });
      return;
    }
    if (!await confirm({
      title: "Close today's batch?",
      message: 'This will settle all card transactions on the terminal with the processor. Once closed, the batch cannot be reopened.',
      confirmLabel: 'Close batch',
      danger: true,
    })) return;
    setSettling(true);
    setSettleResult(null);
    try {
      const r = await dejavooSettle({ stationId: station.id });
      setSettleResult({
        success: !!r?.success,
        message: r?.success
          ? 'Batch closed — all card transactions submitted to processor'
          : (r?.result?.message || r?.error || 'Settle failed'),
      });
    } catch (err) {
      setSettleResult({ success: false, message: err?.response?.data?.error || err.message || 'Settle failed' });
    } finally {
      setSettling(false);
    }
  }, [settling, station]);

  return (
    <div className="eod-backdrop">
      <div className="eod-modal">
        {/* ── Header ── */}
        <div className="eod-header">
          <div className="eod-header-left">
            <BarChart2 size={16} color="var(--green)" />
            <div>
              <div className="eod-header-title">End of Day Report</div>
              <div className="eod-header-date">{date}</div>
            </div>
          </div>
          <div className="eod-header-actions">
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="eod-date-input"
              max={todayLocal()}
            />
            <button className="eod-icon-btn" onClick={load} disabled={loading} title="Refresh">
              <RefreshCw size={15} className={loading ? 'eod-spin' : ''} />
            </button>
            {hasReceiptPrinter && (
              <button
                className={`eod-icon-btn${printing ? ' eod-icon-btn--printing' : ''}${!report ? ' eod-icon-btn--disabled' : ''}`}
                onClick={handlePrint}
                disabled={printing || !report}
                title="Print to receipt printer"
              >
                <Printer size={15} />
              </button>
            )}
            {hasDejavoo && (
              <button
                onClick={handleCloseBatch}
                disabled={settling}
                title="Settle today's card batch with the processor"
                className="eod-batch-btn"
              >
                <CreditCard size={13} />
                {settling ? 'Closing…' : 'Close Batch'}
              </button>
            )}
            <button className="eod-icon-btn" onClick={onClose}><X size={16} /></button>
          </div>
        </div>

        {/* ── Settle result banner ── */}
        {settleResult && (
          <div className={`eod-settle-banner ${settleResult.success ? 'eod-settle-banner--ok' : 'eod-settle-banner--err'}`}>
            <span>{settleResult.success ? '✓' : '✗'} {settleResult.message}</span>
            <button onClick={() => setSettleResult(null)} className="eod-settle-banner-x">
              <X size={13} />
            </button>
          </div>
        )}

        {/* ── Body ── */}
        <div className="eod-body">
          {loading && <div className="eod-loading">Loading…</div>}
          {!loading && error && (
            <div className="eod-error">
              <AlertCircle size={14} /> {error}
            </div>
          )}
          {!loading && !error && report && <ReportBody report={report} />}
        </div>

        <div className="eod-footer">
          <button className="eod-close-btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// REPORT BODY — mirrors the back-office /portal/end-of-day layout exactly
// ════════════════════════════════════════════════════════════════════════════
function ReportBody({ report }) {
  const h         = report.header || {};
  const totals    = report.totals || {};
  const recon     = report.reconciliation;
  const fuel      = report.fuel;
  const fuelHas   = fuel?.rows?.length > 0;
  const lottery   = report.lottery;
  const lotteryHas = lottery?.rows?.length > 0;

  return (
    <div className="eod-body-content">

      {/* Header strip */}
      <div className="eod-rb-header">
        {h.storeName && <div><span className="eod-rb-label">Store:</span> {h.storeName}</div>}
        {h.cashierName && <div><span className="eod-rb-label">Cashier:</span> {h.cashierName}</div>}
        {h.stationName && <div><span className="eod-rb-label">Register:</span> {h.stationName}</div>}
        <div><span className="eod-rb-label">Period:</span> {fmtRange(h.from, h.to)}</div>
      </div>

      {/* Big numbers */}
      <div className="eod-rb-bignum-row">
        <div className="eod-rb-bignum">
          <div className="eod-rb-bignum-label">Net Sales</div>
          <div className="eod-rb-bignum-value">{fmt$(totals.netSales)}</div>
        </div>
        <div className="eod-rb-bignum">
          <div className="eod-rb-bignum-label">Gross Sales</div>
          <div className="eod-rb-bignum-value">{fmt$(totals.grossSales)}</div>
        </div>
        <div className="eod-rb-bignum">
          <div className="eod-rb-bignum-label">Cash Collected</div>
          <div className="eod-rb-bignum-value">{fmt$(totals.cashCollected)}</div>
        </div>
      </div>

      {/* Section 1: Payouts */}
      <ThreeColSection title="PAYOUTS" rows={report.payouts} />

      {/* Section 2: Tender Details */}
      <ThreeColSection title="TENDER DETAILS" rows={report.tenders} />

      {/* Section 3: Transactions */}
      <ThreeColSection title="TRANSACTIONS" rows={report.transactions} hideZero={false} />

      {/* S67 — Department Breakdown (opt-in via store.pos.eodReport.showDepartmentBreakdown) */}
      {report.departments?.rows?.length > 0 && (
        <div className="eod-rb-section">
          <div className="eod-rb-section-title">DEPARTMENT BREAKDOWN</div>
          <table className="eod-rb-table">
            <thead>
              <tr><th>Department</th><th className="eod-rb-num">Tx</th><th className="eod-rb-num">Net</th></tr>
            </thead>
            <tbody>
              {report.departments.rows.map(d => (
                <tr key={String(d.departmentId ?? d.name)}>
                  <td>{d.name}</td>
                  <td className="eod-rb-num">{d.txCount}</td>
                  <td className="eod-rb-num">{fmt$(d.netSales)}</td>
                </tr>
              ))}
              <tr className="eod-rb-strong">
                <td>Total</td>
                <td className="eod-rb-num">—</td>
                <td className="eod-rb-num">{fmt$(report.departments.total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Lottery summary — accountant ledger view (sale / payouts / net cash).
          Mirror of the fuel block. Always shown when lottery activity exists.
          Distinct from the cash-flow detail section below which only renders
          when `lotterySeparateFromDrawer` is enabled. */}
      {lotteryHas && (
        <div className="eod-rb-section">
          <div className="eod-rb-section-title">LOTTERY SUMMARY</div>
          <table className="eod-rb-table eod-rb-fuel-table">
            <thead>
              <tr>
                <th>Game</th>
                <th className="eod-rb-num">Sales $</th>
                <th className="eod-rb-num">Payouts $</th>
                <th className="eod-rb-num">Net Cash</th>
              </tr>
            </thead>
            <tbody>
              {lottery.rows.map(r => (
                <tr key={r.gameId || r.gameName}>
                  <td>{r.gameName}</td>
                  <td className="eod-rb-num">{fmt$(r.saleAmount)}</td>
                  <td className="eod-rb-num">{fmt$(r.payoutAmount)}</td>
                  <td className="eod-rb-num">{fmt$(r.netCash)}</td>
                </tr>
              ))}
              <tr className="eod-rb-strong">
                <td>Total</td>
                <td className="eod-rb-num">{fmt$(lottery.totals.saleAmount)}</td>
                <td className="eod-rb-num">{fmt$(lottery.totals.payoutAmount)}</td>
                <td className="eod-rb-num">{fmt$(lottery.totals.netCash)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Section 4: Fuel (optional) */}
      {fuelHas && (
        <div className="eod-rb-section">
          <div className="eod-rb-section-title">FUEL SALES</div>
          <table className="eod-rb-table eod-rb-fuel-table">
            <thead>
              <tr>
                <th>Type</th>
                <th className="eod-rb-num">Net Gal</th>
                <th className="eod-rb-num">Net $</th>
              </tr>
            </thead>
            <tbody>
              {fuel.rows.map(f => (
                <tr key={f.fuelTypeId || f.name}>
                  <td>{f.name}{f.gradeLabel ? ` · ${f.gradeLabel}` : ''}</td>
                  <td className="eod-rb-num">{fmtNum3(f.netGallons)}</td>
                  <td className="eod-rb-num">{fmt$(f.netAmount)}</td>
                </tr>
              ))}
              <tr className="eod-rb-strong">
                <td>Total</td>
                <td className="eod-rb-num">{fmtNum3(fuel.totals.gallons)}</td>
                <td className="eod-rb-num">{fmt$(fuel.totals.amount)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* S67 — Standalone Lottery section. Only when lotterySeparateFromDrawer=true. */}
      {report.settings?.lotterySeparateFromDrawer && recon?.lottery && (() => {
        const L = recon.lottery;
        const anyActivity = L.ticketMathSales > 0 || L.posLotterySales > 0 ||
                            L.machineDrawSales > 0 || L.machineCashings > 0 || L.instantCashings > 0;
        if (!anyActivity) return null;
        return (
          <div className="eod-rb-section">
            <div className="eod-rb-section-title">LOTTERY CASH FLOW (separate from drawer)</div>
            <table className="eod-rb-table">
              <tbody>
                {L.ticketMathSales > 0    && <tr><td>Ticket-math Sales (truth)</td><td className="eod-rb-num">{fmt$(L.ticketMathSales)}</td></tr>}
                {L.posLotterySales > 0    && <tr><td>POS-Recorded Lottery Sales</td><td className="eod-rb-num">{fmt$(L.posLotterySales)}</td></tr>}
                {L.unreportedCash > 0     && <tr><td>+ Un-rung Tickets</td><td className="eod-rb-num">{fmt$(L.unreportedCash)}</td></tr>}
                {L.machineDrawSales > 0   && <tr><td>+ Machine Draw Sales</td><td className="eod-rb-num">{fmt$(L.machineDrawSales)}</td></tr>}
                {L.machineCashings > 0    && <tr><td>− Machine Draw Cashings</td><td className="eod-rb-num">{fmt$(L.machineCashings)}</td></tr>}
                {L.instantCashings > 0    && <tr><td>− Instant Cashings</td><td className="eod-rb-num">{fmt$(L.instantCashings)}</td></tr>}
                <tr className="eod-rb-strong">
                  <td>= Net Lottery Cash</td>
                  <td className="eod-rb-num">{fmt$(L.netLotteryCash)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        );
      })()}

      {/* Reconciliation (shift only) */}
      {recon && (
        <div className="eod-rb-section">
          <div className="eod-rb-section-title">CASH DRAWER RECONCILIATION</div>
          <table className="eod-rb-table">
            <tbody>
              <tr><td>Opening Amount</td><td className="eod-rb-num">{fmt$(recon.openingAmount)}</td></tr>
              <tr><td>+ Cash Collected</td><td className="eod-rb-num">{fmt$(recon.cashCollected)}</td></tr>
              {recon.cashIn > 0 && (
                <tr><td>+ Cash In (Paid-in / Received on Acct)</td><td className="eod-rb-num">{fmt$(recon.cashIn)}</td></tr>
              )}
              <tr><td>− Cash Drops (Pickups)</td><td className="eod-rb-num">{fmt$(recon.cashDropsTotal)}</td></tr>
              <tr><td>− Cash Out (Paid-out / Loans)</td><td className="eod-rb-num">{fmt$(recon.cashOut ?? recon.cashPayoutsTotal)}</td></tr>
              <tr className="eod-rb-strong">
                <td>= Expected in Drawer</td>
                <td className="eod-rb-num">{fmt$(recon.expectedInDrawer)}</td>
              </tr>
              {recon.closingAmount != null && (
                <>
                  <tr><td>Closing (Counted)</td><td className="eod-rb-num">{fmt$(recon.closingAmount)}</td></tr>
                  <tr className={`eod-rb-strong ${
                    Math.abs(recon.variance || 0) <= 0.01 ? '' :
                    recon.variance < 0 ? 'eod-rb-warn' : 'eod-rb-ok'
                  }`}>
                    <td>Variance</td>
                    <td className="eod-rb-num">{fmt$(recon.variance)}</td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Generic 3-col section (Type / Count / Amount) ──────────────────────────
function ThreeColSection({ title, rows = [], hideZero = true }) {
  const visible = hideZero ? rows.filter(r => r.amount !== 0 || r.count !== 0) : rows;
  return (
    <div className="eod-rb-section">
      <div className="eod-rb-section-title">{title}</div>
      <table className="eod-rb-table">
        <thead>
          <tr>
            <th>Type</th>
            <th className="eod-rb-num">Count</th>
            <th className="eod-rb-num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {visible.length === 0 ? (
            <tr><td colSpan={3} className="eod-rb-empty">— None —</td></tr>
          ) : (
            visible.map(r => (
              <tr key={r.key}>
                <td>{r.label}</td>
                <td className="eod-rb-num">{r.count}</td>
                <td className="eod-rb-num">{fmt$(r.amount)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function fmtRange(from, to) {
  if (!from || !to) return '';
  const f = new Date(from), t = new Date(to);
  const sameDay = f.toDateString() === t.toDateString();
  const fmt = (d) => d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return sameDay ? `${fmt(f)} → ${t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : `${fmt(f)} → ${fmt(t)}`;
}
