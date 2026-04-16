import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import MarketingButton from './MarketingButton';
import StoreveuLogo from '../StoreveuLogo';
import './MarketingNavbar.css';

const MarketingNavbar = () => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [user, setUser] = useState(null);
  const location = useLocation();
  const lastScrollY = useRef(0);

  useEffect(() => {
    const savedUser = JSON.parse(localStorage.getItem('user'));
    if (savedUser && savedUser.token) setUser(savedUser);

    const handleScroll = () => {
      const y = window.scrollY;
      setIsScrolled(y > 20);
      if (y > 300) {
        setHidden(y > lastScrollY.current && y - lastScrollY.current > 5);
      } else {
        setHidden(false);
      }
      lastScrollY.current = y;
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Close mobile menu on route change
  useEffect(() => { setIsMobileMenuOpen(false); }, [location.pathname]);

  const navLinks = [
    { name: 'Features', path: '/features' },
    { name: 'Pricing', path: '/pricing' },
    { name: 'About', path: '/about' },
    { name: 'Contact', path: '/contact' },
  ];

  const isActive = (path) => location.pathname === path;

  const navClass = [
    'mkt-navbar',
    isScrolled ? 'scrolled' : '',
    hidden && !isMobileMenuOpen ? 'nav-hidden' : '',
  ].filter(Boolean).join(' ');

  return (
    <>
      <nav className={navClass}>
        <div className="mkt-navbar-container">
          <Link to="/" className="mkt-navbar-logo">
            <StoreveuLogo height={56} darkMode={false} />
          </Link>

          {/* Desktop navigation */}
          <div className="mkt-navbar-links">
            <div className="mkt-nav-links-group">
              {navLinks.map((link) => (
                <Link
                  key={link.path}
                  to={link.path}
                  className={`mkt-nav-item ${isActive(link.path) ? 'active' : ''}`}
                >
                  {link.name}
                  {isActive(link.path) && (
                    <motion.span
                      className="mkt-nav-underline"
                      layoutId="nav-underline"
                      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                    />
                  )}
                </Link>
              ))}
            </div>
            <div className="mkt-navbar-cta">
              {user ? (
                <MarketingButton href="/portal/realtime" size="sm">Dashboard</MarketingButton>
              ) : (
                <>
                  <Link to="/login" className="mkt-nav-item login-link">Log in</Link>
                  <MarketingButton href="/contact" size="sm">Book a Demo</MarketingButton>
                </>
              )}
            </div>
          </div>

          {/* Hamburger */}
          <button
            className={`mkt-hamburger ${isMobileMenuOpen ? 'active' : ''}`}
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            aria-label="Toggle Navigation"
          >
            <span /><span /><span />
          </button>
        </div>
      </nav>

      {/* Mobile backdrop */}
      <div
        className={`mkt-mobile-backdrop ${isMobileMenuOpen ? 'open' : ''}`}
        onClick={() => setIsMobileMenuOpen(false)}
      />

      {/* Mobile slide panel */}
      <div className={`mkt-mobile-panel ${isMobileMenuOpen ? 'open' : ''}`}>
        <div className="mkt-mobile-panel-inner">
          <div className="mkt-mobile-links">
            {navLinks.map((link, i) => (
              <Link
                key={link.path}
                to={link.path}
                className={`mkt-mobile-item ${isActive(link.path) ? 'active' : ''}`}
                onClick={() => setIsMobileMenuOpen(false)}
              >
                {link.name}
              </Link>
            ))}
          </div>
          <div className="mkt-mobile-cta-group">
            {user ? (
              <MarketingButton href="/portal/realtime" className="mkt-mobile-cta-btn" onClick={() => setIsMobileMenuOpen(false)}>
                Dashboard
              </MarketingButton>
            ) : (
              <>
                <Link to="/login" className="mkt-mobile-login" onClick={() => setIsMobileMenuOpen(false)}>
                  Log in
                </Link>
                <MarketingButton href="/contact" className="mkt-mobile-cta-btn" onClick={() => setIsMobileMenuOpen(false)}>
                  Book a Free Demo
                </MarketingButton>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default MarketingNavbar;
