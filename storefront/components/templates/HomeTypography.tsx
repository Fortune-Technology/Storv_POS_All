import Link from 'next/link';
import ProductCard from '../products/ProductCard';
import { TrustIcon } from '../icons';
import type { TemplateProps } from '../../lib/types';

export default function HomeTypography({ content, store, products = [], departments = [], storeSlug }: TemplateProps) {
  const s = content?.sections || {};
  const hero = s.hero || {};
  const sq = `store=${storeSlug}`;

  return (
    <>
      <section className="tpl-hero tpl-hero--typo">
        <div className="sf-container">
          <p className="tpl-typo-eyebrow">{hero.badge || store?.storeName}</p>
          <h1 className="tpl-typo-title">{hero.heading || 'Fresh. Local. Delivered.'}</h1>
          <p className="tpl-typo-desc">{hero.subheading || 'Your neighborhood store, now online.'}</p>
          <div className="tpl-hero-actions tpl-hero-actions--start">
            <Link href={hero.ctaLink || `/products?${sq}`} className="tpl-btn tpl-btn--primary tpl-btn--lg">{hero.ctaText || 'Start Shopping'}</Link>
            {hero.secondaryCta && <Link href={hero.secondaryCtaLink || `/about?${sq}`} className="tpl-btn tpl-btn--outline">{hero.secondaryCta}</Link>}
          </div>
        </div>
      </section>
      <div className="sf-container">
        {departments.length > 0 && (
          <section className="tpl-section"><div className="tpl-dept-pills tpl-dept-pills--start">{departments.map(d => (<Link key={d.slug} href={`/products?${sq}&department=${d.slug}`} className="sf-dept-badge">{d.name}</Link>))}</div></section>
        )}
        {products.length > 0 && (
          <section className="tpl-section">
            <div className="tpl-section-header"><h2 className="tpl-section-title">{s.products?.heading || 'Popular Right Now'}</h2><Link href={`/products?${sq}`} className="tpl-section-link">View All →</Link></div>
            <div className="sf-product-grid">{products.map(p => <ProductCard key={p.id} product={p} />)}</div>
          </section>
        )}
        <section className="tpl-trust">
          <div className="tpl-trust-grid">
            <div className="tpl-trust-item"><TrustIcon type="pickup" size={28} className="tpl-trust-lucide" /><h4>Free Pickup</h4><p>Order online, grab in store</p></div>
            <div className="tpl-trust-item"><TrustIcon type="delivery" size={28} className="tpl-trust-lucide" /><h4>Fast Delivery</h4><p>Same-day in your area</p></div>
            <div className="tpl-trust-item"><TrustIcon type="secure" size={28} className="tpl-trust-lucide" /><h4>Secure</h4><p>Your data stays safe</p></div>
            <div className="tpl-trust-item"><TrustIcon type="fresh" size={28} className="tpl-trust-lucide" /><h4>Always Fresh</h4><p>Quality guaranteed</p></div>
          </div>
        </section>
      </div>
    </>
  );
}
