import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import {
  Palette, Sun, Moon, ChevronLeft, Save, Wifi,
  Search, ShoppingCart, User, Clock, LogOut, Check,
} from 'lucide-react';
import { getStores, getStoreBranding, updateStoreBranding } from '../services/api.js';

import './StoreBranding.css';

// ── Helpers ────────────────────────────────────────────────────────────────

function hexToRgba(hex, alpha) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

const THEMES = {
  dark: {
    bgBase: '#0f1117', bgPanel: '#161922', bgCard: '#1e2130',
    bgInput: '#252836', textPrimary: '#f1f5f9', textSecondary: '#94a3b8',
    textMuted: '#64748b', border: 'rgba(255,255,255,.09)',
    statusBg: '#0a0c12', label: 'Dark',
  },
  light: {
    bgBase: '#f1f5f9', bgPanel: '#ffffff', bgCard: '#f8fafc',
    bgInput: '#e8edf3', textPrimary: '#0f172a', textSecondary: '#334155',
    textMuted: '#64748b', border: 'rgba(0,0,0,.12)',
    statusBg: '#1e293b', label: 'Light',
  },
};

const PRESET_COLORS = [
  'var(--accent-primary)', '#3b82f6', '#8b5cf6', '#ec4899',
  '#f59e0b', '#ef4444', '#14b8a6', '#f97316',
];

const DEFAULT_BRANDING = { theme: 'dark', primaryColor: 'var(--accent-primary)', logoText: '' };

// ── Mini POS Preview ───────────────────────────────────────────────────────

function POSPreview({ theme, primaryColor, logoText, storeName }) {
  const t = THEMES[theme] || THEMES.dark;
  const green      = primaryColor;
  const label      = logoText || storeName || 'FF POS';

  // Natural POS dimensions: 1200 × 720 px
  // Displayed at 520px wide → scale = 520/1200 ≈ 0.433
  const W = 1200, H = 720, SCALE = 520 / W;

  return (
    <div style={{
      width: 520, height: Math.round(H * SCALE),
      overflow: 'hidden', borderRadius: 12,
      border: '1px solid rgba(255,255,255,.1)',
      boxShadow: '0 24px 60px rgba(0,0,0,.5)',
      background: t.bgBase,
      position: 'relative', flexShrink: 0,
    }}>
      <div style={{
        width: W, height: H,
        transform: `scale(${SCALE})`,
        transformOrigin: 'top left',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Status bar */}
        <div style={{
          height: 44, background: t.statusBg, flexShrink: 0,
          display: 'flex', alignItems: 'center', padding: '0 24px',
          gap: 32, fontSize: 18, fontWeight: 700, color: t.textMuted,
          borderBottom: `1px solid ${t.border}`,
        }}>
          <span style={{ color: green, fontWeight: 900, fontSize: 20 }}>{label}</span>
          <div style={{ width: 1, height: 20, background: t.border }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: green }}>
            <Wifi size={18} /> <span>ONLINE</span>
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <User size={18} />
            <span style={{ fontSize: 17 }}>cashier@store.com</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Clock size={18} />
            <span>12:34 PM</span>
          </div>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '6px 16px',
            border: `1px solid ${t.border}`, borderRadius: 8, cursor: 'pointer',
            fontSize: 17,
          }}>
            <LogOut size={16} /> Sign out
          </div>
        </div>

        {/* Main area */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {/* Left — scan/search */}
          <div style={{
            width: '55%', display: 'flex', flexDirection: 'column',
            borderRight: `1px solid ${t.border}`, background: t.bgBase,
          }}>
            {/* Search bar */}
            <div style={{ padding: 24, borderBottom: `1px solid ${t.border}` }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 16,
                background: t.bgInput, border: `1px solid ${t.border}`,
                borderRadius: 10, padding: '0 20px', height: 64,
              }}>
                <Search size={24} color={t.textMuted} />
                <span style={{ color: t.textMuted, fontSize: 22 }}>Search products or scan barcode…</span>
              </div>
            </div>
            {/* Empty scan zone */}
            <div style={{
              flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 16, opacity: 0.25,
              color: t.textMuted,
            }}>
              <Search size={96} />
              <span style={{ fontSize: 24 }}>Scan barcode or search above</span>
            </div>
          </div>

          {/* Right — cart */}
          <div style={{
            width: '45%', display: 'flex', flexDirection: 'column',
            background: t.bgPanel,
          }}>
            {/* Cart header */}
            <div style={{
              padding: '20px 24px', borderBottom: `1px solid ${t.border}`,
              fontSize: 24, fontWeight: 700, color: t.textPrimary,
            }}>
              Cart · 0 items
            </div>
            {/* Empty cart */}
            <div style={{
              flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              color: t.textMuted, opacity: 0.35, gap: 16,
            }}>
              <ShoppingCart size={80} />
              <span style={{ fontSize: 24 }}>Cart is empty</span>
            </div>
            {/* Tender button */}
            <div style={{ padding: 20 }}>
              <div style={{
                width: '100%', height: 80, borderRadius: 14,
                background: t.bgInput, border: `1px solid ${t.border}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 30, fontWeight: 800, color: t.textMuted,
              }}>
                No items
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Primary color accent strip at bottom of preview */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, height: 4,
        background: `linear-gradient(90deg, ${green}, ${hexToRgba(green, 0.4)})`,
      }} />
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────

export default function StoreBranding() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [stores,    setStores]    = useState([]);
  const [storeId,   setStoreId]   = useState('');
  const [storeName, setStoreName] = useState('');
  const [branding,  setBranding]  = useState(DEFAULT_BRANDING);
  const [draft,     setDraft]     = useState(DEFAULT_BRANDING);
  const [loading,   setLoading]   = useState(false);
  const [saving,    setSaving]    = useState(false);
  const [saved,     setSaved]     = useState(false);

  // Load stores — auto-select from ?store= query param if provided
  useEffect(() => {
    getStores().then(res => {
      const list = Array.isArray(res) ? res : (res.data ?? []);
      setStores(list);
      if (list.length === 0) return;
      const paramId = searchParams.get('store');
      const match   = paramId && list.find(s => (s.id || s.id) === paramId);
      const target  = match || list[0];
      setStoreId(target.id || target.id);
      setStoreName(target.name);
    }).catch(() => {});
  }, []);

  // Load branding when store changes
  useEffect(() => {
    if (!storeId) return;
    setLoading(true);
    getStoreBranding(storeId)
      .then(data => {
        const b = { ...DEFAULT_BRANDING, ...data };
        setBranding(b);
        setDraft(b);
      })
      .catch(() => {
        setBranding(DEFAULT_BRANDING);
        setDraft(DEFAULT_BRANDING);
      })
      .finally(() => setLoading(false));
  }, [storeId]);

  const setDraftField = (field, value) =>
    setDraft(d => ({ ...d, [field]: value }));

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await updateStoreBranding(storeId, draft);
      setBranding(draft);
      setSaved(true);
      toast.success('Branding published! POS will update within 5 minutes.');
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save branding');
    } finally {
      setSaving(false);
    }
  };

  const hasChanges = JSON.stringify(draft) !== JSON.stringify(branding);

  const cardStyle = {
    background: '#161922', border: '1px solid rgba(255,255,255,.08)',
    borderRadius: 14, padding: '1.5rem', marginBottom: '1rem',
  };

  return (
      <div className="p-page sbr-content">

        {/* Header */}
        <div className="p-header">
          <div className="p-header-left">
            <button onClick={() => navigate('/portal/stores')} style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)',
              borderRadius: 8, padding: '0.45rem 0.875rem', color: '#94a3b8',
              fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer',
            }}>
              <ChevronLeft size={14} /> Stores
            </button>
            <div className="p-header-icon">
              <Palette size={22} />
            </div>
            <div>
              <h1 className="p-title">POS Branding</h1>
              <p className="p-subtitle">Customise how your register looks for cashiers</p>
            </div>
          </div>
          <div className="p-header-actions"></div>
        </div>

        <div style={{ display: 'flex', gap: '2rem', alignItems: 'flex-start' }}>

          {/* ── Left: Settings ── */}
          <div style={{ width: 360, flexShrink: 0 }}>

            {/* Store selector */}
            {stores.length > 1 && (
              <div style={cardStyle}>
                <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#94a3b8', display: 'block', marginBottom: 8 }}>
                  STORE
                </label>
                <select
                  value={storeId}
                  onChange={e => {
                    const s = stores.find(x => (x.id || x.id) === e.target.value);
                    setStoreId(e.target.value);
                    setStoreName(s?.name || '');
                  }}
                  style={{
                    width: '100%', background: '#252836', color: '#f1f5f9',
                    border: '1px solid rgba(255,255,255,.12)', borderRadius: 8,
                    padding: '0.65rem 0.875rem', fontSize: '0.9rem',
                  }}
                >
                  {stores.map(s => (
                    <option key={s.id || s.id} value={s.id || s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Theme */}
            <div style={cardStyle}>
              <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#94a3b8', display: 'block', marginBottom: 12 }}>
                THEME
              </label>
              <div style={{ display: 'flex', gap: 10 }}>
                {['dark', 'light'].map(th => {
                  const t = THEMES[th];
                  const active = draft.theme === th;
                  return (
                    <button
                      key={th}
                      onClick={() => setDraftField('theme', th)}
                      style={{
                        flex: 1, padding: '1rem', borderRadius: 10, cursor: 'pointer',
                        background: active ? 'var(--brand-10)' : t.bgPanel,
                        border: `2px solid ${active ? 'var(--accent-primary)' : t.border}`,
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                        transition: 'border-color .15s',
                      }}
                    >
                      {/* Mini swatch */}
                      <div style={{
                        width: '100%', height: 48, borderRadius: 6,
                        background: t.bgBase, border: `1px solid ${t.border}`,
                        display: 'flex', overflow: 'hidden',
                      }}>
                        <div style={{ width: '55%', background: t.bgBase }} />
                        <div style={{ width: '45%', background: t.bgPanel }} />
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {th === 'dark'
                          ? <Moon size={14} color={active ? 'var(--accent-primary)' : '#94a3b8'} />
                          : <Sun  size={14} color={active ? 'var(--accent-primary)' : '#94a3b8'} />}
                        <span style={{ fontSize: '0.82rem', fontWeight: 700, color: active ? 'var(--accent-primary)' : '#94a3b8' }}>
                          {t.label}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Primary colour */}
            <div style={cardStyle}>
              <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#94a3b8', display: 'block', marginBottom: 12 }}>
                PRIMARY COLOUR
              </label>
              {/* Presets */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
                {PRESET_COLORS.map(c => (
                  <button
                    key={c}
                    onClick={() => setDraftField('primaryColor', c)}
                    title={c}
                    style={{
                      width: 32, height: 32, borderRadius: '50%', background: c,
                      border: draft.primaryColor === c ? '3px solid #fff' : '3px solid transparent',
                      cursor: 'pointer', flexShrink: 0,
                      boxShadow: draft.primaryColor === c ? `0 0 0 2px ${c}` : 'none',
                      transition: 'border-color .12s',
                    }}
                  />
                ))}
              </div>
              {/* Custom picker */}
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <input
                  type="color"
                  value={draft.primaryColor}
                  onChange={e => setDraftField('primaryColor', e.target.value)}
                  style={{
                    width: 44, height: 44, padding: 2, borderRadius: 8, cursor: 'pointer',
                    background: '#252836', border: '1px solid rgba(255,255,255,.12)',
                  }}
                />
                <input
                  type="text"
                  value={draft.primaryColor}
                  onChange={e => {
                    const v = e.target.value;
                    if (/^#[0-9a-fA-F]{0,6}$/.test(v)) setDraftField('primaryColor', v);
                  }}
                  style={{
                    flex: 1, background: '#252836', color: '#f1f5f9',
                    border: '1px solid rgba(255,255,255,.12)', borderRadius: 8,
                    padding: '0.6rem 0.875rem', fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '0.9rem',
                  }}
                />
              </div>
            </div>

            {/* Logo text */}
            <div style={cardStyle}>
              <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#94a3b8', display: 'block', marginBottom: 8 }}>
                POS LABEL <span style={{ fontWeight: 400, color: '#475569' }}>(optional)</span>
              </label>
              <input
                type="text"
                maxLength={20}
                placeholder={storeName || 'FF POS'}
                value={draft.logoText}
                onChange={e => setDraftField('logoText', e.target.value)}
                style={{
                  width: '100%', background: '#252836', color: '#f1f5f9',
                  border: '1px solid rgba(255,255,255,.12)', borderRadius: 8,
                  padding: '0.65rem 0.875rem', fontSize: '0.9rem', boxSizing: 'border-box',
                }}
              />
              <p style={{ fontSize: '0.72rem', color: '#475569', marginTop: 6 }}>
                Shown in the top-left of the POS status bar. Defaults to store name.
              </p>
            </div>

            {/* Save */}
            <button
              onClick={handleSave}
              disabled={saving || !hasChanges || !storeId}
              style={{
                width: '100%', padding: '0.875rem',
                background: saved ? '#16a34a' : hasChanges ? 'var(--accent-primary)' : 'rgba(255,255,255,.06)',
                color: hasChanges || saved ? '#fff' : '#475569',
                border: 'none', borderRadius: 10, fontWeight: 800, fontSize: '0.95rem',
                cursor: hasChanges ? 'pointer' : 'not-allowed',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                transition: 'background .2s',
              }}
            >
              {saved
                ? <><Check size={16} /> Published!</>
                : saving
                  ? 'Publishing…'
                  : <><Save size={16} /> Save &amp; Publish</>}
            </button>
            {hasChanges && !saving && (
              <p style={{ textAlign: 'center', fontSize: '0.72rem', color: '#64748b', marginTop: 8 }}>
                Unsaved changes · POS updates within 5 min after publishing
              </p>
            )}
          </div>

          {/* ── Right: Live preview ── */}
          <div style={{ flex: 1 }}>
            <div style={{
              fontSize: '0.78rem', fontWeight: 700, color: '#64748b',
              letterSpacing: '0.06em', marginBottom: 12,
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <Palette size={13} /> LIVE PREVIEW
              <span style={{ fontWeight: 400, color: '#475569', letterSpacing: 0, fontSize: '0.72rem' }}>
                — updates as you change settings
              </span>
            </div>

            {loading ? (
              <div style={{
                width: 520, height: 312, borderRadius: 12,
                background: '#161922', border: '1px solid rgba(255,255,255,.08)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#475569', fontSize: '0.85rem',
              }}>
                Loading branding…
              </div>
            ) : (
              <POSPreview
                theme={draft.theme}
                primaryColor={draft.primaryColor}
                logoText={draft.logoText}
                storeName={storeName}
              />
            )}

            <p style={{ fontSize: '0.72rem', color: '#475569', marginTop: 12 }}>
              This is a scaled preview of what cashiers see on their register screen.
            </p>
          </div>
        </div>
      </div>
  );
}
