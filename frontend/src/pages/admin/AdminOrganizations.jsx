import React, { useState, useEffect, useCallback } from 'react';
import { Search, Building2, Loader, ToggleLeft, ToggleRight } from 'lucide-react';
import { toast } from 'react-toastify';
import AdminSidebar from '../../components/AdminSidebar';
import { getAdminOrganizations, updateAdminOrganization } from '../../services/api';
import './admin.css';

const planBadge = (plan) => (
  <span className={`admin-badge sm ${plan || 'trial'}`}>
    {plan}
  </span>
);

const AdminOrganizations = () => {
  const [orgs, setOrgs] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const limit = 25;

  const fetchOrgs = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit };
      if (search) params.search = search;
      const res = await getAdminOrganizations(params);
      setOrgs(res.data);
      setTotal(res.total);
    } catch {
      toast.error('Failed to load organizations');
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => { fetchOrgs(); }, [fetchOrgs]);

  const toggleActive = async (org) => {
    try {
      await updateAdminOrganization(org.id, { isActive: !org.isActive });
      toast.success(`${org.name} ${org.isActive ? 'deactivated' : 'activated'}`);
      fetchOrgs();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to update');
    }
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="layout-container">
      <AdminSidebar />
      <main className="main-content admin-page">
        <div className="admin-header">
          <div className="admin-header-left">
            <h1>Organizations</h1>
            <p>Manage all platform organizations</p>
          </div>
        </div>

        {/* Search */}
        <div className="admin-search">
          <Search size={14} className="admin-search-icon" />
          <input placeholder="Search organizations..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        </div>

        {loading ? (
          <div className="admin-loading"><Loader className="animate-spin" size={20} /></div>
        ) : orgs.length === 0 ? (
          <div className="admin-empty"><span className="admin-empty-text">No organizations found</span></div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  {['Name', 'Slug', 'Plan', 'Users', 'Stores', 'Status', 'Created', 'Actions'].map(h => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {orgs.map(o => (
                  <tr key={o.id}>
                    <td className="primary">
                      <div className="admin-header-icon">
                        <Building2 size={14} /> {o.name}
                      </div>
                    </td>
                    <td className="mono">{o.slug}</td>
                    <td>{planBadge(o.plan)}</td>
                    <td>{o._count?.users ?? '-'}</td>
                    <td>{o._count?.stores ?? '-'}</td>
                    <td>
                      <span className={`admin-badge sm ${o.isActive ? 'active' : 'suspended'}`}>
                        {o.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="muted">{new Date(o.createdAt).toLocaleDateString()}</td>
                    <td>
                      <button onClick={() => toggleActive(o)} className={`admin-action-btn ${o.isActive ? 'reject' : 'approve'}`}>
                        {o.isActive ? <><ToggleRight size={13} /> Deactivate</> : <><ToggleLeft size={13} /> Activate</>}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

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

export default AdminOrganizations;
