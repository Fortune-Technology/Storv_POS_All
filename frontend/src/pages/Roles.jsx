import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Shield, Plus, Edit3, Trash2, X, Save, Search,
  RefreshCw, Check, Square, CheckSquare, Users, Loader,
} from 'lucide-react';
import { toast } from 'react-toastify';
import { useConfirm } from '../hooks/useConfirmDialog.jsx';

import {
  getPermissions, listRoles, createRole, updateRole, deleteRole,
} from '../services/api';
import '../styles/portal.css';
import './Roles.css';

const EMPTY_FORM = { key: '', name: '', description: '', status: 'active', permissions: [] };

export default function Roles() {
  const confirm = useConfirm();
  const [roles, setRoles] = useState([]);
  const [permsGrouped, setPermsGrouped] = useState({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [surfaceTab, setSurfaceTab] = useState('back-office'); // 'back-office' | 'cashier-app'

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rolesRes, permsRes] = await Promise.all([
        listRoles({ includeSystem: true }),
        getPermissions('org'),
      ]);
      setRoles(rolesRes.roles || []);
      setPermsGrouped(permsRes.grouped || {});
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to load roles');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setForm(EMPTY_FORM); setModal('create'); };
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
        });
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
    if (!await confirm({
      title: 'Delete role?',
      message: `Delete role "${role.name}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    })) return;
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
    <div className="p-page">
      <div className="p-header">
        <div className="p-header-left">
          <div className="p-header-icon"><Shield size={22} /></div>
          <div>
            <h1>Roles & Permissions</h1>
            <p>Define what each role can see and do across the portal and POS.</p>
          </div>
        </div>
        <div className="p-header-actions">
          <button className="p-btn p-btn-secondary" onClick={load}>
            <RefreshCw size={14} /> Refresh
          </button>
          <button className="p-btn p-btn-primary" onClick={openCreate}>
            <Plus size={14} /> New Role
          </button>
        </div>
      </div>

      <div className="rl-toolbar">
        <div className="rl-search">
          <Search size={14} />
          <input
            type="text"
            placeholder="Search roles by name, key or description…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <div className="p-loading"><Loader size={24} className="spin" /> Loading…</div>
      ) : (
        <div className="rl-grid">
          {filtered.map(r => (
            <div key={r.id} className={`rl-card ${r.isSystem ? 'rl-card--system' : ''}`}>
              <div className="rl-card-head">
                <div>
                  <h3>{r.name}</h3>
                  <code className="rl-key">{r.key}</code>
                </div>
                {r.isSystem ? (
                  <span className="rl-badge rl-badge--system">System</span>
                ) : (
                  <span className={`rl-badge rl-badge--${r.status}`}>{r.status}</span>
                )}
              </div>
              {r.description && <p className="rl-desc">{r.description}</p>}
              <div className="rl-meta">
                <span><Users size={12} /> {r.userCount} users</span>
                <span>{r.permissions.length} permissions</span>
              </div>
              <div className="rl-actions">
                <button className="p-btn p-btn-secondary" onClick={() => openEdit(r)}>
                  <Edit3 size={13} /> Edit
                </button>
                {!r.isSystem && (
                  <button className="p-btn p-btn-danger" onClick={() => handleDelete(r)}>
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="p-empty">No roles found.</div>
          )}
        </div>
      )}

      {modal && (
        <div className="rl-modal-overlay" onClick={() => !saving && setModal(null)}>
          <div className="rl-modal" onClick={e => e.stopPropagation()}>
            <div className="rl-modal-head">
              <h2>
                {form._id ? 'Edit' : 'Create'} Role
                {form._isSystem && <span className="rl-sysbadge">System</span>}
                {form._isCustomized && <span className="rl-sysbadge" style={{ background:'#fef3c7', color:'#92400e' }}>Customized</span>}
              </h2>
              <button onClick={() => setModal(null)}><X size={18} /></button>
            </div>
            <div className="rl-modal-body">
              {form._isSystem && (
                <div style={{
                  background: '#fef3c7', border: '1px solid #fcd34d',
                  padding: '0.6rem 0.85rem', borderRadius: 8, marginBottom: '1rem',
                  fontSize: '0.8rem', color: '#78350f', lineHeight: 1.45,
                }}>
                  You're editing a <strong>built-in system role</strong>. Name, description and
                  permissions are editable; the role <code>key</code> and delete action are locked
                  because other parts of the app reference them. Running the seeder won't overwrite
                  your changes once saved.
                </div>
              )}
              <div className="rl-form-grid">
                <div>
                  <label>Name <span className="req">*</span></label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={e => setForm({ ...form, name: e.target.value })}
                    placeholder="e.g. Inventory Clerk"
                  />
                </div>
                <div>
                  <label>Key <span className="req">*</span></label>
                  <input
                    type="text"
                    value={form.key}
                    disabled={!!form._id}
                    onChange={e => setForm({ ...form, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })}
                    placeholder="inventory_clerk"
                  />
                </div>
                <div className="rl-full">
                  <label>Description</label>
                  <textarea
                    rows={2}
                    value={form.description}
                    onChange={e => setForm({ ...form, description: e.target.value })}
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
                  <div className="rl-count">{form.permissions.length} permissions</div>
                </div>
              </div>

              {/* ── Select-all scope ──
                  Compute once per render: which permissions are currently
                  visible in the active surface tab, and are all/some selected.
                  A single checkbox toggles the entire visible set. */}
              {(() => {
                const visibleModules = Object.entries(permsGrouped).filter(([, perms]) => {
                  const surf = perms[0]?.surface || 'back-office';
                  return surf === surfaceTab || surf === 'both';
                });
                const visibleKeys = visibleModules.flatMap(([, perms]) => perms.map(p => p.key));
                const selectedVisible = visibleKeys.filter(k => form.permissions.includes(k)).length;
                const allSelected = visibleKeys.length > 0 && selectedVisible === visibleKeys.length;
                const someSelected = !allSelected && selectedVisible > 0;

                const toggleAllVisible = () => {
                  setForm(f => ({
                    ...f,
                    permissions: allSelected
                      ? f.permissions.filter(k => !visibleKeys.includes(k))
                      : [...new Set([...f.permissions, ...visibleKeys])],
                  }));
                };

                return (
                  <>
                    <div className="rl-perm-header">
                      <h3>Permissions</h3>
                      <label className="rl-select-all" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={allSelected}
                          ref={el => { if (el) el.indeterminate = someSelected; }}
                          onChange={toggleAllVisible}
                        />
                        <span>
                          {allSelected ? 'Deselect all' : 'Select all'}
                          <span className="rl-select-all-count">
                            {' '}({selectedVisible}/{visibleKeys.length})
                          </span>
                        </span>
                      </label>
                    </div>

                    {/* Surface tabs — split permissions by the app that enforces them */}
                    <div className="rl-surface-tabs">
                      {[
                        { k: 'back-office', label: 'Back Office' },
                        { k: 'cashier-app', label: 'Cashier App' },
                      ].map(s => {
                        const vm = Object.entries(permsGrouped).filter(([, perms]) => {
                          const surf = perms[0]?.surface || 'back-office';
                          return surf === s.k || surf === 'both';
                        });
                        const allKeys = vm.flatMap(([, perms]) => perms.map(p => p.key));
                        const sel = allKeys.filter(k => form.permissions.includes(k)).length;
                        return (
                          <button
                            key={s.k}
                            type="button"
                            className={`rl-surface-tab${surfaceTab === s.k ? ' rl-surface-tab--active' : ''}`}
                            onClick={() => setSurfaceTab(s.k)}
                          >
                            <div className="rl-surface-tab-label">{s.label}</div>
                            <div className="rl-surface-tab-meta">{sel}/{allKeys.length} on</div>
                          </button>
                        );
                      })}
                    </div>
                  </>
                );
              })()}

              <div className="rl-perm-grid">
                {Object.entries(permsGrouped)
                  .filter(([, perms]) => {
                    const surf = perms[0]?.surface || 'back-office';
                    return surf === surfaceTab || surf === 'both';
                  })
                  .map(([module, perms]) => {
                  const keys = perms.map(p => p.key);
                  const allOn = keys.every(k => form.permissions.includes(k));
                  const someOn = !allOn && keys.some(k => form.permissions.includes(k));
                  const surf = perms[0]?.surface || 'back-office';
                  return (
                    <div key={module} className="rl-perm-module">
                      <div className="rl-perm-module-head" onClick={() => toggleModule(perms)}>
                        <button type="button" className="rl-check">
                          {allOn ? <CheckSquare size={16} /> : someOn ? <Check size={16} style={{ opacity: 0.5 }} /> : <Square size={16} />}
                        </button>
                        <span className="rl-module-label">
                          {perms[0]?.moduleLabel || perms[0]?.label.split('—')[1]?.trim() || module}
                        </span>
                        <code className="rl-module-key">{module}</code>
                        {surf === 'both' && <span className="rl-surface-chip">both apps</span>}
                      </div>
                      <div className="rl-perm-rows">
                        {perms.map(p => {
                          const on = form.permissions.includes(p.key);
                          return (
                            <label key={p.key} className={`rl-perm-row ${on ? 'on' : ''}`}>
                              <input
                                type="checkbox"
                                checked={on}
                                onChange={() => togglePerm(p.key)}
                              />
                              <span className="rl-action-pill">{p.action}</span>
                              <code>{p.key}</code>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
                {Object.entries(permsGrouped).filter(([, perms]) => {
                  const surf = perms[0]?.surface || 'back-office';
                  return surf === surfaceTab || surf === 'both';
                }).length === 0 && (
                  <div className="p-empty">No permissions in this category.</div>
                )}
              </div>
            </div>

            <div className="rl-modal-foot">
              <button className="p-btn p-btn-secondary" onClick={() => setModal(null)} disabled={saving}>Cancel</button>
              <button className="p-btn p-btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? <Loader size={14} className="spin" /> : <Save size={14} />}
                {form._id ? 'Save Changes' : 'Create Role'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
