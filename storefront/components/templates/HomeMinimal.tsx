import Link from 'next/link';
import ProductCard from '../products/ProductCard';
import type { TemplateProps } from '../../lib/types';

export default function HomeMinimal({ content, store, products = [], departments = [], storeSlug }: TemplateProps) {
  const s = content?.sections || {};
  const sq = `store=${storeSlug}`;
  const branding = store?.branding || {};

  return (
    <div className="sf-container">
      <section className="tpl-hero tpl-hero--minimal">
        <h1 className="tpl-minimal-title">{s.hero?.heading || s.products?.heading || branding.logoText || store?.storeName}</h1>
        <p className="tpl-minimal-desc">{s.hero?.subheading || 'Everyday essentials, delivered.'}</p>
        <Link href={`/products?${sq}`} className="tpl-btn tpl-btn--primary tpl-btn--mt16">Browse All Products</Link>
      </section>
      {departments.length > 0 && (
        <div className="tpl-dept-pills">
          {departments.map(d => (<Link key={d.slug} href={`/products?${sq}&department=${d.slug}`} className="sf-dept-badge">{d.name}</Link>))}
        </div>
      )}
      {products.length > 0 && (
        <section className="tpl-section tpl-section--no-pt">
          <div className="sf-product-grid">{products.map(p => <ProductCard key={p.id} product={p} />)}</div>
          <div className="tpl-load-more-wrap"><Link href={`/products?${sq}`} className="tpl-btn tpl-btn--outline">Load More</Link></div>
        </section>
      )}
    </div>
  );
}
