import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useStore } from '../../lib/store';
import { useCart } from '../../lib/cart';
import { useAuth } from '../../lib/auth';

export default function Header() {
  const store = useStore();
  const { cartCount, setDrawerOpen, storeSlug } = useCart();
  const { isLoggedIn, customer } = useAuth();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [mobileMenu, setMobileMenu] = useState(false);
  const branding = store?.branding || {};
  const sq = `store=${storeSlug}`;

  const handleSearch = (e) => {
    e.preventDefault();
    if (search.trim()) {
      router.push(`/products?${sq}&search=${encodeURIComponent(search.trim())}`);
      setSearch('');
    }
  };

  return (
    <header className="sf-header">
      <div className="sf-header-inner">
        <Link href={`/?${sq}`} className="sf-logo">
          {branding.logoText || store?.storeName || 'Store'}
        </Link>

        <form className="sf-search-form" onSubmit={handleSearch}>
          <input
            type="text"
            className="sf-search-input"
            placeholder="Search products..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button type="submit" className="sf-search-btn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          </button>
        </form>

        <nav className="sf-nav">
          <Link href={`/products?${sq}`}>Shop</Link>
          <Link href={`/about?${sq}`}>About</Link>
          <Link href={`/contact?${sq}`}>Contact</Link>

          {isLoggedIn ? (
            <Link href={`/account?${sq}`} className="sf-nav-account">
              <span className="sf-nav-avatar">{customer?.name?.charAt(0)?.toUpperCase()}</span>
            </Link>
          ) : (
            <Link href={`/account/login?${sq}`} className="sf-nav-signin">Sign In</Link>
          )}

          <button className="sf-cart-btn" onClick={() => setDrawerOpen(true)} aria-label="Cart">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
            {cartCount > 0 && <span className="sf-cart-badge">{cartCount}</span>}
          </button>
        </nav>

        <button className="sf-mobile-toggle" onClick={() => setMobileMenu(!mobileMenu)}>
          {mobileMenu ? '✕' : '☰'}
        </button>
      </div>

      {mobileMenu && (
        <div className="sf-mobile-menu">
          <Link href={`/products?${sq}`} onClick={() => setMobileMenu(false)}>Shop</Link>
          <Link href={`/about?${sq}`} onClick={() => setMobileMenu(false)}>About</Link>
          <Link href={`/contact?${sq}`} onClick={() => setMobileMenu(false)}>Contact</Link>
          {isLoggedIn
            ? <Link href={`/account?${sq}`} onClick={() => setMobileMenu(false)}>My Account</Link>
            : <Link href={`/account/login?${sq}`} onClick={() => setMobileMenu(false)}>Sign In</Link>
          }
        </div>
      )}
    </header>
  );
}
