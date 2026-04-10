import { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import Header from '../../components/layout/Header';
import Footer from '../../components/layout/Footer';
import CartDrawer from '../../components/cart/CartDrawer';
import { useAuth } from '../../lib/auth';
import { useCart } from '../../lib/cart';

export default function LoginPage() {
  const { login, isLoggedIn } = useAuth();
  const { storeSlug: sq } = useCart();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  // Redirect logged-in users away from login page
  useEffect(() => {
    if (isLoggedIn) {
      router.replace(`/account?store=${sq}`);
    }
  }, [isLoggedIn, router, sq]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      const redirect = router.query.redirect;
      router.push(redirect ? `${redirect}?store=${sq}` : `/account?store=${sq}`);
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed');
    }
    setLoading(false);
  };

  return (
    <>
      <Head><title>Sign In</title></Head>
      <Header />
      <CartDrawer />
      <main className="sf-container">
        <div className="auth-wrapper">
          <div className="auth-card">
            <h1 className="auth-title">Welcome Back</h1>
            <p className="auth-subtitle">Sign in to your account</p>
            {error && <div className="auth-error">{error}</div>}
            <form onSubmit={handleSubmit}>
              <div className="auth-field">
                <label className="auth-label">Email</label>
                <input className="auth-input" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
              </div>
              <div className="auth-field">
                <label className="auth-label">Password</label>
                <input className="auth-input" type="password" value={password} onChange={e => setPassword(e.target.value)} required />
              </div>
              <button className="auth-btn" type="submit" disabled={loading}>
                {loading ? 'Signing in...' : 'Sign In'}
              </button>
            </form>
            <p className="auth-footer-text">
              Don't have an account? <Link href={`/account/signup?store=${sq}`} className="auth-link">Create one</Link>
            </p>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}

export async function getServerSideProps(ctx) {
  const { withStore } = await import('../../lib/resolveStore.js');
  return withStore(ctx);
}
