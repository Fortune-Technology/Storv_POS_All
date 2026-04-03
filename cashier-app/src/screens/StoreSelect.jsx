import React from 'react';
import { Store, ArrowRight, LogOut } from 'lucide-react';
import { useAuthStore } from '../stores/useAuthStore.js';
import { useNavigate } from 'react-router-dom';

export default function StoreSelect() {
  const { cashier, stores, setStore, logout } = useAuthStore();
  const navigate = useNavigate();

  // If only one store, auto-select and go straight to POS
  React.useEffect(() => {
    const storeList = cashier?.stores || stores;
    if (storeList?.length === 1) {
      const s = storeList[0];
      setStore(s.id || s._id);
      navigate('/', { replace: true });
    }
  }, []);

  const handleSelect = (store) => {
    setStore(store.id || store._id);
    navigate('/', { replace: true });
  };

  const storeList = cashier?.stores || stores;

  return (
    <div style={{
      height: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg-base)', padding: '1.5rem',
    }}>
      <div style={{ width: '100%', maxWidth: 480 }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-primary)' }}>
            Select Store
          </div>
          <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: 4 }}>
            Welcome, {cashier?.name} — choose your location to continue
          </div>
        </div>

        {/* Store list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {storeList?.length > 0 ? storeList.map(store => (
            <button
              key={store.id || store._id}
              onClick={() => handleSelect(store)}
              style={{
                padding: '1.1rem 1.25rem',
                background: 'var(--bg-panel)',
                border: '1px solid var(--border-light)',
                borderRadius: 'var(--r-lg)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                color: 'var(--text-primary)',
                transition: 'border-color .15s, background .15s',
              }}
              onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--green)'}
              onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border-light)'}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 10,
                  background: 'var(--green-dim)', border: '1px solid var(--green-border)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Store size={18} color="var(--green)" />
                </div>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>{store.name}</div>
                  {store.address && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>
                      {store.address}
                    </div>
                  )}
                </div>
              </div>
              <ArrowRight size={16} color="var(--text-muted)" />
            </button>
          )) : (
            <div style={{
              padding: '2rem', textAlign: 'center',
              background: 'var(--bg-panel)', borderRadius: 'var(--r-lg)',
              border: '1px solid var(--border)',
              color: 'var(--text-muted)', fontSize: '0.85rem',
            }}>
              No stores found for your account.<br />
              Set up a store in the portal first.
            </div>
          )}
        </div>

        {/* Logout */}
        <button onClick={logout} style={{
          marginTop: '1.5rem', width: '100%', padding: '0.75rem',
          background: 'none', color: 'var(--text-muted)',
          fontSize: '0.82rem', fontWeight: 600,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          borderRadius: 8, border: '1px solid var(--border)',
        }}>
          <LogOut size={14} /> Sign out
        </button>
      </div>
    </div>
  );
}
