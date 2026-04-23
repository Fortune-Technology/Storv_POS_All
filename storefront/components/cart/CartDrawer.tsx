import Link from 'next/link';
import { ShoppingCart, Package } from 'lucide-react';
import { useCart } from '../../lib/cart';

function fmt(n: number): string {
  return `$${Number(n).toFixed(2)}`;
}

export default function CartDrawer() {
  const {
    items,
    cartTotal,
    drawerOpen,
    setDrawerOpen,
    updateQty,
    removeItem,
    storeSlug,
  } = useCart();

  return (
    <>
      <div
        className={`cd-overlay ${drawerOpen ? 'cd-overlay--open' : ''}`}
        onClick={() => setDrawerOpen(false)}
      />
      <div className={`cd-drawer ${drawerOpen ? 'cd-drawer--open' : ''}`}>
        <div className="cd-header">
          <span className="cd-title">Your Cart</span>
          <button className="cd-close" onClick={() => setDrawerOpen(false)}>
            &times;
          </button>
        </div>

        <div className="cd-items">
          {items.length === 0 ? (
            <div className="cd-empty">
              <div className="cd-empty-icon">
                <ShoppingCart size={48} strokeWidth={1.5} />
              </div>
              <p>Your cart is empty</p>
            </div>
          ) : (
            items.map((item) => (
              <div key={item.productId} className="cd-item">
                {item.imageUrl ? (
                  <img src={item.imageUrl} alt={item.name} className="cd-item-img" />
                ) : (
                  <div className="cd-item-placeholder">
                    <Package size={40} strokeWidth={1.5} />
                  </div>
                )}
                <div className="cd-item-info">
                  <div className="cd-item-name">{item.name}</div>
                  <div className="cd-item-price">{fmt(item.price * item.qty)}</div>
                  <div className="cd-item-controls">
                    <button
                      className="cd-qty-btn"
                      onClick={() => updateQty(item.productId, item.qty - 1)}
                    >
                      −
                    </button>
                    <span className="cd-qty">{item.qty}</span>
                    <button
                      className="cd-qty-btn"
                      onClick={() => updateQty(item.productId, item.qty + 1)}
                    >
                      +
                    </button>
                    <button
                      className="cd-remove"
                      onClick={() => removeItem(item.productId)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {items.length > 0 && (
          <div className="cd-footer">
            <div className="cd-subtotal">
              <span>Subtotal</span>
              <span>{fmt(cartTotal)}</span>
            </div>
            <div className="cd-actions">
              <Link
                href={`/checkout?store=${storeSlug}`}
                className="cd-btn-checkout"
                onClick={() => setDrawerOpen(false)}
              >
                Checkout
              </Link>
              <Link
                href={`/cart?store=${storeSlug}`}
                className="cd-btn-viewcart"
                onClick={() => setDrawerOpen(false)}
              >
                View Full Cart
              </Link>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
