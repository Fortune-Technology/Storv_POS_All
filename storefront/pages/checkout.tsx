/**
 * Checkout page — contact info, fulfillment, payment.
 * Card payments use CardPointe's iFrame tokenizer (CardSecure) for PCI compliance.
 * The card number is entered in a CardPointe-hosted iframe; only a token (never
 * the raw PAN) is sent to our server.
 */

import { useState, useEffect, FormEvent, ChangeEvent } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import type { GetServerSidePropsContext } from 'next';
import { ShoppingCart as CartEmptyIcon, Store, Truck, CreditCard, Lock, Banknote } from 'lucide-react';
import Header from '../components/layout/Header';
import Footer from '../components/layout/Footer';
import CartDrawer from '../components/cart/CartDrawer';
import { useCart } from '../lib/cart';
import { useAuth } from '../lib/auth';
import { submitCheckout } from '../lib/api';

function fmt(n: number | string): string {
  return `$${Number(n).toFixed(2)}`;
}

// ── CardPointe site config (set NEXT_PUBLIC_CP_SITE and NEXT_PUBLIC_CP_LIVE in .env) ──
const CP_SITE = process.env.NEXT_PUBLIC_CP_SITE || 'fts';
const CP_LIVE = process.env.NEXT_PUBLIC_CP_LIVE === 'true';
const CP_HOST = CP_LIVE ? `https://${CP_SITE}.cardpointe.com` : `https://${CP_SITE}-uat.cardpointe.com`;

// iFrame tokenizer URL — CardPointe-hosted, PCI-compliant card number entry
const ITOKE_URL =
  `${CP_HOST}/itoke/ajax-tokenizer.html?` +
  new URLSearchParams({
    tokenizewheninactive: 'true',
    inactivityto: '500',
    formatinput: 'true',
    placeholder: 'Card Number',
    css: encodeURIComponent(
      'input{width:100%;height:42px;padding:0 12px;border:1px solid #2a3344;' +
        'border-radius:8px;background:#0f172a;color:#e2e8f0;font-size:14px;outline:none;}' +
        'input:focus{border-color:#3b82f6;box-shadow:0 0 0 2px rgba(59,130,246,.25);}'
    ),
  }).toString();

interface CheckoutForm {
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  fulfillmentType: 'pickup' | 'delivery';
  street: string;
  city: string;
  state: string;
  zip: string;
  instructions: string;
  notes: string;
  expiry: string;
  cvv: string;
}

type PayMethod = 'card' | 'cash_on_pickup';

interface CardPointeMessage {
  message?: string;
  token?: string;
  [key: string]: unknown;
}

interface OutOfStockItem {
  posProductId: string;
  quantityOnHand: number;
}

export default function CheckoutPage() {
  const router = useRouter();
  const { items, cartTotal, sessionId, clearCart, storeSlug } = useCart();
  const { isLoggedIn, customer } = useAuth();

  useEffect(() => {
    if (!isLoggedIn) {
      router.replace(`/account/login?store=${storeSlug}&redirect=/checkout`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn]);

  const [form, setForm] = useState<CheckoutForm>({
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
    expiry: '',
    cvv: '',
  });

  // Payment
  const [payMethod, setPayMethod] = useState<PayMethod>('card');
  const [payToken, setPayToken] = useState(''); // CardPointe token from iFrame
  const [tokenReady, setTokenReady] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (field: keyof CheckoutForm) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [field]: e.target.value }));

  // ── Listen for token from CardPointe iFrame ───────────────────────────────
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      // Only accept messages from CardPointe host
      if (!event.origin.includes('cardpointe.com')) return;
      try {
        const data: CardPointeMessage = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (data?.message === 'tokenReceivedFromIframe' || data?.token) {
          const token = data.token || data.message;
          if (token && token.length > 4) {
            setPayToken(token);
            setTokenReady(true);
          }
        }
        // Handle clear / error events
        if (data?.message === 'iTokenizerLoaded') {
          setPayToken('');
          setTokenReady(false);
        }
      } catch {}
    }
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Reset token when switching payment methods
  useEffect(() => {
    setPayToken('');
    setTokenReady(false);
  }, [payMethod]);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!form.customerName || !form.customerEmail) {
      setError('Name and email are required');
      return;
    }
    if (items.length === 0) {
      setError('Your cart is empty');
      return;
    }
    if (payMethod === 'card' && !tokenReady) {
      setError('Please enter your card number');
      return;
    }
    if (payMethod === 'card' && !form.expiry) {
      setError('Please enter your card expiry date');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Format expiry: "12/26" → "1226"
      const rawExpiry = form.expiry.replace(/\D/g, '');

      const orderData: Record<string, unknown> = {
        sessionId,
        customerName: form.customerName,
        customerEmail: form.customerEmail,
        customerPhone: form.customerPhone || undefined,
        fulfillmentType: form.fulfillmentType,
        shippingAddress:
          form.fulfillmentType === 'delivery'
            ? {
                street: form.street,
                city: form.city,
                state: form.state,
                zip: form.zip,
                instructions: form.instructions,
              }
            : undefined,
        paymentMethod: payMethod,
        notes: form.notes || undefined,
        // Card fields (only sent when paying by card)
        ...(payMethod === 'card'
          ? {
              paymentToken: payToken,
              paymentExpiry: rawExpiry || undefined,
            }
          : {}),
      };

      const order = await submitCheckout(storeSlug, orderData);
      clearCart();
      router.push(`/order/${order.id}?store=${storeSlug}&email=${encodeURIComponent(form.customerEmail)}`);
    } catch (err) {
      const axiosErr = err as {
        response?: { data?: { error?: string; outOfStock?: OutOfStockItem[] } };
        message?: string;
      };
      const msg = axiosErr.response?.data?.error || axiosErr.message || 'Something went wrong';
      const outOfStock = axiosErr.response?.data?.outOfStock;
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
          <div className="sf-empty ck-empty">
            <div className="sf-empty-icon"><CartEmptyIcon size={48} strokeWidth={1.5} /></div>
            <p>Your cart is empty — add some products first.</p>
          </div>
        </main>
        <Footer />
      </>
    );
  }

  const canPlaceOrder = payMethod === 'cash_on_pickup' || (payMethod === 'card' && tokenReady && !!form.expiry);

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

            {/* ── Contact ──────────────────────────────────────────────── */}
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

            {/* ── Fulfillment ───────────────────────────────────────────── */}
            <section className="ck-section">
              <h2 className="ck-section-title">Fulfillment</h2>
              <div className="ck-toggle-row">
                <button type="button" className={`ck-toggle-btn ${form.fulfillmentType === 'pickup' ? 'ck-toggle-btn--active' : ''}`} onClick={() => setForm(f => ({ ...f, fulfillmentType: 'pickup' }))}>
                  <Store size={16} /> Pickup
                </button>
                <button type="button" className={`ck-toggle-btn ${form.fulfillmentType === 'delivery' ? 'ck-toggle-btn--active' : ''}`} onClick={() => setForm(f => ({ ...f, fulfillmentType: 'delivery' }))}>
                  <Truck size={16} /> Delivery
                </button>
              </div>

              {form.fulfillmentType === 'delivery' && (
                <div className="ck-address">
                  <div className="ck-field">
                    <label className="ck-label">Street Address</label>
                    <input className="ck-input" value={form.street} onChange={set('street')} required />
                  </div>
                  <div className="ck-field-row">
                    <div className="ck-field"><label className="ck-label">City</label><input className="ck-input" value={form.city} onChange={set('city')} required /></div>
                    <div className="ck-field"><label className="ck-label">State</label><input className="ck-input" value={form.state} onChange={set('state')} required /></div>
                    <div className="ck-field"><label className="ck-label">ZIP</label><input className="ck-input" value={form.zip} onChange={set('zip')} required /></div>
                  </div>
                  <div className="ck-field">
                    <label className="ck-label">Delivery Instructions</label>
                    <textarea className="ck-input ck-textarea" value={form.instructions} onChange={set('instructions')} rows={2} />
                  </div>
                </div>
              )}
            </section>

            {/* ── Payment ───────────────────────────────────────────────── */}
            <section className="ck-section">
              <h2 className="ck-section-title">Payment</h2>

              <div className="ck-toggle-row">
                <button type="button" className={`ck-toggle-btn ${payMethod === 'card' ? 'ck-toggle-btn--active' : ''}`} onClick={() => setPayMethod('card')}>
                  <CreditCard size={16} /> Pay by Card
                </button>
                <button type="button" className={`ck-toggle-btn ${payMethod === 'cash_on_pickup' ? 'ck-toggle-btn--active' : ''}`} onClick={() => setPayMethod('cash_on_pickup')}>
                  <Store size={16} /> Pay on Pickup
                </button>
              </div>

              {payMethod === 'card' && (
                <div className="ck-card-fields">
                  {/* Card number — CardPointe iFrame (PCI compliant) */}
                  <div className="ck-field">
                    <label className="ck-label">Card Number</label>
                    <iframe
                      id="tokenframe"
                      name="tokenframe"
                      src={ITOKE_URL}
                      scrolling="no"
                      frameBorder={0}
                      className="ck-card-iframe"
                    />
                    {tokenReady && (
                      <span className="ck-token-ok">
                        ✓ Card number captured securely
                      </span>
                    )}
                  </div>

                  <div className="ck-field-row">
                    <div className="ck-field">
                      <label className="ck-label">Expiry (MM/YY) *</label>
                      <input
                        className="ck-input"
                        placeholder="12/26"
                        value={form.expiry}
                        onChange={(e) => {
                          let v = e.target.value.replace(/\D/g, '');
                          if (v.length >= 3) v = v.slice(0, 2) + '/' + v.slice(2, 4);
                          setForm(f => ({ ...f, expiry: v }));
                        }}
                        maxLength={5}
                        required
                      />
                    </div>
                    <div className="ck-field">
                      <label className="ck-label">CVV</label>
                      <input
                        className="ck-input"
                        type="password"
                        placeholder="123"
                        maxLength={4}
                        value={form.cvv}
                        onChange={set('cvv')}
                        autoComplete="cc-csc"
                      />
                    </div>
                  </div>

                  <div className="ck-pci-notice">
                    <Lock size={14} /> Your card number is entered in a secure, PCI-compliant iframe hosted by CardPointe. We never see your raw card number.
                  </div>
                </div>
              )}

              {payMethod === 'cash_on_pickup' && (
                <div className="ck-cash-notice">
                  <Banknote size={16} /> You'll pay in cash when you pick up your order.
                </div>
              )}
            </section>

            {/* ── Notes ────────────────────────────────────────────────── */}
            <section className="ck-section">
              <h2 className="ck-section-title">Order Notes</h2>
              <div className="ck-field">
                <textarea className="ck-input ck-textarea" placeholder="Any special requests..." value={form.notes} onChange={set('notes')} rows={2} />
              </div>
            </section>
          </div>

          {/* ── Order Summary Sidebar ────────────────────────────────────── */}
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
            <div className="sc-summary-row sc-summary-row--mt12">
              <span>Subtotal</span><span>{fmt(cartTotal)}</span>
            </div>
            <div className="sc-summary-row sc-summary-row--muted">
              <span>Tax</span><span>$0.00</span>
            </div>
            {form.fulfillmentType === 'delivery' && (
              <div className="sc-summary-row sc-summary-row--muted">
                <span>Delivery Fee</span><span>$0.00</span>
              </div>
            )}
            <div className="sc-summary-row sc-summary-total">
              <span>Total</span><span>{fmt(cartTotal)}</span>
            </div>

            {payMethod === 'card' && !tokenReady && (
              <p className="ck-card-hint">
                Enter your card number above to proceed
              </p>
            )}

            <button
              type="submit"
              className="cd-btn-checkout ck-submit-btn"
              disabled={loading || !canPlaceOrder}
            >
              {loading
                ? 'Processing...'
                : payMethod === 'card'
                  ? `Pay ${fmt(cartTotal)}`
                  : 'Place Order'}
            </button>

            {payMethod === 'card' && (
              <div className="ck-secured-by">
                <Lock size={14} /> Secured by CardPointe
              </div>
            )}
          </div>
        </form>
      </main>

      <Footer />
    </>
  );
}

export async function getServerSideProps(ctx: GetServerSidePropsContext) {
  const { withStore } = await import('../lib/resolveStore');
  return withStore(ctx);
}
