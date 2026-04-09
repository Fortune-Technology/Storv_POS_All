import { useState, useEffect } from 'react';
import Sidebar from '../components/Sidebar';
import './EcomSetup.css';
import './EcomOrders.css';

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

function fmt(n) { return `$${Number(n).toFixed(2)}`; }

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
      <div className="layout-container"><Sidebar /><main className="main-content">
        <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', color: 'var(--brand-primary)', cursor: 'pointer', marginBottom: 16, fontSize: 13 }}>← Back to Customers</button>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 24 }}>
          <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'var(--brand-primary)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 700 }}>
            {selected.firstName?.charAt(0) || selected.name?.charAt(0) || '?'}
          </div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{selected.firstName || ''} {selected.lastName || ''}</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{selected.email}{selected.phone ? ` · ${selected.phone}` : ''}</div>
          </div>
        </div>
        <div className="es-analytics-kpis" style={{ marginBottom: 20 }}>
          <div className="es-kpi"><div><span className="es-kpi-num">{selected.orderCount}</span><span className="es-kpi-label">Orders</span></div></div>
          <div className="es-kpi"><div><span className="es-kpi-num">{fmt(selected.totalSpent)}</span><span className="es-kpi-label">Total Spent</span></div></div>
          <div className="es-kpi"><div><span className="es-kpi-num">{new Date(selected.createdAt).toLocaleDateString()}</span><span className="es-kpi-label">Joined</span></div></div>
        </div>
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>Order History</h3>
        {orders.length === 0 ? <p style={{ color: 'var(--text-muted)' }}>No orders</p> : (
          <table className="eo-table">
            <thead><tr><th>Order</th><th>Status</th><th>Total</th><th>Date</th></tr></thead>
            <tbody>{orders.map(o => (
              <tr key={o.id}>
                <td style={{ fontWeight: 600 }}>{o.orderNumber}</td>
                <td><span className={`eo-badge eo-badge--${o.status}`}>{o.status}</span></td>
                <td>{fmt(o.grandTotal)}</td>
                <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{new Date(o.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </main></div>
    );
  }

  return (
    <div className="layout-container"><Sidebar /><main className="main-content">
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 20 }}>Customers</h1>
      <input className="es-input" placeholder="Search by name, email, phone..." value={search} onChange={e => setSearch(e.target.value)} style={{ marginBottom: 16, maxWidth: 400 }} />
      {loading ? <p style={{ color: 'var(--text-muted)' }}>Loading...</p> : customers.length === 0 ? (
        <p style={{ color: 'var(--text-muted)' }}>No customers found</p>
      ) : (
        <table className="eo-table">
          <thead><tr><th>Name</th><th>Email</th><th>Orders</th><th>Spent</th><th>Joined</th></tr></thead>
          <tbody>{customers.map(c => (
            <tr key={c.id} onClick={() => selectCustomer(c.id)}>
              <td style={{ fontWeight: 600 }}>{c.firstName || c.name || '—'} {c.lastName || ''}</td>
              <td>{c.email}</td>
              <td>{c.orderCount}</td>
              <td>{fmt(c.totalSpent)}</td>
              <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{new Date(c.createdAt).toLocaleDateString()}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </main></div>
  );
}
