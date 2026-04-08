/**
 * Home page — renders the store's home template if configured,
 * otherwise shows a default hero + products layout.
 */

import Head from 'next/head';
import Header from '../components/layout/Header';
import Footer from '../components/layout/Footer';
import CartDrawer from '../components/cart/CartDrawer';
import TemplateRenderer from '../components/templates/TemplateRenderer';
import { withStore } from '../lib/resolveStore';
import { getProducts, getDepartments, getPages } from '../lib/api';

export default function HomePage({ store, storeSlug, products, departments, homePage }) {
  if (!store) {
    return (
      <>
        <Header />
        <div className="sf-empty" style={{ paddingTop: 100 }}>
          <div className="sf-empty-icon">🏪</div>
          <h2>Store Not Found</h2>
          <p>This online store is not available. Please check the URL.</p>
        </div>
        <Footer />
      </>
    );
  }

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

export async function getServerSideProps(ctx) {
  return withStore(ctx, async (slug) => {
    const [productsResp, departments, allPages] = await Promise.all([
      getProducts(slug, { limit: 8 }),
      getDepartments(slug),
      getPages(slug).catch(() => []),
    ]);

    // Find the home page (if configured via portal)
    const homePage = Array.isArray(allPages) ? allPages.find(p => p.pageType === 'home') : null;

    // If home page exists, load its full content
    let homePageFull = null;
    if (homePage) {
      try {
        const { getPage } = await import('../lib/api.js');
        homePageFull = await getPage(slug, homePage.slug);
      } catch {}
    }

    return {
      products: productsResp.data || [],
      departments: departments || [],
      homePage: homePageFull || null,
    };
  });
}
