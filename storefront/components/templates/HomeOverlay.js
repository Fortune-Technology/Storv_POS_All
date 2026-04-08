/**
 * Home Template 4: Full-Width Overlay
 * Full-width background image with bottom text overlay + gradient.
 */

import Link from 'next/link';
import ProductCard from '../products/ProductCard';

const ECOM_URL = process.env.NEXT_PUBLIC_ECOM_URL || 'http://localhost:5005';
const DEPT_ICONS = { beverages: '🥤', snacks: '🍿', 'dairy-frozen': '🧊', grocery: '🛒', 'health-beauty': '💊', household: '🏠', default: '📦' };

export default function HomeOverlay({ content, store, products = [], departments = [], storeSlug }) {
  const s = content?.sections || {};
  const hero = s.hero || {};
  const branding = store?.branding || {};
  const heroImg = hero.image ? (hero.image.startsWith('http') ? hero.image : `${ECOM_URL}${hero.image}`) : null;
  const sq = `store=${storeSlug}`;

  return (
    <>
      <section className="tpl-hero tpl-hero--overlay" style={heroImg ? { backgroundImage: `url(${heroImg})` } : {}}>
        <div className="tpl-overlay-gradient" />
        <div className="tpl-overlay-content sf-container">
          <span className="tpl-hero-badge">{hero.badge || 'Now Online'}</span>
          <h1 className="tpl-hero-title">{hero.heading || branding.logoText || store?.storeName}</h1>
          <p className="tpl-hero-desc">{hero.subheading || 'Order your favorites for pickup or delivery.'}</p>
          <div className="tpl-hero-actions">
            <Link href={hero.ctaLink || `/products?${sq}`} className="tpl-btn tpl-btn--primary">{hero.ctaText || 'Shop Now'}</Link>
            {hero.secondaryCta && <Link href={hero.secondaryCtaLink || `/about?${sq}`} className="tpl-btn tpl-btn--ghost">{hero.secondaryCta}</Link>}
          </div>
        </div>
      </section>

      <div className="sf-container">
        {departments.length > 0 && (
          <section className="tpl-section">
            <h2 className="tpl-section-title">{s.departments?.heading || 'Browse Categories'}</h2>
            <div className="tpl-dept-grid">
              {departments.map(d => (
                <Link key={d.slug} href={`/products?${sq}&department=${d.slug}`} className="tpl-dept-card">
                  <span className="tpl-dept-icon">{DEPT_ICONS[d.slug] || DEPT_ICONS.default}</span>
                  <span className="tpl-dept-name">{d.name}</span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {products.length > 0 && (
          <section className="tpl-section">
            <div className="tpl-section-header">
              <h2 className="tpl-section-title">{s.products?.heading || 'Featured Products'}</h2>
              <Link href={`/products?${sq}`} className="tpl-section-link">View All →</Link>
            </div>
            <div className="sf-product-grid">{products.map(p => <ProductCard key={p.id} product={p} />)}</div>
          </section>
        )}
      </div>
    </>
  );
}
