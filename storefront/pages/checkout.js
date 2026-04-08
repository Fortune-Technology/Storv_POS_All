/**
 * Checkout page — customer info, fulfillment selection, place order.
 */

import { useState, useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import Header from '../components/layout/Header';
import Footer from '../components/layout/Footer';
import CartDrawer from '../components/cart/CartDrawer';
import { useCart } from '../lib/cart';
import { useAuth } from '../lib/auth';
import { submitCheckout } from '../lib/api';

function fmt(n) { return `$${Number(n).toFixed(2)}`; }

export default function CheckoutPage() {
  const router = useRouter();
  const { items, cartTotal, sessionId, clearCart, storeSlug } = useCart();
  const { isLoggedIn, customer } = useAuth();

  // Redirect to login if not authenticated — preserve return URL
  useEffect(() => {
    if (!isLoggedIn) {
      router.replace(`/account/login?store=${storeSlug}&redirect=/checkout`);
    }
  }, [isLoggedIn]);

  const [form, setForm] = useState({
    customerName: customer?.name || '',
    customerEmail: customer?.email || '',
    customerPhone: customer?.phone || '',
    fulfillmentType: 'pickup',
    street: '',
    city: '',
    state: '',
    zip: '',
    instructions: '',
    notes: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const set = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.customerName || !form.customerEmail) {
      setError('Name and email are required');
      return;
    }
    if (items.length === 0) {
      setError('Your cart is empty');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const orderData = {
        sessionId,
        customerName: form.customerName,
        customerEmail: form.customerEmail,
        customerPhone: form.customerPhone || undefined,
        fulfillmentType: form.fulfillmentType,
        shippingAddress: form.fulfillmentType === 'delivery' ? {
          street: form.street,
          city: form.city,
          state: form.state,
          zip: form.zip,
          instructions: form.instructions,
        } : undefined,
        paymentMethod: 'cash_on_pickup',
        notes: form.notes || undefined,
      };

      const order = await submitCheckout(storeSlug, orderData);
      clearCart();
      router.push(`/order/${order.id}?store=${storeSlug}&email=${encodeURIComponent(form.customerEmail)}`);
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Something went wrong';
      const outOfStock = err.response?.data?.outOfStock;
      if (outOfStock) {
        setError(`Out of stock: ${outOfStock.map(i => `Product #${i.posProductId} (only ${i.quantityOnHand} left)`).join(', ')}`);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  if (items.length === 0 && !loading) {
    return (
      <>
        <Head><title>Checkout</title></Head>
        <Header />
        <CartDrawer />
        <main className="sf-container">
          <div className="sf-empty" style={{ paddingTop: 80 }}>
            <div className="sf-empty-icon">🛒</div>
            <p>Your cart is empty — add some products first.</p>
          </div>
        </main>
        <Footer />
      </>
    );
  }

  return (
    <>
      <Head><title>Checkout</title></Head>
      <Header />
      <CartDrawer />

      <main className="sf-container">
        <div className="sf-page-header">
          <h1 className="sf-page-title">Checkout</h1>
        </div>

        <form className="ck-layout" onSubmit={handleSubmit}>
          <div className="ck-form">
            {error && <div className="ck-error">{error}</div>}

            <section className="ck-section">
              <h2 className="ck-section-title">Contact Information</h2>
              <div className="ck-field">
                <label className="ck-label">Full Name *</label>
                <input className="ck-input" value={form.customerName} onChange={set('customerName')} required />
              </div>
              <div className="ck-field-row">
                <div className="ck-field">
                  <label className="ck-label">Email *</label>
                  <input className="ck-input" type="email" value={form.customerEmail} onChange={set('customerEmail')} required />
                </div>
                <div className="ck-field">
                  <label className="ck-label">Phone</label>
                  <input className="ck-input" type="tel" value={form.customerPhone} onChange={set('customerPhone')} />
                </div>
              </div>
            </section>

            <section className="ck-section">
              <h2 className="ck-section-title">Fulfillment</h2>
              <div className="ck-toggle-row">
                <button
                  type="button"
                  className={`ck-toggle-btn ${form.fulfillmentType === 'pickup' ? 'ck-toggle-btn--active' : ''}`}
                  onClick={() => setForm(f => ({ ...f, fulfillmentType: 'pickup' }))}
                >
                  🏪 Pickup
                </button>
                <button
                  type="button"
                  className={`ck-toggle-btn ${form.fulfillmentType === 'delivery' ? 'ck-toggle-btn--active' : ''}`}
                  onClick={() => setForm(f => ({ ...f, fulfillmentType: 'delivery' }))}
                >
                  🚗 Delivery
                </button>
              </div>

              {form.fulfillmentType === 'delivery' && (
                <div className="ck-address">
                  <div className="ck-field">
                    <label className="ck-label">Street Address</label>
                    <input className="ck-input" value={form.street} onChange={set('street')} required />
                  </div>
                  <div className="ck-field-row">
                    <div className="ck-field">
                      <label className="ck-label">City</label>
                      <input className="ck-input" value={form.city} onChange={set('city')} required />
                    </div>
                    <div className="ck-field">
                      <label className="ck-label">State</label>
                      <input className="ck-input" value={form.state} onChange={set('state')} required />
                    </div>
                    <div className="ck-field">
                      <label className="ck-label">ZIP</label>
                      <input className="ck-input" value={form.zip} onChange={set('zip')} required />
                    </div>
                  </div>
                  <div className="ck-field">
                    <label className="ck-label">Delivery Instructions</label>
                    <textarea className="ck-input ck-textarea" value={form.instructions} onChange={set('instructions')} rows={2} />
                  </div>
                </div>
              )}
            </section>

            <section className="ck-section">
              <h2 className="ck-section-title">Order Notes</h2>
              <div className="ck-field">
                <textarea className="ck-input ck-textarea" placeholder="Any special requests..." value={form.notes} onChange={set('notes')} rows={2} />
              </div>
            </section>
          </div>

          <div className="ck-sidebar">
            <h3 className="sc-summary-title">Order Summary</h3>
            <div className="ck-items-list">
              {items.map(item => (
                <div key={item.productId} className="ck-summary-item">
                  <span className="ck-summary-item-name">{item.name} × {item.qty}</span>
                  <span>{fmt(item.price * item.qty)}</span>
                </div>
              ))}
            </div>
            <div className="sc-summary-row" style={{ marginTop: 12 }}>
              <span>Subtotal</span>
              <span>{fmt(cartTotal)}</span>
            </div>
            <div className="sc-summary-row sc-summary-row--muted">
              <span>Tax</span>
              <span>$0.00</span>
            </div>
            {form.fulfillmentType === 'delivery' && (
              <div className="sc-summary-row sc-summary-row--muted">
                <span>Delivery Fee</span>
                <span>$0.00</span>
              </div>
            )}
            <div className="sc-summary-row sc-summary-total">
              <span>Total</span>
              <span>{fmt(cartTotal)}</span>
            </div>
            <button
              type="submit"
              className="cd-btn-checkout"
              disabled={loading}
              style={{ marginTop: 16, opacity: loading ? 0.6 : 1 }}
            >
              {loading ? 'Placing Order...' : 'Place Order'}
            </button>
          </div>
        </form>
      </main>

      <Footer />
    </>
  );
}
