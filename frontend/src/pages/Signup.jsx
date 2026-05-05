import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Mail, Lock, User as UserIcon, Phone, UserPlus, ChevronRight, Loader, Eye, EyeOff } from 'lucide-react';
import { signup } from '../services/api';
import { toast } from 'react-toastify';
import StoreveuLogo from '../components/StoreveuLogo';
import './Signup.css';

const validateEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email?.trim());
const validatePhone = (phone) => !phone || /^\+?[\d\s\-\(\)]{7,15}$/.test(phone?.replace(/\s/g, ''));

const Signup = () => {
  const [formData, setFormData] = useState({ firstName: '', lastName: '', email: '', phone: '', password: '' });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const navigate = useNavigate();

  const handleBlur = (field) => {
    if (field === 'email' && formData.email && !validateEmail(formData.email)) {
      setErrors(prev => ({ ...prev, email: 'Please enter a valid email address' }));
    } else if (field === 'email') {
      setErrors(prev => ({ ...prev, email: '' }));
    }
    if (field === 'phone' && formData.phone && !validatePhone(formData.phone)) {
      setErrors(prev => ({ ...prev, phone: 'Please enter a valid phone number (e.g. +1 555 000 0000)' }));
    } else if (field === 'phone') {
      setErrors(prev => ({ ...prev, phone: '' }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const newErrors = {};
    if (formData.email && !validateEmail(formData.email)) {
      newErrors.email = 'Please enter a valid email address';
    }
    if (formData.phone && !validatePhone(formData.phone)) {
      newErrors.phone = 'Please enter a valid phone number (e.g. +1 555 000 0000)';
    }
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    setLoading(true);
    try {
      const name = `${formData.firstName.trim()} ${formData.lastName.trim()}`.trim();
      const { data } = await signup({ ...formData, name });
      // Wipe any leftover InactivityLock state from a previous session.
      localStorage.removeItem('storv:il:locked');
      localStorage.removeItem('storv:il:lastActive');
      localStorage.removeItem('storv:il:lockedFor');
      localStorage.setItem('user', JSON.stringify(data));
      window.dispatchEvent(new Event('storv:auth-change'));
      // S77 — every new vendor goes through the business questionnaire first.
      // Org/store creation (the existing /onboarding wizard) only kicks in
      // AFTER admin has reviewed + signed the contract + activated the account.
      toast.success("Account created! Tell us about your business to get started.");
      navigate('/vendor-onboarding');
    } catch (error) {
      toast.error(error.response?.data?.error || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="su-page">
      <div className="glass-card animate-fade-in su-card">
        <div className="su-header">
          <Link to="/" className="su-back-home">
            ← Back to Home
          </Link>
          <div className="su-logo-row">
            <StoreveuLogo height={44} darkMode={true} showTagline={true} />
          </div>
          <h1 className="su-title">
            Create Account
          </h1>
          <p className="su-subtitle">Join our business portal today</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="su-name-grid">
            <div className="form-group">
              <label className="form-label">First Name</label>
              <div className="su-input-wrap">
                <span className="su-input-icon"><UserIcon size={18} /></span>
                <input
                  type="text"
                  className="form-input su-input-icon-pad"
                  placeholder="John"
                  value={formData.firstName}
                  onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                  required
                />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Last Name</label>
              <div className="su-input-wrap">
                <span className="su-input-icon"><UserIcon size={18} /></span>
                <input
                  type="text"
                  className="form-input su-input-icon-pad"
                  placeholder="Doe"
                  value={formData.lastName}
                  onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                  required
                />
              </div>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Email Address</label>
            <div className="su-input-wrap">
              <span className="su-input-icon"><Mail size={18} /></span>
              <input
                type="email"
                className={`form-input su-input-icon-pad ${errors.email ? 'su-input--error' : ''}`}
                placeholder="name@company.com"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                onBlur={() => handleBlur('email')}
                required
              />
            </div>
            {errors.email && <p className="su-field-error">{errors.email}</p>}
          </div>

          <div className="form-group">
            <label className="form-label">Phone Number</label>
            <div className="su-input-wrap">
              <span className="su-input-icon"><Phone size={18} /></span>
              <input
                type="tel"
                className={`form-input su-input-icon-pad ${errors.phone ? 'su-input--error' : ''}`}
                placeholder="+1 (234) 567 890"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                onBlur={() => handleBlur('phone')}
                required
              />
            </div>
            {errors.phone && <p className="su-field-error">{errors.phone}</p>}
          </div>

          <div className="form-group">
            <label className="form-label">Password</label>
            <div className="su-input-wrap">
              <span className="su-input-icon"><Lock size={18} /></span>
              <input
                type={showPw ? 'text' : 'password'}
                className="form-input su-input-icon-pad"
                placeholder="••••••••"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                required
              />
              <button type="button" className="lg-eye-btn" onClick={() => setShowPw(!showPw)} tabIndex={-1}>
                {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <button type="submit" className="btn btn-primary su-submit" disabled={loading}>
            {loading ? <Loader className="animate-spin" /> : <>Sign Up <ChevronRight size={18} className="su-submit-icon" /></>}
          </button>
        </form>

        <div className="su-footer">
          Already have an account? <Link to="/login" className="su-login-link">Log In</Link>
        </div>
      </div>
    </div>
  );
};

export default Signup;
