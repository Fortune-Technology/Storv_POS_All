import { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import Header from '../../components/layout/Header';
import Footer from '../../components/layout/Footer';
import CartDrawer from '../../components/cart/CartDrawer';
import { useAuth } from '../../lib/auth';
import { useCart } from '../../lib/cart';

function fmt(n) { return `$${Number(n).toFixed(2)}`; }
function fmtDate(d) { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }

export default function AccountPage() {
  const { customer, isLoggedIn, logout, getOrders } = useAuth();
  const { storeSlug: sq } = useCart();
  const router = useRouter();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isLoggedIn) { router.push(`/account/login?store=${sq}`); return; }
    getOrders().then(setOrders).catch(() => {}).finally(() => setLoading(false));
  }, [isLoggedIn]);

  if (!isLoggedIn) return null;

  return (
    <>
      <Head><title>My Account</title></Head>
      <Header />
      <CartDrawer />
      <main className="sf-container">
        <div className="sf-page-header">
          <h1 className="sf-page-title">My Account</h1>
        </div>

        <div className="acc-layout">
          {/* Profile Card */}
          <div className="acc-profile-card">
            <div className="acc-avatar">{customer?.name?.charAt(0)?.toUpperCase() || '?'}</div>
            <h2 className="acc-name">{customer?.name}</h2>
            <p className="acc-email">{customer?.email}</p>
            {customer?.phone && <p className="acc-phone">{customer.phone}</p>}
            <button className="acc-logout" onClick={() => { logout(); router.push(`/?store=${sq}`); }}>Sign Out</button>
          </div>

          {/* Orders */}
          <div className="acc-orders">
            <h2 className="acc-orders-title">My Orders</h2>
            {loading ? <p className="acc-loading">Loading orders...</p> : orders.length === 0 ? (
              <div className="acc-empty">
                <p>No orders yet</p>
                <Link href={`/products?store=${sq}`} className="sc-continue-btn">Start Shopping</Link>
              </div>
            ) : (
              <div className="acc-order-list">
                {orders.map(o => (
                  <div key={o.id} className="acc-order-card">
                    <div className="acc-order-header">
                      <span className="acc-order-number">{o.orderNumber}</span>
                      <span className={`oc-status`}>{o.status}</span>
                    </div>
                    <div className="acc-order-meta">
                      <span>{fmtDate(o.createdAt)}</span>
                      <span>{o.fulfillmentType === 'pickup' ? '🏪 Pickup' : '🚗 Delivery'}</span>
                      <span className="acc-order-total">{fmt(o.grandTotal)}</span>
                    </div>
                    <div className="acc-order-items">
                      {(Array.isArray(o.lineItems) ? o.lineItems : []).slice(0, 3).map((it, i) => (
                        <span key={i} className="acc-order-item">{it.name} × {it.qty}</span>
                      ))}
                      {Array.isArray(o.lineItems) && o.lineItems.length > 3 && (
                        <span className="acc-order-item">+{o.lineItems.length - 3} more</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
