import { ContactIcon } from '../icons';
import { ContactForm } from './ContactSplit';
import { MapPin } from 'lucide-react';

export default function ContactMapForm({ content, store, storeSlug }) {
  const s = content?.sections || {};
  const info = s.info || {};
  const hours = s.hours || {};

  return (
    <div className="sf-container">
      <section className="tpl-map-area">
        <div className="tpl-map-placeholder">
          <MapPin size={48} strokeWidth={1.5} style={{ marginBottom: 8, opacity: 0.5 }} />
          <p style={{ fontWeight: 600 }}>{info.address || 'Our Location'}</p>
          <p style={{ fontSize: 13, color: 'var(--sf-text-muted)', marginTop: 4 }}>Map integration coming soon</p>
        </div>
      </section>
      <section className="tpl-contact-split" style={{ paddingTop: 32 }}>
        <div className="tpl-contact-info">
          <h2 className="tpl-contact-heading">Visit Us</h2>
          <div className="tpl-contact-details">
            {info.address && <div className="tpl-contact-item"><ContactIcon type="address" /><div><div className="tpl-contact-item-label">Address</div><div className="tpl-contact-item-value">{info.address}</div></div></div>}
            {info.phone && <div className="tpl-contact-item"><ContactIcon type="phone" /><div><div className="tpl-contact-item-label">Phone</div><div className="tpl-contact-item-value">{info.phone}</div></div></div>}
            {info.email && <div className="tpl-contact-item"><ContactIcon type="email" /><div><div className="tpl-contact-item-label">Email</div><div className="tpl-contact-item-value">{info.email}</div></div></div>}
            {(hours.hours || info.hours) && <div className="tpl-contact-item"><ContactIcon type="hours" /><div><div className="tpl-contact-item-label">Hours</div><div className="tpl-contact-item-value">{hours.hours || info.hours}</div></div></div>}
          </div>
        </div>
        <ContactForm storeSlug={storeSlug} />
      </section>
    </div>
  );
}
