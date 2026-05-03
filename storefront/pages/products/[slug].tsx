/**
 * Product detail page — dynamic per-store, server-side rendered.
 *
 * Renders one of 5 templates based on the store's configured Product Detail
 * page (created in the portal's Ecom Setup → Pages tab). Falls back to the
 * Classic Split layout when no template is configured.
 */

import Head from 'next/head';
import type { GetServerSidePropsContext } from 'next';
import { SearchX } from 'lucide-react';
import Header from '../../components/layout/Header';
import Footer from '../../components/layout/Footer';
import CartDrawer from '../../components/cart/CartDrawer';
import TemplateRenderer from '../../components/templates/TemplateRenderer';
import { withStore } from '../../lib/resolveStore';
import { getProduct, getPages, getPage } from '../../lib/api';
import type { Product, Store, EcomPage, TemplateContent } from '@storeveu/types';

interface ProductDetailPageProps {
  store?: Store | null;
  storeSlug?: string | null;
  product?: Product | null;
  productPage?: EcomPage | null;
}

export default function ProductDetailPage({ store, storeSlug, product, productPage }: ProductDetailPageProps) {
  if (!product) {
    return (
      <>
        <Header />
        <div className="sf-empty">
          <div className="sf-empty-icon"><SearchX size={48} strokeWidth={1.5} /></div>
          <h2>Product Not Found</h2>
        </div>
        <Footer />
      </>
    );
  }

  const templateId = typeof productPage?.templateId === 'string' ? productPage.templateId : 'product-classic-split';
  const content = (productPage?.content ?? {}) as TemplateContent;
  const seoTitle = typeof productPage?.seoTitle === 'string' ? productPage.seoTitle : '';
  const seoDesc = typeof productPage?.seoDescription === 'string' ? productPage.seoDescription : '';

  const shortDescription = typeof product.shortDescription === 'string' ? product.shortDescription : '';
  const description = typeof product.description === 'string' ? product.description : '';

  return (
    <>
      <Head>
        <title>{seoTitle ? `${product.name} — ${seoTitle}` : `${product.name} — ${store?.storeName || store?.name || 'Store'}`}</title>
        <meta name="description" content={seoDesc || shortDescription || description || product.name} />
      </Head>
      <Header />
      <CartDrawer />
      <TemplateRenderer
        templateId={templateId}
        pageType="product"
        content={content}
        store={store}
        product={product}
        storeSlug={storeSlug || ''}
      />
      <Footer />
    </>
  );
}

export async function getServerSideProps(ctx: GetServerSidePropsContext) {
  return withStore(ctx, async (storeSlug) => {
    const slugParam = ctx.params?.slug;
    const slug = typeof slugParam === 'string' ? slugParam : Array.isArray(slugParam) ? slugParam[0] : '';
    try {
      const [product, allPages] = await Promise.all([
        getProduct(storeSlug, slug),
        getPages(storeSlug).catch(() => []),
      ]);
      // Pull the singleton Product Detail Page record for templateId + content.
      const productPageStub = Array.isArray(allPages) ? allPages.find((p) => p.pageType === 'product') : null;
      let productPage: EcomPage | null = null;
      if (productPageStub) {
        try {
          productPage = await getPage(storeSlug, productPageStub.slug);
        } catch {
          // leave null — falls back to default template
        }
      }
      return { product, productPage };
    } catch {
      return { product: null, productPage: null };
    }
  });
}
