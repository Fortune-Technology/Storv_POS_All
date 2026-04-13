/**
 * QuickAccess — Back-office management of quick-access folders for the POS screen.
 * Folders and their product items are stored inside the store's POS config JSON.
 * Cashier app reads them via usePOSConfig → posConfig.quickFolders.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { LayoutGrid, Plus, Pencil, Trash2, X, Check, Search, ChevronDown, Info, GripVertical, Zap } from 'lucide-react';
import { getStores } from '../services/api';
import { searchCatalogProducts } from '../services/api';
import api from '../services/api';

import { fmtMoney as fmt$ } from '../utils/formatters';
import './QuickAccess.css';

// ── Helpers ────────────────────────────────────────────────────────────────
const nanoid = () => Math.random().toString(36).slice(2, 10);

const FOLDER_COLORS = [
  '#34d399', '#60a5fa', '#f59e0b', '#f87171',
  '#a78bfa', '#fb923c', '#38bdf8', '#4ade80',
  '#e879f9', '#facc15',
];

// ── FolderCard ─────────────────────────────────────────────────────────────
function FolderCard({ folder, onUpdate, onDelete }) {
  const [expanded,     setExpanded]     = useState(false);
  const [editName,     setEditName]     = useState(folder.name);
  const [editEmoji,    setEditEmoji]    = useState(folder.emoji || '📦');
  const [editColor,    setEditColor]    = useState(folder.color || '#34d399');
  const [searchQ,      setSearchQ]      = useState('');
  const [searchRes,    setSearchRes]    = useState([]);
  const [searching,    setSearching]    = useState(false);
  const [showSearch,   setShowSearch]   = useState(false);

  const items = folder.items || [];

  const saveFolder = () => {
    onUpdate({ ...folder, name: editName, emoji: editEmoji, color: editColor });
  };

  const doSearch = useCallback(async (q) => {
    if (!q || q.length < 2) { setSearchRes([]); return; }
    setSearching(true);
    try {
      const res = await searchCatalogProducts(q, { limit: 10 });
      const list = Array.isArray(res) ? res : (res?.products || res?.data || []);
      setSearchRes(list.slice(0, 10));
    } catch { setSearchRes([]); }
    finally { setSearching(false); }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => doSearch(searchQ), 300);
    return () => clearTimeout(t);
  }, [searchQ, doSearch]);

  const addItem = (product) => {
    const already = items.some(i => i.productId === product.id);
    if (already) return;
    const newItems = [...items, {
      productId: product.id,
      name:      product.name || product.description || 'Product',
      price:     Number(product.retailPrice || product.price || 0),
      barcode:   product.upc || product.barcode || '',
    }];
    onUpdate({ ...folder, items: newItems });
    setSearchQ('');
    setSearchRes([]);
  };

  const removeItem = (productId) => {
    onUpdate({ ...folder, items: items.filter(i => i.productId !== productId) });
  };

  const bgOpacity = editColor + '22';

  return (
    <div className={`qa-folder-card${expanded ? ' qa-folder-card--editing' : ''}`}>
      {/* Folder header row */}
      <div className="qa-folder-header" onClick={() => setExpanded(e => !e)}>
        <div className="qa-folder-emoji" style={{ background: bgOpacity, border: `1px solid ${editColor}44` }}>
          {editEmoji}
        </div>
        <div className="qa-folder-info">
          <p className="qa-folder-name">{folder.name}</p>
          <p className="qa-folder-meta">{items.length} product{items.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="qa-folder-actions" onClick={e => e.stopPropagation()}>
          <button className="qa-btn-icon" onClick={() => setExpanded(e => !e)} title="Edit folder">
            <Pencil size={12} />
          </button>
          <button className="qa-btn-icon qa-btn-icon--danger" onClick={() => onDelete(folder.id)} title="Delete folder">
            <Trash2 size={12} />
          </button>
        </div>
        <ChevronDown size={14} style={{ color: 'var(--text-muted)', transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', flexShrink: 0 }} />
      </div>

      {/* Expanded edit panel */}
      {expanded && (
        <div className="qa-folder-edit">
          {/* Name + emoji + color row */}
          <div className="qa-edit-row">
            <div className="qa-edit-field">
              <span className="qa-edit-label">Emoji</span>
              <input
                className="qa-edit-input qa-edit-input--emoji"
                value={editEmoji}
                onChange={e => setEditEmoji(e.target.value)}
                maxLength={2}
              />
            </div>
            <div className="qa-edit-field">
              <span className="qa-edit-label">Folder Name</span>
              <input
                className="qa-edit-input qa-edit-input--name"
                value={editName}
                onChange={e => setEditName(e.target.value)}
                placeholder="e.g. Fruits & Vegetables"
              />
            </div>
            <div className="qa-edit-field">
              <span className="qa-edit-label">Color</span>
              <div className="qa-colors">
                {FOLDER_COLORS.map(c => (
                  <div
                    key={c}
                    className={`qa-color-swatch${editColor === c ? ' qa-color-swatch--active' : ''}`}
                    style={{ background: c }}
                    onClick={() => setEditColor(c)}
                  />
                ))}
              </div>
            </div>
            <div className="qa-edit-field" style={{ justifyContent: 'flex-end' }}>
              <button
                style={{
                  height: 34, padding: '0 1rem',
                  background: 'rgba(99,102,241,0.15)',
                  border: '1px solid rgba(99,102,241,0.35)',
                  borderRadius: 7, color: 'var(--accent-primary, #6366f1)',
                  fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 5,
                }}
                onClick={saveFolder}
              >
                <Check size={13} /> Apply
              </button>
            </div>
          </div>

          {/* Products section */}
          <div className="qa-items-header">
            <span className="qa-items-label">Products in this folder ({items.length})</span>
            <button className="qa-btn-add-item" onClick={() => setShowSearch(s => !s)}>
              <Plus size={11} /> Add Product
            </button>
          </div>

          {/* Product search */}
          {showSearch && (
            <>
              <div className="qa-product-search">
                <Search size={13} className="qa-search-icon" />
                <input
                  className="qa-product-search-input"
                  placeholder="Search product name or barcode…"
                  value={searchQ}
                  onChange={e => setSearchQ(e.target.value)}
                  autoFocus
                />
              </div>
              {searchRes.length > 0 && (
                <div className="qa-search-results">
                  {searchRes.map(p => (
                    <div
                      key={p.id}
                      className="qa-search-result"
                      onClick={() => addItem(p)}
                    >
                      <span>{p.name || p.description}</span>
                      <span className="qa-search-result-price">{fmt$(p.retailPrice || p.price)}</span>
                    </div>
                  ))}
                </div>
              )}
              {searching && (
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', padding: '4px 0' }}>Searching…</div>
              )}
            </>
          )}

          {/* Items list */}
          {items.length > 0 ? (
            <div className="qa-items-list">
              {items.map(item => (
                <div key={item.productId} className="qa-item-chip">
                  <span className="qa-item-chip-name">{item.name}</span>
                  <span className="qa-item-chip-price">{fmt$(item.price)}</span>
                  <button className="qa-item-remove" onClick={() => removeItem(item.productId)}>
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontStyle: 'italic', padding: '4px 0' }}>
              No products yet — search above to add products to this folder.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────
export default function QuickAccess({ embedded }) {
  const [stores,   setStores]   = useState([]);
  const [storeId,  setStoreId]  = useState(localStorage.getItem('activeStoreId') || '');
  const [folders,  setFolders]  = useState([]);
  const [loading,  setLoading]  = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState('');
  const [dirty,    setDirty]    = useState(false);

  // Load stores
  useEffect(() => {
    getStores().then(res => {
      const list = Array.isArray(res) ? res : (res?.data || []);
      setStores(list);
      if (!storeId && list.length > 0) setStoreId(list[0].id || list[0]._id);
    }).catch(() => {});
  }, []);

  // Load config when storeId changes
  const loadConfig = useCallback(async () => {
    if (!storeId) return;
    setLoading(true); setError('');
    try {
      const res = await api.get('/pos-terminal/config', { params: { storeId } });
      setFolders(res.data?.quickFolders || []);
      setDirty(false);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load config');
    } finally { setLoading(false); }
  }, [storeId]);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  const addFolder = () => {
    const newFolder = {
      id:        nanoid(),
      name:      'New Folder',
      emoji:     '📦',
      color:     FOLDER_COLORS[folders.length % FOLDER_COLORS.length],
      sortOrder: folders.length,
      items:     [],
    };
    setFolders(f => [...f, newFolder]);
    setDirty(true);
  };

  const updateFolder = (updated) => {
    setFolders(f => f.map(folder => folder.id === updated.id ? updated : folder));
    setDirty(true);
  };

  const deleteFolder = (id) => {
    setFolders(f => f.filter(folder => folder.id !== id));
    setDirty(true);
  };

  const handleSave = async () => {
    if (!storeId) return;
    setSaving(true); setError('');
    try {
      // Load current config first, then merge quickFolders
      const configRes = await api.get('/pos-terminal/config', { params: { storeId } });
      const currentConfig = configRes.data || {};
      await api.put('/pos-terminal/config', {
        storeId,
        config: { ...currentConfig, quickFolders: folders },
      });
      setDirty(false);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save');
    } finally { setSaving(false); }
  };

  const content = (
    <>
      <div className="qa-page">

        {/* Header */}
        <div className="p-header">
          <div className="p-header-left">
            <div className="p-header-icon">
              <Zap size={22} />
            </div>
            <div>
              <h1 className="p-title">Quick Access Folders</h1>
              <p className="p-subtitle">Create product folders for fast access at the POS terminal</p>
            </div>
          </div>
          <div className="p-header-actions">
            {stores.length > 1 && (
              <select
                className="qa-store-select"
                value={storeId}
                onChange={e => setStoreId(e.target.value)}
              >
                {stores.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            )}
            <button className="qa-btn-add" onClick={addFolder} disabled={loading}>
              <Plus size={14} /> Add Folder
            </button>
            {dirty && (
              <button className="qa-btn-save" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : <><Check size={14} /> Save Changes</>}
              </button>
            )}
          </div>
        </div>

        {/* Info */}
        <div className="qa-info">
          <Info size={14} color="var(--accent-primary, #6366f1)" style={{ flexShrink: 0, marginTop: 1 }} />
          <span>
            Folders appear as large buttons on the POS screen. Cashiers can tap a folder to see its products and
            add them to cart in one tap. Examples: Fruits, Vegetables, Limes &amp; Lemons, Ice (for liquor stores), Daily Specials.
          </span>
        </div>

        {error && (
          <div className="qa-error">
            <span>{error}</span>
            <button style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer' }} onClick={() => setError('')}><X size={14} /></button>
          </div>
        )}

        {loading ? (
          <div className="qa-empty">Loading configuration…</div>
        ) : folders.length === 0 ? (
          <div className="qa-empty">
            <LayoutGrid size={32} style={{ marginBottom: 12, opacity: 0.2 }} /><br />
            No quick access folders yet.<br />
            <span style={{ fontSize: '0.8rem' }}>
              Click <strong style={{ color: 'var(--text-secondary)' }}>Add Folder</strong> to create your first folder — like "Fruits", "Beverages", or "Daily Specials".
            </span>
          </div>
        ) : (
          <div className="qa-folders">
            {folders.map(folder => (
              <FolderCard
                key={folder.id}
                folder={folder}
                onUpdate={updateFolder}
                onDelete={deleteFolder}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );

  if (embedded) return <div className="p-tab-content">{content}</div>;

  return (
    <div className="p-page">
      {content}
    </div>
  );
}
