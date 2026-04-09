import { ContactIcon } from '../icons';
import { ContactForm } from './ContactSplit';

export default function ContactFloating({ content, store, storeSlug }) {
  const s = content?.sections || {};
  const info = s.info || {};

  return (
    <section className="tpl-contact-floating-bg">
      <div className="sf-container">
        <div className="tpl-contact-floating-card">
          <div className="tpl-contact-floating-header">
            <h1>Let's Talk</h1>
            <p>Have a question? Fill out the form and we'll get back to you shortly.</p>
          </div>
          <div className="tpl-contact-floating-body"><ContactForm storeSlug={storeSlug} /></div>
          {(info.phone || info.email || info.address) && (
            <div className="tpl-contact-floating-footer">
              {info.phone && <span><ContactIcon type="phone" size={14} /> {info.phone}</span>}
              {info.email && <span><ContactIcon type="email" size={14} /> {info.email}</span>}
              {info.address && <span><ContactIcon type="address" size={14} /> {info.address}</span>}
              {info.hours && <span><ContactIcon type="hours" size={14} /> {info.hours}</span>}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
