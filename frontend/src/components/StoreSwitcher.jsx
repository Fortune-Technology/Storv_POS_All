import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check, Loader, MapPin, Store } from 'lucide-react';
import { useStore } from '../contexts/StoreContext';

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
        padding: '10px 14px',
        border: 'none',
        cursor: isActive ? 'default' : 'pointer',
        textAlign: 'left',
        background: isActive
          ? 'rgba(122,193,67,0.08)'
          : hovered
          ? 'rgba(255,255,255,0.04)'
          : 'transparent',
        transition: 'background 0.1s',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
      }}
    >
      {/* Avatar */}
      <div style={{
        width: 34, height: 34, borderRadius: 9, flexShrink: 0,
        background: isActive ? '#7ac143' : 'rgba(255,255,255,0.08)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '0.95rem', fontWeight: 800,
        color: isActive ? '#fff' : 'rgba(255,255,255,0.45)',
      }}>
        {storeInitial(store.name)}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: '0.85rem', fontWeight: isActive ? 700 : 500,
          color: isActive ? '#fff' : 'rgba(255,255,255,0.75)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {store.name}
        </div>
        {store.address && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 3,
            fontSize: '0.68rem', color: 'rgba(255,255,255,0.35)',
            marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            <MapPin size={9} style={{ flexShrink: 0 }} />
            {store.address}
          </div>
        )}
      </div>

      {isActive && (
        <div style={{
          width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
          background: '#7ac143',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Check size={11} color="#fff" strokeWidth={3} />
        </div>
      )}
    </button>
  );
}

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
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ ...avatarStyle, background: 'rgba(255,255,255,0.07)' }}>
            <Loader size={14} color="rgba(255,255,255,0.3)" style={{ animation: 'spin 1s linear infinite' }} />
          </div>
          <span style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.35)', fontWeight: 600 }}>Loading…</span>
        </div>
      </div>
    );
  }

  if (!activeStore) return null;

  return (
    <div ref={ref} style={{ position: 'relative', margin: '0 12px 12px' }}>

      {/* ── Trigger card ── */}
      <button
        onClick={() => canSwitch && setOpen(v => !v)}
        disabled={!canSwitch}
        title={canSwitch ? 'Switch store' : activeStore.name}
        style={{
          ...cardStyle,
          cursor: canSwitch ? 'pointer' : 'default',
          width: '100%',
          transition: 'background 0.12s, border-color 0.12s',
        }}
        onMouseEnter={e => { if (canSwitch) e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; }}
        onMouseLeave={e => { if (canSwitch) e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
      >
        {/* Avatar */}
        <div style={avatarStyle}>
          {storeInitial(activeStore.name)}
        </div>

        {/* Text */}
        <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
          <div style={{
            fontSize: '0.58rem', fontWeight: 700,
            color: 'rgba(255,255,255,0.4)',
            textTransform: 'uppercase', letterSpacing: '0.08em',
            marginBottom: 3,
          }}>
            Active Store
          </div>
          <div style={{
            fontSize: '0.88rem', fontWeight: 800,
            color: '#fff',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            lineHeight: 1.2,
          }}>
            {activeStore.name}
          </div>
          {activeStore.address && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 3,
              fontSize: '0.64rem', color: 'rgba(255,255,255,0.35)',
              marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              <MapPin size={8} style={{ flexShrink: 0 }} />
              {activeStore.address}
            </div>
          )}
        </div>

        {canSwitch && (
          <ChevronDown
            size={15}
            color="rgba(255,255,255,0.45)"
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
          top: 'calc(100% + 6px)',
          left: 0,
          right: 0,
          background: '#1e2433',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 12,
          boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
          zIndex: 9999,
          overflow: 'hidden',
          animation: 'fadeIn 0.12s ease',
        }}>
          {/* Header */}
          <div style={{
            padding: '8px 14px',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <Store size={11} color="#7ac143" />
            <span style={{
              fontSize: '0.62rem', fontWeight: 700,
              color: 'rgba(255,255,255,0.4)',
              textTransform: 'uppercase', letterSpacing: '0.07em',
            }}>
              {stores.length} {stores.length === 1 ? 'Store' : 'Stores'}
            </span>
          </div>

          {stores.map((store) => (
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

const cardStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '10px 12px',
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.09)',
  borderRadius: 12,
};

const avatarStyle = {
  width: 36, height: 36,
  borderRadius: 10,
  background: '#7ac143',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontSize: '1.05rem', fontWeight: 900,
  color: '#fff',
  flexShrink: 0,
  letterSpacing: '-0.02em',
};
