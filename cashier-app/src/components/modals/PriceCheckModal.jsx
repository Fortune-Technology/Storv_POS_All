import React, { useState, useEffect, useRef } from 'react';
import { Tag, Search, X, Plus, AlertCircle } from 'lucide-react';
import { useCartStore } from '../../stores/useCartStore.js';
import { useProductLookup } from '../../hooks/useProductLookup.js';
import { useBarcodeScanner } from '../../hooks/useBarcodeScanner.js';
import { searchProducts } from '../../db/dexie.js';
import { fmt$ } from '../../utils/formatters.js';

export default function PriceCheckModal({ onClose }) {
  const addProduct    = useCartStore(s => s.addProduct);
  const requestAge    = useCartStore(s => s.requestAgeVerify);
  const { lookup }    = useProductLookup();

  const [query,    setQuery]   = useState('');
  const [product,  setProduct] = useState(null);
  const [results,  setResults] = useState([]);
  const [notFound, setNotFound]= useState(false);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Barcode scan inside modal
  useBarcodeScanner(async (raw) => {
    const { product: p } = await lookup(raw);
    if (p) { setProduct(p); setNotFound(false); setResults([]); }
    else   { setProduct(null); setNotFound(true); }
  }, true);

  useEffect(() => {
    if (!query.trim()) { setResults([]); setNotFound(false); return; }
    const t = setTimeout(() => {
      searchProducts(query, null).then(r => { setResults(r); setNotFound(r.length === 0); });
    }, 200);
    return () => clearTimeout(t);
  }, [query]);

  const addToCart = (p) => {
    if (p.ageRequired) requestAge(p);
    else addProduct(p);
    onClose();
  };

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
          <Tag size={18} color="var(--green)" />
          <div style={{ flex: 1, fontWeight: 800, color: 'var(--text-primary)' }}>Price Check</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: '1rem 1.5rem' }}>
          <div style={{ position: 'relative', marginBottom: '1rem' }}>
            <Search size={15} color="var(--text-muted)" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
            <input
              ref={inputRef} value={query}
              onChange={e => { setQuery(e.target.value); setProduct(null); }}
              placeholder="Search or scan barcode…"
              style={{
                width: '100%', boxSizing: 'border-box',
                paddingLeft: '2.25rem', height: 48,
                background: 'var(--bg-input)', border: '1px solid var(--border-light)',
                borderRadius: 10, color: 'var(--text-primary)', fontSize: '0.9rem',
              }}
            />
          </div>

          {/* Product result */}
          {product && (
            <div style={{
              background: 'var(--bg-card)', borderRadius: 12,
              border: '1px solid var(--border-light)', padding: '1.25rem',
            }}>
              <div style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--text-primary)', marginBottom: 4 }}>
                {product.name}
              </div>
              {product.brand && <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>{product.brand}</div>}
              <div style={{ fontSize: '2rem', fontWeight: 900, color: 'var(--green)', marginBottom: '0.75rem' }}>
                {fmt$(product.retailPrice)}
              </div>
              <div style={{ display: 'flex', gap: 8, marginBottom: '1rem' }}>
                {product.ebtEligible && <span style={{ fontSize: '0.65rem', fontWeight: 800, padding: '2px 8px', borderRadius: 4, background: 'rgba(122,193,67,.2)', color: 'var(--green)' }}>EBT</span>}
                {product.ageRequired && <span style={{ fontSize: '0.65rem', fontWeight: 800, padding: '2px 8px', borderRadius: 4, background: 'rgba(245,158,11,.2)', color: 'var(--amber)' }}>{product.ageRequired}+</span>}
                {!product.taxable && <span style={{ fontSize: '0.65rem', fontWeight: 800, padding: '2px 8px', borderRadius: 4, background: 'var(--bg-input)', color: 'var(--text-muted)' }}>No Tax</span>}
              </div>
              <button onClick={() => addToCart(product)} style={{
                width: '100%', height: 44, borderRadius: 10,
                background: 'var(--green)', color: '#0f1117',
                border: 'none', fontWeight: 800, fontSize: '0.9rem', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}>
                <Plus size={16} /> Add to Cart
              </button>
            </div>
          )}

          {/* Search results list */}
          {!product && results.length > 0 && (
            <div style={{ maxHeight: 280, overflowY: 'auto' }}>
              {results.map(p => (
                <button key={p.id} onClick={() => setProduct(p)} style={{
                  width: '100%', padding: '0.75rem 0.5rem', textAlign: 'left',
                  background: 'none', border: 'none', borderBottom: '1px solid var(--border)',
                  cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}
                >
                  <div>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.88rem' }}>{p.name}</div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{p.upc}</div>
                  </div>
                  <span style={{ fontWeight: 800, color: 'var(--green)', fontSize: '0.9rem' }}>{fmt$(p.retailPrice)}</span>
                </button>
              ))}
            </div>
          )}

          {notFound && (
            <div style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--text-muted)' }}>
              <AlertCircle size={32} style={{ marginBottom: 8, opacity: 0.5 }} />
              <div style={{ fontSize: '0.85rem' }}>Product not found</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
