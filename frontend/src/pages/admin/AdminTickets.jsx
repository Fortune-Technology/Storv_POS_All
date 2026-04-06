import React, { useState, useEffect, useCallback } from 'react';
import { Loader, X, MessageSquare } from 'lucide-react';
import { toast } from 'react-toastify';
import AdminSidebar from '../../components/AdminSidebar';
import { getAdminTickets, updateAdminTicket } from '../../services/api';
import './admin.css';

const STATUS_OPTS = ['open', 'in_progress', 'resolved', 'closed'];
const PRIORITY_OPTS = ['low', 'normal', 'high', 'urgent'];

const AdminTickets = () => {
  const [tickets, setTickets] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState(null);
  const limit = 25;

  const fetchTickets = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit };
      if (filter) params.status = filter;
      const res = await getAdminTickets(params);
      setTickets(res.data);
      setTotal(res.total);
    } catch { toast.error('Failed to load tickets'); }
    finally { setLoading(false); }
  }, [page, filter]);

  useEffect(() => { fetchTickets(); }, [fetchTickets]);

  const handleUpdateTicket = async (id, data) => {
    try {
      await updateAdminTicket(id, data);
      toast.success('Ticket updated');
      fetchTickets();
      if (detail?.id === id) setDetail(d => ({ ...d, ...data }));
    } catch { toast.error('Update failed'); }
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="layout-container">
      <AdminSidebar />
      <main className="main-content admin-page">
        <div className="admin-header">
          <div className="admin-header-left">
            <h1>Support Tickets</h1>
            <p>Manage customer support requests</p>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="admin-tabs">
          <button onClick={() => { setFilter(''); setPage(1); }}
            className={`admin-tab${!filter ? ' active' : ''}`}>
            All
          </button>
          {STATUS_OPTS.map(s => (
            <button key={s} onClick={() => { setFilter(s); setPage(1); }}
              className={`admin-tab${filter === s ? ' active' : ''}`}>
              {s.replace('_', ' ')}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="admin-loading"><Loader className="animate-spin" size={20} /></div>
        ) : tickets.length === 0 ? (
          <div className="admin-empty"><span className="admin-empty-text">No tickets found</span></div>
        ) : (
          <div className="admin-card-list" style={{ gap: '0.5rem' }}>
            {tickets.map(t => (
              <div key={t.id} className="admin-ticket-card" onClick={() => setDetail(t)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div className="admin-ticket-subject">{t.subject}</div>
                    <div className="admin-ticket-from">{t.email} {t.name && `(${t.name})`}</div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                    <span className={`admin-badge sm ${t.priority}`}>{t.priority}</span>
                    <span className={`admin-badge sm ${t.status}`}>{t.status.replace('_', ' ')}</span>
                  </div>
                </div>
                <div className="admin-ticket-date">{new Date(t.createdAt).toLocaleString()}</div>
              </div>
            ))}
          </div>
        )}

        {totalPages > 1 && (
          <div className="admin-pagination">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</button>
            <span className="page-info">Page {page} of {totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</button>
          </div>
        )}

        {/* Detail modal */}
        {detail && (
          <div className="admin-modal-overlay" onClick={() => setDetail(null)}>
            <div className="admin-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '550px' }}>
              <div className="admin-modal-header">
                <div className="admin-header-icon">
                  <MessageSquare size={18} style={{ color: 'var(--accent-primary)' }} />
                  <h2 className="admin-modal-title">Ticket Detail</h2>
                </div>
                <button onClick={() => setDetail(null)} className="admin-modal-close"><X size={18} /></button>
              </div>
              <div className="admin-modal-form">
                <div style={{ fontSize: '0.85rem' }}><strong>Subject:</strong> {detail.subject}</div>
                <div style={{ fontSize: '0.85rem' }}><strong>From:</strong> {detail.email} {detail.name && `(${detail.name})`}</div>
                <div style={{ fontSize: '0.85rem' }}><strong>Date:</strong> {new Date(detail.createdAt).toLocaleString()}</div>
                <div style={{ background: '#f9fafb', borderRadius: '8px', padding: '1rem', fontSize: '0.85rem', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{detail.body}</div>
                <div className="admin-modal-row">
                  <div className="admin-modal-field">
                    <label>Status</label>
                    <select value={detail.status} onChange={e => handleUpdateTicket(detail.id, { status: e.target.value })}>
                      {STATUS_OPTS.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                    </select>
                  </div>
                  <div className="admin-modal-field">
                    <label>Priority</label>
                    <select value={detail.priority} onChange={e => handleUpdateTicket(detail.id, { priority: e.target.value })}>
                      {PRIORITY_OPTS.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                </div>
                <div className="admin-modal-field">
                  <label>Admin Notes</label>
                  <textarea value={detail.adminNotes || ''} onChange={e => setDetail(d => ({ ...d, adminNotes: e.target.value }))} rows={3} />
                  <button onClick={() => handleUpdateTicket(detail.id, { adminNotes: detail.adminNotes })}
                    className="admin-btn-primary" style={{ marginTop: '0.5rem' }}>
                    Save Notes
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default AdminTickets;
