import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, Lock, LogIn, ChevronRight, Loader, Eye, EyeOff } from 'lucide-react';
import { login } from '../services/api';
import { toast } from 'react-toastify';
import StoreveuLogo from '../components/StoreveuLogo';
import './Login.css';

const Login = () => {
  const [formData, setFormData] = useState({ email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem('admin_user'));
    if (user && user.token && user.role === 'superadmin') {
      navigate('/dashboard', { replace: true });
    }
  }, [navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data } = await login(formData);
      if (data.role !== 'superadmin') {
        toast.error('Access denied. Superadmin credentials required.');
        return;
      }
      localStorage.setItem('admin_user', JSON.stringify(data));
      toast.success('Welcome back!');
      navigate('/dashboard');
    } catch (error) {
      toast.error(error.response?.data?.error || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="al-page">
      <div className="al-card">
        <div className="al-header">
          <div className="al-logo">
            <StoreveuLogo height={44} darkMode={true} showTagline={true} />
          </div>
          <h1 className="al-title">Admin Panel</h1>
          <p className="al-subtitle">Sign in with your superadmin credentials</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="al-field">
            <label className="al-label">Email Address</label>
            <div className="al-input-wrap">
              <span className="al-input-icon"><Mail size={18} /></span>
              <input
                type="email"
                className="al-input"
                placeholder="admin@storeveu.com"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                required
              />
            </div>
          </div>

          <div className="al-field">
            <label className="al-label">Password</label>
            <div className="al-input-wrap">
              <span className="al-input-icon"><Lock size={18} /></span>
              <input
                type={showPw ? 'text' : 'password'}
                className="al-input"
                placeholder="••••••••"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                required
              />
              <button type="button" className="al-pw-eye" onClick={() => setShowPw(v => !v)}>
                {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <button type="submit" className="al-btn" disabled={loading}>
            {loading
              ? <Loader size={18} className="al-spin" />
              : <>Log In <ChevronRight size={18} /></>
            }
          </button>
        </form>
      </div>
    </div>
  );
};

export default Login;
