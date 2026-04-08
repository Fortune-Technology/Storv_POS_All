/**
 * CMS page — renders About, Contact, and custom pages using the
 * template system. Falls back to raw section rendering for legacy content.
 */

import Head from 'next/head';
import Header from '../components/layout/Header';
import Footer from '../components/layout/Footer';
import CartDrawer from '../components/cart/CartDrawer';
import TemplateRenderer from '../components/templates/TemplateRenderer';
import { useCart } from '../lib/cart';
import { getStoreInfo, getPage } from '../lib/api';

export default function CmsPage({ store, storeSlug, page }) {
  const { storeSlug: sq } = useCart();

  if (!page) {
    return (
      <>
        <Header />
        <main className="sf-container">
          <div className="sf-empty" style={{ paddingTop: 60 }}>
            <div className="sf-empty-icon">📄</div>
            <h2>Page Not Found</h2>
          </div>
        </main>
        <Footer />
      </>
    );
  }

  return (
    <>
      <Head>
        <title>{page.seoTitle || page.title} — {store?.storeName || 'Store'}</title>
        {page.seoDescription && <meta name="description" content={page.seoDescription} />}
      </Head>
      <Header />
      <CartDrawer />

      {page.templateId ? (
        <TemplateRenderer
          templateId={page.templateId}
          pageType={page.pageType}
          content={page.content}
          store={store}
          storeSlug={storeSlug || sq}
        />
      ) : (
        <main className="sf-container">
          <div className="sf-page-header">
            <h1 className="sf-page-title">{page.title}</h1>
          </div>
          <FallbackRenderer content={page.content} />
        </main>
      )}

      <Footer />
    </>
  );
}

function FallbackRenderer({ content }) {
  if (!content?.sections) return null;
  const sections = content.sections;

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

export async function getServerSideProps(ctx) {
  const { getStoreSlug } = await import('../lib/resolveStore.js');
  const storeSlug = getStoreSlug(ctx);
  const pageSlug = ctx.params.slug;

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
