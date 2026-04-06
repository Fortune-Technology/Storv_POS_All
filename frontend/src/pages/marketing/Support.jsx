import React, { useState } from 'react';
import MarketingNavbar from '../../components/marketing/MarketingNavbar';
import MarketingFooter from '../../components/marketing/MarketingFooter';
import { Send, CheckCircle2, Loader2, HelpCircle, Clock, Mail } from 'lucide-react';
import { toast } from 'react-toastify';
import axios from 'axios';

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
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#fff' }}>
      <MarketingNavbar />
      <style>{supportStyles}</style>

      {/* Hero */}
      <section style={styles.hero}>
        <div style={styles.heroInner}>
          <h1 style={styles.heroTitle}>
            Get <span style={{ color: '#3d56b5' }}>Help</span>
          </h1>
          <p style={styles.heroSubtitle}>
            Have a question or running into an issue? Submit a support ticket and our
            team will get back to you as soon as possible.
          </p>
        </div>
      </section>

      {/* Form Section */}
      <section style={styles.section}>
        <div style={styles.container}>
          {submitted ? (
            <div style={styles.successCard}>
              <CheckCircle2 size={56} color="#3d56b5" />
              <h2 style={styles.successTitle}>Ticket Submitted</h2>
              <p style={styles.successText}>
                Thank you for reaching out. We have received your support request and
                will get back to you within 24 hours.
              </p>
              <button
                style={styles.newTicketBtn}
                className="support-btn"
                onClick={() => setSubmitted(false)}
              >
                Submit Another Ticket
              </button>
            </div>
          ) : (
            <div style={styles.formCard}>
              <div style={styles.infoBar}>
                <div style={styles.infoItem}>
                  <Clock size={18} color="#3d56b5" />
                  <span>We'll get back to you within 24 hours</span>
                </div>
                <div style={styles.infoItem}>
                  <Mail size={18} color="#3d56b5" />
                  <span>Or email us at support@storeveu.com</span>
                </div>
              </div>

              <form onSubmit={handleSubmit} style={styles.form}>
                <div style={styles.fieldGroup}>
                  <label style={styles.label}>Name</label>
                  <input
                    type="text"
                    name="name"
                    value={form.name}
                    onChange={handleChange}
                    style={styles.input}
                    placeholder="Your name"
                  />
                </div>

                <div style={styles.fieldGroup}>
                  <label style={styles.label}>
                    Email <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <input
                    type="email"
                    name="email"
                    value={form.email}
                    onChange={handleChange}
                    style={{
                      ...styles.input,
                      borderColor: errors.email ? '#ef4444' : '#d1d5db',
                    }}
                    placeholder="you@example.com"
                  />
                  {errors.email && <span style={styles.errorText}>{errors.email}</span>}
                </div>

                <div style={styles.fieldGroup}>
                  <label style={styles.label}>
                    Subject <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <input
                    type="text"
                    name="subject"
                    value={form.subject}
                    onChange={handleChange}
                    style={{
                      ...styles.input,
                      borderColor: errors.subject ? '#ef4444' : '#d1d5db',
                    }}
                    placeholder="Brief description of your issue"
                  />
                  {errors.subject && <span style={styles.errorText}>{errors.subject}</span>}
                </div>

                <div style={styles.fieldGroup}>
                  <label style={styles.label}>
                    Message <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <textarea
                    name="message"
                    value={form.message}
                    onChange={handleChange}
                    style={{
                      ...styles.input,
                      minHeight: 140,
                      resize: 'vertical',
                      borderColor: errors.message ? '#ef4444' : '#d1d5db',
                    }}
                    placeholder="Describe your issue or question in detail..."
                  />
                  {errors.message && <span style={styles.errorText}>{errors.message}</span>}
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  style={{
                    ...styles.submitBtn,
                    opacity: submitting ? 0.7 : 1,
                    cursor: submitting ? 'not-allowed' : 'pointer',
                  }}
                  className="support-btn"
                >
                  {submitting ? (
                    <>
                      <Loader2 size={18} style={{ animation: 'supportSpin 0.8s linear infinite' }} />
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

const styles = {
  hero: {
    background: 'linear-gradient(135deg, #eef2ff 0%, #e8eaf6 50%, #f0f9ff 100%)',
    padding: '120px 24px 80px',
    textAlign: 'center',
  },
  heroInner: {
    maxWidth: 600,
    margin: '0 auto',
  },
  heroTitle: {
    fontSize: '3rem',
    fontWeight: 800,
    color: '#111827',
    marginBottom: 20,
    lineHeight: 1.1,
  },
  heroSubtitle: {
    fontSize: '1.2rem',
    color: '#4b5563',
    lineHeight: 1.7,
  },
  section: {
    padding: '60px 24px 100px',
  },
  container: {
    maxWidth: 600,
    margin: '0 auto',
  },
  formCard: {
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: 16,
    padding: 32,
    boxShadow: '0 4px 20px rgba(0,0,0,0.04)',
  },
  infoBar: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    marginBottom: 28,
    padding: '16px 20px',
    background: '#f9fafb',
    borderRadius: 10,
  },
  infoItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    fontSize: '0.9rem',
    color: '#4b5563',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
  },
  fieldGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  label: {
    fontSize: '0.9rem',
    fontWeight: 600,
    color: '#374151',
  },
  input: {
    padding: '11px 14px',
    border: '1px solid #d1d5db',
    borderRadius: 8,
    fontSize: '0.95rem',
    color: '#111827',
    outline: 'none',
    transition: 'border-color 0.2s',
    fontFamily: 'inherit',
  },
  errorText: {
    fontSize: '0.8rem',
    color: '#ef4444',
  },
  submitBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: '13px 28px',
    background: '#3d56b5',
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    fontSize: '1rem',
    fontWeight: 600,
    marginTop: 4,
    transition: 'background 0.2s',
  },
  successCard: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: 16,
    padding: '60px 32px',
    boxShadow: '0 4px 20px rgba(0,0,0,0.04)',
  },
  successTitle: {
    fontSize: '1.6rem',
    fontWeight: 700,
    color: '#111827',
    marginTop: 20,
    marginBottom: 12,
  },
  successText: {
    fontSize: '1.05rem',
    color: '#4b5563',
    lineHeight: 1.7,
    maxWidth: 420,
    marginBottom: 28,
  },
  newTicketBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '12px 24px',
    background: '#3d56b5',
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    fontSize: '0.95rem',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'background 0.2s',
  },
};

const supportStyles = `
  @keyframes supportSpin {
    to { transform: rotate(360deg); }
  }

  .support-btn:hover {
    background: #3452a0 !important;
  }
`;

export default Support;
