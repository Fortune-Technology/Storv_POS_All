/**
 * Product Detail Template 4: Floating Card.
 *
 * Background image with a floating white info card overlapping. Modern,
 * editorial — works well for premium/curated catalogs.
 */

import { useState, CSSProperties } from 'react';
import Link from 'next/link';
import { useCart } from '../../lib/cart';
import type { TemplateProps } from '@storeveu/types';

function fmt(p: number | string): string { return `$${Number(p).toFixed(2)}`; }

export default function ProductDetailFloatingCard({ product, storeSlug }: TemplateProps) {
  const { addItem } = useCart();
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);

  if (!product) return null;

  const hasSale = !!product.salePrice && Number(product.salePrice) > 0;
  const price = hasSale ? Number(product.salePrice) : Number(product.retailPrice);
  const tags = Array.isArray(product.tags) ? (product.tags as string[]) : [];
  const description = typeof product.description === 'string' ? product.description : '';
  const departmentName = typeof product.departmentName === 'string' ? product.departmentName : '';
  const size = typeof product.size === 'string' ? product.size : '';

  const bgStyle: CSSProperties = product.imageUrl
    ? {
        ['--tpl-pdp-bg' as string]: `url(${product.imageUrl})`,
        backgroundImage: 'var(--tpl-pdp-bg)',
      }
    : {};

  const handleAdd = () => {
    addItem(product, qty);
    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
  };

  return (
    <main className="tpl-pdp-floating">
      <div className="tpl-pdp-floating-bg" style={bgStyle}>
        {!product.imageUrl && (
          <div className="tpl-pdp-floating-placeholder">
            <span>{product.name?.charAt(0)?.toUpperCase()}</span>
          </div>
        )}
        <div className="tpl-pdp-floating-overlay" />
      </div>

      <div className="sf-container tpl-pdp-floating-container">
        <div className="sf-breadcrumb tpl-pdp-floating-crumbs">
          <Link href={`/products?store=${storeSlug}`}>Products</Link>
          <span className="sf-breadcrumb-sep">/</span>
          <span>{product.name}</span>
        </div>

        <div className="tpl-pdp-floating-card">
          {product.brand && <div className="tpl-pdp-floating-brand">{product.brand}</div>}
          <h1 className="tpl-pdp-floating-name">{product.name}</h1>
          {departmentName && <div className="tpl-pdp-floating-dept">{departmentName}{size && ` · ${size}`}</div>}

          <div className="tpl-pdp-floating-price-row">
            <span className="tpl-pdp-floating-price">{fmt(price)}</span>
            {hasSale && <span className="tpl-pdp-floating-price-orig">{fmt(product.retailPrice)}</span>}
            {product.inStock
              ? <span className="tpl-pdp-floating-badge tpl-pdp-floating-badge--in">In Stock</span>
              : <span className="tpl-pdp-floating-badge tpl-pdp-floating-badge--out">Out of Stock</span>}
          </div>

          {description && <p className="tpl-pdp-floating-desc">{description}</p>}

          {product.inStock && (
            <div className="tpl-pdp-floating-actions">
              <div className="sf-pdp-qty">
                <button className="sf-pdp-qty-btn" onClick={() => setQty(q => Math.max(1, q - 1))}>−</button>
                <span className="sf-pdp-qty-val">{qty}</span>
                <button className="sf-pdp-qty-btn" onClick={() => setQty(q => q + 1)}>+</button>
              </div>
              <button className={`sf-pdp-add ${added ? 'sf-pdp-add--added' : ''}`} onClick={handleAdd}>
                {added ? '✓ Added to Cart' : `Add to Cart — ${fmt(price * qty)}`}
              </button>
            </div>
          )}

          {tags.length > 0 && (
            <div className="tpl-pdp-floating-tags">
              {tags.map(tag => (
                <Link key={tag} href={`/products?store=${storeSlug}&search=${tag}`} className="sf-dept-badge">{tag}</Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
