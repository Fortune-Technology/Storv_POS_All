import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import './ShopPage.css';

const CATEGORIES = ['all', 'terminal', 'printer', 'scanner', 'tablet', 'accessory'];

export default function ShopPage() {
  const [products, setProducts] = useState([]);
  const [category, setCategory] = useState('all');
  const [loading, setLoading]   = useState(true);
  const [cart, setCart]         = useState(() => {
    try { return JSON.parse(localStorage.getItem('storv_cart') || '[]'); } catch { return []; }
  });

  useEffect(() => {
    setLoading(true);
    const url = category === 'all'
      ? '/api/equipment/products'
      : `/api/equipment/products?category=${category}`;
    fetch(url)
      .then(r => r.json())
      .then(data => setProducts(Array.isArray(data) ? data : []))
      .catch(() => setProducts([]))
      .finally(() => setLoading(false));
  }, [category]);

  const cartCount = cart.reduce((sum, i) => sum + i.qty, 0);

  const addToCart = (product) => {
    setCart(prev => {
      const existing = prev.find(i => i.productId === product.id);
      const updated  = existing
        ? prev.map(i => i.productId === product.id ? { ...i, qty: i.qty + 1 } : i)
        : [...prev, {
            productId: product.id,
            name:      product.name,
            price:     Number(product.price),
            qty:       1,
            image:     product.images?.[0] || null,
          }];
      localStorage.setItem('storv_cart', JSON.stringify(updated));
      return updated;
    });
  };

  const fmt = (n) => `$${Number(n).toFixed(2)}`;

  return (
    <div className="msp-page">
      {/* Header */}
      <header className="msp-header">
        <div>
          <h1 className="msp-heading">StoreVeu Equipment Shop</h1>
          <p className="msp-subheading">POS terminals, printers & accessories</p>
        </div>
        <Link to="/shop/cart" className="msp-cart-btn">
          🛒 Cart{cartCount > 0 && (
            <span className="msp-cart-badge">{cartCount}</span>
          )}
        </Link>
      </header>

      <div className="msp-content">
        {/* Category filter */}
        <div className="msp-filters">
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              className={`msp-filter-btn ${category === cat ? 'msp-filter-btn--active' : 'msp-filter-btn--inactive'}`}
            >
              {cat}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="msp-status">Loading products...</div>
        ) : products.length === 0 ? (
          <div className="msp-status">No products found.</div>
        ) : (
          <div className="msp-grid">
            {products.map(p => {
              const isOOS = p.trackStock && p.stockQty === 0;
              return (
                <div key={p.id} className="msp-card">
                  <Link to={`/shop/${p.slug}`} className="msp-card-link">
                    <div className="msp-card-image">
                      {p.images?.[0]
                        ? <img src={p.images[0]} alt={p.name} />
                        : <span className="msp-card-image-placeholder">🖥️</span>}
                    </div>
                    <div className="msp-card-body">
                      <div className="msp-card-category">{p.category}</div>
                      <h3 className="msp-card-name">{p.name}</h3>
                      <p className="msp-card-desc">{p.description}</p>
                    </div>
                  </Link>
                  <div className="msp-card-footer">
                    <span className="msp-card-price">{fmt(p.price)}</span>
                    <button
                      onClick={() => addToCart(p)}
                      disabled={isOOS}
                      className={`msp-add-btn ${isOOS ? 'msp-add-btn--oos' : 'msp-add-btn--active'}`}
                    >
                      {isOOS ? 'Out of Stock' : 'Add to Cart'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
