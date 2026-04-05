import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, ArrowLeft, Send, CheckCircle } from 'lucide-react';
import { forgotPassword } from '../services/api';
import { toast } from 'react-toastify';
import StoreveuLogo from '../components/StoreveuLogo';

const ForgotPassword = () => {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await forgotPassword(email);
      setSubmitted(true);
      toast.success('Reset email sent!');
    } catch (error) {
      toast.error('Error sending reset email');
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'radial-gradient(circle at top right, #7ac14310, transparent), radial-gradient(circle at bottom left, #e3061310, transparent)' }}>
        <div className="glass-card animate-fade-in" style={{ width: '100%', maxWidth: '450px', padding: '3rem', textAlign: 'center', background: '#ffffff', boxShadow: '0 10px 30px rgba(0,0,0,0.1)' }}>
          <div style={{ background: 'rgba(16, 185, 129, 0.1)', padding: '1.5rem', borderRadius: '50%', color: 'var(--success)', width: '80px', height: '80px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem' }}>
            <CheckCircle size={40} />
          </div>
          <h1 style={{ fontSize: '2rem', marginBottom: '1rem' }}>Check your email</h1>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem' }}>We've sent a password reset link to <strong>{email}</strong>.</p>
          <Link to="/login" className="btn btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', width: '100%' }}>
            <ArrowLeft size={18} style={{ marginRight: '0.5rem' }} /> Back to Log In
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'radial-gradient(circle at top right, #7ac14310, transparent), radial-gradient(circle at bottom left, #e3061310, transparent)' }}>
      <div className="glass-card animate-fade-in" style={{ width: '100%', maxWidth: '450px', padding: '3rem', background: '#ffffff', boxShadow: '0 10px 30px rgba(0,0,0,0.1)' }}>
        <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.25rem' }}>
            <StoreveuLogo height={44} darkMode={true} showTagline={true} />
          </div>
          <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem', color: 'var(--text-primary)' }}>Reset Password</h1>
          <p style={{ color: 'var(--text-secondary)' }}>Enter your email to receive a reset link</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Email Address</label>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}><Mail size={18} /></span>
              <input 
                type="email" 
                className="form-input" 
                style={{ paddingLeft: '3rem' }} 
                placeholder="name@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
          </div>

          <button type="submit" className="btn btn-primary" style={{ width: '100%', padding: '1rem', marginTop: '1rem' }} disabled={loading}>
            {loading ? 'Sending...' : <>Send Reset Link <Send size={18} style={{ marginLeft: '0.5rem' }} /></>}
          </button>
        </form>

        <div style={{ marginTop: '2rem', textAlign: 'center' }}>
           <Link to="/login" style={{ color: 'var(--text-secondary)', textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <ArrowLeft size={16} style={{ marginRight: '0.5rem' }} /> Back to Log In
           </Link>
        </div>
      </div>
    </div>
  );
};

export default ForgotPassword;
