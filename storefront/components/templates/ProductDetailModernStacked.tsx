/**
 * Product Detail Template 2: Modern Stacked.
 *
 * Full-width hero image, info block centered below. Best for visually-rich
 * products where the photo is the headline.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useCart } from '../../lib/cart';
import type { TemplateProps } from '@storeveu/types';

function fmt(p: number | string): string { return `$${Number(p).toFixed(2)}`; }

export default function ProductDetailModernStacked({ product, storeSlug }: TemplateProps) {
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

  const handleAdd = () => {
    addItem(product, qty);
    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
  };

  return (
    <main className="tpl-pdp-stacked">
      {/* Hero image — full width */}
      <div className="tpl-pdp-stacked-hero">
        {product.imageUrl ? (
          <img src={product.imageUrl} alt={product.name} className="tpl-pdp-stacked-img" />
        ) : (
          <div className="tpl-pdp-stacked-placeholder">
            <span>{product.name?.charAt(0)?.toUpperCase()}</span>
          </div>
        )}
      </div>

      <div className="sf-container tpl-pdp-stacked-body">
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

        <div className="tpl-pdp-stacked-card">
          {product.brand && <div className="tpl-pdp-stacked-brand">{product.brand}</div>}
          <h1 className="tpl-pdp-stacked-name">{product.name}</h1>
          {departmentName && <div className="tpl-pdp-stacked-dept">{departmentName}{size && ` · ${size}`}</div>}

          <div className="tpl-pdp-stacked-price-row">
            <span className="tpl-pdp-stacked-price">{fmt(price)}</span>
            {hasSale && <span className="tpl-pdp-stacked-price-orig">{fmt(product.retailPrice)}</span>}
            {product.inStock
              ? <span className="tpl-pdp-stacked-badge tpl-pdp-stacked-badge--in">In Stock</span>
              : <span className="tpl-pdp-stacked-badge tpl-pdp-stacked-badge--out">Out of Stock</span>}
          </div>

          {description && <p className="tpl-pdp-stacked-desc">{description}</p>}

          {product.inStock && (
            <div className="tpl-pdp-stacked-actions">
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
            <div className="tpl-pdp-stacked-tags">
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
