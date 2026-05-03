import { useState, useEffect, useCallback, FormEvent } from 'react';
import {
  Loader, X, MessageSquare, Plus, Trash2, Search,
  ChevronLeft, ChevronRight, Send, AlertCircle, Ticket,
} from 'lucide-react';
import { toast } from 'react-toastify';

import {
  getAdminTickets,
  createAdminTicket,
  updateAdminTicket,
  deleteAdminTicket,
  addAdminTicketReply,
  assignAdminTicket,
  getAssignableUsers,
  type AssignableUser,
} from '../services/api';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — useConfirmDialog is a shared .jsx file
import { useConfirm } from '../hooks/useConfirmDialog.jsx';
import '../styles/admin.css';
import './AdminTickets.css';

const STATUS_OPTS = ['open', 'in_progress', 'resolved', 'closed'] as const;
const PRIORITY_OPTS = ['low', 'normal', 'high', 'urgent'] as const;

type Status = typeof STATUS_OPTS[number];
type Priority = typeof PRIORITY_OPTS[number];

const STATUS_COLORS: Record<Status, string> = {
  open: 'at-badge--open',
  in_progress: 'at-badge--progress',
  resolved: 'at-badge--resolved',
  closed: 'at-badge--closed',
};
const PRIORITY_COLORS: Record<Priority, string> = {
  low: 'at-badge--low',
  normal: 'at-badge--normal',
  high: 'at-badge--high',
  urgent: 'at-badge--urgent',
};

interface TicketResponse {
  by: string;
  byType: 'admin' | 'store';
  message: string;
  date: string;
}

interface TicketAssignee {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface SupportTicket {
  id: string | number;
  email: string;
  name?: string;
  subject: string;
  body: string;
  status: Status;
  priority: Priority;
  createdAt: string;
  adminNotes?: string;
  responses?: TicketResponse[];
  assignedToId?: string | null;
  assignedAt?: string | null;
  assignedTo?: TicketAssignee | null;
}

/** Compact 2-letter avatar from a name. */
function initials(name?: string | null): string {
  if (!name) return '??';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || name[0].toUpperCase();
}

interface CreateForm {
  email: string;
  name: string;
  subject: string;
  body: string;
  priority: Priority;
}

function fmtDate(d: string | number | Date): string {
  return new Date(d).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// ── Create Ticket Modal ────────────────────────────────────────────────────
interface CreateModalProps {
  onClose: () => void;
  onCreated: (ticket: SupportTicket) => void;
}

const CreateModal = ({ onClose, onCreated }: CreateModalProps) => {
  const [form, setForm] = useState<CreateForm>({ email: '', name: '', subject: '', body: '', priority: 'normal' });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.email.trim() || !form.subject.trim() || !form.body.trim()) {
      toast.error('Email, subject and message are required');
      return;
    }
    setSaving(true);
    try {
      const res = await createAdminTicket(form);
      toast.success('Ticket created');
      onCreated(res.data);
      onClose();
    } catch { toast.error('Failed to create ticket'); }
    finally { setSaving(false); }
  };

  return (
    <div className="at-overlay" onClick={onClose}>
      <div className="at-modal" onClick={e => e.stopPropagation()}>
        <div className="at-modal-header">
          <h2 className="at-modal-title"><Plus size={16} /> New Ticket</h2>
          <button className="at-modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="at-modal-body">
          <div className="at-form-row">
            <div className="at-form-field">
              <label>Email *</label>
              <input type="email" placeholder="customer@example.com"
                value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required />
            </div>
            <div className="at-form-field">
              <label>Name</label>
              <input type="text" placeholder="Customer name"
                value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
          </div>
          <div className="at-form-field">
            <label>Subject *</label>
            <input type="text" placeholder="Brief description of the issue"
              value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} required />
          </div>
          <div className="at-form-row">
            <div className="at-form-field">
              <label>Priority</label>
              <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value as Priority }))}>
                {PRIORITY_OPTS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>
          <div className="at-form-field">
            <label>Message *</label>
            <textarea rows={5} placeholder="Describe the issue in detail..."
              value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))} required />
          </div>
          <div className="at-modal-actions">
            <button type="button" className="at-btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="at-btn-primary" disabled={saving}>
              {saving ? <Loader size={14} className="at-spin" /> : 'Create Ticket'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ── Ticket Detail Panel ────────────────────────────────────────────────────
interface DetailPanelProps {
  ticket: SupportTicket;
  assignableUsers: AssignableUser[];
  onClose: () => void;
  onUpdated: (ticket: SupportTicket) => void;
  onDeleted: (id: string | number) => void;
}

const DetailPanel = ({ ticket, assignableUsers, onClose, onUpdated, onDeleted }: DetailPanelProps) => {
  const confirm = useConfirm();
  const [local, setLocal] = useState<SupportTicket>(ticket);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [assigning, setAssigning] = useState(false);

  useEffect(() => { setLocal(ticket); }, [ticket]);

  const handleAssign = async (assignedToId: string) => {
    setAssigning(true);
    try {
      const res = await assignAdminTicket(local.id, assignedToId || null);
      setLocal(res.data);
      onUpdated(res.data);
      toast.success(assignedToId ? 'Ticket assigned' : 'Assignment removed');
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to update assignment';
      toast.error(msg);
    } finally { setAssigning(false); }
  };

  const handleField = async (field: string, value: string) => {
    try {
      const updated = await updateAdminTicket(local.id, { [field]: value });
      setLocal(updated.data);
      onUpdated(updated.data);
      toast.success('Updated');
    } catch { toast.error('Update failed'); }
  };

  const handleSaveNotes = async () => {
    setSaving(true);
    try {
      const updated = await updateAdminTicket(local.id, { adminNotes: local.adminNotes });
      setLocal(updated.data);
      onUpdated(updated.data);
      toast.success('Notes saved');
    } catch { toast.error('Failed to save notes'); }
    finally { setSaving(false); }
  };

  const handleReply = async () => {
    if (!reply.trim()) return;
    setSending(true);
    try {
      const updated = await addAdminTicketReply(local.id, { message: reply.trim() });
      setLocal(updated.data);
      onUpdated(updated.data);
      setReply('');
      toast.success('Reply sent');
    } catch { toast.error('Failed to send reply'); }
    finally { setSending(false); }
  };

  const handleDelete = async () => {
    if (!await confirm({
      title: 'Delete this ticket?',
      message: 'This cannot be undone. The full conversation thread, replies, and any internal notes will be permanently removed.',
      confirmLabel: 'Delete',
      danger: true,
    })) return;
    try {
      await deleteAdminTicket(local.id);
      toast.success('Ticket deleted');
      onDeleted(local.id);
      onClose();
    } catch { toast.error('Failed to delete ticket'); }
  };

  const responses: TicketResponse[] = Array.isArray(local.responses) ? local.responses : [];

  return (
    <div className="at-detail">
      {/* Header */}
      <div className="at-detail-header">
        <div className="at-detail-title-row">
          <h3 className="at-detail-title">{local.subject}</h3>
          <button className="at-modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="at-detail-meta">
          <span>{local.email}{local.name ? ` (${local.name})` : ''}</span>
          <span>{fmtDate(local.createdAt)}</span>
        </div>
        <div className="at-detail-controls">
          <div className="at-form-field at-inline-field at-assign-field">
            <label>Assigned To</label>
            <select
              value={local.assignedToId || ''}
              onChange={(e) => handleAssign(e.target.value)}
              disabled={assigning}
            >
              <option value="">— Unassigned —</option>
              {assignableUsers.map(u => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.role}) — {u.email.toLowerCase()}
                </option>
              ))}
            </select>
          </div>
          <div className="at-form-field at-inline-field">
            <label>Status</label>
            <select value={local.status} onChange={e => handleField('status', e.target.value)}>
              {STATUS_OPTS.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
            </select>
          </div>
          <div className="at-form-field at-inline-field">
            <label>Priority</label>
            <select value={local.priority} onChange={e => handleField('priority', e.target.value)}>
              {PRIORITY_OPTS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <button className="at-btn-delete" onClick={handleDelete} title="Delete ticket">
            <Trash2 size={14} /> Delete
          </button>
        </div>
      </div>

      {/* Conversation thread */}
      <div className="at-thread">
        {/* Original message */}
        <div className="at-msg at-msg--store">
          <div className="at-msg-author">{local.name || local.email} <span className="at-msg-tag at-msg-tag--store">Store</span></div>
          <div className="at-msg-body">{local.body}</div>
          <div className="at-msg-date">{fmtDate(local.createdAt)}</div>
        </div>

        {/* Responses */}
        {responses.map((r, i) => (
          <div key={i} className={`at-msg ${r.byType === 'admin' ? 'at-msg--admin' : 'at-msg--store'}`}>
            <div className="at-msg-author">
              {r.by}
              <span className={`at-msg-tag ${r.byType === 'admin' ? 'at-msg-tag--admin' : 'at-msg-tag--store'}`}>
                {r.byType === 'admin' ? 'Support' : 'Store'}
              </span>
            </div>
            <div className="at-msg-body">{r.message}</div>
            <div className="at-msg-date">{fmtDate(r.date)}</div>
          </div>
        ))}
      </div>

      {/* Reply input */}
      {local.status !== 'closed' && (
        <div className="at-reply-box">
          <textarea
            className="at-reply-input"
            rows={3}
            placeholder="Write a reply to the store..."
            value={reply}
            onChange={e => setReply(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleReply(); }}
          />
          <button className="at-btn-send" onClick={handleReply} disabled={sending || !reply.trim()}>
            {sending ? <Loader size={14} className="at-spin" /> : <><Send size={14} /> Send Reply</>}
          </button>
        </div>
      )}

      {/* Admin notes (internal) */}
      <div className="at-notes-box">
        <label className="at-notes-label">📋 Internal Notes (not visible to store)</label>
        <textarea
          className="at-notes-input"
          rows={3}
          placeholder="Internal notes for the support team..."
          value={local.adminNotes || ''}
          onChange={e => setLocal(l => ({ ...l, adminNotes: e.target.value }))}
        />
        <button className="at-btn-secondary at-btn-sm" onClick={handleSaveNotes} disabled={saving}>
          {saving ? <Loader size={12} className="at-spin" /> : 'Save Notes'}
        </button>
      </div>
    </div>
  );
};

// ── Main Page ──────────────────────────────────────────────────────────────
const AdminTickets = () => {
  // confirm not used directly here — DetailPanel has its own. Leaving the
  // import in place so the eslint disable above continues to apply.
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<Status | ''>('');
  // Assignment filter — '' = all, 'unassigned', 'mine', or specific userId
  const [assigneeFilter, setAssigneeFilter] = useState<string>('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<SupportTicket | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [assignableUsers, setAssignableUsers] = useState<AssignableUser[]>([]);
  const limit = 20;

  const fetchTickets = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = { page, limit };
      if (statusFilter) params.status = statusFilter;
      if (search.trim()) params.search = search.trim();
      if (assigneeFilter === 'mine') params.mine = 'true';
      else if (assigneeFilter === 'unassigned') params.assignedToId = 'unassigned';
      else if (assigneeFilter) params.assignedToId = assigneeFilter;
      const res = await getAdminTickets(params);
      setTickets(res.data);
      setTotal(res.total);
    } catch { toast.error('Failed to load tickets'); }
    finally { setLoading(false); }
  }, [page, statusFilter, search, assigneeFilter]);

  useEffect(() => { fetchTickets(); }, [fetchTickets]);

  // Load assignable users once on mount (admin + superadmin, active only).
  useEffect(() => {
    getAssignableUsers()
      .then(res => setAssignableUsers(res.data || []))
      .catch(() => { /* non-blocking — assignment dropdown will be empty */ });
  }, []);

  const handleCreated = (ticket: SupportTicket) => {
    setTickets(prev => [ticket, ...prev]);
    setTotal(t => t + 1);
    setSelected(ticket);
  };

  const handleUpdated = (updated: SupportTicket) => {
    setTickets(prev => prev.map(t => t.id === updated.id ? updated : t));
    if (selected?.id === updated.id) setSelected(updated);
  };

  const handleDeleted = (id: string | number) => {
    setTickets(prev => prev.filter(t => t.id !== id));
    setTotal(t => t - 1);
    if (selected?.id === id) setSelected(null);
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <>

      {/* Page header */}
      <div className="admin-header">
        <div className="admin-header-left">
          <div className="admin-header-icon"><Ticket size={22} /></div>
          <div>
            <h1>Support Tickets</h1>
            <p>{total} ticket{total !== 1 ? 's' : ''} total</p>
          </div>
        </div>
        <button className="at-btn-primary" onClick={() => setShowCreate(true)}>
          <Plus size={15} /> New Ticket
        </button>
      </div>

      {/* Toolbar */}
      <div className="at-toolbar">
        <div className="at-search-wrap">
          <Search size={15} className="at-search-icon" />
          <input
            className="at-search-input"
            placeholder="Search by subject or email…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <div className="at-filter-tabs">
          <button className={`at-filter-tab ${!statusFilter ? 'active' : ''}`}
            onClick={() => { setStatusFilter(''); setPage(1); }}>All</button>
          {STATUS_OPTS.map(s => (
            <button key={s}
              className={`at-filter-tab ${statusFilter === s ? 'active' : ''}`}
              onClick={() => { setStatusFilter(s); setPage(1); }}>
              {s.replace('_', ' ')}
            </button>
          ))}
        </div>
        <div className="at-form-field at-inline-field at-assignee-filter">
          <label>Assigned</label>
          <select
            value={assigneeFilter}
            onChange={(e) => { setAssigneeFilter(e.target.value); setPage(1); }}
          >
            <option value="">All</option>
            <option value="mine">My tickets</option>
            <option value="unassigned">Unassigned</option>
            {assignableUsers.length > 0 && <option disabled>──────────</option>}
            {assignableUsers.map(u => (
              <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
            ))}
          </select>
        </div>
      </div>

      {/* Split layout */}
      <div className={`at-split ${selected ? 'at-split--open' : ''}`}>

        {/* Ticket list */}
        <div className="at-list-col">
          {loading ? (
            <div className="at-loading"><Loader size={22} className="at-spin" /></div>
          ) : tickets.length === 0 ? (
            <div className="at-empty">
              <AlertCircle size={32} />
              <p>No tickets found</p>
            </div>
          ) : (
            tickets.map(t => (
              <div
                key={t.id}
                className={`at-ticket-row ${selected?.id === t.id ? 'at-ticket-row--active' : ''}`}
                onClick={() => setSelected(t)}
              >
                <div className="at-ticket-row-top">
                  <span className="at-ticket-subject">{t.subject}</span>
                  <div className="at-ticket-badges">
                    <span className={`at-badge ${PRIORITY_COLORS[t.priority]}`}>{t.priority}</span>
                    <span className={`at-badge ${STATUS_COLORS[t.status]}`}>{t.status.replace('_', ' ')}</span>
                  </div>
                </div>
                <div className="at-ticket-from">{t.email}{t.name ? ` — ${t.name}` : ''}</div>
                <div className="at-ticket-date">
                  {fmtDate(t.createdAt)}
                  {t.assignedTo && (
                    <span className="at-assignee-chip" title={`Assigned to ${t.assignedTo.name}`}>
                      <span className="at-assignee-avatar">{initials(t.assignedTo.name)}</span>
                      <span className="at-assignee-name">{t.assignedTo.name}</span>
                    </span>
                  )}
                </div>
                {Array.isArray(t.responses) && t.responses.length > 0 && (
                  <div className="at-ticket-replies">
                    <MessageSquare size={11} /> {t.responses.length} repl{t.responses.length === 1 ? 'y' : 'ies'}
                  </div>
                )}
              </div>
            ))
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="at-pagination">
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                <ChevronLeft size={15} />
              </button>
              <span>{page} / {totalPages}</span>
              <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                <ChevronRight size={15} />
              </button>
            </div>
          )}
        </div>

        {/* Detail panel */}
        {selected && (
          <DetailPanel
            ticket={selected}
            assignableUsers={assignableUsers}
            onClose={() => setSelected(null)}
            onUpdated={handleUpdated}
            onDeleted={handleDeleted}
          />
        )}
      </div>

      {/* Create modal */}
      {showCreate && (
        <CreateModal
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
        />
      )}
    </>
  );
};

export default AdminTickets;
