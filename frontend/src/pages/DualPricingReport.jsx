/**
 * DualPricingReport.jsx — Session 52.
 *
 * Per-store report of surcharge revenue + customer cash savings over a
 * date range. Powered by GET /api/sales/dual-pricing-report. Renders:
 *
 *   - Date range picker + store selector
 *   - 6 KPI cards (surcharge revenue, tax, surcharged tx count, cash tx count,
 *     avg surcharge per card tx, customer savings)
 *   - Daily breakdown table with sortable columns
 *   - Top stores rollup (org-wide scope only)
 *   - CSV + PDF export
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Percent, RefreshCw, Download, FileText, AlertTriangle, ShieldCheck, X } from 'lucide-react';
import api from '../services/api.js';
import { getStores } from '../services/api.js';
import { downloadCSV, downloadPDF } from '../utils/exportUtils.js';
import { fmt$ } from '../utils/formatters.js';
import './DualPricingReport.css';

const toLocalDateStr = (d = new Date()) => {
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
};
const addDays = (str, n) => {
  const d = new Date(str + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return toLocalDateStr(d);
};

export default function DualPricingReport() {
  const [stores,    setStores]    = useState([]);
  const [storeId,   setStoreId]   = useState('');
  const [from,      setFrom]      = useState(addDays(toLocalDateStr(), -7));
  const [to,        setTo]        = useState(toLocalDateStr());
  const [report,    setReport]    = useState(null);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState(null);
  // Session 52 — Settlement reconciliation modal
  const [reconcile,    setReconcile]    = useState(null);   // { totalChecked, summary, discrepancies }
  const [reconcileBusy, setReconcileBusy] = useState(false);

  // Load stores once
  useEffect(() => {
    getStores().then(s => setStores(s.stores || s || [])).catch(() => {});
  }, []);

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/sales/dual-pricing-report', {
        params: { from, to, ...(storeId ? { storeId } : {}) },
      });
      setReport(res.data);
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to load report');
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [from, to, storeId]);

  useEffect(() => { loadReport(); }, [loadReport]);

  const runReconciliation = async () => {
    setReconcileBusy(true);
    try {
      const res = await api.get('/sales/dual-pricing-reconcile', {
        params: { from, to, ...(storeId ? { storeId } : {}) },
      });
      setReconcile(res.data);
    } catch (err) {
      setError(err?.response?.data?.error || 'Reconciliation failed');
    } finally {
      setReconcileBusy(false);
    }
  };

  const totals = report?.summary;

  const handleCSV = () => {
    if (!report) return;
    const rows = [];
    rows.push({ Section: 'SUMMARY', Field: 'Card Tx Surcharged',     Value: totals.surchargedTxCount });
    rows.push({ Section: '',         Field: 'Cash/EBT (No Surcharge)', Value: totals.cashTxOnDualCount });
    rows.push({ Section: '',         Field: 'Surcharge Collected',    Value: `$${totals.surchargeCollected.toFixed(2)}` });
    rows.push({ Section: '',         Field: 'Tax on Surcharge',        Value: `$${totals.surchargeTaxCollected.toFixed(2)}` });
    rows.push({ Section: '',         Field: 'Total Surcharge Revenue', Value: `$${totals.surchargeTotal.toFixed(2)}` });
    rows.push({ Section: '',         Field: 'Avg Surcharge / Card Tx', Value: `$${totals.avgSurchargePerCardTx.toFixed(2)}` });
    rows.push({ Section: '',         Field: 'Customer Savings (Cash)', Value: `$${totals.cashSavingsTotal.toFixed(2)}` });
    rows.push({ Section: '',         Field: '',                         Value: '' });
    rows.push({ Section: 'DAILY BREAKDOWN', Field: 'Date', Value: 'Surcharge / Tax / Card Tx / Cash Tx / Savings' });
    (report.days || []).forEach(d => {
      rows.push({
        Section: '',
        Field: d.date,
        Value: `$${d.surchargeCollected.toFixed(2)} / $${d.surchargeTaxCollected.toFixed(2)} / ${d.surchargedTxCount} / ${d.cashTxOnDualCount} / $${d.cashSavingsTotal.toFixed(2)}`,
      });
    });
    if (report.topStores?.length) {
      rows.push({ Section: '', Field: '', Value: '' });
      rows.push({ Section: 'TOP STORES', Field: 'Store', Value: 'Surcharge Collected' });
      report.topStores.forEach(s => {
        rows.push({ Section: '', Field: s.storeName, Value: `$${s.surchargeCollected.toFixed(2)} (${s.txCount} card tx)` });
      });
    }
    downloadCSV(rows, [
      { key: 'Section', label: 'Section' },
      { key: 'Field',   label: 'Field'   },
      { key: 'Value',   label: 'Value'   },
    ], `dual-pricing-${from}_to_${to}.csv`);
  };

  const handlePDF = () => {
    if (!report) return;
    const rows = (report.days || []).map(d => ({
      Date:       d.date,
      Surcharge:  `$${d.surchargeCollected.toFixed(2)}`,
      Tax:        `$${d.surchargeTaxCollected.toFixed(2)}`,
      'Card Tx':  d.surchargedTxCount,
      'Cash Tx':  d.cashTxOnDualCount,
      Savings:    `$${d.cashSavingsTotal.toFixed(2)}`,
    }));
    const storeName = stores.find(s => s.id === storeId)?.name || 'All Stores';
    downloadPDF({
      title:    'Dual Pricing Report',
      subtitle: `${storeName}  ${from} → ${to}`,
      summary: [
        { label: 'Surcharge Collected', value: `$${totals.surchargeCollected.toFixed(2)}` },
        { label: 'Total Revenue',       value: `$${totals.surchargeTotal.toFixed(2)}` },
        { label: 'Card Tx',              value: `${totals.surchargedTxCount}` },
        { label: 'Customer Savings',     value: `$${totals.cashSavingsTotal.toFixed(2)}` },
      ],
      data: rows,
      columns: [
        { key: 'Date',      label: 'Date' },
        { key: 'Surcharge', label: 'Surcharge' },
        { key: 'Tax',       label: 'Tax' },
        { key: 'Card Tx',   label: 'Card Tx' },
        { key: 'Cash Tx',   label: 'Cash Tx' },
        { key: 'Savings',   label: 'Savings' },
      ],
      filename: `dual-pricing-${from}_to_${to}.pdf`,
    });
  };

  return (
    <div className="dpr-page">
      <div className="dpr-header">
        <div className="dpr-header-left">
          <div className="dpr-header-icon"><Percent size={20} /></div>
          <div>
            <h1>Dual Pricing Report</h1>
            <p>Surcharge revenue + customer cash savings by date range</p>
          </div>
        </div>
        <div className="dpr-header-actions">
          <button className="dpr-btn dpr-btn-secondary" onClick={loadReport} disabled={loading}>
            <RefreshCw size={13} className={loading ? 'dpr-spin' : ''} /> Refresh
          </button>
          <button className="dpr-btn dpr-btn-secondary" onClick={runReconciliation} disabled={reconcileBusy || loading} title="Cross-check our surcharge totals against the payment processor (Dejavoo)">
            <ShieldCheck size={13} className={reconcileBusy ? 'dpr-spin' : ''} /> Reconcile
          </button>
          <button className="dpr-btn dpr-btn-secondary" onClick={handleCSV} disabled={!report || loading}>
            <Download size={13} /> CSV
          </button>
          <button className="dpr-btn dpr-btn-primary" onClick={handlePDF} disabled={!report || loading}>
            <FileText size={13} /> PDF
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="dpr-filter-bar">
        <div className="dpr-field">
          <label>Store</label>
          <select value={storeId} onChange={e => setStoreId(e.target.value)}>
            <option value="">All stores (org-wide)</option>
            {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="dpr-field">
          <label>From</label>
          <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} />
        </div>
        <div className="dpr-field">
          <label>To</label>
          <input type="date" value={to} min={from} onChange={e => setTo(e.target.value)} />
        </div>
        <div className="dpr-quick-ranges">
          <button onClick={() => { const d = toLocalDateStr(); setFrom(d); setTo(d); }}>Today</button>
          <button onClick={() => { setFrom(addDays(toLocalDateStr(), -6)); setTo(toLocalDateStr()); }}>Last 7d</button>
          <button onClick={() => { setFrom(addDays(toLocalDateStr(), -29)); setTo(toLocalDateStr()); }}>Last 30d</button>
          <button onClick={() => {
            const today = new Date();
            setFrom(toLocalDateStr(new Date(today.getFullYear(), today.getMonth(), 1)));
            setTo(toLocalDateStr());
          }}>This Month</button>
        </div>
      </div>

      {error && (
        <div className="dpr-error">
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      {loading && !report && (
        <div className="dpr-loading"><RefreshCw size={16} className="dpr-spin" /> Loading…</div>
      )}

      {report && (
        <>
          {/* KPI cards */}
          <div className="dpr-kpi-grid">
            <KpiCard label="Surcharge Collected"     value={fmt$(totals.surchargeCollected)} accent="brand" />
            <KpiCard label="Tax on Surcharge"        value={fmt$(totals.surchargeTaxCollected)} />
            <KpiCard label="Total Revenue"           value={fmt$(totals.surchargeTotal)} accent="success" big />
            <KpiCard label="Card Transactions"       value={String(totals.surchargedTxCount)} />
            <KpiCard label="Cash / EBT Transactions" value={String(totals.cashTxOnDualCount)} />
            <KpiCard label="Avg / Card Tx"           value={fmt$(totals.avgSurchargePerCardTx)} />
            <KpiCard label="Customer Savings (Cash)" value={fmt$(totals.cashSavingsTotal)} accent="info" />
            <KpiCard
              label="Cash Tender Share"
              value={`${(totals.cashShare * 100).toFixed(1)}%`}
              hint={
                totals.cashShare > 0.5
                  ? 'Most customers pay cash to avoid surcharge'
                  : totals.cashShare > 0.25
                  ? 'Healthy cash mix'
                  : 'Card-heavy mix — surcharge is generating significant revenue'
              }
            />
          </div>

          {/* Daily table */}
          <div className="dpr-section">
            <h3>Daily Breakdown</h3>
            {report.days.length === 0 ? (
              <div className="dpr-empty">No dual pricing transactions in this range.</div>
            ) : (
              <table className="dpr-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th className="dpr-num">Surcharge</th>
                    <th className="dpr-num">Tax</th>
                    <th className="dpr-num">Total</th>
                    <th className="dpr-num">Card Tx</th>
                    <th className="dpr-num">Cash Tx</th>
                    <th className="dpr-num">Customer Savings</th>
                  </tr>
                </thead>
                <tbody>
                  {report.days.map(d => (
                    <tr key={d.date}>
                      <td>{d.date}</td>
                      <td className="dpr-num">{fmt$(d.surchargeCollected)}</td>
                      <td className="dpr-num">{fmt$(d.surchargeTaxCollected)}</td>
                      <td className="dpr-num"><strong>{fmt$(d.surchargeCollected + d.surchargeTaxCollected)}</strong></td>
                      <td className="dpr-num">{d.surchargedTxCount}</td>
                      <td className="dpr-num">{d.cashTxOnDualCount}</td>
                      <td className="dpr-num">{fmt$(d.cashSavingsTotal)}</td>
                    </tr>
                  ))}
                  <tr className="dpr-row-strong">
                    <td>Total</td>
                    <td className="dpr-num">{fmt$(totals.surchargeCollected)}</td>
                    <td className="dpr-num">{fmt$(totals.surchargeTaxCollected)}</td>
                    <td className="dpr-num"><strong>{fmt$(totals.surchargeTotal)}</strong></td>
                    <td className="dpr-num">{totals.surchargedTxCount}</td>
                    <td className="dpr-num">{totals.cashTxOnDualCount}</td>
                    <td className="dpr-num">{fmt$(totals.cashSavingsTotal)}</td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>

          {/* Top stores (org-wide scope only) */}
          {!storeId && report.topStores.length > 0 && (
            <div className="dpr-section">
              <h3>By Store</h3>
              <table className="dpr-table">
                <thead>
                  <tr>
                    <th>Store</th>
                    <th>Tier</th>
                    <th className="dpr-num">Surcharge Collected</th>
                    <th className="dpr-num">Card Tx Count</th>
                    <th className="dpr-num">Avg / Tx</th>
                  </tr>
                </thead>
                <tbody>
                  {report.topStores.map(s => (
                    <tr key={s.storeId}>
                      <td>{s.storeName}</td>
                      <td>{s.tierName || '—'}</td>
                      <td className="dpr-num"><strong>{fmt$(s.surchargeCollected)}</strong></td>
                      <td className="dpr-num">{s.txCount}</td>
                      <td className="dpr-num">{fmt$(s.txCount > 0 ? s.surchargeCollected / s.txCount : 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Session 52 — Reconciliation modal */}
      {reconcile && (
        <div className="dpr-modal-backdrop" onClick={() => setReconcile(null)}>
          <div className="dpr-modal" onClick={e => e.stopPropagation()}>
            <div className="dpr-modal-head">
              <div>
                <h2>Settlement Reconciliation</h2>
                <p className="dpr-muted">{from} → {to}</p>
              </div>
              <button className="dpr-btn-icon" onClick={() => setReconcile(null)}><X size={14} /></button>
            </div>
            <div className="dpr-modal-body">
              <div className="dpr-recon-stats">
                <div className="dpr-recon-stat dpr-recon-stat--ok">
                  <div className="dpr-recon-num">{reconcile.summary.clean}</div>
                  <div className="dpr-recon-lbl">Clean Match</div>
                </div>
                <div className="dpr-recon-stat dpr-recon-stat--warn">
                  <div className="dpr-recon-num">{reconcile.summary.drift}</div>
                  <div className="dpr-recon-lbl">Amount Drift</div>
                </div>
                <div className="dpr-recon-stat dpr-recon-stat--err">
                  <div className="dpr-recon-num">{reconcile.summary.missing}</div>
                  <div className="dpr-recon-lbl">Missing Processor</div>
                </div>
                <div className="dpr-recon-stat">
                  <div className="dpr-recon-num">{reconcile.totalChecked}</div>
                  <div className="dpr-recon-lbl">Total Checked</div>
                </div>
              </div>

              {reconcile.discrepancies.length === 0 ? (
                <div className="dpr-recon-clean">
                  <ShieldCheck size={20} /> All transactions reconcile cleanly within
                  ${reconcile.thresholdUsed.toFixed(2)} threshold.
                </div>
              ) : (
                <table className="dpr-table">
                  <thead>
                    <tr>
                      <th>TXN #</th>
                      <th>Date</th>
                      <th>Issue</th>
                      <th className="dpr-num">Our Total</th>
                      <th className="dpr-num">Processor</th>
                      <th className="dpr-num">Drift</th>
                      <th>Auth</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reconcile.discrepancies.map(d => (
                      <tr key={d.txId} className={d.issue === 'missing_payment_row' ? 'dpr-recon-row--err' : 'dpr-recon-row--warn'}>
                        <td>{d.txNumber}</td>
                        <td>{new Date(d.createdAt).toLocaleString()}</td>
                        <td>{d.issue === 'missing_payment_row' ? 'No processor record' : 'Amount drift'}</td>
                        <td className="dpr-num">{fmt$(d.ourGrandTotal)}</td>
                        <td className="dpr-num">{d.processorAmount != null ? fmt$(d.processorAmount) : '—'}</td>
                        <td className="dpr-num">{d.drift != null ? fmt$(d.drift) : '—'}</td>
                        <td>{d.authCode || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────
function KpiCard({ label, value, accent, big, hint }) {
  return (
    <div className={`dpr-kpi-card ${accent ? `dpr-kpi-card--${accent}` : ''} ${big ? 'dpr-kpi-card--big' : ''}`}>
      <div className="dpr-kpi-label">{label}</div>
      <div className="dpr-kpi-value">{value}</div>
      {hint && <div className="dpr-kpi-hint">{hint}</div>}
    </div>
  );
}
