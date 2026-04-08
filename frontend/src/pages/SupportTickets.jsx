import React, { useState, useEffect, useCallback } from 'react';
import {
  Plus, X, Loader, Send, ChevronLeft, MessageSquare,
  AlertCircle, CheckCircle, Clock, XCircle,
} from 'lucide-react';
import { toast } from 'react-toastify';
import Sidebar from '../components/Sidebar';
import {
  getOrgTickets,
  createOrgTicket,
  getOrgTicket,
  addOrgTicketReply,
} from '../services/api';
import './SupportTickets.css';

const STATUS_OPTS = ['open', 'in_progress', 'resolved', 'closed'];

const STATUS_META = {
  open:        { label: 'Open',        cls: 'spt-badge--open',     icon: <AlertCircle size={12} /> },
  in_progress: { label: 'In Progress', cls: 'spt-badge--progress', icon: <Clock size={12} /> },
  resolved:    { label: 'Resolved',    cls: 'spt-badge--resolved', icon: <CheckCircle size={12} /> },
  closed:      { label: 'Closed',      cls: 'spt-badge--closed',   icon: <XCircle size={12} /> },
};

const PRIORITY_META = {
  low:    { cls: 'spt-badge--low' },
  normal: { cls: 'spt-badge--normal' },
  high:   { cls: 'spt-badge--high' },
  urgent: { cls: 'spt-badge--urgent' },
};

function fmtDate(d) {
  return new Date(d).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// ── Create Ticket Form ─────────────────────────────────────────────────────
const CreateForm = ({ onClose, onCreated }) => {
  const [form, setForm]     = useState({ subject: '', body: '', priority: 'normal' });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.subject.trim() || !form.body.trim()) {
      toast.error('Subject and message are required');
      return;
    }
    setSaving(true);
    try {
      const res = await createOrgTicket(form);
      toast.success('Ticket submitted! Our team will respond shortly.');
      onCreated(res.data);
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to submit ticket');
    } finally { setSaving(false); }
  };

  return (
    <div className="spt-overlay" onClick={onClose}>
      <div className="spt-modal" onClick={e => e.stopPropagation()}>
        <div className="spt-modal-header">
          <h2 className="spt-modal-title">Submit Support Ticket</h2>
          <button className="spt-modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="spt-modal-body">
          <div className="spt-form-field">
            <label>Subject *</label>
            <input
              type="text"
              placeholder="Brief description of your issue"
              value={form.subject}
              onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
              required
            />
          </div>
          <div className="spt-form-field">
            <label>Priority</label>
            <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>
          <div className="spt-form-field">
            <label>Message *</label>
            <textarea
              rows={6}
              placeholder="Describe your issue in detail. Include any relevant information such as error messages, steps to reproduce, etc."
              value={form.body}
              onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
              required
            />
          </div>
          <div className="spt-modal-actions">
            <button type="button" className="spt-btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="spt-btn-primary" disabled={saving}>
              {saving ? <Loader size={14} className="spt-spin" /> : <><Send size={14} /> Submit Ticket</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ── Ticket Detail View ─────────────────────────────────────────────────────
const TicketDetail = ({ ticketId, onBack, onUpdated }) => {
  const [ticket, setTicket]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [reply, setReply]     = useState('');
  const [sending, setSending] = useState(false);

  const fetchTicket = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getOrgTicket(ticketId);
      setTicket(res.data);
    } catch { toast.error('Failed to load ticket'); }
    finally { setLoading(false); }
  }, [ticketId]);

  useEffect(() => { fetchTicket(); }, [fetchTicket]);

  const handleReply = async () => {
    if (!reply.trim()) return;
    setSending(true);
    try {
      const res = await addOrgTicketReply(ticketId, { message: reply.trim() });
      setTicket(res.data);
      onUpdated(res.data);
      setReply('');
      toast.success('Reply sent');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to send reply');
    } finally { setSending(false); }
  };

  if (loading) return <div className="spt-loading"><Loader size={22} className="spt-spin" /></div>;
  if (!ticket) return <div className="spt-empty"><AlertCircle size={28} /><p>Ticket not found</p></div>;

  const responses = Array.isArray(ticket.responses) ? ticket.responses : [];
  const sm = STATUS_META[ticket.status] || STATUS_META.open;
  const pm = PRIORITY_META[ticket.priority] || PRIORITY_META.normal;

  return (
    <div className="spt-detail">
      <button className="spt-back-btn" onClick={onBack}>
        <ChevronLeft size={16} /> Back to tickets
      </button>

      <div className="spt-detail-card">
        <div className="spt-detail-head">
          <h2 className="spt-detail-subject">{ticket.subject}</h2>
          <div className="spt-detail-badges">
            <span className={`spt-badge ${sm.cls}`}>{sm.icon} {sm.label}</span>
            <span className={`spt-badge ${pm.cls}`}>{ticket.priority}</span>
          </div>
          <div className="spt-detail-meta">
            <span>Submitted {fmtDate(ticket.createdAt)}</span>
            {ticket.name && <span>by {ticket.name}</span>}
          </div>
        </div>

        {/* Thread */}
        <div className="spt-thread">
          {/* Original message */}
          <div className="spt-msg spt-msg--store">
            <div className="spt-msg-header">
              <span className="spt-msg-author">{ticket.name || ticket.email}</span>
              <span className="spt-msg-tag spt-msg-tag--store">You</span>
              <span className="spt-msg-date">{fmtDate(ticket.createdAt)}</span>
            </div>
            <div className="spt-msg-body">{ticket.body}</div>
          </div>

          {/* Responses */}
          {responses.map((r, i) => (
            <div key={i} className={`spt-msg ${r.byType === 'admin' ? 'spt-msg--admin' : 'spt-msg--store'}`}>
              <div className="spt-msg-header">
                <span className="spt-msg-author">{r.by}</span>
                <span className={`spt-msg-tag ${r.byType === 'admin' ? 'spt-msg-tag--admin' : 'spt-msg-tag--store'}`}>
                  {r.byType === 'admin' ? 'Support Team' : 'You'}
                </span>
                <span className="spt-msg-date">{fmtDate(r.date)}</span>
              </div>
              <div className="spt-msg-body">{r.message}</div>
            </div>
          ))}

          {responses.length === 0 && (
            <div className="spt-awaiting">
              <Clock size={16} />
              <span>Awaiting response from our support team…</span>
            </div>
          )}
        </div>

        {/* Reply */}
        {ticket.status !== 'closed' ? (
          <div className="spt-reply-box">
            <textarea
              className="spt-reply-input"
              rows={4}
              placeholder="Add a reply or additional information…"
              value={reply}
              onChange={e => setReply(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleReply(); }}
            />
            <div className="spt-reply-footer">
              <span className="spt-reply-hint">Ctrl+Enter to send</span>
              <button className="spt-btn-primary" onClick={handleReply} disabled={sending || !reply.trim()}>
                {sending ? <Loader size={14} className="spt-spin" /> : <><Send size={14} /> Send Reply</>}
              </button>
            </div>
          </div>
        ) : (
          <div className="spt-closed-notice">
            <XCircle size={16} /> This ticket is closed. Submit a new ticket if you need further assistance.
          </div>
        )}
      </div>
    </div>
  );
};

// ── Main Page ──────────────────────────────────────────────────────────────
const SupportTickets = () => {
  const [tickets, setTickets]     = useState([]);
  const [total, setTotal]         = useState(0);
  const [loading, setLoading]     = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage]           = useState(1);
  const [selectedId, setSelectedId] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const limit = 15;

  const fetchTickets = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit };
      if (statusFilter) params.status = statusFilter;
      const res = await getOrgTickets(params);
      setTickets(res.data);
      setTotal(res.total);
    } catch { toast.error('Failed to load tickets'); }
    finally { setLoading(false); }
  }, [page, statusFilter]);

  useEffect(() => { fetchTickets(); }, [fetchTickets]);

  const handleCreated = (ticket) => {
    setTickets(prev => [ticket, ...prev]);
    setTotal(t => t + 1);
    setSelectedId(ticket.id);
  };

  const handleUpdated = (updated) => {
    setTickets(prev => prev.map(t => t.id === updated.id ? updated : t));
  };

  if (selectedId) {
    return (
      <div className="layout-container">
        <Sidebar />
        <main className="main-content">
          <TicketDetail
            ticketId={selectedId}
            onBack={() => setSelectedId(null)}
            onUpdated={handleUpdated}
          />
        </main>
      </div>
    );
  }

  return (
    <div className="layout-container">
      <Sidebar />
      <main className="main-content">
        <div className="spt-page">
          {/* Header */}
          <div className="spt-header">
            <div className="spt-header-left">
              <h1 className="spt-title">Support Tickets</h1>
              <p className="spt-subtitle">Submit and track your support requests</p>
            </div>
            <button className="spt-btn-primary" onClick={() => setShowCreate(true)}>
              <Plus size={15} /> New Ticket
            </button>
          </div>

          {/* Status filter tabs */}
          <div className="spt-filter-row">
            <button
              className={`spt-filter-tab ${!statusFilter ? 'active' : ''}`}
              onClick={() => { setStatusFilter(''); setPage(1); }}>
              All <span className="spt-count">{total}</span>
            </button>
            {STATUS_OPTS.map(s => {
              const sm = STATUS_META[s];
              return (
                <button key={s}
                  className={`spt-filter-tab ${statusFilter === s ? 'active' : ''}`}
                  onClick={() => { setStatusFilter(s); setPage(1); }}>
                  {sm.label}
                </button>
              );
            })}
          </div>

          {/* Ticket list */}
          {loading ? (
            <div className="spt-loading"><Loader size={24} className="spt-spin" /></div>
          ) : tickets.length === 0 ? (
            <div className="spt-empty">
              <MessageSquare size={40} />
              <p>No tickets yet</p>
              <p className="spt-empty-sub">Submit a ticket and our support team will get back to you</p>
              <button className="spt-btn-primary" onClick={() => setShowCreate(true)}>
                <Plus size={14} /> Submit your first ticket
              </button>
            </div>
          ) : (
            <div className="spt-list">
              {tickets.map(t => {
                const sm = STATUS_META[t.status] || STATUS_META.open;
                const pm = PRIORITY_META[t.priority] || PRIORITY_META.normal;
                const responses = Array.isArray(t.responses) ? t.responses : [];
                return (
                  <div key={t.id} className="spt-ticket-card" onClick={() => setSelectedId(t.id)}>
                    <div className="spt-card-top">
                      <h3 className="spt-card-subject">{t.subject}</h3>
                      <div className="spt-card-badges">
                        <span className={`spt-badge ${pm.cls}`}>{t.priority}</span>
                        <span className={`spt-badge ${sm.cls}`}>{sm.icon} {sm.label}</span>
                      </div>
                    </div>
                    <p className="spt-card-preview">{t.body.slice(0, 120)}{t.body.length > 120 ? '…' : ''}</p>
                    <div className="spt-card-footer">
                      <span className="spt-card-date">{fmtDate(t.createdAt)}</span>
                      {responses.length > 0 && (
                        <span className="spt-card-replies">
                          <MessageSquare size={12} /> {responses.length} repl{responses.length === 1 ? 'y' : 'ies'}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Pagination */}
          {Math.ceil(total / limit) > 1 && (
            <div className="spt-pagination">
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Previous</button>
              <span>Page {page} of {Math.ceil(total / limit)}</span>
              <button disabled={page >= Math.ceil(total / limit)} onClick={() => setPage(p => p + 1)}>Next →</button>
            </div>
          )}
        </div>

        {/* Create modal */}
        {showCreate && (
          <CreateForm
            onClose={() => setShowCreate(false)}
            onCreated={handleCreated}
          />
        )}
      </main>
    </div>
  );
};

export default SupportTickets;
