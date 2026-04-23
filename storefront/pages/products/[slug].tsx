/**
 * Product detail page — dynamic per-store, server-side rendered.
 */

import { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import type { GetServerSidePropsContext } from 'next';
import { SearchX } from 'lucide-react';
import Header from '../../components/layout/Header';
import Footer from '../../components/layout/Footer';
import CartDrawer from '../../components/cart/CartDrawer';
import { useCart } from '../../lib/cart';
import { withStore } from '../../lib/resolveStore';
import { getProduct } from '../../lib/api';
import type { Product, Store } from '../../lib/types';

function fmt(price: number | string): string {
  return `$${Number(price).toFixed(2)}`;
}

interface ProductDetailPageProps {
  store?: Store | null;
  storeSlug?: string | null;
  product?: Product | null;
}

export default function ProductDetailPage({ store, storeSlug, product }: ProductDetailPageProps) {
  const { addItem, storeSlug: sq } = useCart();
  const slug = storeSlug || sq;
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);

  if (!product) {
    return (<><Header /><div className="sf-empty"><div className="sf-empty-icon"><SearchX size={48} strokeWidth={1.5} /></div><h2>Product Not Found</h2></div><Footer /></>);
  }

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
    <>
      <Head>
        <title>{product.name} — {store?.storeName || store?.name || 'Store'}</title>
        <meta name="description" content={shortDescription || description || product.name} />
      </Head>
      <Header />
      <CartDrawer />
      <main className="sf-container">
        <div className="sf-breadcrumb">
          <Link href={`/products?store=${slug}`}>Products</Link>
          {departmentName && (<><span className="sf-breadcrumb-sep">/</span><Link href={`/products?store=${slug}&department=${product.departmentSlug}`}>{departmentName}</Link></>)}
          <span className="sf-breadcrumb-sep">/</span><span>{product.name}</span>
        </div>
        <div className="sf-pdp">
          <div className="sf-pdp-image">
            {product.imageUrl ? <img src={product.imageUrl} alt={product.name} className="sf-pdp-img" /> : <div className="sf-product-image-placeholder sf-pdp-placeholder"><span className="sf-placeholder-initial sf-pdp-placeholder-initial">{product.name?.charAt(0)?.toUpperCase()}</span></div>}
          </div>
          <div className="sf-pdp-info">
            {product.brand && <div className="sf-pdp-brand">{product.brand}</div>}
            <h1 className="sf-pdp-name">{product.name}</h1>
            {departmentName && <div className="sf-pdp-dept">{departmentName}</div>}
            <div className="sf-pdp-price-row">
              <span className="sf-pdp-price">{fmt(price)}</span>
              {hasSale && <span className="sf-pdp-price-original">{fmt(product.retailPrice)}</span>}
            </div>
            {product.inStock ? <div className="sf-pdp-stock sf-pdp-stock--in">In Stock</div> : <div className="sf-pdp-stock sf-pdp-stock--out">Out of Stock</div>}
            {size && <div className="sf-pdp-meta">Size: {size}</div>}
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
            {description && <div className="sf-pdp-desc"><h3>Description</h3><p>{description}</p></div>}
            {tags.length > 0 && (
              <div className="sf-pdp-tags">
                {tags.map(tag => <Link key={tag} href={`/products?store=${slug}&search=${tag}`} className="sf-dept-badge">{tag}</Link>)}
              </div>
            )}
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}

export async function getServerSideProps(ctx: GetServerSidePropsContext) {
  return withStore(ctx, async (storeSlug) => {
    const slugParam = ctx.params?.slug;
    const slug = typeof slugParam === 'string' ? slugParam : Array.isArray(slugParam) ? slugParam[0] : '';
    try {
      const product = await getProduct(storeSlug, slug);
      return { product };
    } catch {
      return { product: null };
    }
  });
}
