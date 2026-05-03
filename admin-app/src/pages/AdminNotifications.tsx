import { useState, useEffect, useCallback, FormEvent } from 'react';
import {
  Loader, X, Plus, Trash2, Send, Megaphone, Globe, Building2, Store as StoreIcon, User,
} from 'lucide-react';
import { toast } from 'react-toastify';
import {
  adminBroadcastNotification,
  adminListBroadcasts,
  adminRecallBroadcast,
  getAdminOrganizations,
  getAdminStores,
  getAdminUsers,
  type AdminNotificationBroadcastInput,
  type AdminNotificationRow,
  type Organization,
  type AdminStore,
  type AdminUser,
} from '../services/api';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — useConfirmDialog is a shared .jsx file
import { useConfirm } from '../hooks/useConfirmDialog.jsx';
import '../styles/admin.css';
import './AdminNotifications.css';

type Audience = 'platform' | 'org' | 'store' | 'user';
type Priority = 'low' | 'normal' | 'high' | 'urgent';
type NotifType = 'info' | 'success' | 'warning' | 'error';

const AUDIENCE_OPTS: Audience[] = ['platform', 'org', 'store', 'user'];
const PRIORITY_OPTS: Priority[] = ['low', 'normal', 'high', 'urgent'];
const TYPE_OPTS:     NotifType[] = ['info', 'success', 'warning', 'error'];

const AUDIENCE_LABEL: Record<Audience, string> = {
  platform: 'Entire platform',
  org:      'Specific organization',
  store:    'Specific store',
  user:     'Single user',
};
const AUDIENCE_ICON: Record<Audience, typeof Globe> = {
  platform: Globe,
  org:      Building2,
  store:    StoreIcon,
  user:     User,
};

interface FormState {
  title:         string;
  message:       string;
  audience:      Audience;
  targetOrgId:   string;
  targetStoreId: string;
  targetUserId:  string;
  priority:      Priority;
  type:          NotifType;
  linkUrl:       string;
  expiresAt:     string;
}

const EMPTY_FORM: FormState = {
  title: '', message: '',
  audience: 'platform',
  targetOrgId: '', targetStoreId: '', targetUserId: '',
  priority: 'normal', type: 'info',
  linkUrl: '', expiresAt: '',
};

function fmtDate(s: string): string {
  try {
    return new Date(s).toLocaleString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return s; }
}

const AdminNotifications = () => {
  const confirm = useConfirm();
  const [tab, setTab] = useState<'compose' | 'history'>('compose');

  // Form state
  const [form, setForm]       = useState<FormState>(EMPTY_FORM);
  const [sending, setSending] = useState(false);

  // Targeting choices
  const [orgs, setOrgs]   = useState<Organization[]>([]);
  const [stores, setStores] = useState<AdminStore[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);

  // History
  const [rows, setRows]     = useState<AdminNotificationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage]     = useState(1);
  const [total, setTotal]   = useState(0);
  const limit = 25;

  // Load orgs/stores/users on mount for the target dropdowns
  useEffect(() => {
    Promise.all([
      getAdminOrganizations({ limit: 500 }).then(r => r.organizations || r.data || []).catch(() => []),
      getAdminStores({ limit: 500 }).then(r => r.stores || r.data || []).catch(() => []),
      getAdminUsers({ limit: 500 }).then(r => r.data || []).catch(() => []),
    ]).then(([o, s, u]) => {
      setOrgs(o as Organization[]);
      setStores(s as AdminStore[]);
      setUsers(u as AdminUser[]);
    });
  }, []);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminListBroadcasts({ page, limit });
      setRows(res.data || []);
      setTotal(res.total || 0);
    } catch { toast.error('Failed to load history'); }
    finally { setLoading(false); }
  }, [page]);

  useEffect(() => { if (tab === 'history') fetchHistory(); }, [tab, fetchHistory]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.title.trim())   { toast.error('Title is required');   return; }
    if (!form.message.trim()) { toast.error('Message is required'); return; }

    if (form.audience === 'org'   && !form.targetOrgId)   { toast.error('Pick an organization'); return; }
    if (form.audience === 'store' && !form.targetStoreId) { toast.error('Pick a store');         return; }
    if (form.audience === 'user'  && !form.targetUserId)  { toast.error('Pick a user');          return; }

    if (form.audience === 'platform') {
      if (!await confirm({
        title: 'Send to entire platform?',
        message: `This will deliver "${form.title.trim()}" to every active user across every organization. Are you sure?`,
        confirmLabel: 'Send to all',
        danger: true,
      })) return;
    }

    setSending(true);
    try {
      const payload: AdminNotificationBroadcastInput = {
        title:    form.title.trim(),
        message:  form.message.trim(),
        audience: form.audience,
        priority: form.priority,
        type:     form.type,
        linkUrl:  form.linkUrl.trim() || null,
        expiresAt: form.expiresAt || null,
      };
      if (form.audience === 'org')   payload.targetOrgId   = form.targetOrgId;
      if (form.audience === 'store') payload.targetStoreId = form.targetStoreId;
      if (form.audience === 'user')  payload.targetUserId  = form.targetUserId;

      const res = await adminBroadcastNotification(payload);
      toast.success(`Sent — ${res.deliveryCount} recipient${res.deliveryCount === 1 ? '' : 's'}`);
      setForm(EMPTY_FORM);
      // Switch to history so the operator sees the new entry
      setTab('history');
      setPage(1);
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to send notification';
      toast.error(msg);
    } finally {
      setSending(false);
    }
  };

  const handleRecall = async (row: AdminNotificationRow) => {
    if (!await confirm({
      title:    'Recall this notification?',
      message:  `"${row.title}" will be deleted from every recipient's inbox. This cannot be undone.`,
      confirmLabel: 'Recall',
      danger:   true,
    })) return;
    try {
      await adminRecallBroadcast(row.id);
      toast.success('Notification recalled');
      setRows(prev => prev.filter(r => r.id !== row.id));
      setTotal(t => t - 1);
    } catch { toast.error('Recall failed'); }
  };

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <>
      {/* Page header */}
      <div className="admin-header">
        <div className="admin-header-left">
          <div className="admin-header-icon"><Megaphone size={22} /></div>
          <div>
            <h1>Notifications</h1>
            <p>Broadcast to organizations, stores, or individual users</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="an-tabs">
        <button
          className={`an-tab ${tab === 'compose' ? 'active' : ''}`}
          onClick={() => setTab('compose')}
        >
          <Plus size={14} /> Compose
        </button>
        <button
          className={`an-tab ${tab === 'history' ? 'active' : ''}`}
          onClick={() => setTab('history')}
        >
          <Megaphone size={14} /> History {total > 0 && <span className="an-tab-count">{total}</span>}
        </button>
      </div>

      {tab === 'compose' && (
        <form onSubmit={handleSubmit} className="an-form">
          <div className="an-form-grid">
            <div className="an-form-field an-form-field--full">
              <label>Title *</label>
              <input
                type="text"
                placeholder="Short headline (visible in the bell)"
                value={form.title}
                maxLength={140}
                onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))}
                required
              />
              <span className="an-help">{form.title.length}/140 characters</span>
            </div>

            <div className="an-form-field an-form-field--full">
              <label>Message *</label>
              <textarea
                rows={4}
                placeholder="Body of the notification (Markdown not supported)"
                value={form.message}
                maxLength={2000}
                onChange={(e) => setForm(f => ({ ...f, message: e.target.value }))}
                required
              />
              <span className="an-help">{form.message.length}/2000 characters</span>
            </div>

            <div className="an-form-field an-form-field--full">
              <label>Audience *</label>
              <div className="an-audience-grid">
                {AUDIENCE_OPTS.map((aud) => {
                  const Icon = AUDIENCE_ICON[aud];
                  return (
                    <button
                      key={aud}
                      type="button"
                      className={`an-audience-btn ${form.audience === aud ? 'active' : ''}`}
                      onClick={() => setForm(f => ({ ...f, audience: aud }))}
                    >
                      <Icon size={16} />
                      <span>{AUDIENCE_LABEL[aud]}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {form.audience === 'org' && (
              <div className="an-form-field an-form-field--full">
                <label>Organization *</label>
                <select
                  value={form.targetOrgId}
                  onChange={(e) => setForm(f => ({ ...f, targetOrgId: e.target.value }))}
                  required
                >
                  <option value="">— Select organization —</option>
                  {orgs.map(o => (
                    <option key={o.id} value={String(o.id)}>{o.name}</option>
                  ))}
                </select>
              </div>
            )}

            {form.audience === 'store' && (
              <div className="an-form-field an-form-field--full">
                <label>Store *</label>
                <select
                  value={form.targetStoreId}
                  onChange={(e) => setForm(f => ({ ...f, targetStoreId: e.target.value }))}
                  required
                >
                  <option value="">— Select store —</option>
                  {stores.map(s => (
                    <option key={s.id} value={String(s.id)}>
                      {s.name}{s.organization?.name ? ` — ${s.organization.name}` : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {form.audience === 'user' && (
              <div className="an-form-field an-form-field--full">
                <label>User *</label>
                <select
                  value={form.targetUserId}
                  onChange={(e) => setForm(f => ({ ...f, targetUserId: e.target.value }))}
                  required
                >
                  <option value="">— Select user —</option>
                  {users.filter(u => u.status === 'active').map(u => (
                    <option key={u.id} value={String(u.id)}>
                      {u.name} ({u.role}) — {(u.email || '').toLowerCase()}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="an-form-field">
              <label>Priority</label>
              <select value={form.priority} onChange={(e) => setForm(f => ({ ...f, priority: e.target.value as Priority }))}>
                {PRIORITY_OPTS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>

            <div className="an-form-field">
              <label>Type</label>
              <select value={form.type} onChange={(e) => setForm(f => ({ ...f, type: e.target.value as NotifType }))}>
                {TYPE_OPTS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            <div className="an-form-field an-form-field--full">
              <label>Click-through link (optional)</label>
              <input
                type="text"
                placeholder="/portal/online-orders or https://example.com"
                value={form.linkUrl}
                onChange={(e) => setForm(f => ({ ...f, linkUrl: e.target.value }))}
              />
              <span className="an-help">Internal paths start with /. Recipients click the notification to open this URL.</span>
            </div>

            <div className="an-form-field">
              <label>Auto-expire (optional)</label>
              <input
                type="datetime-local"
                value={form.expiresAt}
                onChange={(e) => setForm(f => ({ ...f, expiresAt: e.target.value }))}
              />
              <span className="an-help">After this time, notification stops appearing in inboxes.</span>
            </div>
          </div>

          <div className="an-form-actions">
            <button
              type="button"
              className="at-btn-secondary"
              onClick={() => setForm(EMPTY_FORM)}
              disabled={sending}
            >
              Reset
            </button>
            <button
              type="submit"
              className="at-btn-primary"
              disabled={sending}
            >
              {sending ? <Loader size={14} className="at-spin" /> : <><Send size={14} /> Send Notification</>}
            </button>
          </div>
        </form>
      )}

      {tab === 'history' && (
        <div className="an-history">
          {loading ? (
            <div className="an-loading"><Loader size={22} className="at-spin" /></div>
          ) : rows.length === 0 ? (
            <div className="an-empty">
              <Megaphone size={32} />
              <p>No broadcasts yet. Send your first notification from the Compose tab.</p>
            </div>
          ) : (
            <>
              <table className="an-table">
                <thead>
                  <tr>
                    <th>Sent</th>
                    <th>Title</th>
                    <th>Audience</th>
                    <th>Priority</th>
                    <th>Type</th>
                    <th>Delivered</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.id}>
                      <td className="an-cell-date">{fmtDate(r.createdAt)}</td>
                      <td>
                        <div className="an-cell-title">{r.title}</div>
                        <div className="an-cell-message">{r.message}</div>
                      </td>
                      <td>
                        <span className={`an-badge an-badge--${r.audience}`}>
                          {r.audience}
                        </span>
                      </td>
                      <td>
                        <span className={`an-badge an-badge--p-${r.priority}`}>{r.priority}</span>
                      </td>
                      <td>
                        <span className={`an-badge an-badge--t-${r.type}`}>{r.type}</span>
                      </td>
                      <td className="an-cell-count">{r.deliveryCount}</td>
                      <td className="an-cell-actions">
                        <button
                          type="button"
                          className="an-btn-recall"
                          onClick={() => handleRecall(r)}
                          title="Recall (delete from all inboxes)"
                        >
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {totalPages > 1 && (
                <div className="an-pagination">
                  <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Prev</button>
                  <span>{page} / {totalPages}</span>
                  <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
};

export default AdminNotifications;
