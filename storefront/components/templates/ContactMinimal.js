/**
 * Contact Template 3: Minimal
 * Clean full-width form with floating card design.
 */

import { ContactForm } from './ContactSplit';

export default function ContactMinimal({ content, store, storeSlug }) {
  const s = content?.sections || {};
  const info = s.info || {};

  return (
    <div className="sf-container">
      <section className="tpl-contact-minimal">
        <div className="tpl-contact-minimal-card">
          <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 4 }}>Get in Touch</h1>
          <p style={{ color: 'var(--sf-text-muted)', marginBottom: 24 }}>We typically respond within a few hours.</p>
          <ContactForm storeSlug={storeSlug} />
          {(info.phone || info.email) && (
            <div className="tpl-contact-minimal-footer">
              {info.phone && <span>📞 {info.phone}</span>}
              {info.email && <span>✉️ {info.email}</span>}
              {info.address && <span>📍 {info.address}</span>}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
