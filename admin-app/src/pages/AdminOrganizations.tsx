import { useState, useEffect, useCallback, FormEvent } from 'react';
import { Plus, Edit3, Trash2, Building2, Search, RefreshCw, Loader, X } from 'lucide-react';
import { toast } from 'react-toastify';

import {
  getAdminOrganizations,
  createAdminOrganization,
  updateAdminOrganization,
  deleteAdminOrganization,
} from '../services/api';
import '../styles/admin.css';

const toSlug = (str: string): string =>
  str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const PLAN_OPTIONS = ['trial', 'starter', 'pro', 'enterprise'] as const;

interface OrgForm {
  name: string;
  slug: string;
  plan: string;
  billingEmail: string;
  maxStores: number | string;
  maxUsers: number | string;
  isActive: boolean;
}

interface Organization {
  id: string | number;
  name: string;
  slug: string;
  plan?: string;
  billingEmail?: string;
  maxStores?: number;
  maxUsers?: number;
  isActive?: boolean;
  createdAt?: string;
  _count?: { users?: number; stores?: number };
}

const EMPTY_FORM: OrgForm = {
  name: '',
  slug: '',
  plan: 'trial',
  billingEmail: '',
  maxStores: 1,
  maxUsers: 3,
  isActive: true,
};

const planBadge = (plan?: string) => (
  <span className={`admin-badge sm ${plan || 'trial'}`}>{plan}</span>
);

/* ─── Modal ──────────────────────────────────────────────────── */

interface OrgModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  editOrg: Organization | null;
}

const OrgModal = ({ open, onClose, onSaved, editOrg }: OrgModalProps) => {
  const isEdit = !!editOrg;
  const [form, setForm] = useState<OrgForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [slugTouched, setSlugTouched] = useState(false);

  useEffect(() => {
    if (editOrg) {
      setForm({
        name: editOrg.name || '',
        slug: editOrg.slug || '',
        plan: editOrg.plan || 'trial',
        billingEmail: editOrg.billingEmail || '',
        maxStores: editOrg.maxStores ?? 1,
        maxUsers: editOrg.maxUsers ?? 3,
        isActive: editOrg.isActive ?? true,
      });
      setSlugTouched(true);
    } else {
      setForm(EMPTY_FORM);
      setSlugTouched(false);
    }
  }, [editOrg]);

  if (!open) return null;

  const set = <K extends keyof OrgForm>(field: K, value: OrgForm[K]) => {
    setForm((prev) => {
      const next: OrgForm = { ...prev, [field]: value };
      if (field === 'name' && !slugTouched) {
        next.slug = toSlug(value as string);
      }
      return next;
    });
  };

  const handleSlugChange = (value: string) => {
    setSlugTouched(true);
    setForm((prev) => ({ ...prev, slug: value }));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { toast.error('Name is required'); return; }
    if (!form.slug.trim()) { toast.error('Slug is required'); return; }

    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        slug: form.slug.trim(),
        plan: form.plan,
        billingEmail: form.billingEmail.trim() || null,
        maxStores: Number(form.maxStores) || 1,
        maxUsers: Number(form.maxUsers) || 3,
      };
      if (isEdit && editOrg) {
        payload.isActive = form.isActive;
        await updateAdminOrganization(editOrg.id, payload);
        toast.success('Organization updated');
      } else {
        await createAdminOrganization(payload);
        toast.success('Organization created');
      }
      onSaved();
      onClose();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || `Failed to ${isEdit ? 'update' : 'create'} organization`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="admin-modal-overlay" onClick={onClose}>
      <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
        <div className="admin-modal-header">
          <h2 className="admin-modal-title">
            {isEdit ? 'Edit Organization' : 'Create Organization'}
          </h2>
          <button className="admin-modal-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <form className="admin-modal-form" onSubmit={handleSubmit}>
          {/* Name */}
          <div className="admin-modal-field">
            <label>Name *</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="Acme Convenience"
              required
            />
          </div>

          {/* Slug */}
          <div className="admin-modal-field">
            <label>Slug *</label>
            <input
              type="text"
              value={form.slug}
              onChange={(e) => handleSlugChange(e.target.value)}
              placeholder="acme-convenience"
              required
            />
          </div>

          {/* Plan + Billing Email */}
          <div className="admin-modal-row">
            <div className="admin-modal-field">
              <label>Plan</label>
              <select value={form.plan} onChange={(e) => set('plan', e.target.value)}>
                {PLAN_OPTIONS.map((p) => (
                  <option key={p} value={p}>
                    {p.charAt(0).toUpperCase() + p.slice(1)}
                  </option>
                ))}
              </select>
            </div>
            <div className="admin-modal-field">
              <label>Billing Email</label>
              <input
                type="email"
                value={form.billingEmail}
                onChange={(e) => set('billingEmail', e.target.value)}
                placeholder="billing@acme.com"
              />
            </div>
          </div>

          {/* Max Stores + Max Users */}
          <div className="admin-modal-row">
            <div className="admin-modal-field">
              <label>Max Stores</label>
              <input
                type="number"
                min={1}
                value={form.maxStores}
                onChange={(e) => set('maxStores', e.target.value)}
              />
            </div>
            <div className="admin-modal-field">
              <label>Max Users</label>
              <input
                type="number"
                min={1}
                value={form.maxUsers}
                onChange={(e) => set('maxUsers', e.target.value)}
              />
            </div>
          </div>

          {/* Active checkbox (edit only) */}
          {isEdit && (
            <div className="admin-modal-field">
              <label className="admin-checkbox-label">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => set('isActive', e.target.checked)}
                />
                Active
              </label>
            </div>
          )}

          <div className="admin-modal-footer">
            <button type="button" className="admin-modal-cancel" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="admin-modal-save" disabled={saving}>
              {saving ? <Loader size={14} className="animate-spin" /> : null}
              {isEdit ? 'Save Changes' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

/* ─── Page ───────────────────────────────────────────────────── */

const AdminOrganizations = () => {
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const limit = 25;

  const [modalOpen, setModalOpen] = useState(false);
  const [editOrg, setEditOrg] = useState<Organization | null>(null);

  const fetchOrgs = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = { page, limit };
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

  useEffect(() => {
    fetchOrgs();
  }, [fetchOrgs]);

  const openCreate = () => {
    setEditOrg(null);
    setModalOpen(true);
  };

  const openEdit = (org: Organization) => {
    setEditOrg(org);
    setModalOpen(true);
  };

  const handleDelete = async (org: Organization) => {
    if (!window.confirm(`Deactivate "${org.name}"? This will suspend the organization.`)) return;
    try {
      await deleteAdminOrganization(org.id);
      toast.success(`${org.name} deactivated`);
      fetchOrgs();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to deactivate organization');
    }
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <>
        <div className="admin-header">
          <div className="admin-header-left">
            <div className="admin-header-icon"><Building2 size={22} /></div>
            <div>
              <h1>Organizations</h1>
              <p>Manage all platform organizations</p>
            </div>
          </div>
          <div className="admin-header-actions">
            <button className="admin-btn-icon" onClick={fetchOrgs} title="Refresh">
              <RefreshCw size={15} />
            </button>
            <button className="admin-btn-primary" onClick={openCreate}>
              <Plus size={15} /> Create Organization
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="admin-search">
          <Search size={14} className="admin-search-icon" />
          <input
            placeholder="Search organizations..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>

        {loading ? (
          <div className="admin-loading">
            <Loader className="animate-spin" size={20} />
          </div>
        ) : orgs.length === 0 ? (
          <div className="admin-empty">
            <span className="admin-empty-text">No organizations found</span>
          </div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  {['Name', 'Slug', 'Plan', 'Users', 'Stores', 'Status', 'Created', 'Actions'].map(
                    (h) => (
                      <th key={h}>{h}</th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {orgs.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <span className="admin-name-cell">
                        <span className="admin-name-icon"><Building2 size={14} /></span>
                        {o.name}
                      </span>
                    </td>
                    <td className="mono">{o.slug}</td>
                    <td>{planBadge(o.plan)}</td>
                    <td>{o._count?.users ?? '-'}</td>
                    <td>{o._count?.stores ?? '-'}</td>
                    <td>
                      <span
                        className={`admin-badge sm ${o.isActive ? 'active' : 'suspended'}`}
                      >
                        {o.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="muted">
                      {o.createdAt ? new Date(o.createdAt).toLocaleDateString() : '-'}
                    </td>
                    <td>
                      <div className="admin-row-actions">
                        <button
                          className="admin-btn-icon"
                          onClick={() => openEdit(o)}
                          title="Edit"
                        >
                          <Edit3 size={14} />
                        </button>
                        <button
                          className="admin-btn-icon danger"
                          onClick={() => handleDelete(o)}
                          title="Deactivate"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="admin-pagination">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </button>
            <span className="page-info">
              Page {page} of {totalPages}
            </span>
            <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
            </button>
          </div>
        )}

        <OrgModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          onSaved={fetchOrgs}
          editOrg={editOrg}
        />
    </>
  );
};

export default AdminOrganizations;
