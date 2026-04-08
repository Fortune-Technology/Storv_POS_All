/**
 * Contact Template 1: Split Layout
 * Contact info left, form right.
 */

import { useState } from 'react';
import axios from 'axios';

const ECOM_API = process.env.NEXT_PUBLIC_ECOM_API_URL || 'http://localhost:5005/api';

export default function ContactSplit({ content, store, storeSlug }) {
  const s = content?.sections || {};
  const info = s.info || {};
  const hours = s.hours || {};

  return (
    <div className="sf-container">
      <section className="tpl-contact-split">
        <div className="tpl-contact-info">
          <h2 className="tpl-contact-heading">Get in Touch</h2>
          <p className="tpl-contact-desc">We'd love to hear from you. Reach out anytime.</p>

          <div className="tpl-contact-details">
            {info.phone && <div className="tpl-contact-item"><div className="tpl-contact-item-icon">📞</div><div><div className="tpl-contact-item-label">Phone</div><div className="tpl-contact-item-value">{info.phone}</div></div></div>}
            {info.email && <div className="tpl-contact-item"><div className="tpl-contact-item-icon">✉️</div><div><div className="tpl-contact-item-label">Email</div><div className="tpl-contact-item-value">{info.email}</div></div></div>}
            {info.address && <div className="tpl-contact-item"><div className="tpl-contact-item-icon">📍</div><div><div className="tpl-contact-item-label">Address</div><div className="tpl-contact-item-value">{info.address}</div></div></div>}
            {(hours.hours || info.hours) && <div className="tpl-contact-item"><div className="tpl-contact-item-icon">🕐</div><div><div className="tpl-contact-item-label">Hours</div><div className="tpl-contact-item-value">{hours.hours || info.hours}</div></div></div>}
          </div>
        </div>

        <ContactForm storeSlug={storeSlug} />
      </section>
    </div>
  );
}

function ContactForm({ storeSlug }) {
  const [form, setForm] = useState({ name: '', email: '', phone: '', message: '' });
  const [status, setStatus] = useState(null); // null | 'sending' | 'sent' | 'error'
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name || !form.email || !form.message) return;
    setStatus('sending');
    try {
      await axios.post(`${ECOM_API}/store/${storeSlug}/contact`, form);
      setStatus('sent');
      setForm({ name: '', email: '', phone: '', message: '' });
    } catch {
      setStatus('error');
    }
  };

  if (status === 'sent') {
    return (
      <div className="tpl-contact-form-wrap">
        <div className="tpl-contact-success">
          <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
          <h3>Message Sent!</h3>
          <p>We'll get back to you as soon as possible.</p>
          <button className="tpl-btn tpl-btn--outline" onClick={() => setStatus(null)} style={{ marginTop: 16 }}>Send Another</button>
        </div>
      </div>
    );
  }

  return (
    <div className="tpl-contact-form-wrap">
      <h3 className="tpl-contact-form-title">Send us a message</h3>
      {status === 'error' && <div className="tpl-contact-error">Something went wrong. Please try again.</div>}
      <form onSubmit={handleSubmit}>
        <div className="tpl-form-row">
          <div className="tpl-form-field"><label className="tpl-form-label">Name *</label><input className="tpl-form-input" value={form.name} onChange={set('name')} required /></div>
          <div className="tpl-form-field"><label className="tpl-form-label">Email *</label><input className="tpl-form-input" type="email" value={form.email} onChange={set('email')} required /></div>
        </div>
        <div className="tpl-form-field"><label className="tpl-form-label">Phone</label><input className="tpl-form-input" type="tel" value={form.phone} onChange={set('phone')} /></div>
        <div className="tpl-form-field"><label className="tpl-form-label">Message *</label><textarea className="tpl-form-input tpl-form-textarea" value={form.message} onChange={set('message')} rows={4} required /></div>
        <button className="tpl-btn tpl-btn--primary tpl-btn--full" type="submit" disabled={status === 'sending'}>
          {status === 'sending' ? 'Sending...' : 'Send Message'}
        </button>
      </form>
    </div>
  );
}

export { ContactForm };
