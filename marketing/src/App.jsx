import { Routes, Route, useLocation } from 'react-router-dom';
import { useEffect } from 'react';

import Home from './pages/Home';
import Features from './pages/Features';
import Pricing from './pages/Pricing';
import Contact from './pages/Contact';
import About from './pages/About';
import Download from './pages/Download';

// Scroll to top on every route change (and respect #anchor jumps).
function ScrollToTop() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (hash) {
      const el = document.getElementById(hash.slice(1));
      if (el) {
        el.scrollIntoView({ behavior: 'smooth' });
        return;
      }
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [pathname, hash]);
  return null;
}

export default function App() {
  return (
    <>
      <ScrollToTop />
      <Routes>
        <Route path="/"         element={<Home />} />
        <Route path="/features" element={<Features />} />
        <Route path="/pricing"  element={<Pricing />} />
        <Route path="/contact"  element={<Contact />} />
        <Route path="/about"    element={<About />} />
        <Route path="/download" element={<Download />} />
        {/* Anything else → home */}
        <Route path="*" element={<Home />} />
      </Routes>
    </>
  );
}
