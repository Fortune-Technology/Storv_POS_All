/**
 * Full cart page — client-side rendered.
 */

import Head from 'next/head';
import Link from 'next/link';
import type { GetServerSidePropsContext } from 'next';
import { ShoppingCart as CartEmptyIcon, Package, X } from 'lucide-react';
import Header from '../components/layout/Header';
import Footer from '../components/layout/Footer';
import CartDrawer from '../components/cart/CartDrawer';
import { useCart } from '../lib/cart';

function fmt(n: number): string {
  return `$${Number(n).toFixed(2)}`;
}

export default function CartPage() {
  const { items, cartTotal, updateQty, removeItem, storeSlug } = useCart();

  return (
    <>
      <Head><title>Shopping Cart</title></Head>
      <Header />
      <CartDrawer />

      <main className="sf-container">
        <div className="sf-page-header">
          <h1 className="sf-page-title">Shopping Cart</h1>
          <p className="sf-page-subtitle">{items.length} item{items.length !== 1 ? 's' : ''}</p>
        </div>

        {items.length === 0 ? (
          <div className="sf-empty">
            <div className="sf-empty-icon"><CartEmptyIcon size={48} strokeWidth={1.5} /></div>
            <p>Your cart is empty</p>
            <Link href={`/products?store=${storeSlug}`} className="sc-continue-btn">
              Continue Shopping
            </Link>
          </div>
        ) : (
          <div className="sc-layout">
            <div className="sc-items">
              {items.map(item => (
                <div key={item.productId} className="sc-item">
                  {item.imageUrl ? (
                    <img src={item.imageUrl} alt={item.name} className="sc-item-img" />
                  ) : (
                    <div className="sc-item-placeholder"><Package size={40} strokeWidth={1.5} /></div>
                  )}
                  <div className="sc-item-info">
                    <Link href={`/products/${item.slug}?store=${storeSlug}`} className="sc-item-name">
                      {item.name}
                    </Link>
                    <div className="sc-item-price">{fmt(item.price)} each</div>
                  </div>
                  <div className="sc-item-qty">
                    <button className="cd-qty-btn" onClick={() => updateQty(item.productId, item.qty - 1)}>−</button>
                    <span className="cd-qty">{item.qty}</span>
                    <button className="cd-qty-btn" onClick={() => updateQty(item.productId, item.qty + 1)}>+</button>
                  </div>
                  <div className="sc-item-total">{fmt(item.price * item.qty)}</div>
                  <button className="sc-item-remove" onClick={() => removeItem(item.productId)}><X size={16} /></button>
                </div>
              ))}
            </div>

            <div className="sc-summary">
              <h3 className="sc-summary-title">Order Summary</h3>
              <div className="sc-summary-row">
                <span>Subtotal</span>
                <span>{fmt(cartTotal)}</span>
              </div>
              <div className="sc-summary-row sc-summary-row--muted">
                <span>Tax</span>
                <span>Calculated at checkout</span>
              </div>
              <div className="sc-summary-row sc-summary-total">
                <span>Estimated Total</span>
                <span>{fmt(cartTotal)}</span>
              </div>
              <Link href={`/checkout?store=${storeSlug}`} className="cd-btn-checkout">
                Proceed to Checkout
              </Link>
              <Link href={`/products?store=${storeSlug}`} className="cd-btn-viewcart cd-btn-viewcart--mt8">
                Continue Shopping
              </Link>
            </div>
          </div>
        )}
      </main>

      <Footer />
    </>
  );
}

export async function getServerSideProps(ctx: GetServerSidePropsContext) {
  const { withStore } = await import('../lib/resolveStore');
  return withStore(ctx);
}
