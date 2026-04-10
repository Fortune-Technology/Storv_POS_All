import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';

const FREE_SHIPPING_THRESHOLD = 500;
const FLAT_SHIPPING = 25;

// CardSecure tokenizer iframe URL — swap to production URL when going live
const CARDSECURE_URL = 'https://fts-uat.cardpointe.com/itoke/ajax-tokenizer.html';
const IFRAME_PARAMS  = [
  'useexpiry=true',
  'usecvv=true',
  'invalidinputevent=true',
  'tokenizewheninactive=true',
  'inactivityto=500',
  'css=body%7Bbackground%3A%23111827%3Bfont-family%3Asystem-ui%7Dinput%7Bbackground%3A%23111827%3Bborder%3A1px+solid+%23374151%3Bcolor%3A%23e5e7eb%3Bborder-radius%3A8px%3Bpadding%3A10px%3Bfont-size%3A14px%7Dlabel%7Bcolor%3A%239ca3af%3Bfont-size%3A12px%7D',
].join('&');

export default function ShopCheckout() {
  const navigate  = useNavigate();
  const [cart]    = useState(() => { try { return JSON.parse(localStorage.getItem('storv_cart') || '[]'); } catch { return []; } });
  const [token,   setToken]      = useState('');
  const [masked,  setMasked]     = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error,   setError]      = useState('');
  const [form,    setForm]       = useState({
    name: '', email: '', phone: '',
    street: '', city: '', state: '', zip: '',
  });

  const subtotal = cart.reduce((sum, i) => sum + i.price * i.qty, 0);
  const shipping  = subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : FLAT_SHIPPING;
  const total     = subtotal + shipping;
  const fmt = (n) => `$${Number(n).toFixed(2)}`;

  // Listen for CardSecure postMessage with token
  useEffect(() => {
    const handler = (e) => {
      if (typeof e.data !== 'string') return;
      try {
        const data = JSON.parse(e.data);
        if (data.token) {
          setToken(data.token);
          setMasked(data.maskedCard || data.token.slice(-4) || '');
        }
      } catch {}
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (!token) { setError('Please enter your card details above.'); return; }
    if (cart.length === 0) { setError('Your cart is empty.'); return; }

    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/equipment/orders', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items:           cart.map(i => ({ productId: i.productId, qty: i.qty })),
          customer:        { name: form.name, email: form.email, phone: form.phone || null },
          shippingAddress: { street: form.street, city: form.city, state: form.state, zip: form.zip },
          paymentToken:    token,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Order failed');

      localStorage.removeItem('storv_cart');
      navigate(`/shop/order-confirm?order=${data.orderNumber}`);
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const input = {
    width: '100%', background: '#111827', border: '1px solid #374151',
    color: '#e5e7eb', borderRadius: '8px', padding: '0.65rem 0.85rem',
    fontSize: '0.875rem', boxSizing: 'border-box', outline: 'none',
  };
  const label = { display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#9ca3af', marginBottom: '0.35rem' };
  const section = {
    background: '#1a1d27', border: '1px solid #1f2937', borderRadius: '10px',
    padding: '1.5rem', marginBottom: '1rem',
  };

  if (cart.length === 0) return (
    <div style={{ minHeight: '100vh', background: '#0f1117', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontFamily: 'system-ui, sans-serif', gap: '1rem' }}>
      <p>Your cart is empty.</p>
      <Link to="/shop" style={{ color: '#60a5fa', textDecoration: 'none' }}>Browse products</Link>
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', background: '#0f1117', color: '#e5e7eb', fontFamily: 'system-ui, sans-serif' }}>
      <header style={{ borderBottom: '1px solid #1f2937', padding: '1rem 2rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <Link to="/shop/cart" style={{ color: '#60a5fa', textDecoration: 'none', fontSize: '0.875rem' }}>← Back to Cart</Link>
        <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#fff' }}>Checkout</h1>
      </header>

      <form
        onSubmit={submit}
        style={{
          maxWidth: '960px', margin: '0 auto', padding: '2rem',
          display: 'grid', gridTemplateColumns: '1fr 360px', gap: '2rem', alignItems: 'start',
        }}
      >
        {/* Left column */}
        <div>
          {/* Contact */}
          <div style={section}>
            <h2 style={{ margin: '0 0 1rem', fontSize: '1rem', fontWeight: 700 }}>Contact Information</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div style={{ gridColumn: '1/-1' }}>
                <label style={label}>Full Name *</label>
                <input required style={input} value={form.name} onChange={set('name')} />
              </div>
              <div>
                <label style={label}>Email *</label>
                <input required type="email" style={input} value={form.email} onChange={set('email')} />
              </div>
              <div>
                <label style={label}>Phone</label>
                <input style={input} value={form.phone} onChange={set('phone')} />
              </div>
            </div>
          </div>

          {/* Shipping */}
          <div style={section}>
            <h2 style={{ margin: '0 0 1rem', fontSize: '1rem', fontWeight: 700 }}>Shipping Address</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div style={{ gridColumn: '1/-1' }}>
                <label style={label}>Street Address *</label>
                <input required style={input} value={form.street} onChange={set('street')} />
              </div>
              <div>
                <label style={label}>City *</label>
                <input required style={input} value={form.city} onChange={set('city')} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: '0.5rem' }}>
                <div>
                  <label style={label}>State *</label>
                  <input required maxLength={2} placeholder="ME" style={input} value={form.state} onChange={set('state')} />
                </div>
                <div>
                  <label style={label}>ZIP *</label>
                  <input required style={input} value={form.zip} onChange={set('zip')} />
                </div>
              </div>
            </div>
          </div>

          {/* Payment */}
          <div style={section}>
            <h2 style={{ margin: '0 0 0.35rem', fontSize: '1rem', fontWeight: 700 }}>Payment</h2>
            <p style={{ margin: '0 0 1rem', fontSize: '0.8rem', color: '#9ca3af' }}>
              Card details are securely tokenized by CardPointe — we never see your card number.
            </p>

            {token ? (
              <div style={{
                padding: '0.75rem 1rem', background: '#14352a',
                border: '1px solid rgba(52,211,153,0.3)', borderRadius: '8px',
                color: '#34d399', fontSize: '0.875rem', fontWeight: 600,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <span>✓ Card captured{masked ? ` — ···${masked.slice(-4)}` : ''}</span>
                <button
                  type="button"
                  onClick={() => { setToken(''); setMasked(''); }}
                  style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: '0.75rem' }}
                >
                  Change
                </button>
              </div>
            ) : (
              <iframe
                src={`${CARDSECURE_URL}?${IFRAME_PARAMS}`}
                style={{ width: '100%', height: '230px', border: 'none', borderRadius: '8px' }}
                title="Secure Card Entry"
              />
            )}
          </div>

          {error && (
            <div style={{
              background: '#3d0000', border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: '8px', padding: '0.75rem 1rem',
              color: '#f87171', fontSize: '0.875rem', marginBottom: '1rem',
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            style={{
              width: '100%', background: submitting ? '#374151' : '#1d4ed8', color: '#fff',
              border: 'none', borderRadius: '8px', padding: '0.9rem',
              fontWeight: 700, fontSize: '1rem', cursor: submitting ? 'not-allowed' : 'pointer',
            }}
          >
            {submitting ? 'Processing…' : `Place Order — ${fmt(total)}`}
          </button>
        </div>

        {/* Right: Order summary (sticky) */}
        <div style={{ background: '#1a1d27', border: '1px solid #1f2937', borderRadius: '10px', padding: '1.5rem', position: 'sticky', top: '2rem' }}>
          <h2 style={{ margin: '0 0 1rem', fontSize: '1rem', fontWeight: 700 }}>Order Summary</h2>

          {cart.map(item => (
            <div key={item.productId} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem', fontSize: '0.875rem' }}>
              <div style={{ flex: 1, minWidth: 0, marginRight: '0.5rem' }}>
                <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
                <div style={{ color: '#9ca3af', fontSize: '0.8rem' }}>Qty: {item.qty}</div>
              </div>
              <div style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{fmt(item.price * item.qty)}</div>
            </div>
          ))}

          <hr style={{ border: 'none', borderTop: '1px solid #1f2937', margin: '1rem 0' }} />

          {[
            { label: 'Subtotal', value: fmt(subtotal) },
            { label: 'Shipping', value: shipping === 0 ? 'FREE' : fmt(shipping) },
          ].map(({ label: l, value: v }) => (
            <div key={l} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.875rem', color: '#9ca3af' }}>
              <span>{l}</span><span style={{ color: v === 'FREE' ? '#34d399' : '#9ca3af' }}>{v}</span>
            </div>
          ))}

          <hr style={{ border: 'none', borderTop: '1px solid #1f2937', margin: '0.75rem 0' }} />

          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: '1.1rem' }}>
            <span>Total</span><span>{fmt(total)}</span>
          </div>

          {subtotal < FREE_SHIPPING_THRESHOLD && subtotal > 0 && (
            <p style={{ margin: '0.75rem 0 0', fontSize: '0.75rem', color: '#9ca3af' }}>
              Add {fmt(FREE_SHIPPING_THRESHOLD - subtotal)} more for free shipping.
            </p>
          )}
        </div>
      </form>
    </div>
  );
}
