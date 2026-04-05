/**
 * Promotions.jsx — Offers, Deals & Promotions Management
 *
 * Promo types: sale | bogo | volume | mix_match | combo
 * Each type has its own dynamic dealConfig form.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Tag, Percent, Gift, ShoppingBag, Shuffle, Link2,
  Plus, Pencil, Trash2, X, ChevronRight, Search,
  Calendar, ToggleLeft, ToggleRight, AlertCircle,
  Check, Copy, Zap, TrendingDown, Package, Layers,
  Clock, Star, RefreshCw,
} from 'lucide-react';
import { toast } from 'react-toastify';
import Sidebar from '../components/Sidebar';
import {
  getCatalogPromotions,
  createCatalogPromotion,
  updateCatalogPromotion,
  deleteCatalogPromotion,
  getMasterProducts,
  getDepartments,
} from '../services/api';

// ── Constants ─────────────────────────────────────────────────────────────────

const PROMO_TYPES = [
  {
    value: 'sale',
    label: 'Sale / Discount',
    icon: Tag,
    color: '#f59e0b',
    bg: 'rgba(245,158,11,0.12)',
    desc: '% off, $ off, or fixed price on selected items',
    badge: 'SALE',
  },
  {
    value: 'bogo',
    label: 'BOGO',
    icon: Gift,
    color: '#ec4899',
    bg: 'rgba(236,72,153,0.12)',
    desc: 'Buy X get Y free or discounted',
    badge: 'BOGO',
  },
  {
    value: 'volume',
    label: 'Volume / Qty Tiers',
    icon: TrendingDown,
    color: '#8b5cf6',
    bg: 'rgba(139,92,246,0.12)',
    desc: 'Buy more, save more — tiered pricing',
    badge: 'VOL',
  },
  {
    value: 'mix_match',
    label: 'Mix & Match',
    icon: Shuffle,
    color: '#06b6d4',
    bg: 'rgba(6,182,212,0.12)',
    desc: 'Any N items from a group for a bundle price',
    badge: 'MIX',
  },
  {
    value: 'combo',
    label: 'Combo Deal',
    icon: Link2,
    color: '#f97316',
    bg: 'rgba(249,115,22,0.12)',
    desc: 'Buy specific products together to unlock a discount',
    badge: 'COMBO',
  },
];

const BLANK_FORM = {
  name: '',
  promoType: 'sale',
  description: '',
  productIds: [],
  departmentIds: [],
  dealConfig: {},
  badgeLabel: '',
  badgeColor: '#f59e0b',
  startDate: '',
  endDate: '',
  active: true,
};

const BLANK_SALE_CONFIG    = { discountType: 'percent', discountValue: '', minQty: 1 };
const BLANK_BOGO_CONFIG    = { buyQty: 1, getQty: 1, getDiscount: 100, maxSets: '' };
const BLANK_VOLUME_CONFIG  = { tiers: [{ minQty: 2, discountType: 'percent', discountValue: '' }] };
const BLANK_MIXMATCH_CONFIG= { groupSize: 2, bundlePrice: '' };
const BLANK_COMBO_CONFIG   = {
  requiredGroups: [{ productIds: [], minQty: 1 }, { productIds: [], minQty: 1 }],
  discountType: 'percent',
  discountValue: '',
};

function defaultConfig(type) {
  if (type === 'sale')      return { ...BLANK_SALE_CONFIG };
  if (type === 'bogo')      return { ...BLANK_BOGO_CONFIG };
  if (type === 'volume')    return { ...BLANK_VOLUME_CONFIG };
  if (type === 'mix_match') return { ...BLANK_MIXMATCH_CONFIG };
  if (type === 'combo')     return JSON.parse(JSON.stringify(BLANK_COMBO_CONFIG));
  return {};
}

// ─────────────────────────────────────────────────────────────────────────────
export default function Promotions() {
  const [promos,    setPromos]    = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [search,    setSearch]    = useState('');
  const [filterType, setFilterType] = useState('all');
  const [filterActive, setFilterActive] = useState('all');

  // Panel
  const [panelOpen, setPanelOpen] = useState(false);
  const [editing,   setEditing]   = useState(null); // promo object or null
  const [saving,    setSaving]    = useState(false);
  const [deleting,  setDeleting]  = useState(null);

  // Form
  const [form,      setForm]      = useState(BLANK_FORM);
  const [cfg,       setCfg]       = useState(BLANK_SALE_CONFIG);
  const [formTab,   setFormTab]   = useState('basic'); // basic | scope | deal | display

  // Scope selectors
  const [products,  setProducts]  = useState([]);
  const [depts,     setDepts]     = useState([]);
  const [prodSearch, setProdSearch] = useState('');

  // ── Load ────────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getCatalogPromotions();
      setPromos(Array.isArray(res) ? res : (res?.data || []));
    } catch { toast.error('Failed to load promotions'); }
    finally  { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Load products + departments for scope picker
  useEffect(() => {
    getMasterProducts({ limit: 500, active: true })
      .then(r => setProducts(Array.isArray(r) ? r : (r?.data || [])))
      .catch(() => {});
    getDepartments()
      .then(r => setDepts(Array.isArray(r) ? r : (r?.data || [])))
      .catch(() => {});
  }, []);

  // ── Panel helpers ───────────────────────────────────────────────────────────
  const openNew = () => {
    setEditing(null);
    const f = { ...BLANK_FORM };
    setForm(f);
    setCfg(defaultConfig('sale'));
    setFormTab('details');
    setPanelOpen(true);
  };

  const openEdit = (p) => {
    setEditing(p);
    setForm({
      name:          p.name         || '',
      promoType:     p.promoType    || 'sale',
      description:   p.description  || '',
      productIds:    p.productIds   || [],
      departmentIds: p.departmentIds|| [],
      dealConfig:    p.dealConfig   || {},
      badgeLabel:    p.badgeLabel   || '',
      badgeColor:    p.badgeColor   || '#f59e0b',
      startDate:     p.startDate    ? p.startDate.slice(0,10) : '',
      endDate:       p.endDate      ? p.endDate.slice(0,10)   : '',
      active:        p.active       ?? true,
    });
    // Populate cfg from saved dealConfig, merging with blank defaults
    const dc = p.dealConfig || {};
    if (p.promoType === 'sale')      setCfg({ ...BLANK_SALE_CONFIG,     ...dc });
    else if (p.promoType === 'bogo') setCfg({ ...BLANK_BOGO_CONFIG,     ...dc });
    else if (p.promoType === 'volume') setCfg({ ...BLANK_VOLUME_CONFIG, ...dc });
    else if (p.promoType === 'mix_match') setCfg({ ...BLANK_MIXMATCH_CONFIG, ...dc });
    else if (p.promoType === 'combo')
      setCfg({ ...JSON.parse(JSON.stringify(BLANK_COMBO_CONFIG)), ...dc });
    else setCfg(dc);
    setFormTab('details');
    setPanelOpen(true);
  };

  const closePanel = () => { setPanelOpen(false); setEditing(null); };

  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleTypeChange = (t) => {
    setF('promoType', t);
    setCfg(defaultConfig(t));
    // Auto-set badge color
    const tp = PROMO_TYPES.find(x => x.value === t);
    if (tp) setF('badgeColor', tp.color);
  };

  // ── Save ────────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Promotion name is required'); return; }
    setSaving(true);
    const payload = {
      ...form,
      dealConfig: cfg,
      startDate: form.startDate || null,
      endDate:   form.endDate   || null,
    };
    try {
      if (editing) {
        await updateCatalogPromotion(editing.id, payload);
        toast.success('Promotion updated');
      } else {
        await createCatalogPromotion(payload);
        toast.success('Promotion created');
      }
      closePanel();
      load();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  // ── Delete ──────────────────────────────────────────────────────────────────
  const handleDelete = async (promo) => {
    if (!window.confirm(`Delete "${promo.name}"? This cannot be undone.`)) return;
    setDeleting(promo.id);
    try {
      await deleteCatalogPromotion(promo.id);
      toast.success('Promotion deleted');
      load();
    } catch { toast.error('Delete failed'); }
    finally { setDeleting(null); }
  };

  // ── Quick toggle active ─────────────────────────────────────────────────────
  const toggleActive = async (promo) => {
    try {
      await updateCatalogPromotion(promo.id, { active: !promo.active });
      setPromos(ps => ps.map(p => p.id === promo.id ? { ...p, active: !p.active } : p));
    } catch { toast.error('Update failed'); }
  };

  // ── Filter ──────────────────────────────────────────────────────────────────
  const filtered = promos.filter(p => {
    const q = search.toLowerCase();
    if (q && !p.name?.toLowerCase().includes(q) && !p.badgeLabel?.toLowerCase().includes(q)) return false;
    if (filterType !== 'all' && p.promoType !== filterType) return false;
    if (filterActive === 'active' && !p.active)   return false;
    if (filterActive === 'inactive' && p.active)  return false;
    return true;
  });

  // ── Stats ───────────────────────────────────────────────────────────────────
  const stats = {
    total:    promos.length,
    active:   promos.filter(p => p.active).length,
    sale:     promos.filter(p => p.promoType === 'sale').length,
    bogo:     promos.filter(p => p.promoType === 'bogo').length,
    volume:   promos.filter(p => p.promoType === 'volume').length,
    mix:      promos.filter(p => p.promoType === 'mix_match').length,
    combo:    promos.filter(p => p.promoType === 'combo').length,
  };

  const now = new Date();
  const isExpired = (p) => p.endDate && new Date(p.endDate) < now;
  const isUpcoming= (p) => p.startDate && new Date(p.startDate) > now;

  return (
    <div className="layout-container">

      <Sidebar />

      {/* ── Main content ── */}
      <div className="main-content" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

        {/* Header */}
        <div style={{
          padding: '1.25rem 1.5rem 1rem',
          borderBottom: '1px solid var(--border-color)',
          flexShrink: 0,
          background: 'var(--bg-secondary)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 9,
                  background: 'rgba(245,158,11,0.12)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Tag size={18} color="#f59e0b" />
                </div>
                <div>
                  <h1 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                    Offers & Promotions
                  </h1>
                  <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    Create deals that auto-apply at the register
                  </p>
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button onClick={load} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 8, padding: '0.45rem 0.75rem', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.78rem' }}>
                <RefreshCw size={13} /> Refresh
              </button>
              <button
                onClick={openNew}
                style={{
                  background: 'var(--accent-primary)', border: 'none', borderRadius: 9,
                  padding: '0.5rem 1.125rem', color: '#fff', fontWeight: 700,
                  fontSize: '0.85rem', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 6,
                  boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
                }}
              >
                <Plus size={15} /> New Promotion
              </button>
            </div>
          </div>

          {/* Stats row */}
          <div style={{ display: 'flex', gap: 10, marginTop: '1rem', flexWrap: 'wrap' }}>
            {[
              { label: 'Total',     val: stats.total,  color: 'var(--text-primary)' },
              { label: 'Active',    val: stats.active, color: '#10b981' },
              { label: 'Sale',      val: stats.sale,   color: '#f59e0b' },
              { label: 'BOGO',      val: stats.bogo,   color: '#ec4899' },
              { label: 'Volume',    val: stats.volume, color: '#8b5cf6' },
              { label: 'Mix & Match',val: stats.mix,   color: '#06b6d4' },
              { label: 'Combo',     val: stats.combo,  color: '#f97316' },
            ].map(s => (
              <div key={s.label} style={{
                background: 'var(--bg-card,var(--bg-secondary))',
                border: '1px solid var(--border-color)',
                borderRadius: 8, padding: '0.4rem 0.875rem',
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
                <span style={{ fontSize: '1rem', fontWeight: 800, color: s.color }}>{s.val}</span>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{s.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Filter bar */}
        <div style={{
          padding: '0.75rem 1.5rem',
          borderBottom: '1px solid var(--border-color)',
          background: 'var(--bg-secondary)',
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        }}>
          {/* Search */}
          <div style={{ position: 'relative', flex: '1 1 220px', maxWidth: 320 }}>
            <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search promotions…"
              style={{ width: '100%', paddingLeft: '2rem', height: 34, fontSize: '0.82rem', borderRadius: 7, border: '1px solid var(--border-color)', background: 'var(--bg-input,var(--bg-secondary))', color: 'var(--text-primary)', boxSizing: 'border-box' }}
            />
          </div>
          {/* Type filter */}
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {['all', 'sale', 'bogo', 'volume', 'mix_match', 'combo'].map(t => (
              <button
                key={t}
                onClick={() => setFilterType(t)}
                style={{
                  padding: '0.3rem 0.7rem', borderRadius: 6, fontSize: '0.75rem', fontWeight: 700,
                  border: filterType === t ? 'none' : '1px solid var(--border-color)',
                  background: filterType === t ? 'var(--accent-primary)' : 'var(--bg-secondary)',
                  color: filterType === t ? '#fff' : 'var(--text-muted)',
                  cursor: 'pointer',
                }}
              >
                {t === 'all' ? 'All Types' : t === 'mix_match' ? 'Mix & Match' : t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
          {/* Active filter */}
          <div style={{ display: 'flex', gap: 5, marginLeft: 'auto' }}>
            {['all', 'active', 'inactive'].map(f => (
              <button
                key={f}
                onClick={() => setFilterActive(f)}
                style={{
                  padding: '0.3rem 0.7rem', borderRadius: 6, fontSize: '0.75rem', fontWeight: 700,
                  border: filterActive === f ? 'none' : '1px solid var(--border-color)',
                  background: filterActive === f ? '#10b981' : 'var(--bg-secondary)',
                  color: filterActive === f ? '#fff' : 'var(--text-muted)',
                  cursor: 'pointer',
                }}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1rem 1.5rem' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-muted)' }}>
              <RefreshCw size={24} style={{ animation: 'spin 1s linear infinite' }} />
              <p style={{ marginTop: 12 }}>Loading promotions…</p>
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-muted)' }}>
              <Tag size={40} style={{ opacity: 0.3, marginBottom: 12 }} />
              <p style={{ fontSize: '1rem', fontWeight: 600 }}>No promotions found</p>
              <p style={{ fontSize: '0.85rem' }}>Create your first promotion to offer deals at the register</p>
              <button onClick={openNew} style={{ marginTop: 16, background: 'var(--accent-primary)', border: 'none', borderRadius: 8, padding: '0.6rem 1.25rem', color: '#fff', fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Plus size={14} /> New Promotion
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {filtered.map(p => (
                <PromoRow
                  key={p.id}
                  promo={p}
                  onEdit={() => openEdit(p)}
                  onDelete={() => handleDelete(p)}
                  onToggle={() => toggleActive(p)}
                  deleting={deleting === p.id}
                  isExpired={isExpired(p)}
                  isUpcoming={isUpcoming(p)}
                  products={products}
                  depts={depts}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Slide-in Panel ── */}
      {panelOpen && (
        <>
          <div onClick={closePanel} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 100 }} />
          <div style={{
            position: 'fixed', top: 0, right: 0, bottom: 0,
            width: '70vw', minWidth: 520, maxWidth: 1100,
            background: 'var(--bg-secondary)',
            borderLeft: '1px solid var(--border-color)',
            zIndex: 101, display: 'flex', flexDirection: 'column',
            boxShadow: '-8px 0 40px rgba(0,0,0,0.35)',
          }}>

            {/* ── Header ── */}
            <div style={{ padding: '0.875rem 1.25rem', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.62rem', fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.06em' }}>
                  {editing ? 'EDIT PROMOTION' : 'NEW PROMOTION'}
                </div>
                <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {form.name || 'Untitled Promotion'}
                </div>
              </div>
              {/* Active toggle in header */}
              <button
                onClick={() => setF('active', !form.active)}
                title={form.active ? 'Active — click to deactivate' : 'Inactive — click to activate'}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '0.3rem 0.75rem', borderRadius: 20,
                  background: form.active ? 'rgba(16,185,129,0.12)' : 'rgba(100,100,120,0.12)',
                  border: `1px solid ${form.active ? 'rgba(16,185,129,0.35)' : 'var(--border-color)'}`,
                  color: form.active ? '#10b981' : 'var(--text-muted)',
                  cursor: 'pointer', fontWeight: 700, fontSize: '0.75rem',
                }}
              >
                {form.active ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                {form.active ? 'Active' : 'Inactive'}
              </button>
              <button onClick={closePanel} style={{ width: 30, height: 30, borderRadius: 7, background: 'var(--bg-card,var(--bg-secondary))', border: '1px solid var(--border-color)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', flexShrink: 0 }}>
                <X size={15} />
              </button>
            </div>

            {/* ── Tabs: Details | Scope ── */}
            <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', flexShrink: 0 }}>
              {[
                { id: 'details', label: 'Details' },
                { id: 'scope',   label: `Scope${form.productIds.length + form.departmentIds.length > 0 ? ` (${form.productIds.length + form.departmentIds.length})` : ''}` },
              ].map(t => (
                <button key={t.id} onClick={() => setFormTab(t.id)} style={{
                  flex: 1, padding: '0.65rem 0.5rem',
                  background: 'none', border: 'none',
                  borderBottom: formTab === t.id ? '2px solid var(--accent-primary)' : '2px solid transparent',
                  color: formTab === t.id ? 'var(--accent-primary)' : 'var(--text-muted)',
                  fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer',
                }}>
                  {t.label}
                </button>
              ))}
            </div>

            {/* ── Tab body ── */}
            <div style={{ flex: 1, overflowY: 'auto' }}>

              {/* ════ DETAILS TAB — Basic + Deal Config + Display merged ════ */}
              {formTab === 'details' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0, height: '100%' }}>

                  {/* Left column: name / type / display */}
                  <div style={{ padding: '1.125rem 1rem 1.125rem 1.25rem', display: 'flex', flexDirection: 'column', gap: 14, borderRight: '1px solid var(--border-color)', overflowY: 'auto' }}>

                    {/* Name + Description */}
                    <Field label="Promotion Name *">
                      <input
                        value={form.name}
                        onChange={e => setF('name', e.target.value)}
                        placeholder="e.g. Weekend Sale, BOGO Beer, 3 for $10"
                        style={inputStyle}
                      />
                    </Field>

                    <Field label="Description">
                      <textarea
                        value={form.description}
                        onChange={e => setF('description', e.target.value)}
                        placeholder="Internal notes…"
                        rows={2}
                        style={{ ...inputStyle, resize: 'vertical', minHeight: 52, paddingTop: '0.5rem', paddingBottom: '0.5rem' }}
                      />
                    </Field>

                    {/* Promotion Type */}
                    <Field label="Promotion Type *">
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                        {PROMO_TYPES.map(pt => {
                          const Icon = pt.icon;
                          const sel  = form.promoType === pt.value;
                          return (
                            <button key={pt.value} onClick={() => handleTypeChange(pt.value)} style={{
                              padding: '0.6rem 0.75rem', borderRadius: 9, textAlign: 'left',
                              background: sel ? pt.bg : 'var(--bg-card,var(--bg-secondary))',
                              border: `1.5px solid ${sel ? pt.color : 'var(--border-color)'}`,
                              cursor: 'pointer', transition: 'all .1s',
                            }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                                <Icon size={13} color={pt.color} />
                                <span style={{ fontSize: '0.79rem', fontWeight: 700, color: sel ? pt.color : 'var(--text-primary)' }}>{pt.label}</span>
                              </div>
                              <div style={{ fontSize: '0.67rem', color: 'var(--text-muted)', lineHeight: 1.3 }}>{pt.desc}</div>
                            </button>
                          );
                        })}
                      </div>
                    </Field>

                    {/* ── Display section ── */}
                    <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <div style={{ fontSize: '0.68rem', fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.05em' }}>DISPLAY & SCHEDULE</div>

                      <Field label="Badge Label (shown on POS & receipt)">
                        <input
                          value={form.badgeLabel}
                          onChange={e => setF('badgeLabel', e.target.value)}
                          placeholder="e.g. 2 FOR $5 · BOGO · BUY 6 SAVE 15%"
                          style={inputStyle}
                        />
                      </Field>

                      <Field label="Badge Color">
                        <div style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap' }}>
                          {['#f59e0b','#10b981','#3b82f6','#ec4899','#8b5cf6','#f97316','#06b6d4','#ef4444'].map(c => (
                            <button key={c} onClick={() => setF('badgeColor', c)} style={{
                              width: 24, height: 24, borderRadius: '50%', background: c, border: 'none',
                              cursor: 'pointer', outline: form.badgeColor === c ? `2.5px solid ${c}` : 'none',
                              outlineOffset: 2, transition: 'outline .1s', flexShrink: 0,
                            }} />
                          ))}
                          <input type="color" value={form.badgeColor} onChange={e => setF('badgeColor', e.target.value)}
                            style={{ width: 28, height: 24, border: '1px solid var(--border-color)', borderRadius: 5, cursor: 'pointer', background: 'none' }} />
                        </div>
                      </Field>

                      {/* Live badge preview */}
                      {(form.badgeLabel || form.name) && (
                        <div style={{ padding: '0.65rem 0.875rem', background: 'var(--bg-card,var(--bg-secondary))', border: '1px solid var(--border-color)', borderRadius: 8 }}>
                          <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.05em', marginBottom: 6 }}>LIVE PREVIEW</div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: '0.62rem', fontWeight: 800, padding: '2px 7px', borderRadius: 4, background: form.badgeColor + '22', color: form.badgeColor, letterSpacing: '0.04em', border: `1px solid ${form.badgeColor}44`, whiteSpace: 'nowrap' }}>
                              {form.badgeLabel || form.name.toUpperCase()}
                            </span>
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-primary)', fontWeight: 600 }}>Product Name</span>
                            <span style={{ marginLeft: 'auto', fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)' }}>$4.99</span>
                          </div>
                        </div>
                      )}

                    </div>
                  </div>

                  {/* Right column: Deal Config */}
                  <div style={{ padding: '1.125rem 1.25rem 1.125rem 1rem', display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto' }}>
                    <div style={{ fontSize: '0.68rem', fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.05em' }}>DEAL CONFIGURATION</div>
                    <DealConfigForm
                      promoType={form.promoType}
                      cfg={cfg}
                      setCfg={setCfg}
                      products={products}
                    />

                    {/* Date range — lives in the Deal Config column */}
                    <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <div style={{ fontSize: '0.68rem', fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.05em' }}>DATE RANGE (OPTIONAL)</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        <Field label="Start Date">
                          <input type="date" value={form.startDate} onChange={e => setF('startDate', e.target.value)} style={inputStyle} />
                        </Field>
                        <Field label="End Date">
                          <input type="date" value={form.endDate} onChange={e => setF('endDate', e.target.value)} style={inputStyle} />
                        </Field>
                      </div>
                      {form.startDate && form.endDate && new Date(form.endDate) < new Date(form.startDate) && (
                        <div style={{ display: 'flex', gap: 5, color: '#ef4444', fontSize: '0.75rem', fontWeight: 600 }}>
                          <AlertCircle size={13} /> End date is before start date
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* ════ SCOPE TAB ════ */}
              {formTab === 'scope' && (
                <div style={{ padding: '1.125rem 1.25rem', display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div style={{
                    padding: '0.65rem 0.875rem', borderRadius: 9, background: 'rgba(245,158,11,0.06)',
                    border: '1px solid rgba(245,158,11,0.2)', display: 'flex', gap: 8,
                  }}>
                    <AlertCircle size={13} color="#f59e0b" style={{ flexShrink: 0, marginTop: 1 }} />
                    <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      Leave both empty to apply to <strong>all items</strong>.
                      Select departments and/or specific products to narrow scope.
                    </p>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 16, alignItems: 'start' }}>
                    {/* Departments */}
                    <Field label={`Departments (${form.departmentIds.length} selected)`}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 420, overflowY: 'auto', padding: 2 }}>
                        {depts.map(d => {
                          const sel = form.departmentIds.includes(d.id);
                          return (
                            <button key={d.id}
                              onClick={() => setF('departmentIds', sel
                                ? form.departmentIds.filter(x => x !== d.id)
                                : [...form.departmentIds, d.id]
                              )}
                              style={{
                                padding: '0.3rem 0.7rem', borderRadius: 6, fontSize: '0.75rem', fontWeight: 600,
                                background: sel ? 'rgba(16,185,129,0.12)' : 'var(--bg-card,var(--bg-secondary))',
                                border: `1px solid ${sel ? '#10b981' : 'var(--border-color)'}`,
                                color: sel ? '#10b981' : 'var(--text-muted)', cursor: 'pointer',
                                display: 'flex', alignItems: 'center', gap: 4,
                              }}>
                              {sel && <Check size={10} />}
                              {d.name}
                            </button>
                          );
                        })}
                      </div>
                    </Field>

                    {/* Products */}
                    <Field label={`Products (${form.productIds.length} selected)`}>
                      <input value={prodSearch} onChange={e => setProdSearch(e.target.value)}
                        placeholder="Filter products…" style={{ ...inputStyle, marginBottom: 8 }} />
                      <div style={{ maxHeight: 420, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {products
                          .filter(p => !prodSearch || p.name?.toLowerCase().includes(prodSearch.toLowerCase()) || p.upc?.includes(prodSearch))
                          .slice(0, 200)
                          .map(p => {
                            const sel = form.productIds.includes(p.id);
                            return (
                              <button key={p.id}
                                onClick={() => setF('productIds', sel
                                  ? form.productIds.filter(x => x !== p.id)
                                  : [...form.productIds, p.id]
                                )}
                                style={{
                                  padding: '0.35rem 0.75rem', borderRadius: 6, textAlign: 'left',
                                  background: sel ? 'rgba(16,185,129,0.08)' : 'transparent',
                                  border: `1px solid ${sel ? 'rgba(16,185,129,0.3)' : 'transparent'}`,
                                  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                                }}>
                                <div style={{ width: 13, height: 13, borderRadius: 3, border: `1.5px solid ${sel ? '#10b981' : 'var(--border-color)'}`, background: sel ? '#10b981' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                  {sel && <Check size={8} color="#fff" />}
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                                  {p.upc && <div style={{ fontSize: '0.67rem', color: 'var(--text-muted)' }}>UPC: {p.upc}</div>}
                                </div>
                                {p.defaultRetailPrice && (
                                  <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', flexShrink: 0 }}>
                                    ${parseFloat(p.defaultRetailPrice).toFixed(2)}
                                  </span>
                                )}
                              </button>
                            );
                          })
                        }
                      </div>
                    </Field>
                  </div>
                </div>
              )}
            </div>

            {/* ── Footer ── */}
            <div style={{ padding: '0.875rem 1.25rem', borderTop: '1px solid var(--border-color)', display: 'flex', gap: 8, flexShrink: 0 }}>
              <button onClick={closePanel} style={{ flex: 1, height: 40, borderRadius: 8, background: 'var(--bg-card,var(--bg-secondary))', border: '1px solid var(--border-color)', color: 'var(--text-muted)', fontWeight: 700, cursor: 'pointer' }}>
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !form.name.trim()}
                style={{
                  flex: 2, height: 40, borderRadius: 8, border: 'none',
                  background: saving || !form.name.trim() ? 'var(--bg-card,var(--bg-secondary))' : 'var(--accent-primary)',
                  color: saving || !form.name.trim() ? 'var(--text-muted)' : '#fff',
                  fontWeight: 800, fontSize: '0.88rem',
                  cursor: saving || !form.name.trim() ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}
              >
                {saving ? <RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Check size={13} />}
                {saving ? 'Saving…' : editing ? 'Update Promotion' : 'Create Promotion'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── PromoRow ─────────────────────────────────────────────────────────────────
function PromoRow({ promo, onEdit, onDelete, onToggle, deleting, isExpired, isUpcoming, products, depts }) {
  const tp   = PROMO_TYPES.find(t => t.value === promo.promoType) || PROMO_TYPES[0];
  const Icon = tp.icon;
  const now  = new Date();
  const days = promo.endDate
    ? Math.ceil((new Date(promo.endDate) - now) / 86400000)
    : null;

  const scopeText = (() => {
    const parts = [];
    if (promo.productIds?.length) parts.push(`${promo.productIds.length} product${promo.productIds.length !== 1 ? 's' : ''}`);
    if (promo.departmentIds?.length) parts.push(`${promo.departmentIds.length} dept${promo.departmentIds.length !== 1 ? 's' : ''}`);
    return parts.length ? parts.join(', ') : 'All items';
  })();

  return (
    <div style={{
      background: 'var(--bg-card,var(--bg-secondary))',
      border: `1px solid ${!promo.active ? 'var(--border-color)' : isExpired ? 'rgba(239,68,68,0.3)' : 'var(--border-color)'}`,
      borderRadius: 11, padding: '0.875rem 1rem',
      display: 'flex', alignItems: 'center', gap: 12,
      opacity: !promo.active ? 0.6 : 1,
    }}>
      {/* Type icon */}
      <div style={{ width: 38, height: 38, borderRadius: 9, background: tp.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon size={17} color={tp.color} />
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)' }}>{promo.name}</span>

          {promo.badgeLabel && (
            <span style={{ fontSize: '0.62rem', fontWeight: 800, padding: '2px 7px', borderRadius: 4, background: (promo.badgeColor || tp.color) + '22', color: promo.badgeColor || tp.color, letterSpacing: '0.04em', border: `1px solid ${(promo.badgeColor || tp.color)}44` }}>
              {promo.badgeLabel}
            </span>
          )}

          <span style={{ fontSize: '0.65rem', fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: tp.bg, color: tp.color }}>
            {tp.label}
          </span>

          {isExpired && (
            <span style={{ fontSize: '0.65rem', fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>EXPIRED</span>
          )}
          {isUpcoming && (
            <span style={{ fontSize: '0.65rem', fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: 'rgba(59,130,246,0.1)', color: '#3b82f6' }}>UPCOMING</span>
          )}
        </div>

        <div style={{ display: 'flex', gap: 12, marginTop: 3, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Scope: {scopeText}</span>
          {promo.startDate && <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>From {new Date(promo.startDate).toLocaleDateString()}</span>}
          {promo.endDate && (
            <span style={{ fontSize: '0.72rem', color: days !== null && days < 3 ? '#f59e0b' : 'var(--text-muted)' }}>
              {isExpired ? `Expired ${new Date(promo.endDate).toLocaleDateString()}` : days !== null ? `${days}d left` : ''}
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        <button
          onClick={onToggle}
          title={promo.active ? 'Deactivate' : 'Activate'}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: promo.active ? '#10b981' : 'var(--text-muted)' }}
        >
          {promo.active ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
        </button>
        <button onClick={onEdit} title="Edit" style={{ width: 30, height: 30, borderRadius: 7, background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
          <Pencil size={12} />
        </button>
        <button
          onClick={onDelete}
          disabled={deleting}
          title="Delete"
          style={{ width: 30, height: 30, borderRadius: 7, background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.2)', cursor: deleting ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ef4444' }}
        >
          {deleting ? <RefreshCw size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <Trash2 size={12} />}
        </button>
      </div>
    </div>
  );
}

// ─── DealConfigForm ──────────────────────────────────────────────────────────
function DealConfigForm({ promoType, cfg, setCfg, products }) {
  const setC = (k, v) => setCfg(c => ({ ...c, [k]: v }));

  if (promoType === 'sale') return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <InfoBox>Apply a discount when an item qualifies. Choose % off, $ off, or set a fixed sale price.</InfoBox>
      <Field label="Discount Type">
        <div style={{ display: 'flex', gap: 8 }}>
          {[
            { val: 'percent', label: '% Off',       color: '#f59e0b' },
            { val: 'amount',  label: '$ Off',        color: '#10b981' },
            { val: 'fixed',   label: 'Fixed Price',  color: '#3b82f6' },
          ].map(t => (
            <button key={t.val} onClick={() => setC('discountType', t.val)}
              style={{ flex: 1, padding: '0.6rem', borderRadius: 8, fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer',
                background: cfg.discountType === t.val ? t.color + '18' : 'var(--bg-card,var(--bg-secondary))',
                border: `1.5px solid ${cfg.discountType === t.val ? t.color : 'var(--border-color)'}`,
                color: cfg.discountType === t.val ? t.color : 'var(--text-muted)',
              }}>
              {t.label}
            </button>
          ))}
        </div>
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label={cfg.discountType === 'percent' ? 'Discount %' : cfg.discountType === 'amount' ? 'Discount $' : 'Fixed Sale Price $'}>
          <input type="number" min="0" step="0.01" value={cfg.discountValue} onChange={e => setC('discountValue', e.target.value)} placeholder="0" style={inputStyle} />
        </Field>
        <Field label="Minimum Qty to Qualify">
          <input type="number" min="1" step="1" value={cfg.minQty} onChange={e => setC('minQty', parseInt(e.target.value) || 1)} style={inputStyle} />
        </Field>
      </div>
      {cfg.discountType === 'percent' && cfg.discountValue > 0 && (
        <PreviewBox>
          <span>$10.00 item</span>
          <span style={{ color: 'var(--text-muted)', margin: '0 6px' }}>→</span>
          <strong style={{ color: '#10b981' }}>${(10 * (1 - cfg.discountValue / 100)).toFixed(2)}</strong>
          <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>({cfg.discountValue}% off)</span>
        </PreviewBox>
      )}
    </div>
  );

  if (promoType === 'bogo') return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <InfoBox>Buy X, get Y at a discount. The cheapest qualifying units get the deal first.</InfoBox>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <Field label="Buy Qty">
          <input type="number" min="1" step="1" value={cfg.buyQty} onChange={e => setC('buyQty', parseInt(e.target.value) || 1)} style={inputStyle} />
        </Field>
        <Field label="Get Qty">
          <input type="number" min="1" step="1" value={cfg.getQty} onChange={e => setC('getQty', parseInt(e.target.value) || 1)} style={inputStyle} />
        </Field>
        <Field label="Get Discount %">
          <input type="number" min="1" max="100" step="1" value={cfg.getDiscount} onChange={e => setC('getDiscount', parseInt(e.target.value) || 100)} style={inputStyle} />
        </Field>
      </div>
      <Field label="Max Sets (leave blank for unlimited)">
        <input type="number" min="1" step="1" value={cfg.maxSets || ''} onChange={e => setC('maxSets', e.target.value ? parseInt(e.target.value) : null)} placeholder="Unlimited" style={inputStyle} />
      </Field>
      <PreviewBox>
        Buy <strong style={{ margin: '0 4px' }}>{cfg.buyQty || 1}</strong> get <strong style={{ margin: '0 4px' }}>{cfg.getQty || 1}</strong>
        {cfg.getDiscount >= 100 ? ' FREE' : ` at ${cfg.getDiscount}% off`}
      </PreviewBox>
    </div>
  );

  if (promoType === 'volume') return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <InfoBox>Add tiers — the highest matching tier applies to all qualifying units in the cart.</InfoBox>
      {(cfg.tiers || []).map((tier, i) => (
        <div key={i} style={{ padding: '0.875rem', background: 'var(--bg-card,var(--bg-secondary))', border: '1px solid var(--border-color)', borderRadius: 9 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-primary)' }}>Tier {i + 1}</span>
            {cfg.tiers.length > 1 && (
              <button onClick={() => setC('tiers', cfg.tiers.filter((_, j) => j !== i))}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', padding: 2 }}>
                <Trash2 size={12} />
              </button>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <Field label="Min Qty">
              <input type="number" min="1" step="1" value={tier.minQty}
                onChange={e => setC('tiers', cfg.tiers.map((t, j) => j === i ? { ...t, minQty: parseInt(e.target.value) || 1 } : t))}
                style={inputStyle} />
            </Field>
            <Field label="Discount Type">
              <select value={tier.discountType}
                onChange={e => setC('tiers', cfg.tiers.map((t, j) => j === i ? { ...t, discountType: e.target.value } : t))}
                style={inputStyle}>
                <option value="percent">% Off</option>
                <option value="amount">$ Off</option>
              </select>
            </Field>
            <Field label="Discount Value">
              <input type="number" min="0" step="0.01" value={tier.discountValue}
                onChange={e => setC('tiers', cfg.tiers.map((t, j) => j === i ? { ...t, discountValue: e.target.value } : t))}
                style={inputStyle} />
            </Field>
          </div>
        </div>
      ))}
      <button onClick={() => setC('tiers', [...(cfg.tiers || []), { minQty: (cfg.tiers?.at(-1)?.minQty || 1) + 2, discountType: 'percent', discountValue: '' }])}
        style={{ height: 36, borderRadius: 7, border: '1px dashed var(--border-color)', background: 'transparent', color: 'var(--accent-primary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, fontSize: '0.8rem', fontWeight: 700 }}>
        <Plus size={12} /> Add Tier
      </button>
    </div>
  );

  if (promoType === 'mix_match') return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <InfoBox>Any N items from the scoped products/departments together for a flat bundle price.</InfoBox>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Group Size (# of items)">
          <input type="number" min="2" step="1" value={cfg.groupSize}
            onChange={e => setC('groupSize', parseInt(e.target.value) || 2)} style={inputStyle} />
        </Field>
        <Field label="Bundle Price ($)">
          <input type="number" min="0" step="0.01" value={cfg.bundlePrice}
            onChange={e => setC('bundlePrice', e.target.value)} placeholder="0.00" style={inputStyle} />
        </Field>
      </div>
      {cfg.bundlePrice > 0 && (
        <PreviewBox>
          Any <strong style={{ margin: '0 4px' }}>{cfg.groupSize}</strong> qualifying items for <strong style={{ margin: '0 4px', color: '#10b981' }}>${parseFloat(cfg.bundlePrice).toFixed(2)}</strong>
        </PreviewBox>
      )}
    </div>
  );

  if (promoType === 'combo') return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <InfoBox>Customer must buy all required product groups to unlock the combo discount.</InfoBox>
      {(cfg.requiredGroups || []).map((group, gi) => (
        <div key={gi} style={{ padding: '0.875rem', background: 'var(--bg-card,var(--bg-secondary))', border: '1px solid var(--border-color)', borderRadius: 9 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-primary)' }}>Product Group {gi + 1}</span>
            <input
              type="number" min="1" step="1"
              value={group.minQty}
              onChange={e => setC('requiredGroups', cfg.requiredGroups.map((g, j) => j === gi ? { ...g, minQty: parseInt(e.target.value) || 1 } : g))}
              placeholder="Min Qty"
              style={{ ...inputStyle, width: 80, marginLeft: 'auto' }}
            />
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>min qty</span>
            {cfg.requiredGroups.length > 1 && (
              <button onClick={() => setC('requiredGroups', cfg.requiredGroups.filter((_, j) => j !== gi))}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444' }}>
                <Trash2 size={12} />
              </button>
            )}
          </div>
          <div style={{ maxHeight: 140, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {products.slice(0, 60).map(p => {
              const sel = group.productIds?.includes(p.id);
              return (
                <button key={p.id}
                  onClick={() => setC('requiredGroups', cfg.requiredGroups.map((g, j) => j === gi ? {
                    ...g,
                    productIds: sel ? g.productIds.filter(x => x !== p.id) : [...(g.productIds || []), p.id],
                  } : g))}
                  style={{ padding: '0.3rem 0.6rem', borderRadius: 5, textAlign: 'left', cursor: 'pointer',
                    background: sel ? 'rgba(16,185,129,0.08)' : 'transparent',
                    border: `1px solid ${sel ? 'rgba(16,185,129,0.3)' : 'transparent'}`,
                    display: 'flex', alignItems: 'center', gap: 7,
                  }}>
                  <div style={{ width: 12, height: 12, borderRadius: 3, border: `1.5px solid ${sel ? '#10b981' : 'var(--border-color)'}`, background: sel ? '#10b981' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {sel && <Check size={8} color="#fff" />}
                  </div>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-primary)' }}>{p.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <button
        onClick={() => setC('requiredGroups', [...(cfg.requiredGroups || []), { productIds: [], minQty: 1 }])}
        style={{ height: 36, borderRadius: 7, border: '1px dashed var(--border-color)', background: 'transparent', color: 'var(--accent-primary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, fontSize: '0.8rem', fontWeight: 700 }}>
        <Plus size={12} /> Add Product Group
      </button>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Combo Discount Type">
          <select value={cfg.discountType} onChange={e => setC('discountType', e.target.value)} style={inputStyle}>
            <option value="percent">% Off</option>
            <option value="amount">$ Off</option>
          </select>
        </Field>
        <Field label="Combo Discount Value">
          <input type="number" min="0" step="0.01" value={cfg.discountValue}
            onChange={e => setC('discountValue', e.target.value)} style={inputStyle} />
        </Field>
      </div>
    </div>
  );

  return <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Select a promotion type first.</div>;
}

// ─── Small helpers ────────────────────────────────────────────────────────────
const inputStyle = {
  width: '100%', height: 36, padding: '0 0.75rem',
  borderRadius: 7, border: '1px solid var(--border-color)',
  background: 'var(--bg-input,var(--bg-secondary))',
  color: 'var(--text-primary)', fontSize: '0.85rem',
  boxSizing: 'border-box',
};

function Field({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.04em' }}>
        {label.toUpperCase()}
      </label>
      {children}
    </div>
  );
}

function InfoBox({ children }) {
  return (
    <div style={{ padding: '0.65rem 0.875rem', borderRadius: 8, background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.15)', fontSize: '0.78rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'flex-start', gap: 7 }}>
      <AlertCircle size={13} color="#3b82f6" style={{ flexShrink: 0, marginTop: 1 }} />
      {children}
    </div>
  );
}

function PreviewBox({ children }) {
  return (
    <div style={{ padding: '0.65rem 1rem', borderRadius: 8, background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.2)', fontSize: '0.82rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
      <Zap size={12} color="#10b981" style={{ marginRight: 6 }} />
      {children}
    </div>
  );
}
