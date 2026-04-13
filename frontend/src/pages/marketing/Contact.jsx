import React, { useState } from 'react';
import MarketingNavbar from '../../components/marketing/MarketingNavbar';
import MarketingFooter from '../../components/marketing/MarketingFooter';
import MarketingSection from '../../components/marketing/MarketingSection';
import MarketingButton from '../../components/marketing/MarketingButton';
import { Mail, Phone, MapPin, CheckCircle2, Clock, Globe, ShieldCheck } from 'lucide-react';
import SEO from '../../components/SEO';
import './Contact.css';

const Contact = () => {
  const [formData, setFormData] = useState({
    fullName: '',
    storeName: '',
    storeType: 'grocery',
    phone: '',
    email: '',
    city: '',
    terminals: '1-2',
    message: ''
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [errors, setErrors] = useState({});

  const validate = () => {
    const newErrors = {};
    if (!formData.fullName.trim()) newErrors.fullName = true;
    if (!formData.email.trim() || !/\S+@\S+\.\S+/.test(formData.email)) newErrors.email = true;
    if (!formData.storeName.trim()) newErrors.storeName = true;
    if (!formData.phone.trim()) newErrors.phone = true;
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!validate()) return;

    setIsSubmitting(true);
    
    // Simulate API call
    setTimeout(() => {
      setIsSubmitting(false);
      setIsSuccess(true);
    }, 1500);
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: false }));
    }
  };

  return (
    <div className="contact-page">
      <SEO
        title="Contact Us"
        description="Get in touch with the Storeveu team. We'd love to hear from you — questions, feedback, or partnership inquiries."
        url="https://storeveu.com/contact"
      />
      <MarketingNavbar />

      <section className="contact-hero">
        <div className="mkt-container">
          <div className="contact-grid">
            {/* Info Column */}
            <div className="contact-info-col">
              <h1 className="contact-title">Book a <span className="text-gradient">Personalized</span> Demo</h1>
              <p className="contact-subtitle">
                See StoreVeu running in stores just like yours. Our team — retail veterans themselves — will walk you through everything tailored to your business.
              </p>

              <div className="contact-method-list">
                <div className="method-item">
                  <div className="method-icon"><Clock size={24} /></div>
                  <div>
                    <h4>What happens next?</h4>
                    <p>Our team will reach out within 2 hours to finalize your demo time. We're real people, not bots.</p>
                  </div>
                </div>
                <div className="method-item">
                  <div className="method-icon"><ShieldCheck size={24} /></div>
                  <div>
                    <h4>No Commitment</h4>
                    <p>The demo is completely free. We just want to show you how much time you can save.</p>
                  </div>
                </div>
              </div>

              <div className="contact-direct">
                <div className="direct-item">
                  <Phone size={18} />
                  <span>+1 (800) 786-7383</span>
                </div>
                <div className="direct-item">
                  <Mail size={18} />
                  <span>demo@storeveu.com</span>
                </div>
                <div className="direct-item">
                  <MapPin size={18} />
                  <span>North America — Serving retailers coast to coast</span>
                </div>
              </div>
            </div>

            {/* Form Column */}
            <div className="contact-form-col">
              {!isSuccess ? (
                <div className="contact-card">
                  <form onSubmit={handleSubmit}>
                    <div className="form-row">
                      <div className="form-group">
                        <label>Full Name *</label>
                        <input 
                          type="text" 
                          name="fullName" 
                          value={formData.fullName} 
                          onChange={handleChange}
                          className={errors.fullName ? 'error' : ''}
                          placeholder="John Doe"
                        />
                      </div>
                      <div className="form-group">
                        <label>Store Name *</label>
                        <input 
                          type="text" 
                          name="storeName" 
                          value={formData.storeName} 
                          onChange={handleChange}
                          className={errors.storeName ? 'error' : ''}
                          placeholder="My Awesome Market"
                        />
                      </div>
                    </div>

                    <div className="form-row">
                      <div className="form-group">
                        <label>Store Type</label>
                        <select name="storeType" value={formData.storeType} onChange={handleChange}>
                          <option value="grocery">Grocery / Supermarket</option>
                          <option value="retail">General Retail</option>
                          <option value="liquor">Liquor & Wine</option>
                          <option value="meat">Meat & Food</option>
                          <option value="other">Other</option>
                        </select>
                      </div>
                      <div className="form-group">
                        <label>Number of Terminals</label>
                        <select name="terminals" value={formData.terminals} onChange={handleChange}>
                          <option value="1-2">1-2</option>
                          <option value="3-5">3-5</option>
                          <option value="5-10">5-10</option>
                          <option value="10+">10+</option>
                        </select>
                      </div>
                    </div>

                    <div className="form-row">
                      <div className="form-group">
                        <label>Email Address *</label>
                        <input 
                          type="email" 
                          name="email" 
                          value={formData.email} 
                          onChange={handleChange}
                          className={errors.email ? 'error' : ''}
                          placeholder="john@example.com"
                        />
                      </div>
                      <div className="form-group">
                        <label>Phone Number *</label>
                        <input 
                          type="tel" 
                          name="phone" 
                          value={formData.phone} 
                          onChange={handleChange}
                          className={errors.phone ? 'error' : ''}
                          placeholder="(555) 000-0000"
                        />
                      </div>
                    </div>

                    <div className="form-group">
                      <label>City</label>
                      <input 
                        type="text" 
                        name="city" 
                        value={formData.city} 
                        onChange={handleChange}
                        placeholder="New York, NY"
                      />
                    </div>

                    <div className="form-group">
                      <label>Message (Optional)</label>
                      <textarea 
                        name="message" 
                        value={formData.message} 
                        onChange={handleChange}
                        rows="4"
                        placeholder="Tell us about your specific needs..."
                      ></textarea>
                    </div>

                    <MarketingButton 
                      type="submit" 
                      className="w-full submit-btn" 
                      size="lg"
                      disabled={isSubmitting}
                    >
                      {isSubmitting ? 'Sending Request...' : 'Confirm Demo Request'}
                    </MarketingButton>
                    
                    <p className="form-footer">
                      <ShieldCheck size={14} /> By submitting, you agree to our privacy policy. No spam, ever.
                    </p>
                  </form>
                </div>
              ) : (
                <div className="success-card">
                  <div className="success-icon-container">
                    <div className="success-circle">
                      <CheckCircle2 size={120} strokeWidth={1.5} />
                    </div>
                  </div>
                  <h2>Request Received!</h2>
                  <p>Thank you, <strong>{formData.fullName.split(' ')[0]}</strong>. Our team will contact you at <strong>{formData.phone}</strong> shortly to finalize your demo time.</p>
                  <MarketingButton onClick={() => setIsSuccess(false)} variant="secondary">Send Another Request</MarketingButton>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Social Proof Row */}
      <section className="contact-proof">
        <div className="mkt-container">
          <div className="proof-grid">
            <div className="proof-item">
              <Globe size={24} />
              <span>Available Globally</span>
            </div>
            <div className="proof-item">
              <ShieldCheck size={24} />
              <span>ISO 27001 Certified</span>
            </div>
            <div className="proof-item">
              <Clock size={24} />
              <span>24/7 Expert Support</span>
            </div>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
};

export default Contact;
