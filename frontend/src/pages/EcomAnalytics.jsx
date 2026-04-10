import { useState, useEffect } from 'react';
import { DollarSign, ShoppingCart, Users, TrendingUp, BarChart3 } from 'lucide-react';
import './EcomSetup.css';
import './EcomAnalytics.css';

const API = '/api/ecom';

function getHeaders() {
  const u = JSON.parse(localStorage.getItem('user') || '{}');
  const storeId = localStorage.getItem('activeStoreId') || '';
  return { Authorization: `Bearer ${u.token}`, 'X-Store-Id': storeId, 'X-Org-Id': u.orgId || u.tenantId || '', 'Content-Type': 'application/json' };
}

export default function EcomAnalytics() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/manage/analytics`, { headers: getHeaders() })
      .then(r => r.json()).then(d => setData(d.data)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-page"><p className="ean-loading">Loading analytics...</p></div>;
  if (!data) return <div className="p-page"><p className="ean-loading">Enable e-commerce first to see analytics.</p></div>;

  const { kpis, statusCounts, revenueTrend, topProducts } = data;

  return (
    <div className="p-page">
      <div className="p-header">
        <div className="p-header-left">
          <div className="p-header-icon">
            <BarChart3 size={22} />
          </div>
          <div>
            <h1 className="p-title">Store Analytics</h1>
            <p className="p-subtitle">Revenue, orders, and customer metrics</p>
          </div>
        </div>
        <div className="p-header-actions"></div>
      </div>

      <div className="es-analytics-kpis">
        <div className="es-kpi"><DollarSign size={20} className="es-kpi-icon" /><div><span className="es-kpi-num">${kpis.totalRevenue.toLocaleString()}</span><span className="es-kpi-label">Total Revenue</span></div></div>
        <div className="es-kpi"><ShoppingCart size={20} className="es-kpi-icon" /><div><span className="es-kpi-num">{kpis.orderCount}</span><span className="es-kpi-label">Orders</span></div></div>
        <div className="es-kpi"><Users size={20} className="es-kpi-icon" /><div><span className="es-kpi-num">{kpis.customerCount}</span><span className="es-kpi-label">Customers</span></div></div>
        <div className="es-kpi"><TrendingUp size={20} className="es-kpi-icon" /><div><span className="es-kpi-num">${kpis.avgOrderValue.toFixed(2)}</span><span className="es-kpi-label">Avg Order</span></div></div>
      </div>

      <div className="es-grid ean-grid-mb">
        <div className="es-section">
          <div className="es-section-title">Revenue (Last 14 Days)</div>
          <div className="es-chart-bar">
            {revenueTrend.slice(-14).map((d, i) => {
              const max = Math.max(...revenueTrend.slice(-14).map(r => r.revenue), 1);
              return (
                <div key={i} className="es-bar-col" title={`${d.date}: $${d.revenue}`}>
                  <div className="es-bar" style={{ height: `${Math.max((d.revenue / max) * 100, 2)}%` }} />
                  <span className="es-bar-label">{d.date.slice(8)}</span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="es-section">
          <div className="es-section-title">Orders by Status</div>
          {Object.entries(statusCounts).length === 0 ? <p className="ean-no-data">No orders yet</p> : (
            <div className="es-status-list">
              {Object.entries(statusCounts).map(([status, count]) => (
                <div key={status} className="es-status-row"><span className="es-status-name">{status}</span><span className="es-status-count">{count}</span></div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="es-section">
        <div className="es-section-title">Top Products</div>
        {topProducts.length === 0 ? <p className="ean-no-data">No sales data yet</p> : (
          <table className="es-top-table">
            <thead><tr><th>Product</th><th>Sold</th><th>Revenue</th></tr></thead>
            <tbody>{topProducts.map((p, i) => (<tr key={i}><td>{p.name}</td><td>{p.qty}</td><td>${p.revenue.toFixed(2)}</td></tr>))}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}
