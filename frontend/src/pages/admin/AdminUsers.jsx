import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, CheckCircle, XCircle, Clock, Ban, Loader, RefreshCw } from 'lucide-react';
import { toast } from 'react-toastify';
import AdminSidebar from '../../components/AdminSidebar';
import { getAdminUsers, approveAdminUser, suspendAdminUser, rejectAdminUser } from '../../services/api';
import './admin.css';

const STATUS_TABS = [
  { key: '',          label: 'All' },
  { key: 'pending',   label: 'Pending' },
  { key: 'active',    label: 'Active' },
  { key: 'suspended', label: 'Suspended' },
];

const statusBadge = (status) => {
  const icons = { pending: <Clock size={11} />, active: <CheckCircle size={11} />, suspended: <Ban size={11} /> };
  return (
    <span className={`admin-badge ${status || 'pending'}`}>
      {icons[status] || icons.pending} {status}
    </span>
  );
};

const roleBadge = (role) => (
  <span className={`admin-badge sm ${role || 'staff'}`}>
    {role}
  </span>
);

const AdminUsers = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [users, setUsers] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState(searchParams.get('status') || '');
  const [page, setPage] = useState(1);
  const limit = 25;

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit };
      if (activeTab) params.status = activeTab;
      if (search)    params.search = search;
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

  const handleTabChange = (key) => {
    setActiveTab(key);
    setPage(1);
    if (key) setSearchParams({ status: key }); else setSearchParams({});
  };

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

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="layout-container">
      <AdminSidebar />
      <main className="main-content admin-page">
        <div className="admin-header">
          <div className="admin-header-left">
            <h1>User Management</h1>
            <p>Approve, suspend, or manage all platform users</p>
          </div>
          <button onClick={fetchUsers} className="admin-btn-secondary">
            <RefreshCw size={13} /> Refresh
          </button>
        </div>

        {/* Status tabs */}
        <div className="admin-tabs">
          {STATUS_TABS.map(t => (
            <button key={t.key} onClick={() => handleTabChange(t.key)}
              className={`admin-tab${activeTab === t.key ? ' active' : ''}`}>
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
                      <div className="actions">
                        {u.status === 'pending' && (
                          <>
                            <button onClick={() => handleAction('approve', u.id, u.name)} className="admin-action-btn approve">
                              <CheckCircle size={11} /> Approve
                            </button>
                            <button onClick={() => handleAction('reject', u.id, u.name)} className="admin-action-btn reject">
                              <XCircle size={11} /> Reject
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
                            <CheckCircle size={11} /> Reactivate
                          </button>
                        )}
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
      </main>
    </div>
  );
};

export default AdminUsers;
