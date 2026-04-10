import { useState, useEffect } from 'react';
import { ShoppingCart } from 'lucide-react';
import { toast } from 'react-toastify';
import './EcomOrders.css';

const API = '/api/ecom';

function getHeaders() {
  const u = JSON.parse(localStorage.getItem('user') || '{}');
  const storeId = localStorage.getItem('activeStoreId') || '';
  return {
    Authorization: `Bearer ${u.token}`,
    'X-Store-Id': storeId,
    'X-Org-Id': u.orgId || u.tenantId || '',
    'Content-Type': 'application/json',
  };
}

async function api(method, path, body) {
  const r = await fetch(`${API}${path}`, { method, headers: getHeaders(), body: body ? JSON.stringify(body) : undefined });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function fmt(n) { return `$${Number(n).toFixed(2)}`; }
function fmtDate(d) { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }

const STATUSES = ['all', 'pending', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled'];
const NEXT_STATUS = { pending: 'confirmed', confirmed: 'preparing', preparing: 'ready', ready: 'completed' };

// Notifications handled by global EcomOrderNotifier — no duplicate polling here

export default function EcomOrders() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const params = filter !== 'all' ? `?status=${filter}` : '';
      const d = await api('GET', `/manage/orders${params}`);
      setOrders(d.data || []);
    } catch (e) { toast.error(e.message); }
    setLoading(false);
  };

  // Load on mount + auto-refresh every 15s (data only, no sound/toast — global notifier handles that)
  useEffect(() => {
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, [filter]);

  const updateStatus = async (orderId, status) => {
    try {
      await api('PUT', `/manage/orders/${orderId}/status`, { status });
      toast.success(`Order marked as ${status}`);
      setSelected(s => s ? { ...s, status } : s);
      load();
    } catch (e) { toast.error(e.message); }
  };

  if (selected) {
    const o = selected;
    const items = Array.isArray(o.lineItems) ? o.lineItems : [];
    const next = NEXT_STATUS[o.status];
    return (
      <div className="p-page">
        <div className="eo-detail">
          <div className="eo-detail-header">
            <div className="eo-detail-title">{o.orderNumber}</div>
            <button className="eo-detail-back" onClick={() => setSelected(null)}>← Back to Orders</button>
          </div>
          <div className="eo-detail-grid">
            <div><div className="eo-detail-label">Status</div><div className="eo-detail-value"><span className={`eo-badge eo-badge--${o.status}`}>{o.status}</span></div></div>
            <div><div className="eo-detail-label">Fulfillment</div><div className="eo-detail-value">{o.fulfillmentType === 'pickup' ? '🏪 Pickup' : '🚗 Delivery'}</div></div>
            <div><div className="eo-detail-label">Customer</div><div className="eo-detail-value">{o.customerName}<br /><span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{o.customerEmail}</span></div></div>
            <div><div className="eo-detail-label">Total</div><div className="eo-detail-value" style={{ fontSize: 18, fontWeight: 700, color: 'var(--green)' }}>{fmt(o.grandTotal)}</div></div>
            <div><div className="eo-detail-label">Ordered</div><div className="eo-detail-value">{fmtDate(o.createdAt)}</div></div>
            <div><div className="eo-detail-label">Payment</div><div className="eo-detail-value">{o.paymentMethod || 'N/A'} · {o.paymentStatus}</div></div>
          </div>
          <div className="eo-items-list">
            <div className="eo-detail-label" style={{ marginBottom: 8 }}>Items</div>
            {items.map((it, i) => (
              <div key={i} className="eo-item-row">
                <span>{it.name} × {it.qty}</span>
                <span>{fmt(it.total || it.price * it.qty)}</span>
              </div>
            ))}
          </div>
          <div className="eo-status-btns">
            {next && <button className="eo-status-btn eo-status-btn--primary" onClick={() => updateStatus(o.id, next)}>Mark as {next}</button>}
            {o.status !== 'cancelled' && o.status !== 'completed' && (
              <button className="eo-status-btn" onClick={() => updateStatus(o.id, 'cancelled')}>Cancel Order</button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-page">
      <div className="p-header">
        <div className="p-header-left">
          <div className="p-header-icon">
            <ShoppingCart size={22} />
          </div>
          <div>
            <h1 className="p-title">Online Orders</h1>
            <p className="p-subtitle">Manage and fulfill customer orders</p>
          </div>
        </div>
        <div className="p-header-actions"></div>
      </div>
      <div className="eo-filters">
        {STATUSES.map(s => (
          <button key={s} className={`eo-filter-btn ${filter === s ? 'eo-filter-btn--active' : ''}`} onClick={() => setFilter(s)}>
            {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>
      {loading ? <p>Loading...</p> : orders.length === 0 ? (
        <div className="eo-empty">No orders yet</div>
      ) : (
        <table className="eo-table">
          <thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>Status</th><th>Type</th><th>Date</th></tr></thead>
          <tbody>
            {orders.map(o => (
              <tr key={o.id} onClick={() => setSelected(o)}>
                <td style={{ fontWeight: 600 }}>{o.orderNumber}</td>
                <td>{o.customerName}</td>
                <td>{fmt(o.grandTotal)}</td>
                <td><span className={`eo-badge eo-badge--${o.status}`}>{o.status}</span></td>
                <td>{o.fulfillmentType === 'pickup' ? '🏪' : '🚗'}</td>
                <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{fmtDate(o.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
