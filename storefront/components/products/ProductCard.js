import { useState } from 'react';
import Link from 'next/link';
import { useCart } from '../../lib/cart';

function fmt(price) {
  return `$${Number(price).toFixed(2)}`;
}

export default function ProductCard({ product }) {
  const { addItem, storeSlug } = useCart();
  const [added, setAdded] = useState(false);

  const hasSale = product.salePrice && Number(product.salePrice) > 0;
  const now = new Date();
  const saleActive = hasSale &&
    (!product.saleStart || new Date(product.saleStart) <= now) &&
    (!product.saleEnd || new Date(product.saleEnd) >= now);

  const handleAdd = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!product.inStock) return;
    addItem(product, 1);
    setAdded(true);
    setTimeout(() => setAdded(false), 1200);
  };

  return (
    <div className="sf-product-card">
      <Link href={`/products/${product.slug}?store=${storeSlug}`}>
        {product.imageUrl ? (
          <img src={product.imageUrl} alt={product.name} className="sf-product-image" />
        ) : (
          <div className="sf-product-image-placeholder">📦</div>
        )}
      </Link>
      <div className="sf-product-info">
        {product.brand && <div className="sf-product-brand">{product.brand}</div>}
        <Link href={`/products/${product.slug}?store=${storeSlug}`} className="sf-product-name-link">
          <div className="sf-product-name">{product.name}</div>
        </Link>
        {product.inStock ? (
          <>
            <div>
              <span className="sf-product-price">
                {saleActive ? fmt(product.salePrice) : fmt(product.retailPrice)}
              </span>
              {saleActive && (
                <span className="sf-product-price-original">{fmt(product.retailPrice)}</span>
              )}
            </div>
            <button
              className={`sf-add-to-cart ${added ? 'sf-add-to-cart--added' : ''}`}
              onClick={handleAdd}
            >
              {added ? '✓ Added' : 'Add to Cart'}
            </button>
          </>
        ) : (
          <div className="sf-out-of-stock">Out of Stock</div>
        )}
      </div>
    </div>
  );
}
