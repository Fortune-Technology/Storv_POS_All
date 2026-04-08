import { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import Header from '../../components/layout/Header';
import Footer from '../../components/layout/Footer';
import CartDrawer from '../../components/cart/CartDrawer';
import { useAuth } from '../../lib/auth';
import { useCart } from '../../lib/cart';

export default function SignupPage() {
  const { signup } = useAuth();
  const { storeSlug: sq } = useCart();
  const router = useRouter();
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', confirm: '' });
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (form.password !== form.confirm) { setError('Passwords do not match'); return; }
    setError(null);
    setLoading(true);
    try {
      await signup(form.name, form.email, form.phone, form.password);
      const redirect = router.query.redirect;
      router.push(redirect ? `${redirect}?store=${sq}` : `/account?store=${sq}`);
    } catch (err) {
      setError(err.response?.data?.error || 'Signup failed');
    }
    setLoading(false);
  };

  return (
    <>
      <Head><title>Create Account</title></Head>
      <Header />
      <CartDrawer />
      <main className="sf-container">
        <div className="auth-wrapper">
          <div className="auth-card">
            <h1 className="auth-title">Create Account</h1>
            <p className="auth-subtitle">Shop faster with a saved account</p>
            {error && <div className="auth-error">{error}</div>}
            <form onSubmit={handleSubmit}>
              <div className="auth-field">
                <label className="auth-label">Full Name</label>
                <input className="auth-input" value={form.name} onChange={set('name')} required />
              </div>
              <div className="auth-field">
                <label className="auth-label">Email</label>
                <input className="auth-input" type="email" value={form.email} onChange={set('email')} required />
              </div>
              <div className="auth-field">
                <label className="auth-label">Phone (optional)</label>
                <input className="auth-input" type="tel" value={form.phone} onChange={set('phone')} />
              </div>
              <div className="auth-row">
                <div className="auth-field">
                  <label className="auth-label">Password</label>
                  <input className="auth-input" type="password" value={form.password} onChange={set('password')} required minLength={6} />
                </div>
                <div className="auth-field">
                  <label className="auth-label">Confirm</label>
                  <input className="auth-input" type="password" value={form.confirm} onChange={set('confirm')} required />
                </div>
              </div>
              <button className="auth-btn" type="submit" disabled={loading}>
                {loading ? 'Creating...' : 'Create Account'}
              </button>
            </form>
            <p className="auth-footer-text">
              Already have an account? <Link href={`/account/login?store=${sq}`} className="auth-link">Sign in</Link>
            </p>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
