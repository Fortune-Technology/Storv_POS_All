import { useState, FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Mail, ArrowLeft, Send, CheckCircle, Loader } from 'lucide-react';
import { toast } from 'react-toastify';
import { forgotPassword } from '../services/api';
import StoreveuLogo from '../components/StoreveuLogo';
import './ForgotPassword.css';

const validateEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((email || '').trim());

const ForgotPassword = () => {
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleBlur = () => {
    if (email && !validateEmail(email)) setEmailError('Please enter a valid email address');
    else setEmailError('');
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (email && !validateEmail(email)) {
      setEmailError('Please enter a valid email address');
      return;
    }
    setLoading(true);
    try {
      await forgotPassword(email);
      setSubmitted(true);
      toast.success('If your email is registered, a reset link has been sent.');
    } catch {
      toast.error('Error sending reset email');
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="al-page">
        <div className="al-card afp-card-success">
          <div className="afp-success-icon"><CheckCircle size={42} /></div>
          <h1 className="afp-success-title">Check your email</h1>
          <p className="afp-success-msg">We've sent a password reset link to <strong>{email}</strong>.</p>
          <Link to="/login" className="al-btn afp-back-btn">
            <ArrowLeft size={16} /> Back to Log In
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="al-page">
      <div className="al-card">
        <div className="al-header">
          <div className="al-logo"><StoreveuLogo height={44} darkMode={true} showTagline={true} /></div>
          <h1 className="al-title">Reset Password</h1>
          <p className="al-subtitle">Enter your email to receive a reset link</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="al-field">
            <label className="al-label">Email Address</label>
            <div className="al-input-wrap">
              <span className="al-input-icon"><Mail size={18} /></span>
              <input
                type="email"
                className={`al-input ${emailError ? 'afp-input-error' : ''}`}
                placeholder="admin@storeveu.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={handleBlur}
                required
              />
            </div>
            {emailError && <p className="afp-field-error">{emailError}</p>}
          </div>

          <button type="submit" className="al-btn" disabled={loading}>
            {loading
              ? <><Loader size={16} className="al-spin" /> Sending…</>
              : <>Send Reset Link <Send size={16} /></>
            }
          </button>
        </form>

        <div className="afp-footer">
          <Link to="/login" className="afp-back-link">
            <ArrowLeft size={14} /> Back to Log In
          </Link>
        </div>
      </div>
    </div>
  );
};

export default ForgotPassword;
