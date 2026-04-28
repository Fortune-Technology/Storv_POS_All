/**
 * AdminSaasMargin.tsx — Session 52.
 *
 * Per-org SaaS margin report from dual pricing. Cross-checks surcharge
 * collected against estimated Dejavoo processor cost to surface the spread
 * Storeveu earns. Superadmin-only.
 *
 * Note: processor cost is currently an estimate (default Dejavoo retail
 * rate, overridable via env). When PaymentTransaction starts capturing
 * the actual settlement cost, switch to real numbers — the math here
 * stays identical.
 */

import { useEffect, useMemo, useState } from 'react';
import { Percent, RefreshCw, TrendingUp, AlertTriangle, Info } from 'lucide-react';
import { toast } from 'react-toastify';
import api from '../services/api';
import './AdminPaymentModels.css';

interface OrgRow {
  orgId:                 string;
  orgName:               string;
  cardVolume:            number;
  txCount:               number;
  surchargeCollected:    number;
  surchargeTaxCollected: number;
  processorCost:         number;
  spread:                number;
  sharePct:              number;
  storeveuShare:         number;
  merchantNet:           number;
}

interface MarginReport {
  from: string;
  to:   string;
  assumptions: {
    processorPct: number;
    processorFee: number;
    defaultStoreveuShare: number;
    notice: string;
  };
  summary: {
    cardVolume:         number;
    txCount:            number;
    surchargeCollected: number;
    processorCost:      number;
    spread:             number;
    storeveuShare:      number;
    merchantNet:        number;
  };
  rows: OrgRow[];
}

const toLocalDateStr = (d = new Date()): string => {
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
};
const startOfMonth = (): string => {
  const d = new Date();
  return toLocalDateStr(new Date(d.getFullYear(), d.getMonth(), 1));
};
const fmt$ = (n: number): string => `$${(n || 0).toFixed(2)}`;

export default function AdminSaasMargin() {
  const [from,    setFrom]    = useState(startOfMonth());
  const [to,      setTo]      = useState(toLocalDateStr());
  const [report,  setReport]  = useState<MarginReport | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/admin/saas-margin', { params: { from, to } });
      setReport(res.data as MarginReport);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to load SaaS margin report');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const totals = report?.summary;
  const margin = useMemo(() => {
    if (!totals || totals.surchargeCollected === 0) return 0;
    return (totals.spread / totals.surchargeCollected) * 100;
  }, [totals]);

  return (
    <div className="admin-page apm-page">
      <div className="admin-header">
        <div className="admin-header-left">
          <div className="admin-header-icon"><TrendingUp size={22} /></div>
          <div>
            <h1>SaaS Margin Report</h1>
            <p>Per-org dual-pricing revenue share. Spread = surcharge collected − processor cost (estimate).</p>
          </div>
        </div>
        <div className="admin-header-actions">
          <button className="admin-btn-secondary" onClick={load} disabled={loading}>
            <RefreshCw size={13} className={loading ? 'apm-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {/* Date filter */}
      <div className="apm-info-strip" style={{ marginBottom: 18 }}>
        <Info size={14} />
        <div>
          <strong>Estimate.</strong> Processor cost is calculated at <strong>{report?.assumptions.processorPct ?? '2.6'}% + ${(report?.assumptions.processorFee ?? 0.10).toFixed(2)}</strong> per card transaction (default Dejavoo retail rate). Override per-org via <code>Organization.settings.storeveuMarginShare</code>.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', marginBottom: 18 }}>
        <div>
          <label className="apm-label">From</label>
          <input className="apm-input" type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} />
        </div>
        <div>
          <label className="apm-label">To</label>
          <input className="apm-input" type="date" value={to} min={from} onChange={e => setTo(e.target.value)} />
        </div>
        <button className="admin-btn-primary" onClick={load} disabled={loading} style={{ marginBottom: 0 }}>
          Update
        </button>
      </div>

      {loading && !report && (
        <div className="apm-loading"><RefreshCw size={16} className="apm-spin" /> Loading…</div>
      )}

      {report && (
        <>
          {/* KPI grid */}
          <div className="apm-stats" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <div className="apm-stat">
              <span className="apm-stat-num">{fmt$(totals!.surchargeCollected)}</span>
              <span className="apm-stat-lbl">Surcharge Collected</span>
            </div>
            <div className="apm-stat">
              <span className="apm-stat-num">{fmt$(totals!.processorCost)}</span>
              <span className="apm-stat-lbl">Processor Cost (est.)</span>
            </div>
            <div className="apm-stat apm-stat--accent">
              <span className="apm-stat-num">{fmt$(totals!.spread)}</span>
              <span className="apm-stat-lbl">Spread ({margin.toFixed(1)}%)</span>
            </div>
            <div className="apm-stat apm-stat--accent">
              <span className="apm-stat-num">{fmt$(totals!.storeveuShare)}</span>
              <span className="apm-stat-lbl">Storeveu Share</span>
            </div>
          </div>

          {/* Per-org table */}
          {report.rows.length === 0 ? (
            <div className="apm-empty">
              <Percent size={32} className="apm-empty-icon" />
              <p>No dual-pricing transactions in this date range.</p>
            </div>
          ) : (
            <div className="admin-table-wrap" style={{ marginTop: 14 }}>
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Organization</th>
                    <th style={{ textAlign: 'right' }}>Card Volume</th>
                    <th style={{ textAlign: 'right' }}>Tx Count</th>
                    <th style={{ textAlign: 'right' }}>Surcharge</th>
                    <th style={{ textAlign: 'right' }}>Processor Cost</th>
                    <th style={{ textAlign: 'right' }}>Spread</th>
                    <th style={{ textAlign: 'right' }}>Share %</th>
                    <th style={{ textAlign: 'right' }}>Storeveu Earn</th>
                    <th style={{ textAlign: 'right' }}>Merchant Net</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map(r => (
                    <tr key={r.orgId}>
                      <td>{r.orgName}</td>
                      <td style={{ textAlign: 'right' }}>{fmt$(r.cardVolume)}</td>
                      <td style={{ textAlign: 'right' }}>{r.txCount}</td>
                      <td style={{ textAlign: 'right' }}>{fmt$(r.surchargeCollected)}</td>
                      <td style={{ textAlign: 'right' }}>{fmt$(r.processorCost)}</td>
                      <td style={{ textAlign: 'right' }}><strong>{fmt$(r.spread)}</strong></td>
                      <td style={{ textAlign: 'right' }}>{r.sharePct.toFixed(0)}%</td>
                      <td style={{ textAlign: 'right' }}><strong style={{ color: 'var(--success, #16a34a)' }}>{fmt$(r.storeveuShare)}</strong></td>
                      <td style={{ textAlign: 'right' }}>{fmt$(r.merchantNet)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {totals!.spread < 0 && (
            <div className="apm-warn-strip" style={{ marginTop: 14 }}>
              <AlertTriangle size={14} />
              <div>
                Spread is negative — surcharge revenue is lower than estimated processor cost.
                Either the surcharge tier is set too low, or the processor cost assumption needs to be re-verified.
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
