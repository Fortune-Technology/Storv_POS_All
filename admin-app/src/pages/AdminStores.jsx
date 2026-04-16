import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Edit3, Trash2, Store, Search, RefreshCw, Loader, X } from 'lucide-react';
import { toast } from 'react-toastify';

import {
  getAdminStores,
  createAdminStore,
  updateAdminStore,
  deleteAdminStore,
  getAdminOrganizations,
} from '../services/api';
import '../styles/admin.css';

const EMPTY_FORM = {
  name: '',
  orgId: '',
  address: '',
  stationCount: 1,
  isActive: true,
};

const AdminStores = () => {
  const [stores, setStores] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const limit = 25;
  const [modal, setModal] = useState(null);
  const [orgs, setOrgs] = useState([]);
  const [orgsLoading, setOrgsLoading] = useState(false);

  const fetchStores = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit };
      if (search) params.search = search;
      const res = await getAdminStores(params);
      setStores(res.data);
      setTotal(res.total);
    } catch {
      toast.error('Failed to load stores');
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => { fetchStores(); }, [fetchStores]);

  const fetchOrgs = async () => {
    if (orgs.length > 0) return;
    setOrgsLoading(true);
    try {
      const res = await getAdminOrganizations({ limit: 500 });
      setOrgs(res.data || []);
    } catch {
      toast.error('Failed to load organizations');
    } finally {
      setOrgsLoading(false);
    }
  };

  const openCreate = async () => {
    await fetchOrgs();
    setModal({ mode: 'create', data: { ...EMPTY_FORM } });
  };

  const openEdit = async (store) => {
    await fetchOrgs();
    setModal({
      mode: 'edit',
      data: {
        id: store.id,
        name: store.name || '',
        orgId: store.orgId || '',
        address: store.address || '',
        stationCount: store._count?.stations ?? store.stationCount ?? 1,
        isActive: store.isActive !== false,
      },
    });
  };

  const handleSave = async (formData) => {
    try {
      if (modal.mode === 'create') {
        await createAdminStore(formData);
        toast.success('Store created');
      } else {
        await updateAdminStore(modal.data.id, formData);
        toast.success('Store updated');
      }
      setModal(null);
      fetchStores();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Save failed');
    }
  };

  const handleDelete = async (store) => {
    if (!window.confirm(`Deactivate "${store.name}"? This will disable the store.`)) return;
    try {
      await deleteAdminStore(store.id);
      toast.success(`${store.name} deactivated`);
      fetchStores();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Delete failed');
    }
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <>
        <div className="admin-header">
          <div className="admin-header-left">
            <div className="admin-header-icon"><Store size={22} /></div>
            <div>
              <h1>Stores</h1>
              <p>Manage all platform stores</p>
            </div>
          </div>
          <div className="admin-header-actions">
            <button onClick={fetchStores} className="admin-btn-secondary">
              <RefreshCw size={13} /> Refresh
            </button>
            <button onClick={openCreate} className="admin-btn-primary">
              <Plus size={14} /> Create Store
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="admin-search">
          <Search size={14} className="admin-search-icon" />
          <input
            placeholder="Search by name or address..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
          />
        </div>

        {/* Table */}
        {loading ? (
          <div className="admin-loading"><Loader className="animate-spin" size={20} /></div>
        ) : stores.length === 0 ? (
          <div className="admin-empty">
            <Store size={40} className="admin-empty-icon" />
            <p className="admin-empty-text">No stores found</p>
          </div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  {['Name', 'Organization', 'Address', 'Stations', 'Status', 'Created', 'Actions'].map(h => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stores.map(s => (
                  <tr key={s.id}>
                    <td>
                      <span className="admin-name-cell">
                        <span className="admin-name-icon"><Store size={14} /></span>
                        {s.name}
                      </span>
                    </td>
                    <td>{s.organization?.name || '-'}</td>
                    <td className="muted">{s.address || '-'}</td>
                    <td>{s._count?.stations ?? '-'}</td>
                    <td>
                      <span className={`admin-badge sm ${s.isActive !== false ? 'active' : 'suspended'}`}>
                        {s.isActive !== false ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="muted">{new Date(s.createdAt).toLocaleDateString()}</td>
                    <td>
                      <div className="admin-row-actions">
                        <button onClick={() => openEdit(s)} className="admin-btn-icon" title="Edit">
                          <Edit3 size={13} />
                        </button>
                        <button onClick={() => handleDelete(s)} className="admin-btn-icon danger" title="Deactivate">
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

        {/* Modal */}
        {modal && (
          <div className="admin-modal-overlay" onClick={() => setModal(null)}>
            <div className="admin-modal" onClick={e => e.stopPropagation()}>
              <div className="admin-modal-header">
                <h2 className="admin-modal-title">
                  {modal.mode === 'create' ? 'Create Store' : 'Edit Store'}
                </h2>
                <button onClick={() => setModal(null)} className="admin-modal-close">
                  <X size={18} />
                </button>
              </div>
              <StoreForm
                data={modal.data}
                mode={modal.mode}
                orgs={orgs}
                orgsLoading={orgsLoading}
                onSave={handleSave}
                onCancel={() => setModal(null)}
              />
            </div>
          </div>
        )}
    </>
  );
};

const StoreForm = ({ data, mode, orgs, orgsLoading, onSave, onCancel }) => {
  const [form, setForm] = useState({ ...data });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!form.name.trim()) { toast.error('Name is required'); return; }
    if (!form.orgId) { toast.error('Organization is required'); return; }
    setSaving(true);
    try {
      await onSave({
        name: form.name.trim(),
        orgId: form.orgId,
        address: form.address.trim() || null,
        stationCount: Number(form.stationCount) || 1,
        ...(mode === 'edit' ? { isActive: form.isActive } : {}),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="admin-modal-form">
      <div className="admin-modal-field">
        <label>Name *</label>
        <input
          value={form.name}
          onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          placeholder="Store name"
        />
      </div>
      <div className="admin-modal-field">
        <label>Organization *</label>
        {orgsLoading ? (
          <div className="admin-loading"><Loader className="animate-spin" size={16} /></div>
        ) : (
          <select
            value={form.orgId}
            onChange={e => setForm(f => ({ ...f, orgId: e.target.value }))}
          >
            <option value="">Select organization...</option>
            {orgs.map(o => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        )}
      </div>
      <div className="admin-modal-row">
        <div className="admin-modal-field">
          <label>Address</label>
          <input
            value={form.address}
            onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
            placeholder="Street address (optional)"
          />
        </div>
        <div className="admin-modal-field">
          <label>Station Count</label>
          <input
            type="number"
            min="1"
            value={form.stationCount}
            onChange={e => setForm(f => ({ ...f, stationCount: e.target.value }))}
          />
        </div>
      </div>
      {mode === 'edit' && (
        <label className="admin-checkbox-label">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))}
          />
          <span>Active</span>
        </label>
      )}
      <div className="admin-modal-footer">
        <button onClick={onCancel} className="admin-modal-cancel">Cancel</button>
        <button onClick={handleSubmit} className="admin-modal-save" disabled={saving}>
          {saving ? <Loader className="animate-spin" size={14} /> : null}
          {mode === 'create' ? ' Create' : ' Save'}
        </button>
      </div>
    </div>
  );
};

export default AdminStores;
