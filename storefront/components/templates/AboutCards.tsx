/**
 * About Template 3: Card-Based Values
 * Clean heading + description, then values/features as cards.
 */

import type { TemplateProps } from '../../lib/types';

export default function AboutCards({ content }: TemplateProps) {
  const s = content?.sections || {};
  const main = s.content || s.about || s.story || {};

  return (
    <div className="sf-container">
      <section className="tpl-section tpl-section--centered">
        <h1 className="tpl-about-heading tpl-about-heading--lg">{main.heading || 'About Us'}</h1>
        {main.text && <p className="tpl-about-body tpl-about-body--centered">{main.text}</p>}
      </section>

      <section className="tpl-section">
        <div className="tpl-feature-grid">
          <div className="tpl-feature-card"><div className="tpl-feature-num">01</div><h3>Quality Products</h3><p>Carefully selected items from trusted suppliers.</p></div>
          <div className="tpl-feature-card"><div className="tpl-feature-num">02</div><h3>Fair Prices</h3><p>Competitive pricing without compromising on quality.</p></div>
          <div className="tpl-feature-card"><div className="tpl-feature-num">03</div><h3>Local Community</h3><p>Supporting our neighbors and local businesses.</p></div>
          <div className="tpl-feature-card"><div className="tpl-feature-num">04</div><h3>Convenience</h3><p>Shop online or in-store — whatever works for you.</p></div>
        </div>
      </section>
    </div>
  );
}
