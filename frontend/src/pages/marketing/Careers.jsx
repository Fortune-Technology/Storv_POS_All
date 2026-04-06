import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import MarketingNavbar from '../../components/marketing/MarketingNavbar';
import MarketingFooter from '../../components/marketing/MarketingFooter';
import { Briefcase, MapPin, Clock, Building2, ArrowRight } from 'lucide-react';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
const ACCENT = '#3d56b5';

const stripHtml = (html) => {
  if (!html) return '';
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || '';
};

const Careers = () => {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    axios.get(`${API_URL}/public/careers`)
      .then(res => setJobs(Array.isArray(res.data?.data) ? res.data.data : []))
      .catch(() => setJobs([]))
      .finally(() => setLoading(false));
  }, []);

  const formatDate = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#fff' }}>
      <MarketingNavbar />

      {/* Hero */}
      <section style={{ background: 'linear-gradient(135deg, #eef2ff 0%, #e8eaf6 50%, #f0f9ff 100%)', padding: '120px 24px 80px', textAlign: 'center' }}>
        <div style={{ maxWidth: 700, margin: '0 auto' }}>
          <h1 style={{ fontSize: '3rem', fontWeight: 800, color: '#111827', marginBottom: 20, lineHeight: 1.1 }}>
            Join Our <span style={{ color: ACCENT }}>Team</span>
          </h1>
          <p style={{ fontSize: '1.15rem', color: '#4b5563', lineHeight: 1.7, maxWidth: 560, margin: '0 auto' }}>
            Help us build the future of retail technology. We are looking for passionate people who want to make a real difference for independent store owners.
          </p>
        </div>
      </section>

      {/* Job Cards */}
      <section style={{ padding: '60px 24px 100px' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          {loading && (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
              <div style={{ width: 40, height: 40, border: '4px solid #e5e7eb', borderTopColor: ACCENT, borderRadius: '50%', animation: 'spin .8s linear infinite' }} />
            </div>
          )}

          {!loading && jobs.length === 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '80px 0' }}>
              <Briefcase size={48} color="#d1d5db" />
              <h3 style={{ color: '#374151', marginTop: 16, fontSize: '1.3rem' }}>No Open Positions Right Now</h3>
              <p style={{ color: '#6b7280', marginTop: 8, maxWidth: 400 }}>We are always looking for talented people. Check back soon or send your resume to careers@storeveu.com.</p>
            </div>
          )}

          {!loading && jobs.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {jobs.map(job => {
                const preview = stripHtml(job.description);
                return (
                  <Link key={job.id} to={`/careers/${job.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                    <div style={{
                      background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: '28px 32px',
                      transition: 'box-shadow .2s, border-color .2s', cursor: 'pointer',
                    }}
                      onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 8px 30px rgba(0,0,0,.07)'; e.currentTarget.style.borderColor = '#c7d2fe'; }}
                      onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.borderColor = '#e5e7eb'; }}
                    >
                      <div style={{ display: 'grid', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
                        <div style={{ flex: 1 }}>
                          <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#111827', marginBottom: 10 }}>{job.title}</h3>
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                            {job.department && (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 20, background: '#eef2ff', color: ACCENT, fontSize: '.78rem', fontWeight: 600 }}>
                                <Building2 size={13} /> {job.department}
                              </span>
                            )}
                            {job.type && (
                              <span style={{ padding: '3px 10px', borderRadius: 20, background: '#eff6ff', color: '#1d4ed8', fontSize: '.78rem', fontWeight: 600 }}>{job.type}</span>
                            )}
                          </div>
                          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
                            {job.location && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '.85rem', color: '#6b7280' }}><MapPin size={14} /> {job.location}</span>}
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '.85rem', color: '#6b7280' }}><Clock size={14} /> Posted {formatDate(job.createdAt)}</span>
                          </div>
                          {preview && (
                            <p style={{ fontSize: '.9rem', color: '#6b7280', lineHeight: 1.6, margin: 0 }}>
                              {preview.length > 180 ? preview.slice(0, 180) + '...' : preview}
                            </p>
                          )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', color: ACCENT, fontSize: '.85rem', fontWeight: 600, gap: 4, whiteSpace: 'nowrap', marginTop: 4 }}>
                          View Details <ArrowRight size={16} />
                        </div>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <MarketingFooter />
    </div>
  );
};

export default Careers;
