/**
 * Home Template 2: Split Hero
 * Left text + right image side-by-side hero,
 * followed by departments + products.
 */

import Link from 'next/link';
import ProductCard from '../products/ProductCard';

const ECOM_URL = process.env.NEXT_PUBLIC_ECOM_URL || 'http://localhost:5005';
const DEPT_ICONS = { beverages: '🥤', snacks: '🍿', 'dairy-frozen': '🧊', grocery: '🛒', 'health-beauty': '💊', household: '🏠', default: '📦' };

export default function HomeSplitHero({ content, store, products = [], departments = [], storeSlug }) {
  const s = content?.sections || {};
  const hero = s.hero || s.split || s.banner || {};
  const branding = store?.branding || {};
  const heroImg = hero.image ? (hero.image.startsWith('http') ? hero.image : `${ECOM_URL}${hero.image}`) : null;
  const sq = `store=${storeSlug}`;

  return (
    <>
      <section className="tpl-hero tpl-hero--split">
        <div className="sf-container">
          <div className="tpl-split-inner">
            <div className="tpl-split-text">
              <span className="tpl-hero-badge">Shop Online</span>
              <h1 className="tpl-hero-title">{hero.heading || branding.logoText || store?.storeName}</h1>
              <p className="tpl-hero-desc">{hero.subheading || hero.text || 'Your neighborhood store, now online.'}</p>
              <div className="tpl-hero-actions">
                <Link href={`/products?${sq}`} className="tpl-btn tpl-btn--primary">Shop Now</Link>
                <Link href={`/about?${sq}`} className="tpl-btn tpl-btn--outline">About Us</Link>
              </div>
            </div>
            <div className="tpl-split-image">
              {heroImg ? (
                <img src={heroImg} alt="" className="tpl-split-img" />
              ) : (
                <div className="tpl-split-placeholder">🛍️</div>
              )}
            </div>
          </div>
        </div>
      </section>

      <div className="sf-container">
        {departments.length > 0 && (
          <section className="tpl-section">
            <h2 className="tpl-section-title">Categories</h2>
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
              <h2 className="tpl-section-title">{s.products?.heading || s.featured?.heading || 'Popular Items'}</h2>
              <Link href={`/products?${sq}`} className="tpl-section-link">View All →</Link>
            </div>
            <div className="sf-product-grid">{products.map(p => <ProductCard key={p.id} product={p} />)}</div>
          </section>
        )}
      </div>
    </>
  );
}
