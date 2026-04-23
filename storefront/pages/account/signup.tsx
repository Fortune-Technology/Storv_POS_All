import { useState, useEffect, FormEvent, ChangeEvent } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import type { GetServerSidePropsContext } from 'next';
import { Eye, EyeOff } from 'lucide-react';
import Header from '../../components/layout/Header';
import Footer from '../../components/layout/Footer';
import CartDrawer from '../../components/cart/CartDrawer';
import { useAuth } from '../../lib/auth';
import { useCart } from '../../lib/cart';

interface SignupForm {
  name: string;
  email: string;
  phone: string;
  password: string;
  confirm: string;
}

export default function SignupPage() {
  const { signup, isLoggedIn } = useAuth();
  const { storeSlug: sq } = useCart();
  const router = useRouter();

  // Redirect logged-in users away from signup page
  useEffect(() => {
    if (isLoggedIn) {
      router.replace(`/account?store=${sq}`);
    }
  }, [isLoggedIn, router, sq]);
  const [form, setForm] = useState<SignupForm>({ name: '', email: '', phone: '', password: '', confirm: '' });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pendingApproval, setPendingApproval] = useState(false);
  const set = (k: keyof SignupForm) => (e: ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  // Mirror backend policy — 8+ chars, mixed case, digit, special.
  const PASSWORD_RE =
    /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[!@#$%^&*()_+\-={}[\]:;"'<>,.?/\\|`~]).{8,128}$/;

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (form.password !== form.confirm) { setError('Passwords do not match'); return; }
    if (!PASSWORD_RE.test(form.password)) {
      setError('Password must be at least 8 characters and include uppercase, lowercase, number, and special character.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const result = await signup(form.name, form.email, form.phone, form.password);
      // Handle pending-approval state — don't redirect straight to account.
      const r = result as { status?: string; customer?: { status?: string } } | undefined;
      if (r?.status === 'pending' || r?.customer?.status === 'pending') {
        setPendingApproval(true);
        return;
      }
      const redirect = router.query.redirect;
      const redirectPath = typeof redirect === 'string' ? redirect : null;
      router.push(redirectPath ? `${redirectPath}?store=${sq}` : `/account?store=${sq}`);
    } catch (err) {
      const maybeAxios = err as { response?: { data?: { error?: string } } };
      setError(maybeAxios.response?.data?.error || 'Signup failed');
    } finally {
      setLoading(false);
    }
  };

  if (pendingApproval) {
    return (
      <>
        <Head><title>Account Pending Approval</title></Head>
        <Header />
        <CartDrawer />
        <main className="sf-container">
          <div className="auth-wrapper">
            <div className="auth-card">
              <h1 className="auth-title">Thanks for signing up!</h1>
              <p className="auth-subtitle">
                Your account has been created and is awaiting approval by the store.
                You&rsquo;ll receive an email as soon as it&rsquo;s activated.
              </p>
              <p className="auth-subtitle" style={{ marginTop: '1rem' }}>
                In the meantime, you can keep browsing the store.
              </p>
              <Link href={`/?store=${sq}`} className="auth-btn" style={{ display: 'inline-block', textAlign: 'center', textDecoration: 'none', marginTop: '1rem' }}>
                Continue Shopping
              </Link>
            </div>
          </div>
        </main>
        <Footer />
      </>
    );
  }

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
                  <div className="acc-pw-input-wrap">
                    <input className="auth-input" type={showPw ? 'text' : 'password'} value={form.password} onChange={set('password')} required minLength={6} />
                    <button type="button" className="acc-pw-toggle" onClick={() => setShowPw(v => !v)}>{showPw ? <EyeOff size={16} /> : <Eye size={16} />}</button>
                  </div>
                </div>
                <div className="auth-field">
                  <label className="auth-label">Confirm</label>
                  <div className="acc-pw-input-wrap">
                    <input className="auth-input" type={showConfirm ? 'text' : 'password'} value={form.confirm} onChange={set('confirm')} required />
                    <button type="button" className="acc-pw-toggle" onClick={() => setShowConfirm(v => !v)}>{showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}</button>
                  </div>
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

export async function getServerSideProps(ctx: GetServerSidePropsContext) {
  const { withStore } = await import('../../lib/resolveStore');
  return withStore(ctx);
}
