import { ContactIcon } from '../icons';
import { ContactForm } from './ContactSplit';
import type { TemplateProps } from '../../lib/types';

export default function ContactCards({ content, storeSlug }: TemplateProps) {
  const s = content?.sections || {};
  const info = s.info || {};

  return (
    <div className="sf-container">
      <section className="tpl-section tpl-section--centered">
        <h1 className="tpl-about-heading tpl-about-heading--lg">Contact Us</h1>
        <p className="tpl-about-body tpl-about-body--contact">We're here to help. Reach out through any of the options below.</p>
      </section>
      <div className="tpl-contact-cards">
        {info.phone && <div className="tpl-contact-card"><ContactIcon type="phone" size={24} /><h4>Call Us</h4><p>{info.phone}</p></div>}
        {info.email && <div className="tpl-contact-card"><ContactIcon type="email" size={24} /><h4>Email Us</h4><p>{info.email}</p></div>}
        {info.address && <div className="tpl-contact-card"><ContactIcon type="address" size={24} /><h4>Visit Us</h4><p>{info.address}</p></div>}
        {info.hours && <div className="tpl-contact-card"><ContactIcon type="hours" size={24} /><h4>Hours</h4><p>{info.hours}</p></div>}
      </div>
      <div className="tpl-contact-form-centered"><ContactForm storeSlug={storeSlug} /></div>
    </div>
  );
}
