import { useState, MouseEvent, CSSProperties } from 'react';
import Link from 'next/link';
import { useCart } from '../../lib/cart';
import type { Product } from '../../lib/types';

function fmt(price: number | string | null | undefined): string {
  return `$${Number(price ?? 0).toFixed(2)}`;
}

// Category-based gradient placeholders for products without images
const DEPT_COLORS: Record<string, [string, string]> = {
  beverages: ['#dbeafe', '#93c5fd'],
  snacks: ['#fef3c7', '#fcd34d'],
  'dairy-frozen': ['#e0f2fe', '#7dd3fc'],
  grocery: ['#dcfce7', '#86efac'],
  'health-beauty': ['#fce7f3', '#f9a8d4'],
  household: ['#f1f5f9', '#cbd5e1'],
  produce: ['#d1fae5', '#6ee7b7'],
  bakery: ['#fef3c7', '#fde68a'],
  default: ['#f1f5f9', '#e2e8f0'],
};

function getPlaceholderVars(dept?: string | null): CSSProperties {
  const slug = dept?.toLowerCase().replace(/[^a-z-]/g, '') || 'default';
  const [from, to] = DEPT_COLORS[slug] || DEPT_COLORS.default;
  return { ['--sf-ph-from' as string]: from, ['--sf-ph-to' as string]: to } as CSSProperties;
}

interface ProductCardProps {
  product: Product;
}

export default function ProductCard({ product }: ProductCardProps) {
  const { addItem, storeSlug } = useCart();
  const [added, setAdded] = useState(false);

  const hasSale = !!product.salePrice && Number(product.salePrice) > 0;
  const now = new Date();
  const saleActive =
    hasSale &&
    (!product.saleStart || new Date(product.saleStart) <= now) &&
    (!product.saleEnd || new Date(product.saleEnd) >= now);

  const handleAdd = (e: MouseEvent<HTMLButtonElement>) => {
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
          <div
            className="sf-product-image-placeholder sf-product-image-placeholder--dept"
            style={getPlaceholderVars(product.departmentSlug)}
          >
            <span className="sf-placeholder-initial">
              {product.name?.charAt(0)?.toUpperCase() || '?'}
            </span>
          </div>
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
