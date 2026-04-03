/**
 * POS API — IT Retail / MarktPOS Integration
 *
 * Credentials live in Store Settings (Stores → POS System tab).
 * This page only handles the live connection, product sync, and price management.
 *
 * States:
 *   no-store       — user has no active store selected
 *   no-pos         — store has pos.type = 'none'
 *   not-itretail   — store uses a non-IT-Retail POS (sync not yet supported)
 *   no-credentials — store is IT Retail but username is blank
 *   disconnected   — credentials set, token missing / expired
 *   connected      — token valid, full product UI shown
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Zap, RefreshCw, CheckCircle, AlertTriangle,
  ExternalLink, Info, Search, ChevronLeft, ChevronRight,
  Download, Upload, Edit3, Save, X, CheckSquare, Square,
  Clock, Wifi, WifiOff, Database, Package, DollarSign, Loader,
  BarChart3, Store, Settings, Rocket, ArrowRight,
} from 'lucide-react';
import Sidebar from '../components/Sidebar';
import { useStore } from '../contexts/StoreContext';
import {
  connectPOS, getPOSStatus, fetchPOSProducts, syncAllPOSProducts,
  getLocalPOSProducts, updatePOSProductPrice, bulkPOSPriceUpdate,
  getPOSLogs, debugPOSProductsRaw,
} from '../services/api';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import './POSAPI.css';

/* ── POS display map ─────────────────────────────────────────────────────── */
const POS_LABEL = {
  none:       'No POS',
  itretail:   'IT Retail / MarktPOS',
  square:     'Square',
  clover:     'Clover',
  toast:      'Toast',
  lightspeed: 'Lightspeed',
};

const POS_COLOR = {
  none:       'var(--text-muted)',
  itretail:   '#7ac143',
  square:     '#3b82f6',
  clover:     '#f97316',
  toast:      '#e30613',
  lightspeed: '#8b5cf6',
};

/* ─────────────────────────────────────────────────────────────────────────── */

const POSAPI = () => {
  const navigate = useNavigate();
  const { activeStore, loading: storeLoading } = useStore();

  // ── Connection ──
  const [connectionStatus, setConnectionStatus] = useState('checking');
  const [tokenExpiresAt,   setTokenExpiresAt]   = useState(null);
  const [connectedAs,      setConnectedAs]       = useState(null);
  const [connectLoading,   setConnectLoading]    = useState(false);

  // ── Products ──
  const [products,      setProducts]      = useState([]);
  const [totalProducts, setTotalProducts] = useState(0);
  const [currentPage,   setCurrentPage]   = useState(1);
  const [totalPages,    setTotalPages]    = useState(1);
  const [searchQuery,   setSearchQuery]   = useState('');
  const [categoryFilter,setCategoryFilter]= useState('');
  const [productsLoading,setProductsLoading]=useState(false);

  // ── Sync ──
  const [syncLoading,  setSyncLoading]  = useState(false);
  const [syncStats,    setSyncStats]    = useState(null);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [fetchLoading, setFetchLoading] = useState(false);

  // ── Price edit ──
  const [editingRow,          setEditingRow]          = useState(null);
  const [editPrice,           setEditPrice]           = useState({ costPrice: '', retailPrice: '' });
  const [priceUpdateLoading,  setPriceUpdateLoading]  = useState(false);

  // ── Bulk ──
  const [selectedProducts, setSelectedProducts] = useState(new Set());
  const [bulkMarkup,       setBulkMarkup]       = useState('');
  const [bulkLoading,      setBulkLoading]      = useState(false);
  const [bulkMode,         setBulkMode]         = useState('markup');

  // ── Logs ──
  const [logs,       setLogs]       = useState([]);
  const [logsLoading,setLogsLoading]= useState(false);

  // ── Debug ──
  const [debugData,   setDebugData]   = useState(null);
  const [debugLoading,setDebugLoading]= useState(false);
  const [debugOpen,   setDebugOpen]   = useState(false);

  // ── Tabs ──
  const [activeTab, setActiveTab] = useState('products');

  /* ── Derived store state ─────────────────────────────────────────────── */
  const posType        = activeStore?.pos?.type || 'none';
  const posLabel       = POS_LABEL[posType] || posType;
  const posColor       = POS_COLOR[posType] || 'var(--text-muted)';
  const isITRetail     = posType === 'itretail';
  const hasUsername    = !!activeStore?.pos?.username; // password excluded from API, but username is visible

  /* ── Check connection on mount / when active store changes ─────────── */
  useEffect(() => {
    if (!activeStore) return;
    if (!isITRetail) { setConnectionStatus('disconnected'); return; }
    checkStatus();
    fetchLogs();
  }, [activeStore?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (connectionStatus === 'connected') loadLocalProducts();
  }, [currentPage, connectionStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Status check ────────────────────────────────────────────────────── */
  const checkStatus = async () => {
    setConnectionStatus('checking');
    try {
      const res = await getPOSStatus();
      const data = res.data;
      setConnectionStatus(data.connected ? 'connected' : 'disconnected');
      setTokenExpiresAt(data.expiresAt);
      setConnectedAs(data.username);
      if (data.productCount !== undefined) setTotalProducts(data.productCount);
      if (data.connected) loadLocalProducts();
    } catch {
      setConnectionStatus('disconnected');
    }
  };

  /* ── Connect using stored store credentials ──────────────────────────── */
  const handleConnect = async () => {
    setConnectLoading(true);
    try {
      // No credentials needed in body — backend reads them from the active store
      const res = await connectPOS({});
      setConnectionStatus('connected');
      setTokenExpiresAt(res.expiresAt);
      setConnectedAs(res.username);
      toast.success('Connected to IT Retail / MarktPOS');
      loadLocalProducts();
      fetchLogs();
    } catch (err) {
      setConnectionStatus('disconnected');
      const hint = err.response?.data?.hint;
      if (hint === 'stores_settings') {
        toast.error('No credentials saved. Add them in Store Settings → POS System tab.');
      } else {
        toast.error(err.response?.data?.error || 'Connection failed');
      }
    } finally {
      setConnectLoading(false);
    }
  };

  /* ── Fetch from MarktPOS ─────────────────────────────────────────────── */
  const handleFetchProducts = async () => {
    setFetchLoading(true);
    try {
      const res = await fetchPOSProducts();
      toast.success(`Fetched ${res.data.count} products (${res.data.savedToDb} saved)`);
      loadLocalProducts(); fetchLogs();
    } catch (err) {
      toast.error(err.response?.data?.message || err.response?.data?.error || 'Fetch failed');
    } finally {
      setFetchLoading(false);
    }
  };

  /* ── Sync all ────────────────────────────────────────────────────────── */
  const handleSyncAll = async () => {
    setSyncLoading(true); setSyncStats(null);
    try {
      const res = await syncAllPOSProducts();
      const d = res.data;
      setSyncStats({ synced: d.synced, updated: d.updated, failed: d.failed });
      setLastSyncedAt(d.lastSyncedAt);
      toast.success(`Sync complete: ${d.synced} new, ${d.updated} updated, ${d.failed} failed`);
      loadLocalProducts(); fetchLogs();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Sync failed');
    } finally {
      setSyncLoading(false);
    }
  };

  /* ── Local products ──────────────────────────────────────────────────── */
  const loadLocalProducts = async () => {
    setProductsLoading(true);
    try {
      const res = await getLocalPOSProducts({ page: currentPage, limit: 50, search: searchQuery, category: categoryFilter });
      const d = res.data;
      setProducts(d.products || []);
      setTotalProducts(d.total || 0);
      setTotalPages(d.totalPages || 1);
    } catch { /* silent */ } finally { setProductsLoading(false); }
  };

  const handleSearch = (e) => { e.preventDefault(); setCurrentPage(1); loadLocalProducts(); };

  /* ── Price editing ───────────────────────────────────────────────────── */
  const startEditing  = (p) => { setEditingRow(p.id); setEditPrice({ costPrice: p.costPrice || '', retailPrice: p.retailPrice || '' }); };
  const cancelEditing = ()  => { setEditingRow(null); setEditPrice({ costPrice: '', retailPrice: '' }); };
  const handleSavePrice = async (product) => {
    setPriceUpdateLoading(true);
    try {
      await updatePOSProductPrice(product.posProductId, { price: parseFloat(editPrice.costPrice) || undefined, retailPrice: parseFloat(editPrice.retailPrice) || undefined });
      toast.success(`Price updated for "${product.name}"`);
      setEditingRow(null); loadLocalProducts(); fetchLogs();
    } catch (err) { toast.error(err.response?.data?.error || 'Price update failed'); }
    finally { setPriceUpdateLoading(false); }
  };

  /* ── Bulk selection ──────────────────────────────────────────────────── */
  const toggleSelectAll = () => setSelectedProducts(selectedProducts.size === products.length ? new Set() : new Set(products.map(p => p.id)));
  const toggleSelect = (id) => { const n = new Set(selectedProducts); n.has(id) ? n.delete(id) : n.add(id); setSelectedProducts(n); };
  const handleBulkUpdate = async () => {
    if (!selectedProducts.size) { toast.warning('Select at least one product'); return; }
    if (!bulkMarkup) { toast.warning(bulkMode === 'markup' ? 'Enter markup %' : 'Enter a price'); return; }
    setBulkLoading(true);
    try {
      const updates = products.filter(p => selectedProducts.has(p.id)).map(p => {
        const item = { posProductId: p.posProductId };
        item.retailPrice = bulkMode === 'markup' ? parseFloat((p.costPrice * (1 + parseFloat(bulkMarkup) / 100)).toFixed(2)) : parseFloat(bulkMarkup);
        return item;
      });
      const res = await bulkPOSPriceUpdate(updates);
      toast.success(`Bulk: ${res.data.successCount} succeeded, ${res.data.failCount} failed`);
      setSelectedProducts(new Set()); setBulkMarkup(''); loadLocalProducts(); fetchLogs();
    } catch (err) { toast.error(err.response?.data?.error || 'Bulk update failed'); }
    finally { setBulkLoading(false); }
  };

  /* ── Logs ────────────────────────────────────────────────────────────── */
  const fetchLogs = useCallback(async () => {
    setLogsLoading(true);
    try { const res = await getPOSLogs(); setLogs(res.data.logs || []); }
    catch { /* silent */ } finally { setLogsLoading(false); }
  }, []);

  /* ── Debug ───────────────────────────────────────────────────────────── */
  const handleDebugInspect = async () => {
    setDebugLoading(true); setDebugOpen(true);
    try {
      const res = await debugPOSProductsRaw();
      setDebugData(res.data);
      toast.info(`Debug: ${res.data.totalItems} products at ${res.data.discoveredEndpoint}`);
    } catch (err) {
      const msg = err.response?.data?.error || 'Debug failed';
      setDebugData({ error: msg }); toast.error(msg);
    } finally { setDebugLoading(false); }
  };

  /* ── Helpers ─────────────────────────────────────────────────────────── */
  const fmt     = (d) => d ? new Date(d).toLocaleString() : '—';
  const fmtCur  = (v) => (v === null || v === undefined) ? '—' : `$${parseFloat(v).toFixed(2)}`;

  /* ═══════════════════════════════════════════════════════════════════════ */
  /* RENDER                                                                  */
  /* ═══════════════════════════════════════════════════════════════════════ */
  return (
    <div className="layout-container">
      <Sidebar />
      <main className="main-content animate-fade-in">

        {/* ── Header ──────────────────────────────────────────────────── */}
        <header style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem', color: 'var(--text-primary)' }}>POS Integration</h1>
            <p style={{ color: 'var(--text-secondary)' }}>
              {activeStore
                ? <><span style={{ fontWeight: 600, color: posColor }}>{posLabel}</span> · {activeStore.name}</>
                : "Connect your store\u2019s POS system"}
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <button onClick={() => navigate('/portal/stores')} style={{
              display: 'flex', alignItems: 'center', gap: '0.4rem',
              padding: '0.5rem 0.9rem', fontSize: '0.825rem', fontWeight: 600,
              background: 'var(--bg-tertiary)', color: 'var(--text-secondary)',
              border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', cursor: 'pointer',
            }}>
              <Settings size={14} />Store Settings
            </button>
            <a href="https://help.posnation.com/itretail/s/article/API-Endpoints-Sections"
              target="_blank" rel="noreferrer" className="btn btn-secondary pos-docs-btn">
              <ExternalLink size={16} /> API Docs
            </a>
          </div>
        </header>

        {/* ─────────────────────────────────────────────────────────────── */}
        {/* STATE: loading stores                                            */}
        {/* ─────────────────────────────────────────────────────────────── */}
        {storeLoading && (
          <div className="pos-loading-state" style={{ marginTop: '4rem' }}>
            <Loader size={32} className="pos-spin" /><p>Loading store…</p>
          </div>
        )}

        {/* ─────────────────────────────────────────────────────────────── */}
        {/* STATE: no active store                                           */}
        {/* ─────────────────────────────────────────────────────────────── */}
        {!storeLoading && !activeStore && (
          <div className="pos-disconnected">
            <div className="pos-disconnected-card">
              <Store size={48} style={{ opacity: 0.3 }} />
              <h2>No store selected</h2>
              <p>Add and select a store first to manage its POS connection.</p>
              <button className="btn btn-primary" onClick={() => navigate('/portal/stores')}
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '0 auto' }}>
                <ArrowRight size={16} />Go to Stores
              </button>
            </div>
          </div>
        )}

        {/* ─────────────────────────────────────────────────────────────── */}
        {/* STATE: no POS configured                                         */}
        {/* ─────────────────────────────────────────────────────────────── */}
        {!storeLoading && activeStore && posType === 'none' && (
          <div className="pos-disconnected">
            <div className="pos-disconnected-card" style={{ maxWidth: 560 }}>
              <Zap size={48} style={{ opacity: 0.2 }} />
              <h2>No POS connected to {activeStore.name}</h2>
              <p>Connect a third-party POS system, or skip it — our native POS is coming soon.</p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', width: '100%', maxWidth: 380, margin: '1rem auto 0' }}>
                {/* Configure POS */}
                <button className="btn btn-primary" onClick={() => navigate('/portal/stores')}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', padding: '0.875rem' }}>
                  <Settings size={16} />Configure POS in Store Settings
                </button>

                {/* Native POS teaser */}
                <div style={{
                  padding: '1rem', borderRadius: 'var(--radius-md)',
                  border: '1px solid rgba(122,193,67,0.3)',
                  background: 'rgba(122,193,67,0.06)',
                  textAlign: 'left',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
                    <Rocket size={15} style={{ color: 'var(--accent-primary)' }} />
                    <span style={{ fontSize: '0.825rem', fontWeight: 700, color: 'var(--accent-primary)' }}>
                      Future Foods Native POS — Coming Soon
                    </span>
                  </div>
                  <p style={{ fontSize: '0.775rem', color: 'var(--text-muted)', margin: 0 }}>
                    Skip third-party POS entirely. Our built-in POS will work out of the box with no external credentials needed.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ─────────────────────────────────────────────────────────────── */}
        {/* STATE: non-IT Retail POS (sync not supported yet)               */}
        {/* ─────────────────────────────────────────────────────────────── */}
        {!storeLoading && activeStore && posType !== 'none' && !isITRetail && (
          <div className="pos-disconnected">
            <div className="pos-disconnected-card" style={{ maxWidth: 520 }}>
              <div style={{
                width: 64, height: 64, borderRadius: '16px',
                background: `${posColor}18`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto 1rem',
              }}>
                <Zap size={32} style={{ color: posColor }} />
              </div>
              <h2 style={{ color: posColor }}>{posLabel}</h2>
              <p style={{ marginBottom: '0.5rem' }}>
                <strong>{posLabel}</strong> is configured for {activeStore.name}.
              </p>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
                Direct sync for {posLabel} is coming soon. Today, IT Retail / MarktPOS is the supported integration. You can switch your store's POS type in Store Settings.
              </p>
              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                <button className="btn btn-primary" onClick={() => navigate('/portal/stores')}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Settings size={15} />Change POS in Store Settings
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ─────────────────────────────────────────────────────────────── */}
        {/* IT RETAIL FLOW                                                   */}
        {/* ─────────────────────────────────────────────────────────────── */}
        {!storeLoading && activeStore && isITRetail && (
          <>
            {/* ── Stats row ─────────────────────────────────────────── */}
            <div className="pos-stats-row">
              {[
                { icon: <Package size={22} />, value: totalProducts, label: 'Products synced',   color: '#818cf8', bg: 'rgba(99,102,241,0.15)' },
                {
                  icon: connectionStatus === 'connected' ? <Wifi size={22} /> : <WifiOff size={22} />,
                  value: connectionStatus === 'checking' ? 'Checking…' : connectionStatus === 'connected' ? 'Connected' : 'Disconnected',
                  label: 'Connection status',
                  color: connectionStatus === 'connected' ? '#34d399' : '#f87171',
                  bg:    connectionStatus === 'connected' ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
                },
                { icon: <Clock size={22} />,    value: fmt(tokenExpiresAt), label: 'Token expires',  color: '#c084fc', bg: 'rgba(168,85,247,0.15)' },
                { icon: <Database size={22} />, value: fmt(lastSyncedAt),   label: 'Last synced',   color: '#60a5fa', bg: 'rgba(59,130,246,0.15)'  },
              ].map((s, i) => (
                <div key={i} className="pos-stat-card">
                  <div className="pos-stat-icon" style={{ background: s.bg, color: s.color }}>{s.icon}</div>
                  <div>
                    <span className="pos-stat-value" style={i === 1 ? { color: s.color } : {}}>{s.value}</span>
                    <span className="pos-stat-label">{s.label}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* ── Connection card ───────────────────────────────────── */}
            <div className="pos-connection-card">
              <div className="pos-connection-left">
                <div className="pos-connection-icon" style={{ background: 'rgba(122,193,67,0.15)', color: 'var(--accent-primary)' }}>
                  <Zap size={28} />
                </div>
                <div>
                  <h2 className="pos-connection-title">IT Retail / MarktPOS</h2>
                  <p className="pos-connection-subtitle">
                    {connectionStatus === 'connected'
                      ? `Connected as ${connectedAs || activeStore.pos?.username || 'store'}`
                      : hasUsername
                        ? `Credentials saved for ${activeStore.pos.username} · ready to connect`
                        : 'Add credentials in Store Settings to connect'}
                  </p>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                {/* Edit credentials → Store Settings */}
                <button onClick={() => navigate('/portal/stores')} style={{
                  display: 'flex', alignItems: 'center', gap: '0.4rem',
                  padding: '0.55rem 0.9rem', fontSize: '0.825rem', fontWeight: 600,
                  background: 'var(--bg-tertiary)', color: 'var(--text-secondary)',
                  border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', cursor: 'pointer',
                }}>
                  <Settings size={14} />Edit credentials
                </button>

                {/* Connect / Reconnect */}
                {!hasUsername ? (
                  <button onClick={() => navigate('/portal/stores')} className="btn btn-primary"
                    style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <Settings size={15} />Add credentials
                  </button>
                ) : (
                  <button onClick={handleConnect} className="btn btn-primary"
                    disabled={connectLoading}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    {connectLoading
                      ? <><Loader size={15} className="pos-spin" />Connecting…</>
                      : connectionStatus === 'connected'
                        ? <><RefreshCw size={15} />Reconnect</>
                        : <><Zap size={15} />Connect</>
                    }
                  </button>
                )}
              </div>
            </div>

            {/* ── No products banner ────────────────────────────────── */}
            {connectionStatus === 'connected' && totalProducts === 0 && !syncLoading && (
              <div className="pos-no-products-banner">
                <AlertTriangle size={20} />
                <div>
                  <strong>No products synced yet.</strong> Click "Sync All to Database" to import products from IT Retail.
                </div>
              </div>
            )}

            {/* ── Sync actions ──────────────────────────────────────── */}
            {connectionStatus === 'connected' && (
              <div className="pos-sync-bar">
                <div className="pos-sync-left">
                  <button onClick={handleDebugInspect} className="btn btn-secondary pos-action-btn" disabled={debugLoading} title="Inspect raw API response">
                    {debugLoading ? <Loader size={16} className="pos-spin" /> : <Info size={16} />}Debug Inspect
                  </button>
                  <button onClick={handleFetchProducts} className="btn btn-secondary pos-action-btn" disabled={fetchLoading}>
                    {fetchLoading ? <Loader size={16} className="pos-spin" /> : <Download size={16} />}Fetch from IT Retail
                  </button>
                  <button onClick={handleSyncAll} className="btn btn-primary pos-action-btn" disabled={syncLoading}>
                    {syncLoading ? <Loader size={16} className="pos-spin" /> : <Upload size={16} />}
                    {syncLoading ? 'Syncing…' : 'Sync All to Database'}
                  </button>
                </div>
                {syncStats && (
                  <div className="pos-sync-result">
                    <span className="pos-sync-badge pos-sync-success"><CheckCircle size={14} /> {syncStats.synced} synced</span>
                    <span className="pos-sync-badge pos-sync-updated"><RefreshCw size={14} /> {syncStats.updated} updated</span>
                    {syncStats.failed > 0 && <span className="pos-sync-badge pos-sync-failed"><AlertTriangle size={14} /> {syncStats.failed} failed</span>}
                  </div>
                )}
              </div>
            )}

            {/* ── Debug panel ───────────────────────────────────────── */}
            {debugOpen && (
              <div className="pos-debug-panel">
                <div className="pos-debug-header">
                  <h3><Info size={18} /> Raw IT Retail Response</h3>
                  <button onClick={() => setDebugOpen(false)} className="pos-icon-btn pos-icon-cancel"><X size={16} /></button>
                </div>
                {debugLoading ? (
                  <div className="pos-loading-state" style={{ padding: '2rem' }}><Loader size={24} className="pos-spin" /><p>Inspecting…</p></div>
                ) : debugData ? (
                  <div className="pos-debug-body">
                    <div className="pos-debug-meta">
                      <span><strong>Endpoint:</strong> {debugData.discoveredEndpoint || 'N/A'}</span>
                      <span><strong>Type:</strong> {debugData.responseType}</span>
                      <span><strong>Array:</strong> {String(debugData.isArray)}</span>
                      <span><strong>Items:</strong> {debugData.totalItems}</span>
                      {debugData.firstItemKeys && <span><strong>Fields:</strong> {debugData.firstItemKeys.join(', ')}</span>}
                    </div>
                    <pre className="pos-debug-json">{JSON.stringify(debugData.sample, null, 2)}</pre>
                  </div>
                ) : null}
              </div>
            )}

            {/* ── Tabs ──────────────────────────────────────────────── */}
            {connectionStatus === 'connected' && (
              <div className="pos-tabs">
                {[
                  { id: 'products', icon: <Package size={16} />, label: 'Products'         },
                  { id: 'bulk',     icon: <DollarSign size={16} />, label: 'Bulk Price'     },
                  { id: 'logs',     icon: <BarChart3 size={16} />, label: 'Connection Logs' },
                ].map(t => (
                  <button key={t.id} className={`pos-tab ${activeTab === t.id ? 'active' : ''}`} onClick={() => setActiveTab(t.id)}>
                    {t.icon} {t.label}
                  </button>
                ))}
              </div>
            )}

            {/* ── Products tab ──────────────────────────────────────── */}
            {connectionStatus === 'connected' && activeTab === 'products' && (
              <div className="pos-products-section">
                <form onSubmit={handleSearch} className="pos-search-bar">
                  <div className="pos-search-input-wrap">
                    <Search size={18} className="pos-search-icon" />
                    <input type="text" className="form-input pos-search-input" placeholder="Search by name, UPC, or SKU…"
                      value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
                  </div>
                  <input type="text" className="form-input pos-category-input" placeholder="Filter by category…"
                    value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} />
                  <button type="submit" className="btn btn-secondary"><Search size={16} /> Search</button>
                </form>

                <div className="pos-table-container">
                  {productsLoading ? (
                    <div className="pos-loading-state"><Loader size={32} className="pos-spin" /><p>Loading products…</p></div>
                  ) : products.length === 0 ? (
                    <div className="pos-empty-state">
                      <Package size={48} /><h3>No products found</h3>
                      <p>Sync products from IT Retail to see them here.</p>
                    </div>
                  ) : (
                    <>
                      <div className="pos-table-scroll">
                        <table className="pos-table">
                          <thead>
                            <tr>
                              <th style={{ width: 40 }}>
                                <button onClick={toggleSelectAll} className="pos-checkbox-btn">
                                  {selectedProducts.size === products.length ? <CheckSquare size={18} /> : <Square size={18} />}
                                </button>
                              </th>
                              {['Name','UPC','Category','Cost','Retail','Stock','Deposit','Actions'].map(h => <th key={h}>{h}</th>)}
                            </tr>
                          </thead>
                          <tbody>
                            {products.map(product => (
                              <tr key={product.id} className={selectedProducts.has(product.id) ? 'pos-row-selected' : ''}>
                                <td>
                                  <button onClick={() => toggleSelect(product.id)} className="pos-checkbox-btn">
                                    {selectedProducts.has(product.id) ? <CheckSquare size={18} className="pos-check-active" /> : <Square size={18} />}
                                  </button>
                                </td>
                                <td>
                                  <div className="pos-product-name">{product.name}</div>
                                  {product.sku && <div className="pos-product-sku">SKU: {product.sku}</div>}
                                </td>
                                <td className="pos-mono">{product.upc || '—'}</td>
                                <td><span className="pos-category-badge">{product.category || '—'}</span></td>
                                <td>
                                  {editingRow === product.id
                                    ? <input type="number" step="0.01" className="form-input pos-price-input" value={editPrice.costPrice} onChange={e => setEditPrice({ ...editPrice, costPrice: e.target.value })} />
                                    : <span className="pos-price">{fmtCur(product.costPrice)}</span>}
                                </td>
                                <td>
                                  {editingRow === product.id
                                    ? <input type="number" step="0.01" className="form-input pos-price-input" value={editPrice.retailPrice} onChange={e => setEditPrice({ ...editPrice, retailPrice: e.target.value })} />
                                    : <span className="pos-price pos-price-retail">{fmtCur(product.retailPrice)}</span>}
                                </td>
                                <td><span className={`pos-stock ${(product.stock || 0) <= 0 ? 'pos-stock-low' : ''}`}>{product.stock ?? 0}</span></td>
                                <td>{fmtCur(product.deposit)}</td>
                                <td>
                                  {editingRow === product._id ? (
                                    <div className="pos-action-group">
                                      <button onClick={() => handleSavePrice(product)} className="pos-icon-btn pos-icon-save" disabled={priceUpdateLoading}>
                                        {priceUpdateLoading ? <Loader size={14} className="pos-spin" /> : <Save size={14} />}
                                      </button>
                                      <button onClick={cancelEditing} className="pos-icon-btn pos-icon-cancel"><X size={14} /></button>
                                    </div>
                                  ) : (
                                    <button onClick={() => startEditing(product)} className="pos-icon-btn pos-icon-edit" title="Edit price"><Edit3 size={14} /></button>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      <div className="pos-pagination">
                        <span className="pos-pagination-info">
                          {((currentPage-1)*50)+1}–{Math.min(currentPage*50,totalProducts)} of {totalProducts}
                        </span>
                        <div className="pos-pagination-btns">
                          <button onClick={() => setCurrentPage(Math.max(1,currentPage-1))} disabled={currentPage===1} className="btn btn-secondary btn-sm"><ChevronLeft size={16}/></button>
                          <span className="pos-page-number">{currentPage} / {totalPages}</span>
                          <button onClick={() => setCurrentPage(Math.min(totalPages,currentPage+1))} disabled={currentPage===totalPages} className="btn btn-secondary btn-sm"><ChevronRight size={16}/></button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* ── Bulk price tab ────────────────────────────────────── */}
            {connectionStatus === 'connected' && activeTab === 'bulk' && (
              <div className="pos-bulk-section">
                <div className="pos-bulk-card">
                  <div className="pos-bulk-header">
                    <DollarSign size={24} />
                    <div><h3>Bulk Price Update</h3><p>{selectedProducts.size} product{selectedProducts.size!==1?'s':''} selected</p></div>
                  </div>
                  {selectedProducts.size === 0 ? (
                    <div className="pos-bulk-empty"><Info size={20}/><p>Select products in the <strong>Products</strong> tab then return here.</p></div>
                  ) : (
                    <div className="pos-bulk-controls">
                      <div className="pos-bulk-mode">
                        <button className={`pos-mode-btn ${bulkMode==='markup'?'active':''}`} onClick={() => setBulkMode('markup')}>% Markup</button>
                        <button className={`pos-mode-btn ${bulkMode==='fixed'?'active':''}`}  onClick={() => setBulkMode('fixed')}>Fixed Price</button>
                      </div>
                      <div className="pos-bulk-input-row">
                        <input type="number" step="0.01" className="form-input" placeholder={bulkMode==='markup'?'e.g. 25 for 25% markup':'e.g. 9.99'} value={bulkMarkup} onChange={e => setBulkMarkup(e.target.value)} />
                        <button onClick={handleBulkUpdate} className="btn btn-primary" disabled={bulkLoading}>
                          {bulkLoading && <Loader size={16} className="pos-spin" />}Apply to {selectedProducts.size} Products
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── Logs tab ──────────────────────────────────────────── */}
            {connectionStatus === 'connected' && activeTab === 'logs' && (
              <div className="pos-logs-section">
                <div className="pos-logs-header">
                  <h3><BarChart3 size={20} /> Recent API Calls</h3>
                  <button onClick={fetchLogs} className="btn btn-secondary btn-sm" disabled={logsLoading}><RefreshCw size={14}/> Refresh</button>
                </div>
                <div className="pos-logs-list">
                  {logs.length === 0 ? (
                    <div className="pos-empty-state" style={{ padding:'2rem' }}><Info size={32}/><p>No API logs yet.</p></div>
                  ) : (
                    logs.map((log, i) => (
                      <div key={log.id||i} className="pos-log-item">
                        <div className="pos-log-left">
                          <span className={`pos-log-method pos-method-${log.method?.toLowerCase()}`}>{log.method}</span>
                          <span className="pos-log-endpoint">{log.endpoint}</span>
                          {log.message && <span className="pos-log-message">{log.message}</span>}
                        </div>
                        <div className="pos-log-right">
                          <span className={`pos-log-status ${log.status==='success'?'pos-log-success':'pos-log-fail'}`}>{log.status?.toUpperCase()}</span>
                          <span className="pos-log-time">{fmt(log.timestamp)}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* ── Disconnected prompt (IT Retail configured, not connected) */}
            {connectionStatus === 'disconnected' && (
              <div className="pos-disconnected">
                <div className="pos-disconnected-card">
                  <WifiOff size={48} />
                  <h2>Not Connected</h2>
                  <p>
                    {hasUsername
                      ? `Credentials saved for "${activeStore.pos.username}". Click Connect above to authenticate.`
                      : 'Add your IT Retail credentials in Store Settings, then connect here.'}
                  </p>
                  {!hasUsername && (
                    <button className="btn btn-primary" onClick={() => navigate('/portal/stores')}
                      style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '0 auto' }}>
                      <Settings size={15} />Add credentials
                    </button>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
};

export default POSAPI;
