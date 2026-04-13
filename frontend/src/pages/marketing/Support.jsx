import React, { useState } from 'react';
import MarketingNavbar from '../../components/marketing/MarketingNavbar';
import MarketingFooter from '../../components/marketing/MarketingFooter';
import { Send, CheckCircle2, Loader2, HelpCircle, Clock, Mail } from 'lucide-react';
import { toast } from 'react-toastify';
import axios from 'axios';
import SEO from '../../components/SEO';
import './Support.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

const Support = () => {
  const [form, setForm] = useState({
    name: '',
    email: '',
    subject: '',
    message: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [errors, setErrors] = useState({});

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: false }));
  };

  const validate = () => {
    const errs = {};
    if (!form.email.trim() || !/\S+@\S+\.\S+/.test(form.email)) errs.email = 'Valid email is required';
    if (!form.subject.trim()) errs.subject = 'Subject is required';
    if (!form.message.trim()) errs.message = 'Message is required';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;

    setSubmitting(true);
    try {
      await axios.post(`${API_URL}/public/tickets`, {
        name: form.name,
        email: form.email,
        subject: form.subject,
        message: form.message,
      });
      setSubmitted(true);
      setForm({ name: '', email: '', subject: '', message: '' });
    } catch (err) {
      const msg = err.response?.data?.message || err.response?.data?.error;
      toast.error(msg || 'Failed to submit ticket. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="msup-page">
      <SEO
        title="Support"
        description="Need help? Contact Storeveu support. We're here to help you get the most out of your POS platform."
        url="https://storeveu.com/support"
      />
      <MarketingNavbar />

      {/* Hero */}
      <section className="msup-hero">
        <div className="msup-hero-inner">
          <h1 className="msup-hero-title">
            Get <span className="msup-hero-accent">Help</span>
          </h1>
          <p className="msup-hero-subtitle">
            Have a question or running into an issue? Submit a support ticket and our
            team will get back to you as soon as possible.
          </p>
        </div>
      </section>

      {/* Form Section */}
      <section className="msup-section">
        <div className="msup-container">
          {submitted ? (
            <div className="msup-success-card">
              <CheckCircle2 size={56} color="#3d56b5" />
              <h2 className="msup-success-title">Ticket Submitted</h2>
              <p className="msup-success-text">
                Thank you for reaching out. We have received your support request and
                will get back to you within 24 hours.
              </p>
              <button
                className="msup-new-ticket-btn"
                onClick={() => setSubmitted(false)}
              >
                Submit Another Ticket
              </button>
            </div>
          ) : (
            <div className="msup-form-card">
              <div className="msup-info-bar">
                <div className="msup-info-item">
                  <Clock size={18} color="#3d56b5" />
                  <span>We'll get back to you within 24 hours</span>
                </div>
                <div className="msup-info-item">
                  <Mail size={18} color="#3d56b5" />
                  <span>Or email us at support@storeveu.com</span>
                </div>
              </div>

              <form onSubmit={handleSubmit} className="msup-form">
                <div className="msup-field-group">
                  <label className="msup-label">Name</label>
                  <input
                    type="text"
                    name="name"
                    value={form.name}
                    onChange={handleChange}
                    className="msup-input"
                    placeholder="Your name"
                  />
                </div>

                <div className="msup-field-group">
                  <label className="msup-label">
                    Email <span className="msup-required">*</span>
                  </label>
                  <input
                    type="email"
                    name="email"
                    value={form.email}
                    onChange={handleChange}
                    className={`msup-input ${errors.email ? 'msup-input--error' : ''}`}
                    placeholder="you@example.com"
                  />
                  {errors.email && <span className="msup-error-text">{errors.email}</span>}
                </div>

                <div className="msup-field-group">
                  <label className="msup-label">
                    Subject <span className="msup-required">*</span>
                  </label>
                  <input
                    type="text"
                    name="subject"
                    value={form.subject}
                    onChange={handleChange}
                    className={`msup-input ${errors.subject ? 'msup-input--error' : ''}`}
                    placeholder="Brief description of your issue"
                  />
                  {errors.subject && <span className="msup-error-text">{errors.subject}</span>}
                </div>

                <div className="msup-field-group">
                  <label className="msup-label">
                    Message <span className="msup-required">*</span>
                  </label>
                  <textarea
                    name="message"
                    value={form.message}
                    onChange={handleChange}
                    className={`msup-input msup-textarea ${errors.message ? 'msup-input--error' : ''}`}
                    placeholder="Describe your issue or question in detail..."
                  />
                  {errors.message && <span className="msup-error-text">{errors.message}</span>}
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className={`msup-submit-btn ${submitting ? 'msup-submit-btn--submitting' : ''}`}
                >
                  {submitting ? (
                    <>
                      <Loader2 size={18} className="msup-spinner" />
                      Submitting...
                    </>
                  ) : (
                    <>
                      <Send size={18} />
                      Submit Ticket
                    </>
                  )}
                </button>
              </form>
            </div>
          )}
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
};

export default Support;
