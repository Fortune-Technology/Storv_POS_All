import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Phone, Search, ChevronRight, Loader, ArrowLeft } from 'lucide-react';
import { phoneLookup } from '../services/api';
import { toast } from 'react-toastify';

const PhoneLookup = () => {
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data } = await phoneLookup(phone);
      toast.success('Account found! Proceeding to OTP...');
      // In a real scenario, this would redirect to an OTP verification page
      // For now, let's just show the found account info or redirect to login
      navigate('/login');
    } catch (error) {
      toast.error(error.response?.data?.error || 'No account found with this phone number');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-primary)' }}>
      <div className="glass-card animate-fade-in" style={{ width: '100%', maxWidth: '450px', padding: '3rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
          <h1 style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>Find Account</h1>
          <p style={{ color: 'var(--text-secondary)' }}>Identify yourself with your phone number</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Phone Number</label>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}><Phone size={18} /></span>
              <input 
                type="tel" 
                className="form-input" 
                style={{ paddingLeft: '3rem' }} 
                placeholder="+1 (234) 567 890"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
              />
            </div>
          </div>

          <button type="submit" className="btn btn-primary" style={{ width: '100%', padding: '1rem', marginTop: '1rem' }} disabled={loading}>
            {loading ? <Loader className="animate-spin" /> : <>Continue <ChevronRight size={18} style={{ marginLeft: '0.5rem' }} /></>}
          </button>
        </form>

        <div style={{ marginTop: '2.5rem', textAlign: 'center', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
           <Link to="/login" style={{ color: 'var(--text-secondary)', textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <ArrowLeft size={16} style={{ marginRight: '0.5rem' }} /> Back to Log In
           </Link>
        </div>
      </div>
    </div>
  );
};

export default PhoneLookup;
