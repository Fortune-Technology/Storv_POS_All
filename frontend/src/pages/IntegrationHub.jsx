/**
 * IntegrationHub  --  Delivery Platform Integration management
 * Tabs: Connections | Settings | Orders | Analytics
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'react-toastify';
import { useConfirm } from '../hooks/useConfirmDialog.jsx';
import {
  Link2, Unlink, Settings, ShoppingBag, BarChart3, RefreshCw, Copy,
  Clock, AlertCircle, CheckCircle2, XCircle, ChevronDown, ChevronUp,
  Loader2, Download, Timer, Truck, User, Sliders,
} from 'lucide-react';
import MarketplacePricingDrawer from '../components/MarketplacePricingDrawer';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import {
  getIntegrationPlatforms, connectIntegration, disconnectIntegration,
  getIntegrationSettings, updateIntegrationSettings, syncIntegrationInventory,
  getIntegrationOrders, confirmIntegrationOrder, readyIntegrationOrder, cancelIntegrationOrder,
  getIntegrationAnalytics,
} from '../services/api';
import { downloadCSV, downloadPDF } from '../utils/exportUtils';
import { fmtMoney } from '../utils/formatters';
import '../styles/portal.css';
import './IntegrationHub.css';

// ── Constants ─────────────────────────────────────────────────────────────────
const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:5000/api').replace(/\/api$/, '');

const PLATFORM_META = {
  doordash:  { name: 'DoorDash',   color: '#FF3008', initial: 'D',  credentialFields: ['developerId', 'keyId', 'signingSecret', 'storeLocationId'], status: 'live' },
  ubereats:  { name: 'Uber Eats',  color: '#06C167', initial: 'U',  credentialFields: ['clientId', 'clientSecret', 'restaurantId'], status: 'live' },
  instacart: { name: 'Instacart',  color: '#43B02A', initial: 'I',  credentialFields: ['clientId', 'clientSecret', 'baseUrl', 'storeLocationId'], status: 'live' },
  grubhub:   { name: 'Grubhub',    color: '#F63440', initial: 'G',  credentialFields: [], status: 'coming_soon' },
  gopuff:    { name: 'Gopuff',     color: '#00A4FF', initial: 'G',  credentialFields: [], status: 'coming_soon' },
  postmates: { name: 'Postmates',  color: '#000000', initial: 'P',  credentialFields: [], status: 'coming_soon', note: 'Merged into Uber Eats' },
};

const TABS = [
  { key: 'orders',      label: 'Orders',      icon: <ShoppingBag size={14} /> },
  { key: 'analytics',   label: 'Analytics',   icon: <BarChart3 size={14} /> },
  { key: 'connections', label: 'Connections', icon: <Link2 size={14} /> },
  { key: 'settings',    label: 'Settings',    icon: <Settings size={14} /> },
];

const SYNC_OPTIONS = [
  { value: 'realtime',  label: 'Real-time (on every stock change)' },
  { value: '15min',     label: 'Every 15 minutes' },
  { value: '1hr',       label: 'Every hour' },
  { value: '6hr',       label: 'Every 6 hours' },
  { value: 'manual',    label: 'Manual only' },
];

const STOCK_METHODS = [
  { value: 'actual',   label: 'Use actual inventory' },
  { value: 'velocity', label: 'Estimate from sales velocity' },
  { value: 'always',   label: 'Always in stock' },
  { value: 'custom',   label: 'Custom fixed qty' },
];

const ORDER_STATUSES = ['all', 'new', 'confirmed', 'ready', 'picked_up', 'delivered', 'cancelled'];

const PLATFORM_COLORS = Object.fromEntries(
  Object.entries(PLATFORM_META).map(([k, v]) => [k, v.color])
);

const fmt$ = fmtMoney;
const fmtDate = (d) => d ? new Date(d).toLocaleString() : '--';

// ── Helpers ───────────────────────────────────────────────────────────────────
function fieldLabel(field) {
  return field
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, s => s.toUpperCase())
    .replace('Id', 'ID')
    .replace('Api', 'API');
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════
export default function IntegrationHub() {
  const [tab, setTab] = useState('orders');
  const [platforms, setPlatforms] = useState({}); // keyed by platform id
  const [loading, setLoading] = useState(true);

  // ── Load platforms ──────────────────────────────────────────────────────────
  const fetchPlatforms = useCallback(async () => {
    try {
      const data = await getIntegrationPlatforms();
      // data could be { doordash: { connected, storeName, lastSync, status, ... }, ... }
      setPlatforms(data || {});
    } catch {
      // If endpoint not yet wired, seed with disconnected states
      const seed = {};
      for (const key of Object.keys(PLATFORM_META)) seed[key] = { connected: false, status: 'disconnected' };
      setPlatforms(seed);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPlatforms(); }, [fetchPlatforms]);

  const connectedKeys = Object.keys(platforms).filter(k => platforms[k]?.connected);

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="p-page">
      {/* Header */}
      <div className="p-header">
        <div className="p-header-left">
          <div className="p-header-icon"><Link2 size={22} /></div>
          <div>
            <h1 className="p-title">Delivery Platforms</h1>
            <p className="p-subtitle">Manage DoorDash, Uber Eats, Instacart, Grubhub &amp; Postmates integrations</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="p-tabs">
        {TABS.map(t => (
          <button
            key={t.key}
            className={`p-tab ${tab === t.key ? 'active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="ih-spinner"><Loader2 size={18} />Loading platforms...</div>
      ) : (
        <>
          {tab === 'connections' && <ConnectionsTab platforms={platforms} onRefresh={fetchPlatforms} />}
          {tab === 'settings'    && <SettingsTab connectedKeys={connectedKeys} />}
          {tab === 'orders'      && <OrdersTab connectedKeys={connectedKeys} />}
          {tab === 'analytics'   && <AnalyticsTab connectedKeys={connectedKeys} />}
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 1: CONNECTIONS
// ═══════════════════════════════════════════════════════════════════════════════
function ConnectionsTab({ platforms, onRefresh }) {
  return (
    <div className="ih-platforms-grid">
      {Object.keys(PLATFORM_META).map(key => (
        <PlatformCard key={key} platformKey={key} data={platforms[key] || {}} onRefresh={onRefresh} />
      ))}
    </div>
  );
}

function PlatformCard({ platformKey, data, onRefresh }) {
  const confirm = useConfirm();
  const meta = PLATFORM_META[platformKey] || { name: platformKey, color: '#888', initial: platformKey?.[0]?.toUpperCase() || '?', credentialFields: [], status: 'live' };
  const [creds, setCreds] = useState({});
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [pricingOpen, setPricingOpen] = useState(false);  // S71 — pricing drawer

  const isConnected = data.connected;
  const status = data.status || (isConnected ? 'connected' : 'disconnected');

  const handleChange = (field, val) => setCreds(prev => ({ ...prev, [field]: val }));

  const handleConnect = async () => {
    setBusy(true);
    try {
      await connectIntegration({ platform: platformKey, credentials: creds });
      toast.success(`${meta.name} connected successfully`);
      setCreds({});
      onRefresh();
    } catch (err) {
      toast.error(err?.response?.data?.error || `Failed to connect ${meta.name}`);
    } finally { setBusy(false); }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      await connectIntegration({ platform: platformKey, credentials: creds, testOnly: true });
      toast.success(`${meta.name} connection test passed`);
    } catch (err) {
      toast.error(err?.response?.data?.error || `Connection test failed for ${meta.name}`);
    } finally { setTesting(false); }
  };

  const handleDisconnect = async () => {
    if (!await confirm({
      title: 'Disconnect integration?',
      message: `Disconnect ${meta.name}? This will stop all syncing.`,
      confirmLabel: 'Disconnect',
      danger: true,
    })) return;
    setBusy(true);
    try {
      await disconnectIntegration({ platform: platformKey });
      toast.success(`${meta.name} disconnected`);
      onRefresh();
    } catch (err) {
      toast.error(err?.response?.data?.error || `Failed to disconnect ${meta.name}`);
    } finally { setBusy(false); }
  };

  const handleSync = async () => {
    setBusy(true);
    try {
      await syncIntegrationInventory({ platform: platformKey });
      toast.success(`${meta.name} inventory sync started`);
      onRefresh();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Sync failed');
    } finally { setBusy(false); }
  };

  const copyWebhook = () => {
    const url = `${API_URL}/webhook/${platformKey}/order`;
    navigator.clipboard.writeText(url);
    toast.success('Webhook URL copied');
  };

  return (
    <div className="ih-platform-card" style={{ borderColor: isConnected ? meta.color + '40' : undefined }}>
      {/* Header */}
      <div className="ih-platform-header">
        <div className="ih-platform-dot" style={{ background: meta.color }}>{meta.initial}</div>
        <span className="ih-platform-name">{meta.name}</span>
        <span className="ih-platform-status">
          {meta.status === 'coming_soon' ? (
            <span className="ih-badge ih-badge--coming-soon">Coming Soon</span>
          ) : (
            <span className={`ih-badge ih-badge--${status}`}>
              {status === 'connected' && <><CheckCircle2 size={11} /> Connected</>}
              {status === 'disconnected' && <><Unlink size={11} /> Disconnected</>}
              {status === 'error' && <><AlertCircle size={11} /> Error</>}
            </span>
          )}
        </span>
      </div>

      {/* Coming soon message */}
      {meta.status === 'coming_soon' && (
        <div className="ih-coming-soon">
          <div className="ih-coming-soon-text">
            {meta.note || `${meta.name} integration is coming soon. We're working on it!`}
          </div>
          <div className="ih-coming-soon-sub">Contact support to request early access</div>
        </div>
      )}

      {/* Disconnected: show credential form (only for live platforms).
          S71d Option B — also show "Pricing & Sync" button so admins can
          configure pricing BEFORE connecting credentials. The drawer
          auto-creates a StoreIntegration row on first GET (lazy-init in
          backend getSettings handler — works for any live platform). */}
      {!isConnected && meta.status !== 'coming_soon' && (
        <div className="ih-cred-form">
          {meta.credentialFields.map(field => (
            <div key={field} className="ih-cred-field">
              <label>{fieldLabel(field)}</label>
              <input
                className="p-input"
                type={field.toLowerCase().includes('secret') || field.toLowerCase().includes('key') ? 'password' : 'text'}
                placeholder={fieldLabel(field)}
                value={creds[field] || ''}
                onChange={e => handleChange(field, e.target.value)}
              />
            </div>
          ))}
          <div className="ih-cred-actions">
            <button className="p-btn p-btn-ghost p-btn-sm" onClick={() => setPricingOpen(true)} disabled={busy} title="Configure pricing, rounding, exclusions before connecting">
              <Sliders size={13} /> Pricing &amp; Sync
            </button>
            <button className="p-btn p-btn-ghost p-btn-sm" onClick={handleTest} disabled={testing}>
              {testing ? <><Loader2 size={13} /> Testing...</> : 'Test Connection'}
            </button>
            <button className="p-btn p-btn-primary p-btn-sm" onClick={handleConnect} disabled={busy}>
              {busy ? <><Loader2 size={13} /> Connecting...</> : <><Link2 size={13} /> Connect</>}
            </button>
          </div>
        </div>
      )}

      {/* Connected: show info + actions */}
      {isConnected && (
        <div className="ih-connected-info">
          {data.storeName && (
            <div className="ih-info-row"><User size={13} /> {data.storeName}</div>
          )}
          <div className="ih-info-row">
            <Clock size={13} /> Last sync: {fmtDate(data.lastSync)}
          </div>
          <div className="ih-connected-actions">
            <button className="p-btn p-btn-primary p-btn-sm" onClick={() => setPricingOpen(true)} disabled={busy} title="Configure pricing, rounding, exclusions">
              <Sliders size={13} /> Pricing &amp; Sync
            </button>
            <button className="p-btn p-btn-secondary p-btn-sm" onClick={handleSync} disabled={busy}>
              {busy ? <Loader2 size={13} /> : <RefreshCw size={13} />} Sync Now
            </button>
            <button className="p-btn p-btn-danger p-btn-sm" onClick={handleDisconnect} disabled={busy}>
              <Unlink size={13} /> Disconnect
            </button>
          </div>
        </div>
      )}

      {/* Webhook URL */}
      <div className="ih-webhook">
        <div className="ih-webhook-label">Webhook URL</div>
        <div className="ih-webhook-url">
          <code>{API_URL}/webhook/{platformKey}/order</code>
          <button className="p-btn p-btn-icon p-btn-sm" onClick={copyWebhook} title="Copy">
            <Copy size={13} />
          </button>
        </div>
      </div>

      {/* S71 + S71d Option B — pricing drawer for any live platform regardless
          of connection state. Backend lazy-creates the StoreIntegration row
          on first GET, so admins can configure markup/rounding/exclusions
          before they connect credentials. */}
      {meta.status !== 'coming_soon' && (
        <MarketplacePricingDrawer
          open={pricingOpen}
          onClose={() => setPricingOpen(false)}
          platformKey={platformKey}
          platformMeta={meta}
          onSaved={onRefresh}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 2: SETTINGS
// ═══════════════════════════════════════════════════════════════════════════════
function SettingsTab({ connectedKeys }) {
  const [active, setActive] = useState(connectedKeys[0] || '');
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!active) return;
    setLoading(true);
    getIntegrationSettings(active)
      .then(d => setSettings(d))
      .catch(() => {
        // default settings if endpoint not available
        setSettings({
          syncFrequency: 'realtime',
          autoConfirmOrders: false,
          defaultStockMethod: 'actual',
          defaultStockDays: 7,
          departmentOverrides: [],
        });
      })
      .finally(() => setLoading(false));
  }, [active]);

  const handleSave = async () => {
    if (!active || !settings) return;
    setSaving(true);
    try {
      await updateIntegrationSettings(active, settings);
      toast.success('Settings saved');
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to save settings');
    } finally { setSaving(false); }
  };

  const upd = (key, val) => setSettings(prev => ({ ...prev, [key]: val }));

  const updDeptOverride = (idx, key, val) => {
    setSettings(prev => {
      const arr = [...(prev.departmentOverrides || [])];
      arr[idx] = { ...arr[idx], [key]: val };
      return { ...prev, departmentOverrides: arr };
    });
  };

  if (connectedKeys.length === 0) {
    return (
      <div className="p-empty">
        <Settings size={40} strokeWidth={1} />
        <p>No platforms connected yet. Connect a platform in the Connections tab to configure settings.</p>
      </div>
    );
  }

  return (
    <div className="ih-settings-wrap">
      {/* Platform pills */}
      <div className="ih-platform-pills">
        {connectedKeys.map(key => {
          const m = PLATFORM_META[key] || { name: key, color: '#888', initial: key?.[0]?.toUpperCase() || '?' };
          return (
            <button
              key={key}
              className={`ih-pill ${active === key ? 'active' : ''}`}
              onClick={() => setActive(key)}
            >
              <span className="ih-pill-dot" style={{ background: m.color }} />
              {m.name}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="ih-spinner"><Loader2 size={18} />Loading settings...</div>
      ) : settings && (
        <>
          {/* Sync frequency */}
          <div className="ih-settings-section">
            <h3>Sync &amp; Orders</h3>
            <div className="ih-form-row">
              <label>Sync Frequency</label>
              <select className="p-select" value={settings.syncFrequency || 'realtime'} onChange={e => upd('syncFrequency', e.target.value)}>
                {SYNC_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="ih-toggle-row">
              <span>Auto-confirm incoming orders</span>
              <label className="ih-toggle">
                <input type="checkbox" checked={!!settings.autoConfirmOrders} onChange={e => upd('autoConfirmOrders', e.target.checked)} />
                <span className="ih-toggle-slider" />
              </label>
            </div>
          </div>

          {/* Stock behavior */}
          <div className="ih-settings-section">
            <h3>Default Stock Behavior</h3>
            <div className="ih-form-row">
              <label>Method</label>
              <select className="p-select" value={settings.defaultStockMethod || 'actual'} onChange={e => upd('defaultStockMethod', e.target.value)}>
                {STOCK_METHODS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            {settings.defaultStockMethod === 'velocity' && (
              <div className="ih-form-row">
                <label>Sales Velocity Days</label>
                <input className="p-input" type="number" min={1} max={90} value={settings.defaultStockDays || 7} onChange={e => upd('defaultStockDays', Number(e.target.value))} />
              </div>
            )}
            {settings.defaultStockMethod === 'custom' && (
              <div className="ih-form-row">
                <label>Fixed Quantity</label>
                <input className="p-input" type="number" min={0} value={settings.customFixedQty || 0} onChange={e => upd('customFixedQty', Number(e.target.value))} />
              </div>
            )}
          </div>

          {/* Department overrides */}
          {settings.departmentOverrides && settings.departmentOverrides.length > 0 && (
            <div className="ih-settings-section">
              <h3>Department Overrides</h3>
              <div className="ih-dept-table-wrap">
                <table className="p-table">
                  <thead>
                    <tr>
                      <th>Department</th>
                      <th>Method</th>
                      <th>Override Qty</th>
                      <th>Enabled</th>
                    </tr>
                  </thead>
                  <tbody>
                    {settings.departmentOverrides.map((dept, i) => (
                      <tr key={dept.departmentId || i}>
                        <td>{dept.name || dept.departmentName || `Dept ${i + 1}`}</td>
                        <td>
                          <select className="p-select" value={dept.method || 'actual'} onChange={e => updDeptOverride(i, 'method', e.target.value)}>
                            {STOCK_METHODS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        </td>
                        <td>
                          <input className="p-input" type="number" min={0} value={dept.overrideQty || 0} onChange={e => updDeptOverride(i, 'overrideQty', Number(e.target.value))} style={{ width: 80 }} />
                        </td>
                        <td>
                          <label className="ih-toggle">
                            <input type="checkbox" checked={!!dept.enabled} onChange={e => updDeptOverride(i, 'enabled', e.target.checked)} />
                            <span className="ih-toggle-slider" />
                          </label>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div>
            <button className="p-btn p-btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? <><Loader2 size={14} /> Saving...</> : 'Save Settings'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 3: ORDERS
// ═══════════════════════════════════════════════════════════════════════════════
function OrdersTab({ connectedKeys }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [platformFilter, setPlatformFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const pollRef = useRef(null);

  const fetchOrders = useCallback(async () => {
    try {
      const params = {};
      if (platformFilter !== 'all') params.platform = platformFilter;
      if (statusFilter !== 'all') params.status = statusFilter;
      if (dateFrom) params.dateFrom = dateFrom;
      if (dateTo) params.dateTo = dateTo;
      const data = await getIntegrationOrders(params);
      setOrders(Array.isArray(data) ? data : data?.orders || []);
    } catch {
      // silent — polling will retry
    } finally {
      setLoading(false);
    }
  }, [platformFilter, statusFilter, dateFrom, dateTo]);

  // Poll every 10 seconds
  useEffect(() => {
    fetchOrders();
    pollRef.current = setInterval(fetchOrders, 10000);
    return () => clearInterval(pollRef.current);
  }, [fetchOrders]);

  if (connectedKeys.length === 0) {
    return (
      <div className="p-empty">
        <ShoppingBag size={40} strokeWidth={1} />
        <p>No platforms connected. Connect a delivery platform to start receiving orders.</p>
      </div>
    );
  }

  return (
    <>
      {/* Filter bar */}
      <div className="ih-filter-bar">
        <select className="p-select" value={platformFilter} onChange={e => setPlatformFilter(e.target.value)}>
          <option value="all">All Platforms</option>
          {Object.entries(PLATFORM_META).map(([k, v]) => (
            <option key={k} value={k}>{v.name}</option>
          ))}
        </select>
        <select className="p-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          {ORDER_STATUSES.map(s => (
            <option key={s} value={s}>{s === 'all' ? 'All Statuses' : s.charAt(0).toUpperCase() + s.slice(1).replace('_', ' ')}</option>
          ))}
        </select>
        <input className="p-input" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
        <input className="p-input" type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
        <button className="p-btn p-btn-ghost p-btn-sm" onClick={fetchOrders}><RefreshCw size={13} /> Refresh</button>
      </div>

      {loading ? (
        <div className="ih-spinner"><Loader2 size={18} />Loading orders...</div>
      ) : orders.length === 0 ? (
        <div className="p-empty">
          <ShoppingBag size={40} strokeWidth={1} />
          <p>No orders match your filters.</p>
        </div>
      ) : (
        <div className="ih-orders-grid">
          {orders.map(order => (
            <OrderCard key={order._id || order.id} order={order} onAction={fetchOrders} />
          ))}
        </div>
      )}
    </>
  );
}

function OrderCard({ order, onAction }) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);

  const meta = PLATFORM_META[order.platform] || {};
  const status = (order.status || 'new').toLowerCase();
  const statusClass = status === 'new' ? 'new' : status === 'confirmed' ? 'confirmed' : status === 'ready' ? 'ready' : '';

  // SLA countdown for new DoorDash orders
  const [slaSeconds, setSlaSeconds] = useState(null);
  useEffect(() => {
    if (order.platform !== 'doordash' || status !== 'new' || !order.createdAt) return;
    const calcSla = () => {
      const deadline = new Date(order.createdAt).getTime() + 5 * 60 * 1000;
      const remaining = Math.max(0, Math.floor((deadline - Date.now()) / 1000));
      setSlaSeconds(remaining);
    };
    calcSla();
    const iv = setInterval(calcSla, 1000);
    return () => clearInterval(iv);
  }, [order.platform, status, order.createdAt]);

  const handleConfirm = async () => {
    setBusy(true);
    try {
      await confirmIntegrationOrder(order._id || order.id);
      toast.success('Order confirmed');
      onAction();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to confirm order');
    } finally { setBusy(false); }
  };

  const handleReady = async () => {
    setBusy(true);
    try {
      await readyIntegrationOrder(order._id || order.id);
      toast.success('Order marked ready for pickup');
      onAction();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to mark order ready');
    } finally { setBusy(false); }
  };

  const handleCancel = async () => {
    const reason = window.prompt('Cancellation reason (optional):');
    if (reason === null) return; // user cancelled prompt
    setBusy(true);
    try {
      await cancelIntegrationOrder(order._id || order.id, { reason });
      toast.success('Order cancelled');
      onAction();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to cancel order');
    } finally { setBusy(false); }
  };

  const fmtSla = (sec) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className={`ih-order-card ${statusClass ? `ih-order-card--${statusClass}` : ''}`}>
      <div className="ih-order-header">
        <span className="ih-order-platform">
          <span className="ih-order-platform-dot" style={{ background: meta.color || '#888' }} />
          {meta.name || order.platform}
        </span>
        <span className="ih-order-id">#{order.shortCode || order.orderNumber || (order._id || order.id || '').slice(-6)}</span>
        <span className="ih-order-customer"><User size={12} /> {order.customerName || 'Guest'}</span>

        {/* SLA countdown */}
        {slaSeconds !== null && slaSeconds > 0 && status === 'new' && (
          <span className="ih-order-sla"><Timer size={12} /> {fmtSla(slaSeconds)}</span>
        )}
        {slaSeconds === 0 && status === 'new' && (
          <span className="ih-order-sla" style={{ background: 'rgba(239,68,68,0.15)' }}><AlertCircle size={12} /> SLA Expired</span>
        )}

        <span className="ih-order-status">
          <span className={`ih-badge ih-badge--${status === 'new' ? 'error' : status === 'confirmed' ? 'connected' : status === 'cancelled' ? 'disconnected' : 'connected'}`}>
            {status.charAt(0).toUpperCase() + status.slice(1).replace('_', ' ')}
          </span>
        </span>
      </div>

      {/* Pickup time / Dasher */}
      {order.estimatedPickupTime && (
        <div className="ih-order-pickup"><Clock size={12} /> Est. pickup: {fmtDate(order.estimatedPickupTime)}</div>
      )}
      {order.dasherStatus && (
        <div className="ih-order-pickup"><Truck size={12} /> Dasher: {order.dasherStatus}</div>
      )}

      {/* Toggle expand */}
      <button className="ih-order-expand-btn" onClick={() => setExpanded(e => !e)}>
        {expanded ? <><ChevronUp size={13} /> Hide details</> : <><ChevronDown size={13} /> Show details</>}
      </button>

      {/* Expandable items */}
      {expanded && (
        <div className="ih-order-items">
          <table>
            <tbody>
              {(order.items || []).map((item, i) => (
                <tr key={i}>
                  <td>{item.name}</td>
                  <td>x{item.quantity || 1}</td>
                  <td>{fmt$(item.price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="ih-order-totals">
            <span>Subtotal: <strong>{fmt$(order.subtotal)}</strong></span>
            <span>Tax: <strong>{fmt$(order.tax)}</strong></span>
            {order.deliveryFee != null && <span>Delivery: <strong>{fmt$(order.deliveryFee)}</strong></span>}
            {order.tip != null && <span>Tip: <strong>{fmt$(order.tip)}</strong></span>}
            <span>Total: <strong>{fmt$(order.total)}</strong></span>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="ih-order-actions">
        {status === 'new' && (
          <>
            <button className="p-btn p-btn-success p-btn-sm" onClick={handleConfirm} disabled={busy}>
              <CheckCircle2 size={13} /> Confirm
            </button>
            <button className="p-btn p-btn-danger p-btn-sm" onClick={handleCancel} disabled={busy}>
              <XCircle size={13} /> Reject
            </button>
          </>
        )}
        {status === 'confirmed' && (
          <button className="p-btn p-btn-success p-btn-sm" onClick={handleReady} disabled={busy}>
            <CheckCircle2 size={13} /> Mark Ready
          </button>
        )}
        {status === 'ready' && order.dasherStatus && (
          <span className="ih-badge ih-badge--connected"><Truck size={11} /> {order.dasherStatus}</span>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 4: ANALYTICS
// ═══════════════════════════════════════════════════════════════════════════════
function AnalyticsTab({ connectedKeys }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));

  const fetchAnalytics = useCallback(async () => {
    setLoading(true);
    try {
      const d = await getIntegrationAnalytics({ dateFrom, dateTo });
      setData(d);
    } catch {
      setData(null);
    } finally { setLoading(false); }
  }, [dateFrom, dateTo]);

  useEffect(() => { fetchAnalytics(); }, [fetchAnalytics]);

  if (connectedKeys.length === 0) {
    return (
      <div className="p-empty">
        <BarChart3 size={40} strokeWidth={1} />
        <p>Connect a delivery platform to view analytics.</p>
      </div>
    );
  }

  const platformStats = data?.platformStats || {};
  const dailyTrend = data?.dailyTrend || [];
  const topItems = data?.topItems || [];
  const pricingByPlatform = data?.pricingByPlatform || {};  // S71b — current pricing snapshot

  // Build bar chart data from platformStats
  const barData = Object.entries(platformStats).map(([key, stats]) => ({
    name: PLATFORM_META[key]?.name || key,
    Revenue: stats.revenue || 0,
    Orders: stats.orderCount || 0,
  }));

  const handleExportCSV = () => {
    if (!topItems.length) return toast.error('No data to export');
    downloadCSV(topItems, [
      { key: 'name', label: 'Item' },
      { key: 'platform', label: 'Platform' },
      { key: 'quantity', label: 'Qty Sold' },
      { key: 'revenue', label: 'Revenue' },
    ], 'integration-analytics');
  };

  const handleExportPDF = () => {
    if (!topItems.length) return toast.error('No data to export');
    const summary = Object.entries(platformStats).map(([k, s]) =>
      `${PLATFORM_META[k]?.name || k}: ${fmt$(s.revenue)} revenue, ${s.orderCount} orders`
    );
    downloadPDF({
      title: 'Delivery Platform Analytics',
      subtitle: `${dateFrom} to ${dateTo}`,
      summary,
      data: topItems,
      columns: [
        { key: 'name', label: 'Item' },
        { key: 'platform', label: 'Platform' },
        { key: 'quantity', label: 'Qty Sold' },
        { key: 'revenue', label: 'Revenue' },
      ],
      filename: 'integration-analytics',
    });
  };

  return (
    <>
      {/* Header with date range + export */}
      <div className="ih-analytics-header">
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <input className="p-input" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>to</span>
          <input className="p-input" type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="p-btn p-btn-ghost p-btn-sm" onClick={handleExportCSV}><Download size={13} /> CSV</button>
          <button className="p-btn p-btn-ghost p-btn-sm" onClick={handleExportPDF}><Download size={13} /> PDF</button>
        </div>
      </div>

      {loading ? (
        <div className="ih-spinner"><Loader2 size={18} />Loading analytics...</div>
      ) : !data ? (
        <div className="p-empty">
          <BarChart3 size={40} strokeWidth={1} />
          <p>No analytics data available for the selected period.</p>
        </div>
      ) : (
        <>
          {/* Stats row */}
          <div className="p-stat-grid">
            {Object.entries(platformStats).map(([key, stats]) => {
              const m = PLATFORM_META[key] || {};
              return (
                <div className="p-stat-card" key={key} style={{ borderTop: `3px solid ${m.color}` }}>
                  <div className="p-stat-label">{m.name || key}</div>
                  <div className="p-stat-value">{fmt$(stats.revenue)}</div>
                  <div className="p-stat-sub">{stats.orderCount || 0} orders &middot; Avg {fmt$(stats.orderCount ? stats.revenue / stats.orderCount : 0)}</div>
                </div>
              );
            })}
          </div>

          {/* S71b — Pricing snapshot per platform */}
          {Object.keys(pricingByPlatform).length > 0 && (
            <div className="ih-pricing-snapshot">
              <div className="ih-pricing-snapshot-header">
                <strong>Current pricing configuration</strong>
                <span className="ih-pricing-snapshot-hint">What's being pushed to each marketplace right now</span>
              </div>
              <div className="ih-pricing-snapshot-grid">
                {Object.entries(pricingByPlatform).map(([key, pc]) => {
                  const m = PLATFORM_META[key] || {};
                  return (
                    <div key={key} className="ih-pricing-snapshot-card" style={{ borderLeft: `3px solid ${m.color || '#888'}` }}>
                      <div className="ih-pricing-snapshot-name">{m.name || key}</div>
                      <div className="ih-pricing-snapshot-rows">
                        <div className="ih-pricing-snapshot-row">
                          <span>Markup</span>
                          <strong>{Number(pc.markupPercent || 0).toFixed(2)}%{pc.categoryOverrideCount > 0 ? ` (+${pc.categoryOverrideCount} dept)` : ''}</strong>
                        </div>
                        <div className="ih-pricing-snapshot-row">
                          <span>Rounding</span>
                          <strong>{pc.roundingMode || 'none'}</strong>
                        </div>
                        <div className="ih-pricing-snapshot-row">
                          <span>Inventory</span>
                          <strong style={{ color: pc.inventorySyncEnabled ? '#16a34a' : '#dc2626' }}>
                            {pc.inventorySyncEnabled ? `On · ${pc.syncMode}` : 'OFF'}
                          </strong>
                        </div>
                        {(pc.excludedDepartmentCount > 0 || pc.excludedProductCount > 0) && (
                          <div className="ih-pricing-snapshot-row">
                            <span>Excluded</span>
                            <strong>
                              {pc.excludedDepartmentCount > 0 ? `${pc.excludedDepartmentCount} dept` : ''}
                              {pc.excludedDepartmentCount > 0 && pc.excludedProductCount > 0 ? ', ' : ''}
                              {pc.excludedProductCount > 0 ? `${pc.excludedProductCount} prod` : ''}
                            </strong>
                          </div>
                        )}
                        {pc.minMarginPercent > 0 && (
                          <div className="ih-pricing-snapshot-row">
                            <span>Min margin</span>
                            <strong>{pc.minMarginPercent}%</strong>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Charts row */}
          <div className="ih-charts-row">
            {/* Platform comparison bar chart */}
            <div className="ih-chart-card">
              <div className="ih-chart-title">Platform Comparison</div>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={barData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                  <XAxis dataKey="name" tick={{ fontSize: 12, fill: 'var(--text-muted)' }} />
                  <YAxis tick={{ fontSize: 12, fill: 'var(--text-muted)' }} />
                  <Tooltip contentStyle={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="Revenue" fill="var(--accent-primary)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Orders" fill="var(--accent-secondary, #8b5cf6)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Daily trend line chart */}
            <div className="ih-chart-card">
              <div className="ih-chart-title">Daily Trend</div>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={dailyTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                  <XAxis dataKey="date" tick={{ fontSize: 12, fill: 'var(--text-muted)' }} />
                  <YAxis tick={{ fontSize: 12, fill: 'var(--text-muted)' }} />
                  <Tooltip contentStyle={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {connectedKeys.map(key => (
                    <Line
                      key={key}
                      type="monotone"
                      dataKey={key}
                      name={PLATFORM_META[key]?.name || key}
                      stroke={PLATFORM_COLORS[key] || '#888'}
                      strokeWidth={2}
                      dot={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Top items table */}
          {topItems.length > 0 && (
            <div className="ih-chart-card">
              <div className="ih-chart-title">Top Items</div>
              <table className="p-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Item</th>
                    <th>Platform</th>
                    <th>Qty Sold</th>
                    <th>Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {topItems.slice(0, 20).map((item, i) => (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      <td>{item.name}</td>
                      <td>
                        <span className="ih-order-platform">
                          <span className="ih-order-platform-dot" style={{ background: PLATFORM_COLORS[item.platform] || '#888' }} />
                          {PLATFORM_META[item.platform]?.name || item.platform}
                        </span>
                      </td>
                      <td>{item.quantity}</td>
                      <td>{fmt$(item.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}
