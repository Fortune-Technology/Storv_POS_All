/**
 * Order Detail page — full order view with status timeline.
 */

import { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import Header from '../../../components/layout/Header';
import Footer from '../../../components/layout/Footer';
import CartDrawer from '../../../components/cart/CartDrawer';
import { useAuth } from '../../../lib/auth';
import { useCart } from '../../../lib/cart';
import { FulfillmentIcon } from '../../../components/icons';
import { ArrowLeft, CheckCircle, Circle, Clock, XCircle } from 'lucide-react';
import axios from 'axios';

const ECOM_API = process.env.NEXT_PUBLIC_ECOM_API_URL || 'http://localhost:5005/api';
function fmt(n) { return `$${Number(n).toFixed(2)}`; }
function fmtDate(d) { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }

const STATUS_STEPS = ['confirmed', 'preparing', 'ready', 'completed'];

export default function OrderDetailPage() {
  const router = useRouter();
  const { id } = router.query;
  const { token, isLoggedIn, storeSlug } = useAuth();
  const { storeSlug: sq } = useCart();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id || !isLoggedIn) return;
    axios.get(`${ECOM_API}/store/${storeSlug}/auth/orders/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => setOrder(r.data?.data)).catch(() => {}).finally(() => setLoading(false));
  }, [id, isLoggedIn]);

  if (!isLoggedIn) return null;

  const items = order ? (Array.isArray(order.lineItems) ? order.lineItems : []) : [];
  const currentIdx = order ? STATUS_STEPS.indexOf(order.status) : -1;
  const isCancelled = order?.status === 'cancelled';

  return (
    <>
      <Head><title>Order {order?.orderNumber || ''}</title></Head>
      <Header />
      <CartDrawer />
      <main className="sf-container" style={{ paddingTop: 24, paddingBottom: 60, maxWidth: 800, margin: '0 auto' }}>
        <Link href={`/account?store=${sq}`} className="od-back"><ArrowLeft size={16} /> Back to My Account</Link>

        {loading ? <p className="acc-loading">Loading order...</p> : !order ? (
          <div className="sf-empty"><p>Order not found</p></div>
        ) : (
          <>
            <div className="od-header">
              <div>
                <h1 className="od-order-num">{order.orderNumber}</h1>
                <p className="od-date">Placed on {fmtDate(order.createdAt)}</p>
              </div>
              <span className={`acc-order-status acc-order-status--${order.status}`}>{order.status}</span>
            </div>

            {/* Status Timeline */}
            {!isCancelled && (
              <div className="od-timeline">
                {STATUS_STEPS.map((step, i) => {
                  const done = i <= currentIdx;
                  return (
                    <div key={step} className={`od-step ${done ? 'od-step--done' : ''}`}>
                      {done ? <CheckCircle size={20} /> : <Circle size={20} />}
                      <span className="od-step-label">{step.charAt(0).toUpperCase() + step.slice(1)}</span>
                      {i < STATUS_STEPS.length - 1 && <div className={`od-step-line ${done && i < currentIdx ? 'od-step-line--done' : ''}`} />}
                    </div>
                  );
                })}
              </div>
            )}
            {isCancelled && (
              <div className="od-cancelled"><XCircle size={20} /> This order was cancelled{order.cancelReason ? `: ${order.cancelReason}` : ''}</div>
            )}

            {/* Fulfillment */}
            <div className="od-section">
              <h3 className="od-section-title">Fulfillment</h3>
              <div className="od-info-row">
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><FulfillmentIcon type={order.fulfillmentType} size={18} /> {order.fulfillmentType === 'pickup' ? 'Pickup' : 'Delivery'}</span>
              </div>
              {order.shippingAddress && (
                <div className="od-info-row" style={{ color: 'var(--sf-text-secondary)', fontSize: 14 }}>
                  {order.shippingAddress.street}, {order.shippingAddress.city} {order.shippingAddress.state} {order.shippingAddress.zip}
                </div>
              )}
            </div>

            {/* Items */}
            <div className="od-section">
              <h3 className="od-section-title">Items ({items.length})</h3>
              {items.map((it, i) => (
                <div key={i} className="od-item">
                  <div className="od-item-name">{it.name}</div>
                  <div className="od-item-qty">x {it.qty}</div>
                  <div className="od-item-price">{fmt(it.total || it.price * it.qty)}</div>
                </div>
              ))}
            </div>

            {/* Totals */}
            <div className="od-section od-totals">
              <div className="od-total-row"><span>Subtotal</span><span>{fmt(order.subtotal)}</span></div>
              {Number(order.taxTotal) > 0 && <div className="od-total-row"><span>Tax</span><span>{fmt(order.taxTotal)}</span></div>}
              {Number(order.deliveryFee) > 0 && <div className="od-total-row"><span>Delivery Fee</span><span>{fmt(order.deliveryFee)}</span></div>}
              {Number(order.tipAmount) > 0 && <div className="od-total-row"><span>Tip</span><span>{fmt(order.tipAmount)}</span></div>}
              <div className="od-total-row od-total-grand"><span>Total</span><span>{fmt(order.grandTotal)}</span></div>
            </div>

            {/* Payment */}
            <div className="od-section">
              <h3 className="od-section-title">Payment</h3>
              <div className="od-info-row">Method: {order.paymentMethod || 'N/A'} · Status: {order.paymentStatus}</div>
            </div>

            {order.notes && (
              <div className="od-section">
                <h3 className="od-section-title">Notes</h3>
                <p style={{ fontSize: 14, color: 'var(--sf-text-secondary)' }}>{order.notes}</p>
              </div>
            )}
          </>
        )}
      </main>
      <Footer />
    </>
  );
}
