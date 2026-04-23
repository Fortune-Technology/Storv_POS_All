/**
 * Contact Template 1: Split Layout — Contact info left, form right.
 */

import { useState, FormEvent, ChangeEvent } from 'react';
import axios from 'axios';
import { ContactIcon } from '../icons';
import type { TemplateProps } from '../../lib/types';

const ECOM_API = process.env.NEXT_PUBLIC_ECOM_API_URL || 'http://localhost:5005/api';

export default function ContactSplit({ content, storeSlug }: TemplateProps) {
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
            {info.phone && <div className="tpl-contact-item"><ContactIcon type="phone" /><div><div className="tpl-contact-item-label">Phone</div><div className="tpl-contact-item-value">{info.phone}</div></div></div>}
            {info.email && <div className="tpl-contact-item"><ContactIcon type="email" /><div><div className="tpl-contact-item-label">Email</div><div className="tpl-contact-item-value">{info.email}</div></div></div>}
            {info.address && <div className="tpl-contact-item"><ContactIcon type="address" /><div><div className="tpl-contact-item-label">Address</div><div className="tpl-contact-item-value">{info.address}</div></div></div>}
            {(hours.hours || info.hours) && <div className="tpl-contact-item"><ContactIcon type="hours" /><div><div className="tpl-contact-item-label">Hours</div><div className="tpl-contact-item-value">{hours.hours || info.hours}</div></div></div>}
          </div>
        </div>
        <ContactForm storeSlug={storeSlug} />
      </section>
    </div>
  );
}

interface ContactFormProps {
  storeSlug: string;
}

interface ContactFormState {
  name: string;
  email: string;
  phone: string;
  message: string;
}

type ContactFormStatus = 'sending' | 'sent' | 'error' | null;

function ContactForm({ storeSlug }: ContactFormProps) {
  const [form, setForm] = useState<ContactFormState>({ name: '', email: '', phone: '', message: '' });
  const [status, setStatus] = useState<ContactFormStatus>(null);
  const set = (k: keyof ContactFormState) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
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
          <div className="tpl-contact-success-icon">✓</div>
          <h3>Message Sent!</h3>
          <p>We'll get back to you as soon as possible.</p>
          <button className="tpl-btn tpl-btn--outline tpl-btn--mt16" onClick={() => setStatus(null)}>Send Another</button>
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
