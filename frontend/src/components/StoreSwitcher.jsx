/**
 * StoreSwitcher — prominent store selector in the Sidebar.
 *
 * Design goals:
 *  - Instantly readable from a distance (large avatar, big name, high contrast)
 *  - Clearly separated from navigation (full-bleed green band)
 *  - Obvious that it's interactive when multiple stores exist
 */

import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check, Loader, MapPin, ArrowLeftRight } from 'lucide-react';
import { useStore } from '../contexts/StoreContext';

/* ── Helpers ─────────────────────────────────────────────────────────────── */
function storeInitial(name = '') {
  return name.trim().charAt(0).toUpperCase() || '?';
}

/* ── Individual store row in the dropdown ────────────────────────────────── */
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
        gap: '0.75rem',
        padding: '0.75rem 1rem',
        border: 'none',
        cursor: isActive ? 'default' : 'pointer',
        textAlign: 'left',
        background: isActive
          ? 'rgba(122,193,67,0.1)'
          : hovered
            ? 'var(--bg-tertiary)'
            : 'transparent',
        transition: 'background 0.12s',
        borderBottom: '1px solid var(--border-color)',
      }}
    >
      {/* Avatar */}
      <div style={{
        width: 38, height: 38, borderRadius: '10px', flexShrink: 0,
        background: isActive ? 'var(--accent-primary)' : 'var(--bg-tertiary)',
        border: isActive ? 'none' : '1.5px solid var(--border-color)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '1rem', fontWeight: 800,
        color: isActive ? '#fff' : 'var(--text-muted)',
        transition: 'all 0.15s',
      }}>
        {storeInitial(store.name)}
      </div>

      {/* Name + address */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: '0.9rem', fontWeight: isActive ? 700 : 500,
          color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {store.name}
        </div>
        {store.address && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '0.25rem',
            fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.15rem',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            <MapPin size={10} style={{ flexShrink: 0 }} />
            {store.address}
          </div>
        )}
      </div>

      {/* Active check */}
      {isActive && (
        <div style={{
          width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
          background: 'var(--accent-primary)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Check size={13} color="#fff" strokeWidth={3} />
        </div>
      )}
    </button>
  );
}

/* ══════════════════════════════════════════════════════════════════════════ */
export default function StoreSwitcher() {
  const { stores, activeStore, switchStore, loading } = useStore();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const canSwitch = stores.length > 1;

  /* ── Loading state ─────────────────────────────────────────────────────── */
  if (loading) {
    return (
      <div style={bandStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <div style={{ ...avatarStyle, background: 'rgba(255,255,255,0.12)' }}>
            <Loader size={16} color="rgba(255,255,255,0.5)" style={{ animation: 'spin 1s linear infinite' }} />
          </div>
          <span style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.5)', fontWeight: 600 }}>Loading…</span>
        </div>
      </div>
    );
  }

  /* ── No store ──────────────────────────────────────────────────────────── */
  if (!activeStore) return null;

  /* ── Main render ───────────────────────────────────────────────────────── */
  return (
    <div ref={ref} style={{ position: 'relative' }}>

      {/* ── Full-bleed green band ─────────────────────────────────────────── */}
      <button
        onClick={() => canSwitch && setOpen(v => !v)}
        disabled={!canSwitch}
        title={canSwitch ? 'Switch store' : activeStore.name}
        style={{
          ...bandStyle,
          cursor: canSwitch ? 'pointer' : 'default',
          opacity: 1,
        }}
      >
        {/* Large store avatar */}
        <div style={avatarStyle}>
          {storeInitial(activeStore.name)}
        </div>

        {/* Store name block */}
        <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
          <div style={{
            fontSize: '0.6rem', fontWeight: 700,
            color: 'rgba(255,255,255,0.6)',
            textTransform: 'uppercase', letterSpacing: '0.08em',
            lineHeight: 1, marginBottom: '0.2rem',
          }}>
            {canSwitch ? 'Active store · tap to switch' : 'Active store'}
          </div>
          <div style={{
            fontSize: '1rem', fontWeight: 800,
            color: '#fff',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            lineHeight: 1.2,
            letterSpacing: '-0.01em',
          }}>
            {activeStore.name}
          </div>
          {activeStore.address && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '0.25rem',
              fontSize: '0.68rem', color: 'rgba(255,255,255,0.55)',
              marginTop: '0.25rem',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              <MapPin size={9} style={{ flexShrink: 0 }} />
              {activeStore.address}
            </div>
          )}
        </div>

        {/* Switch icon for multi-store */}
        {canSwitch && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', flexShrink: 0,
          }}>
            <ArrowLeftRight size={14} color="rgba(255,255,255,0.7)" />
            <ChevronDown
              size={12}
              color="rgba(255,255,255,0.6)"
              style={{
                transform: open ? 'rotate(180deg)' : 'rotate(0)',
                transition: 'transform 0.2s',
              }}
            />
          </div>
        )}
      </button>

      {/* ── Dropdown ──────────────────────────────────────────────────────── */}
      {open && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 4px)',
          left: '0.75rem',
          right: '0.75rem',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: '0.875rem',
          boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
          zIndex: 9999,
          overflow: 'hidden',
          animation: 'fadeIn 0.15s ease',
        }}>
          {/* Dropdown header */}
          <div style={{
            padding: '0.6rem 1rem',
            background: 'var(--bg-tertiary)',
            borderBottom: '1px solid var(--border-color)',
            display: 'flex', alignItems: 'center', gap: '0.4rem',
          }}>
            <ArrowLeftRight size={12} style={{ color: 'var(--accent-primary)' }} />
            <span style={{
              fontSize: '0.68rem', fontWeight: 700,
              color: 'var(--text-muted)',
              textTransform: 'uppercase', letterSpacing: '0.07em',
            }}>
              Switch store — {stores.length} available
            </span>
          </div>

          {/* Store list */}
          {stores.map((store, idx) => (
            <StoreOption
              key={store._id}
              store={store}
              isActive={store._id === activeStore._id}
              onSelect={() => { switchStore(store._id); setOpen(false); }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Styles ──────────────────────────────────────────────────────────────── */

/** Full-bleed green band — the main trigger */
const bandStyle = {
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  gap: '0.875rem',
  padding: '0.875rem 1rem',
  background: 'linear-gradient(135deg, #5a9e2f 0%, #7ac143 60%, #8fd44e 100%)',
  border: 'none',
  borderTop: '1px solid rgba(255,255,255,0.08)',
  borderBottom: '1px solid rgba(0,0,0,0.18)',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.12)',
};

/** Large circular avatar with store initial */
const avatarStyle = {
  width: 44, height: 44,
  borderRadius: '12px',
  background: 'rgba(0,0,0,0.2)',
  border: '1.5px solid rgba(255,255,255,0.25)',
  boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.15)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontSize: '1.25rem', fontWeight: 900,
  color: '#fff',
  flexShrink: 0,
  letterSpacing: '-0.02em',
  fontFamily: 'Outfit, sans-serif',
};
