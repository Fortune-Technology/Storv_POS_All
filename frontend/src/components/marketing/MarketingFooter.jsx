import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import StoreveuLogo from '../StoreveuLogo';
import axios from 'axios';
import './MarketingFooter.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

const MarketingFooter = () => {
  const currentYear = new Date().getFullYear();
  const [cmsPages, setCmsPages] = useState([]);

  useEffect(() => {
    axios.get(`${API_URL}/public/cms-list`)
      .then(r => setCmsPages(r.data?.data || []))
      .catch(() => {});
  }, []);

  // Static links
  const staticCompanyLinks = [
    { name: 'About Us', path: '/about' },
    { name: 'Contact', path: '/contact' },
    { name: 'Careers', path: '/careers' },
    { name: 'Support', path: '/support' },
  ];

  // Dynamic CMS page links
  const cmsLinks = cmsPages.map(p => ({
    name: p.title,
    path: `/page/${p.slug}`,
  }));

  const companyLinks = [...staticCompanyLinks, ...cmsLinks];

  const footerGroups = [
    {
      title: 'Product',
      links: [
        { name: 'Features', path: '/features' },
        { name: 'Pricing', path: '/pricing' },
        { name: 'Live Dashboard', path: '/features#dashboard' },
        { name: 'AI Invoice Import', path: '/features#ocr' },
      ]
    },
    {
      title: 'Company',
      links: companyLinks,
    },
    {
      title: 'Industries',
      links: [
        { name: 'Grocery & Supermarket', path: '/#industries' },
        { name: 'General Retail', path: '/#industries' },
        { name: 'Liquor & Wine', path: '/#industries' },
        { name: 'Meat & Food', path: '/#industries' },
      ]
    }
  ];

  return (
    <footer className="mkt-footer">
      <div className="mkt-footer-container">
        <div className="mkt-footer-grid">
          {/* Logo and About Col — match navbar logo size */}
          <div className="mkt-footer-brand">
            <Link to="/" className="mkt-footer-logo">
              <StoreveuLogo height={38} darkMode={false} />
            </Link>
            <p className="mkt-footer-desc">
              The smartest POS solution for modern retailers. Powered by AI to simplify your inventory, billing, and growth.
            </p>
          </div>

          {/* Link Groups */}
          {footerGroups.map((group) => (
            <div key={group.title} className="mkt-footer-group">
              <h4 className="mkt-footer-title">{group.title}</h4>
              <ul className="mkt-footer-links">
                {group.links.map((link) => (
                  <li key={link.name}>
                    <Link to={link.path}>{link.name}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mkt-footer-bottom">
          <p style={{ textAlign: 'center', width: '100%' }}>&copy; {currentYear} Storeveu. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
};

export default MarketingFooter;
