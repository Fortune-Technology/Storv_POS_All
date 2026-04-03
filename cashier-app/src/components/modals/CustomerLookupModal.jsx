import React, { useState, useEffect, useRef } from 'react';
import { Search, User, Star, X, UserCheck } from 'lucide-react';
import { useCartStore } from '../../stores/useCartStore.js';
import { useAuthStore } from '../../stores/useAuthStore.js';
import { searchCustomers } from '../../api/pos.js';

export default function CustomerLookupModal({ onClose }) {
  const setCustomer   = useCartStore(s => s.setCustomer);
  const clearCustomer = useCartStore(s => s.clearCustomer);
  const current       = useCartStore(s => s.customer);
  const cashier       = useAuthStore(s => s.cashier);

  const [query,    setQuery]   = useState('');
  const [results,  setResults] = useState([]);
  const [loading,  setLoading] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await searchCustomers(query, cashier?.storeId);
        setResults(data);
      } catch { setResults([]); }
      finally { setLoading(false); }
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const attach = (c) => {
    setCustomer({ id: c.id || c._id, name: c.name || `${c.firstName} ${c.lastName}`.trim(), phone: c.phone, loyaltyPoints: c.loyaltyPoints, cardNo: c.cardNo });
    onClose();
  };

  const detach = () => { clearCustomer(); onClose(); };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 150,
      background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '1rem',
    }}>
      <div style={{
        background: 'var(--bg-panel)', borderRadius: 18,
        border: '1px solid var(--border-light)',
        width: '100%', maxWidth: 440,
        boxShadow: '0 24px 60px rgba(0,0,0,.5)',
      }}>
        <div style={{
          padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <UserCheck size={18} color="var(--green)" />
          <div style={{ flex: 1, fontWeight: 800, color: 'var(--text-primary)' }}>Find Customer</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: '1rem 1.5rem' }}>
          {/* Current customer */}
          {current && (
            <div style={{
              background: 'rgba(122,193,67,.1)', border: '1px solid rgba(122,193,67,.25)',
              borderRadius: 10, padding: '0.75rem 1rem', marginBottom: '1rem',
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <User size={16} color="var(--green)" />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, color: 'var(--green)', fontSize: '0.9rem' }}>{current.name}</div>
                {current.loyaltyPoints != null && (
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    <Star size={10} style={{ display: 'inline', marginRight: 4 }} />
                    {current.loyaltyPoints.toLocaleString()} pts
                  </div>
                )}
              </div>
              <button onClick={detach} style={{
                background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer',
              }}>
                <X size={14} />
              </button>
            </div>
          )}

          {/* Search input */}
          <div style={{ position: 'relative', marginBottom: '0.75rem' }}>
            <Search size={15} color="var(--text-muted)" style={{
              position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
            }} />
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search by name or phone…"
              style={{
                width: '100%', boxSizing: 'border-box',
                paddingLeft: '2.25rem', height: 46,
                background: 'var(--bg-input)', border: '1px solid var(--border-light)',
                borderRadius: 10, color: 'var(--text-primary)', fontSize: '0.9rem',
              }}
            />
          </div>

          {/* Results */}
          <div style={{ maxHeight: 280, overflowY: 'auto' }}>
            {loading && <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1rem', fontSize: '0.85rem' }}>Searching…</div>}
            {!loading && query && results.length === 0 && (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1rem', fontSize: '0.85rem' }}>No customers found</div>
            )}
            {results.map(c => {
              const name = c.name || `${c.firstName || ''} ${c.lastName || ''}`.trim() || 'Unknown';
              return (
                <button key={c.id || c._id} onClick={() => attach(c)} style={{
                  width: '100%', padding: '0.75rem 0.5rem', textAlign: 'left',
                  background: 'none', border: 'none',
                  borderBottom: '1px solid var(--border)', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 10,
                  borderRadius: 0,
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}
                >
                  <div style={{
                    width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                    background: 'var(--bg-input)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <User size={16} color="var(--text-muted)" />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.88rem' }}>{name}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{c.phone || 'No phone'}</div>
                  </div>
                  {c.loyaltyPoints != null && (
                    <div style={{ fontSize: '0.72rem', color: 'var(--amber)', fontWeight: 700, flexShrink: 0 }}>
                      <Star size={10} style={{ display: 'inline', marginRight: 3 }} />
                      {c.loyaltyPoints.toLocaleString()}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
