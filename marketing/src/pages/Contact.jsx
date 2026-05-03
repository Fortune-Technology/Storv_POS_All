import React, { useState, useRef } from 'react';
import { motion, useInView } from 'framer-motion';
import MarketingNavbar from '../components/marketing/MarketingNavbar';
import MarketingFooter from '../components/marketing/MarketingFooter';
import MarketingButton from '../components/marketing/MarketingButton';
import { Mail, Phone, MapPin, CheckCircle2, Clock, ShieldCheck, Star, ArrowRight } from 'lucide-react';
import SEO from '../components/SEO';
import './Contact.css';

const FadeIn = ({ children, className, delay = 0 }) => {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: '-60px' });
  return (
    <motion.div ref={ref} className={className} initial={{ opacity: 0, y: 28 }} animate={inView ? { opacity: 1, y: 0 } : {}} transition={{ duration: 0.5, delay, ease: [0.25, 0.1, 0.25, 1] }}>
      {children}
    </motion.div>
  );
};

const Contact = () => {
  const [formData, setFormData] = useState({
    fullName: '', storeName: '', storeType: 'grocery', phone: '', email: '', city: '', terminals: '1-2', message: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [errors, setErrors] = useState({});

  const validate = () => {
    const e = {};
    if (!formData.fullName.trim()) e.fullName = true;
    if (!formData.email.trim() || !/\S+@\S+\.\S+/.test(formData.email)) e.email = true;
    if (!formData.storeName.trim()) e.storeName = true;
    if (!formData.phone.trim()) e.phone = true;
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = (ev) => {
    ev.preventDefault();
    if (!validate()) return;
    setIsSubmitting(true);
    setTimeout(() => { setIsSubmitting(false); setIsSuccess(true); }, 1500);
  };

  const handleChange = (ev) => {
    const { name, value } = ev.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors(prev => ({ ...prev, [name]: false }));
  };

  return (
    <div className="contact-page">
      <SEO title="Contact Us" description="Book a personalized Storeveu demo for your store." url="https://storeveu.com/contact" />
      <MarketingNavbar />

      <section className="ct-hero">
        <div className="ct-hero-bg" />
        <div className="mkt-container">
          <div className="ct-grid">
            {/* ── Info column ── */}
            <FadeIn className="ct-info">
              <h1>Book a{' '}<span className="ct-gradient">Personalized</span> Demo</h1>
              <p className="ct-subtitle">
                See Storeveu running in stores just like yours. Our team — retail veterans — will walk you through everything tailored to your business.
              </p>

              <div className="ct-cards">
                <div className="ct-card">
                  <div className="ct-card-icon"><Clock size={20} /></div>
                  <div>
                    <h4>What happens next?</h4>
                    <p>We'll reach out within 2 hours to finalize your demo time.</p>
                  </div>
                </div>
                <div className="ct-card">
                  <div className="ct-card-icon"><ShieldCheck size={20} /></div>
                  <div>
                    <h4>No Commitment</h4>
                    <p>The demo is completely free. We just want to show you how much time you can save.</p>
                  </div>
                </div>
              </div>

              <div className="ct-direct">
                <div className="ct-direct-item"><Phone size={16} /><span>+1 (800) 786-7383</span></div>
                <div className="ct-direct-item"><Mail size={16} /><span>demo@storeveu.com</span></div>
                <div className="ct-direct-item"><MapPin size={16} /><span>North America — coast to coast</span></div>
              </div>

              {/* Testimonial mini-quote */}
              <div className="ct-testimonial">
                <div className="ct-testimonial-stars">
                  {[...Array(5)].map((_, i) => <Star key={i} size={14} fill="var(--color-star)" color="var(--color-star)" />)}
                </div>
                <p>"We replaced three systems with Storeveu. Our cashiers were trained in a day."</p>
                <span className="ct-testimonial-author">— David P., Grocery Owner</span>
              </div>
            </FadeIn>

            {/* ── Form column ── */}
            <FadeIn className="ct-form-col" delay={0.1}>
              {!isSuccess ? (
                <div className="ct-form-card">
                  <form onSubmit={handleSubmit}>
                    <div className="ct-row">
                      <div className="ct-field">
                        <label>Full Name *</label>
                        <input type="text" name="fullName" value={formData.fullName} onChange={handleChange} className={errors.fullName ? 'ct-error' : ''} placeholder="John Doe" />
                      </div>
                      <div className="ct-field">
                        <label>Store Name *</label>
                        <input type="text" name="storeName" value={formData.storeName} onChange={handleChange} className={errors.storeName ? 'ct-error' : ''} placeholder="My Awesome Market" />
                      </div>
                    </div>

                    <div className="ct-row">
                      <div className="ct-field">
                        <label>Store Type</label>
                        <select name="storeType" value={formData.storeType} onChange={handleChange}>
                          <option value="grocery">Grocery / Supermarket</option>
                          <option value="retail">General Retail</option>
                          <option value="liquor">Liquor & Wine</option>
                          <option value="meat">Meat & Food</option>
                          <option value="other">Other</option>
                        </select>
                      </div>
                      <div className="ct-field">
                        <label>Terminals</label>
                        <select name="terminals" value={formData.terminals} onChange={handleChange}>
                          <option value="1-2">1-2</option>
                          <option value="3-5">3-5</option>
                          <option value="5-10">5-10</option>
                          <option value="10+">10+</option>
                        </select>
                      </div>
                    </div>

                    <div className="ct-row">
                      <div className="ct-field">
                        <label>Email *</label>
                        <input type="email" name="email" value={formData.email} onChange={handleChange} className={errors.email ? 'ct-error' : ''} placeholder="john@example.com" />
                      </div>
                      <div className="ct-field">
                        <label>Phone *</label>
                        <input type="tel" name="phone" value={formData.phone} onChange={handleChange} className={errors.phone ? 'ct-error' : ''} placeholder="(555) 000-0000" />
                      </div>
                    </div>

                    <div className="ct-field">
                      <label>City</label>
                      <input type="text" name="city" value={formData.city} onChange={handleChange} placeholder="New York, NY" />
                    </div>

                    <div className="ct-field">
                      <label>Message (Optional)</label>
                      <textarea name="message" value={formData.message} onChange={handleChange} rows="3" placeholder="Tell us about your specific needs..." />
                    </div>

                    <MarketingButton type="submit" className="ct-submit" size="lg" icon={ArrowRight} disabled={isSubmitting}>
                      {isSubmitting ? 'Sending...' : 'Request Demo'}
                    </MarketingButton>

                    <p className="ct-form-footer">
                      <ShieldCheck size={13} /> By submitting, you agree to our privacy policy. No spam, ever.
                    </p>
                  </form>
                </div>
              ) : (
                <div className="ct-success">
                  <div className="ct-success-icon"><CheckCircle2 size={80} strokeWidth={1.2} /></div>
                  <h2>Request Received!</h2>
                  <p>Thanks, <strong>{formData.fullName.split(' ')[0]}</strong>. We'll contact you at <strong>{formData.phone}</strong> shortly.</p>
                  <MarketingButton onClick={() => setIsSuccess(false)} variant="secondary">Send Another</MarketingButton>
                </div>
              )}
            </FadeIn>
          </div>
        </div>
      </section>

      {/* ═══ Trust strip ═══ */}
      <div className="ct-trust">
        <div className="mkt-container">
          <div className="ct-trust-row">
            <span><ShieldCheck size={18} /> 14-Day Free Trial</span>
            <span><ShieldCheck size={18} /> No Credit Card Required</span>
            <span><ShieldCheck size={18} /> Cancel Anytime</span>
          </div>
        </div>
      </div>

      <MarketingFooter />
    </div>
  );
};

export default Contact;
