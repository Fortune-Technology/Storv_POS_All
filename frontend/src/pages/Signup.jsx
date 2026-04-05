import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Mail, Lock, User as UserIcon, Phone, UserPlus, ChevronRight, Loader } from 'lucide-react';
import { signup } from '../services/api';
import { toast } from 'react-toastify';
import StoreveuLogo from '../components/StoreveuLogo';

const validateEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email?.trim());
const validatePhone = (phone) => !phone || /^\+?[\d\s\-\(\)]{7,15}$/.test(phone?.replace(/\s/g, ''));

const Signup = () => {
  const [formData, setFormData] = useState({ firstName: '', lastName: '', email: '', phone: '', password: '' });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
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
      localStorage.setItem('user', JSON.stringify(data));
      toast.success("Account created! Let's set up your organisation.");
      navigate('/onboarding');
    } catch (error) {
      toast.error(error.response?.data?.error || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'radial-gradient(circle at top right, var(--accent-primary)10, transparent), radial-gradient(circle at bottom left, var(--error)10, transparent)' }}>
      <div className="glass-card animate-fade-in" style={{ width: '100%', maxWidth: '450px', padding: '3rem', background: '#ffffff', boxShadow: '0 10px 30px rgba(0,0,0,0.1)' }}>
        <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
          <Link to="/" style={{ display: 'inline-block', marginBottom: '1.5rem', color: 'var(--accent-primary)', textDecoration: 'none', fontWeight: 600, fontSize: '0.875rem' }}>
            ← Back to Home
          </Link>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.25rem' }}>
            <StoreveuLogo height={44} darkMode={true} showTagline={true} />
          </div>
          <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
            Create Account
          </h1>
          <p style={{ color: 'var(--text-secondary)' }}>Join our business portal today</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">First Name</label>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}><UserIcon size={18} /></span>
                <input
                  type="text"
                  className="form-input"
                  style={{ paddingLeft: '3rem' }}
                  placeholder="John"
                  value={formData.firstName}
                  onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                  required
                />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Last Name</label>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}><UserIcon size={18} /></span>
                <input
                  type="text"
                  className="form-input"
                  style={{ paddingLeft: '3rem' }}
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
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}><Mail size={18} /></span>
              <input
                type="email"
                className="form-input"
                style={{ paddingLeft: '3rem', borderColor: errors.email ? 'var(--error)' : undefined }}
                placeholder="name@company.com"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                onBlur={() => handleBlur('email')}
                required
              />
            </div>
            {errors.email && <p style={{ color: 'var(--error)', fontSize: '0.75rem', margin: '0.25rem 0 0' }}>{errors.email}</p>}
          </div>

          <div className="form-group">
            <label className="form-label">Phone Number</label>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}><Phone size={18} /></span>
              <input
                type="tel"
                className="form-input"
                style={{ paddingLeft: '3rem', borderColor: errors.phone ? 'var(--error)' : undefined }}
                placeholder="+1 (234) 567 890"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                onBlur={() => handleBlur('phone')}
                required
              />
            </div>
            {errors.phone && <p style={{ color: 'var(--error)', fontSize: '0.75rem', margin: '0.25rem 0 0' }}>{errors.phone}</p>}
          </div>

          <div className="form-group">
            <label className="form-label">Password</label>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}><Lock size={18} /></span>
              <input 
                type="password" 
                className="form-input" 
                style={{ paddingLeft: '3rem' }} 
                placeholder="••••••••"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                required
              />
            </div>
          </div>

          <button type="submit" className="btn btn-primary" style={{ width: '100%', padding: '1rem', marginTop: '1rem' }} disabled={loading}>
            {loading ? <Loader className="animate-spin" /> : <>Sign Up <ChevronRight size={18} style={{ marginLeft: '0.5rem' }} /></>}
          </button>
        </form>

        <div style={{ marginTop: '2.5rem', textAlign: 'center', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
          Already have an account? <Link to="/login" style={{ color: 'var(--accent-primary)', textDecoration: 'none', fontWeight: 600 }}>Log In</Link>
        </div>
      </div>
    </div>
  );
};

export default Signup;
