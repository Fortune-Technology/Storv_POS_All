import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';

const CATEGORIES = ['all', 'terminal', 'printer', 'scanner', 'tablet', 'accessory'];

export default function ShopPage() {
  const [products, setProducts] = useState([]);
  const [category, setCategory] = useState('all');
  const [loading, setLoading]   = useState(true);
  const [cart, setCart]         = useState(() => {
    try { return JSON.parse(localStorage.getItem('storv_cart') || '[]'); } catch { return []; }
  });

  useEffect(() => {
    setLoading(true);
    const url = category === 'all'
      ? '/api/equipment/products'
      : `/api/equipment/products?category=${category}`;
    fetch(url)
      .then(r => r.json())
      .then(data => setProducts(Array.isArray(data) ? data : []))
      .catch(() => setProducts([]))
      .finally(() => setLoading(false));
  }, [category]);

  const cartCount = cart.reduce((sum, i) => sum + i.qty, 0);

  const addToCart = (product) => {
    setCart(prev => {
      const existing = prev.find(i => i.productId === product.id);
      const updated  = existing
        ? prev.map(i => i.productId === product.id ? { ...i, qty: i.qty + 1 } : i)
        : [...prev, {
            productId: product.id,
            name:      product.name,
            price:     Number(product.price),
            qty:       1,
            image:     product.images?.[0] || null,
          }];
      localStorage.setItem('storv_cart', JSON.stringify(updated));
      return updated;
    });
  };

  const fmt = (n) => `$${Number(n).toFixed(2)}`;

  return (
    <div style={{ minHeight: '100vh', background: '#0f1117', color: '#e5e7eb', fontFamily: 'system-ui, sans-serif' }}>
      {/* Header */}
      <header style={{
        borderBottom: '1px solid #1f2937', padding: '1rem 2rem',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 800, color: '#fff' }}>Storv Equipment Shop</h1>
          <p style={{ margin: 0, fontSize: '0.8rem', color: '#9ca3af' }}>POS terminals, printers & accessories</p>
        </div>
        <Link
          to="/shop/cart"
          style={{
            display: 'flex', alignItems: 'center', gap: '0.5rem',
            background: '#1d4ed8', color: '#fff', padding: '0.5rem 1.1rem',
            borderRadius: '8px', textDecoration: 'none', fontWeight: 600, fontSize: '0.875rem',
          }}
        >
          🛒 Cart{cartCount > 0 && (
            <span style={{
              background: '#ef4444', borderRadius: '999px',
              padding: '0.1rem 0.45rem', fontSize: '0.7rem', fontWeight: 700,
            }}>{cartCount}</span>
          )}
        </Link>
      </header>

      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '2rem' }}>
        {/* Category filter */}
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '2rem' }}>
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              style={{
                padding: '0.4rem 1.1rem', borderRadius: '999px', border: 'none', cursor: 'pointer',
                background: category === cat ? '#1d4ed8' : '#1f2937',
                color:      category === cat ? '#fff'    : '#9ca3af',
                fontWeight: 600, fontSize: '0.8rem', textTransform: 'capitalize',
                transition: 'background 0.15s',
              }}
            >
              {cat}
            </button>
          ))}
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '4rem', color: '#9ca3af' }}>Loading products…</div>
        ) : products.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '4rem', color: '#9ca3af' }}>No products found.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1.5rem' }}>
            {products.map(p => (
              <div
                key={p.id}
                style={{
                  background: '#1a1d27', border: '1px solid #1f2937', borderRadius: '12px',
                  overflow: 'hidden', display: 'flex', flexDirection: 'column',
                }}
              >
                <Link to={`/shop/${p.slug}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                  <div style={{
                    height: '180px', background: '#111827',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
                  }}>
                    {p.images?.[0]
                      ? <img src={p.images[0]} alt={p.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : <span style={{ fontSize: '3rem' }}>🖥️</span>}
                  </div>
                  <div style={{ padding: '1rem' }}>
                    <div style={{ fontSize: '0.7rem', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', marginBottom: '0.25rem' }}>
                      {p.category}
                    </div>
                    <h3 style={{ margin: '0 0 0.25rem', fontSize: '0.95rem', fontWeight: 700, color: '#fff' }}>{p.name}</h3>
                    <p style={{
                      margin: 0, fontSize: '0.8rem', color: '#9ca3af', lineHeight: 1.4,
                      display: '-webkit-box', WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical', overflow: 'hidden',
                    }}>
                      {p.description}
                    </p>
                  </div>
                </Link>
                <div style={{ padding: '0 1rem 1rem', marginTop: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '1.25rem', fontWeight: 800, color: '#fff' }}>{fmt(p.price)}</span>
                  <button
                    onClick={() => addToCart(p)}
                    disabled={p.trackStock && p.stockQty === 0}
                    style={{
                      background: p.trackStock && p.stockQty === 0 ? '#374151' : '#1d4ed8',
                      color: '#fff', border: 'none', borderRadius: '8px',
                      padding: '0.5rem 1rem',
                      cursor: p.trackStock && p.stockQty === 0 ? 'not-allowed' : 'pointer',
                      fontWeight: 600, fontSize: '0.8rem',
                    }}
                  >
                    {p.trackStock && p.stockQty === 0 ? 'Out of Stock' : 'Add to Cart'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
