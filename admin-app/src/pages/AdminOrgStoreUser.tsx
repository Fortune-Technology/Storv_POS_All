/**
 * AdminOrgStoreUser — unified nested management page.
 *
 * Replaces the prior 3 separate pages (AdminOrganizations / AdminStores /
 * AdminUsers) with one drill-down view:
 *   Organizations  →  Stores in selected org  →  Users in selected store
 *
 * URL state:
 *   /org-store?orgId=X            → drill into an org
 *   /org-store?orgId=X&storeId=Y  → drill into a store
 *
 * Each create modal accepts a password so superadmin can set login
 * credentials directly. Org create can also create the owner user;
 * store create can also create the manager user (both atomically).
 */
import { useState, useEffect, useCallback, useMemo, FormEvent, ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Plus, Edit3, Trash2, Building2, Store, Users, Search, RefreshCw, Loader, X,
  ChevronRight, ArrowLeft, Skull, LogIn, Eye, EyeOff, Check, Ban, Clock,
  Shield,
} from 'lucide-react';
import { toast } from 'react-toastify';

import {
  getAdminOrganizations, createAdminOrganization, updateAdminOrganization,
  deleteAdminOrganization, deleteAllOrgProducts,
  getAdminStores, createAdminStore, updateAdminStore, deleteAdminStore,
  getAdminUsers, createAdminUser, updateAdminUser, deleteAdminUser,
  approveAdminUser, suspendAdminUser, rejectAdminUser, impersonateUser,
} from '../services/api';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { useConfirm } from '../hooks/useConfirmDialog.jsx';
import '../styles/admin.css';
import './AdminOrgStoreUser.css';

/* ──────────────── shared types ──────────────── */
// `id` is widened to string|number to match the @storeveu/types envelope.

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

interface AdminStore {
  id: string | number;
  name: string;
  orgId?: string;
  address?: string;
  isActive?: boolean;
  createdAt?: string;
  stationCount?: number;
  organization?: { name?: string };
  _count?: { stations?: number; users?: number };
}

type Role = 'staff' | 'cashier' | 'manager' | 'owner' | 'admin' | 'superadmin';
type UserStatus = 'pending' | 'active' | 'suspended';

interface AdminUserRow {
  id: string | number;
  name: string;
  email: string;
  phone?: string;
  role: Role;
  status: UserStatus;
  orgId?: string;
  organization?: { id?: string | number; name?: string } | null;
  createdAt?: string;
}

const PLAN_OPTIONS = ['trial', 'starter', 'pro', 'enterprise'] as const;
const ROLE_OPTIONS: Role[] = ['staff', 'cashier', 'manager', 'owner', 'admin'];
const STATUS_OPTIONS: UserStatus[] = ['pending', 'active', 'suspended'];

const toSlug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/* ──────────────── shared bits ──────────────── */

const planBadge = (p?: string) => <span className={`admin-badge sm ${p || 'trial'}`}>{p}</span>;
const roleBadge = (r?: string) => <span className={`admin-badge sm ${r || 'staff'}`}>{r}</span>;
const statusBadge = (s?: string): ReactNode => {
  const icons: Record<string, ReactNode> = {
    pending: <Clock size={11} />, active: <Check size={11} />, suspended: <Ban size={11} />,
  };
  const k = s || 'pending';
  return <span className={`admin-badge ${k}`}>{icons[k]} {s}</span>;
};

/* ──────────────── Org modal ──────────────── */

interface OrgModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  editOrg: Organization | null;
}

const OrgModal = ({ open, onClose, onSaved, editOrg }: OrgModalProps) => {
  const isEdit = !!editOrg;
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [plan, setPlan] = useState('trial');
  const [billingEmail, setBillingEmail] = useState('');
  const [maxStores, setMaxStores] = useState<number | string>(1);
  const [maxUsers, setMaxUsers] = useState<number | string>(3);
  const [isActive, setIsActive] = useState(true);

  // Owner credentials (create-only)
  const [ownerName, setOwnerName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [createOwner, setCreateOwner] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editOrg) {
      setName(editOrg.name || ''); setSlug(editOrg.slug || ''); setSlugTouched(true);
      setPlan(editOrg.plan || 'trial'); setBillingEmail(editOrg.billingEmail || '');
      setMaxStores(editOrg.maxStores ?? 1); setMaxUsers(editOrg.maxUsers ?? 3);
      setIsActive(editOrg.isActive ?? true);
    } else {
      setName(''); setSlug(''); setSlugTouched(false);
      setPlan('trial'); setBillingEmail(''); setMaxStores(1); setMaxUsers(3); setIsActive(true);
      setOwnerName(''); setOwnerEmail(''); setOwnerPassword(''); setCreateOwner(true);
    }
  }, [editOrg, open]);

  if (!open) return null;

  const handleNameChange = (v: string) => {
    setName(v);
    if (!slugTouched) setSlug(toSlug(v));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { toast.error('Name is required'); return; }
    if (!slug.trim()) { toast.error('Slug is required'); return; }

    if (!isEdit && createOwner) {
      if (!ownerName.trim() || !ownerEmail.trim() || !ownerPassword) {
        toast.error('Owner name, email, and password are required (or uncheck "Create owner login")');
        return;
      }
    }

    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: name.trim(), slug: slug.trim(), plan,
        billingEmail: billingEmail.trim() || null,
        maxStores: Number(maxStores) || 1,
        maxUsers: Number(maxUsers) || 3,
      };
      if (isEdit && editOrg) {
        payload.isActive = isActive;
        await updateAdminOrganization(editOrg.id, payload);
        toast.success('Organization updated');
      } else {
        if (createOwner) {
          payload.ownerName = ownerName.trim();
          payload.ownerEmail = ownerEmail.trim();
          payload.ownerPassword = ownerPassword;
        }
        await createAdminOrganization(payload);
        toast.success('Organization created');
      }
      onSaved();
      onClose();
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error || `Failed to ${isEdit ? 'update' : 'create'} organization`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="admin-modal-overlay" onClick={onClose}>
      <div className="admin-modal aosu-modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="admin-modal-header">
          <h2 className="admin-modal-title">{isEdit ? 'Edit Organization' : 'Create Organization'}</h2>
          <button className="admin-modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        <form className="admin-modal-form" onSubmit={handleSubmit}>
          <div className="admin-modal-field">
            <label>Name *</label>
            <input type="text" value={name} onChange={(e) => handleNameChange(e.target.value)} placeholder="Acme Convenience" required />
          </div>
          <div className="admin-modal-field">
            <label>Slug *</label>
            <input type="text" value={slug} onChange={(e) => { setSlugTouched(true); setSlug(e.target.value); }} placeholder="acme-convenience" required />
          </div>
          <div className="admin-modal-row">
            <div className="admin-modal-field">
              <label>Plan</label>
              <select value={plan} onChange={(e) => setPlan(e.target.value)}>
                {PLAN_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className="admin-modal-field">
              <label>Billing Email</label>
              <input type="email" value={billingEmail} onChange={(e) => setBillingEmail(e.target.value)} placeholder="billing@acme.com" />
            </div>
          </div>
          <div className="admin-modal-row">
            <div className="admin-modal-field">
              <label>Max Stores</label>
              <input type="number" min={1} value={maxStores} onChange={(e) => setMaxStores(e.target.value)} />
            </div>
            <div className="admin-modal-field">
              <label>Max Users</label>
              <input type="number" min={1} value={maxUsers} onChange={(e) => setMaxUsers(e.target.value)} />
            </div>
          </div>

          {isEdit && (
            <div className="admin-modal-field">
              <label className="admin-checkbox-label">
                <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Active
              </label>
            </div>
          )}

          {/* Owner credentials — create only */}
          {!isEdit && (
            <>
              <div className="aosu-section-divider"><Shield size={12} /> Owner login (recommended)</div>
              <label className="admin-checkbox-label aosu-create-owner">
                <input type="checkbox" checked={createOwner} onChange={(e) => setCreateOwner(e.target.checked)} />
                Also create the owner login for this organization
              </label>
              {createOwner && (
                <>
                  <div className="admin-modal-row">
                    <div className="admin-modal-field">
                      <label>Owner Name *</label>
                      <input type="text" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="Jane Owner" />
                    </div>
                    <div className="admin-modal-field">
                      <label>Owner Email *</label>
                      <input type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} placeholder="owner@acme.com" />
                    </div>
                  </div>
                  <div className="admin-modal-field">
                    <label>Owner Password *</label>
                    <div className="aosu-pw-wrap">
                      <input
                        type={showPw ? 'text' : 'password'}
                        value={ownerPassword}
                        onChange={(e) => setOwnerPassword(e.target.value)}
                        placeholder="Min 8 chars · upper · lower · digit · special"
                        autoComplete="new-password"
                      />
                      <button type="button" className="aosu-pw-eye" onClick={() => setShowPw(s => !s)}>
                        {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          <div className="admin-modal-footer">
            <button type="button" className="admin-modal-cancel" onClick={onClose}>Cancel</button>
            <button type="submit" className="admin-modal-save" disabled={saving}>
              {saving && <Loader size={14} className="animate-spin" />}
              {isEdit ? 'Save Changes' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

/* ──────────────── Store modal ──────────────── */

interface StoreModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  editStore: AdminStore | null;
  orgId: string;
  orgName: string;
}

const StoreModal = ({ open, onClose, onSaved, editStore, orgId, orgName }: StoreModalProps) => {
  const isEdit = !!editStore;
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [stationCount, setStationCount] = useState<number | string>(1);
  const [isActive, setIsActive] = useState(true);

  const [managerName, setManagerName] = useState('');
  const [managerEmail, setManagerEmail] = useState('');
  const [managerPassword, setManagerPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [createManager, setCreateManager] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editStore) {
      setName(editStore.name || ''); setAddress(editStore.address || '');
      setStationCount(editStore.stationCount ?? 1);
      setIsActive(editStore.isActive !== false);
    } else {
      setName(''); setAddress(''); setStationCount(1); setIsActive(true);
      setManagerName(''); setManagerEmail(''); setManagerPassword(''); setCreateManager(true);
    }
  }, [editStore, open]);

  if (!open) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { toast.error('Name is required'); return; }

    if (!isEdit && createManager) {
      if (!managerName.trim() || !managerEmail.trim() || !managerPassword) {
        toast.error('Manager name, email, and password are required (or uncheck "Create manager login")');
        return;
      }
    }

    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: name.trim(), orgId,
        address: address.trim() || null,
        stationCount: Number(stationCount) || 1,
      };
      if (isEdit && editStore) {
        payload.isActive = isActive;
        await updateAdminStore(editStore.id, payload);
        toast.success('Store updated');
      } else {
        if (createManager) {
          payload.managerName = managerName.trim();
          payload.managerEmail = managerEmail.trim();
          payload.managerPassword = managerPassword;
        }
        await createAdminStore(payload);
        toast.success('Store created');
      }
      onSaved();
      onClose();
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error || `Failed to ${isEdit ? 'update' : 'create'} store`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="admin-modal-overlay" onClick={onClose}>
      <div className="admin-modal aosu-modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="admin-modal-header">
          <h2 className="admin-modal-title">
            {isEdit ? 'Edit Store' : `Create Store in ${orgName}`}
          </h2>
          <button className="admin-modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        <form className="admin-modal-form" onSubmit={handleSubmit}>
          <div className="admin-modal-field">
            <label>Name *</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Main Street Marketplace" required />
          </div>
          <div className="admin-modal-row">
            <div className="admin-modal-field">
              <label>Address</label>
              <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="123 Main St, City, State" />
            </div>
            <div className="admin-modal-field">
              <label>Station Count</label>
              <input type="number" min={1} value={stationCount} onChange={(e) => setStationCount(e.target.value)} />
            </div>
          </div>

          {isEdit && (
            <div className="admin-modal-field">
              <label className="admin-checkbox-label">
                <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Active
              </label>
            </div>
          )}

          {!isEdit && (
            <>
              <div className="aosu-section-divider"><Shield size={12} /> Store manager login (recommended)</div>
              <label className="admin-checkbox-label aosu-create-owner">
                <input type="checkbox" checked={createManager} onChange={(e) => setCreateManager(e.target.checked)} />
                Also create the manager login for this store
              </label>
              {createManager && (
                <>
                  <div className="admin-modal-row">
                    <div className="admin-modal-field">
                      <label>Manager Name *</label>
                      <input type="text" value={managerName} onChange={(e) => setManagerName(e.target.value)} placeholder="John Manager" />
                    </div>
                    <div className="admin-modal-field">
                      <label>Manager Email *</label>
                      <input type="email" value={managerEmail} onChange={(e) => setManagerEmail(e.target.value)} placeholder="manager@store.com" />
                    </div>
                  </div>
                  <div className="admin-modal-field">
                    <label>Manager Password *</label>
                    <div className="aosu-pw-wrap">
                      <input
                        type={showPw ? 'text' : 'password'}
                        value={managerPassword}
                        onChange={(e) => setManagerPassword(e.target.value)}
                        placeholder="Min 8 chars · upper · lower · digit · special"
                        autoComplete="new-password"
                      />
                      <button type="button" className="aosu-pw-eye" onClick={() => setShowPw(s => !s)}>
                        {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          <div className="admin-modal-footer">
            <button type="button" className="admin-modal-cancel" onClick={onClose}>Cancel</button>
            <button type="submit" className="admin-modal-save" disabled={saving}>
              {saving && <Loader size={14} className="animate-spin" />}
              {isEdit ? 'Save Changes' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

/* ──────────────── User modal ──────────────── */

interface UserModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  editUser: AdminUserRow | null;
  orgId: string;
  storeId?: string;
  storeName?: string;
}

const UserModal = ({ open, onClose, onSaved, editUser, orgId, storeId, storeName }: UserModalProps) => {
  const isEdit = !!editUser;
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<Role>('staff');
  const [status, setStatus] = useState<UserStatus>('active');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tempPwShown, setTempPwShown] = useState<string | null>(null);

  useEffect(() => {
    if (editUser) {
      setName(editUser.name || ''); setEmail(editUser.email || ''); setPhone(editUser.phone || '');
      setRole(editUser.role || 'staff'); setStatus(editUser.status || 'active');
    } else {
      setName(''); setEmail(''); setPhone(''); setRole(storeId ? 'cashier' : 'staff'); setStatus('active');
      setPassword(''); setTempPwShown(null);
    }
  }, [editUser, open, storeId]);

  if (!open) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) { toast.error('Name and email are required'); return; }

    setSaving(true);
    try {
      if (isEdit && editUser) {
        await updateAdminUser(editUser.id, { name: name.trim(), email: email.trim(), phone: phone || null, role, status });
        toast.success('User updated');
        onSaved();
        onClose();
      } else {
        const payload: Record<string, unknown> = {
          name: name.trim(), email: email.trim(), phone: phone || null,
          role, status, orgId,
        };
        if (storeId) payload.storeId = storeId;
        if (password) payload.password = password;

        const res = await createAdminUser(payload) as { tempPassword?: string | null };
        toast.success('User created');
        if (res.tempPassword) {
          // Server generated a temp password — show once.
          setTempPwShown(res.tempPassword);
        } else {
          onSaved();
          onClose();
        }
        if (!res.tempPassword) onSaved();
      }
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error || `Failed to ${isEdit ? 'update' : 'create'} user`);
    } finally {
      setSaving(false);
    }
  };

  if (tempPwShown) {
    return (
      <div className="admin-modal-overlay" onClick={onClose}>
        <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
          <div className="admin-modal-header">
            <h2 className="admin-modal-title">User created</h2>
            <button className="admin-modal-close" onClick={() => { onSaved(); onClose(); }}><X size={18} /></button>
          </div>
          <div className="aosu-temp-pw-body">
            <p>Deliver this temporary password to the user securely. It will not be shown again.</p>
            <div className="aosu-temp-pw-box">{tempPwShown}</div>
            <button
              className="admin-modal-save"
              onClick={() => { navigator.clipboard.writeText(tempPwShown); toast.success('Password copied'); }}
            >
              Copy to clipboard
            </button>
          </div>
          <div className="admin-modal-footer">
            <button className="admin-modal-save" onClick={() => { onSaved(); onClose(); }}>Done</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-modal-overlay" onClick={onClose}>
      <div className="admin-modal aosu-modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="admin-modal-header">
          <h2 className="admin-modal-title">
            {isEdit ? 'Edit User' : storeId ? `Create User in ${storeName}` : 'Create User'}
          </h2>
          <button className="admin-modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        <form className="admin-modal-form" onSubmit={handleSubmit}>
          <div className="admin-modal-field">
            <label>Name *</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" required />
          </div>
          <div className="admin-modal-field">
            <label>Email *</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@example.com" required />
          </div>
          <div className="admin-modal-row">
            <div className="admin-modal-field">
              <label>Phone</label>
              <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Optional" />
            </div>
            <div className="admin-modal-field">
              <label>Role</label>
              <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
                {ROLE_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          </div>
          <div className="admin-modal-row">
            <div className="admin-modal-field">
              <label>Status</label>
              <select value={status} onChange={(e) => setStatus(e.target.value as UserStatus)}>
                {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            {!isEdit && (
              <div className="admin-modal-field">
                <label>Password (optional — auto-generated if blank)</label>
                <div className="aosu-pw-wrap">
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Min 8 chars · upper · lower · digit · special"
                    autoComplete="new-password"
                  />
                  <button type="button" className="aosu-pw-eye" onClick={() => setShowPw(s => !s)}>
                    {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="admin-modal-footer">
            <button type="button" className="admin-modal-cancel" onClick={onClose}>Cancel</button>
            <button type="submit" className="admin-modal-save" disabled={saving}>
              {saving && <Loader size={14} className="animate-spin" />}
              {isEdit ? 'Save Changes' : 'Create User'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

/* ──────────────── Page ──────────────── */

const AdminOrgStoreUser = () => {
  const confirm = useConfirm();
  const [searchParams, setSearchParams] = useSearchParams();
  const orgId = searchParams.get('orgId') || '';
  const storeId = searchParams.get('storeId') || '';

  /* ─── Org level ─── */
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [orgsTotal, setOrgsTotal] = useState(0);
  const [orgsLoading, setOrgsLoading] = useState(true);
  const [orgsSearch, setOrgsSearch] = useState('');
  const [orgsPage, setOrgsPage] = useState(1);
  const [orgModal, setOrgModal] = useState<{ open: boolean; edit: Organization | null }>({ open: false, edit: null });
  const [wipeOrg, setWipeOrg] = useState<Organization | null>(null);
  const [wipeConfirm, setWipeConfirm] = useState('');
  const [wipePermanent, setWipePermanent] = useState(false);
  const [wipeSaving, setWipeSaving] = useState(false);

  /* ─── Store level ─── */
  const [stores, setStores] = useState<AdminStore[]>([]);
  const [storesLoading, setStoresLoading] = useState(false);
  const [storesSearch, setStoresSearch] = useState('');
  const [storeModal, setStoreModal] = useState<{ open: boolean; edit: AdminStore | null }>({ open: false, edit: null });

  /* ─── User level ─── */
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersSearch, setUsersSearch] = useState('');
  const [userModal, setUserModal] = useState<{ open: boolean; edit: AdminUserRow | null }>({ open: false, edit: null });

  const limit = 25;

  const selectedOrg = useMemo(() => orgs.find(o => o.id === orgId) || null, [orgs, orgId]);
  const selectedStore = useMemo(() => stores.find(s => s.id === storeId) || null, [stores, storeId]);

  /* ─── Loaders ─── */

  const fetchOrgs = useCallback(async () => {
    setOrgsLoading(true);
    try {
      const params: Record<string, unknown> = { page: orgsPage, limit };
      if (orgsSearch) params.search = orgsSearch;
      const res = await getAdminOrganizations(params);
      setOrgs(res.data); setOrgsTotal(res.total);
    } catch {
      toast.error('Failed to load organizations');
    } finally { setOrgsLoading(false); }
  }, [orgsPage, orgsSearch]);

  const fetchStores = useCallback(async () => {
    if (!orgId) return;
    setStoresLoading(true);
    try {
      const params: Record<string, unknown> = { orgId, limit: 200 };
      if (storesSearch) params.search = storesSearch;
      const res = await getAdminStores(params);
      setStores(res.data || []);
    } catch {
      toast.error('Failed to load stores');
    } finally { setStoresLoading(false); }
  }, [orgId, storesSearch]);

  const fetchUsers = useCallback(async () => {
    if (!orgId) return;
    setUsersLoading(true);
    try {
      const params: Record<string, unknown> = { limit: 200 };
      if (storeId) params.storeId = storeId;
      else params.orgId = orgId;
      if (usersSearch) params.search = usersSearch;
      const res = await getAdminUsers(params);
      setUsers(res.data || []);
    } catch {
      toast.error('Failed to load users');
    } finally { setUsersLoading(false); }
  }, [orgId, storeId, usersSearch]);

  useEffect(() => { fetchOrgs(); }, [fetchOrgs]);
  useEffect(() => { if (orgId) fetchStores(); }, [orgId, fetchStores]);
  useEffect(() => { if (orgId) fetchUsers(); }, [orgId, storeId, fetchUsers]);

  /* ─── Navigation ─── */

  const drillIntoOrg = (id: string) => setSearchParams({ orgId: id });
  const drillIntoStore = (id: string) => setSearchParams({ orgId, storeId: id });
  const backToOrgs = () => setSearchParams({});
  const backToStores = () => setSearchParams({ orgId });

  /* ─── Org actions ─── */

  const handleDeleteOrg = async (org: Organization) => {
    if (!await confirm({
      title: 'Deactivate organization?',
      message: `Deactivate "${org.name}"? This will suspend the organization.`,
      confirmLabel: 'Deactivate', danger: true,
    })) return;
    try {
      await deleteAdminOrganization(org.id);
      toast.success(`${org.name} deactivated`);
      fetchOrgs();
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error || 'Failed to deactivate organization');
    }
  };

  const handleWipe = async () => {
    if (!wipeOrg) return;
    if (wipeConfirm !== 'DELETE ALL') { toast.error('Type DELETE ALL exactly to confirm'); return; }
    setWipeSaving(true);
    try {
      const res = await deleteAllOrgProducts(wipeOrg.id, 'DELETE ALL', wipePermanent);
      toast.success(`${res.deleted} product(s) deleted in ${wipeOrg.name}`);
      setWipeOrg(null); setWipeConfirm(''); setWipePermanent(false);
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error || 'Failed to wipe catalog');
    } finally { setWipeSaving(false); }
  };

  /* ─── Store actions ─── */

  const handleDeleteStore = async (store: AdminStore) => {
    if (!await confirm({
      title: `Deactivate "${store.name}"?`,
      message: 'Soft delete — store is hidden from active lists. Historical data stays intact.',
      confirmLabel: 'Deactivate', danger: true,
    })) return;
    try {
      await deleteAdminStore(store.id);
      toast.success(`${store.name} deactivated`);
      fetchStores();
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error || 'Failed to deactivate store');
    }
  };

  /* ─── User actions ─── */

  const handleUserStatus = async (action: 'approve' | 'suspend' | 'reject', user: AdminUserRow) => {
    try {
      if (action === 'approve') await approveAdminUser(user.id);
      else if (action === 'suspend') await suspendAdminUser(user.id);
      else await rejectAdminUser(user.id);
      toast.success(`${user.name} ${action === 'approve' ? 'approved' : action === 'suspend' ? 'suspended' : 'rejected'}`);
      fetchUsers();
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error || 'Action failed');
    }
  };

  const handleDeleteUser = async (user: AdminUserRow) => {
    if (!await confirm({
      title: `Delete user "${user.name}"?`,
      message: 'This action cannot be undone. The user will lose access to every organisation they were a member of.',
      confirmLabel: 'Delete', danger: true,
    })) return;
    try {
      await deleteAdminUser(user.id);
      toast.success(`${user.name} deleted`);
      fetchUsers();
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error || 'Delete failed');
    }
  };

  const handleLoginAs = async (u: AdminUserRow) => {
    try {
      const res = await impersonateUser(u.id);
      const d = (res as unknown as { data?: { token: string; user: unknown } }).data || (res as unknown as { token: string; user: unknown });
      const userParam = encodeURIComponent(JSON.stringify(d.user));
      const portalBase = resolvePortalBase();
      if (!portalBase) { toast.error('Portal URL not configured — set VITE_PORTAL_URL in admin-app/.env'); return; }
      window.open(`${portalBase}/impersonate?token=${d.token}&user=${userParam}`, '_blank');
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error || 'Impersonation failed');
    }
  };

  function resolvePortalBase(): string | null {
    const envUrl = import.meta.env.VITE_PORTAL_URL;
    if (envUrl) return envUrl.replace(/\/$/, '');
    const origin = window.location.origin;
    if (origin.includes('admin.')) return origin.replace('admin.', '');
    if (origin.includes(':5175'))  return origin.replace(':5175', ':5173');
    return null;
  }

  /* ─── Render ─── */

  const orgTotalPages = Math.ceil(orgsTotal / limit);

  // Breadcrumb
  const renderBreadcrumb = () => (
    <div className="aosu-breadcrumbs">
      <button className={`aosu-crumb ${!orgId ? 'aosu-crumb-active' : ''}`} onClick={backToOrgs}>
        <Building2 size={13} /> Organizations
      </button>
      {orgId && selectedOrg && (
        <>
          <ChevronRight size={12} className="aosu-crumb-sep" />
          <button className={`aosu-crumb ${!storeId ? 'aosu-crumb-active' : ''}`} onClick={backToStores}>
            <Store size={13} /> {selectedOrg.name}
          </button>
        </>
      )}
      {orgId && storeId && selectedStore && (
        <>
          <ChevronRight size={12} className="aosu-crumb-sep" />
          <span className="aosu-crumb aosu-crumb-active">
            <Users size={13} /> {selectedStore.name}
          </span>
        </>
      )}
    </div>
  );

  return (
    <>
      <div className="admin-header">
        <div className="admin-header-left">
          <div className="admin-header-icon"><Building2 size={22} /></div>
          <div>
            <h1>Organization / Store</h1>
            <p>Drill into organizations, stores, and their users</p>
          </div>
        </div>
      </div>

      {renderBreadcrumb()}

      {/* ─── Org level ─── */}
      {!orgId && (
        <>
          <div className="aosu-toolbar">
            <div className="admin-search aosu-search">
              <Search size={14} className="admin-search-icon" />
              <input placeholder="Search organizations..." value={orgsSearch} onChange={(e) => { setOrgsSearch(e.target.value); setOrgsPage(1); }} />
            </div>
            <button className="admin-btn-icon" onClick={fetchOrgs} title="Refresh"><RefreshCw size={15} /></button>
            <button className="admin-btn-primary" onClick={() => setOrgModal({ open: true, edit: null })}>
              <Plus size={15} /> Create Organization
            </button>
          </div>

          {orgsLoading ? (
            <div className="admin-loading"><Loader className="animate-spin" size={20} /></div>
          ) : orgs.length === 0 ? (
            <div className="admin-empty"><span className="admin-empty-text">No organizations found</span></div>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>{['Name', 'Slug', 'Plan', 'Users', 'Stores', 'Status', 'Created', 'Actions'].map(h => <th key={h}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {orgs.map(o => (
                    <tr key={o.id} className="aosu-row-clickable" onClick={() => drillIntoOrg(String(o.id))}>
                      <td>
                        <span className="admin-name-cell">
                          <span className="admin-name-icon"><Building2 size={14} /></span>
                          {o.name}
                          <ChevronRight size={12} className="aosu-row-chevron" />
                        </span>
                      </td>
                      <td className="mono">{o.slug}</td>
                      <td>{planBadge(o.plan)}</td>
                      <td>{o._count?.users ?? '-'}</td>
                      <td>{o._count?.stores ?? '-'}</td>
                      <td>
                        <span className={`admin-badge sm ${o.isActive ? 'active' : 'suspended'}`}>{o.isActive ? 'Active' : 'Inactive'}</span>
                      </td>
                      <td className="muted">{o.createdAt ? new Date(o.createdAt).toLocaleDateString() : '-'}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="admin-row-actions">
                          <button className="admin-btn-icon" onClick={() => setOrgModal({ open: true, edit: o })} title="Edit"><Edit3 size={14} /></button>
                          <button className="admin-btn-icon danger" onClick={() => setWipeOrg(o)} title="Wipe product catalog"><Skull size={14} /></button>
                          <button className="admin-btn-icon danger" onClick={() => handleDeleteOrg(o)} title="Deactivate"><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {orgTotalPages > 1 && (
            <div className="admin-pagination">
              <button disabled={orgsPage <= 1} onClick={() => setOrgsPage(p => p - 1)}>Previous</button>
              <span className="page-info">Page {orgsPage} of {orgTotalPages}</span>
              <button disabled={orgsPage >= orgTotalPages} onClick={() => setOrgsPage(p => p + 1)}>Next</button>
            </div>
          )}
        </>
      )}

      {/* ─── Store level (org selected, no store) ─── */}
      {orgId && !storeId && (
        <>
          <div className="aosu-toolbar">
            <button className="admin-btn-icon" onClick={backToOrgs} title="Back to organizations"><ArrowLeft size={15} /></button>
            <div className="admin-search aosu-search">
              <Search size={14} className="admin-search-icon" />
              <input placeholder="Search stores..." value={storesSearch} onChange={(e) => setStoresSearch(e.target.value)} />
            </div>
            <button className="admin-btn-icon" onClick={fetchStores} title="Refresh"><RefreshCw size={15} /></button>
            <button className="admin-btn-primary" onClick={() => setStoreModal({ open: true, edit: null })}>
              <Plus size={15} /> Create Store
            </button>
          </div>

          {/* Org-level users (those not bound to any store) appear at the bottom — link to drill in */}

          {storesLoading ? (
            <div className="admin-loading"><Loader className="animate-spin" size={20} /></div>
          ) : stores.length === 0 ? (
            <div className="admin-empty">
              <Store size={40} className="admin-empty-icon" />
              <p className="admin-empty-text">No stores in this organization yet</p>
              <button className="admin-btn-primary" onClick={() => setStoreModal({ open: true, edit: null })}>
                <Plus size={15} /> Create the first store
              </button>
            </div>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>{['Name', 'Address', 'Stations', 'Users', 'Status', 'Created', 'Actions'].map(h => <th key={h}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {stores.map(s => (
                    <tr key={s.id} className="aosu-row-clickable" onClick={() => drillIntoStore(String(s.id))}>
                      <td>
                        <span className="admin-name-cell">
                          <span className="admin-name-icon"><Store size={14} /></span>
                          {s.name}
                          <ChevronRight size={12} className="aosu-row-chevron" />
                        </span>
                      </td>
                      <td className="muted">{s.address || '-'}</td>
                      <td>{s.stationCount ?? '-'}</td>
                      <td>{s._count?.users ?? '-'}</td>
                      <td>
                        <span className={`admin-badge sm ${s.isActive !== false ? 'active' : 'suspended'}`}>{s.isActive !== false ? 'Active' : 'Inactive'}</span>
                      </td>
                      <td className="muted">{s.createdAt ? new Date(s.createdAt).toLocaleDateString() : '-'}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="admin-row-actions">
                          <button className="admin-btn-icon" onClick={() => setStoreModal({ open: true, edit: s })} title="Edit"><Edit3 size={14} /></button>
                          <button className="admin-btn-icon danger" onClick={() => handleDeleteStore(s)} title="Deactivate"><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Org-level users not bound to any store */}
          <div className="aosu-section-header">
            <div>
              <h2>Org-level users</h2>
              <p className="aosu-section-sub">Users with org-wide access (admins, owners, billing). Drill into a store for store-bound staff.</p>
            </div>
            <button className="admin-btn-primary" onClick={() => setUserModal({ open: true, edit: null })}>
              <Plus size={15} /> Create User
            </button>
          </div>

          {usersLoading ? (
            <div className="admin-loading"><Loader className="animate-spin" size={20} /></div>
          ) : users.length === 0 ? (
            <div className="admin-empty"><span className="admin-empty-text">No org-level users</span></div>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>{['Name', 'Email', 'Role', 'Status', 'Joined', 'Actions'].map(h => <th key={h}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id}>
                      <td className="primary">{u.name}</td>
                      <td>{u.email}</td>
                      <td>{roleBadge(u.role)}</td>
                      <td>{statusBadge(u.status)}</td>
                      <td className="muted">{u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '-'}</td>
                      <td>
                        <div className="admin-row-actions">
                          {u.status === 'pending' && (
                            <>
                              <button onClick={() => handleUserStatus('approve', u)} className="admin-action-btn approve"><Check size={11} /> Approve</button>
                              <button onClick={() => handleUserStatus('reject', u)} className="admin-action-btn reject"><Ban size={11} /> Reject</button>
                            </>
                          )}
                          {u.status === 'active' && u.role !== 'superadmin' && (
                            <button onClick={() => handleUserStatus('suspend', u)} className="admin-action-btn suspend"><Ban size={11} /> Suspend</button>
                          )}
                          {u.status === 'suspended' && (
                            <button onClick={() => handleUserStatus('approve', u)} className="admin-action-btn approve"><Check size={11} /> Reactivate</button>
                          )}
                          <button onClick={() => setUserModal({ open: true, edit: u })} className="admin-btn-icon" title="Edit user"><Edit3 size={13} /></button>
                          {u.status === 'active' && u.role !== 'superadmin' && (
                            <button onClick={() => handleLoginAs(u)} className="admin-btn-icon" title="Login as user"><LogIn size={13} /></button>
                          )}
                          <button onClick={() => handleDeleteUser(u)} className="admin-btn-icon danger" title="Delete user"><Trash2 size={13} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ─── User level (store selected) ─── */}
      {orgId && storeId && (
        <>
          <div className="aosu-toolbar">
            <button className="admin-btn-icon" onClick={backToStores} title="Back to stores"><ArrowLeft size={15} /></button>
            <div className="admin-search aosu-search">
              <Search size={14} className="admin-search-icon" />
              <input placeholder="Search users..." value={usersSearch} onChange={(e) => setUsersSearch(e.target.value)} />
            </div>
            <button className="admin-btn-icon" onClick={fetchUsers} title="Refresh"><RefreshCw size={15} /></button>
            <button className="admin-btn-primary" onClick={() => setUserModal({ open: true, edit: null })}>
              <Plus size={15} /> Create User
            </button>
          </div>

          {usersLoading ? (
            <div className="admin-loading"><Loader className="animate-spin" size={20} /></div>
          ) : users.length === 0 ? (
            <div className="admin-empty">
              <Users size={40} className="admin-empty-icon" />
              <p className="admin-empty-text">No users in this store yet</p>
              <button className="admin-btn-primary" onClick={() => setUserModal({ open: true, edit: null })}>
                <Plus size={15} /> Create the first user
              </button>
            </div>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>{['Name', 'Email', 'Role', 'Status', 'Joined', 'Actions'].map(h => <th key={h}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id}>
                      <td className="primary">{u.name}</td>
                      <td>{u.email}</td>
                      <td>{roleBadge(u.role)}</td>
                      <td>{statusBadge(u.status)}</td>
                      <td className="muted">{u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '-'}</td>
                      <td>
                        <div className="admin-row-actions">
                          {u.status === 'pending' && (
                            <>
                              <button onClick={() => handleUserStatus('approve', u)} className="admin-action-btn approve"><Check size={11} /> Approve</button>
                              <button onClick={() => handleUserStatus('reject', u)} className="admin-action-btn reject"><Ban size={11} /> Reject</button>
                            </>
                          )}
                          {u.status === 'active' && u.role !== 'superadmin' && (
                            <button onClick={() => handleUserStatus('suspend', u)} className="admin-action-btn suspend"><Ban size={11} /> Suspend</button>
                          )}
                          {u.status === 'suspended' && (
                            <button onClick={() => handleUserStatus('approve', u)} className="admin-action-btn approve"><Check size={11} /> Reactivate</button>
                          )}
                          <button onClick={() => setUserModal({ open: true, edit: u })} className="admin-btn-icon" title="Edit user"><Edit3 size={13} /></button>
                          {u.status === 'active' && u.role !== 'superadmin' && (
                            <button onClick={() => handleLoginAs(u)} className="admin-btn-icon" title="Login as user"><LogIn size={13} /></button>
                          )}
                          <button onClick={() => handleDeleteUser(u)} className="admin-btn-icon danger" title="Delete user"><Trash2 size={13} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Modals */}
      <OrgModal
        open={orgModal.open}
        onClose={() => setOrgModal({ open: false, edit: null })}
        onSaved={fetchOrgs}
        editOrg={orgModal.edit}
      />
      <StoreModal
        open={storeModal.open}
        onClose={() => setStoreModal({ open: false, edit: null })}
        onSaved={fetchStores}
        editStore={storeModal.edit}
        orgId={orgId}
        orgName={selectedOrg?.name || ''}
      />
      <UserModal
        open={userModal.open}
        onClose={() => setUserModal({ open: false, edit: null })}
        onSaved={fetchUsers}
        editUser={userModal.edit}
        orgId={orgId}
        storeId={storeId || undefined}
        storeName={selectedStore?.name}
      />

      {/* Wipe Catalog modal */}
      {wipeOrg && (
        <div className="admin-modal-overlay" onClick={() => !wipeSaving && setWipeOrg(null)}>
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <div className="admin-modal-header aosu-wipe-header">
              <h2 className="admin-modal-title aosu-wipe-title"><Skull size={20} /> Wipe Catalog</h2>
              <button className="admin-modal-close" onClick={() => setWipeOrg(null)}><X size={18} /></button>
            </div>
            <div className="aosu-wipe-body">
              <p>
                This will delete <strong>every product</strong> in <strong>{wipeOrg.name}</strong>.
                {wipePermanent ? <> Permanent — cannot be undone.</> : <> Soft delete — recoverable via re-import.</>}
              </p>
              <label className="aosu-wipe-permanent">
                <input type="checkbox" checked={wipePermanent} onChange={(e) => setWipePermanent(e.target.checked)} disabled={wipeSaving} />
                <span><strong>Permanently delete</strong> (blocked if products are referenced by purchase orders)</span>
              </label>
              <div className="aosu-wipe-confirm">
                <label>Type <span className="aosu-wipe-token">DELETE ALL</span> to confirm</label>
                <input type="text" value={wipeConfirm} onChange={(e) => setWipeConfirm(e.target.value)} placeholder="DELETE ALL" disabled={wipeSaving} autoFocus />
              </div>
              <div className="admin-modal-footer">
                <button type="button" className="admin-modal-cancel" onClick={() => setWipeOrg(null)} disabled={wipeSaving}>Cancel</button>
                <button
                  type="button"
                  onClick={handleWipe}
                  disabled={wipeSaving || wipeConfirm !== 'DELETE ALL'}
                  className="aosu-wipe-btn"
                >
                  {wipeSaving ? <Loader size={13} className="animate-spin" /> : <Skull size={13} />}
                  {wipeSaving ? 'Wiping…' : 'Wipe Catalog'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default AdminOrgStoreUser;
