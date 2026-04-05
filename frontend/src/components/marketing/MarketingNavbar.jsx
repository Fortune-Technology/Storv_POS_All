import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import MarketingButton from './MarketingButton';
import StoreveuLogo from '../StoreveuLogo';
import './MarketingNavbar.css';

const MarketingNavbar = () => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [user, setUser] = useState(null);
  const location = useLocation();

  useEffect(() => {
    // Check for authenticated user from localStorage
    const savedUser = JSON.parse(localStorage.getItem('user'));
    if (savedUser && savedUser.token) {
      setUser(savedUser);
    }
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const navLinks = [
    { name: 'Features', path: '/features' },
    { name: 'Pricing', path: '/pricing' },
    { name: 'About', path: '/about' },
    { name: 'Contact', path: '/contact' },
  ];

  const isActive = (path) => location.pathname === path;

  return (
    <nav className={`mkt-navbar ${isScrolled ? 'scrolled' : ''}`}>
      <div className="mkt-navbar-container">
        <Link to="/" className="mkt-navbar-logo" onClick={() => setIsMobileMenuOpen(false)}>
          <StoreveuLogo height={32} darkMode={true} />
        </Link>

        {/* Desktop Menu */}
        <div className="mkt-navbar-links">
          {navLinks.map((link) => (
            <Link
              key={link.path}
              to={link.path}
              className={`mkt-nav-item ${isActive(link.path) ? 'active' : ''}`}
            >
              {link.name}
            </Link>
          ))}
          <div className="mkt-navbar-cta">
            {user ? (
              <MarketingButton href="/portal/realtime" size="sm">Go to Dashboard</MarketingButton>
            ) : (
              <>
                <Link to="/login" className="mkt-nav-item login-link">Login</Link>
                <MarketingButton href="/contact" size="sm">Book a Demo</MarketingButton>
              </>
            )}
          </div>
        </div>

        {/* Mobile Hamburger */}
        <button
          className={`mkt-hamburger ${isMobileMenuOpen ? 'active' : ''}`}
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          aria-label="Toggle Navigation"
        >
          <span></span>
          <span></span>
          <span></span>
        </button>
      </div>

      {/* Mobile Menu Overlay */}
      <div className={`mkt-mobile-menu ${isMobileMenuOpen ? 'open' : ''}`}>
        <div className="mkt-mobile-links">
          {navLinks.map((link) => (
            <Link
              key={link.path}
              to={link.path}
              className={`mkt-mobile-item ${isActive(link.path) ? 'active' : ''}`}
              onClick={() => setIsMobileMenuOpen(false)}
            >
              {link.name}
            </Link>
          ))}
          {user ? (
            <div className="mkt-mobile-cta">
              <MarketingButton href="/portal/realtime" className="w-full" onClick={() => setIsMobileMenuOpen(false)}>
                Go to Dashboard
              </MarketingButton>
            </div>
          ) : (
            <>
              <Link
                to="/login"
                className="mkt-mobile-item"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                Login
              </Link>
              <div className="mkt-mobile-cta">
                <MarketingButton href="/contact" className="w-full" onClick={() => setIsMobileMenuOpen(false)}>
                  Book a Free Demo
                </MarketingButton>
              </div>
            </>
          )}
        </div>
      </div>
    </nav>
  );
};

export default MarketingNavbar;
