import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import MarketingNavbar from '../../components/marketing/MarketingNavbar';
import MarketingFooter from '../../components/marketing/MarketingFooter';
import { Briefcase, MapPin, Clock, Building2, ArrowRight } from 'lucide-react';
import axios from 'axios';
import SEO from '../../components/SEO';
import './Careers.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

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
    <div className="mcr-page">
      <SEO
        title="Careers"
        description="Join the Storeveu team. Help us build the future of retail technology for independent store owners."
        url="https://storeveu.com/careers"
      />
      <MarketingNavbar />

      {/* Hero */}
      <section className="mcr-hero">
        <div className="mcr-hero-inner">
          <h1 className="mcr-title">
            Join Our <span className="mcr-title-accent">Team</span>
          </h1>
          <p className="mcr-subtitle">
            Help us build the future of retail technology. We are looking for passionate people who want to make a real difference for independent store owners.
          </p>
        </div>
      </section>

      {/* Job Cards */}
      <section className="mcr-section">
        <div className="mcr-container">
          {loading && (
            <div className="mcr-loading">
              <div className="mcr-spinner" />
            </div>
          )}

          {!loading && jobs.length === 0 && (
            <div className="mcr-empty">
              <Briefcase size={48} color="#d1d5db" />
              <h3 className="mcr-empty-title">No Open Positions Right Now</h3>
              <p className="mcr-empty-text">We are always looking for talented people. Check back soon or send your resume to careers@storeveu.com.</p>
            </div>
          )}

          {!loading && jobs.length > 0 && (
            <div className="mcr-list">
              {jobs.map(job => {
                const preview = stripHtml(job.description);
                return (
                  <Link key={job.id} to={`/careers/${job.id}`} className="mcr-job-link">
                    <div className="mcr-job-card">
                      <div className="mcr-job-grid">
                        <div className="mcr-job-body">
                          <h3 className="mcr-job-title">{job.title}</h3>
                          <div className="mcr-badges">
                            {job.department && (
                              <span className="mcr-badge-dept">
                                <Building2 size={13} /> {job.department}
                              </span>
                            )}
                            {job.type && (
                              <span className="mcr-badge-type">{job.type}</span>
                            )}
                          </div>
                          <div className="mcr-meta">
                            {job.location && <span className="mcr-meta-item"><MapPin size={14} /> {job.location}</span>}
                            <span className="mcr-meta-item"><Clock size={14} /> Posted {formatDate(job.createdAt)}</span>
                          </div>
                          {preview && (
                            <p className="mcr-preview">
                              {preview.length > 180 ? preview.slice(0, 180) + '...' : preview}
                            </p>
                          )}
                        </div>
                        <div className="mcr-view-link">
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

      <MarketingFooter />
    </div>
  );
};

export default Careers;
