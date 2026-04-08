/**
 * Order confirmation page — client-side rendered.
 */

import { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import Header from '../../components/layout/Header';
import Footer from '../../components/layout/Footer';
import { useCart } from '../../lib/cart';
import axios from 'axios';

function fmt(n) { return `$${Number(n).toFixed(2)}`; }

const ECOM_API = process.env.NEXT_PUBLIC_ECOM_API_URL || 'http://localhost:5005/api';

export default function OrderConfirmationPage() {
  const router = useRouter();
  const { id, store: slug } = router.query;
  const { storeSlug } = useCart();
  const sq = slug || storeSlug;

  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id || !sq) return;
    axios.get(`${ECOM_API}/manage/orders/${id}`, {
      headers: { 'X-Store-Id': 'any' },
    }).then(r => {
      setOrder(r.data?.data || r.data);
    }).catch(() => {
      // Try public endpoint approach — for now just show generic confirmation
      setOrder({ id, orderNumber: 'Processing...', status: 'confirmed' });
    }).finally(() => setLoading(false));
  }, [id, sq]);

  return (
    <>
      <Head><title>Order Confirmed</title></Head>
      <Header />

      <main className="sf-container" style={{ paddingTop: 40, paddingBottom: 80 }}>
        {loading ? (
          <div className="sf-loading">Loading order details...</div>
        ) : (
          <div className="oc-wrapper">
            <div className="oc-icon">✅</div>
            <h1 className="oc-title">Order Confirmed!</h1>
            <p className="oc-subtitle">Thank you for your order.</p>

            {order && (
              <div className="oc-details">
                <div className="oc-row">
                  <span className="oc-label">Order Number</span>
                  <span className="oc-value">{order.orderNumber}</span>
                </div>
                <div className="oc-row">
                  <span className="oc-label">Status</span>
                  <span className="oc-status">{order.status}</span>
                </div>
                {order.fulfillmentType && (
                  <div className="oc-row">
                    <span className="oc-label">Fulfillment</span>
                    <span className="oc-value">{order.fulfillmentType === 'pickup' ? '🏪 Pickup' : '🚗 Delivery'}</span>
                  </div>
                )}
                {order.grandTotal && (
                  <div className="oc-row">
                    <span className="oc-label">Total</span>
                    <span className="oc-value oc-value--bold">{fmt(order.grandTotal)}</span>
                  </div>
                )}

                {order.lineItems && Array.isArray(order.lineItems) && (
                  <div className="oc-items">
                    <h3 style={{ marginBottom: 8, fontSize: 15 }}>Items</h3>
                    {order.lineItems.map((item, i) => (
                      <div key={i} className="oc-item-row">
                        <span>{item.name} × {item.qty}</span>
                        <span>{fmt(item.total || item.price * item.qty)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <Link href={`/products?store=${sq}`} className="cd-btn-checkout" style={{ marginTop: 24, display: 'inline-block', padding: '12px 32px' }}>
              Continue Shopping
            </Link>
          </div>
        )}
      </main>

      <Footer />
    </>
  );
}
