/**
 * Home page:
 *  - If store slug resolved → show store's template-driven home page
 *  - If NO store → show Store Discovery directory
 */

import { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import Header from '../components/layout/Header';
import Footer from '../components/layout/Footer';
import CartDrawer from '../components/cart/CartDrawer';
import TemplateRenderer from '../components/templates/TemplateRenderer';
import { useCart } from '../lib/cart';
import { getStoreSlug } from '../lib/resolveStore';
import { getStoreInfo, getProducts, getDepartments, getPages } from '../lib/api';
import { Store, Search, MapPin, Truck, ShoppingBag } from 'lucide-react';
import axios from 'axios';

const ECOM_API = process.env.ECOM_API_URL || 'http://localhost:5005/api';

export default function HomePage({ store, storeSlug, products, departments, homePage, allStores }) {
  // If we have a store, render its home template
  if (store) {
    return <StoreHomePage store={store} storeSlug={storeSlug} products={products} departments={departments} homePage={homePage} />;
  }

  // No store → show Store Discovery
  return <StoreDiscovery stores={allStores || []} />;
}

/* ── Store Home (existing behavior) ──────────────────────────────── */
function StoreHomePage({ store, storeSlug, products, departments, homePage }) {
  const seo = store.seoDefaults || {};
  return (
    <>
      <Head>
        <title>{homePage?.seoTitle || seo.metaTitle || store.storeName}</title>
        <meta name="description" content={homePage?.seoDescription || seo.metaDescription || `Shop online at ${store.storeName}`} />
      </Head>
      <Header />
      <CartDrawer />
      <TemplateRenderer
        templateId={homePage?.templateId || 'centered-hero'}
        pageType="home"
        content={homePage?.content || {}}
        store={store}
        products={products}
        departments={departments}
        storeSlug={storeSlug}
      />
      <Footer />
    </>
  );
}

/* ── Store Discovery ─────────────────────────────────────────────── */
function StoreDiscovery({ stores }) {
  const [search, setSearch] = useState('');
  const filtered = stores.filter(s =>
    !search || s.storeName.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <>
      <Head>
        <title>Discover Stores — Storv</title>
        <meta name="description" content="Browse online stores powered by Storv. Order groceries, snacks, and essentials for pickup or delivery." />
      </Head>

      {/* Hero */}
      <section className="sd-hero">
        <div className="sf-container">
          <ShoppingBag size={48} className="sd-hero-icon" />
          <h1 className="sd-hero-title">Discover Local Stores</h1>
          <p className="sd-hero-desc">Browse online stores near you. Order for pickup or delivery.</p>
          <div className="sd-search">
            <Search size={18} className="sd-search-icon" />
            <input
              className="sd-search-input"
              placeholder="Search stores..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </section>

      <main className="sf-container">
        {filtered.length > 0 ? (
          <>
            <p className="sd-count">{filtered.length} store{filtered.length !== 1 ? 's' : ''} available</p>
            <div className="sd-grid">
              {filtered.map(s => {
                const branding = s.branding || {};
                const fulfillment = s.fulfillmentConfig || {};
                const seo = s.seoDefaults || {};
                const logoUrl = branding.logoUrl ? (branding.logoUrl.startsWith('http') ? branding.logoUrl : `http://localhost:5005${branding.logoUrl}`) : null;
                return (
                  <div key={s.slug} className="sd-card">
                    <div className="sd-card-banner" style={logoUrl ? {} : { background: branding.primaryColor || 'var(--sf-primary)' }}>
                      {logoUrl ? (
                        <img src={logoUrl} alt={s.storeName} className="sd-card-logo" />
                      ) : (
                        <span className="sd-card-initial">{s.storeName?.charAt(0)?.toUpperCase()}</span>
                      )}
                    </div>
                    <div className="sd-card-body">
                      <h3 className="sd-card-name">{s.storeName}</h3>
                      {seo.metaDescription && <p className="sd-card-desc">{seo.metaDescription.slice(0, 80)}</p>}
                      <div className="sd-card-tags">
                        {fulfillment.pickupEnabled && <span className="sd-tag"><Store size={12} /> Pickup</span>}
                        {fulfillment.deliveryEnabled && <span className="sd-tag"><Truck size={12} /> Delivery</span>}
                      </div>
                      <Link href={`/?store=${s.slug}`} className="sd-card-cta">Visit Store</Link>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div className="sf-empty" style={{ paddingTop: 60 }}>
            <Search size={48} style={{ opacity: 0.3, marginBottom: 12 }} />
            <h2>No stores found</h2>
            <p>{search ? 'Try a different search term.' : 'No stores are online yet.'}</p>
          </div>
        )}
      </main>

      <footer className="sf-footer">
        <div className="sf-container">
          <p>Powered by Storv</p>
        </div>
      </footer>
    </>
  );
}

export async function getServerSideProps(ctx) {
  const slug = getStoreSlug(ctx);

  // No store slug → fetch all stores for discovery
  if (!slug) {
    try {
      const { data } = await axios.get(`${ECOM_API}/stores`);
      return { props: { store: null, storeSlug: null, allStores: data.data || [] } };
    } catch {
      return { props: { store: null, storeSlug: null, allStores: [] } };
    }
  }

  // Store slug found → load store home page
  try {
    const [store, productsResp, departments, allPages] = await Promise.all([
      getStoreInfo(slug),
      getProducts(slug, { limit: 8 }),
      getDepartments(slug),
      getPages(slug).catch(() => []),
    ]);

    const homePage = Array.isArray(allPages) ? allPages.find(p => p.pageType === 'home') : null;
    let homePageFull = null;
    if (homePage) {
      try { const { getPage } = await import('../lib/api.js'); homePageFull = await getPage(slug, homePage.slug); } catch { }
    }

    return {
      props: {
        store, storeSlug: slug,
        products: productsResp.data || [],
        departments: departments || [],
        homePage: homePageFull || null,
      },
    };
  } catch {
    return { props: { store: null, storeSlug: slug } };
  }
}
