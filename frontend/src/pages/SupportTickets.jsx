import React, { useState, useEffect, useCallback } from 'react';
import {
  Plus, X, Loader, Send, ChevronLeft, MessageSquare,
  AlertCircle, CheckCircle, Clock, XCircle,
} from 'lucide-react';
import { toast } from 'react-toastify';

import {
  getOrgTickets,
  createOrgTicket,
  getOrgTicket,
  addOrgTicketReply,
} from '../services/api';
import '../styles/portal.css';
import './SupportTickets.css';

const STATUS_OPTS = ['open', 'in_progress', 'resolved', 'closed'];

const STATUS_META = {
  open:        { label: 'Open',        cls: 'st-badge--open',     icon: <AlertCircle size={12} /> },
  in_progress: { label: 'In Progress', cls: 'st-badge--progress', icon: <Clock size={12} /> },
  resolved:    { label: 'Resolved',    cls: 'st-badge--resolved', icon: <CheckCircle size={12} /> },
  closed:      { label: 'Closed',      cls: 'st-badge--closed',   icon: <XCircle size={12} /> },
};

const PRIORITY_META = {
  low:    { cls: 'st-badge--low' },
  normal: { cls: 'st-badge--normal' },
  high:   { cls: 'st-badge--high' },
  urgent: { cls: 'st-badge--urgent' },
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
    <div className="p-modal-overlay" onClick={onClose}>
      <div className="p-modal p-modal-lg" onClick={e => e.stopPropagation()}>
        <div className="p-modal-header">
          <h2 className="p-modal-title">Submit Support Ticket</h2>
          <button className="p-modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="st-form-field">
            <label>Subject *</label>
            <input
              className="p-input"
              type="text"
              placeholder="Brief description of your issue"
              value={form.subject}
              onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
              required
            />
          </div>
          <div className="st-form-field">
            <label>Priority</label>
            <select
              className="p-select"
              value={form.priority}
              onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>
          <div className="st-form-field">
            <label>Message *</label>
            <textarea
              className="p-input"
              rows={6}
              placeholder="Describe your issue in detail. Include any relevant information such as error messages, steps to reproduce, etc."
              value={form.body}
              onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
              required
            />
          </div>
          <div className="p-form-actions">
            <button type="button" className="p-btn p-btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="p-btn p-btn-primary" disabled={saving}>
              {saving ? <Loader size={14} className="st-spin" /> : <><Send size={14} /> Submit Ticket</>}
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

  if (loading) return <div className="p-loading"><Loader size={22} className="p-spin" /> Loading ticket...</div>;
  if (!ticket) return <div className="p-empty"><AlertCircle size={28} /><p>Ticket not found</p></div>;

  const responses = Array.isArray(ticket.responses) ? ticket.responses : [];
  const sm = STATUS_META[ticket.status] || STATUS_META.open;
  const pm = PRIORITY_META[ticket.priority] || PRIORITY_META.normal;

  return (
    <div className="st-detail">
      <button className="st-back-btn" onClick={onBack}>
        <ChevronLeft size={16} /> Back to tickets
      </button>

      <div className="st-detail-card">
        <div className="st-detail-head">
          <h2 className="st-detail-subject">{ticket.subject}</h2>
          <div className="st-detail-badges">
            <span className={`st-badge ${sm.cls}`}>{sm.icon} {sm.label}</span>
            <span className={`st-badge ${pm.cls}`}>{ticket.priority}</span>
          </div>
          <div className="st-detail-meta">
            <span>Submitted {fmtDate(ticket.createdAt)}</span>
            {ticket.name && <span>by {ticket.name}</span>}
          </div>
        </div>

        {/* Thread */}
        <div className="st-thread">
          {/* Original message */}
          <div className="st-msg st-msg--store">
            <div className="st-msg-header">
              <span className="st-msg-author">{ticket.name || ticket.email}</span>
              <span className="st-msg-tag st-msg-tag--store">You</span>
              <span className="st-msg-date">{fmtDate(ticket.createdAt)}</span>
            </div>
            <div className="st-msg-body">{ticket.body}</div>
          </div>

          {/* Responses */}
          {responses.map((r, i) => (
            <div key={i} className={`st-msg ${r.byType === 'admin' ? 'st-msg--admin' : 'st-msg--store'}`}>
              <div className="st-msg-header">
                <span className="st-msg-author">{r.by}</span>
                <span className={`st-msg-tag ${r.byType === 'admin' ? 'st-msg-tag--admin' : 'st-msg-tag--store'}`}>
                  {r.byType === 'admin' ? 'Support Team' : 'You'}
                </span>
                <span className="st-msg-date">{fmtDate(r.date)}</span>
              </div>
              <div className="st-msg-body">{r.message}</div>
            </div>
          ))}

          {responses.length === 0 && (
            <div className="st-awaiting">
              <Clock size={16} />
              <span>Awaiting response from our support team...</span>
            </div>
          )}
        </div>

        {/* Reply */}
        {ticket.status !== 'closed' ? (
          <div className="st-reply-box">
            <textarea
              className="st-reply-input"
              rows={4}
              placeholder="Add a reply or additional information..."
              value={reply}
              onChange={e => setReply(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleReply(); }}
            />
            <div className="st-reply-footer">
              <span className="st-reply-hint">Ctrl+Enter to send</span>
              <button className="p-btn p-btn-primary" onClick={handleReply} disabled={sending || !reply.trim()}>
                {sending ? <Loader size={14} className="st-spin" /> : <><Send size={14} /> Send Reply</>}
              </button>
            </div>
          </div>
        ) : (
          <div className="st-closed-notice">
            <XCircle size={16} /> This ticket is closed. Submit a new ticket if you need further assistance.
          </div>
        )}
      </div>
    </div>
  );
};

// ── Main Page ──────────────────────────────────────────────────────────────
const SupportTickets = ({ embedded } = {}) => {
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
      <div className="p-page">
        <TicketDetail
          ticketId={selectedId}
          onBack={() => setSelectedId(null)}
          onUpdated={handleUpdated}
        />
      </div>
    );
  }

  return (
    <div className="p-page">
      <div className="st-page">
        {/* Header */}
        <div className="p-header">
          <div className="p-header-left">
            <div className="p-header-icon">
              <MessageSquare size={22} />
            </div>
            <div>
              <h1 className="p-title">Support Tickets</h1>
              <p className="p-subtitle">Submit and track your support requests</p>
            </div>
          </div>
          <div className="p-header-actions">
            <button className="p-btn p-btn-primary" onClick={() => setShowCreate(true)}>
              <Plus size={15} /> New Ticket
            </button>
          </div>
        </div>

        {/* Status filter tabs */}
        <div className="st-filters">
          <button
            className={`st-filter-tab ${!statusFilter ? 'active' : ''}`}
            onClick={() => { setStatusFilter(''); setPage(1); }}>
            All <span className="st-count">{total}</span>
          </button>
          {STATUS_OPTS.map(s => {
            const sm = STATUS_META[s];
            return (
              <button key={s}
                className={`st-filter-tab ${statusFilter === s ? 'active' : ''}`}
                onClick={() => { setStatusFilter(s); setPage(1); }}>
                {sm.label}
              </button>
            );
          })}
        </div>

        {/* Ticket list */}
        {loading ? (
          <div className="p-loading"><Loader size={24} className="p-spin" /> Loading tickets...</div>
        ) : tickets.length === 0 ? (
          <div className="p-empty">
            <MessageSquare size={40} />
            <p>No tickets yet</p>
            <p>Submit a ticket and our support team will get back to you</p>
            <button className="p-btn p-btn-primary" onClick={() => setShowCreate(true)}>
              <Plus size={14} /> Submit your first ticket
            </button>
          </div>
        ) : (
          <div className="st-list">
            {tickets.map(t => {
              const sm = STATUS_META[t.status] || STATUS_META.open;
              const pm = PRIORITY_META[t.priority] || PRIORITY_META.normal;
              const responses = Array.isArray(t.responses) ? t.responses : [];
              return (
                <div key={t.id} className="st-ticket-card" onClick={() => setSelectedId(t.id)}>
                  <div className="st-card-top">
                    <h3 className="st-card-subject">{t.subject}</h3>
                    <div className="st-card-badges">
                      <span className={`st-badge ${pm.cls}`}>{t.priority}</span>
                      <span className={`st-badge ${sm.cls}`}>{sm.icon} {sm.label}</span>
                    </div>
                  </div>
                  <p className="st-card-preview">{t.body.slice(0, 120)}{t.body.length > 120 ? '...' : ''}</p>
                  <div className="st-card-footer">
                    <span className="st-card-date">{fmtDate(t.createdAt)}</span>
                    {responses.length > 0 && (
                      <span className="st-card-replies">
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
          <div className="st-pagination">
            <button className="p-btn p-btn-ghost p-btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
              Previous
            </button>
            <span>Page {page} of {Math.ceil(total / limit)}</span>
            <button className="p-btn p-btn-ghost p-btn-sm" disabled={page >= Math.ceil(total / limit)} onClick={() => setPage(p => p + 1)}>
              Next
            </button>
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
    </div>
  );
};

export default SupportTickets;
