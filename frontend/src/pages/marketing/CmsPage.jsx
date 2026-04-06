import React, { useState, useEffect } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import MarketingNavbar from '../../components/marketing/MarketingNavbar';
import MarketingFooter from '../../components/marketing/MarketingFooter';
import { FileX } from 'lucide-react';
import axios from 'axios';

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
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#fff' }}>
      <MarketingNavbar />
      <style>{cmsStyles}</style>

      <main style={{ flex: 1 }}>
        {loading && (
          <div style={styles.loaderWrap}>
            <div style={styles.spinner} />
          </div>
        )}

        {!loading && notFound && (
          <div style={styles.notFoundWrap}>
            <FileX size={64} color="#d1d5db" />
            <h1 style={styles.notFoundTitle}>Page Not Found</h1>
            <p style={styles.notFoundText}>
              The page you are looking for does not exist or is no longer published.
            </p>
          </div>
        )}

        {!loading && !notFound && page && (
          <div style={styles.container}>
            {page.title && <h1 style={styles.pageTitle}>{page.title}</h1>}
            <div
              className="cms-content"
              dangerouslySetInnerHTML={{ __html: page.content }}
            />
          </div>
        )}
      </main>

      <MarketingFooter />
    </div>
  );
};

const styles = {
  loaderWrap: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: '60vh',
  },
  spinner: {
    width: 40,
    height: 40,
    border: '4px solid #e5e7eb',
    borderTopColor: '#3d56b5',
    borderRadius: '50%',
    animation: 'cmsSpin 0.8s linear infinite',
  },
  container: {
    maxWidth: 800,
    margin: '0 auto',
    padding: '80px 24px 100px',
  },
  pageTitle: {
    fontSize: '2.5rem',
    fontWeight: 700,
    color: '#111827',
    marginBottom: 32,
    lineHeight: 1.2,
  },
  notFoundWrap: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '60vh',
    textAlign: 'center',
    padding: '40px 24px',
  },
  notFoundTitle: {
    fontSize: '2rem',
    fontWeight: 700,
    color: '#111827',
    marginTop: 24,
    marginBottom: 12,
  },
  notFoundText: {
    fontSize: '1.1rem',
    color: '#6b7280',
    maxWidth: 400,
  },
};

const cmsStyles = `
  @keyframes cmsSpin {
    to { transform: rotate(360deg); }
  }

  .cms-content {
    font-size: 1.1rem;
    line-height: 1.8;
    color: #374151;
  }

  .cms-content h1 {
    font-size: 2rem;
    font-weight: 700;
    color: #111827;
    margin: 40px 0 16px;
  }

  .cms-content h2 {
    font-size: 1.6rem;
    font-weight: 600;
    color: #111827;
    margin: 36px 0 14px;
  }

  .cms-content h3 {
    font-size: 1.3rem;
    font-weight: 600;
    color: #1f2937;
    margin: 28px 0 12px;
  }

  .cms-content p {
    margin: 0 0 20px;
  }

  .cms-content ul, .cms-content ol {
    margin: 0 0 20px;
    padding-left: 28px;
  }

  .cms-content li {
    margin-bottom: 8px;
  }

  .cms-content a {
    color: #3d56b5;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .cms-content a:hover {
    color: #5a9a2f;
  }

  .cms-content blockquote {
    margin: 24px 0;
    padding: 16px 24px;
    border-left: 4px solid #3d56b5;
    background: #f9fafb;
    color: #4b5563;
    border-radius: 0 8px 8px 0;
    font-style: italic;
  }

  .cms-content img {
    max-width: 100%;
    height: auto;
    border-radius: 8px;
    margin: 20px 0;
  }

  .cms-content pre {
    background: #1f2937;
    color: #e5e7eb;
    padding: 16px 20px;
    border-radius: 8px;
    overflow-x: auto;
    margin: 20px 0;
    font-size: 0.95rem;
  }

  .cms-content code {
    background: #f3f4f6;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 0.95em;
  }

  .cms-content pre code {
    background: none;
    padding: 0;
  }
`;

export default CmsPage;
