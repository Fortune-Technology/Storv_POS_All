/**
 * StoreSwitcher — compact store selector for the sidebar (light theme).
 */
import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check, Loader, MapPin, Store } from 'lucide-react';
import { useStore } from '../contexts/StoreContext';
import './StoreSwitcher.css';

function storeInitial(name = '') {
  return name.trim().charAt(0).toUpperCase() || '?';
}

function StoreOption({ store, isActive, onSelect }) {
  return (
    <button
      onClick={onSelect}
      className={`sw-option ${isActive ? 'sw-option--active' : ''}`}
    >
      <div className={`sw-option-avatar ${isActive ? 'sw-option-avatar--active' : 'sw-option-avatar--inactive'}`}>
        {storeInitial(store.name)}
      </div>

      <div className="sw-option-text">
        <div className={`sw-option-name ${isActive ? 'sw-option-name--active' : 'sw-option-name--inactive'}`}>
          {store.name}
        </div>
        {store.address && (
          <div className="sw-option-addr">
            <MapPin size={9} className="sw-option-addr-icon" />
            {store.address}
          </div>
        )}
      </div>

      {isActive && (
        <div className="sw-check">
          <Check size={10} color="#fff" strokeWidth={3} />
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
      <div className="sw-trigger sw-trigger--disabled" style={{ margin: '0 10px 10px' }}>
        <div className="sw-avatar sw-avatar--loading">
          <Loader size={13} color="#3d56b5" className="animate-spin" />
        </div>
        <span className="sw-loading-text">Loading…</span>
      </div>
    );
  }

  if (!activeStore) return null;

  return (
    <div ref={ref} className="sw-root">

      {/* ── Trigger card ── */}
      <button
        onClick={() => canSwitch && setOpen(v => !v)}
        disabled={!canSwitch}
        title={canSwitch ? 'Switch store' : activeStore.name}
        className={`sw-trigger ${open ? 'sw-trigger--open' : ''} ${canSwitch ? 'sw-trigger--clickable' : 'sw-trigger--disabled'}`}
      >
        <div className="sw-avatar">{storeInitial(activeStore.name)}</div>

        <div className="sw-text">
          <div className="sw-label">Active Store</div>
          <div className="sw-name">{activeStore.name}</div>
          {activeStore.address && (
            <div className="sw-address">
              <MapPin size={8} className="sw-address-icon" />
              {activeStore.address}
            </div>
          )}
        </div>

        {canSwitch && (
          <ChevronDown size={14} color="#94a3b8" className={`sw-chevron ${open ? 'sw-chevron--open' : ''}`} />
        )}
      </button>

      {/* ── Dropdown ── */}
      {open && (
        <div className="sw-dropdown">
          <div className="sw-dropdown-header">
            <Store size={11} color="#3d56b5" />
            <span className="sw-dropdown-label">
              {stores.length} {stores.length === 1 ? 'Store' : 'Stores'}
            </span>
          </div>

          {/* Group stores by organisation. When the user belongs to a single
              org (most cases) the org header collapses to nothing — so the UX
              is identical to the pre-multi-org flat list. When they belong
              to multiple orgs, each group gets its own heading. */}
          {groupByOrg(stores).map(group => (
            <div key={group.orgId || 'legacy'}>
              {group.showHeader && (
                <div className="sw-group-header">{group.orgName}</div>
              )}
              {group.stores.map(store => (
                <StoreOption
                  key={store.id}
                  store={store}
                  isActive={store.id === activeStore.id}
                  onSelect={() => { switchStore(store.id); setOpen(false); }}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Returns an array of { orgId, orgName, showHeader, stores }, grouped by orgId.
// showHeader is true only when the user has stores in more than one org, so
// single-org users see no group headings (zero visual change from before).
function groupByOrg(stores) {
  const buckets = new Map();
  for (const store of stores) {
    const key = store.orgId || 'legacy';
    if (!buckets.has(key)) {
      buckets.set(key, {
        orgId:   store.orgId ?? null,
        orgName: store.orgName || 'Organisation',
        stores:  [],
      });
    }
    buckets.get(key).stores.push(store);
  }
  const groups = Array.from(buckets.values());
  const showHeader = groups.length > 1;
  return groups.map(g => ({ ...g, showHeader }));
}
