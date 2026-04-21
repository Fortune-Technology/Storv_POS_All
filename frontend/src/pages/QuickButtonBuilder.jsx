/**
 * QuickButtonBuilder — WYSIWYG drag-and-drop cashier home-screen builder.
 *
 * Lets a store admin lay out the POS tile grid like an iPhone home screen:
 *  - Product tiles (tap → adds to cart)
 *  - Folder tiles (tap → drill into child grid, 1 level deep max)
 *  - Action tiles (tap → fire discount / void / open drawer / etc.)
 *  - Text labels (display-only)
 *  - Image tiles (with optional tap target)
 *
 * Freeform placement via react-grid-layout — tiles snap to a 6-col grid
 * (configurable 3-12) with collision prevention (`compactType: null`,
 * `preventCollision: true`) so they stay exactly where the user drags.
 *
 * Folder depth is capped at 1 level (folder inside folder NOT allowed).
 * Backend re-validates this on save. The builder's folder-drill-in view
 * hides the "Folder" palette button so users can't create them there.
 */
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
// react-grid-layout@2.x restructured the main-entry API — props like
// `rowHeight`, `cols`, `margin`, `compactType`, `preventCollision`,
// `draggableCancel` moved INTO `gridConfig`/`dragConfig` objects. The
// package still ships a `/legacy` adapter that accepts the flat 1.x
// props + keeps `WidthProvider`, which is what we use here.
import GridLayout, { WidthProvider } from 'react-grid-layout/legacy';
const GridLayoutWithWidth = WidthProvider(GridLayout);
import { toast } from 'react-toastify';
import {
  Layout, Plus, Save, RotateCcw, Package, Folder, Zap, Type, Image as ImageIcon,
  Trash2, ArrowLeft, Edit3, Upload, Search, X, Loader, Check, AlertCircle,
  ShoppingCart, DollarSign, Ban, RefreshCcw, Gift, Receipt, UserSearch,
  Clock, Lock, Printer, Fuel, Recycle, Ticket, Tag,
} from 'lucide-react';
import {
  getStores, getQuickButtonLayout, saveQuickButtonLayout, clearQuickButtonLayout,
  listQuickButtonActions, uploadQuickButtonImage, searchCatalogProducts,
} from '../services/api';
import './QuickButtonBuilder.css';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

// Human-friendly action catalog — keys must match VALID_ACTIONS in backend controller
const ACTION_CATALOG = [
  { key: 'discount',          label: 'Apply Discount',    icon: <DollarSign size={16} />, color: '#f59e0b' },
  { key: 'void',              label: 'Void Item',         icon: <Ban size={16} />,         color: '#ef4444' },
  { key: 'refund',            label: 'Refund Sale',       icon: <RefreshCcw size={16} />,  color: '#f87171' },
  { key: 'open_drawer',       label: 'Open Cash Drawer',  icon: <Lock size={16} />,        color: '#64748b' },
  { key: 'no_sale',           label: 'No Sale',           icon: <Lock size={16} />,        color: '#94a3b8' },
  { key: 'print_last_receipt',label: 'Print Last Receipt',icon: <Printer size={16} />,     color: '#6366f1' },
  { key: 'customer_lookup',   label: 'Customer Lookup',   icon: <UserSearch size={16} />,  color: '#8b5cf6' },
  { key: 'customer_add',      label: 'Add Customer',      icon: <UserSearch size={16} />,  color: '#a78bfa' },
  { key: 'price_check',       label: 'Price Check',       icon: <Tag size={16} />,         color: '#0ea5e9' },
  { key: 'hold',              label: 'Hold Transaction',  icon: <Clock size={16} />,       color: '#f97316' },
  { key: 'recall',            label: 'Recall Transaction',icon: <Clock size={16} />,       color: '#f97316' },
  { key: 'cash_drop',         label: 'Cash Drop',         icon: <Receipt size={16} />,     color: '#f59e0b' },
  { key: 'payout',            label: 'Paid Out',          icon: <Receipt size={16} />,     color: '#a855f7' },
  { key: 'end_of_day',        label: 'End of Day',        icon: <Receipt size={16} />,     color: '#7c3aed' },
  { key: 'lottery_sale',      label: 'Lottery',           icon: <Ticket size={16} />,      color: '#10b981' },
  { key: 'fuel_sale',         label: 'Fuel Sale',         icon: <Fuel size={16} />,        color: '#dc2626' },
  { key: 'bottle_return',     label: 'Bottle Return',     icon: <Recycle size={16} />,     color: '#14b8a6' },
  { key: 'manual_entry',      label: 'Manual / Open Item',icon: <Edit3 size={16} />,       color: '#6b7280' },
  { key: 'clock_event',       label: 'Clock In / Out',    icon: <Clock size={16} />,       color: '#0891b2' },
];

const COLOR_SWATCHES = [
  '#7ac143', '#10b981', '#06b6d4', '#0ea5e9', '#6366f1',
  '#8b5cf6', '#ec4899', '#ef4444', '#f97316', '#f59e0b',
  '#6b7280', '#1f2937',
];

const uid = () => `tile_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

// Find next free (x,y) position for a new tile in a flat tree
function nextFreePosition(tree, cols, w = 1, h = 1) {
  const taken = new Set();
  tree.forEach(t => {
    for (let dx = 0; dx < (t.w || 1); dx++) {
      for (let dy = 0; dy < (t.h || 1); dy++) {
        taken.add(`${t.x + dx},${t.y + dy}`);
      }
    }
  });
  for (let y = 0; y < 100; y++) {
    for (let x = 0; x + w <= cols; x++) {
      let fits = true;
      outer: for (let dx = 0; dx < w; dx++) {
        for (let dy = 0; dy < h; dy++) {
          if (taken.has(`${x + dx},${y + dy}`)) { fits = false; break outer; }
        }
      }
      if (fits) return { x, y };
    }
  }
  return { x: 0, y: 0 };
}

export default function QuickButtonBuilder() {
  const [stores,   setStores]   = useState([]);
  const [storeId,  setStoreId]  = useState(localStorage.getItem('activeStoreId') || '');
  const [loading,  setLoading]  = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [dirty,    setDirty]    = useState(false);

  // Layout state — always a flat array of top-level tiles. Folder children
  // live on the folder's `children` field (max 1 deep).
  const [gridCols, setGridCols] = useState(6);
  const [rowHeight, setRowHeight] = useState(56);  // px per grid row (tile height for h=1)
  const [rootTree, setRootTree] = useState([]);

  // Drill-in state: when non-null, we're editing a folder's children.
  // `rootTree[folderIndex]` is the active folder.
  const [folderId,  setFolderId] = useState(null);

  // Selection + inspector
  const [selectedId, setSelectedId] = useState(null);

  // Modals
  const [showProductPicker, setShowProductPicker] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [productResults, setProductResults] = useState([]);
  const [productLoading, setProductLoading] = useState(false);
  const fileInputRef = useRef(null);
  const pendingImageTileRef = useRef(null);  // which tile an upload targets

  // Derived: current tree we're editing (root or folder's children)
  const currentFolder = folderId ? rootTree.find(t => t.id === folderId) : null;
  const currentTree = currentFolder ? (currentFolder.children || []) : rootTree;
  const inFolder = !!currentFolder;

  // ── Load store + layout ────────────────────────────────────────────────
  // Silent catches were hiding empty-store scenarios from the UI — now we
  // surface errors via toast and render a helpful empty-state message
  // below when `stores.length === 0` after a successful fetch.
  const [storesError, setStoresError] = useState(null);
  useEffect(() => {
    setStoresError(null);
    getStores()
      .then(r => {
        const list = Array.isArray(r) ? r : (r?.stores || r?.data || []);
        setStores(list);
        if (!storeId && list.length > 0) setStoreId(list[0].id);
      })
      .catch(err => {
        const msg = err.response?.data?.error || err.message || 'Failed to load stores';
        console.error('[QuickButtons] getStores failed:', err);
        setStoresError(msg);
        toast.error(`Failed to load stores: ${msg}`);
      });
  }, []);

  const loadLayout = useCallback(async () => {
    if (!storeId) return;
    setLoading(true);
    try {
      const layout = await getQuickButtonLayout(storeId);
      setGridCols(layout.gridCols || 6);
      setRowHeight(layout.rowHeight || 56);
      setRootTree(Array.isArray(layout.tree) ? layout.tree : []);
      setDirty(false);
      setSelectedId(null);
      setFolderId(null);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to load layout');
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => { loadLayout(); }, [loadLayout]);

  // Warn on unsaved changes
  useEffect(() => {
    if (!dirty) return;
    const h = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const markDirty = () => setDirty(true);

  // ── Mutation helpers ───────────────────────────────────────────────────
  // `opts.markDirty = false` skips flipping the dirty flag — used by
  // `onLayoutChange` which react-grid-layout fires once on initial render
  // even when nothing actually moved (that spurious call was silently
  // locking the store selector via `disabled={dirty}`).
  const updateCurrentTree = (updater, opts = {}) => {
    if (inFolder) {
      setRootTree(prev => prev.map(t =>
        t.id === folderId
          ? { ...t, children: updater(t.children || []) }
          : t
      ));
    } else {
      setRootTree(prev => updater(prev));
    }
    if (opts.markDirty !== false) markDirty();
  };

  const addTile = (partial) => {
    const defaultW = partial.type === 'folder' ? 1 : 1;
    const defaultH = 1;
    const pos = nextFreePosition(currentTree, gridCols, defaultW, defaultH);
    const tile = {
      id: uid(),
      x: pos.x, y: pos.y, w: defaultW, h: defaultH,
      backgroundColor: null,
      textColor: null,
      ...partial,
    };
    updateCurrentTree(prev => [...prev, tile]);
    setSelectedId(tile.id);
  };

  const patchTile = (id, patch) => {
    updateCurrentTree(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t));
  };

  const deleteTile = (id) => {
    updateCurrentTree(prev => prev.filter(t => t.id !== id));
    setSelectedId(null);
  };

  // ── react-grid-layout integration ──────────────────────────────────────
  const gridLayout = currentTree.map(t => ({
    i: t.id, x: t.x, y: t.y, w: t.w, h: t.h,
    // Folders inside root get a special flag — drag handle can vary
  }));

  const onLayoutChange = (layout) => {
    // react-grid-layout fires this on EVERY render — including the initial
    // mount with zero user interaction. Detect real movement first; if the
    // positions match what we already have, skip both state update and the
    // dirty flag entirely (previously we'd mark dirty spuriously on mount,
    // which disabled the store <select> forever until a manual save).
    const byId = Object.fromEntries(layout.map(l => [l.i, l]));
    const changed = currentTree.some(t => {
      const l = byId[t.id];
      return l && (l.x !== t.x || l.y !== t.y || l.w !== t.w || l.h !== t.h);
    });
    if (!changed) return;
    updateCurrentTree(prev => prev.map(t => {
      const l = byId[t.id];
      if (!l) return t;
      return { ...t, x: l.x, y: l.y, w: l.w, h: l.h };
    }));
  };

  // ── Product picker ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!showProductPicker) return;
    // Backend requires a non-empty query; skip the call until user types 2+ chars.
    if (!productSearch || productSearch.trim().length < 2) {
      setProductResults([]);
      setProductLoading(false);
      return;
    }
    let cancelled = false;
    setProductLoading(true);
    const t = setTimeout(() => {
      searchCatalogProducts(productSearch.trim(), { storeId, limit: 30 })
        .then(r => {
          if (cancelled) return;
          // searchCatalogProducts returns { success, data: [...] }
          const rows = Array.isArray(r) ? r : (Array.isArray(r?.data) ? r.data : (r?.products || []));
          setProductResults(rows);
        })
        .catch(() => setProductResults([]))
        .finally(() => { if (!cancelled) setProductLoading(false); });
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [productSearch, showProductPicker, storeId]);

  const pickProduct = (p) => {
    addTile({
      type:        'product',
      productId:   p.id || p._id,
      productName: p.name,
      price:       Number(p.defaultRetailPrice || p.retailPrice || p.price || 0),
      upc:         p.upc || null,
      backgroundColor: '#10b981',
      textColor:   '#ffffff',
    });
    setShowProductPicker(false);
    setProductSearch('');
  };

  // ── Image upload ────────────────────────────────────────────────────────
  const handleUploadClick = (tileId) => {
    pendingImageTileRef.current = tileId;
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const tileId = pendingImageTileRef.current;
    try {
      const res = await uploadQuickButtonImage(file);
      const url = res.url;
      if (tileId) {
        // Patch existing tile with image
        patchTile(tileId, { imageUrl: url });
      } else {
        // Create new image tile
        addTile({ type: 'image', imageUrl: url, label: '' });
      }
      toast.success('Image uploaded');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Upload failed');
    } finally {
      pendingImageTileRef.current = null;
    }
  };

  // ── Save / reset ───────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!storeId) return;
    setSaving(true);
    try {
      await saveQuickButtonLayout({ storeId, gridCols, rowHeight, tree: rootTree });
      toast.success('Layout saved');
      setDirty(false);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!window.confirm('Reset to empty layout? This will clear all tiles for this store.')) return;
    try {
      await clearQuickButtonLayout(storeId);
      toast.success('Layout cleared');
      loadLayout();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Reset failed');
    }
  };

  // Selected tile for inspector
  const selectedTile = useMemo(
    () => currentTree.find(t => t.id === selectedId) || null,
    [currentTree, selectedId]
  );

  return (
    <div className="qbb-page">
      <div className="qbb-header">
        <div className="qbb-header-left">
          <div className="qbb-header-icon"><Layout size={22} /></div>
          <div>
            <h1 className="qbb-title">Quick Buttons Builder</h1>
            <p className="qbb-subtitle">
              Drag, resize, and customise the tile grid your cashiers see on the POS home screen.
              {inFolder && <> · Editing folder: <strong>{currentFolder.label || 'Folder'}</strong></>}
            </p>
          </div>
        </div>
        <div className="qbb-header-right">
          <select
            className="qbb-store-select"
            value={storeId}
            onChange={e => {
              // If switching stores with unsaved changes, confirm — the
              // beforeunload warning only fires on full navigations.
              if (dirty && !window.confirm('Discard unsaved changes and switch stores?')) return;
              setStoreId(e.target.value);
            }}
          >
            <option value="">— Select store —</option>
            {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button
            className="qbb-btn-secondary"
            onClick={handleReset}
            disabled={!storeId || saving}
            title="Clear the entire layout for this store"
          >
            <RotateCcw size={13} /> Reset
          </button>
          <button
            className="qbb-btn-primary"
            onClick={handleSave}
            disabled={!dirty || saving || !storeId}
          >
            {saving ? <><Loader size={13} className="qbb-spin" /> Saving…</> : <><Save size={13} /> Save</>}
          </button>
        </div>
      </div>

      {storesError ? (
        <div className="qbb-empty">
          <AlertCircle size={28} />
          <p><strong>Can't load stores.</strong> {storesError}</p>
          <p style={{ fontSize: '0.78rem', opacity: 0.7 }}>
            Open the browser DevTools console for details. Common causes: session expired,
            backend offline, or missing <code>stores.view</code> permission.
          </p>
        </div>
      ) : stores.length === 0 ? (
        <div className="qbb-empty">
          <AlertCircle size={28} />
          <p><strong>No stores in your organisation.</strong></p>
          <p style={{ fontSize: '0.85rem' }}>
            Quick Buttons are configured per store and shared across every register at
            that store (no per-station selection needed).
          </p>
          <p style={{ fontSize: '0.85rem' }}>
            Add a store at <a href="/portal/account?tab=stores" style={{ color: 'var(--brand-primary, #7ac143)' }}>Account → Stores</a>, then return here.
          </p>
        </div>
      ) : !storeId ? (
        <div className="qbb-empty">
          <AlertCircle size={28} />
          <p>Select a store above to begin editing its quick-button layout.</p>
        </div>
      ) : loading ? (
        <div className="qbb-loading"><Loader size={18} className="qbb-spin" /> Loading layout…</div>
      ) : (
        <div className="qbb-shell">
          {/* ── Palette (left) ── */}
          <aside className="qbb-palette">
            <div className="qbb-palette-head">Add Tile</div>
            <button className="qbb-palette-btn" onClick={() => setShowProductPicker(true)}>
              <Package size={15} /> <span>Product</span>
            </button>
            {!inFolder && (
              <button className="qbb-palette-btn" onClick={() => addTile({
                type: 'folder', label: 'New Folder', emoji: '📁', color: '#7ac143', children: [],
              })}>
                <Folder size={15} /> <span>Folder</span>
              </button>
            )}
            <button className="qbb-palette-btn" onClick={() => addTile({
              type: 'action', actionKey: 'discount', label: 'Discount',
              backgroundColor: '#f59e0b', textColor: '#ffffff',
            })}>
              <Zap size={15} /> <span>Action</span>
            </button>
            <button className="qbb-palette-btn" onClick={() => addTile({
              type: 'text', label: 'Label', backgroundColor: null, textColor: null,
            })}>
              <Type size={15} /> <span>Text label</span>
            </button>
            <button className="qbb-palette-btn" onClick={() => handleUploadClick(null)}>
              <ImageIcon size={15} /> <span>Image tile</span>
            </button>

            <div className="qbb-palette-divider" />

            <div className="qbb-palette-head">Grid</div>
            <label className="qbb-palette-row">
              <span>Columns</span>
              <input
                type="number"
                min={3}
                max={12}
                value={gridCols}
                onChange={e => { setGridCols(Math.max(3, Math.min(12, Number(e.target.value) || 6))); markDirty(); }}
                disabled={inFolder}
              />
            </label>
            <label className="qbb-palette-row">
              <span>Tile height (px)</span>
              <input
                type="number"
                min={40}
                max={160}
                step={8}
                value={rowHeight}
                onChange={e => { setRowHeight(Math.max(40, Math.min(160, Number(e.target.value) || 56))); markDirty(); }}
                disabled={inFolder}
              />
            </label>

            {inFolder && (
              <>
                <div className="qbb-palette-divider" />
                <button className="qbb-palette-btn qbb-palette-btn--back" onClick={() => { setFolderId(null); setSelectedId(null); }}>
                  <ArrowLeft size={15} /> <span>Back to root</span>
                </button>
              </>
            )}
          </aside>

          {/* ── Grid (center) ── */}
          <GridCanvas
            tiles={currentTree}
            gridLayout={gridLayout}
            gridCols={gridCols}
            rowHeight={rowHeight}
            onLayoutChange={onLayoutChange}
            selectedId={selectedId}
            setSelectedId={setSelectedId}
            setFolderId={setFolderId}
            deleteTile={deleteTile}
            inFolder={inFolder}
          />

          {/* ── Inspector (right) ── */}
          <aside className="qbb-inspector">
            {!selectedTile ? (
              <div className="qbb-inspector-empty">
                <Edit3 size={20} />
                <p>Select a tile to edit its properties.</p>
              </div>
            ) : (
              <TileInspector
                tile={selectedTile}
                onPatch={(patch) => patchTile(selectedTile.id, patch)}
                onDelete={() => deleteTile(selectedTile.id)}
                onUploadImage={() => handleUploadClick(selectedTile.id)}
                onOpenFolder={() => { setFolderId(selectedTile.id); setSelectedId(null); }}
                onChooseProduct={() => setShowProductPicker(true)}
                inFolder={inFolder}
              />
            )}
          </aside>
        </div>
      )}

      {/* Hidden file input for uploads */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleFileSelected}
      />

      {/* Product picker modal */}
      {showProductPicker && (
        <ProductPickerModal
          search={productSearch}
          onSearchChange={setProductSearch}
          results={productResults}
          loading={productLoading}
          onPick={pickProduct}
          onClose={() => { setShowProductPicker(false); setProductSearch(''); }}
        />
      )}
    </div>
  );
}

// ── TileContent ──────────────────────────────────────────────────────────
function TileContent({ tile }) {
  if (tile.type === 'product') {
    return (
      <div className="qbb-tile-content">
        <div className="qbb-tile-label">{tile.productName || 'Product'}</div>
        {tile.price != null && (
          <div className="qbb-tile-sub">${Number(tile.price).toFixed(2)}</div>
        )}
      </div>
    );
  }
  if (tile.type === 'folder') {
    return (
      <div className="qbb-tile-content">
        <div className="qbb-tile-emoji">{tile.emoji || '📁'}</div>
        <div className="qbb-tile-label">{tile.label || 'Folder'}</div>
      </div>
    );
  }
  if (tile.type === 'action') {
    const a = ACTION_CATALOG.find(x => x.key === tile.actionKey);
    return (
      <div className="qbb-tile-content">
        <div className="qbb-tile-icon">{a?.icon || <Zap size={18} />}</div>
        <div className="qbb-tile-label">{tile.label || a?.label || tile.actionKey}</div>
      </div>
    );
  }
  if (tile.type === 'text') {
    return (
      <div className="qbb-tile-content">
        <div className="qbb-tile-label qbb-tile-label--text">{tile.label || 'Label'}</div>
      </div>
    );
  }
  if (tile.type === 'image') {
    return (
      <div className="qbb-tile-content qbb-tile-content--image">
        {tile.label && <div className="qbb-tile-label qbb-tile-image-label">{tile.label}</div>}
      </div>
    );
  }
  return null;
}

// ── TileInspector ────────────────────────────────────────────────────────
function TileInspector({ tile, onPatch, onDelete, onUploadImage, onOpenFolder, onChooseProduct, inFolder }) {
  return (
    <div className="qbb-inspector-body">
      <div className="qbb-inspector-head">
        <span className="qbb-inspector-type">{tile.type.toUpperCase()}</span>
        <button className="qbb-inspector-del" onClick={onDelete} title="Delete tile">
          <Trash2 size={13} />
        </button>
      </div>

      {/* Label — applies to most types */}
      {(tile.type === 'folder' || tile.type === 'action' || tile.type === 'text' || tile.type === 'image') && (
        <InspectorField label="Label">
          <input
            type="text"
            value={tile.label || ''}
            onChange={e => onPatch({ label: e.target.value })}
            maxLength={30}
          />
        </InspectorField>
      )}

      {/* Product-specific */}
      {tile.type === 'product' && (
        <>
          <InspectorField label="Product">
            <div className="qbb-inline-row">
              <span className="qbb-inline-text">{tile.productName || '(none)'}</span>
              <button className="qbb-mini-btn" onClick={onChooseProduct}><Search size={12} /> Change</button>
            </div>
          </InspectorField>
          {tile.price != null && (
            <InspectorField label="Price">
              <input
                type="number" step="0.01" min="0"
                value={tile.price}
                onChange={e => onPatch({ price: parseFloat(e.target.value) || 0 })}
              />
            </InspectorField>
          )}
        </>
      )}

      {/* Folder-specific */}
      {tile.type === 'folder' && (
        <>
          <InspectorField label="Emoji">
            <input
              type="text"
              value={tile.emoji || ''}
              onChange={e => onPatch({ emoji: e.target.value.slice(0, 4) })}
              placeholder="📁"
              maxLength={4}
            />
          </InspectorField>
          <button className="qbb-full-btn" onClick={onOpenFolder}>
            <Folder size={13} /> Open folder ({(tile.children || []).length} item{(tile.children || []).length === 1 ? '' : 's'})
          </button>
        </>
      )}

      {/* Action-specific */}
      {tile.type === 'action' && (
        <InspectorField label="Action">
          <select
            value={tile.actionKey || 'discount'}
            onChange={e => {
              const a = ACTION_CATALOG.find(x => x.key === e.target.value);
              onPatch({ actionKey: e.target.value, label: tile.label || a?.label });
            }}
          >
            {ACTION_CATALOG.map(a => (
              <option key={a.key} value={a.key}>{a.label}</option>
            ))}
          </select>
        </InspectorField>
      )}

      {/* Image-specific */}
      {tile.type === 'image' && (
        <>
          <button className="qbb-full-btn" onClick={onUploadImage}>
            <Upload size={13} /> {tile.imageUrl ? 'Replace image' : 'Upload image'}
          </button>
          {tile.imageUrl && (
            <div className="qbb-image-preview">
              <img src={tile.imageUrl} alt="preview" />
            </div>
          )}
        </>
      )}

      {/* Image background for non-image types too */}
      {tile.type !== 'image' && tile.type !== 'text' && (
        <InspectorField label="Image background (optional)">
          <div className="qbb-inline-row">
            <button className="qbb-mini-btn" onClick={onUploadImage}>
              <Upload size={12} /> {tile.imageUrl ? 'Replace' : 'Upload'}
            </button>
            {tile.imageUrl && (
              <button className="qbb-mini-btn qbb-mini-btn--danger" onClick={() => onPatch({ imageUrl: null })}>
                <X size={12} /> Remove
              </button>
            )}
          </div>
        </InspectorField>
      )}

      {/* Colors */}
      <InspectorField label="Background colour">
        <div className="qbb-swatches">
          <button
            className={`qbb-swatch qbb-swatch--none ${!tile.backgroundColor ? 'qbb-swatch--active' : ''}`}
            onClick={() => onPatch({ backgroundColor: null })}
            title="Default"
          />
          {COLOR_SWATCHES.map(c => (
            <button
              key={c}
              className={`qbb-swatch ${tile.backgroundColor === c ? 'qbb-swatch--active' : ''}`}
              style={{ background: c }}
              onClick={() => onPatch({ backgroundColor: c })}
            />
          ))}
          {/* Custom colour picker — native <input type="color"> so every
              browser gets its native eyedropper / hex input. The value
              only patches on `input`/`change` so rapid slider scrubs
              don't spam re-renders. */}
          <label
            className={`qbb-swatch qbb-swatch--custom ${
              tile.backgroundColor && !COLOR_SWATCHES.includes(tile.backgroundColor)
                ? 'qbb-swatch--active' : ''
            }`}
            style={{
              background: tile.backgroundColor && !COLOR_SWATCHES.includes(tile.backgroundColor)
                ? tile.backgroundColor : undefined,
            }}
            title="Custom colour"
          >
            <input
              type="color"
              value={tile.backgroundColor || '#3d56b5'}
              onChange={e => onPatch({ backgroundColor: e.target.value })}
            />
            {!tile.backgroundColor || COLOR_SWATCHES.includes(tile.backgroundColor) ? '+' : null}
          </label>
        </div>
      </InspectorField>
      <InspectorField label="Text colour">
        <div className="qbb-swatches">
          <button
            className={`qbb-swatch qbb-swatch--none ${!tile.textColor ? 'qbb-swatch--active' : ''}`}
            onClick={() => onPatch({ textColor: null })}
            title="Default"
          />
          <button
            className={`qbb-swatch ${tile.textColor === '#ffffff' ? 'qbb-swatch--active' : ''}`}
            style={{ background: '#ffffff', border: '1px solid #d1d5db' }}
            onClick={() => onPatch({ textColor: '#ffffff' })}
            title="White"
          />
          <button
            className={`qbb-swatch ${tile.textColor === '#0f1117' ? 'qbb-swatch--active' : ''}`}
            style={{ background: '#0f1117' }}
            onClick={() => onPatch({ textColor: '#0f1117' })}
            title="Black"
          />
          <label
            className={`qbb-swatch qbb-swatch--custom ${
              tile.textColor && !['#ffffff', '#0f1117'].includes(tile.textColor)
                ? 'qbb-swatch--active' : ''
            }`}
            style={{
              background: tile.textColor && !['#ffffff', '#0f1117'].includes(tile.textColor)
                ? tile.textColor : undefined,
            }}
            title="Custom colour"
          >
            <input
              type="color"
              value={tile.textColor || '#3d56b5'}
              onChange={e => onPatch({ textColor: e.target.value })}
            />
            {!tile.textColor || ['#ffffff', '#0f1117'].includes(tile.textColor) ? '+' : null}
          </label>
        </div>
      </InspectorField>

      <div className="qbb-inspector-meta">
        Position: {tile.x},{tile.y} · Size: {tile.w}×{tile.h}
      </div>
    </div>
  );
}

function InspectorField({ label, children }) {
  return (
    <div className="qbb-field">
      <label className="qbb-field-label">{label}</label>
      {children}
    </div>
  );
}

// ── GridCanvas ───────────────────────────────────────────────────────────
// Uses the legacy adapter's WidthProvider — auto-measures parent width so
// the grid fills the available container. Flat props (rowHeight, cols,
// margin, compactType, preventCollision, draggableCancel) all work again.
function GridCanvas({
  tiles, gridLayout, gridCols, rowHeight, onLayoutChange,
  selectedId, setSelectedId, setFolderId, deleteTile, inFolder,
}) {
  // Gap scales with tile size so small tiles don't float apart and large
  // tiles don't feel cramped. ~1/8 of rowHeight, clamped to a sane range.
  const gap = Math.max(6, Math.min(18, Math.round(rowHeight / 8)));
  return (
    <main className="qbb-grid-wrap">
      {tiles.length === 0 ? (
        <div className="qbb-grid-empty">
          <Layout size={32} />
          <p>{inFolder ? 'This folder is empty.' : 'N/A — no tiles added yet.'} Click a button on the left to add one.</p>
        </div>
      ) : (
        <GridLayoutWithWidth
          className="qbb-grid"
          layout={gridLayout}
          cols={gridCols}
          rowHeight={rowHeight}
          margin={[gap, gap]}
          compactType={null}
          preventCollision={true}
          isBounded={true}
          onLayoutChange={onLayoutChange}
          onDragStart={(l, oldItem) => setSelectedId(oldItem.i)}
          onResizeStart={(l, oldItem) => setSelectedId(oldItem.i)}
          draggableCancel=".qbb-tile-action"
        >
          {tiles.map(tile => (
            <div
              key={tile.id}
              className={`qbb-tile qbb-tile--${tile.type} ${selectedId === tile.id ? 'qbb-tile--selected' : ''}`}
              onClick={() => setSelectedId(tile.id)}
              onDoubleClick={() => {
                if (tile.type === 'folder') {
                  setFolderId(tile.id);
                  setSelectedId(null);
                }
              }}
              style={{
                backgroundColor: tile.backgroundColor || undefined,
                color:           tile.textColor       || undefined,
                backgroundImage: tile.imageUrl ? `url(${tile.imageUrl})` : undefined,
              }}
            >
              <TileContent tile={tile} />
              <button
                className="qbb-tile-action qbb-tile-delete"
                onClick={(e) => { e.stopPropagation(); deleteTile(tile.id); }}
                title="Delete tile"
              >
                <Trash2 size={11} />
              </button>
              {tile.type === 'folder' && (
                <div className="qbb-tile-folder-badge">
                  {(tile.children || []).length} item{(tile.children || []).length === 1 ? '' : 's'}
                  <span className="qbb-tile-folder-hint">· double-click to open</span>
                </div>
              )}
            </div>
          ))}
        </GridLayoutWithWidth>
      )}
    </main>
  );
}

// ── ProductPickerModal ───────────────────────────────────────────────────
function ProductPickerModal({ search, onSearchChange, results, loading, onPick, onClose }) {
  return (
    <div className="qbb-modal-backdrop" onClick={onClose}>
      <div className="qbb-modal" onClick={e => e.stopPropagation()}>
        <div className="qbb-modal-head">
          <h3>Choose Product</h3>
          <button onClick={onClose} className="qbb-modal-close"><X size={16} /></button>
        </div>
        <div className="qbb-modal-search">
          <Search size={13} className="qbb-modal-search-icon" />
          <input
            type="text"
            placeholder="Search by name, UPC, brand…"
            value={search}
            onChange={e => onSearchChange(e.target.value)}
            autoFocus
          />
        </div>
        <div className="qbb-modal-results">
          {loading ? (
            <div className="qbb-modal-loading"><Loader size={14} className="qbb-spin" /> Searching…</div>
          ) : results.length === 0 ? (
            <div className="qbb-modal-empty">{search.trim() ? 'No products match' : 'Start typing to search'}</div>
          ) : (
            results.map(p => (
              <button key={p.id || p._id} className="qbb-product-row" onClick={() => onPick(p)}>
                <div className="qbb-product-row-name">{p.name}</div>
                <div className="qbb-product-row-meta">
                  {p.upc && <span>{p.upc}</span>}
                  <span>${Number(p.defaultRetailPrice || p.retailPrice || 0).toFixed(2)}</span>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
