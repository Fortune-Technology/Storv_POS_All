import { useState, useEffect, useCallback, FormEvent } from 'react';
import { Plus, Edit3, Trash2, Building2, Search, RefreshCw, Loader, X, Skull } from 'lucide-react';
import { toast } from 'react-toastify';

import {
  getAdminOrganizations,
  createAdminOrganization,
  updateAdminOrganization,
  deleteAdminOrganization,
  deleteAllOrgProducts,
} from '../services/api';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { useConfirm } from '../hooks/useConfirmDialog.jsx';
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
  const confirm = useConfirm();
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
    if (!await confirm({
      title: 'Deactivate organization?',
      message: `Deactivate "${org.name}"? This will suspend the organization.`,
      confirmLabel: 'Deactivate',
      danger: true,
    })) return;
    try {
      await deleteAdminOrganization(org.id);
      toast.success(`${org.name} deactivated`);
      fetchOrgs();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to deactivate organization');
    }
  };

  // ── Wipe Catalog (relocated from portal Products page) ──────────────────
  // This is the destructive "delete all products" op that previously lived
  // in the org's own portal. Moved here so only superadmins can fire it,
  // and so the action is scoped to a specific org by id (instead of the
  // operator's currently-active session). The backend honours X-Tenant-Id
  // on this route — see scopeToTenant.ts.
  const [wipeOrg, setWipeOrg] = useState<Organization | null>(null);
  const [wipeConfirm, setWipeConfirm] = useState('');
  const [wipePermanent, setWipePermanent] = useState(false);
  const [wipeSaving, setWipeSaving] = useState(false);
  const closeWipe = () => {
    setWipeOrg(null);
    setWipeConfirm('');
    setWipePermanent(false);
    setWipeSaving(false);
  };
  const handleWipe = async () => {
    if (!wipeOrg) return;
    if (wipeConfirm !== 'DELETE ALL') {
      toast.error('Type DELETE ALL exactly to confirm');
      return;
    }
    setWipeSaving(true);
    try {
      const res = await deleteAllOrgProducts(wipeOrg.id, 'DELETE ALL', wipePermanent);
      toast.success(`${res.deleted} product(s) ${wipePermanent ? 'permanently deleted' : 'soft-deleted'} in ${wipeOrg.name}`);
      closeWipe();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to wipe catalog');
      setWipeSaving(false);
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
                          onClick={() => setWipeOrg(o)}
                          title="Wipe product catalog (delete every product in this org)"
                        >
                          <Skull size={14} />
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

        {/* Wipe Catalog confirmation — relocated from portal Products page.
            Shows product count guard via the typed-DELETE-ALL string. */}
        {wipeOrg && (
          <div className="admin-modal-overlay" onClick={() => !wipeSaving && closeWipe()}>
            <div className="admin-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 540 }}>
              <div className="admin-modal-header" style={{ borderBottom: '2px solid rgba(239,68,68,0.4)' }}>
                <h2 className="admin-modal-title" style={{ color: '#ef4444', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Skull size={20} /> Wipe Catalog
                </h2>
                <button className="admin-modal-close" onClick={closeWipe}><X size={18} /></button>
              </div>
              <div style={{ padding: '1.25rem 1.5rem' }}>
                <p style={{ marginTop: 0, fontSize: '0.9rem', color: 'var(--text-primary)', lineHeight: 1.5 }}>
                  This will delete <strong>every product</strong> in <strong>{wipeOrg.name}</strong> across
                  all of its stores.
                  {wipePermanent
                    ? <> This action <strong style={{ color: '#ef4444' }}>cannot be undone</strong> — all
                        product records, inventory levels, UPCs, pack sizes, vendor mappings, and label
                        queue entries will be permanently erased. Soft-deleted products would be
                        recoverable; this is not.</>
                    : <> Products will be marked as inactive and hidden, but recoverable via re-import or
                        DB console.</>}
                </p>

                <label style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '0.5rem 0.75rem',
                  background: 'var(--bg-tertiary)',
                  borderRadius: 6,
                  cursor: 'pointer',
                  margin: '1rem 0',
                  fontSize: '0.82rem',
                }}>
                  <input
                    type="checkbox"
                    checked={wipePermanent}
                    onChange={(e) => setWipePermanent(e.target.checked)}
                    disabled={wipeSaving}
                  />
                  <span><strong>Permanently delete</strong> (blocked if any products are referenced by purchase orders)</span>
                </label>

                <div style={{ marginBottom: '1rem' }}>
                  <label style={{
                    fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)',
                    textTransform: 'uppercase', letterSpacing: '0.05em',
                    display: 'block', marginBottom: 4,
                  }}>
                    Type <span style={{ color: '#ef4444', fontFamily: 'monospace' }}>DELETE ALL</span> to confirm
                  </label>
                  <input
                    type="text"
                    value={wipeConfirm}
                    onChange={(e) => setWipeConfirm(e.target.value)}
                    placeholder="DELETE ALL"
                    disabled={wipeSaving}
                    autoFocus
                    style={{
                      width: '100%', padding: '0.6rem 0.85rem',
                      background: 'var(--bg-tertiary)',
                      border: `1px solid ${wipeConfirm === 'DELETE ALL' ? '#ef4444' : 'var(--border-color)'}`,
                      borderRadius: 6,
                      color: 'var(--text-primary)',
                      fontSize: '0.9rem',
                      fontFamily: 'monospace',
                      letterSpacing: '0.05em',
                      outline: 'none',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                <div className="admin-modal-footer">
                  <button type="button" className="admin-modal-cancel" onClick={closeWipe} disabled={wipeSaving}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleWipe}
                    disabled={wipeSaving || wipeConfirm !== 'DELETE ALL'}
                    style={{
                      padding: '0.6rem 1.25rem',
                      borderRadius: 6,
                      border: 'none',
                      background: wipeConfirm === 'DELETE ALL' && !wipeSaving ? '#ef4444' : 'rgba(239,68,68,0.3)',
                      color: '#fff',
                      fontWeight: 700,
                      fontSize: '0.85rem',
                      cursor: wipeConfirm === 'DELETE ALL' && !wipeSaving ? 'pointer' : 'not-allowed',
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                    }}
                  >
                    {wipeSaving ? <Loader size={13} className="admin-spin" /> : <Skull size={13} />}
                    {wipeSaving ? 'Wiping...' : 'Wipe Catalog'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
    </>
  );
};

export default AdminOrganizations;
