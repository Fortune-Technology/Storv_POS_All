/**
 * PeriodCompare — side-by-side metric comparison for two arbitrary date ranges.
 *
 * Extracted from the legacy ReportsHub→Compare tab (Session 64). Mounted as
 * a 5th tab in AnalyticsHub. `embedded` prop strips the page wrapper so the
 * parent hub owns the page chrome.
 */
import React, { useState } from 'react';
import {
  Download, FileText, RefreshCw, Loader,
  ArrowUpRight, ArrowDownRight, Minus, BarChart2,
} from 'lucide-react';
import { toast } from 'react-toastify';
import { getReportCompare } from '../../services/api';
import { downloadCSV, downloadPDF } from '../../utils/exportUtils';
import '../../styles/portal.css';
import './reports-shared.css';

const txt = (v) => {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'object') return v.name || v.label || v.code || v.id || '';
  return String(v);
};

const toDateStr  = (d) => d.toISOString().slice(0, 10);
const todayStr   = () => toDateStr(new Date());
const daysAgoStr = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return toDateStr(d); };

export default function PeriodCompare({ embedded = false }) {
  // Default windows: this week (period 1) vs prior week (period 2)
  const [from1, setFrom1] = useState(daysAgoStr(7));
  const [to1,   setTo1]   = useState(todayStr());
  const [from2, setFrom2] = useState(daysAgoStr(14));
  const [to2,   setTo2]   = useState(daysAgoStr(8));

  const [cmpData, setCmpData] = useState(null);
  const [loading, setLoading] = useState(false);

  const fetchCompare = async () => {
    try {
      setLoading(true);
      const data = await getReportCompare({ from1, to1, from2, to2 });
      setCmpData(data);
    } catch (err) {
      toast.error(`Failed to load comparison: ${err.response?.data?.error || err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const changeArrow = (val) => {
    if (val == null) return <span className="rh-change-flat"><Minus size={14} /> --</span>;
    const n = Number(val);
    if (n > 0) return <span className="rh-change-up"><ArrowUpRight size={14} /> +{n.toFixed(1)}%</span>;
    if (n < 0) return <span className="rh-change-down"><ArrowDownRight size={14} /> {n.toFixed(1)}%</span>;
    return <span className="rh-change-flat"><Minus size={14} /> 0.0%</span>;
  };

  const Body = (
    <>
      <div className="rh-compare-periods">
        <div className="rh-period-box">
          <div className="rh-period-label">Period 1</div>
          <div className="rh-period-dates">
            <input type="date" className="p-input" value={from1} onChange={e => setFrom1(e.target.value)} />
            <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>to</span>
            <input type="date" className="p-input" value={to1} onChange={e => setTo1(e.target.value)} />
          </div>
        </div>
        <div className="rh-period-box">
          <div className="rh-period-label">Period 2</div>
          <div className="rh-period-dates">
            <input type="date" className="p-input" value={from2} onChange={e => setFrom2(e.target.value)} />
            <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>to</span>
            <input type="date" className="p-input" value={to2} onChange={e => setTo2(e.target.value)} />
          </div>
        </div>
      </div>

      <div style={{ marginBottom: '1rem' }}>
        <button className="p-btn p-btn-primary p-btn-sm" onClick={() => { setCmpData(null); fetchCompare(); }} disabled={loading}>
          {loading ? <><Loader size={14} className="p-spin" /> Comparing…</> : <><RefreshCw size={14} /> Compare</>}
        </button>
      </div>

      {!cmpData ? (
        <div className="p-empty">Select two periods and click Compare to see results.</div>
      ) : (
        <>
          <div className="p-table-wrap">
            <table className="p-table">
              <thead>
                <tr>
                  <th>Metric</th><th>Period 1</th><th>Period 2</th><th>Change %</th>
                </tr>
              </thead>
              <tbody>
                {(cmpData.metrics || []).map((m, i) => (
                  <tr key={i}>
                    <td className="p-td-strong">{txt(m.metric)}</td>
                    <td>{txt(m.period1)}</td>
                    <td>{txt(m.period2)}</td>
                    <td>{changeArrow(m.changePct)}</td>
                  </tr>
                ))}
                {!(cmpData.metrics || []).length && (
                  <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No comparison data</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="rh-export-row" style={{ marginTop: '1rem' }}>
            <button className="p-btn p-btn-ghost p-btn-sm" onClick={() => downloadCSV(
              cmpData.metrics || [],
              [{ key: 'metric', label: 'Metric' }, { key: 'period1', label: 'Period 1' }, { key: 'period2', label: 'Period 2' }, { key: 'changePct', label: 'Change %' }],
              'period-compare'
            )}>
              <Download size={14} /> CSV
            </button>
            <button className="p-btn p-btn-ghost p-btn-sm" onClick={() => downloadPDF({
              title: 'Period Comparison',
              subtitle: `Period 1: ${from1} - ${to1}  |  Period 2: ${from2} - ${to2}`,
              data: cmpData.metrics || [],
              columns: [{ key: 'metric', label: 'Metric' }, { key: 'period1', label: 'Period 1' }, { key: 'period2', label: 'Period 2' }, { key: 'changePct', label: 'Change %' }],
              filename: 'period-compare',
            })}>
              <FileText size={14} /> PDF
            </button>
          </div>
        </>
      )}
    </>
  );

  if (embedded) return Body;

  return (
    <div className="p-page">
      <div className="p-header">
        <div className="p-header-left">
          <div className="p-header-icon"><BarChart2 size={22} /></div>
          <div>
            <h1 className="p-title">Period Compare</h1>
            <p className="p-subtitle">Side-by-side metric comparison for two arbitrary date ranges</p>
          </div>
        </div>
      </div>
      {Body}
    </div>
  );
}
