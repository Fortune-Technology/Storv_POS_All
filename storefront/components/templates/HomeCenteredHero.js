/**
 * Home Template 1: Centered Hero
 */

import Link from 'next/link';
import ProductCard from '../products/ProductCard';
import { DeptIcon, TrustIcon } from '../icons';

const ECOM_URL = process.env.NEXT_PUBLIC_ECOM_URL || 'http://localhost:5005';

export default function HomeCenteredHero({ content, store, products = [], departments = [], storeSlug }) {
  const s = content?.sections || {};
  const hero = s.hero || s.banner || {};
  const branding = store?.branding || {};
  const heroImg = hero.image ? (hero.image.startsWith('http') ? hero.image : `${ECOM_URL}${hero.image}`) : null;
  const sq = `store=${storeSlug}`;

  return (
    <>
      <section className="tpl-hero tpl-hero--centered" style={heroImg ? { backgroundImage: `linear-gradient(rgba(0,0,0,0.45), rgba(0,0,0,0.55)), url(${heroImg})` } : {}}>
        <div className="tpl-hero-content">
          <h1 className="tpl-hero-title">{hero.heading || branding.logoText || store?.storeName || 'Welcome'}</h1>
          <p className="tpl-hero-desc">{hero.subheading || 'Fresh products, everyday essentials — order online for pickup or delivery.'}</p>
          <div className="tpl-hero-actions">
            <Link href={`/products?${sq}`} className="tpl-btn tpl-btn--primary">{hero.ctaText || 'Shop Now'}</Link>
            <Link href={`/about?${sq}`} className="tpl-btn tpl-btn--ghost">Learn More</Link>
          </div>
        </div>
      </section>

      <div className="sf-container">
        {departments.length > 0 && (
          <section className="tpl-section">
            <h2 className="tpl-section-title">{s.departments?.heading || 'Shop by Category'}</h2>
            <div className="tpl-dept-grid">
              {departments.map(d => (
                <Link key={d.slug} href={`/products?${sq}&department=${d.slug}`} className="tpl-dept-card">
                  <DeptIcon slug={d.slug} size={28} className="tpl-dept-lucide" />
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

        <section className="tpl-trust">
          <div className="tpl-trust-grid">
            <div className="tpl-trust-item"><TrustIcon type="pickup" size={28} className="tpl-trust-lucide" /><h4>Free Pickup</h4><p>Order online, grab in store</p></div>
            <div className="tpl-trust-item"><TrustIcon type="delivery" size={28} className="tpl-trust-lucide" /><h4>Fast Delivery</h4><p>Same-day in your area</p></div>
            <div className="tpl-trust-item"><TrustIcon type="secure" size={28} className="tpl-trust-lucide" /><h4>Secure Payment</h4><p>Your data stays safe</p></div>
            <div className="tpl-trust-item"><TrustIcon type="fresh" size={28} className="tpl-trust-lucide" /><h4>Always Fresh</h4><p>Quality guaranteed daily</p></div>
          </div>
        </section>
      </div>
    </>
  );
}
