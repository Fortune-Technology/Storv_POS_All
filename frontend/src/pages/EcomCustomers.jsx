import { useState, useEffect } from 'react';
import { Users } from 'lucide-react';
import './EcomSetup.css';
import './EcomOrders.css';
import './EcomCustomers.css';

const API = '/api/ecom';

function getHeaders() {
  const u = JSON.parse(localStorage.getItem('user') || '{}');
  const storeId = localStorage.getItem('activeStoreId') || '';
  return { Authorization: `Bearer ${u.token}`, 'X-Store-Id': storeId, 'X-Org-Id': u.orgId || u.tenantId || '', 'Content-Type': 'application/json' };
}

async function api(method, path) {
  const r = await fetch(`${API}${path}`, { method, headers: getHeaders() });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Failed');
  return data;
}

import { fmtMoney } from '../utils/formatters';
const fmt = fmtMoney;

export default function EcomCustomers() {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);

  const load = () => {
    setLoading(true);
    const params = search ? `?search=${encodeURIComponent(search)}` : '';
    api('GET', `/manage/customers${params}`).then(d => setCustomers(d.data || [])).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [search]);

  const selectCustomer = async (id) => {
    try {
      const d = await api('GET', `/manage/customers/${id}`);
      setSelected(d.data);
    } catch {}
  };

  if (selected) {
    const orders = selected.orders || [];
    return (
      <div className="p-page">
        <button onClick={() => setSelected(null)} className="ecust-back-btn">← Back to Customers</button>
        <div className="ecust-profile-row">
          <div className="ecust-avatar">
            {selected.firstName?.charAt(0) || selected.name?.charAt(0) || '?'}
          </div>
          <div>
            <div className="ecust-name">{selected.firstName || ''} {selected.lastName || ''}</div>
            <div className="ecust-email">{selected.email}{selected.phone ? ` · ${selected.phone}` : ''}</div>
          </div>
        </div>
        <div className="es-analytics-kpis ecust-kpis-mb">
          <div className="es-kpi"><div><span className="es-kpi-num">{selected.orderCount}</span><span className="es-kpi-label">Orders</span></div></div>
          <div className="es-kpi"><div><span className="es-kpi-num">{fmt(selected.totalSpent)}</span><span className="es-kpi-label">Total Spent</span></div></div>
          <div className="es-kpi"><div><span className="es-kpi-num">{new Date(selected.createdAt).toLocaleDateString()}</span><span className="es-kpi-label">Joined</span></div></div>
        </div>
        <h3 className="ecust-section-title">Order History</h3>
        {orders.length === 0 ? <p className="ecust-no-data">No orders</p> : (
          <table className="eo-table">
            <thead><tr><th>Order</th><th>Status</th><th>Total</th><th>Date</th></tr></thead>
            <tbody>{orders.map(o => (
              <tr key={o.id}>
                <td className="ecust-td-bold">{o.orderNumber}</td>
                <td><span className={`eo-badge eo-badge--${o.status}`}>{o.status}</span></td>
                <td>{fmt(o.grandTotal)}</td>
                <td className="ecust-td-date">{new Date(o.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    );
  }

  return (
    <div className="p-page">
      <div className="p-header">
        <div className="p-header-left">
          <div className="p-header-icon">
            <Users size={22} />
          </div>
          <div>
            <h1 className="p-title">Customers</h1>
            <p className="p-subtitle">Online store customer accounts and order history</p>
          </div>
        </div>
        <div className="p-header-actions"></div>
      </div>
      <input className="es-input ecust-search" placeholder="Search by name, email, phone..." value={search} onChange={e => setSearch(e.target.value)} />
      {loading ? <p className="ecust-loading">Loading...</p> : customers.length === 0 ? (
        <p className="ecust-no-data">No customers found</p>
      ) : (
        <table className="eo-table">
          <thead><tr><th>Name</th><th>Email</th><th>Orders</th><th>Spent</th><th>Joined</th></tr></thead>
          <tbody>{customers.map(c => (
            <tr key={c.id} onClick={() => selectCustomer(c.id)}>
              <td className="ecust-td-bold">{c.firstName || c.name || '—'} {c.lastName || ''}</td>
              <td>{c.email}</td>
              <td>{c.orderCount}</td>
              <td>{fmt(c.totalSpent)}</td>
              <td className="ecust-td-date">{new Date(c.createdAt).toLocaleDateString()}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}
