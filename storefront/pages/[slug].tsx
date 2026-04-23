/**
 * CMS page — renders About, Contact, and custom pages using the
 * template system. Falls back to raw section rendering for legacy content.
 */

import Head from 'next/head';
import type { GetServerSidePropsContext } from 'next';
import Header from '../components/layout/Header';
import Footer from '../components/layout/Footer';
import CartDrawer from '../components/cart/CartDrawer';
import TemplateRenderer from '../components/templates/TemplateRenderer';
import { useCart } from '../lib/cart';
import { getStoreInfo, getPage } from '../lib/api';
import type { Store, EcomPage, TemplateContent, TemplateSection } from '../lib/types';

interface CmsPageProps {
  store: Store | null;
  storeSlug: string | null;
  page: EcomPage | null;
}

export default function CmsPage({ store, storeSlug, page }: CmsPageProps) {
  const { storeSlug: sq } = useCart();

  if (!page) {
    return (
      <>
        <Header />
        <main className="sf-container">
          <div className="sf-empty cms-empty">
            <div className="sf-empty-icon">📄</div>
            <h2>Page Not Found</h2>
          </div>
        </main>
        <Footer />
      </>
    );
  }

  const seoTitle = typeof page.seoTitle === 'string' ? page.seoTitle : '';
  const seoDescription = typeof page.seoDescription === 'string' ? page.seoDescription : '';
  const templateId = typeof page.templateId === 'string' ? page.templateId : null;
  const pageType = typeof page.pageType === 'string' ? page.pageType : undefined;
  const content = (page.content ?? undefined) as TemplateContent | undefined;

  return (
    <>
      <Head>
        <title>{seoTitle || page.title} — {store?.storeName || store?.name || 'Store'}</title>
        {seoDescription && <meta name="description" content={seoDescription} />}
      </Head>
      <Header />
      <CartDrawer />

      {templateId ? (
        <TemplateRenderer
          templateId={templateId}
          pageType={pageType}
          content={content}
          store={store}
          storeSlug={storeSlug || sq}
        />
      ) : (
        <main className="sf-container">
          <div className="sf-page-header">
            <h1 className="sf-page-title">{page.title}</h1>
          </div>
          <FallbackRenderer content={content} />
        </main>
      )}

      <Footer />
    </>
  );
}

interface FallbackRendererProps {
  content?: TemplateContent;
}

function FallbackRenderer({ content }: FallbackRendererProps) {
  if (!content?.sections) return null;
  const sections = content.sections as TemplateSection[] | Record<string, TemplateSection>;

  if (Array.isArray(sections)) {
    return (
      <div className="cms-content">
        {sections.map((s, i) => (
          <div key={i} className="cms-section">
            {s.heading && <h2 className="cms-heading">{s.heading}</h2>}
            {s.body && <p className="cms-body">{s.body}</p>}
            {s.phone && <p className="cms-contact-row">Phone: {s.phone}</p>}
            {s.email && <p className="cms-contact-row">Email: {s.email}</p>}
            {s.address && <p className="cms-contact-row">Address: {s.address}</p>}
            {s.hours && <p className="cms-contact-row">Hours: {s.hours}</p>}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="cms-content">
      {Object.entries(sections).map(([key, fields]) => (
        <div key={key} className="cms-section">
          {fields.heading && <h2 className="cms-heading">{fields.heading}</h2>}
          {fields.subheading && <p className="cms-subheading">{fields.subheading}</p>}
          {fields.text && <p className="cms-body">{fields.text}</p>}
          {fields.phone && <p className="cms-contact-row">Phone: {fields.phone}</p>}
          {fields.email && <p className="cms-contact-row">Email: {fields.email}</p>}
          {fields.address && <p className="cms-contact-row">Address: {fields.address}</p>}
          {fields.hours && <p className="cms-contact-row">Hours: {fields.hours}</p>}
        </div>
      ))}
    </div>
  );
}

export async function getServerSideProps(ctx: GetServerSidePropsContext) {
  const { getStoreSlug } = await import('../lib/resolveStore');
  const storeSlug = getStoreSlug(ctx);
  const slugParam = ctx.params?.slug;
  const pageSlug = typeof slugParam === 'string' ? slugParam : Array.isArray(slugParam) ? slugParam[0] : '';

  if (['products', 'cart', 'checkout', 'order', 'api', '_next', 'account'].includes(pageSlug)) {
    return { notFound: true };
  }

  if (!storeSlug) return { props: { store: null, storeSlug: null, page: null } };

  try {
    const [store, page] = await Promise.all([
      getStoreInfo(storeSlug),
      getPage(storeSlug, pageSlug),
    ]);
    return { props: { store, storeSlug, page: page || null } };
  } catch {
    return { props: { store: null, storeSlug, page: null } };
  }
}
