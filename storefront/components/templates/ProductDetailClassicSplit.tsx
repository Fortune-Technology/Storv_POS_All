/**
 * Product Detail Template 1: Classic Split.
 *
 * Image left, info right. Mirrors the original [slug].tsx hardcoded layout
 * so existing stores see no visual change after the template system is
 * added (this is the default/fallback).
 */

import { useState } from 'react';
import Link from 'next/link';
import { useCart } from '../../lib/cart';
import type { TemplateProps } from '@storeveu/types';

function fmt(p: number | string): string { return `$${Number(p).toFixed(2)}`; }

export default function ProductDetailClassicSplit({ product, storeSlug }: TemplateProps) {
  const { addItem } = useCart();
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);

  if (!product) return null;

  const hasSale = !!product.salePrice && Number(product.salePrice) > 0;
  const price = hasSale ? Number(product.salePrice) : Number(product.retailPrice);
  const tags = Array.isArray(product.tags) ? (product.tags as string[]) : [];
  const shortDescription = typeof product.shortDescription === 'string' ? product.shortDescription : '';
  const description = typeof product.description === 'string' ? product.description : '';
  const departmentName = typeof product.departmentName === 'string' ? product.departmentName : '';
  const size = typeof product.size === 'string' ? product.size : '';

  const handleAdd = () => {
    addItem(product, qty);
    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
  };

  return (
    <main className="sf-container">
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

      <div className="sf-pdp">
        <div className="sf-pdp-image">
          {product.imageUrl ? (
            <img src={product.imageUrl} alt={product.name} className="sf-pdp-img" />
          ) : (
            <div className="sf-product-image-placeholder sf-pdp-placeholder">
              <span className="sf-placeholder-initial sf-pdp-placeholder-initial">{product.name?.charAt(0)?.toUpperCase()}</span>
            </div>
          )}
        </div>

        <div className="sf-pdp-info">
          {product.brand && <div className="sf-pdp-brand">{product.brand}</div>}
          <h1 className="sf-pdp-name">{product.name}</h1>
          {departmentName && <div className="sf-pdp-dept">{departmentName}</div>}
          <div className="sf-pdp-price-row">
            <span className="sf-pdp-price">{fmt(price)}</span>
            {hasSale && <span className="sf-pdp-price-original">{fmt(product.retailPrice)}</span>}
          </div>
          {product.inStock
            ? <div className="sf-pdp-stock sf-pdp-stock--in">In Stock</div>
            : <div className="sf-pdp-stock sf-pdp-stock--out">Out of Stock</div>}
          {size && <div className="sf-pdp-meta">Size: {size}</div>}
          {shortDescription && <p className="sf-pdp-meta">{shortDescription}</p>}

          {product.inStock && (
            <div className="sf-pdp-cart-row">
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

          {description && (
            <div className="sf-pdp-desc">
              <h3>Description</h3>
              <p>{description}</p>
            </div>
          )}

          {tags.length > 0 && (
            <div className="sf-pdp-tags">
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
