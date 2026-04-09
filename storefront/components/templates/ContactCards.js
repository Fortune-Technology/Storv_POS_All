import { ContactIcon } from '../icons';
import { ContactForm } from './ContactSplit';

export default function ContactCards({ content, store, storeSlug }) {
  const s = content?.sections || {};
  const info = s.info || {};

  return (
    <div className="sf-container">
      <section className="tpl-section" style={{ textAlign: 'center', paddingTop: 40 }}>
        <h1 className="tpl-about-heading" style={{ fontSize: 36 }}>Contact Us</h1>
        <p className="tpl-about-body" style={{ maxWidth: 500, margin: '8px auto 32px' }}>We're here to help. Reach out through any of the options below.</p>
      </section>
      <div className="tpl-contact-cards">
        {info.phone && <div className="tpl-contact-card"><ContactIcon type="phone" size={24} /><h4>Call Us</h4><p>{info.phone}</p></div>}
        {info.email && <div className="tpl-contact-card"><ContactIcon type="email" size={24} /><h4>Email Us</h4><p>{info.email}</p></div>}
        {info.address && <div className="tpl-contact-card"><ContactIcon type="address" size={24} /><h4>Visit Us</h4><p>{info.address}</p></div>}
        {info.hours && <div className="tpl-contact-card"><ContactIcon type="hours" size={24} /><h4>Hours</h4><p>{info.hours}</p></div>}
      </div>
      <div style={{ maxWidth: 600, margin: '0 auto', paddingBottom: 60 }}><ContactForm storeSlug={storeSlug} /></div>
    </div>
  );
}
