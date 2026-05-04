/**
 * Home page:
 *  - If store slug resolved → show store's template-driven home page
 *  - If NO store → show Store Discovery directory
 */

import { useState, CSSProperties } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import type { GetServerSidePropsContext } from 'next';
import Header from '../components/layout/Header';
import Footer from '../components/layout/Footer';
import CartDrawer from '../components/cart/CartDrawer';
import TemplateRenderer from '../components/templates/TemplateRenderer';
import { getStoreSlug } from '../lib/resolveStore';
import { getStoreInfo, getProducts, getDepartments, getPages } from '../lib/api';
import { Store as StoreIcon, Search, Truck, ShoppingBag } from 'lucide-react';
import axios from 'axios';
import type { Store, Product, Department, EcomPage, TemplateContent } from '@storeveu/types';

const ECOM_API = process.env.ECOM_API_URL || 'http://localhost:5005/api';

/**
 * Shape returned by GET /api/stores (discovery listing).
 * More relaxed than Store because it includes extra branding/fulfillment fields.
 */
interface DiscoveryStore extends Store {
  fulfillmentConfig?: {
    pickupEnabled?: boolean;
    deliveryEnabled?: boolean;
    [key: string]: unknown;
  };
  seoDefaults?: {
    metaTitle?: string;
    metaDescription?: string;
    [key: string]: unknown;
  };
}

interface HomePageProps {
  store?: Store | null;
  storeSlug?: string | null;
  products?: Product[];
  departments?: Department[];
  homePage?: EcomPage | null;
  allStores?: DiscoveryStore[];
}

export default function HomePage({ store, storeSlug, products, departments, homePage, allStores }: HomePageProps) {
  // If we have a store, render its home template
  if (store) {
    return (
      <StoreHomePage
        store={store}
        storeSlug={storeSlug || ''}
        products={products || []}
        departments={departments || []}
        homePage={homePage || null}
      />
    );
  }

  // No store → show Store Discovery
  return <StoreDiscovery stores={allStores || []} />;
}

/* ── Store Home (existing behavior) ──────────────────────────────── */
interface StoreHomePageProps {
  store: Store;
  storeSlug: string;
  products: Product[];
  departments: Department[];
  homePage: EcomPage | null;
}

function StoreHomePage({ store, storeSlug, products, departments, homePage }: StoreHomePageProps) {
  const seo = (store as DiscoveryStore).seoDefaults || {};
  const homeTemplateId = typeof homePage?.templateId === 'string' ? homePage.templateId : 'centered-hero';
  const homeSeoTitle = typeof homePage?.seoTitle === 'string' ? homePage.seoTitle : '';
  const homeSeoDesc = typeof homePage?.seoDescription === 'string' ? homePage.seoDescription : '';
  const content = (homePage?.content ?? {}) as TemplateContent;
  const storeName = store.storeName || store.name;

  return (
    <>
      <Head>
        <title>{homeSeoTitle || seo.metaTitle || storeName}</title>
        <meta name="description" content={homeSeoDesc || seo.metaDescription || `Shop online at ${storeName}`} />
      </Head>
      <Header />
      <CartDrawer />
      <TemplateRenderer
        templateId={homeTemplateId}
        pageType="home"
        content={content}
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
interface StoreDiscoveryProps {
  stores: DiscoveryStore[];
}

function StoreDiscovery({ stores }: StoreDiscoveryProps) {
  const [search, setSearch] = useState('');
  const filtered = stores.filter(s => {
    const name = (s.storeName || s.name || '').toLowerCase();
    return !search || name.includes(search.toLowerCase());
  });

  return (
    <>
      <Head>
        <title>Discover Stores — Storeveu</title>
        <meta name="description" content="Browse online stores powered by Storeveu. Order groceries, snacks, and essentials for pickup or delivery." />
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
                const logoUrlRaw = typeof branding.logoUrl === 'string' ? branding.logoUrl : '';
                const fulfillment = s.fulfillmentConfig || {};
                const seo = s.seoDefaults || {};
                const logoUrl = logoUrlRaw
                  ? (logoUrlRaw.startsWith('http')
                      ? logoUrlRaw
                      : `${process.env.NEXT_PUBLIC_ECOM_URL || 'http://localhost:5005'}${logoUrlRaw}`)
                  : null;
                const primaryColor = typeof branding.primaryColor === 'string' ? branding.primaryColor : undefined;
                const bannerStyle: CSSProperties | undefined = !logoUrl
                  ? ({ ['--sd-banner-bg' as string]: primaryColor } as CSSProperties)
                  : undefined;
                const storeName = s.storeName || s.name;
                return (
                  <div key={s.slug} className="sd-card">
                    <div className={`sd-card-banner ${!logoUrl ? 'sd-card-banner--color' : ''}`} style={bannerStyle}>
                      {logoUrl ? (
                        <img src={logoUrl} alt={storeName} className="sd-card-logo" />
                      ) : (
                        <span className="sd-card-initial">{storeName?.charAt(0)?.toUpperCase()}</span>
                      )}
                    </div>
                    <div className="sd-card-body">
                      <h3 className="sd-card-name">{storeName}</h3>
                      {seo.metaDescription && <p className="sd-card-desc">{seo.metaDescription.slice(0, 80)}</p>}
                      <div className="sd-card-tags">
                        {fulfillment.pickupEnabled && <span className="sd-tag"><StoreIcon size={12} /> Pickup</span>}
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
          <div className="sf-empty sd-empty">
            <Search size={48} className="sd-empty-icon" />
            <h2>No stores found</h2>
            <p>{search ? 'Try a different search term.' : 'No stores are online yet.'}</p>
          </div>
        )}
      </main>

      <footer className="sf-footer">
        <div className="sf-container">
          <p>Powered by Storeveu</p>
        </div>
      </footer>
    </>
  );
}

export async function getServerSideProps(ctx: GetServerSidePropsContext) {
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

    const homePage = Array.isArray(allPages) ? allPages.find((p) => p.pageType === 'home') : null;
    let homePageFull: EcomPage | null = null;
    if (homePage) {
      try {
        const { getPage } = await import('../lib/api');
        homePageFull = await getPage(slug, homePage.slug);
      } catch {
        // leave null
      }
    }

    return {
      props: {
        store,
        storeSlug: slug,
        products: productsResp.data || [],
        departments: departments || [],
        homePage: homePageFull || null,
      },
    };
  } catch {
    // Slug resolution returned a non-null value but the store doesn't exist
    // (e.g. visiting `test.shop.storeveu.com` — the env-marker subdomain
    // `test` looks like a slug to the resolver but no such store is enabled).
    // Fall back to the discovery page so the user sees the directory rather
    // than a blank screen.
    try {
      const { data } = await axios.get(`${ECOM_API}/stores`);
      return { props: { store: null, storeSlug: null, allStores: data.data || [] } };
    } catch {
      return { props: { store: null, storeSlug: null, allStores: [] } };
    }
  }
}
