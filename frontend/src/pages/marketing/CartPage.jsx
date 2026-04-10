import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

const FREE_SHIPPING_THRESHOLD = 500;
const FLAT_SHIPPING = 25;

export default function CartPage() {
  const navigate = useNavigate();
  const [cart, setCart] = useState(() => {
    try { return JSON.parse(localStorage.getItem('storv_cart') || '[]'); } catch { return []; }
  });

  const save = (updated) => {
    setCart(updated);
    localStorage.setItem('storv_cart', JSON.stringify(updated));
  };

  const updateQty = (productId, delta) => {
    save(cart.map(i => i.productId === productId ? { ...i, qty: Math.max(1, i.qty + delta) } : i));
  };

  const remove = (productId) => save(cart.filter(i => i.productId !== productId));

  const subtotal = cart.reduce((sum, i) => sum + i.price * i.qty, 0);
  const shipping  = subtotal > 0 ? (subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : FLAT_SHIPPING) : 0;
  const total     = subtotal + shipping;
  const fmt = (n) => `$${Number(n).toFixed(2)}`;

  return (
    <div style={{ minHeight: '100vh', background: '#0f1117', color: '#e5e7eb', fontFamily: 'system-ui, sans-serif' }}>
      <header style={{
        borderBottom: '1px solid #1f2937', padding: '1rem 2rem',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <Link to="/shop" style={{ color: '#60a5fa', textDecoration: 'none', fontSize: '0.875rem' }}>← Continue Shopping</Link>
        <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#fff' }}>Your Cart</h1>
        <div style={{ width: '130px' }} />
      </header>

      <div style={{ maxWidth: '800px', margin: '0 auto', padding: '2rem' }}>
        {cart.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '4rem' }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🛒</div>
            <p style={{ color: '#9ca3af', marginBottom: '1rem' }}>Your cart is empty.</p>
            <Link to="/shop" style={{ color: '#60a5fa', textDecoration: 'none', fontWeight: 600 }}>Browse products →</Link>
          </div>
        ) : (
          <>
            {/* Cart items */}
            <div style={{ marginBottom: '1.5rem' }}>
              {cart.map(item => (
                <div
                  key={item.productId}
                  style={{
                    background: '#1a1d27', border: '1px solid #1f2937', borderRadius: '10px',
                    padding: '1rem', marginBottom: '0.75rem',
                    display: 'flex', alignItems: 'center', gap: '1rem',
                  }}
                >
                  {/* Thumbnail */}
                  <div style={{ width: '60px', height: '60px', background: '#111827', borderRadius: '8px', overflow: 'hidden', flexShrink: 0 }}>
                    {item.image
                      ? <img src={item.image} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: '1.5rem' }}>🖥️</div>}
                  </div>

                  {/* Name + price */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, marginBottom: '0.2rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
                    <div style={{ fontSize: '0.875rem', color: '#9ca3af' }}>{fmt(item.price)} each</div>
                  </div>

                  {/* Qty controls */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <button onClick={() => updateQty(item.productId, -1)} style={{ background: '#374151', border: 'none', color: '#fff', borderRadius: '6px', width: '28px', height: '28px', cursor: 'pointer', fontSize: '1rem', lineHeight: 1 }}>−</button>
                    <span style={{ width: '2rem', textAlign: 'center', fontWeight: 600 }}>{item.qty}</span>
                    <button onClick={() => updateQty(item.productId, 1)}  style={{ background: '#374151', border: 'none', color: '#fff', borderRadius: '6px', width: '28px', height: '28px', cursor: 'pointer', fontSize: '1rem', lineHeight: 1 }}>+</button>
                  </div>

                  {/* Line total */}
                  <div style={{ fontWeight: 700, minWidth: '80px', textAlign: 'right' }}>{fmt(item.price * item.qty)}</div>

                  {/* Remove */}
                  <button onClick={() => remove(item.productId)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '1.1rem', padding: '0.25rem', lineHeight: 1 }}>✕</button>
                </div>
              ))}
            </div>

            {/* Order summary */}
            <div style={{ background: '#1a1d27', border: '1px solid #1f2937', borderRadius: '10px', padding: '1.25rem' }}>
              {[
                { label: 'Subtotal', value: fmt(subtotal) },
                {
                  label: `Shipping${subtotal >= FREE_SHIPPING_THRESHOLD ? ' (free over $500)' : ' (flat rate)'}`,
                  value: shipping === 0 ? 'FREE' : fmt(shipping),
                },
              ].map(({ label, value }) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.875rem', color: '#9ca3af' }}>
                  <span>{label}</span><span>{value}</span>
                </div>
              ))}

              <hr style={{ border: 'none', borderTop: '1px solid #1f2937', margin: '0.75rem 0' }} />

              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: '1.1rem', marginBottom: '1.25rem' }}>
                <span>Total</span><span>{fmt(total)}</span>
              </div>

              <button
                onClick={() => navigate('/shop/checkout')}
                style={{
                  width: '100%', background: '#1d4ed8', color: '#fff',
                  border: 'none', borderRadius: '8px', padding: '0.875rem',
                  fontWeight: 700, fontSize: '1rem', cursor: 'pointer',
                }}
              >
                Proceed to Checkout →
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
