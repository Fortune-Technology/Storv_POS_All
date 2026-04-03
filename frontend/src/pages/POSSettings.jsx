import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import { Monitor, Save, Check, Palette, Sun, Moon } from 'lucide-react';
import { getStores } from '../services/api.js';
import api from '../services/api.js';
import Sidebar from '../components/Sidebar.jsx';

// ── Branding constants ─────────────────────────────────────────────────────

const PRESET_COLORS = [
  '#7ac143', '#3b82f6', '#8b5cf6', '#ec4899',
  '#f59e0b', '#ef4444', '#14b8a6', '#f97316',
];

const DEFAULT_BRANDING = { theme: 'dark', primaryColor: '#7ac143', logoText: '' };

// ── Default Config ─────────────────────────────────────────────────────────

const DEFAULT_CONFIG = {
  layout: 'modern',
  showDepartments: true,
  showQuickAdd: true,
  numpadEnabled: true,
  customerLookup: true,
  cashRounding: 'none',   // 'none' | '0.05'
  shortcuts: {
    priceCheck: true,
    hold: true,
    reprint: false,
    noSale: true,
    discount: true,
    refund: true,
    voidTx: true,
    endOfDay: true,
  },
  quickTender: ['card', 'cash', 'ebt'],
};

// ── Layout Preset Definitions ──────────────────────────────────────────────

const LAYOUT_PRESETS = [
  {
    key: 'modern',
    name: 'Modern',
    description: 'Categories left · Cart right · All features',
    diagram: (
      <div style={{ display: 'flex', gap: 3, height: 52, width: '100%' }}>
        <div style={{ width: '28%', background: '#334155', borderRadius: 3 }} />
        <div style={{ flex: 1, background: '#1e293b', borderRadius: 3, display: 'flex', flexDirection: 'column', gap: 2, padding: 3 }}>
          <div style={{ height: 10, background: '#7ac143', borderRadius: 2, opacity: 0.7 }} />
          <div style={{ flex: 1, display: 'flex', gap: 2 }}>
            {[1,2,3,4].map(i => (
              <div key={i} style={{ flex: 1, background: '#334155', borderRadius: 2 }} />
            ))}
          </div>
        </div>
        <div style={{ width: '32%', background: '#253347', borderRadius: 3, display: 'flex', flexDirection: 'column', gap: 2, padding: 3 }}>
          <div style={{ flex: 1, background: '#1e2d3d', borderRadius: 2 }} />
          <div style={{ height: 10, background: '#7ac143', borderRadius: 2 }} />
        </div>
      </div>
    ),
  },
  {
    key: 'express',
    name: 'Express Lane',
    description: 'Minimal UI · Fastest checkout · Less clicks',
    diagram: (
      <div style={{ display: 'flex', gap: 3, height: 52, width: '100%', flexDirection: 'column' }}>
        <div style={{ height: 10, background: '#7ac143', borderRadius: 3, opacity: 0.8 }} />
        <div style={{ flex: 1, display: 'flex', gap: 3 }}>
          <div style={{ flex: 1, background: '#1e293b', borderRadius: 3 }} />
          <div style={{ width: '38%', background: '#253347', borderRadius: 3, display: 'flex', flexDirection: 'column', gap: 2, padding: 3 }}>
            <div style={{ flex: 1, background: '#1e2d3d', borderRadius: 2 }} />
            <div style={{ height: 10, background: '#7ac143', borderRadius: 2 }} />
          </div>
        </div>
      </div>
    ),
  },
  {
    key: 'classic',
    name: 'Classic',
    description: 'Traditional layout · Cart on left',
    diagram: (
      <div style={{ display: 'flex', gap: 3, height: 52, width: '100%' }}>
        <div style={{ width: '36%', background: '#253347', borderRadius: 3, display: 'flex', flexDirection: 'column', gap: 2, padding: 3 }}>
          <div style={{ flex: 1, background: '#1e2d3d', borderRadius: 2 }} />
          <div style={{ height: 10, background: '#7ac143', borderRadius: 2 }} />
        </div>
        <div style={{ flex: 1, background: '#1e293b', borderRadius: 3, display: 'flex', flexDirection: 'column', gap: 2, padding: 3 }}>
          <div style={{ height: 10, background: '#475569', borderRadius: 2 }} />
          <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: 2 }}>
            {[1,2,3,4,5,6].map(i => (
              <div key={i} style={{ width: 'calc(33% - 2px)', height: 12, background: '#334155', borderRadius: 2 }} />
            ))}
          </div>
        </div>
      </div>
    ),
  },
  {
    key: 'minimal',
    name: 'Minimal',
    description: 'Search only · No category tiles',
    diagram: (
      <div style={{ display: 'flex', gap: 3, height: 52, width: '100%' }}>
        <div style={{ flex: 1, background: '#1e293b', borderRadius: 3, display: 'flex', flexDirection: 'column', gap: 3, padding: 4 }}>
          <div style={{ height: 12, background: '#475569', borderRadius: 2, display: 'flex', alignItems: 'center', paddingLeft: 4 }}>
            <div style={{ width: 6, height: 6, background: '#7ac143', borderRadius: '50%' }} />
          </div>
          <div style={{ flex: 1, background: '#0f172a', borderRadius: 2 }} />
        </div>
        <div style={{ width: '34%', background: '#253347', borderRadius: 3, display: 'flex', flexDirection: 'column', gap: 2, padding: 3 }}>
          <div style={{ flex: 1, background: '#1e2d3d', borderRadius: 2 }} />
          <div style={{ height: 10, background: '#7ac143', borderRadius: 2 }} />
        </div>
      </div>
    ),
  },
  {
    key: 'counter',
    name: 'Counter',
    description: 'Cart left · Tender always right · Right-hand optimised',
    diagram: (
      <div style={{ display: 'flex', gap: 3, height: 52, width: '100%' }}>
        <div style={{ width: '38%', background: '#253347', borderRadius: 3, display: 'flex', flexDirection: 'column', gap: 2, padding: 3 }}>
          <div style={{ flex: 1, background: '#1e2d3d', borderRadius: 2 }} />
          <div style={{ height: 6, background: '#475569', borderRadius: 2 }} />
        </div>
        <div style={{ flex: 1, background: '#1e293b', borderRadius: 3, display: 'flex', flexDirection: 'column', gap: 2, padding: 3 }}>
          <div style={{ height: 8, background: '#475569', borderRadius: 2 }} />
          <div style={{ flex: 1, display: 'flex', gap: 2 }}>
            {[1,2].map(i => (
              <div key={i} style={{ flex: 1, background: '#334155', borderRadius: 2 }} />
            ))}
          </div>
          <div style={{ height: 10, background: '#7ac143', borderRadius: 2 }} />
        </div>
      </div>
    ),
  },
];

// ── Toggle Switch Component ────────────────────────────────────────────────

function Toggle({ checked, onChange, label }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', userSelect: 'none' }}>
      <div
        onClick={() => onChange(!checked)}
        style={{
          width: 36, height: 20, borderRadius: 10, flexShrink: 0,
          background: checked ? '#7ac143' : 'var(--bg-tertiary)',
          position: 'relative', transition: 'background .2s', cursor: 'pointer',
          border: `1px solid ${checked ? '#7ac143' : 'var(--border-color)'}`,
        }}
      >
        <div style={{
          position: 'absolute', top: 1,
          left: checked ? 17 : 1,
          width: 16, height: 16, borderRadius: '50%',
          background: '#fff', transition: 'left .15s',
          boxShadow: '0 1px 3px rgba(0,0,0,.2)',
        }} />
      </div>
      <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 500 }}>{label}</span>
    </label>
  );
}

// ── Chip Toggle Component ──────────────────────────────────────────────────

function ChipToggle({ checked, onChange, label }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      style={{
        padding: '0.4rem 0.85rem',
        borderRadius: 20,
        border: checked ? '1px solid #7ac143' : '1px solid var(--border-color)',
        background: checked ? 'rgba(122,193,67,.12)' : 'var(--bg-tertiary)',
        color: checked ? '#7ac143' : 'var(--text-muted)',
        fontSize: '0.78rem', fontWeight: 600,
        cursor: 'pointer', transition: 'all .15s',
        display: 'flex', alignItems: 'center', gap: 5,
      }}
    >
      {checked && <Check size={10} />}
      {label}
    </button>
  );
}

// ── Live POS Preview ────────────────────────────────────────────────────────

function POSPreview({ config, branding }) {
  const primary = branding?.primaryColor || '#7ac143';
  const theme   = branding?.theme || 'dark';
  const isDark  = theme === 'dark';

  const C = {
    bg:      isDark ? '#0f1117' : '#eef2f7',
    panel:   isDark ? '#161922' : '#ffffff',
    card:    isDark ? '#1e2130' : '#f0f4f8',
    border:  isDark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.1)',
    text:    isDark ? '#f1f5f9' : '#0f172a',
    muted:   isDark ? '#475569' : '#94a3b8',
    statusBg: isDark ? '#0a0c12' : '#1e293b',
  };

  const isClassic = config.layout === 'classic';
  const isExpress = config.layout === 'express';
  const isMinimal = config.layout === 'minimal';
  const isCounter = config.layout === 'counter';

  const showDepts = !isExpress && !isMinimal && config.showDepartments !== false;
  const showQuick = !isExpress && !isMinimal && config.showQuickAdd    !== false;

  const searchW = isExpress ? '32%' : (isClassic || isCounter) ? '60%' : isMinimal ? '40%' : '58%';
  const cartW   = isExpress ? '68%' : (isClassic || isCounter) ? '40%' : isMinimal ? '60%' : '42%';

  const qt = Array.isArray(config.quickTender) ? config.quickTender : ['card','cash'];
  const qtColors = { card: 'rgba(59,130,246,.25)', cash: primary + '33', ebt: 'rgba(52,211,153,.25)' };

  // Search + category pane
  const searchPane = (
    <div style={{
      width: searchW, display: 'flex', flexDirection: 'column',
      background: C.bg, flexShrink: 0,
      borderRight: !isClassic ? `1px solid ${C.border}` : 'none',
      borderLeft:  isClassic  ? `1px solid ${C.border}` : 'none',
    }}>
      {/* Search bar */}
      <div style={{ padding: '5px 7px', borderBottom: `1px solid ${C.border}` }}>
        <div style={{ height: 11, background: C.card, borderRadius: 5, border: `1px solid ${C.border}` }} />
      </div>
      {/* Dept pills */}
      {showDepts && (
        <div style={{ padding: '4px 7px', borderBottom: `1px solid ${C.border}`, display: 'flex', gap: 3, overflowX: 'hidden' }}>
          {[1,2,3,4].map(i => (
            <div key={i} style={{
              height: 9, width: i === 1 ? 28 : 22,
              background: i === 1 ? primary : C.card,
              borderRadius: 8, flexShrink: 0,
            }} />
          ))}
        </div>
      )}
      {/* Content area */}
      <div style={{ flex: 1, padding: '5px 7px', overflow: 'hidden' }}>
        {showQuick ? (
          <>
            <div style={{ height: 5, width: 30, background: C.muted, borderRadius: 2, marginBottom: 5, opacity: 0.5 }} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
              {[1,2,3,4,5,6].map(i => (
                <div key={i} style={{
                  background: C.card, borderRadius: 4, height: 22,
                  border: `1px solid ${C.border}`,
                  display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
                  padding: '3px 4px',
                }}>
                  <div style={{ height: 4, background: C.muted, borderRadius: 2, opacity: 0.4 }} />
                  <div style={{ height: 4, width: '60%', background: primary, borderRadius: 2, opacity: 0.6 }} />
                </div>
              ))}
            </div>
          </>
        ) : (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ fontSize: 7, color: C.muted, textAlign: 'center', opacity: 0.7 }}>
              Scan or search<br />to add items
            </div>
          </div>
        )}
      </div>
      {/* Tender buttons in counterMode */}
      {isCounter && (
        <div style={{ padding: '5px 7px', borderTop: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
            <div style={{ height: 5, width: '30%', background: C.card, borderRadius: 2 }} />
            <div style={{ height: 5, width: 28, background: primary, borderRadius: 2, opacity: 0.8 }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: qt.map(() => '1fr').join(' '), gap: 3 }}>
            {qt.map(m => (
              <div key={m} style={{
                height: 16, borderRadius: 4,
                background: qtColors[m] || C.card,
                border: `1px solid ${C.border}`,
              }} />
            ))}
          </div>
        </div>
      )}
    </div>
  );

  // Cart pane
  const cartPane = (
    <div style={{ width: cartW, display: 'flex', flexDirection: 'column', background: C.panel, flexShrink: 0 }}>
      {/* Customer bar */}
      <div style={{ padding: '4px 7px', borderBottom: `1px solid ${C.border}` }}>
        <div style={{ height: 8, width: '55%', background: C.card, borderRadius: 3 }} />
      </div>
      {/* Cart label */}
      <div style={{ padding: '3px 7px 3px', borderBottom: `1px solid ${C.border}` }}>
        <div style={{ height: 7, width: '25%', background: C.card, borderRadius: 3 }} />
      </div>
      {/* Cart rows */}
      <div style={{ flex: 1, padding: '5px 7px', display: 'flex', flexDirection: 'column', gap: 4, overflow: 'hidden' }}>
        {[1,2,3].map(i => (
          <div key={i} style={{
            height: 20, background: C.card, borderRadius: 5,
            border: `1px solid ${C.border}`,
            display: 'flex', alignItems: 'center', padding: '0 6px', gap: 4,
          }}>
            <div style={{ flex: 1, height: 5, background: C.border, borderRadius: 2 }} />
            <div style={{ width: 22, height: 5, background: primary, borderRadius: 2, opacity: 0.7 }} />
          </div>
        ))}
      </div>
      {/* Totals area */}
      <div style={{ padding: '5px 7px', borderTop: `1px solid ${C.border}` }}>
        {/* Subtotal row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
          <div style={{ height: 5, width: '30%', background: C.card, borderRadius: 2 }} />
          <div style={{ height: 5, width: 28, background: primary, borderRadius: 2, opacity: 0.8 }} />
        </div>
        {/* Quick tender buttons — hidden in counterMode (shown in search pane instead) */}
        {!isCounter && (
        <div style={{ display: 'grid', gridTemplateColumns: qt.map(() => '1fr').join(' '), gap: 3 }}>
          {qt.map(m => (
            <div key={m} style={{
              height: 16, borderRadius: 4,
              background: qtColors[m] || C.card,
              border: `1px solid ${C.border}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <div style={{
                height: 5, width: '50%',
                background: m === 'cash' ? primary : m === 'card' ? 'rgba(59,130,246,.7)' : 'rgba(52,211,153,.7)',
                borderRadius: 2,
              }} />
            </div>
          ))}
        </div>
        )}
      </div>
    </div>
  );

  const shortcuts = config.shortcuts || {};

  return (
    <div style={{
      borderRadius: 12, overflow: 'hidden',
      border: `1px solid ${C.border}`,
      boxShadow: 'var(--shadow-lg)',
      userSelect: 'none',
    }}>
      {/* Status bar */}
      <div style={{
        height: 18, background: C.statusBg,
        display: 'flex', alignItems: 'center', padding: '0 8px', gap: 5,
      }}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: primary }} />
        <div style={{ height: 4, width: 50, background: 'rgba(255,255,255,.15)', borderRadius: 2 }} />
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
          <div style={{ height: 4, width: 24, background: 'rgba(255,255,255,.1)', borderRadius: 2 }} />
          <div style={{ height: 4, width: 16, background: 'rgba(255,255,255,.1)', borderRadius: 2 }} />
        </div>
      </div>

      {/* Content row */}
      <div style={{ display: 'flex', height: 180 }}>
        {(isClassic || isCounter) ? cartPane : searchPane}
        {(isClassic || isCounter) ? searchPane : cartPane}
      </div>

      {/* Action bar */}
      <div style={{
        height: 22, background: C.panel, borderTop: `1px solid ${C.border}`,
        display: 'flex', alignItems: 'center', padding: '0 8px', gap: 4,
      }}>
        {/* Manager button — always left */}
        <div style={{
          height: 14, width: 38, background: C.card, borderRadius: 4,
          border: `1px solid ${C.border}`,
        }} />
        <div style={{ flex: 1 }} />
        {/* Shortcut chips on right */}
        {shortcuts.noSale   !== false && <div style={{ height: 12, width: 26, background: C.card, borderRadius: 3, border: `1px solid ${C.border}` }} />}
        {shortcuts.reprint  !== false && <div style={{ height: 12, width: 22, background: C.card, borderRadius: 3, border: `1px solid ${C.border}` }} />}
        {shortcuts.hold     !== false && <div style={{ height: 12, width: 22, background: C.card, borderRadius: 3, border: `1px solid ${C.border}` }} />}
        {shortcuts.priceCheck !== false && <div style={{ height: 12, width: 32, background: C.card, borderRadius: 3, border: `1px solid ${C.border}` }} />}
      </div>

      {/* Label */}
      <div style={{
        padding: '4px 8px', background: C.statusBg,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span style={{ fontSize: 8, color: C.muted, fontWeight: 700, letterSpacing: '0.05em' }}>
          {(config.layout || 'modern').toUpperCase()} LAYOUT
        </span>
        <span style={{ fontSize: 8, color: primary, fontWeight: 700 }}>
          {branding?.logoText || 'Store POS'}
        </span>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────

export default function POSSettings() {
  const [searchParams] = useSearchParams();

  const [stores,        setStores]        = useState([]);
  const [storeId,       setStoreId]       = useState('');
  const [config,        setConfig]        = useState(DEFAULT_CONFIG);
  const [saved,         setSaved]         = useState(DEFAULT_CONFIG);
  const [branding,      setBranding]      = useState(DEFAULT_BRANDING);
  const [savedBranding, setSavedBranding] = useState(DEFAULT_BRANDING);
  const [loading,       setLoading]       = useState(false);
  const [saving,        setSaving]        = useState(false);
  const [didSave,       setDidSave]       = useState(false);

  // Load stores, auto-select from ?store= param
  useEffect(() => {
    getStores()
      .then(res => {
        const list = Array.isArray(res) ? res : (res.data ?? []);
        setStores(list);
        if (!list.length) return;
        const paramId = searchParams.get('store');
        const match   = paramId && list.find(s => (s.id || s.id) === paramId);
        const target  = match || list[0];
        setStoreId(target.id || target.id);
      })
      .catch(() => {});
  }, []);

  // Load POS config + branding when store changes
  useEffect(() => {
    if (!storeId) return;
    setLoading(true);
    api.get('/pos-terminal/config', { params: { storeId } })
      .then(res => {
        const data = res.data;

        // Merge pos config with defaults
        const { branding: b, ...posData } = data;
        const merged = {
          ...DEFAULT_CONFIG,
          ...posData,
          shortcuts:   { ...DEFAULT_CONFIG.shortcuts, ...(posData.shortcuts || {}) },
          quickTender: Array.isArray(posData.quickTender) ? posData.quickTender : DEFAULT_CONFIG.quickTender,
        };
        setConfig(merged);
        setSaved(merged);

        // Merge branding with defaults
        const mergedBranding = { ...DEFAULT_BRANDING, ...(b || {}) };
        setBranding(mergedBranding);
        setSavedBranding(mergedBranding);
      })
      .catch(() => {
        setConfig(DEFAULT_CONFIG);
        setSaved(DEFAULT_CONFIG);
        setBranding(DEFAULT_BRANDING);
        setSavedBranding(DEFAULT_BRANDING);
      })
      .finally(() => setLoading(false));
  }, [storeId]);

  const setField = (field, value) => setConfig(c => ({ ...c, [field]: value }));

  const setShortcut = (key, value) =>
    setConfig(c => ({ ...c, shortcuts: { ...c.shortcuts, [key]: value } }));

  const toggleQuickTender = (method) => {
    setConfig(c => {
      const qt = c.quickTender.includes(method)
        ? c.quickTender.filter(m => m !== method)
        : [...c.quickTender, method];
      return { ...c, quickTender: qt };
    });
  };

  const setBrandingField = (field, value) =>
    setBranding(b => ({ ...b, [field]: value }));

  const handleSave = async () => {
    if (!storeId) return;
    setSaving(true);
    setDidSave(false);
    try {
      await api.put('/pos-terminal/config', { storeId, config, branding });
      setSaved(config);
      setSavedBranding(branding);
      setDidSave(true);
      toast.success('POS settings saved! Terminals will update within 5 minutes.');
      setTimeout(() => setDidSave(false), 3000);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save POS settings');
    } finally {
      setSaving(false);
    }
  };

  const hasChanges =
    JSON.stringify(config)   !== JSON.stringify(saved) ||
    JSON.stringify(branding) !== JSON.stringify(savedBranding);

  // ── Shared styles ──────────────────────────────────────────────────────

  const cardStyle = {
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-color)',
    borderRadius: 14,
    padding: '1.5rem',
    marginBottom: '1.25rem',
    boxShadow: 'var(--shadow-sm)',
  };

  const sectionLabel = {
    fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)',
    letterSpacing: '0.07em', marginBottom: '1rem', display: 'block',
  };

  return (
    <div className="layout-container">
      <Sidebar />
      <div className="main-content" style={{ display: 'flex', gap: 0, flex: 1, overflow: 'hidden' }}>

        {/* ── Left column: settings ── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '2rem', minWidth: 0 }}>

        {/* ── Header ── */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.75rem', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 10,
              background: 'rgba(122,193,67,.12)', border: '1px solid rgba(122,193,67,.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Monitor size={18} color="#7ac143" />
            </div>
            <div>
              <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
                POS Settings
              </h1>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
                Configure your Point of Sale terminal layout and features
              </p>
            </div>
          </div>

          {/* Store selector */}
          {stores.length > 1 && (
            <select
              value={storeId}
              onChange={e => setStoreId(e.target.value)}
              style={{
                background: 'var(--bg-tertiary)', color: 'var(--text-primary)',
                border: '1px solid var(--border-color)', borderRadius: 8,
                padding: '0.55rem 0.875rem', fontSize: '0.85rem', cursor: 'pointer',
              }}
            >
              {stores.map(s => (
                <option key={s.id || s.id} value={s.id || s.id}>{s.name}</option>
              ))}
            </select>
          )}
        </div>

        {loading ? (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            height: 200, color: '#475569', fontSize: '0.9rem',
          }}>
            Loading POS settings…
          </div>
        ) : (
          <div style={{ maxWidth: 860 }}>

            {/* ── Section 1: Layout Presets ── */}
            <div style={cardStyle}>
              <span style={sectionLabel}>LAYOUT PRESET</span>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(175px, 1fr))', gap: 12 }}>
                {LAYOUT_PRESETS.map(preset => {
                  const active = config.layout === preset.key;
                  return (
                    <button
                      key={preset.key}
                      onClick={() => setField('layout', preset.key)}
                      style={{
                        background: active ? 'rgba(122,193,67,.07)' : 'var(--bg-tertiary)',
                        border: `2px solid ${active ? '#7ac143' : 'var(--border-color)'}`,
                        borderRadius: 12, padding: '0.875rem',
                        cursor: 'pointer', textAlign: 'left',
                        transition: 'border-color .15s, background .15s',
                        position: 'relative',
                        width: '100%',
                      }}
                    >
                      {/* Active checkmark badge */}
                      {active && (
                        <div style={{
                          position: 'absolute', top: 8, right: 8,
                          width: 18, height: 18, borderRadius: '50%',
                          background: '#7ac143',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          <Check size={10} color="#fff" strokeWidth={3} />
                        </div>
                      )}
                      {/* Layout diagram */}
                      <div style={{ marginBottom: 10 }}>
                        {preset.diagram}
                      </div>
                      {/* Name */}
                      <div style={{
                        fontSize: '0.82rem', fontWeight: 700,
                        color: active ? '#7ac143' : 'var(--text-primary)',
                        marginBottom: 3,
                      }}>
                        {preset.name}
                      </div>
                      {/* Description */}
                      <div style={{ fontSize: '0.72rem', color: '#64748b', lineHeight: 1.4 }}>
                        {preset.description}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ── Section 2: Feature Toggles ── */}
            <div style={cardStyle}>
              <span style={sectionLabel}>FEATURES</span>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.875rem 2rem' }}>
                <Toggle
                  checked={config.showDepartments}
                  onChange={v => setField('showDepartments', v)}
                  label="Show Departments"
                />
                <Toggle
                  checked={config.showQuickAdd}
                  onChange={v => setField('showQuickAdd', v)}
                  label="Show Quick Add Grid"
                />
                <Toggle
                  checked={config.numpadEnabled}
                  onChange={v => setField('numpadEnabled', v)}
                  label="Numpad (Touch Mode)"
                />
                <Toggle
                  checked={config.customerLookup}
                  onChange={v => setField('customerLookup', v)}
                  label="Customer Lookup"
                />
              </div>

              {/* Cash rounding option */}
              <div style={{
                marginTop: '1.25rem', paddingTop: '1.25rem',
                borderTop: '1px solid rgba(255,255,255,.06)',
              }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748b', letterSpacing: '0.05em', marginBottom: '0.75rem' }}>
                  CASH CHANGE ROUNDING
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {[
                    { value: 'none', label: 'Exact change', sub: 'Give pennies (default)' },
                    { value: '0.05', label: 'Nearest $0.05', sub: 'No-penny policy' },
                  ].map(({ value, label, sub }) => (
                    <button
                      key={value}
                      onClick={() => setField('cashRounding', value)}
                      style={{
                        flex: 1, padding: '0.75rem', borderRadius: 10, textAlign: 'left',
                        border: `1.5px solid ${config.cashRounding === value ? '#7ac143' : 'var(--border-color)'}`,
                        background: config.cashRounding === value ? 'rgba(122,193,67,.07)' : 'var(--bg-tertiary)',
                        cursor: 'pointer', transition: 'all .15s',
                      }}
                    >
                      <div style={{ fontSize: '0.82rem', fontWeight: 700, color: config.cashRounding === value ? '#7ac143' : 'var(--text-primary)', marginBottom: 2 }}>
                        {label}
                      </div>
                      <div style={{ fontSize: '0.7rem', color: '#64748b' }}>{sub}</div>
                    </button>
                  ))}
                </div>
                {config.cashRounding === '0.05' && (
                  <div style={{
                    marginTop: 8, padding: '0.5rem 0.75rem', borderRadius: 8,
                    background: 'rgba(245,158,11,.07)', border: '1px solid rgba(245,158,11,.2)',
                    fontSize: '0.72rem', color: '#f59e0b',
                  }}>
                    💡 Change will be rounded to nearest $0.05 — e.g. $0.33 becomes $0.35, $0.31 becomes $0.30
                  </div>
                )}
              </div>
            </div>

            {/* ── Section 3: Action Bar Shortcuts ── */}
            <div style={cardStyle}>
              <span style={sectionLabel}>ACTION BAR SHORTCUTS</span>
              <p style={{ fontSize: '0.78rem', color: '#475569', margin: '0 0 1rem' }}>
                Choose which shortcut buttons appear in the cashier action bar.
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <ChipToggle
                  checked={config.shortcuts.priceCheck}
                  onChange={v => setShortcut('priceCheck', v)}
                  label="Price Check"
                />
                <ChipToggle
                  checked={config.shortcuts.hold}
                  onChange={v => setShortcut('hold', v)}
                  label="Hold Transaction"
                />
                <ChipToggle
                  checked={config.shortcuts.reprint}
                  onChange={v => setShortcut('reprint', v)}
                  label="Reprint Receipt"
                />
                <ChipToggle
                  checked={config.shortcuts.noSale}
                  onChange={v => setShortcut('noSale', v)}
                  label="No Sale"
                />
                <ChipToggle
                  checked={config.shortcuts.discount}
                  onChange={v => setShortcut('discount', v)}
                  label="Discount"
                />
                <ChipToggle
                  checked={config.shortcuts.refund}
                  onChange={v => setShortcut('refund', v)}
                  label="Refund"
                />
                <ChipToggle
                  checked={config.shortcuts.voidTx}
                  onChange={v => setShortcut('voidTx', v)}
                  label="Void Transaction"
                />
                <ChipToggle
                  checked={config.shortcuts.endOfDay}
                  onChange={v => setShortcut('endOfDay', v)}
                  label="End of Day"
                />
              </div>
            </div>

            {/* ── Section 4: Quick Tender Methods ── */}
            <div style={cardStyle}>
              <span style={sectionLabel}>QUICK TENDER METHODS</span>
              <p style={{ fontSize: '0.78rem', color: '#475569', margin: '0 0 1rem' }}>
                Select which payment buttons appear in the quick-tender strip at checkout.
              </p>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {[
                  { key: 'card',  label: 'Card' },
                  { key: 'cash',  label: 'Cash' },
                  { key: 'ebt',   label: 'EBT'  },
                ].map(({ key, label }) => {
                  const active = config.quickTender.includes(key);
                  return (
                    <button
                      key={key}
                      onClick={() => toggleQuickTender(key)}
                      style={{
                        padding: '0.55rem 1.25rem',
                        borderRadius: 8,
                        border: `2px solid ${active ? '#7ac143' : 'var(--border-color)'}`,
                        background: active ? 'rgba(122,193,67,.1)' : 'var(--bg-tertiary)',
                        color: active ? '#7ac143' : 'var(--text-muted)',
                        fontWeight: 700, fontSize: '0.85rem',
                        cursor: 'pointer', transition: 'all .15s',
                        display: 'flex', alignItems: 'center', gap: 6,
                      }}
                    >
                      {active && <Check size={12} />}
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ── Section 5: Store Branding ── */}
            <div style={cardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '1rem' }}>
                <Palette size={14} color="#7ac143" />
                <span style={{ ...sectionLabel, marginBottom: 0 }}>STORE BRANDING</span>
              </div>

              {/* Theme toggle */}
              <div style={{ marginBottom: '1.25rem' }}>
                <div style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 600, marginBottom: 8 }}>
                  Theme
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {[
                    { key: 'dark',  icon: <Moon size={13} />,  label: 'Dark'  },
                    { key: 'light', icon: <Sun  size={13} />,  label: 'Light' },
                  ].map(({ key, icon, label }) => (
                    <button
                      key={key}
                      onClick={() => setBrandingField('theme', key)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        padding: '0.5rem 1rem', borderRadius: 8,
                        border: `1.5px solid ${branding.theme === key ? '#7ac143' : 'var(--border-color)'}`,
                        background: branding.theme === key ? 'rgba(122,193,67,.1)' : 'var(--bg-tertiary)',
                        color: branding.theme === key ? '#7ac143' : 'var(--text-muted)',
                        fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer',
                        transition: 'all .15s',
                      }}
                    >
                      {icon} {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Accent colour */}
              <div style={{ marginBottom: '1.25rem' }}>
                <div style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 600, marginBottom: 8 }}>
                  Accent Colour
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  {PRESET_COLORS.map(c => (
                    <button
                      key={c}
                      onClick={() => setBrandingField('primaryColor', c)}
                      style={{
                        width: 32, height: 32, borderRadius: '50%',
                        background: c, border: 'none', cursor: 'pointer', flexShrink: 0,
                        outline: branding.primaryColor === c ? `3px solid ${c}` : '2px solid transparent',
                        outlineOffset: 2,
                        boxShadow: branding.primaryColor === c ? '0 0 0 1px var(--bg-primary)' : 'none',
                        transition: 'outline-color .12s',
                      }}
                    />
                  ))}
                  {/* Custom hex input */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{
                      width: 26, height: 26, borderRadius: '50%',
                      background: branding.primaryColor, flexShrink: 0,
                    }} />
                    <input
                      type="text"
                      value={branding.primaryColor}
                      onChange={e => setBrandingField('primaryColor', e.target.value)}
                      style={{
                        width: 90, background: '#252836', color: '#f1f5f9',
                        border: '1px solid rgba(255,255,255,.12)', borderRadius: 6,
                        padding: '0.3rem 0.5rem', fontSize: '0.78rem', fontFamily: 'monospace',
                      }}
                      placeholder="#7ac143"
                    />
                  </div>
                </div>
              </div>

              {/* Logo text */}
              <div>
                <div style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 600, marginBottom: 6 }}>
                  POS Header Name <span style={{ fontWeight: 400, opacity: 0.7 }}>(leave blank to use store name)</span>
                </div>
                <input
                  type="text"
                  value={branding.logoText || ''}
                  onChange={e => setBrandingField('logoText', e.target.value)}
                  placeholder="e.g. Corner Mart POS"
                  style={{
                    width: '100%', maxWidth: 320,
                    background: 'var(--bg-tertiary)', color: 'var(--text-primary)',
                    border: '1px solid var(--border-color)', borderRadius: 8,
                    padding: '0.5rem 0.75rem', fontSize: '0.85rem',
                  }}
                />
              </div>

              {/* Live colour preview strip */}
              <div style={{
                marginTop: '1.25rem', padding: '0.75rem 1rem', borderRadius: 8,
                background: 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', gap: 12,
                border: '1px solid var(--border-color)',
              }}>
                <div style={{
                  width: 10, height: 10, borderRadius: '50%',
                  background: branding.primaryColor, flexShrink: 0,
                }} />
                <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Preview accent:</span>
                <span style={{ fontSize: '0.82rem', fontWeight: 700, color: branding.primaryColor }}>
                  {branding.logoText || 'Store Name'} POS
                </span>
                <div style={{
                  marginLeft: 'auto', padding: '2px 10px', borderRadius: 4,
                  background: branding.primaryColor, color: '#0f1117',
                  fontSize: '0.7rem', fontWeight: 800,
                }}>
                  CHARGE
                </div>
              </div>
            </div>

            {/* ── Save Button ── */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <button
                onClick={handleSave}
                disabled={saving || !hasChanges || !storeId}
                style={{
                  padding: '0.875rem 2rem',
                  background: didSave ? '#16a34a' : hasChanges ? '#7ac143' : 'rgba(255,255,255,.06)',
                  color: hasChanges || didSave ? '#fff' : '#475569',
                  border: 'none', borderRadius: 10, fontWeight: 800, fontSize: '0.95rem',
                  cursor: hasChanges && !saving ? 'pointer' : 'not-allowed',
                  display: 'flex', alignItems: 'center', gap: 8,
                  transition: 'background .2s',
                  opacity: saving ? 0.7 : 1,
                }}
              >
                {didSave
                  ? <><Check size={16} /> Saved!</>
                  : saving
                    ? 'Saving…'
                    : <><Save size={16} /> Save &amp; Publish</>}
              </button>
              {hasChanges && !saving && (
                <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
                  Unsaved changes · POS terminals update within 5 min after publishing
                </span>
              )}
            </div>

          </div>
        )}
        </div>{/* end left column */}

        {/* ── Right column: sticky live preview ── */}
        <div style={{
          width: 420, flexShrink: 0,
          borderLeft: '1px solid var(--border-color)',
          background: 'var(--bg-primary)',
          display: 'flex', flexDirection: 'column',
          padding: '2rem',
          overflowY: 'auto',
          position: 'sticky', top: 0, alignSelf: 'flex-start',
        }}>
          <div style={{ marginBottom: '1rem' }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748b', letterSpacing: '0.07em', marginBottom: 4 }}>
              LIVE PREVIEW
            </div>
            <div style={{ fontSize: '0.78rem', color: '#475569' }}>
              Updates as you configure
            </div>
          </div>
          {storeId ? (
            <POSPreview config={config} branding={branding} />
          ) : (
            <div style={{
              height: 220, background: 'var(--bg-secondary)', borderRadius: 12,
              border: '1px solid var(--border-color)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--text-muted)', fontSize: '0.8rem',
            }}>
              Select a store to preview
            </div>
          )}
          {/* Layout label cards below preview */}
          <div style={{ marginTop: '1.25rem', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              { key: 'modern',  label: '⬛ Modern',       note: 'Categories left · Cart right' },
              { key: 'express', label: '⚡ Express Lane',  note: 'Search only · Wide cart' },
              { key: 'classic', label: '🗂 Classic',       note: 'Cart left · Categories right' },
              { key: 'counter', label: '🖥 Counter',       note: 'Cart left · Tender always right' },
              { key: 'minimal', label: '🔍 Minimal',       note: 'Search only · Clean UI' },
            ].map(({ key, label, note }) => (
              <button
                key={key}
                onClick={() => setField('layout', key)}
                style={{
                  padding: '0.6rem 0.875rem', borderRadius: 8, textAlign: 'left', cursor: 'pointer',
                  background: config.layout === key ? 'rgba(122,193,67,.08)' : 'var(--bg-secondary)',
                  border: `1.5px solid ${config.layout === key ? '#7ac143' : 'var(--border-color)'}`,
                  transition: 'all .15s',
                  boxShadow: config.layout === key ? 'var(--shadow-sm)' : 'none',
                }}
              >
                <div style={{ fontSize: '0.78rem', fontWeight: 700, color: config.layout === key ? '#7ac143' : 'var(--text-primary)' }}>{label}</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 2 }}>{note}</div>
              </button>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
