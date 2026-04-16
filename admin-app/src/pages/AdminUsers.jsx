import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Plus, Edit3, Trash2, LogIn, Search, RefreshCw,
  Users, Loader, X, Check, Ban, Clock,
} from 'lucide-react';
import { toast } from 'react-toastify';

import {
  getAdminUsers, createAdminUser, updateAdminUser, deleteAdminUser,
  approveAdminUser, suspendAdminUser, rejectAdminUser,
  impersonateUser, getAdminOrganizations,
} from '../services/api';
import '../styles/admin.css';

const STATUS_TABS = [
  { key: '',          label: 'All' },
  { key: 'pending',   label: 'Pending' },
  { key: 'active',    label: 'Active' },
  { key: 'suspended', label: 'Suspended' },
];

const ROLE_OPTIONS = ['staff', 'cashier', 'manager', 'owner', 'admin', 'superadmin'];
const STATUS_OPTIONS = ['pending', 'active', 'suspended'];

const EMPTY_FORM = {
  name: '', email: '', phone: '', role: 'staff', orgId: '', status: 'pending',
};

const statusBadge = (status) => {
  const icons = {
    pending: <Clock size={11} />,
    active: <Check size={11} />,
    suspended: <Ban size={11} />,
  };
  return (
    <span className={`admin-badge ${status || 'pending'}`}>
      {icons[status] || icons.pending} {status}
    </span>
  );
};

const roleBadge = (role) => (
  <span className={`admin-badge sm ${role || 'staff'}`}>{role}</span>
);

/* ------------------------------------------------------------------ */

const AdminUsers = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  /* table state */
  const [users, setUsers] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState(searchParams.get('status') || '');
  const [page, setPage] = useState(1);
  const limit = 25;

  /* modal state: null | { mode: 'create'|'edit', data: {...} } */
  const [modal, setModal] = useState(null);
  const [modalForm, setModalForm] = useState(EMPTY_FORM);
  const [orgs, setOrgs] = useState([]);
  const [saving, setSaving] = useState(false);

  /* ---- data fetching ---- */

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit };
      if (activeTab) params.status = activeTab;
      if (search) params.search = search;
      const res = await getAdminUsers(params);
      setUsers(res.data);
      setTotal(res.total);
    } catch {
      toast.error('Failed to load users');
    } finally {
      setLoading(false);
    }
  }, [page, activeTab, search]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  /* ---- tab / search ---- */

  const handleTabChange = (key) => {
    setActiveTab(key);
    setPage(1);
    if (key) setSearchParams({ status: key }); else setSearchParams({});
  };

  /* ---- status actions (approve / suspend / reject) ---- */

  const handleAction = async (action, userId, userName) => {
    try {
      if (action === 'approve') {
        await approveAdminUser(userId);
        toast.success(`${userName} approved`);
      } else if (action === 'suspend') {
        await suspendAdminUser(userId);
        toast.success(`${userName} suspended`);
      } else if (action === 'reject') {
        await rejectAdminUser(userId);
        toast.success(`${userName} rejected`);
      }
      fetchUsers();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Action failed');
    }
  };

  /* ---- delete ---- */

  const handleDelete = async (user) => {
    if (!window.confirm(`Delete user "${user.name}"? This action cannot be undone.`)) return;
    try {
      await deleteAdminUser(user.id);
      toast.success(`${user.name} deleted`);
      fetchUsers();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Delete failed');
    }
  };

  /* ---- login as ---- */

  const handleLoginAs = async (u) => {
    try {
      const res = await impersonateUser(u.id);
      const d = res.data || res;
      const userParam = encodeURIComponent(JSON.stringify(d.user));
      const portalBase = import.meta.env.VITE_PORTAL_URL || window.location.origin.replace('admin.', '');
      window.open(`${portalBase}/impersonate?token=${d.token}&user=${userParam}`, '_blank');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Impersonation failed');
    }
  };

  /* ---- modal open / close ---- */

  const openCreateModal = async () => {
    setModal({ mode: 'create', data: null });
    setModalForm({ ...EMPTY_FORM });
    loadOrgs();
  };

  const openEditModal = async (user) => {
    setModal({ mode: 'edit', data: user });
    setModalForm({
      name: user.name || '',
      email: user.email || '',
      phone: user.phone || '',
      role: user.role || 'staff',
      orgId: user.orgId || user.organization?.id || '',
      status: user.status || 'pending',
    });
    loadOrgs();
  };

  const closeModal = () => {
    setModal(null);
    setModalForm(EMPTY_FORM);
    setSaving(false);
  };

  const loadOrgs = async () => {
    try {
      const res = await getAdminOrganizations({ limit: 200 });
      setOrgs(res.data || res || []);
    } catch {
      setOrgs([]);
    }
  };

  /* ---- modal save ---- */

  const handleModalSave = async () => {
    if (!modalForm.name.trim()) { toast.error('Name is required'); return; }
    if (!modalForm.email.trim()) { toast.error('Email is required'); return; }

    setSaving(true);
    try {
      if (modal.mode === 'create') {
        await createAdminUser(modalForm);
        toast.success('User created');
      } else {
        await updateAdminUser(modal.data.id, modalForm);
        toast.success('User updated');
      }
      closeModal();
      fetchUsers();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const setField = (key, value) => setModalForm(f => ({ ...f, [key]: value }));

  /* ---- render ---- */

  const totalPages = Math.ceil(total / limit);

  return (
    <>

        {/* Header */}
        <div className="admin-header">
          <div className="admin-header-left">
            <div className="admin-header-icon"><Users size={22} /></div>
            <div>
              <h1>User Management</h1>
              <p>Create, edit, approve, suspend, or manage all platform users</p>
            </div>
          </div>
          <div className="admin-header-actions">
            <button onClick={openCreateModal} className="admin-btn-primary">
              <Plus size={13} /> Create User
            </button>
            <button onClick={fetchUsers} className="admin-btn-secondary">
              <RefreshCw size={13} /> Refresh
            </button>
          </div>
        </div>

        {/* Status tabs */}
        <div className="admin-tabs">
          {STATUS_TABS.map(t => (
            <button
              key={t.key}
              onClick={() => handleTabChange(t.key)}
              className={`admin-tab${activeTab === t.key ? ' active' : ''}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="admin-search">
          <Search size={14} className="admin-search-icon" />
          <input
            placeholder="Search by name or email..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
          />
        </div>

        {/* Table */}
        {loading ? (
          <div className="admin-loading"><Loader className="animate-spin" size={20} /></div>
        ) : users.length === 0 ? (
          <div className="admin-empty"><span className="admin-empty-text">No users found</span></div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  {['Name', 'Email', 'Organization', 'Role', 'Status', 'Joined', 'Actions'].map(h => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id}>
                    <td className="primary">{u.name}</td>
                    <td>{u.email}</td>
                    <td>{u.organization?.name || '-'}</td>
                    <td>{roleBadge(u.role)}</td>
                    <td>{statusBadge(u.status)}</td>
                    <td className="muted">{new Date(u.createdAt).toLocaleDateString()}</td>
                    <td>
                      <div className="admin-row-actions">
                        {/* Status actions */}
                        {u.status === 'pending' && (
                          <>
                            <button onClick={() => handleAction('approve', u.id, u.name)} className="admin-action-btn approve">
                              <Check size={11} /> Approve
                            </button>
                            <button onClick={() => handleAction('reject', u.id, u.name)} className="admin-action-btn reject">
                              <Ban size={11} /> Reject
                            </button>
                          </>
                        )}
                        {u.status === 'active' && u.role !== 'superadmin' && (
                          <button onClick={() => handleAction('suspend', u.id, u.name)} className="admin-action-btn suspend">
                            <Ban size={11} /> Suspend
                          </button>
                        )}
                        {u.status === 'suspended' && (
                          <button onClick={() => handleAction('approve', u.id, u.name)} className="admin-action-btn approve">
                            <Check size={11} /> Reactivate
                          </button>
                        )}

                        {/* Edit */}
                        <button onClick={() => openEditModal(u)} className="admin-btn-icon" title="Edit user">
                          <Edit3 size={13} />
                        </button>

                        {/* Login As (active non-superadmin only) */}
                        {u.status === 'active' && u.role !== 'superadmin' && (
                          <button onClick={() => handleLoginAs(u)} className="admin-btn-icon" title="Login as this user">
                            <LogIn size={13} />
                          </button>
                        )}

                        {/* Delete */}
                        <button onClick={() => handleDelete(u)} className="admin-btn-icon danger" title="Delete user">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="admin-pagination">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</button>
            <span className="page-info">Page {page} of {totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</button>
          </div>
        )}

        {/* Create / Edit Modal */}
        {modal && (
          <div className="admin-modal-overlay" onClick={closeModal}>
            <div className="admin-modal" onClick={e => e.stopPropagation()}>
              <div className="admin-modal-header">
                <h2 className="admin-modal-title">
                  {modal.mode === 'create' ? 'Create User' : 'Edit User'}
                </h2>
                <button className="admin-modal-close" onClick={closeModal}>
                  <X size={16} />
                </button>
              </div>

              <div className="admin-modal-form">
                {/* Name */}
                <div className="admin-modal-field">
                  <label>Name *</label>
                  <input
                    type="text"
                    value={modalForm.name}
                    onChange={e => setField('name', e.target.value)}
                    placeholder="Full name"
                  />
                </div>

                {/* Email */}
                <div className="admin-modal-field">
                  <label>Email *</label>
                  <input
                    type="email"
                    value={modalForm.email}
                    onChange={e => setField('email', e.target.value)}
                    placeholder="user@example.com"
                  />
                </div>

                {/* Phone */}
                <div className="admin-modal-field">
                  <label>Phone</label>
                  <input
                    type="text"
                    value={modalForm.phone}
                    onChange={e => setField('phone', e.target.value)}
                    placeholder="Optional"
                  />
                </div>

                {/* Role + Status row */}
                <div className="admin-modal-row">
                  <div className="admin-modal-field">
                    <label>Role</label>
                    <select value={modalForm.role} onChange={e => setField('role', e.target.value)}>
                      {ROLE_OPTIONS.map(r => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </div>
                  <div className="admin-modal-field">
                    <label>Status</label>
                    <select value={modalForm.status} onChange={e => setField('status', e.target.value)}>
                      {STATUS_OPTIONS.map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Organization */}
                <div className="admin-modal-field">
                  <label>Organization</label>
                  <select value={modalForm.orgId} onChange={e => setField('orgId', e.target.value)}>
                    <option value="">-- None --</option>
                    {orgs.map(o => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="admin-modal-footer">
                <button className="admin-modal-cancel" onClick={closeModal}>Cancel</button>
                <button className="admin-modal-save" onClick={handleModalSave} disabled={saving}>
                  {saving ? <Loader className="animate-spin" size={13} /> : null}
                  {modal.mode === 'create' ? 'Create' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        )}
    </>
  );
};

export default AdminUsers;
