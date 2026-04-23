import { ContactIcon } from '../icons';
import { ContactForm } from './ContactSplit';
import { MapPin } from 'lucide-react';
import type { TemplateProps } from '../../lib/types';

export default function ContactMapForm({ content, storeSlug }: TemplateProps) {
  const s = content?.sections || {};
  const info = s.info || {};
  const hours = s.hours || {};

  return (
    <div className="sf-container">
      <section className="tpl-map-area">
        <div className="tpl-map-placeholder">
          <MapPin size={48} strokeWidth={1.5} className="tpl-map-icon-faded" />
          <p className="tpl-map-label">{info.address || 'Our Location'}</p>
          <p className="tpl-map-sublabel">Map integration coming soon</p>
        </div>
      </section>
      <section className="tpl-contact-split tpl-contact-split--tight">
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
