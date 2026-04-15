import React, { useState, useEffect } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import MarketingNavbar from '../../components/marketing/MarketingNavbar';
import MarketingFooter from '../../components/marketing/MarketingFooter';
import { FileX } from 'lucide-react';
import axios from 'axios';
import DOMPurify from 'dompurify';
import './CmsPage.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

// Map short paths to CMS slugs
const PATH_SLUG_MAP = {
  '/privacy': 'privacy-policy',
  '/terms': 'terms-and-conditions',
  '/cookies': 'cookies',
};

const CmsPage = () => {
  const { slug: paramSlug } = useParams();
  const location = useLocation();
  const slug = paramSlug || PATH_SLUG_MAP[location.pathname] || location.pathname.replace(/^\//, '');
  const [page, setPage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const fetchPage = async () => {
      setLoading(true);
      setNotFound(false);
      try {
        const res = await axios.get(`${API_URL}/public/cms/${slug}`);
        const data = res.data?.data ?? res.data;
        if (!data || !data.published) {
          setNotFound(true);
        } else {
          setPage(data);
          document.title = data.metaTitle || data.title || 'StoreVeu';
        }
      } catch (err) {
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    };
    fetchPage();
    return () => { document.title = 'StoreVeu'; };
  }, [slug]);

  return (
    <div className="cms-page">
      <MarketingNavbar />

      <main className="cms-main">
        {loading && (
          <div className="cms-loader-wrap">
            <div className="cms-spinner" />
          </div>
        )}

        {!loading && notFound && (
          <div className="cms-not-found">
            <FileX size={64} color="#d1d5db" />
            <h1 className="cms-not-found-title">Page Not Found</h1>
            <p className="cms-not-found-text">
              The page you are looking for does not exist or is no longer published.
            </p>
          </div>
        )}

        {!loading && !notFound && page && (
          <div className="cms-container">
            {page.title && <h1 className="cms-page-title">{page.title}</h1>}
            <div
              className="cms-content"
              dangerouslySetInnerHTML={{
                __html: DOMPurify.sanitize(page.content || '', {
                  USE_PROFILES: { html: true },
                  FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form'],
                  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur', 'style'],
                }),
              }}
            />
          </div>
        )}
      </main>

      <MarketingFooter />
    </div>
  );
};

export default CmsPage;
