import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import MarketingNavbar from '../../components/marketing/MarketingNavbar';
import MarketingFooter from '../../components/marketing/MarketingFooter';
import { ArrowLeft, MapPin, Clock, Building2, Briefcase, Upload, CheckCircle2, Loader2, X } from 'lucide-react';
import { toast } from 'react-toastify';
import axios from 'axios';
import './CareerDetail.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

const CareerDetail = () => {
  const { id } = useParams();
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [showApply, setShowApply] = useState(false);

  useEffect(() => {
    axios.get(`${API_URL}/public/careers/${id}`)
      .then(res => {
        const data = res.data?.data ?? res.data;
        if (!data) { setNotFound(true); return; }
        setJob(data);
        document.title = `${data.title} — StoreVeu Careers`;
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
    return () => { document.title = 'StoreVeu'; };
  }, [id]);

  const formatDate = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '';

  if (loading) return (
    <div className="cd-page">
      <MarketingNavbar />
      <div className="cd-center"><div className="cd-spinner" /></div>
    </div>
  );

  if (notFound) return (
    <div className="cd-page">
      <MarketingNavbar />
      <div className="cd-center">
        <Briefcase size={56} color="#d1d5db" />
        <h2 style={{ color: '#374151', marginTop: 16 }}>Job Not Found</h2>
        <p style={{ color: '#6b7280', marginTop: 8 }}>This position may have been filled or removed.</p>
        <Link to="/careers" className="cd-back-link" style={{ marginTop: 20 }}><ArrowLeft size={16} /> Back to All Jobs</Link>
      </div>
      <MarketingFooter />
    </div>
  );

  return (
    <div className="cd-page">
      <MarketingNavbar />

      {/* Hero Header */}
      <section className="cd-hero">
        <div className="cd-hero-inner">
          <Link to="/careers" className="cd-back-link"><ArrowLeft size={16} /> All Open Positions</Link>
          <h1 className="cd-title">{job.title}</h1>
          <div className="cd-badges">
            {job.department && <span className="cd-badge-dept"><Building2 size={14} /> {job.department}</span>}
            {job.type && <span className="cd-badge-type">{job.type}</span>}
          </div>
          <div className="cd-meta">
            {job.location && <span className="cd-meta-item"><MapPin size={15} /> {job.location}</span>}
            <span className="cd-meta-item"><Clock size={15} /> Posted {formatDate(job.createdAt)}</span>
          </div>
        </div>
      </section>

      {/* Content + Apply Sidebar */}
      <section className="cd-body">
        <div className="cd-layout">
          <div>
            <div className="cd-content" dangerouslySetInnerHTML={{ __html: job.description }} />
          </div>
          <div className="cd-apply-bar">
            <div className="cd-apply-card">
              <h3>Interested in this role?</h3>
              <p>Submit your application and we'll get back to you within a few days.</p>
              <button className="cd-apply-btn" onClick={() => setShowApply(true)}>Apply Now</button>
            </div>
          </div>
        </div>
      </section>

      {/* Mobile fixed apply bar */}
      <div className="cd-mobile-apply">
        <button className="cd-apply-btn" onClick={() => setShowApply(true)}>Apply Now</button>
      </div>

      {showApply && <ApplicationModal job={job} onClose={() => setShowApply(false)} />}
      <MarketingFooter />
    </div>
  );
};

/* ─── Application Modal ─── */
const ApplicationModal = ({ job, onClose }) => {
  const [form, setForm] = useState({ name: '', email: '', phone: '', coverLetter: '' });
  const [resume, setResume] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState({});

  const handleChange = (e) => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));
    if (errors[e.target.name]) setErrors(prev => ({ ...prev, [e.target.name]: false }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!form.name.trim()) errs.name = 'Name is required';
    if (!form.email.trim() || !/\S+@\S+\.\S+/.test(form.email)) errs.email = 'Valid email is required';
    if (Object.keys(errs).length) { setErrors(errs); return; }

    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('name', form.name);
      fd.append('email', form.email);
      if (form.phone) fd.append('phone', form.phone);
      if (form.coverLetter) fd.append('coverLetter', form.coverLetter);
      if (resume) fd.append('resume', resume);
      await axios.post(`${API_URL}/public/careers/${job.id}/apply`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success('Application submitted successfully!');
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to submit application.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="cd-modal-overlay" onClick={onClose}>
      <div className="cd-modal" onClick={e => e.stopPropagation()}>
        <div className="cd-modal-header">
          <div>
            <h2 className="cd-modal-title">Apply for {job.title}</h2>
            {job.department && <span className="cd-modal-subtitle">{job.department}</span>}
          </div>
          <button className="cd-modal-close" onClick={onClose}><X size={20} /></button>
        </div>
        <form onSubmit={handleSubmit} className="cd-modal-form">
          <div className={`cd-field ${errors.name ? 'cd-field-error' : ''}`}>
            <label>Name *</label>
            <input name="name" value={form.name} onChange={handleChange} placeholder="Your full name" />
            {errors.name && <span className="cd-error-text">{errors.name}</span>}
          </div>
          <div className={`cd-field ${errors.email ? 'cd-field-error' : ''}`}>
            <label>Email *</label>
            <input name="email" type="email" value={form.email} onChange={handleChange} placeholder="you@example.com" />
            {errors.email && <span className="cd-error-text">{errors.email}</span>}
          </div>
          <div className="cd-field">
            <label>Phone</label>
            <input name="phone" value={form.phone} onChange={handleChange} placeholder="+1 (555) 123-4567" />
          </div>
          <div className="cd-field">
            <label>Cover Letter</label>
            <textarea name="coverLetter" value={form.coverLetter} onChange={handleChange} placeholder="Tell us why you'd be a great fit..." />
          </div>
          <div className="cd-field">
            <label>Resume</label>
            <label className="cd-file-label">
              <Upload size={18} /> {resume ? resume.name : 'Choose file (.pdf, .doc, .docx)'}
              <input type="file" accept=".pdf,.doc,.docx" onChange={e => setResume(e.target.files?.[0] || null)} style={{ display: 'none' }} />
            </label>
          </div>
          <button type="submit" disabled={submitting} className="cd-submit-btn">
            {submitting ? <><Loader2 size={18} className="cd-spinner" /> Submitting...</> : <><CheckCircle2 size={18} /> Submit Application</>}
          </button>
        </form>
      </div>
    </div>
  );
};

export default CareerDetail;
