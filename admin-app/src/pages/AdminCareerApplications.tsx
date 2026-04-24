import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, ChevronDown, ChevronUp, Download, Loader, Save, FileText } from 'lucide-react';

import { getAdminCareerApplications, updateAdminJobApplication } from '../services/api';
import { toast } from 'react-toastify';
import '../styles/admin.css';
import './AdminCareerApplications.css';

// Kept for future badge-color work; not currently read.
const _STATUS_COLORS: Record<string, string> = { new: '#3b82f6', reviewed: '#f59e0b', shortlisted: '#10b981', rejected: '#ef4444' };
void _STATUS_COLORS;
const STATUS_OPTIONS = ['new', 'reviewed', 'shortlisted', 'rejected'] as const;
const FILTER_TABS = ['All', 'New', 'Reviewed', 'Shortlisted', 'Rejected'] as const;

type Status = typeof STATUS_OPTIONS[number];

interface Application {
  id: string | number;
  name: string;
  email: string;
  phone?: string;
  status: Status;
  coverLetter?: string;
  resumeUrl?: string;
  adminNotes?: string;
  createdAt?: string;
}

interface Posting {
  title: string;
  department?: string;
}

interface EditState {
  status: Status;
  adminNotes: string;
}

const AdminCareerApplications = () => {
  const { careerPostingId } = useParams<{ careerPostingId: string }>();
  const [applications, setApplications] = useState<Application[]>([]);
  const [posting, setPosting] = useState<Posting | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<(typeof FILTER_TABS)[number]>('All');
  const [expandedId, setExpandedId] = useState<string | number | null>(null);
  const [editState, setEditState] = useState<Record<string, EditState>>({});
  const [saving, setSaving] = useState<string | number | null>(null);

  useEffect(() => {
    if (!careerPostingId) return;
    getAdminCareerApplications(careerPostingId)
      .then((r) => {
        // Backend returns Status as a narrower literal union; the shared type
        // widens to string, so a cast is safe here.
        setApplications((r.data || []) as Application[]);
        setPosting(r.posting || null);
      })
      .catch(() => toast.error('Failed to load applications'))
      .finally(() => setLoading(false));
  }, [careerPostingId]);

  const filtered = activeFilter === 'All'
    ? applications
    : applications.filter(a => a.status === activeFilter.toLowerCase());

  const toggleExpand = (id: string | number) => {
    if (expandedId === id) {
      setExpandedId(null);
    } else {
      setExpandedId(id);
      const app = applications.find(a => a.id === id);
      if (app && !editState[String(id)]) {
        setEditState(prev => ({ ...prev, [String(id)]: { status: app.status, adminNotes: app.adminNotes || '' } }));
      }
    }
  };

  const handleFieldChange = (id: string | number, field: keyof EditState, value: string) => {
    const key = String(id);
    setEditState(prev => ({
      ...prev,
      [key]: {
        ...(prev[key] ?? { status: 'new', adminNotes: '' }),
        [field]: value,
      } as EditState,
    }));
  };

  const handleSave = async (id: string | number) => {
    const state = editState[String(id)];
    if (!state) return;
    setSaving(id);
    try {
      await updateAdminJobApplication(id, { status: state.status, adminNotes: state.adminNotes });
      setApplications(prev => prev.map(a => a.id === id ? { ...a, status: state.status, adminNotes: state.adminNotes } : a));
      toast.success('Application updated');
    } catch {
      toast.error('Failed to update application');
    } finally {
      setSaving(null);
    }
  };

  return (
    <>
        {/* Back Link */}
        <Link to="/careers" className="admin-back-link">
          <ArrowLeft size={16} /> Back to Careers
        </Link>

        {/* Header */}
        <div className="admin-header">
          <div className="admin-header-left">
            <div className="admin-header-icon"><FileText size={22} /></div>
            <div>
              <h1>{posting?.title || 'Job Applications'}</h1>
              {posting?.department && (
                <p>Department: {posting.department}</p>
              )}
            </div>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="admin-tabs">
          {FILTER_TABS.map(tab => {
            const isActive = activeFilter === tab;
            const count = tab === 'All' ? applications.length : applications.filter(a => a.status === tab.toLowerCase()).length;
            return (
              <button
                key={tab}
                onClick={() => setActiveFilter(tab)}
                className={`admin-tab ${isActive ? 'active' : ''}`}
              >
                {tab} ({count})
              </button>
            );
          })}
        </div>

        {loading ? (
          <div className="admin-loading">
            <Loader className="animate-spin" size={24} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="admin-empty">
            No applications found
          </div>
        ) : (
          <div className="admin-card-list">
            {filtered.map(app => {
              const isExpanded = expandedId === app.id;
              const state: EditState = editState[String(app.id)] || { status: app.status, adminNotes: app.adminNotes || '' };
              return (
                <div key={app.id} className={`admin-expand-row ${isExpanded ? 'active' : ''}`}>
                  {/* Row Header */}
                  <div
                    onClick={() => toggleExpand(app.id)}
                    className="admin-expand-header"
                  >
                    <div className="admin-expand-header-content">
                      <div className="admin-expand-name">{app.name}</div>
                      <div className="admin-expand-meta">{app.email}</div>
                    </div>
                    <div className="admin-expand-detail">{app.phone || '-'}</div>
                    <div className="admin-expand-date">
                      {app.createdAt ? new Date(app.createdAt).toLocaleDateString() : '-'}
                    </div>
                    <span className={`admin-badge ${app.status}`}>{app.status}</span>
                    {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </div>

                  {/* Expanded Detail Panel */}
                  {isExpanded && (
                    <div className="admin-expand-body">
                      <div className="admin-expand-grid">
                        {/* Cover Letter */}
                        <div>
                          <label className="admin-field-label">Cover Letter</label>
                          <div className="admin-cover-letter">
                            {app.coverLetter || 'No cover letter provided.'}
                          </div>

                          {/* Resume Download */}
                          {app.resumeUrl && (
                            <a
                              href={app.resumeUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="admin-resume-link"
                            >
                              <Download size={14} /> Download Resume
                            </a>
                          )}
                        </div>

                        {/* Admin Actions */}
                        <div>
                          {/* Status Dropdown */}
                          <label className="admin-field-label">Status</label>
                          <select
                            value={state.status}
                            onChange={e => handleFieldChange(app.id, 'status', e.target.value)}
                            className="admin-select"
                          >
                            {STATUS_OPTIONS.map(s => (
                              <option key={s} value={s} className="aca-option-dark">{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                            ))}
                          </select>

                          {/* Admin Notes */}
                          <label className="admin-field-label">Admin Notes</label>
                          <textarea
                            value={state.adminNotes}
                            onChange={e => handleFieldChange(app.id, 'adminNotes', e.target.value)}
                            rows={4}
                            placeholder="Add private notes about this applicant..."
                            className="admin-textarea"
                          />

                          {/* Save Button */}
                          <button
                            onClick={() => handleSave(app.id)}
                            disabled={saving === app.id}
                            className={`admin-btn-primary${saving === app.id ? ' aca-save-btn-disabled' : ''}`}
                          >
                            {saving === app.id ? <Loader className="animate-spin" size={14} /> : <Save size={14} />}
                            Save Changes
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
    </>
  );
};

export default AdminCareerApplications;
