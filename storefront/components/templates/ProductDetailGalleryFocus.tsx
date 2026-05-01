/**
 * Product Detail Template 5: Gallery Focus.
 *
 * Large dominant image on the left with a sticky info column on the right.
 * Best for stores that want a Shopify/Apple-like "image-driven" feel even
 * with a single product image (the product's image fills the gallery slot).
 */

import { useState } from 'react';
import Link from 'next/link';
import { useCart } from '../../lib/cart';
import type { TemplateProps } from '@storeveu/types';

function fmt(p: number | string): string { return `$${Number(p).toFixed(2)}`; }

export default function ProductDetailGalleryFocus({ product, storeSlug }: TemplateProps) {
  const { addItem } = useCart();
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);

  if (!product) return null;

  const hasSale = !!product.salePrice && Number(product.salePrice) > 0;
  const price = hasSale ? Number(product.salePrice) : Number(product.retailPrice);
  const tags = Array.isArray(product.tags) ? (product.tags as string[]) : [];
  const description = typeof product.description === 'string' ? product.description : '';
  const shortDescription = typeof product.shortDescription === 'string' ? product.shortDescription : '';
  const departmentName = typeof product.departmentName === 'string' ? product.departmentName : '';
  const size = typeof product.size === 'string' ? product.size : '';

  const handleAdd = () => {
    addItem(product, qty);
    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
  };

  return (
    <main className="sf-container tpl-pdp-gallery">
      <div className="sf-breadcrumb">
        <Link href={`/products?store=${storeSlug}`}>Products</Link>
        {departmentName && (
          <>
            <span className="sf-breadcrumb-sep">/</span>
            <Link href={`/products?store=${storeSlug}&department=${product.departmentSlug}`}>{departmentName}</Link>
          </>
        )}
        <span className="sf-breadcrumb-sep">/</span>
        <span>{product.name}</span>
      </div>

      <div className="tpl-pdp-gallery-grid">
        <div className="tpl-pdp-gallery-images">
          <div className="tpl-pdp-gallery-main">
            {product.imageUrl ? (
              <img src={product.imageUrl} alt={product.name} className="tpl-pdp-gallery-img" />
            ) : (
              <div className="tpl-pdp-gallery-placeholder">
                <span>{product.name?.charAt(0)?.toUpperCase()}</span>
              </div>
            )}
          </div>
          {/* Thumbnail strip — placeholder for future multi-image support */}
          {product.imageUrl && (
            <div className="tpl-pdp-gallery-thumbs">
              <div className="tpl-pdp-gallery-thumb tpl-pdp-gallery-thumb--active">
                <img src={product.imageUrl} alt="" />
              </div>
            </div>
          )}
        </div>

        <aside className="tpl-pdp-gallery-info">
          <div className="tpl-pdp-gallery-info-inner">
            {product.brand && <div className="tpl-pdp-gallery-brand">{product.brand}</div>}
            <h1 className="tpl-pdp-gallery-name">{product.name}</h1>
            {departmentName && (
              <div className="tpl-pdp-gallery-dept">
                {departmentName}{size && ` · ${size}`}
              </div>
            )}

            <div className="tpl-pdp-gallery-price-row">
              <span className="tpl-pdp-gallery-price">{fmt(price)}</span>
              {hasSale && <span className="tpl-pdp-gallery-price-orig">{fmt(product.retailPrice)}</span>}
            </div>

            <div className={`tpl-pdp-gallery-stock ${product.inStock ? 'tpl-pdp-gallery-stock--in' : 'tpl-pdp-gallery-stock--out'}`}>
              {product.inStock ? '✓ In Stock — ready to ship' : '✕ Out of Stock'}
            </div>

            {shortDescription && <p className="tpl-pdp-gallery-short">{shortDescription}</p>}

            {product.inStock && (
              <div className="tpl-pdp-gallery-actions">
                <div className="sf-pdp-qty">
                  <button className="sf-pdp-qty-btn" onClick={() => setQty(q => Math.max(1, q - 1))}>−</button>
                  <span className="sf-pdp-qty-val">{qty}</span>
                  <button className="sf-pdp-qty-btn" onClick={() => setQty(q => q + 1)}>+</button>
                </div>
                <button className={`sf-pdp-add tpl-pdp-gallery-add ${added ? 'sf-pdp-add--added' : ''}`} onClick={handleAdd}>
                  {added ? '✓ Added to Cart' : `Add to Cart — ${fmt(price * qty)}`}
                </button>
              </div>
            )}

            {description && (
              <div className="tpl-pdp-gallery-desc">
                <h3>Description</h3>
                <p>{description}</p>
              </div>
            )}

            {tags.length > 0 && (
              <div className="tpl-pdp-gallery-tags">
                {tags.map(tag => (
                  <Link key={tag} href={`/products?store=${storeSlug}&search=${tag}`} className="sf-dept-badge">{tag}</Link>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}
