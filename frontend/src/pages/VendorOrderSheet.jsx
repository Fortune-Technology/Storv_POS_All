import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Package, RefreshCw, Download, FileText, ChevronDown, ChevronRight,
  Loader, AlertCircle, Trash2, Send, ClipboardCheck, X, Search,
  CloudSun, PartyPopper, TrendingUp, TrendingDown, AlertTriangle,
  CalendarRange, ShoppingCart, History as HistoryIcon, Lightbulb,
  CheckCircle2, XCircle, Mail, RotateCcw, BarChart2, DollarSign,
  Plus, ArrowLeftRight, Award,
} from 'lucide-react';
import { toast } from 'react-toastify';
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
  approvePurchaseOrder,
  rejectPurchaseOrder,
  getCostVariance,
  getVendorPerformance,
  createManualPO,
  searchCatalogProducts,
  listVendorReturns,
  createVendorReturn,
  submitVendorReturn,
  recordVendorCredit,
  deleteVendorReturn,
} from '../services/api';
import { downloadCSV, downloadPDF } from '../utils/exportUtils';
import './VendorOrderSheet.css';
import '../styles/portal.css';

/* ─── Constants ─── */
const TABS = [
  { key: 'suggestions', label: 'Suggestions', icon: Lightbulb },
  { key: 'orders',      label: 'Purchase Orders', icon: ShoppingCart },
  { key: 'returns',     label: 'Returns', icon: RotateCcw },
  { key: 'analytics',   label: 'Analytics', icon: BarChart2 },
  { key: 'history',     label: 'History', icon: HistoryIcon },
];

const URGENCY = {
  critical: { color: '#ef4444', bg: 'rgba(239,68,68,0.10)', label: 'Critical' },
  high:     { color: '#f59e0b', bg: 'rgba(245,158,11,0.10)', label: 'High' },
  medium:   { color: '#eab308', bg: 'rgba(234,179,8,0.10)',  label: 'Medium' },
  low:      { color: '#22c55e', bg: 'rgba(34,197,94,0.10)',  label: 'Low' },
};

const PO_STATUS = {
  draft:            { cls: 'p-badge p-badge-gray',   label: 'Draft' },
  pending_approval: { cls: 'p-badge p-badge-amber',  label: 'Pending Approval' },
  approved:         { cls: 'p-badge p-badge-blue',   label: 'Approved' },
  submitted:        { cls: 'p-badge p-badge-blue',   label: 'Submitted' },
  partial:          { cls: 'p-badge p-badge-amber',  label: 'Partial' },
  received:         { cls: 'p-badge p-badge-green',  label: 'Received' },
  cancelled:        { cls: 'p-badge p-badge-red',    label: 'Cancelled' },
};

const RETURN_STATUS = {
  draft:     { cls: 'p-badge p-badge-gray',   label: 'Draft' },
  submitted: { cls: 'p-badge p-badge-blue',   label: 'Submitted' },
  credited:  { cls: 'p-badge p-badge-green',  label: 'Credited' },
  closed:    { cls: 'p-badge p-badge-gray',   label: 'Closed' },
};

const GRADE_COLORS = {
  A: '#22c55e', B: '#84cc16', C: '#eab308', D: '#f59e0b', F: '#ef4444', 'N/A': '#6b7280',
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
    badges.push(<span key="w" title={`Weather: ${factors.weather}`} className="vos-factor-badge" style={factorStyle('#3b82f6')}><CloudSun size={11} /></span>);
  if (factors.holiday)
    badges.push(<span key="h" title={`Holiday: ${factors.holiday}`} className="vos-factor-badge" style={factorStyle('#a855f7')}><PartyPopper size={11} /></span>);
  if (factors.trend === 'up')
    badges.push(<span key="tu" title="Trending up" className="vos-factor-badge" style={factorStyle('#22c55e')}><TrendingUp size={11} /></span>);
  if (factors.trend === 'down')
    badges.push(<span key="td" title="Trending down" className="vos-factor-badge" style={factorStyle('#f59e0b')}><TrendingDown size={11} /></span>);
  if (factors.stockout)
    badges.push(<span key="so" title="Stockout risk" className="vos-factor-badge" style={factorStyle('#ef4444')}><AlertTriangle size={11} /></span>);
  return <span className="vos-factor-badges">{badges}</span>;
}

const factorStyle = (c) => ({
  background: c + '18', color: c,
});

/* ─── Urgency Dot ─── */
function UrgencyDot({ level }) {
  const u = URGENCY[level] || URGENCY.low;
  return (
    <span className="vos-urgency" style={{ background: u.bg, color: u.color }}>
      <span className="vos-urgency-dot" style={{ background: u.color }} />
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
      {tab === 'returns' && <ReturnsTab />}
      {tab === 'analytics' && <AnalyticsTab />}
      {tab === 'history' && <HistoryTab />}
    </div>
  );

  if (embedded) return content;

  return content;
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
      <div className="vos-action-bar">
        <button className="p-btn p-btn-primary" onClick={fetchSuggestions} disabled={loading}>
          {loading ? <Spinner /> : <RefreshCw size={15} />} Generate Suggestions
        </button>
        {groups.length > 0 && (
          <>
            <button className="p-btn p-btn-success" onClick={handleCreateAll} disabled={!!creating}>
              {creating === 'all' ? <Spinner /> : <ShoppingCart size={15} />} Create All POs
            </button>
            <div className="vos-export-btns">
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
          <div className="vos-vendor-header" onClick={() => toggle(vg.vendorId)}>
            {expanded[vg.vendorId] ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            <span className="vos-vendor-name">
              {vg.vendorName || 'Unknown Vendor'}
            </span>
            <span className="p-badge p-badge-brand">{vg.items?.length || 0} items</span>
            {/* Delivery schedule context */}
            {vg.nextDeliveryDate && (
              <span style={{ fontSize: '0.68rem', color: vg.pastCutoff ? 'var(--error)' : 'var(--text-muted)', marginLeft: 4 }}>
                {vg.pastCutoff ? '⚠ Past cutoff' : `Deliver: ${new Date(vg.nextDeliveryDate + 'T12:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}`}
                {!vg.pastCutoff && vg.orderByDate && (
                  <span style={{ marginLeft: 6, color: 'var(--text-muted)' }}>
                    · Order by {new Date(vg.orderByDate + 'T12:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                  </span>
                )}
              </span>
            )}
            {vg.autoOrderEnabled && (
              <span className="p-badge p-badge-green" style={{ fontSize: '0.58rem', marginLeft: 4 }}>AUTO</span>
            )}
            <span className="vos-vendor-subtotal">
              {fmtCurrency(vg.subtotal)}
            </span>
            <button
              className="p-btn p-btn-secondary p-btn-sm"
              onClick={(e) => { e.stopPropagation(); handleCreateVendor(vg.vendorId); }}
              disabled={!!creating}
            >
              {creating === vg.vendorId ? <Spinner /> : <ShoppingCart size={13} />} Create PO
            </button>
          </div>

          {/* Items table */}
          {expanded[vg.vendorId] && (
            <div className="p-table-wrap vos-table-items">
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
                      <td className="p-td-strong vos-td-product">
                        {item.name || item.upc}
                      </td>
                      <td className="vos-td-upc">{item.upc || '--'}</td>
                      <td>{item.department || '--'}</td>
                      <td className={item.onHand <= 0 ? 'vos-td-onhand-zero' : 'vos-td-onhand'}>
                        {item.onHand ?? '--'}
                      </td>
                      <td>{fmtNum(item.daysSupply, 0)}</td>
                      <td>{fmtNum(item.avgDaily)}</td>
                      <td>{fmtNum(item.forecast, 0)}</td>
                      <td>{fmtNum(item.safetyStock, 0)}</td>
                      <td className="vos-td-order-qty">{item.orderQty ?? '--'}</td>
                      <td>{item.cases ?? '--'}</td>
                      <td className="vos-td-cost">{fmtCurrency(item.estCost)}</td>
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
  const [showManualPO, setShowManualPO] = useState(false);

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
    (poDetail.items || []).forEach((item, i) => {
      rq[i] = { qty: item.qtyOrdered, damaged: 0, actualCost: '' };
    });
    setReceiveQtys(rq);
  };

  const handleReceive = async () => {
    const id = poDetail._id || poDetail.id;
    setSaving(true);
    try {
      const items = poDetail.items.map((item, i) => ({
        id: item.id || item._id,
        qtyReceived:    Number(receiveQtys[i]?.qty) || 0,
        qtyDamaged:     Number(receiveQtys[i]?.damaged) || 0,
        actualUnitCost: receiveQtys[i]?.actualCost ? parseFloat(receiveQtys[i].actualCost) : undefined,
      }));
      const res = await receivePurchaseOrder(id, { items });
      const variance = res.totalVariance ? ` (cost variance: ${fmtCurrency(res.totalVariance)})` : '';
      toast.success(`Items received successfully${variance}`);
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
      <div className="vos-orders-actions">
        <button className="p-btn p-btn-ghost" onClick={fetchOrders} disabled={loading}>
          <RefreshCw size={15} /> Refresh
        </button>
        <button className="p-btn p-btn-primary p-btn-sm" onClick={() => setShowManualPO(true)}>
          <Plus size={13} /> Create Manual PO
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
                <div className="vos-po-summary">
                  <span>Status: <span className={(PO_STATUS[poDetail.status] || PO_STATUS.draft).cls}>{(PO_STATUS[poDetail.status] || PO_STATUS.draft).label}</span></span>
                  <span>Created: {fmtDate(poDetail.createdAt || poDetail.date)}</span>
                  <span>Expected: {fmtDate(poDetail.expectedDate)}</span>
                  <span className="vos-po-total">Total: {fmtCurrency(poDetail.total)}</span>
                </div>

                {/* Approval info */}
                {poDetail.approvedAt && (
                  <div style={{ padding: '0.5rem 1rem', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    Approved {fmtDate(poDetail.approvedAt)}{poDetail.approvalNotes ? ` — ${poDetail.approvalNotes}` : ''}
                  </div>
                )}

                {/* Variance summary */}
                {Number(poDetail.totalVariance) > 0 && (
                  <div style={{ padding: '0.5rem 1rem', fontSize: '0.75rem', color: '#f59e0b', background: 'rgba(245,158,11,0.06)', borderRadius: 6, margin: '0 1rem 0.5rem' }}>
                    <DollarSign size={12} style={{ verticalAlign: -2 }} /> Cost variance: {fmtCurrency(poDetail.totalVariance)}
                  </div>
                )}

                {/* Line items */}
                <div className="p-table-wrap vos-po-items">
                  <table className="p-table">
                    <thead>
                      <tr>
                        <th>Product</th><th>Qty Ordered</th>
                        <th>{receiving ? 'Received' : 'Qty Received'}</th>
                        {receiving && <th>Damaged</th>}
                        <th>Unit Cost</th>
                        {receiving && <th>Invoice Cost</th>}
                        <th>Total</th>
                        {!receiving && poDetail.status === 'received' && <th>Variance</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {(poDetail.items || []).map((item, i) => {
                        const hasVariance = item.varianceFlag && item.varianceFlag !== 'none';
                        return (
                          <tr key={i} style={hasVariance ? { background: item.varianceFlag === 'major' ? 'rgba(239,68,68,0.05)' : 'rgba(245,158,11,0.05)' } : undefined}>
                            <td className="p-td-strong">
                              {item.name || item.productName || item.upc || '--'}
                              {item.backorderQty > 0 && (
                                <span className="p-badge p-badge-amber" style={{ fontSize: '0.55rem', marginLeft: 6 }}>
                                  BO: {item.backorderQty}
                                </span>
                              )}
                            </td>
                            <td>
                              {poDetail.status === 'draft' && !receiving ? (
                                <input type="number" className="p-input p-input-sm"
                                  value={editQtys[i] ?? item.qtyOrdered}
                                  onChange={(e) => setEditQtys((prev) => ({ ...prev, [i]: e.target.value }))}
                                  min={0} />
                              ) : item.qtyOrdered ?? '--'}
                            </td>
                            <td>
                              {receiving ? (
                                <input type="number" className="p-input"
                                  style={{ width: 65, padding: '0.3rem 0.4rem', fontSize: '0.82rem' }}
                                  value={receiveQtys[i]?.qty ?? 0}
                                  onChange={(e) => setReceiveQtys((prev) => ({ ...prev, [i]: { ...(prev[i] || {}), qty: e.target.value } }))}
                                  min={0} />
                              ) : item.qtyReceived ?? '--'}
                            </td>
                            {receiving && (
                              <td>
                                <input type="number" className="p-input"
                                  style={{ width: 55, padding: '0.3rem 0.4rem', fontSize: '0.82rem' }}
                                  value={receiveQtys[i]?.damaged ?? 0}
                                  onChange={(e) => setReceiveQtys((prev) => ({ ...prev, [i]: { ...(prev[i] || {}), damaged: e.target.value } }))}
                                  min={0} placeholder="0" />
                              </td>
                            )}
                            <td>{fmtCurrency(item.unitCost)}</td>
                            {receiving && (
                              <td>
                                <input type="number" className="p-input"
                                  style={{ width: 80, padding: '0.3rem 0.4rem', fontSize: '0.82rem' }}
                                  value={receiveQtys[i]?.actualCost ?? ''}
                                  onChange={(e) => setReceiveQtys((prev) => ({ ...prev, [i]: { ...(prev[i] || {}), actualCost: e.target.value } }))}
                                  step="0.01" placeholder={Number(item.unitCost).toFixed(2)} />
                              </td>
                            )}
                            <td className="vos-td-cost">{fmtCurrency(item.total || (item.qtyOrdered * item.unitCost))}</td>
                            {!receiving && poDetail.status === 'received' && (
                              <td>
                                {hasVariance ? (
                                  <span style={{ color: item.varianceFlag === 'major' ? '#ef4444' : '#f59e0b', fontWeight: 700, fontSize: '0.78rem' }}>
                                    {Number(item.costVariance) > 0 ? '+' : ''}{fmtCurrency(item.costVariance)}
                                  </span>
                                ) : <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>—</span>}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Actions */}
                <div className="p-form-actions vos-po-actions">
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
                  {poDetail.status === 'pending_approval' && !receiving && (
                    <>
                      <button className="p-btn p-btn-success p-btn-sm" onClick={async () => {
                        try { await approvePurchaseOrder(poDetail.id || poDetail._id); toast.success('PO approved'); openDetail(poDetail); fetchOrders(); } catch { toast.error('Approval failed'); }
                      }}>
                        <CheckCircle2 size={13} /> Approve
                      </button>
                      <button className="p-btn p-btn-danger p-btn-sm" onClick={async () => {
                        const reason = prompt('Rejection reason:');
                        if (!reason) return;
                        try { await rejectPurchaseOrder(poDetail.id || poDetail._id, { reason }); toast.success('PO rejected'); openDetail(poDetail); fetchOrders(); } catch { toast.error('Rejection failed'); }
                      }}>
                        <XCircle size={13} /> Reject
                      </button>
                    </>
                  )}
                  {(poDetail.status === 'submitted' || poDetail.status === 'partial' || poDetail.status === 'approved') && !receiving && (
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
                    <Download size={13} /> PDF
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Manual PO Modal ── */}
      {showManualPO && <ManualPOModal onClose={() => setShowManualPO(false)} onCreated={() => { setShowManualPO(false); fetchOrders(); }} />}
    </>
  );
}

/* ── Manual PO Creation Modal ── */
function ManualPOModal({ onClose, onCreated }) {
  const [vendorId, setVendorId]       = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [notes, setNotes]             = useState('');
  const [items, setItems]             = useState([{ masterProductId: '', qty: 1, unitCost: '', caseCost: '' }]);
  const [saving, setSaving]           = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchingFor, setSearchingFor]   = useState(null); // item index
  const searchTimer = useRef(null);

  const addItem = () => setItems(p => [...p, { masterProductId: '', qty: 1, unitCost: '', caseCost: '', productName: '' }]);
  const updateItem = (idx, field, val) => setItems(p => p.map((it, i) => i === idx ? { ...it, [field]: val } : it));
  const removeItem = (idx) => setItems(p => p.filter((_, i) => i !== idx));

  const handleProductSearch = (q, idx) => {
    setProductSearch(q);
    setSearchingFor(idx);
    clearTimeout(searchTimer.current);
    if (!q.trim()) { setSearchResults([]); return; }
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await searchCatalogProducts({ q: q.trim() });
        setSearchResults((res.data || res.products || res).slice(0, 6));
      } catch { setSearchResults([]); }
    }, 300);
  };

  const selectProduct = (product, idx) => {
    updateItem(idx, 'masterProductId', product.id);
    updateItem(idx, 'productName', product.name);
    updateItem(idx, 'unitCost', product.defaultCostPrice ? Number(product.defaultCostPrice).toFixed(2) : '');
    setSearchResults([]);
    setProductSearch('');
    setSearchingFor(null);
  };

  const handleSave = async () => {
    if (!vendorId) { toast.error('Vendor ID required'); return; }
    const validItems = items.filter(i => i.masterProductId && i.qty);
    if (validItems.length === 0) { toast.error('Add at least one item'); return; }
    setSaving(true);
    try {
      await createManualPO({
        vendorId: parseInt(vendorId),
        items: validItems.map(i => ({
          masterProductId: parseInt(i.masterProductId),
          qty: parseInt(i.qty) || 1,
          unitCost: parseFloat(i.unitCost) || 0,
          caseCost: parseFloat(i.caseCost) || 0,
        })),
        expectedDate: expectedDate || null,
        notes: notes || null,
      });
      toast.success('Manual PO created');
      onCreated();
    } catch (e) { toast.error(e.response?.data?.error || 'Failed to create PO'); }
    finally { setSaving(false); }
  };

  return (
    <div className="p-modal-overlay" onClick={onClose}>
      <div className="p-modal p-modal-lg" onClick={e => e.stopPropagation()} style={{ maxWidth: 750 }}>
        <div className="p-modal-header">
          <h2 className="p-modal-title">Create Manual Purchase Order</h2>
          <button className="p-modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: '70vh', overflowY: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <div>
              <label className="p-field-label">Vendor ID</label>
              <input className="p-input" type="number" value={vendorId} onChange={e => setVendorId(e.target.value)} placeholder="Vendor ID" />
            </div>
            <div>
              <label className="p-field-label">Expected Delivery</label>
              <input className="p-input" type="date" value={expectedDate} onChange={e => setExpectedDate(e.target.value)} />
            </div>
            <div>
              <label className="p-field-label">Notes</label>
              <input className="p-input" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes..." />
            </div>
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <label className="p-field-label" style={{ margin: 0 }}>Order Items</label>
              <button className="p-btn p-btn-ghost p-btn-xs" onClick={addItem}><Plus size={11} /> Add Item</button>
            </div>
            {items.map((item, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '3fr 1fr 1fr auto', gap: 6, marginBottom: 6, alignItems: 'start' }}>
                <div style={{ position: 'relative' }}>
                  {item.productName ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0.45rem 0.65rem', background: 'var(--bg-tertiary)', borderRadius: 6, border: '1px solid var(--border-color)', fontSize: '0.82rem' }}>
                      <span style={{ fontWeight: 600, flex: 1 }}>{item.productName}</span>
                      <button onClick={() => { updateItem(i, 'masterProductId', ''); updateItem(i, 'productName', ''); }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0, display: 'flex' }}><X size={12} /></button>
                    </div>
                  ) : (
                    <>
                      <input className="p-input p-input-sm" value={searchingFor === i ? productSearch : ''}
                        onChange={e => handleProductSearch(e.target.value, i)}
                        onFocus={() => setSearchingFor(i)} placeholder="Search product..." />
                      {searchingFor === i && searchResults.length > 0 && (
                        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 6, maxHeight: 180, overflowY: 'auto', marginTop: 2 }}>
                          {searchResults.map(p => (
                            <button key={p.id} onClick={() => selectProduct(p, i)}
                              style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', borderBottom: '1px solid var(--border-color)', padding: '0.4rem 0.6rem', cursor: 'pointer', color: 'var(--text-primary)', fontSize: '0.78rem' }}>
                              <div style={{ fontWeight: 600 }}>{p.name}</div>
                              <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{p.upc || ''}</div>
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
                <input className="p-input p-input-sm" type="number" value={item.qty} onChange={e => updateItem(i, 'qty', e.target.value)} placeholder="Qty" min={1} />
                <input className="p-input p-input-sm" type="number" value={item.unitCost} onChange={e => updateItem(i, 'unitCost', e.target.value)} placeholder="Unit $" step="0.01" />
                {items.length > 1 && (
                  <button className="p-btn p-btn-ghost p-btn-xs" onClick={() => removeItem(i)} style={{ marginTop: 4 }}><Trash2 size={11} /></button>
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="p-form-actions" style={{ padding: '0.75rem 1rem', borderTop: '1px solid var(--border-color)' }}>
          <button className="p-btn p-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="p-btn p-btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? <Spinner /> : <ShoppingCart size={13} />} Create PO
          </button>
        </div>
      </div>
    </div>
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
      <div className="vos-history-filters">
        <div className="p-field">
          <label className="p-field-label">From</label>
          <input type="date" className="p-input" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </div>
        <div className="p-field">
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
          <div className="p-modal p-modal-lg" onClick={(e) => e.stopPropagation()}>
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
                <div className="vos-po-summary">
                  <span>Status: <span className={(PO_STATUS[poDetail.status] || PO_STATUS.draft).cls}>{(PO_STATUS[poDetail.status] || PO_STATUS.draft).label}</span></span>
                  <span>Created: {fmtDate(poDetail.createdAt || poDetail.date)}</span>
                  <span className="vos-po-total">Total: {fmtCurrency(poDetail.total)}</span>
                </div>

                <div className="p-table-wrap vos-po-items">
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
                          <td className="vos-td-cost">{fmtCurrency(item.total || (item.qtyOrdered * item.unitCost))}</td>
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

/* ════════════════════════════════════════════════════════════
   TAB 4 — RETURNS
════════════════════════════════════════════════════════════ */
function ReturnsTab() {
  const [returns, setReturns]       = useState([]);
  const [loading, setLoading]       = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creditModal, setCreditModal] = useState(null);
  const [creditAmt, setCreditAmt]   = useState('');

  const fetchReturns = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listVendorReturns();
      setReturns(res.returns || []);
    } catch { toast.error('Failed to load returns'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchReturns(); }, [fetchReturns]);

  const handleSubmit = async (id) => {
    try {
      await submitVendorReturn(id);
      toast.success('Return submitted — inventory deducted');
      fetchReturns();
    } catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
  };

  const handleCredit = async () => {
    if (!creditModal || !creditAmt) return;
    try {
      await recordVendorCredit(creditModal.id, { creditAmount: parseFloat(creditAmt) });
      toast.success('Credit recorded');
      setCreditModal(null); setCreditAmt('');
      fetchReturns();
    } catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
  };

  const handleDelete = async (id) => {
    try {
      await deleteVendorReturn(id);
      toast.success('Return deleted');
      fetchReturns();
    } catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
  };

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: '0.75rem' }}>
        <button className="p-btn p-btn-ghost" onClick={fetchReturns} disabled={loading}>
          <RefreshCw size={15} /> Refresh
        </button>
        <button className="p-btn p-btn-primary p-btn-sm" onClick={() => setShowCreate(true)}>
          <Plus size={13} /> New Return
        </button>
      </div>

      {loading && <div className="p-loading" style={{ justifyContent: 'center' }}><Spinner /> Loading returns...</div>}

      {!loading && returns.length === 0 && (
        <div className="p-empty"><RotateCcw size={40} /> No vendor returns found.</div>
      )}

      {!loading && returns.length > 0 && (
        <div className="p-card">
          <div className="p-table-wrap">
            <table className="p-table">
              <thead>
                <tr>
                  <th>Return #</th><th>Vendor</th><th>Reason</th><th>Items</th>
                  <th>Amount</th><th>Credit</th><th>Status</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {returns.map(r => {
                  const st = RETURN_STATUS[r.status] || RETURN_STATUS.draft;
                  return (
                    <tr key={r.id}>
                      <td className="p-td-strong">{r.returnNumber}</td>
                      <td>{r.vendor?.name || '--'}</td>
                      <td style={{ textTransform: 'capitalize' }}>{r.reason?.replace(/_/g, ' ')}</td>
                      <td>{r.items?.length || 0}</td>
                      <td style={{ fontWeight: 700 }}>{fmtCurrency(r.totalAmount)}</td>
                      <td style={{ fontWeight: 700, color: Number(r.creditReceived) > 0 ? '#22c55e' : 'var(--text-muted)' }}>
                        {Number(r.creditReceived) > 0 ? fmtCurrency(r.creditReceived) : '--'}
                      </td>
                      <td><span className={st.cls}>{st.label}</span></td>
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          {r.status === 'draft' && (
                            <>
                              <button className="p-btn p-btn-success p-btn-xs" onClick={() => handleSubmit(r.id)} title="Submit & deduct inventory"><Send size={11} /></button>
                              <button className="p-btn p-btn-danger p-btn-xs" onClick={() => handleDelete(r.id)} title="Delete"><Trash2 size={11} /></button>
                            </>
                          )}
                          {r.status === 'submitted' && (
                            <button className="p-btn p-btn-primary p-btn-xs" onClick={() => { setCreditModal(r); setCreditAmt(String(r.totalAmount)); }} title="Record credit">
                              <DollarSign size={11} /> Credit
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Create Return Modal */}
      {showCreate && <CreateReturnModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); fetchReturns(); }} />}

      {/* Record Credit Modal */}
      {creditModal && (
        <div className="p-modal-overlay" onClick={() => setCreditModal(null)}>
          <div className="p-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <div className="p-modal-header">
              <h2 className="p-modal-title">Record Credit — {creditModal.returnNumber}</h2>
              <button className="p-modal-close" onClick={() => setCreditModal(null)}><X size={18} /></button>
            </div>
            <div style={{ padding: '1rem' }}>
              <label className="p-field-label">Credit Amount Received ($)</label>
              <input type="number" className="p-input" value={creditAmt} onChange={e => setCreditAmt(e.target.value)} step="0.01" min="0" autoFocus />
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4 }}>Return total: {fmtCurrency(creditModal.totalAmount)}</div>
            </div>
            <div className="p-form-actions" style={{ padding: '0 1rem 1rem' }}>
              <button className="p-btn p-btn-ghost" onClick={() => setCreditModal(null)}>Cancel</button>
              <button className="p-btn p-btn-primary" onClick={handleCredit}>Record Credit</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ── Create Return Modal ─── */
function CreateReturnModal({ onClose, onCreated }) {
  const [vendorId, setVendorId] = useState('');
  const [reason, setReason]     = useState('damaged');
  const [notes, setNotes]       = useState('');
  const [items, setItems]       = useState([{ masterProductId: '', qty: 1, unitCost: '', reason: 'damaged' }]);
  const [saving, setSaving]     = useState(false);

  const addItem = () => setItems(prev => [...prev, { masterProductId: '', qty: 1, unitCost: '', reason }]);
  const updateItem = (idx, field, val) => setItems(prev => prev.map((it, i) => i === idx ? { ...it, [field]: val } : it));
  const removeItem = (idx) => setItems(prev => prev.filter((_, i) => i !== idx));

  const handleSave = async () => {
    if (!vendorId || items.length === 0) { toast.error('Vendor and at least one item required'); return; }
    setSaving(true);
    try {
      await createVendorReturn({ vendorId: parseInt(vendorId), reason, notes, items });
      toast.success('Return created');
      onCreated();
    } catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
    finally { setSaving(false); }
  };

  return (
    <div className="p-modal-overlay" onClick={onClose}>
      <div className="p-modal p-modal-lg" onClick={e => e.stopPropagation()} style={{ maxWidth: 700 }}>
        <div className="p-modal-header">
          <h2 className="p-modal-title">Create Vendor Return</h2>
          <button className="p-modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label className="p-field-label">Vendor ID</label>
              <input className="p-input" type="number" value={vendorId} onChange={e => setVendorId(e.target.value)} placeholder="Vendor ID" />
            </div>
            <div>
              <label className="p-field-label">Reason</label>
              <select className="p-input" value={reason} onChange={e => setReason(e.target.value)}>
                <option value="damaged">Damaged</option>
                <option value="expired">Expired</option>
                <option value="wrong_item">Wrong Item</option>
                <option value="overstock">Overstock</option>
                <option value="recall">Recall</option>
              </select>
            </div>
          </div>
          <div>
            <label className="p-field-label">Notes</label>
            <input className="p-input" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Internal notes..." />
          </div>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <label className="p-field-label" style={{ margin: 0 }}>Return Items</label>
              <button className="p-btn p-btn-ghost p-btn-xs" onClick={addItem}><Plus size={11} /> Add</button>
            </div>
            {items.map((item, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: 6, marginBottom: 6 }}>
                <input className="p-input p-input-sm" type="number" value={item.masterProductId} onChange={e => updateItem(i, 'masterProductId', e.target.value)} placeholder="Product ID" />
                <input className="p-input p-input-sm" type="number" value={item.qty} onChange={e => updateItem(i, 'qty', e.target.value)} placeholder="Qty" min={1} />
                <input className="p-input p-input-sm" type="number" value={item.unitCost} onChange={e => updateItem(i, 'unitCost', e.target.value)} placeholder="Unit $" step="0.01" />
                {items.length > 1 && <button className="p-btn p-btn-ghost p-btn-xs" onClick={() => removeItem(i)}><X size={11} /></button>}
              </div>
            ))}
          </div>
        </div>
        <div className="p-form-actions" style={{ padding: '0 1rem 1rem' }}>
          <button className="p-btn p-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="p-btn p-btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? <Spinner /> : <RotateCcw size={13} />} Create Return
          </button>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   TAB 5 — ANALYTICS (Vendor Performance + Cost Variance)
════════════════════════════════════════════════════════════ */
function AnalyticsTab() {
  const [perfData, setPerfData] = useState([]);
  const [variance, setVariance] = useState(null);
  const [loading, setLoading]   = useState(true);
  const [subTab, setSubTab]     = useState('performance');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [perf, cost] = await Promise.all([
        getVendorPerformance().catch(() => []),
        getCostVariance().catch(() => ({ items: [], summary: {} })),
      ]);
      setPerfData(Array.isArray(perf) ? perf : []);
      setVariance(cost);
    } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <>
      <div style={{ display: 'flex', gap: 6, marginBottom: '1rem' }}>
        <button className={`p-btn p-btn-sm ${subTab === 'performance' ? 'p-btn-primary' : 'p-btn-ghost'}`} onClick={() => setSubTab('performance')}>
          <Award size={13} /> Vendor Performance
        </button>
        <button className={`p-btn p-btn-sm ${subTab === 'costs' ? 'p-btn-primary' : 'p-btn-ghost'}`} onClick={() => setSubTab('costs')}>
          <DollarSign size={13} /> Cost Variance
        </button>
        <div style={{ flex: 1 }} />
        <button className="p-btn p-btn-ghost p-btn-sm" onClick={fetchData} disabled={loading}><RefreshCw size={13} /> Refresh</button>
      </div>

      {loading && <div className="p-loading" style={{ justifyContent: 'center' }}><Spinner /> Loading analytics...</div>}

      {/* ── Vendor Performance ── */}
      {!loading && subTab === 'performance' && (
        perfData.length === 0 ? (
          <div className="p-empty"><BarChart2 size={40} /> No performance data yet. Receive POs to start tracking.</div>
        ) : (
          <div className="p-card">
            <div className="p-table-wrap">
              <table className="p-table">
                <thead>
                  <tr><th>Vendor</th><th>Grade</th><th>POs</th><th>On-Time</th><th>Fill Rate</th><th>Cost Accuracy</th><th>Avg Lead</th><th>Returns</th></tr>
                </thead>
                <tbody>
                  {perfData.map(v => (
                    <tr key={v.vendorId}>
                      <td className="p-td-strong">{v.vendorName || `#${v.vendorId}`}</td>
                      <td>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          width: 28, height: 28, borderRadius: '50%', fontWeight: 900, fontSize: '0.85rem',
                          background: (GRADE_COLORS[v.grade] || '#6b7280') + '18',
                          color: GRADE_COLORS[v.grade] || '#6b7280',
                          border: `2px solid ${(GRADE_COLORS[v.grade] || '#6b7280')}40`,
                        }}>{v.grade}</span>
                      </td>
                      <td>{v.totalPOs}</td>
                      <td style={{ color: v.onTimePercent >= 90 ? '#22c55e' : v.onTimePercent >= 75 ? '#eab308' : '#ef4444' }}>
                        {v.onTimePercent != null ? `${v.onTimePercent}%` : '--'}
                      </td>
                      <td style={{ color: v.fillRatePercent >= 95 ? '#22c55e' : v.fillRatePercent >= 85 ? '#eab308' : '#ef4444' }}>
                        {v.fillRatePercent != null ? `${v.fillRatePercent}%` : '--'}
                      </td>
                      <td style={{ color: v.costAccuracyPercent >= 90 ? '#22c55e' : '#eab308' }}>
                        {v.costAccuracyPercent != null ? `${v.costAccuracyPercent}%` : '--'}
                      </td>
                      <td>{v.avgLeadTime != null ? `${v.avgLeadTime}d` : '--'}
                        {v.statedLeadTime && v.avgLeadTime > v.statedLeadTime && (
                          <span style={{ color: '#ef4444', fontSize: '0.65rem', marginLeft: 3 }}>(+{(v.avgLeadTime - v.statedLeadTime).toFixed(1)})</span>
                        )}
                      </td>
                      <td style={{ color: v.returnRatePercent > 5 ? '#ef4444' : 'var(--text-muted)' }}>
                        {v.returnRatePercent != null ? `${v.returnRatePercent}%` : '--'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}

      {/* ── Cost Variance ── */}
      {!loading && subTab === 'costs' && (
        <>
          {variance?.summary && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
              {[
                { label: 'Total Variance', value: fmtCurrency(variance.summary.totalVariance), color: '#f59e0b' },
                { label: 'Major', value: variance.summary.majorCount || 0, color: '#ef4444' },
                { label: 'Minor', value: variance.summary.minorCount || 0, color: '#eab308' },
                { label: 'Items Tracked', value: variance.summary.itemCount || 0, color: 'var(--text-primary)' },
              ].map(card => (
                <div key={card.label} className="p-card" style={{ padding: '0.85rem', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.6rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{card.label}</div>
                  <div style={{ fontSize: '1.15rem', fontWeight: 800, color: card.color }}>{card.value}</div>
                </div>
              ))}
            </div>
          )}

          {(!variance?.items || variance.items.length === 0) ? (
            <div className="p-empty"><DollarSign size={40} /> No cost variance data yet.</div>
          ) : (
            <div className="p-card">
              <div className="p-table-wrap">
                <table className="p-table">
                  <thead>
                    <tr><th>Product</th><th>UPC</th><th>Vendor</th><th>PO #</th><th>PO Cost</th><th>Invoice Cost</th><th>Variance</th><th>Flag</th></tr>
                  </thead>
                  <tbody>
                    {variance.items.map((item, i) => (
                      <tr key={i} style={{ background: item.flag === 'major' ? 'rgba(239,68,68,0.04)' : item.flag === 'minor' ? 'rgba(245,158,11,0.04)' : undefined }}>
                        <td className="p-td-strong">{item.productName || '--'}</td>
                        <td style={{ fontFamily: 'monospace', fontSize: '0.78rem' }}>{item.upc || '--'}</td>
                        <td>{item.vendorName || '--'}</td>
                        <td>{item.poNumber || '--'}</td>
                        <td>{fmtCurrency(item.poUnitCost)}</td>
                        <td>{fmtCurrency(item.actualUnitCost)}</td>
                        <td style={{ fontWeight: 700, color: item.flag === 'major' ? '#ef4444' : '#f59e0b' }}>
                          {Number(item.variance) > 0 ? '+' : ''}{fmtCurrency(item.variance)}
                        </td>
                        <td><span className={`p-badge ${item.flag === 'major' ? 'p-badge-red' : 'p-badge-amber'}`}>{item.flag}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
