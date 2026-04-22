import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Shield, Plus, Edit3, Trash2, X, Save, Loader, Search,
  RefreshCw, Check, Square, CheckSquare, Users,
} from 'lucide-react';
import { toast } from 'react-toastify';

import {
  getPermissions, listRoles, createRole, updateRole, deleteRole,
} from '../services/api';
import '../styles/admin.css';
import './AdminRoles.css';

const EMPTY_FORM = { key: '', name: '', description: '', status: 'active', permissions: [] };

const AdminRoles = () => {
  const [scope, setScope] = useState('admin'); // admin | org
  const [roles, setRoles] = useState([]);
  const [permsGrouped, setPermsGrouped] = useState({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(null); // null | 'create' | { ...role }
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [surfaceTab, setSurfaceTab] = useState('back-office');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rolesRes, permsRes] = await Promise.all([
        listRoles({ scope }),
        getPermissions(scope),
      ]);
      setRoles(rolesRes.roles || []);
      setPermsGrouped(permsRes.grouped || {});
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to load roles');
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setModal('create');
  };

  const openEdit = (role) => {
    setForm({
      key: role.key,
      name: role.name,
      description: role.description || '',
      status: role.status,
      permissions: [...role.permissions],
      _id: role.id,
      _isSystem: role.isSystem,
      _isCustomized: role.isCustomized,
    });
    setModal(role);
  };

  const togglePerm = (key) => {
    setForm(f => ({
      ...f,
      permissions: f.permissions.includes(key)
        ? f.permissions.filter(p => p !== key)
        : [...f.permissions, key],
    }));
  };

  const toggleModule = (modulePerms) => {
    const keys = modulePerms.map(p => p.key);
    const allChecked = keys.every(k => form.permissions.includes(k));
    setForm(f => ({
      ...f,
      permissions: allChecked
        ? f.permissions.filter(p => !keys.includes(p))
        : [...new Set([...f.permissions, ...keys])],
    }));
  };

  const handleSave = async () => {
    if (!form.name.trim()) return toast.error('Name is required');
    if (!form._id && !/^[a-z0-9_]+$/.test(form.key)) {
      return toast.error('Key must be lowercase letters, digits, or underscores');
    }

    setSaving(true);
    try {
      if (form._id) {
        await updateRole(form._id, {
          name: form.name.trim(),
          description: form.description.trim() || null,
          status: form.status,
          permissions: form.permissions,
        });
        toast.success('Role updated');
      } else {
        await createRole({
          key: form.key.trim(),
          name: form.name.trim(),
          description: form.description.trim() || null,
          status: form.status,
          permissions: form.permissions,
        }, { scope });
        toast.success('Role created');
      }
      setModal(null);
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (role) => {
    if (role.isSystem) return toast.error('System roles cannot be deleted');
    if (role.userCount > 0) return toast.error(`Role is assigned to ${role.userCount} user(s) — unassign first`);
    if (!window.confirm(`Delete role "${role.name}"? This cannot be undone.`)) return;
    try {
      await deleteRole(role.id);
      toast.success('Role deleted');
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Delete failed');
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return roles;
    return roles.filter(r =>
      r.name.toLowerCase().includes(q) ||
      r.key.toLowerCase().includes(q) ||
      (r.description || '').toLowerCase().includes(q)
    );
  }, [roles, search]);

  return (
    <div className="admin-page">
      <div className="admin-header">
        <div className="admin-header-left">
          <div className="admin-header-icon"><Shield size={22} /></div>
          <div>
            <h1>Roles & Permissions</h1>
            <p>Manage access control roles for the admin panel and store dashboards.</p>
          </div>
        </div>
        <div className="admin-header-actions">
          <button className="admin-btn-secondary" onClick={load}>
            <RefreshCw size={14} /> Refresh
          </button>
          <button className="admin-btn-primary" onClick={openCreate}>
            <Plus size={14} /> New Role
          </button>
        </div>
      </div>

      <div className="admin-filter-row">
        <div className="admin-tabs">
          <button
            className={`admin-tab ${scope === 'admin' ? 'active' : ''}`}
            onClick={() => setScope('admin')}
          >Admin Panel Roles</button>
          <button
            className={`admin-tab ${scope === 'org' ? 'active' : ''}`}
            onClick={() => setScope('org')}
          >Store / Org Roles</button>
        </div>
        <div className="admin-search">
          <Search size={14} />
          <input
            type="text"
            placeholder="Search roles…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <div className="admin-loading"><Loader size={24} className="spin" /> Loading…</div>
      ) : (
        <div className="ar-grid">
          {filtered.map(r => (
            <div key={r.id} className={`ar-card ${r.isSystem ? 'ar-card--system' : ''}`}>
              <div className="ar-card-head">
                <div>
                  <h3>{r.name}</h3>
                  <code className="ar-key">{r.key}</code>
                </div>
                {r.isSystem ? (
                  <span className="ar-badge ar-badge--system">System</span>
                ) : (
                  <span className={`ar-badge ar-badge--${r.status}`}>{r.status}</span>
                )}
              </div>
              {r.description && <p className="ar-desc">{r.description}</p>}
              <div className="ar-meta">
                <span><Users size={12} /> {r.userCount} users</span>
                <span>{r.permissions.length} permissions</span>
              </div>
              <div className="ar-actions">
                <button className="admin-btn-secondary" onClick={() => openEdit(r)}>
                  <Edit3 size={13} /> Edit
                </button>
                {!r.isSystem && (
                  <button className="admin-btn-danger" onClick={() => handleDelete(r)}>
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="admin-empty">No roles found.</div>
          )}
        </div>
      )}

      {/* ─── Create / Edit modal ───────────────────────────────── */}
      {modal && (
        <div className="ar-modal-overlay" onClick={() => !saving && setModal(null)}>
          <div className="ar-modal" onClick={e => e.stopPropagation()}>
            <div className="ar-modal-head">
              <h2>
                {form._id ? 'Edit' : 'Create'} Role
                {form._isSystem && <span className="ar-sysbadge">System</span>}
                {form._isCustomized && <span className="ar-sysbadge" style={{ background:'#fef3c7', color:'#92400e' }}>Customized</span>}
              </h2>
              <button onClick={() => setModal(null)}><X size={18} /></button>
            </div>
            <div className="ar-modal-body">
              {form._isSystem && (
                <div style={{
                  background: '#fef3c7', border: '1px solid #fcd34d',
                  padding: '0.6rem 0.85rem', borderRadius: 8, marginBottom: '1rem',
                  fontSize: '0.8rem', color: '#78350f', lineHeight: 1.45,
                }}>
                  Editing a <strong>built-in system role</strong>. Name, description and
                  permissions are editable; the role <code>key</code> and delete action stay locked
                  because other parts of the app reference them. The seeder will skip this role
                  once saved.
                </div>
              )}
              <div className="ar-form-grid">
                <div>
                  <label>Name <span className="req">*</span></label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={e => setForm({ ...form, name: e.target.value })}
                    placeholder="e.g. Inventory Manager"
                  />
                </div>
                <div>
                  <label>Key <span className="req">*</span></label>
                  <input
                    type="text"
                    value={form.key}
                    disabled={!!form._id}
                    onChange={e => setForm({ ...form, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })}
                    placeholder="inventory_manager"
                  />
                </div>
                <div className="ar-full">
                  <label>Description</label>
                  <textarea
                    rows={2}
                    value={form.description}
                    onChange={e => setForm({ ...form, description: e.target.value })}
                    placeholder="Short description of what this role is for."
                  />
                </div>
                <div>
                  <label>Status</label>
                  <select
                    value={form.status}
                    onChange={e => setForm({ ...form, status: e.target.value })}
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
                <div>
                  <label>Selected</label>
                  <div className="ar-count">{form.permissions.length} permissions</div>
                </div>
              </div>

              <div className="ar-perm-header">
                <h3>Permissions</h3>
                <span className="ar-hint">Tick the boxes for actions this role should grant.</span>
              </div>

              {/* Surface tabs — only meaningful for org-scope roles. Admin-scope
                  roles are all back-office (admin panel) so we hide the tabs. */}
              {scope === 'org' && (
                <div className="ar-surface-tabs">
                  {[
                    { k: 'back-office', label: 'Back Office',  host: 'localhost:5173' },
                    { k: 'cashier-app', label: 'Cashier App',  host: 'localhost:5174' },
                  ].map(s => {
                    const vis = Object.entries(permsGrouped).filter(([, perms]) => {
                      const surf = perms[0]?.surface || 'back-office';
                      return surf === s.k || surf === 'both';
                    });
                    const keys = vis.flatMap(([, perms]) => perms.map(p => p.key));
                    const sel = keys.filter(k => form.permissions.includes(k)).length;
                    return (
                      <button
                        key={s.k}
                        type="button"
                        className={`ar-surface-tab${surfaceTab === s.k ? ' ar-surface-tab--active' : ''}`}
                        onClick={() => setSurfaceTab(s.k)}
                      >
                        <div className="ar-surface-tab-label">{s.label}</div>
                        <div className="ar-surface-tab-meta">{s.host} · {sel}/{keys.length} on</div>
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="ar-perm-grid">
                {Object.entries(permsGrouped)
                  .filter(([, perms]) => {
                    if (scope !== 'org') return true;
                    const surf = perms[0]?.surface || 'back-office';
                    return surf === surfaceTab || surf === 'both';
                  })
                  .map(([module, perms]) => {
                  const keys = perms.map(p => p.key);
                  const allOn = keys.every(k => form.permissions.includes(k));
                  const someOn = !allOn && keys.some(k => form.permissions.includes(k));
                  const surf = perms[0]?.surface || 'back-office';
                  return (
                    <div key={module} className="ar-perm-module">
                      <div className="ar-perm-module-head" onClick={() => toggleModule(perms)}>
                        <button type="button" className="ar-check">
                          {allOn ? <CheckSquare size={16} /> : someOn ? <Check size={16} style={{ opacity: 0.5 }} /> : <Square size={16} />}
                        </button>
                        <span className="ar-module-label">
                          {perms[0]?.moduleLabel || perms[0]?.label.split('—')[1]?.trim() || module}
                        </span>
                        <code className="ar-module-key">{module}</code>
                        {scope === 'org' && surf === 'both' && (
                          <span className="ar-surface-chip">both apps</span>
                        )}
                      </div>
                      <div className="ar-perm-rows">
                        {perms.map(p => {
                          const on = form.permissions.includes(p.key);
                          return (
                            <label key={p.key} className={`ar-perm-row ${on ? 'on' : ''}`}>
                              <input
                                type="checkbox"
                                checked={on}
                                onChange={() => togglePerm(p.key)}
                              />
                              <span className="ar-action-pill">{p.action}</span>
                              <code>{p.key}</code>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="ar-modal-foot">
              <button className="admin-btn-secondary" onClick={() => setModal(null)} disabled={saving}>
                Cancel
              </button>
              <button className="admin-btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? <Loader size={14} className="spin" /> : <Save size={14} />}
                {form._id ? 'Save Changes' : 'Create Role'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminRoles;
