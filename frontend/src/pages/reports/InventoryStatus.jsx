/**
 * InventoryStatus — current stock levels with reorder analysis.
 *
 * Extracted from the legacy ReportsHub→Inventory tab (Session 64). Shows
 * on-hand / on-order / sold-30d / avgDaily / daysSupply per product with
 * status badges (Out / Low / Dead / Over / OK) and filter pills.
 *
 * Mounted as a tab in InventoryCount page (joins count history + current
 * state in one nav location). `embedded` prop strips the page wrapper so
 * the parent hub owns the page chrome.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  Download, FileText, RefreshCw, Loader, Package,
} from 'lucide-react';
import { toast } from 'react-toastify';
import { getReportInventory } from '../../services/api';
import { downloadCSV, downloadPDF } from '../../utils/exportUtils';
import '../../styles/portal.css';
import './reports-shared.css';

const fmt    = (n) => n == null ? '--' : `$${Number(n).toFixed(2)}`;
const fmtNum = (n) => n == null ? '--' : Number(n).toLocaleString();
const txt    = (v) => {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'object') return v.name || v.label || v.code || v.id || '';
  return String(v);
};

function StatCard({ label, value }) {
  return (
    <div className="p-stat-card">
      <div className="p-stat-card-label">{label}</div>
      <div className="p-stat-card-value">{value}</div>
    </div>
  );
}

export default function InventoryStatus({ embedded = false }) {
  const [invData, setInvData] = useState(null);
  const [invFilter, setInvFilter] = useState('all');
  const [loading, setLoading] = useState(false);

  const fetchInventory = useCallback(async (filter = invFilter) => {
    try {
      setLoading(true);
      const params = filter !== 'all' ? { filter } : {};
      const data = await getReportInventory(params);
      setInvData(data);
    } catch (err) {
      toast.error(`Failed to load inventory: ${err.response?.data?.error || err.message}`);
    } finally {
      setLoading(false);
    }
  }, [invFilter]);

  useEffect(() => {
    fetchInventory('all');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const products = invData?.products || [];

  const statusBadge = (status) => {
    const map = {
      out:  { cls: 'p-badge-red',    label: 'Out' },
      low:  { cls: 'p-badge-amber',  label: 'Low' },
      dead: { cls: 'p-badge-gray',   label: 'Dead' },
      over: { cls: 'p-badge-purple', label: 'Over' },
      ok:   { cls: 'p-badge-green',  label: 'OK' },
    };
    const b = map[status] || map.ok;
    return <span className={`p-badge ${b.cls}`}>{b.label}</span>;
  };

  const filtered = invFilter === 'all'
    ? products
    : products.filter(p => p.status === invFilter);

  const outCount  = products.filter(p => p.status === 'out').length;
  const lowCount  = products.filter(p => p.status === 'low').length;
  const deadCount = products.filter(p => p.status === 'dead').length;
  const overCount = products.filter(p => p.status === 'over').length;
  const totalRetail = products.reduce((a, p) => a + (p.retailValue || 0), 0);
  const totalCost   = products.reduce((a, p) => a + (p.costValue || 0), 0);

  const invCols = [
    { key: 'name',        label: 'Name' },
    { key: 'upc',         label: 'UPC' },
    { key: 'dept',        label: 'Dept' },
    { key: 'onHand',      label: 'On Hand' },
    { key: 'onOrder',     label: 'On Order' },
    { key: 'sold30d',     label: 'Sold (30d)' },
    { key: 'avgDaily',    label: 'Avg Daily' },
    { key: 'daysSupply',  label: 'Days Supply' },
    { key: 'status',      label: 'Status' },
    { key: 'retailValue', label: 'Retail Value' },
  ];

  const handleInvFilter = (key) => {
    setInvFilter(key);
    fetchInventory(key);
  };

  const Body = (
    <>
      <div className="rh-controls">
        <button className="p-btn p-btn-primary p-btn-sm" onClick={() => fetchInventory(invFilter)} disabled={loading}>
          {loading ? <><Loader size={14} className="p-spin" /> Loading…</> : <><RefreshCw size={14} /> Refresh</>}
        </button>
      </div>

      {!invData && !loading && (
        <div className="p-empty">No data loaded yet.</div>
      )}
      {loading && !invData && (
        <div className="p-loading"><Loader size={16} className="p-spin" /> Loading inventory…</div>
      )}

      {invData && (
        <>
          <div className="p-stat-grid">
            <StatCard label="Total Products"     value={fmtNum(products.length)} />
            <StatCard label="Out of Stock"        value={fmtNum(outCount)} />
            <StatCard label="Low Stock"           value={fmtNum(lowCount)} />
            <StatCard label="Dead Stock"          value={fmtNum(deadCount)} />
            <StatCard label="Over Stock"          value={fmtNum(overCount)} />
            <StatCard label="Total Retail Value"  value={fmt(totalRetail)} />
            <StatCard label="Total Cost Value"    value={fmt(totalCost)} />
          </div>

          <div className="rh-inv-filters">
            {[
              { key: 'all',  label: 'All',           count: products.length },
              { key: 'low',  label: 'Low Stock',      count: lowCount },
              { key: 'dead', label: 'Dead Stock',     count: deadCount },
              { key: 'over', label: 'Over Stock',     count: overCount },
              { key: 'out',  label: 'Out of Stock',   count: outCount },
            ].map(f => (
              <button
                key={f.key}
                className={`p-btn p-btn-ghost p-btn-sm ${invFilter === f.key ? 'rh-filter-active' : ''}`}
                onClick={() => handleInvFilter(f.key)}
              >
                {f.label} <span className="p-badge p-badge-count">{f.count}</span>
              </button>
            ))}
          </div>

          <div className="p-table-wrap">
            <table className="p-table">
              <thead>
                <tr>
                  <th>Name</th><th>UPC</th><th>Dept</th><th>On Hand</th>
                  <th>On Order</th><th>Sold (30d)</th><th>Avg Daily</th>
                  <th>Days Supply</th><th>Status</th><th>Retail Value</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p, i) => (
                  <tr key={i}>
                    <td className="p-td-strong">{txt(p.name)}</td>
                    <td>{txt(p.upc)}</td>
                    <td>{txt(p.dept)}</td>
                    <td>{fmtNum(p.onHand)}</td>
                    <td>{fmtNum(p.onOrder)}</td>
                    <td>{fmtNum(p.sold30d)}</td>
                    <td>{p.avgDaily != null ? Number(p.avgDaily).toFixed(1) : '--'}</td>
                    <td>{p.daysSupply != null ? fmtNum(p.daysSupply) : '--'}</td>
                    <td>{statusBadge(p.status)}</td>
                    <td>{fmt(p.retailValue)}</td>
                  </tr>
                ))}
                {!filtered.length && <tr><td colSpan={10} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No products match filter</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="rh-export-row" style={{ marginTop: '1rem' }}>
            <button className="p-btn p-btn-ghost p-btn-sm" onClick={() => downloadCSV(filtered, invCols, 'inventory-status')}>
              <Download size={14} /> CSV
            </button>
            <button className="p-btn p-btn-ghost p-btn-sm" onClick={() => downloadPDF({
              title: 'Inventory Status',
              summary: [
                { label: 'Total Products', value: fmtNum(products.length) },
                { label: 'Out of Stock',   value: fmtNum(outCount) },
                { label: 'Retail Value',   value: fmt(totalRetail) },
              ],
              data: filtered, columns: invCols, filename: 'inventory-status',
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
          <div className="p-header-icon"><Package size={22} /></div>
          <div>
            <h1 className="p-title">Inventory Status</h1>
            <p className="p-subtitle">Current stock levels with reorder analysis</p>
          </div>
        </div>
      </div>
      {Body}
    </div>
  );
}
