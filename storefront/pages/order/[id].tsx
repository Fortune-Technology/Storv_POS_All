/**
 * Order confirmation page — client-side rendered.
 */

import { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import type { GetServerSidePropsContext } from 'next';
import { CheckCircle, Store, Truck } from 'lucide-react';
import { useRouter } from 'next/router';
import Header from '../../components/layout/Header';
import Footer from '../../components/layout/Footer';
import { useCart } from '../../lib/cart';
import axios from 'axios';
import type { Order } from '../../lib/types';

function fmt(n: number | string): string {
  return `$${Number(n).toFixed(2)}`;
}

const ECOM_API = process.env.NEXT_PUBLIC_ECOM_API_URL || 'http://localhost:5005/api';

interface OrderLineItem {
  name: string;
  qty: number;
  price?: number;
  total?: number;
  [key: string]: unknown;
}

interface OrderDetail extends Order {
  fulfillmentType?: string;
  grandTotal?: number | string;
  lineItems?: OrderLineItem[];
}

export default function OrderConfirmationPage() {
  const router = useRouter();
  const idQ = router.query.id;
  const slugQ = router.query.store;
  const id = typeof idQ === 'string' ? idQ : Array.isArray(idQ) ? idQ[0] : '';
  const slug = typeof slugQ === 'string' ? slugQ : Array.isArray(slugQ) ? slugQ[0] : '';
  const { storeSlug } = useCart();
  const sq = slug || storeSlug;

  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id || !sq) return;
    // Try customer auth endpoint first, then public lookup
    const stored = typeof window !== 'undefined' ? localStorage.getItem('storv-customer') : null;
    let token: string | null = null;
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as { token?: string };
        token = parsed?.token ?? null;
      } catch {
        token = null;
      }
    }
    const tryFetch = async () => {
      // 1. Try customer auth endpoint
      if (token) {
        try {
          const r = await axios.get(`${ECOM_API}/store/${sq}/auth/orders/${id}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (r.data?.data) { setOrder(r.data.data as OrderDetail); return; }
        } catch {}
      }
      // 2. Try public order lookup by ID + email
      const emailQ = router.query.email;
      const email = typeof emailQ === 'string' ? emailQ : undefined;
      if (email) {
        try {
          const r = await axios.get(`${ECOM_API}/store/${sq}/order/${id}`, { params: { email } });
          if (r.data?.data) { setOrder(r.data.data as OrderDetail); return; }
        } catch {}
      }
      // 3. Fallback — show basic confirmation
      setOrder({ id, orderNumber: 'Order Placed', status: 'confirmed', total: 0, createdAt: '' });
    };
    tryFetch().finally(() => setLoading(false));
  }, [id, sq, router.query.email]);

  return (
    <>
      <Head><title>Order Confirmed</title></Head>
      <Header />

      <main className="sf-container oc-main">
        {loading ? (
          <div className="sf-loading">Loading order details...</div>
        ) : (
          <div className="oc-wrapper">
            <div className="oc-icon"><CheckCircle size={48} strokeWidth={1.5} /></div>
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
                    <span className="oc-value">{order.fulfillmentType === 'pickup' ? <><Store size={14} /> Pickup</> : <><Truck size={14} /> Delivery</>}</span>
                  </div>
                )}
                {order.grandTotal != null && (
                  <div className="oc-row">
                    <span className="oc-label">Total</span>
                    <span className="oc-value oc-value--bold">{fmt(order.grandTotal)}</span>
                  </div>
                )}

                {order.lineItems && Array.isArray(order.lineItems) && (
                  <div className="oc-items">
                    <h3 className="oc-items-heading">Items</h3>
                    {order.lineItems.map((item, i) => (
                      <div key={i} className="oc-item-row">
                        <span>{item.name} × {item.qty}</span>
                        <span>{fmt(item.total ?? (item.price ?? 0) * item.qty)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <Link href={`/products?store=${sq}`} className="cd-btn-checkout oc-continue-btn">
              Continue Shopping
            </Link>
          </div>
        )}
      </main>

      <Footer />
    </>
  );
}

export async function getServerSideProps(ctx: GetServerSidePropsContext) {
  const { withStore } = await import('../../lib/resolveStore');
  return withStore(ctx);
}
