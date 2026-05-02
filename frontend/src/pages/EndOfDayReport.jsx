/**
 * End-of-Day Report — back-office view
 *
 * Structured as 3 sections per the spec:
 *   1. Payouts      (Cashback, Loans, Pickups, Paid-ins, Paid-outs,
 *                    Received on Acct, Refunds, Tips, Voids)
 *   2. Tender       (Cash, EBT Cash, Check, Debit, Credit, EFS, Paper FS,
 *                    In-store Charge, Store Gift Card)
 *   3. Transactions (Avg Tx, Net Sales, Gross Sales, Tax, Cash Collected)
 *
 * Supports single-day, date range, per-cashier, per-station, per-shift views.
 * Offers Print, CSV, and PDF export.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Printer, Download, FileText, Calendar, User, Monitor, RefreshCw } from 'lucide-react';
import { toast } from 'react-toastify';
import {
  getEndOfDayReport,
  getStores,
  getStoreEmployees,
} from '../services/api';
import { downloadCSV, downloadPDF } from '../utils/exportUtils';
import './EndOfDayReport.css';

const fmt$ = (n) => {
  if (n == null) return 'N/A';
  const v = Number(n);
  if (!Number.isFinite(v)) return 'N/A';
  const sign = v < 0 ? '-' : '';
  return `${sign}$${Math.abs(v).toFixed(2)}`;
};

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};

export default function EndOfDayReport({ embedded = false } = {}) {
  const [stores,    setStores]    = useState([]);
  const [employees, setEmployees] = useState([]);
  const [storeId,   setStoreId]   = useState('');
  const [cashierId, setCashierId] = useState('');
  const [date,      setDate]      = useState(todayStr());
  const [useRange,  setUseRange]  = useState(false);
  const [dateFrom,  setDateFrom]  = useState(todayStr());
  const [dateTo,    setDateTo]    = useState(todayStr());
  const [report,    setReport]    = useState(null);
  const [loading,   setLoading]   = useState(false);

  // Load stores + employees for filter dropdowns
  useEffect(() => {
    getStores().then(r => {
      const list = Array.isArray(r) ? r : (r?.data || []);
      setStores(list);
      if (list.length && !storeId) setStoreId(list[0].id);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!storeId) return;
    getStoreEmployees({ storeId }).then(r => {
      setEmployees(r?.employees || []);
    }).catch(() => {});
  }, [storeId]);

  const loadReport = async () => {
    if (!storeId) { toast.warn('Pick a store first'); return; }
    setLoading(true);
    setReport(null);
    try {
      const params = { storeId };
      if (cashierId) params.cashierId = cashierId;
      if (useRange) { params.dateFrom = dateFrom; params.dateTo = dateTo; }
      else          { params.date     = date; }
      const data = await getEndOfDayReport(params);
      setReport(data);
    } catch (err) {
      toast.error('Failed to load report: ' + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (storeId) loadReport(); /* eslint-disable-line */ }, [storeId]);

  // ── Print (receipt-like formatted view) ────────────────────────────────
  const handlePrint = () => {
    window.print();
  };

  // ── CSV Export ─────────────────────────────────────────────────────────
  const handleCSV = () => {
    if (!report) return;
    const rows = [];
    const header = (section) => { rows.push({ Section: section, Type: '', Count: '', Amount: '' }); };
    header('PAYOUTS');
    report.payouts.forEach(p => rows.push({ Section: '', Type: p.label, Count: p.count, Amount: p.amount.toFixed(2) }));
    rows.push({ Section: '', Type: '', Count: '', Amount: '' });
    header('TENDERS');
    report.tenders.forEach(t => rows.push({ Section: '', Type: t.label, Count: t.count, Amount: t.amount.toFixed(2) }));
    rows.push({ Section: '', Type: '', Count: '', Amount: '' });
    header('TRANSACTIONS');
    report.transactions.forEach(tx => rows.push({ Section: '', Type: tx.label, Count: tx.count, Amount: tx.amount.toFixed(2) }));
    if (Array.isArray(report.fees) && report.fees.some(f => Math.abs(f.amount) > 0.001 || f.count > 0)) {
      header('PASS-THROUGH FEES (not revenue / not profit)');
      report.fees.forEach(f => rows.push({ Section: '', Type: f.label, Count: f.count, Amount: (f.amount || 0).toFixed(2) }));
    }
    if (report.fuel?.rows?.length) {
      rows.push({ Section: '', Type: '', Count: '', Amount: '' });
      header('FUEL SALES');
      report.fuel.rows.forEach(r => rows.push({
        Section: '',
        Type:    `${r.name}${r.gradeLabel ? ' · ' + r.gradeLabel : ''} (net gal ${Number(r.netGallons).toFixed(3)})`,
        Count:   r.salesCount + r.refundCount,
        Amount:  Number(r.netAmount).toFixed(2),
      }));
    }
    if (report.dualPricing) {
      rows.push({ Section: '', Type: '', Count: '', Amount: '' });
      header('DUAL PRICING');
      rows.push({ Section: '', Type: 'Card Transactions (Surcharge Applied)', Count: report.dualPricing.surchargedTxCount, Amount: report.dualPricing.surchargeCollected.toFixed(2) });
      rows.push({ Section: '', Type: 'Cash / EBT Transactions (No Surcharge)', Count: report.dualPricing.cashTxOnDualCount, Amount: '0.00' });
      if (report.dualPricing.surchargeTaxCollected > 0.005) {
        rows.push({ Section: '', Type: 'Tax on Surcharge', Count: '', Amount: report.dualPricing.surchargeTaxCollected.toFixed(2) });
      }
      rows.push({ Section: '', Type: 'Total Surcharge Revenue', Count: '', Amount: report.dualPricing.surchargeTotal.toFixed(2) });
      if (report.dualPricing.cashSavingsTotal > 0.005) {
        rows.push({ Section: '', Type: 'Customer Savings (Cash)', Count: '', Amount: report.dualPricing.cashSavingsTotal.toFixed(2) });
      }
    }
    downloadCSV(rows, [
      { key: 'Section', label: 'Section' },
      { key: 'Type',    label: 'Type'    },
      { key: 'Count',   label: 'Count'   },
      { key: 'Amount',  label: 'Amount'  },
    ], `end-of-day-${date || dateFrom}.csv`);
  };

  // ── PDF Export ─────────────────────────────────────────────────────────
  const handlePDF = () => {
    if (!report) return;
    const rows = [];
    const push = (section, t) => rows.push({ Section: section, Type: t.label, Count: t.count, Amount: `$${t.amount.toFixed(2)}` });
    report.payouts.forEach(p => push('Payout', p));
    report.tenders.forEach(t => push('Tender', t));
    report.transactions.forEach(tx => push('Transaction', tx));
    if (report.fuel?.rows?.length) {
      report.fuel.rows.forEach(r => rows.push({
        Section: 'Fuel',
        Type:    `${r.name}${r.gradeLabel ? ' · ' + r.gradeLabel : ''} — ${Number(r.netGallons).toFixed(3)} gal`,
        Count:   r.salesCount + r.refundCount,
        Amount:  `$${Number(r.netAmount).toFixed(2)}`,
      }));
    }
    if (report.dualPricing) {
      rows.push({ Section: 'Dual Pricing', Type: 'Card Tx Surcharged',  Count: report.dualPricing.surchargedTxCount, Amount: `$${report.dualPricing.surchargeCollected.toFixed(2)}` });
      rows.push({ Section: 'Dual Pricing', Type: 'Cash/EBT (no surcharge)', Count: report.dualPricing.cashTxOnDualCount, Amount: '$0.00' });
      rows.push({ Section: 'Dual Pricing', Type: 'Total Surcharge Revenue', Count: '',                                  Amount: `$${report.dualPricing.surchargeTotal.toFixed(2)}` });
    }
    downloadPDF({
      title:    'End of Day Report',
      subtitle: `${report.header.storeName || ''}  ${useRange ? `${dateFrom} → ${dateTo}` : date}`,
      data: rows,
      columns: [
        { key: 'Section', label: 'Section' },
        { key: 'Type',    label: 'Type'    },
        { key: 'Count',   label: 'Count',  align: 'right' },
        { key: 'Amount',  label: 'Amount', align: 'right' },
      ],
      filename: `end-of-day-${date || dateFrom}.pdf`,
    });
  };

  const header = report?.header;
  const grandTotals = useMemo(() => {
    if (!report) return null;
    return {
      payoutsTotal:    report.payouts.reduce((s, p) => s + p.amount, 0),
      tenderTotal:     report.tenders.reduce((s, t) => s + t.amount, 0),
      grossSales:      report.totals?.grossSales ?? 0,
      netSales:        report.totals?.netSales   ?? 0,
      cashCollected:   report.totals?.cashCollected ?? 0,
    };
  }, [report]);

  return (
    <div className="eod-page">
      {/* ── Non-print toolbar (header hidden when embedded under a hub) ── */}
      <div className="eod-toolbar" data-no-print>
        <div className="eod-toolbar-left">
          {!embedded && (
            <div className="p-header-left">
              <div className="p-header-icon"><FileText size={22} /></div>
              <div>
                <h1 className="p-title">End of Day Report</h1>
                <p className="p-subtitle">Reconcile payouts, tender, transactions, and cash drawer</p>
              </div>
            </div>
          )}
        </div>
        <div className="eod-toolbar-right">
          <button className="eod-btn eod-btn-secondary" onClick={loadReport} disabled={loading} title="Refresh report">
            <RefreshCw size={14} className={loading ? 'eod-spin' : ''} /> Refresh
          </button>
          <button className="eod-btn eod-btn-ghost" onClick={handleCSV} disabled={!report} title="Export CSV">
            <Download size={14} /> CSV
          </button>
          <button className="eod-btn eod-btn-ghost" onClick={handlePDF} disabled={!report} title="Export PDF">
            <Download size={14} /> PDF
          </button>
          <button className="eod-btn eod-btn-primary" onClick={handlePrint} disabled={!report} title="Print">
            <Printer size={14} /> Print
          </button>
        </div>
      </div>

      {/* ── Filter bar ── */}
      <div className="eod-filters" data-no-print>
        <div className="eod-filter-group">
          <label className="eod-filter-label">Store</label>
          <select className="eod-input" value={storeId} onChange={e => setStoreId(e.target.value)}>
            <option value="">— Select store —</option>
            {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="eod-filter-group">
          <label className="eod-filter-label">Cashier</label>
          <select className="eod-input" value={cashierId} onChange={e => setCashierId(e.target.value)}>
            <option value="">— All cashiers —</option>
            {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>
        <div className="eod-filter-group">
          <label className="eod-filter-label">
            <input type="checkbox" checked={useRange} onChange={e => setUseRange(e.target.checked)} /> Date range
          </label>
          {useRange ? (
            <div className="eod-date-range">
              <input type="date" className="eod-input" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
              <span>→</span>
              <input type="date" className="eod-input" value={dateTo} onChange={e => setDateTo(e.target.value)} />
            </div>
          ) : (
            <input type="date" className="eod-input" value={date} onChange={e => setDate(e.target.value)} />
          )}
        </div>
        <button className="eod-btn eod-btn-primary" onClick={loadReport} disabled={loading}>
          {loading ? 'Loading…' : 'Generate Report'}
        </button>
      </div>

      {/* ── Report body (printable) ── */}
      {report ? (
        <div className="eod-report-body">
          {/* Header */}
          <div className="eod-report-header">
            <h2 className="eod-report-title">END OF DAY REPORT</h2>
            <div className="eod-header-grid">
              <div className="eod-header-row"><span className="eod-header-label">Store:</span> <span>{header.storeName || 'N/A'}</span></div>
              {header.stationName && <div className="eod-header-row"><span className="eod-header-label">Register:</span> <Monitor size={12} /> <span>{header.stationName}</span></div>}
              {header.cashierName && <div className="eod-header-row"><span className="eod-header-label">Cashier:</span> <User size={12} /> <span>{header.cashierName}</span></div>}
              <div className="eod-header-row">
                <span className="eod-header-label">Period:</span>
                <Calendar size={12} />
                <span>
                  {new Date(header.from).toLocaleString()} — {new Date(header.to).toLocaleString()}
                </span>
              </div>
              <div className="eod-header-row eod-header-row-small">
                <span className="eod-header-label">Printed:</span>
                <span>{new Date(header.printedAt).toLocaleString()}</span>
              </div>
            </div>
          </div>

          {/* Section 1: Payouts */}
          <EoDSection
            title="PAYOUTS"
            rows={report.payouts}
            totalLabel="Payouts Total"
            total={grandTotals.payoutsTotal}
          />

          {/* Section 2: Tenders */}
          <EoDSection
            title="TENDER DETAILS"
            rows={report.tenders}
            totalLabel="Tenders Total"
            total={grandTotals.tenderTotal}
          />

          {/* Section 3: Transactions */}
          <EoDSection
            title="TRANSACTIONS"
            rows={report.transactions}
            totalLabel={null}
          />

          {/* Section 3b: Pass-through fees — bag fees + bottle deposits.
              These are already in Gross Sales above; this section is purely
              an accounting breakdown so the retailer can see what they
              collected on behalf of the state vs charged for bags. */}
          {report.fees && report.fees.some(f => Math.abs(f.amount) > 0.001) && (
            <div className="eod-section">
              <h3 className="eod-section-title">PASS-THROUGH FEES</h3>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                Not revenue or profit — shown separately for reconciliation.
              </div>
              <table className="eod-table">
                <thead>
                  <tr><th>Type</th><th className="eod-num">Count</th><th className="eod-num">Amount</th></tr>
                </thead>
                <tbody>
                  {report.fees.filter(f => Math.abs(f.amount) > 0.001 || f.count > 0).map(f => (
                    <tr key={f.key}>
                      <td>{f.label}</td>
                      <td className="eod-num">{f.count}</td>
                      <td className="eod-num">{fmt$(f.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Section 4: Fuel (only when fuel sales exist) */}
          {report.fuel && (report.fuel.rows?.length > 0) && (
            <div className="eod-section">
              <h3 className="eod-section-title">FUEL SALES</h3>
              <table className="eod-table eod-fuel-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th className="eod-num">Sales Gal</th>
                    <th className="eod-num">Sales $</th>
                    <th className="eod-num">Refund Gal</th>
                    <th className="eod-num">Refund $</th>
                    <th className="eod-num">Net Gal</th>
                    <th className="eod-num">Net $</th>
                  </tr>
                </thead>
                <tbody>
                  {report.fuel.rows.map((r) => (
                    <tr key={r.fuelTypeId || r.name}>
                      <td>{r.name}{r.gradeLabel ? ` · ${r.gradeLabel}` : ''}</td>
                      <td className="eod-num">{Number(r.salesGallons).toFixed(3)}</td>
                      <td className="eod-num">{fmt$(r.salesAmount)}</td>
                      <td className="eod-num">{Number(r.refundGallons).toFixed(3)}</td>
                      <td className="eod-num">{fmt$(r.refundAmount)}</td>
                      <td className="eod-num"><strong>{Number(r.netGallons).toFixed(3)}</strong></td>
                      <td className="eod-num"><strong>{fmt$(r.netAmount)}</strong></td>
                    </tr>
                  ))}
                  <tr className="eod-row-strong">
                    <td>Total</td>
                    <td className="eod-num">{Number(report.fuel.totals.salesGallons).toFixed(3)}</td>
                    <td className="eod-num">{fmt$(report.fuel.totals.salesAmount)}</td>
                    <td className="eod-num">{Number(report.fuel.totals.refundGallons).toFixed(3)}</td>
                    <td className="eod-num">{fmt$(report.fuel.totals.refundAmount)}</td>
                    <td className="eod-num">{Number(report.fuel.totals.gallons).toFixed(3)}</td>
                    <td className="eod-num">{fmt$(report.fuel.totals.amount)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* Section 5: Dual Pricing (only when store ran dual_pricing during the window) */}
          {report.dualPricing && (
            <div className="eod-section">
              <h3 className="eod-section-title">DUAL PRICING SUMMARY</h3>
              <table className="eod-table">
                <tbody>
                  <tr>
                    <td>Card Transactions (Surcharge Applied)</td>
                    <td className="eod-num">{report.dualPricing.surchargedTxCount}</td>
                  </tr>
                  <tr>
                    <td>Cash / EBT Transactions (No Surcharge)</td>
                    <td className="eod-num">{report.dualPricing.cashTxOnDualCount}</td>
                  </tr>
                  <tr>
                    <td>Surcharge Collected</td>
                    <td className="eod-num">{fmt$(report.dualPricing.surchargeCollected)}</td>
                  </tr>
                  {report.dualPricing.surchargeTaxCollected > 0.005 && (
                    <tr>
                      <td>Tax on Surcharge</td>
                      <td className="eod-num">{fmt$(report.dualPricing.surchargeTaxCollected)}</td>
                    </tr>
                  )}
                  <tr className="eod-row-strong">
                    <td>Total Surcharge Revenue</td>
                    <td className="eod-num">{fmt$(report.dualPricing.surchargeTotal)}</td>
                  </tr>
                  {report.dualPricing.surchargedTxCount > 0 && (
                    <tr>
                      <td>Avg Surcharge / Card Tx</td>
                      <td className="eod-num">{fmt$(report.dualPricing.avgSurchargePerCardTx)}</td>
                    </tr>
                  )}
                  {report.dualPricing.cashSavingsTotal > 0.005 && (
                    <tr>
                      <td>Customer Savings (Cash Tenders)</td>
                      <td className="eod-num" style={{ color: 'var(--success, #16a34a)' }}>
                        {fmt$(report.dualPricing.cashSavingsTotal)}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Reconciliation (shift mode only) */}
          {report.reconciliation && (
            <div className="eod-section">
              <h3 className="eod-section-title">CASH DRAWER RECONCILIATION</h3>
              <table className="eod-table">
                <tbody>
                  <tr><td>Opening Amount</td><td className="eod-num">{fmt$(report.reconciliation.openingAmount)}</td></tr>
                  <tr><td>+ Cash Collected</td><td className="eod-num">{fmt$(report.reconciliation.cashCollected)}</td></tr>
                  {report.reconciliation.cashIn != null && report.reconciliation.cashIn > 0 && (
                    <tr><td>+ Cash In (Paid-in / Received on Acct)</td><td className="eod-num">{fmt$(report.reconciliation.cashIn)}</td></tr>
                  )}
                  <tr><td>− Cash Drops (Pickups)</td><td className="eod-num">{fmt$(report.reconciliation.cashDropsTotal)}</td></tr>
                  <tr><td>− Cash Out (Paid-out / Loans)</td><td className="eod-num">{fmt$(report.reconciliation.cashOut ?? report.reconciliation.cashPayoutsTotal)}</td></tr>
                  <tr className="eod-row-strong"><td>= Expected in Drawer</td><td className="eod-num">{fmt$(report.reconciliation.expectedInDrawer)}</td></tr>
                  {report.reconciliation.closingAmount != null && (
                    <>
                      <tr><td>Closing (Counted)</td><td className="eod-num">{fmt$(report.reconciliation.closingAmount)}</td></tr>
                      <tr className={`eod-row-strong ${Math.abs(report.reconciliation.variance) > 0.01 ? (report.reconciliation.variance < 0 ? 'eod-row-warn' : 'eod-row-ok') : ''}`}>
                        <td>Variance</td><td className="eod-num">{fmt$(report.reconciliation.variance)}</td>
                      </tr>
                    </>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Footer */}
          <div className="eod-footer">
            <span>StoreVeu POS · End of Day Report</span>
            <span>Printed: {new Date(header.printedAt).toLocaleString()}</span>
          </div>
        </div>
      ) : (
        <div className="eod-empty">
          {loading ? 'Loading…' : 'Pick filters and click "Generate Report".'}
        </div>
      )}
    </div>
  );
}

// ─── Generic section component ──────────────────────────────────────────────
function EoDSection({ title, rows, totalLabel, total }) {
  return (
    <div className="eod-section">
      <h3 className="eod-section-title">{title}</h3>
      <table className="eod-table">
        <thead>
          <tr>
            <th className="eod-th">Type</th>
            <th className="eod-th eod-th-num">Count</th>
            <th className="eod-th eod-th-num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.key}>
              <td>{r.label}</td>
              <td className="eod-num">{r.count}</td>
              <td className="eod-num">{fmt$(r.amount)}</td>
            </tr>
          ))}
          {totalLabel && (
            <tr className="eod-row-strong">
              <td>{totalLabel}</td>
              <td className="eod-num">N/A</td>
              <td className="eod-num">{fmt$(total)}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
