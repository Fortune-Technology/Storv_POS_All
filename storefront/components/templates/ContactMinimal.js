import { ContactIcon } from '../icons';
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
              {info.phone && <span><ContactIcon type="phone" size={14} /> {info.phone}</span>}
              {info.email && <span><ContactIcon type="email" size={14} /> {info.email}</span>}
              {info.address && <span><ContactIcon type="address" size={14} /> {info.address}</span>}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
