import { ContactIcon } from '../icons';
import { ContactForm } from './ContactSplit';
import type { TemplateProps } from '../../lib/types';

export default function ContactMinimal({ content, storeSlug }: TemplateProps) {
  const s = content?.sections || {};
  const info = s.info || {};

  return (
    <div className="sf-container">
      <section className="tpl-contact-minimal">
        <div className="tpl-contact-minimal-card">
          <h1 className="tpl-cm-title">Get in Touch</h1>
          <p className="tpl-cm-desc">We typically respond within a few hours.</p>
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
