/**
 * StoreSwitcher — compact store selector for the sidebar (light theme).
 * Shows active store with a click-to-switch dropdown when multiple stores exist.
 */
import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check, Loader, MapPin, Store } from 'lucide-react';
import { useStore } from '../contexts/StoreContext';

// ─── Light-theme design tokens ────────────────────────────────────────────────
const T = {
  cardBg:     '#f8fafc',
  cardBorder: 'rgba(0,0,0,0.08)',
  cardRadius: 10,

  avatarBg:   '#3d56b5',
  avatarText: '#ffffff',

  labelColor: '#94a3b8',   // "Active Store" caption
  nameColor:  '#0f172a',   // store name
  addrColor:  '#94a3b8',
  chevronClr: '#94a3b8',

  dropBg:     '#ffffff',
  dropBorder: 'rgba(0,0,0,0.09)',
  dropShadow: '0 8px 30px rgba(0,0,0,0.12)',
  dropHeader: '#f8fafc',

  activeBg:   'rgba(61,86,181,0.07)',
  hoverBg:    '#f8fafc',
  activeText: '#3d56b5',
  rowText:    '#0f172a',
  rowMuted:   '#94a3b8',
};

function storeInitial(name = '') {
  return name.trim().charAt(0).toUpperCase() || '?';
}

function StoreOption({ store, isActive, onSelect }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '9px 12px',
        border: 'none',
        cursor: isActive ? 'default' : 'pointer',
        textAlign: 'left',
        background: isActive ? T.activeBg : hovered ? T.hoverBg : 'transparent',
        borderBottom: '1px solid rgba(0,0,0,0.05)',
        transition: 'background 0.1s',
      }}
    >
      <div style={{
        width: 32, height: 32, borderRadius: 8, flexShrink: 0,
        background: isActive ? T.avatarBg : 'rgba(61,86,181,0.1)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '0.88rem', fontWeight: 800,
        color: isActive ? T.avatarText : T.avatarBg,
      }}>
        {storeInitial(store.name)}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: '0.84rem', fontWeight: isActive ? 700 : 500,
          color: isActive ? T.activeText : T.rowText,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {store.name}
        </div>
        {store.address && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 3, marginTop: 2,
            fontSize: '0.68rem', color: T.rowMuted,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            <MapPin size={9} style={{ flexShrink: 0 }} />
            {store.address}
          </div>
        )}
      </div>

      {isActive && (
        <div style={{
          width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
          background: T.avatarBg,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Check size={10} color="#fff" strokeWidth={3} />
        </div>
      )}
    </button>
  );
}

// ─── Shared style objects (defined before component so triggerStyle works) ────
const triggerBase = {
  display: 'flex',
  alignItems: 'center',
  gap: 9,
  padding: '9px 10px',
  border: `1px solid ${T.cardBorder}`,
  borderRadius: T.cardRadius,
};

const avatarStyle = {
  width: 34, height: 34,
  borderRadius: 9,
  background: T.avatarBg,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontSize: '1rem', fontWeight: 900,
  color: T.avatarText,
  flexShrink: 0,
  letterSpacing: '-0.02em',
};

export default function StoreSwitcher() {
  const { stores, activeStore, switchStore, loading } = useStore();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const canSwitch = stores.length > 1;

  if (loading) {
    return (
      <div style={{ ...triggerBase, background: T.cardBg, margin: '0 10px 10px', cursor: 'default' }}>
        <div style={{ ...avatarStyle, background: 'rgba(61,86,181,0.1)' }}>
          <Loader size={13} color={T.avatarBg} style={{ animation: 'spin 1s linear infinite' }} />
        </div>
        <span style={{ fontSize: '0.78rem', color: T.labelColor, fontWeight: 500 }}>Loading…</span>
      </div>
    );
  }

  if (!activeStore) return null;

  return (
    <div ref={ref} style={{ position: 'relative', margin: '0 10px 10px' }}>

      {/* ── Trigger card ── */}
      <button
        onClick={() => canSwitch && setOpen(v => !v)}
        disabled={!canSwitch}
        title={canSwitch ? 'Switch store' : activeStore.name}
        style={{
          ...triggerBase,
          background: open ? '#f1f5f9' : T.cardBg,
          cursor: canSwitch ? 'pointer' : 'default',
          width: '100%',
          transition: 'background 0.12s',
        }}
        onMouseEnter={e => { if (canSwitch && !open) e.currentTarget.style.background = '#f1f5f9'; }}
        onMouseLeave={e => { if (!open) e.currentTarget.style.background = T.cardBg; }}
      >
        {/* Avatar */}
        <div style={avatarStyle}>
          {storeInitial(activeStore.name)}
        </div>

        {/* Text labels */}
        <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
          <div style={{
            fontSize: '0.58rem', fontWeight: 700, textTransform: 'uppercase',
            letterSpacing: '0.07em', color: T.labelColor, marginBottom: 2,
          }}>
            Active Store
          </div>
          <div style={{
            fontSize: '0.85rem', fontWeight: 700, color: T.nameColor,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            lineHeight: 1.2,
          }}>
            {activeStore.name}
          </div>
          {activeStore.address && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 3, marginTop: 2,
              fontSize: '0.64rem', color: T.addrColor,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              <MapPin size={8} style={{ flexShrink: 0 }} />
              {activeStore.address}
            </div>
          )}
        </div>

        {canSwitch && (
          <ChevronDown
            size={14}
            color={T.chevronClr}
            style={{
              flexShrink: 0,
              transform: open ? 'rotate(180deg)' : 'rotate(0)',
              transition: 'transform 0.2s',
            }}
          />
        )}
      </button>

      {/* ── Dropdown ── */}
      {open && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 5px)',
          left: 0, right: 0,
          background: T.dropBg,
          border: `1px solid ${T.dropBorder}`,
          borderRadius: 10,
          boxShadow: T.dropShadow,
          zIndex: 9999,
          overflow: 'hidden',
        }}>
          {/* Dropdown header */}
          <div style={{
            padding: '7px 12px',
            background: T.dropHeader,
            borderBottom: '1px solid rgba(0,0,0,0.06)',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <Store size={11} color={T.avatarBg} />
            <span style={{
              fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: '0.07em', color: T.labelColor,
            }}>
              {stores.length} {stores.length === 1 ? 'Store' : 'Stores'}
            </span>
          </div>

          {stores.map(store => (
            <StoreOption
              key={store.id}
              store={store}
              isActive={store.id === activeStore.id}
              onSelect={() => { switchStore(store.id); setOpen(false); }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
