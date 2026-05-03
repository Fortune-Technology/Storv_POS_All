/**
 * Product Detail Template 3: Minimal Centered.
 *
 * Tight column, image and info stacked, generous whitespace. For boutique /
 * specialty stores where the catalog is small and editorial style matters.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useCart } from '../../lib/cart';
import type { TemplateProps } from '@storeveu/types';

function fmt(p: number | string): string { return `$${Number(p).toFixed(2)}`; }

export default function ProductDetailMinimalCentered({ product, storeSlug }: TemplateProps) {
  const { addItem } = useCart();
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);

  if (!product) return null;

  const hasSale = !!product.salePrice && Number(product.salePrice) > 0;
  const price = hasSale ? Number(product.salePrice) : Number(product.retailPrice);
  const description = typeof product.description === 'string' ? product.description : '';
  const departmentName = typeof product.departmentName === 'string' ? product.departmentName : '';
  const size = typeof product.size === 'string' ? product.size : '';

  const handleAdd = () => {
    addItem(product, qty);
    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
  };

  return (
    <main className="tpl-pdp-minimal">
      <div className="tpl-pdp-minimal-back">
        <Link href={`/products?store=${storeSlug}`} className="tpl-pdp-minimal-back-link">← Back to all products</Link>
      </div>

      <div className="tpl-pdp-minimal-image">
        {product.imageUrl ? (
          <img src={product.imageUrl} alt={product.name} className="tpl-pdp-minimal-img" />
        ) : (
          <div className="tpl-pdp-minimal-placeholder">
            <span>{product.name?.charAt(0)?.toUpperCase()}</span>
          </div>
        )}
      </div>

      <div className="tpl-pdp-minimal-info">
        {product.brand && <div className="tpl-pdp-minimal-brand">{product.brand}</div>}
        <h1 className="tpl-pdp-minimal-name">{product.name}</h1>
        {departmentName && <div className="tpl-pdp-minimal-dept">{departmentName}</div>}

        <div className="tpl-pdp-minimal-price-row">
          <span className="tpl-pdp-minimal-price">{fmt(price)}</span>
          {hasSale && <span className="tpl-pdp-minimal-price-orig">{fmt(product.retailPrice)}</span>}
        </div>

        {size && <div className="tpl-pdp-minimal-meta">Size: {size}</div>}
        <div className={`tpl-pdp-minimal-stock ${product.inStock ? 'tpl-pdp-minimal-stock--in' : 'tpl-pdp-minimal-stock--out'}`}>
          {product.inStock ? '● In Stock' : '○ Out of Stock'}
        </div>

        {product.inStock && (
          <div className="tpl-pdp-minimal-actions">
            <div className="sf-pdp-qty">
              <button className="sf-pdp-qty-btn" onClick={() => setQty(q => Math.max(1, q - 1))}>−</button>
              <span className="sf-pdp-qty-val">{qty}</span>
              <button className="sf-pdp-qty-btn" onClick={() => setQty(q => q + 1)}>+</button>
            </div>
            <button className={`sf-pdp-add ${added ? 'sf-pdp-add--added' : ''}`} onClick={handleAdd}>
              {added ? '✓ Added' : `Add to Cart — ${fmt(price * qty)}`}
            </button>
          </div>
        )}

        {description && (
          <div className="tpl-pdp-minimal-desc">
            <h3>About this product</h3>
            <p>{description}</p>
          </div>
        )}
      </div>
    </main>
  );
}
