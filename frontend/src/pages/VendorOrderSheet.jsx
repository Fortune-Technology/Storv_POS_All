import React, { useState, useEffect, useCallback } from 'react';
import {
  Package, RefreshCw, Download, FileText, ChevronDown, ChevronRight,
  Loader, AlertCircle, Trash2, Send, ClipboardCheck, X, Search,
  CloudSun, PartyPopper, TrendingUp, TrendingDown, AlertTriangle,
  CalendarRange, ShoppingCart, History as HistoryIcon, Lightbulb,
} from 'lucide-react';
import { toast } from 'react-toastify';
import Sidebar from '../components/Sidebar';
import {
  getOrderSuggestions,
  generatePurchaseOrders,
  listPurchaseOrders,
  getPurchaseOrder,
  updatePurchaseOrder,
  submitPurchaseOrder,
  receivePurchaseOrder,
  deletePurchaseOrder,
  getPurchaseOrderPDF,
} from '../services/api';
import { downloadCSV, downloadPDF } from '../utils/exportUtils';
import '../styles/portal.css';

/* ─── Constants ─── */
const TABS = [
  { key: 'suggestions', label: 'Suggestions', icon: Lightbulb },
  { key: 'orders',      label: 'Purchase Orders', icon: ShoppingCart },
  { key: 'history',     label: 'History', icon: HistoryIcon },
];

const URGENCY = {
  critical: { color: '#ef4444', bg: 'rgba(239,68,68,0.10)', label: 'Critical' },
  high:     { color: '#f59e0b', bg: 'rgba(245,158,11,0.10)', label: 'High' },
  medium:   { color: '#eab308', bg: 'rgba(234,179,8,0.10)',  label: 'Medium' },
  low:      { color: '#22c55e', bg: 'rgba(34,197,94,0.10)',  label: 'Low' },
};

const PO_STATUS = {
  draft:     { cls: 'p-badge p-badge-gray',  label: 'Draft' },
  submitted: { cls: 'p-badge p-badge-blue',  label: 'Submitted' },
  partial:   { cls: 'p-badge p-badge-amber', label: 'Partial' },
  received:  { cls: 'p-badge p-badge-green', label: 'Received' },
  cancelled: { cls: 'p-badge p-badge-red',   label: 'Cancelled' },
};

/* ─── Helpers ─── */
const fmtCurrency = (n) =>
  n == null ? '--' : Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const fmtNum = (n, d = 1) =>
  n == null ? '--' : Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtDate = (d) => {
  if (!d) return '--';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

/* ─── Factor Badges ─── */
function FactorBadges({ factors }) {
  if (!factors) return null;
  const badges = [];
  if (factors.weather)
    badges.push(<span key="w" title={`Weather: ${factors.weather}`} style={factorStyle('#3b82f6')}><CloudSun size={11} /></span>);
  if (factors.holiday)
    badges.push(<span key="h" title={`Holiday: ${factors.holiday}`} style={factorStyle('#a855f7')}><PartyPopper size={11} /></span>);
  if (factors.trend === 'up')
    badges.push(<span key="tu" title="Trending up" style={factorStyle('#22c55e')}><TrendingUp size={11} /></span>);
  if (factors.trend === 'down')
    badges.push(<span key="td" title="Trending down" style={factorStyle('#f59e0b')}><TrendingDown size={11} /></span>);
  if (factors.stockout)
    badges.push(<span key="so" title="Stockout risk" style={factorStyle('#ef4444')}><AlertTriangle size={11} /></span>);
  return <span style={{ display: 'inline-flex', gap: 3 }}>{badges}</span>;
}

const factorStyle = (c) => ({
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 20, height: 20, borderRadius: '50%',
  background: c + '18', color: c, cursor: 'help',
});

/* ─── Urgency Dot ─── */
function UrgencyDot({ level }) {
  const u = URGENCY[level] || URGENCY.low;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 'var(--radius-full)',
      background: u.bg, color: u.color,
      fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase',
    }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: u.color }} />
      {u.label}
    </span>
  );
}

/* ─── Spinner ─── */
const Spinner = () => <Loader size={16} className="p-spin" />;

/* ════════════════════════════════════════════════════════════
   MAIN COMPONENT
════════════════════════════════════════════════════════════ */
export default function VendorOrderSheet({ embedded }) {
  const [tab, setTab] = useState('suggestions');

  const content = (
    <div className="p-page">
      {/* Header */}
      <div className="p-header">
        <div className="p-header-left">
          <div className="p-header-icon"><Package size={22} /></div>
          <div>
            <h1 className="p-title">Vendor Order Sheet</h1>
            <p className="p-subtitle">AI-powered reorder suggestions and purchase order management</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="p-tabs">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            className={`p-tab${tab === key ? ' active' : ''}`}
            onClick={() => setTab(key)}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {tab === 'suggestions' && <SuggestionsTab />}
      {tab === 'orders' && <PurchaseOrdersTab />}
      {tab === 'history' && <HistoryTab />}
    </div>
  );

  if (embedded) return content;

  return (
    <div className="layout-container">
      <Sidebar />
      <main className="main-content animate-fade-in">{content}</main>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   TAB 1 — SUGGESTIONS
════════════════════════════════════════════════════════════ */
function SuggestionsTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(null); // null | 'all' | vendorId
  const [expanded, setExpanded] = useState({});

  const fetchSuggestions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getOrderSuggestions();
      setData(res);
      // auto-expand all vendors
      const exp = {};
      (res.vendorGroups || []).forEach((vg) => { exp[vg.vendorId] = true; });
      setExpanded(exp);
    } catch (e) {
      toast.error('Failed to load suggestions: ' + (e.response?.data?.error || e.message));
    } finally {
      setLoading(false);
    }
  }, []);

  const handleCreateAll = async () => {
    setCreating('all');
    try {
      const res = await generatePurchaseOrders({});
      toast.success(`Created ${res.created || res.orders?.length || 0} purchase orders`);
      setData(null);
    } catch (e) {
      toast.error('Failed to create POs: ' + (e.response?.data?.error || e.message));
    } finally {
      setCreating(null);
    }
  };

  const handleCreateVendor = async (vendorId) => {
    setCreating(vendorId);
    try {
      const res = await generatePurchaseOrders({ vendorIds: [vendorId] });
      toast.success(`PO created for vendor`);
      // Remove that vendor group from suggestions
      if (data) {
        setData({
          ...data,
          vendorGroups: data.vendorGroups.filter((vg) => vg.vendorId !== vendorId),
        });
      }
    } catch (e) {
      toast.error('Failed to create PO: ' + (e.response?.data?.error || e.message));
    } finally {
      setCreating(null);
    }
  };

  const toggle = (id) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  const stats = data?.stats || {};
  const groups = data?.vendorGroups || [];

  /* Export helpers */
  const allItems = groups.flatMap((g) =>
    (g.items || []).map((item) => ({ ...item, vendorName: g.vendorName }))
  );

  const exportColumns = [
    { key: 'vendorName', label: 'Vendor' },
    { key: 'name', label: 'Product' },
    { key: 'upc', label: 'UPC' },
    { key: 'department', label: 'Dept' },
    { key: 'onHand', label: 'On Hand' },
    { key: 'daysSupply', label: 'Days Supply' },
    { key: 'avgDaily', label: 'Avg Daily' },
    { key: 'forecast', label: 'Forecast' },
    { key: 'safetyStock', label: 'Safety Stock' },
    { key: 'orderQty', label: 'Order Qty' },
    { key: 'cases', label: 'Cases' },
    { key: 'estCost', label: 'Est Cost' },
  ];

  const handleExportCSV = () => {
    if (!allItems.length) return toast.warn('No data to export');
    downloadCSV(allItems, exportColumns, 'order_suggestions');
  };

  const handleExportPDF = () => {
    if (!allItems.length) return toast.warn('No data to export');
    downloadPDF({
      title: 'Vendor Order Suggestions',
      subtitle: `Generated ${new Date().toLocaleDateString()}`,
      summary: [
        { label: 'Total Products', value: String(stats.totalProducts || 0) },
        { label: 'Needs Reorder', value: String(stats.needsReorder || 0) },
        { label: 'Critical', value: String(stats.critical || 0) },
        { label: 'Estimated Total', value: fmtCurrency(stats.estimatedTotal) },
      ],
      data: allItems,
      columns: exportColumns,
      filename: 'order_suggestions',
    });
  };

  return (
    <>
      {/* Action bar */}
      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
        <button className="p-btn p-btn-primary" onClick={fetchSuggestions} disabled={loading}>
          {loading ? <Spinner /> : <RefreshCw size={15} />} Generate Suggestions
        </button>
        {groups.length > 0 && (
          <>
            <button className="p-btn p-btn-success" onClick={handleCreateAll} disabled={!!creating}>
              {creating === 'all' ? <Spinner /> : <ShoppingCart size={15} />} Create All POs
            </button>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
              <button className="p-btn p-btn-ghost p-btn-sm" onClick={handleExportCSV}>
                <Download size={14} /> CSV
              </button>
              <button className="p-btn p-btn-ghost p-btn-sm" onClick={handleExportPDF}>
                <FileText size={14} /> PDF
              </button>
            </div>
          </>
        )}
      </div>

      {/* Stats bar */}
      {data && (
        <div className="p-stat-grid">
          {[
            { label: 'Total Products', value: stats.totalProducts || 0, color: 'var(--accent-primary)' },
            { label: 'Needs Reorder',  value: stats.needsReorder || 0,  color: '#f59e0b' },
            { label: 'Critical',       value: stats.critical || 0,      color: '#ef4444' },
            { label: 'Estimated Total', value: fmtCurrency(stats.estimatedTotal), color: 'var(--success)' },
          ].map(({ label, value, color }) => (
            <div key={label} className="p-stat-card">
              <div className="p-stat-label">{label}</div>
              <div className="p-stat-value" style={{ color }}>{value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="p-loading" style={{ justifyContent: 'center' }}>
          <Spinner /> Analyzing inventory and generating suggestions...
        </div>
      )}

      {/* Empty state */}
      {!loading && !data && (
        <div className="p-empty">
          <Lightbulb size={40} />
          Click "Generate Suggestions" to analyze inventory levels and get AI-powered reorder recommendations.
        </div>
      )}

      {/* Vendor groups */}
      {!loading && groups.map((vg) => (
        <div key={vg.vendorId} className="p-card" style={{ marginBottom: '0.875rem' }}>
          {/* Vendor header */}
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer',
              padding: '0.25rem 0', flexWrap: 'wrap',
            }}
            onClick={() => toggle(vg.vendorId)}
          >
            {expanded[vg.vendorId] ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>
              {vg.vendorName || 'Unknown Vendor'}
            </span>
            <span className="p-badge p-badge-brand">{vg.items?.length || 0} items</span>
            <span style={{ marginLeft: 'auto', fontWeight: 700, color: 'var(--success)', fontSize: '0.9rem' }}>
              {fmtCurrency(vg.subtotal)}
            </span>
            <button
              className="p-btn p-btn-secondary p-btn-sm"
              onClick={(e) => { e.stopPropagation(); handleCreateVendor(vg.vendorId); }}
              disabled={!!creating}
              style={{ marginLeft: '0.5rem' }}
            >
              {creating === vg.vendorId ? <Spinner /> : <ShoppingCart size={13} />} Create PO
            </button>
          </div>

          {/* Items table */}
          {expanded[vg.vendorId] && (
            <div className="p-table-wrap" style={{ marginTop: '0.75rem' }}>
              <table className="p-table">
                <thead>
                  <tr>
                    <th>Product</th><th>UPC</th><th>Dept</th><th>On Hand</th>
                    <th>Days Supply</th><th>Avg Daily</th><th>Forecast</th>
                    <th>Safety Stock</th><th>Order Qty</th><th>Cases</th>
                    <th>Est Cost</th><th>Urgency</th><th>Factors</th>
                  </tr>
                </thead>
                <tbody>
                  {(vg.items || []).map((item, i) => (
                    <tr key={i}>
                      <td className="p-td-strong" style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.name || item.upc}
                      </td>
                      <td style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: 'var(--text-muted)' }}>{item.upc || '--'}</td>
                      <td>{item.department || '--'}</td>
                      <td style={{ color: item.onHand <= 0 ? 'var(--error)' : 'var(--text-secondary)', fontWeight: 600 }}>
                        {item.onHand ?? '--'}
                      </td>
                      <td>{fmtNum(item.daysSupply, 0)}</td>
                      <td>{fmtNum(item.avgDaily)}</td>
                      <td>{fmtNum(item.forecast, 0)}</td>
                      <td>{fmtNum(item.safetyStock, 0)}</td>
                      <td style={{ fontWeight: 700, color: 'var(--accent-primary)' }}>{item.orderQty ?? '--'}</td>
                      <td>{item.cases ?? '--'}</td>
                      <td style={{ fontWeight: 600 }}>{fmtCurrency(item.estCost)}</td>
                      <td><UrgencyDot level={item.urgency} /></td>
                      <td><FactorBadges factors={item.factors} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </>
  );
}

/* ════════════════════════════════════════════════════════════
   TAB 2 — PURCHASE ORDERS
════════════════════════════════════════════════════════════ */
function PurchaseOrdersTab() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedPO, setSelectedPO] = useState(null);
  const [poDetail, setPODetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [receiveQtys, setReceiveQtys] = useState({});
  const [editQtys, setEditQtys] = useState({});
  const [saving, setSaving] = useState(false);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listPurchaseOrders();
      setOrders((res.orders || []).filter((o) => o.status !== 'received' && o.status !== 'cancelled'));
    } catch (e) {
      toast.error('Failed to load purchase orders: ' + (e.response?.data?.error || e.message));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  const openDetail = async (po) => {
    setSelectedPO(po);
    setReceiving(false);
    setDetailLoading(true);
    try {
      const detail = await getPurchaseOrder(po._id || po.id);
      setPODetail(detail);
      // init edit quantities
      const eq = {};
      (detail.items || []).forEach((item, i) => { eq[i] = item.qtyOrdered; });
      setEditQtys(eq);
    } catch (e) {
      toast.error('Failed to load PO details');
      setSelectedPO(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetail = () => {
    setSelectedPO(null);
    setPODetail(null);
    setReceiving(false);
  };

  const handleSubmitPO = async () => {
    const id = poDetail._id || poDetail.id;
    try {
      await submitPurchaseOrder(id);
      toast.success('Purchase order submitted');
      closeDetail();
      fetchOrders();
    } catch (e) {
      toast.error('Failed to submit PO: ' + (e.response?.data?.error || e.message));
    }
  };

  const handleDeletePO = async () => {
    const id = poDetail._id || poDetail.id;
    try {
      await deletePurchaseOrder(id);
      toast.success('Purchase order deleted');
      closeDetail();
      fetchOrders();
    } catch (e) {
      toast.error('Failed to delete PO: ' + (e.response?.data?.error || e.message));
    }
  };

  const handleSaveEdits = async () => {
    const id = poDetail._id || poDetail.id;
    setSaving(true);
    try {
      const items = poDetail.items.map((item, i) => ({
        ...item,
        qtyOrdered: Number(editQtys[i]) || item.qtyOrdered,
      }));
      await updatePurchaseOrder(id, { items });
      toast.success('PO updated');
      openDetail(poDetail);
    } catch (e) {
      toast.error('Failed to update PO: ' + (e.response?.data?.error || e.message));
    } finally {
      setSaving(false);
    }
  };

  const startReceive = () => {
    setReceiving(true);
    const rq = {};
    (poDetail.items || []).forEach((item, i) => { rq[i] = item.qtyOrdered; });
    setReceiveQtys(rq);
  };

  const handleReceive = async () => {
    const id = poDetail._id || poDetail.id;
    setSaving(true);
    try {
      const items = poDetail.items.map((item, i) => ({
        ...item,
        qtyReceived: Number(receiveQtys[i]) || 0,
      }));
      await receivePurchaseOrder(id, { items });
      toast.success('Items received successfully');
      closeDetail();
      fetchOrders();
    } catch (e) {
      toast.error('Failed to receive PO: ' + (e.response?.data?.error || e.message));
    } finally {
      setSaving(false);
    }
  };

  const handleDownloadPDF = async () => {
    const id = poDetail._id || poDetail.id;
    try {
      const res = await getPurchaseOrderPDF(id);
      const blob = new Blob([res.data], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `PO-${poDetail.poNumber || id}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error('Failed to download PDF');
    }
  };

  return (
    <>
      <div style={{ display: 'flex', gap: '0.6rem', marginBottom: '1.25rem' }}>
        <button className="p-btn p-btn-ghost" onClick={fetchOrders} disabled={loading}>
          <RefreshCw size={15} /> Refresh
        </button>
      </div>

      {loading && (
        <div className="p-loading" style={{ justifyContent: 'center' }}>
          <Spinner /> Loading purchase orders...
        </div>
      )}

      {!loading && orders.length === 0 && (
        <div className="p-empty">
          <ShoppingCart size={40} />
          No active purchase orders. Generate suggestions and create POs from the Suggestions tab.
        </div>
      )}

      {!loading && orders.length > 0 && (
        <div className="p-card">
          <div className="p-table-wrap">
            <table className="p-table">
              <thead>
                <tr>
                  <th>PO #</th><th>Vendor</th><th>Date</th><th>Expected</th>
                  <th>Items</th><th>Total</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((po) => {
                  const st = PO_STATUS[po.status] || PO_STATUS.draft;
                  return (
                    <tr key={po._id || po.id} onClick={() => openDetail(po)} style={{ cursor: 'pointer' }}>
                      <td className="p-td-strong">{po.poNumber || '--'}</td>
                      <td>{po.vendorName || '--'}</td>
                      <td>{fmtDate(po.createdAt || po.date)}</td>
                      <td>{fmtDate(po.expectedDate)}</td>
                      <td>{po.itemCount ?? po.items?.length ?? '--'}</td>
                      <td style={{ fontWeight: 700 }}>{fmtCurrency(po.total)}</td>
                      <td><span className={st.cls}>{st.label}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── PO Detail Modal ── */}
      {selectedPO && (
        <div className="p-modal-overlay" onClick={closeDetail}>
          <div className="p-modal p-modal-lg" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 800 }}>
            <div className="p-modal-header">
              <h2 className="p-modal-title">
                PO {poDetail?.poNumber || '...'} — {poDetail?.vendorName || ''}
              </h2>
              <button className="p-modal-close" onClick={closeDetail}><X size={18} /></button>
            </div>

            {detailLoading && (
              <div className="p-loading" style={{ justifyContent: 'center', padding: '2rem 0' }}>
                <Spinner /> Loading details...
              </div>
            )}

            {poDetail && !detailLoading && (
              <>
                {/* Summary row */}
                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                  <span>Status: <span className={(PO_STATUS[poDetail.status] || PO_STATUS.draft).cls}>{(PO_STATUS[poDetail.status] || PO_STATUS.draft).label}</span></span>
                  <span>Created: {fmtDate(poDetail.createdAt || poDetail.date)}</span>
                  <span>Expected: {fmtDate(poDetail.expectedDate)}</span>
                  <span style={{ fontWeight: 700 }}>Total: {fmtCurrency(poDetail.total)}</span>
                </div>

                {/* Line items */}
                <div className="p-table-wrap" style={{ maxHeight: 360, overflowY: 'auto' }}>
                  <table className="p-table">
                    <thead>
                      <tr>
                        <th>Product</th><th>Qty Ordered</th><th>Qty Received</th>
                        <th>Unit Cost</th><th>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(poDetail.items || []).map((item, i) => (
                        <tr key={i}>
                          <td className="p-td-strong">{item.name || item.productName || item.upc || '--'}</td>
                          <td>
                            {poDetail.status === 'draft' && !receiving ? (
                              <input
                                type="number"
                                className="p-input"
                                style={{ width: 70, padding: '0.3rem 0.5rem', fontSize: '0.82rem' }}
                                value={editQtys[i] ?? item.qtyOrdered}
                                onChange={(e) => setEditQtys((prev) => ({ ...prev, [i]: e.target.value }))}
                                min={0}
                              />
                            ) : (
                              item.qtyOrdered ?? '--'
                            )}
                          </td>
                          <td>
                            {receiving ? (
                              <input
                                type="number"
                                className="p-input"
                                style={{ width: 70, padding: '0.3rem 0.5rem', fontSize: '0.82rem' }}
                                value={receiveQtys[i] ?? 0}
                                onChange={(e) => setReceiveQtys((prev) => ({ ...prev, [i]: e.target.value }))}
                                min={0}
                              />
                            ) : (
                              item.qtyReceived ?? '--'
                            )}
                          </td>
                          <td>{fmtCurrency(item.unitCost)}</td>
                          <td style={{ fontWeight: 600 }}>{fmtCurrency(item.total || (item.qtyOrdered * item.unitCost))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Actions */}
                <div className="p-form-actions" style={{ flexWrap: 'wrap' }}>
                  {poDetail.status === 'draft' && !receiving && (
                    <>
                      <button className="p-btn p-btn-secondary p-btn-sm" onClick={handleSaveEdits} disabled={saving}>
                        {saving ? <Spinner /> : null} Save Changes
                      </button>
                      <button className="p-btn p-btn-primary p-btn-sm" onClick={handleSubmitPO}>
                        <Send size={13} /> Submit
                      </button>
                      <button className="p-btn p-btn-danger p-btn-sm" onClick={handleDeletePO}>
                        <Trash2 size={13} /> Delete
                      </button>
                    </>
                  )}
                  {(poDetail.status === 'submitted' || poDetail.status === 'partial') && !receiving && (
                    <button className="p-btn p-btn-success p-btn-sm" onClick={startReceive}>
                      <ClipboardCheck size={13} /> Receive Items
                    </button>
                  )}
                  {receiving && (
                    <>
                      <button className="p-btn p-btn-ghost p-btn-sm" onClick={() => setReceiving(false)}>Cancel</button>
                      <button className="p-btn p-btn-success p-btn-sm" onClick={handleReceive} disabled={saving}>
                        {saving ? <Spinner /> : <ClipboardCheck size={13} />} Confirm Receipt
                      </button>
                    </>
                  )}
                  <button className="p-btn p-btn-ghost p-btn-sm" onClick={handleDownloadPDF}>
                    <Download size={13} /> Download PDF
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/* ════════════════════════════════════════════════════════════
   TAB 3 — HISTORY
════════════════════════════════════════════════════════════ */
function HistoryTab() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedPO, setSelectedPO] = useState(null);
  const [poDetail, setPODetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listPurchaseOrders({ status: 'received,cancelled' });
      let list = res.orders || [];
      // client-side date filter
      if (dateFrom) list = list.filter((o) => new Date(o.createdAt || o.date) >= new Date(dateFrom));
      if (dateTo) {
        const to = new Date(dateTo);
        to.setDate(to.getDate() + 1);
        list = list.filter((o) => new Date(o.createdAt || o.date) < to);
      }
      setOrders(list);
    } catch (e) {
      toast.error('Failed to load history: ' + (e.response?.data?.error || e.message));
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo]);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  const openDetail = async (po) => {
    setSelectedPO(po);
    setDetailLoading(true);
    try {
      const detail = await getPurchaseOrder(po._id || po.id);
      setPODetail(detail);
    } catch (e) {
      toast.error('Failed to load PO details');
      setSelectedPO(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetail = () => { setSelectedPO(null); setPODetail(null); };

  return (
    <>
      {/* Filters */}
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
        <div className="p-field" style={{ marginBottom: 0, minWidth: 140 }}>
          <label className="p-field-label">From</label>
          <input type="date" className="p-input" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </div>
        <div className="p-field" style={{ marginBottom: 0, minWidth: 140 }}>
          <label className="p-field-label">To</label>
          <input type="date" className="p-input" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </div>
        <button className="p-btn p-btn-ghost" onClick={fetchHistory} disabled={loading}>
          <Search size={15} /> Filter
        </button>
      </div>

      {loading && (
        <div className="p-loading" style={{ justifyContent: 'center' }}>
          <Spinner /> Loading history...
        </div>
      )}

      {!loading && orders.length === 0 && (
        <div className="p-empty">
          <HistoryIcon size={40} />
          No completed or cancelled purchase orders found for the selected date range.
        </div>
      )}

      {!loading && orders.length > 0 && (
        <div className="p-card">
          <div className="p-table-wrap">
            <table className="p-table">
              <thead>
                <tr>
                  <th>PO #</th><th>Vendor</th><th>Date</th><th>Items</th>
                  <th>Total</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((po) => {
                  const st = PO_STATUS[po.status] || PO_STATUS.draft;
                  return (
                    <tr key={po._id || po.id} onClick={() => openDetail(po)} style={{ cursor: 'pointer' }}>
                      <td className="p-td-strong">{po.poNumber || '--'}</td>
                      <td>{po.vendorName || '--'}</td>
                      <td>{fmtDate(po.createdAt || po.date)}</td>
                      <td>{po.itemCount ?? po.items?.length ?? '--'}</td>
                      <td style={{ fontWeight: 700 }}>{fmtCurrency(po.total)}</td>
                      <td><span className={st.cls}>{st.label}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Read-only detail modal */}
      {selectedPO && (
        <div className="p-modal-overlay" onClick={closeDetail}>
          <div className="p-modal p-modal-lg" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 700 }}>
            <div className="p-modal-header">
              <h2 className="p-modal-title">
                PO {poDetail?.poNumber || '...'} — {poDetail?.vendorName || ''}
              </h2>
              <button className="p-modal-close" onClick={closeDetail}><X size={18} /></button>
            </div>

            {detailLoading && (
              <div className="p-loading" style={{ justifyContent: 'center', padding: '2rem 0' }}>
                <Spinner /> Loading details...
              </div>
            )}

            {poDetail && !detailLoading && (
              <>
                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                  <span>Status: <span className={(PO_STATUS[poDetail.status] || PO_STATUS.draft).cls}>{(PO_STATUS[poDetail.status] || PO_STATUS.draft).label}</span></span>
                  <span>Created: {fmtDate(poDetail.createdAt || poDetail.date)}</span>
                  <span style={{ fontWeight: 700 }}>Total: {fmtCurrency(poDetail.total)}</span>
                </div>

                <div className="p-table-wrap" style={{ maxHeight: 360, overflowY: 'auto' }}>
                  <table className="p-table">
                    <thead>
                      <tr>
                        <th>Product</th><th>Qty Ordered</th><th>Qty Received</th>
                        <th>Unit Cost</th><th>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(poDetail.items || []).map((item, i) => (
                        <tr key={i}>
                          <td className="p-td-strong">{item.name || item.productName || item.upc || '--'}</td>
                          <td>{item.qtyOrdered ?? '--'}</td>
                          <td>{item.qtyReceived ?? '--'}</td>
                          <td>{fmtCurrency(item.unitCost)}</td>
                          <td style={{ fontWeight: 600 }}>{fmtCurrency(item.total || (item.qtyOrdered * item.unitCost))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
