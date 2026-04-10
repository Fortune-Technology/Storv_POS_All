import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';

export default function ProductPage() {
  const { slug }   = useParams();
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [qty, setQty]         = useState(1);
  const [added, setAdded]     = useState(false);

  useEffect(() => {
    fetch(`/api/equipment/products/${slug}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => setProduct(data))
      .catch(() => setProduct(null))
      .finally(() => setLoading(false));
  }, [slug]);

  const addToCart = () => {
    const cart     = JSON.parse(localStorage.getItem('storv_cart') || '[]');
    const existing = cart.find(i => i.productId === product.id);
    if (existing) {
      existing.qty += qty;
    } else {
      cart.push({
        productId: product.id,
        name:      product.name,
        price:     Number(product.price),
        qty,
        image:     product.images?.[0] || null,
      });
    }
    localStorage.setItem('storv_cart', JSON.stringify(cart));
    setAdded(true);
    setTimeout(() => setAdded(false), 2500);
  };

  const fmt = (n) => `$${Number(n).toFixed(2)}`;

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#0f1117', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontFamily: 'system-ui, sans-serif' }}>
      Loading…
    </div>
  );

  if (!product) return (
    <div style={{ minHeight: '100vh', background: '#0f1117', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontFamily: 'system-ui, sans-serif', gap: '1rem' }}>
      <p>Product not found.</p>
      <Link to="/shop" style={{ color: '#60a5fa', textDecoration: 'none' }}>← Back to Shop</Link>
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', background: '#0f1117', color: '#e5e7eb', fontFamily: 'system-ui, sans-serif' }}>
      <header style={{ borderBottom: '1px solid #1f2937', padding: '1rem 2rem', display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
        <Link to="/shop" style={{ color: '#60a5fa', textDecoration: 'none', fontSize: '0.875rem' }}>← Back to Shop</Link>
        <Link to="/shop/cart" style={{ marginLeft: 'auto', color: '#9ca3af', textDecoration: 'none', fontSize: '0.875rem' }}>
          🛒 Cart
        </Link>
      </header>

      <div style={{
        maxWidth: '960px', margin: '0 auto', padding: '2rem',
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3rem', alignItems: 'start',
      }}>
        {/* Image */}
        <div style={{
          background: '#111827', borderRadius: '12px', overflow: 'hidden',
          aspectRatio: '1', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {product.images?.[0]
            ? <img src={product.images[0]} alt={product.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <span style={{ fontSize: '5rem' }}>🖥️</span>}
        </div>

        {/* Info */}
        <div>
          <div style={{ fontSize: '0.7rem', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
            {product.category}
          </div>
          <h1 style={{ margin: '0 0 0.5rem', fontSize: '1.75rem', fontWeight: 800, color: '#fff' }}>{product.name}</h1>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: '#fff', marginBottom: '1rem' }}>{fmt(product.price)}</div>
          <p style={{ color: '#9ca3af', lineHeight: 1.6, marginBottom: '1.5rem' }}>{product.description}</p>

          {/* Specs */}
          {product.specs && Object.keys(product.specs).length > 0 && (
            <div style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.875rem', fontWeight: 700, color: '#d1d5db' }}>Specifications</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                {Object.entries(product.specs).map(([k, v]) => (
                  <div key={k} style={{ background: '#1a1d27', borderRadius: '6px', padding: '0.5rem 0.75rem' }}>
                    <div style={{ fontSize: '0.65rem', color: '#6b7280', textTransform: 'uppercase', marginBottom: '0.15rem' }}>{k}</div>
                    <div style={{ fontSize: '0.8rem', fontWeight: 600 }}>{String(v)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Qty + Add to Cart */}
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '0.75rem' }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: '0.5rem',
              background: '#1a1d27', border: '1px solid #1f2937',
              borderRadius: '8px', padding: '0.25rem 0.75rem',
            }}>
              <button onClick={() => setQty(q => Math.max(1, q - 1))} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '1.1rem', lineHeight: 1 }}>−</button>
              <span style={{ width: '2rem', textAlign: 'center', fontWeight: 600 }}>{qty}</span>
              <button onClick={() => setQty(q => q + 1)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '1.1rem', lineHeight: 1 }}>+</button>
            </div>
            <button
              onClick={addToCart}
              disabled={product.trackStock && product.stockQty === 0}
              style={{
                flex: 1,
                background: added ? '#059669' : (product.trackStock && product.stockQty === 0 ? '#374151' : '#1d4ed8'),
                color: '#fff', border: 'none', borderRadius: '8px',
                padding: '0.75rem 1.5rem', fontWeight: 700, fontSize: '0.95rem',
                cursor: product.trackStock && product.stockQty === 0 ? 'not-allowed' : 'pointer',
                transition: 'background 0.2s',
              }}
            >
              {added ? '✓ Added to Cart' : product.trackStock && product.stockQty === 0 ? 'Out of Stock' : 'Add to Cart'}
            </button>
          </div>

          <Link to="/shop/cart" style={{ display: 'block', textAlign: 'center', color: '#60a5fa', fontSize: '0.875rem', textDecoration: 'none', marginBottom: '0.75rem' }}>
            View Cart →
          </Link>

          {product.trackStock && (
            <p style={{ margin: 0, fontSize: '0.75rem', color: product.stockQty > 0 ? '#34d399' : '#f87171' }}>
              {product.stockQty > 0 ? `${product.stockQty} in stock` : 'Out of stock'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
