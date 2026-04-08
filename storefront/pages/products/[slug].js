/**
 * Product detail page — dynamic per-store, server-side rendered.
 */

import { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import Header from '../../components/layout/Header';
import Footer from '../../components/layout/Footer';
import CartDrawer from '../../components/cart/CartDrawer';
import { useCart } from '../../lib/cart';
import { withStore } from '../../lib/resolveStore';
import { getProduct } from '../../lib/api';

function fmt(price) { return `$${Number(price).toFixed(2)}`; }

export default function ProductDetailPage({ store, storeSlug, product }) {
  const { addItem, storeSlug: sq } = useCart();
  const slug = storeSlug || sq;
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);

  if (!product) {
    return (<><Header /><div className="sf-empty"><div className="sf-empty-icon">🔍</div><h2>Product Not Found</h2></div><Footer /></>);
  }

  const hasSale = product.salePrice && Number(product.salePrice) > 0;
  const price = hasSale ? Number(product.salePrice) : Number(product.retailPrice);

  const handleAdd = () => { addItem(product, qty); setAdded(true); setTimeout(() => setAdded(false), 2000); };

  return (
    <>
      <Head>
        <title>{product.name} — {store?.storeName || 'Store'}</title>
        <meta name="description" content={product.shortDescription || product.description || product.name} />
      </Head>
      <Header />
      <CartDrawer />
      <main className="sf-container">
        <div className="sf-breadcrumb">
          <Link href={`/products?store=${slug}`}>Products</Link>
          {product.departmentName && (<><span className="sf-breadcrumb-sep">/</span><Link href={`/products?store=${slug}&department=${product.departmentSlug}`}>{product.departmentName}</Link></>)}
          <span className="sf-breadcrumb-sep">/</span><span>{product.name}</span>
        </div>
        <div className="sf-pdp">
          <div className="sf-pdp-image">
            {product.imageUrl ? <img src={product.imageUrl} alt={product.name} className="sf-pdp-img" /> : <div className="sf-product-image-placeholder" style={{ borderRadius: 8, height: 400 }}>📦</div>}
          </div>
          <div className="sf-pdp-info">
            {product.brand && <div className="sf-pdp-brand">{product.brand}</div>}
            <h1 className="sf-pdp-name">{product.name}</h1>
            {product.departmentName && <div className="sf-pdp-dept">{product.departmentName}</div>}
            <div className="sf-pdp-price-row">
              <span className="sf-pdp-price">{fmt(price)}</span>
              {hasSale && <span className="sf-pdp-price-original">{fmt(product.retailPrice)}</span>}
            </div>
            {product.inStock ? <div className="sf-pdp-stock sf-pdp-stock--in">In Stock</div> : <div className="sf-pdp-stock sf-pdp-stock--out">Out of Stock</div>}
            {product.size && <div className="sf-pdp-meta">Size: {product.size}</div>}
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
            {product.description && <div className="sf-pdp-desc"><h3>Description</h3><p>{product.description}</p></div>}
            {product.tags?.length > 0 && (
              <div className="sf-pdp-tags">
                {product.tags.map(tag => <Link key={tag} href={`/products?store=${slug}&search=${tag}`} className="sf-dept-badge">{tag}</Link>)}
              </div>
            )}
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}

export async function getServerSideProps(ctx) {
  return withStore(ctx, async (storeSlug) => {
    try {
      const product = await getProduct(storeSlug, ctx.params.slug);
      return { product };
    } catch {
      return { product: null };
    }
  });
}
