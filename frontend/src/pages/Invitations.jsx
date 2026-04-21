import React, { useState, useEffect, useCallback } from 'react';
import { Mail, Plus, RefreshCw, Trash2, Copy, Check, X, Clock, AlertCircle } from 'lucide-react';
import { toast } from 'react-toastify';
import '../styles/portal.css';
import './Invitations.css';

import {
  getInvitations,
  createInvitation,
  resendInvitation,
  revokeInvitation,
  getStores,
  listRoles,
} from '../services/api';

// ─── Helpers ─────────────────────────────────────────────────────────────────
const STATUS_BADGE = {
  pending: { label: 'Pending', className: 'inv-badge--pending' },
  accepted: { label: 'Accepted', className: 'inv-badge--accepted' },
  revoked: { label: 'Revoked', className: 'inv-badge--revoked' },
  expired: { label: 'Expired', className: 'inv-badge--expired' },
};

function formatDate(iso) {
  if (!iso) return 'N/A';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function daysLeft(iso) {
  if (!iso) return 0;
  const ms = new Date(iso).getTime() - Date.now();
  if (ms < 0) return 0;
  return Math.ceil(ms / 86400000);
}

// ─── Page ────────────────────────────────────────────────────────────────────
export default function Invitations() {
  const [invitations, setInvitations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');   // all | pending | accepted | revoked | expired
  const [showCreate, setShowCreate] = useState(false);
  const [copiedId, setCopiedId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getInvitations();
      setInvitations(data);
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to load invitations');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = filter === 'all'
    ? invitations
    : invitations.filter(i => i.status === filter);

  async function handleResend(id) {
    try {
      const { acceptUrl } = await resendInvitation(id);
      toast.success('Invitation resent');
      await navigator.clipboard?.writeText(acceptUrl).catch(() => { });
      load();
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to resend invitation');
    }
  }

  async function handleRevoke(id) {
    if (!window.confirm('Revoke this invitation? The recipient will no longer be able to accept.')) return;
    try {
      await revokeInvitation(id);
      toast.success('Invitation revoked');
      load();
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to revoke invitation');
    }
  }

  async function handleCopy(id, token) {
    if (!token) return;
    const base = window.location.origin;
    const url = `${base}/invite/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      toast.error('Could not copy link');
    }
  }

  return (
    <div className="inv-page p-page">
      <div className="p-header">
        <div className="p-header-left">
          <div className="p-header-icon"><Mail size={22} /></div>
          <div>
            <h1 className="p-title">Invitations</h1>
            <p className="p-subtitle">Invite team members to your organisation. New users can accept from any device.</p>
          </div>
        </div>
        <div className="p-header-actions">
          <button className="inv-btn inv-btn--primary" onClick={() => setShowCreate(true)}>
            <Plus size={16} /> New Invitation
          </button>
        </div>
      </div>

      <div className="p-tabs">
        {['all', 'pending', 'accepted', 'revoked', 'expired'].map(key => (
          <button
            key={key}
            className={`p-tab ${filter === key ? 'active' : ''}`}
            onClick={() => setFilter(key)}
          >
            {key[0].toUpperCase() + key.slice(1)}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="inv-state">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="inv-state">
          <AlertCircle size={28} />
          <p>No {filter === 'all' ? '' : filter} invitations.</p>
        </div>
      ) : (
        <div className="inv-table-wrap">
          <table className="inv-table">
            <thead>
              <tr>
                <th>Recipient</th>
                <th>Role</th>
                <th>Status</th>
                <th>Sent</th>
                <th>Expires</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(inv => {
                const badge = STATUS_BADGE[inv.status] || { label: inv.status, className: '' };
                const days = daysLeft(inv.expiresAt);
                return (
                  <tr key={inv.id}>
                    <td>
                      <div className="inv-email">{inv.email}</div>
                      {inv.phone && <div className="inv-phone">{inv.phone}</div>}
                      {inv.transferOwnership && (
                        <div className="inv-transfer-tag">Ownership transfer</div>
                      )}
                    </td>
                    <td><span className="inv-role-chip">{inv.role}</span></td>
                    <td><span className={`inv-badge ${badge.className}`}>{badge.label}</span></td>
                    <td>{formatDate(inv.createdAt)}</td>
                    <td>
                      {inv.status === 'pending' ? (
                        <span className="inv-expires">
                          <Clock size={13} /> {days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'}`}
                        </span>
                      ) : (
                        formatDate(inv.expiresAt)
                      )}
                    </td>
                    <td>
                      <div className="inv-actions">
                        {inv.status === 'pending' && (
                          <>
                            <button
                              className="inv-icon-btn"
                              title="Copy accept link"
                              onClick={() => handleCopy(inv.id, inv.token)}
                              disabled={!inv.token}
                            >
                              {copiedId === inv.id ? <Check size={15} /> : <Copy size={15} />}
                            </button>
                            <button
                              className="inv-icon-btn"
                              title="Resend"
                              onClick={() => handleResend(inv.id)}
                            >
                              <RefreshCw size={15} />
                            </button>
                            <button
                              className="inv-icon-btn inv-icon-btn--danger"
                              title="Revoke"
                              onClick={() => handleRevoke(inv.id)}
                            >
                              <Trash2 size={15} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <CreateInvitationModal
          onClose={() => setShowCreate(false)}
          onCreated={(result) => {
            setShowCreate(false);
            load();
            if (result.acceptUrl) {
              navigator.clipboard?.writeText(result.acceptUrl).catch(() => { });
              toast.success('Invitation sent — accept link copied to clipboard');
            }
          }}
        />
      )}
    </div>
  );
}

// ─── Create Modal ────────────────────────────────────────────────────────────
function CreateInvitationModal({ onClose, onCreated }) {
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState('cashier');
  const [storeIds, setStoreIds] = useState([]);
  const [stores, setStores] = useState([]);
  const [roles, setRoles] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    getStores().then(setStores).catch(() => { });
    listRoles?.()
      .then(r => {
        const assignable = (r || []).filter(x => x.status === 'active' && !['owner', 'superadmin'].includes(x.key));
        setRoles(assignable);
      })
      .catch(() => setRoles([
        { key: 'admin', name: 'Admin' },
        { key: 'manager', name: 'Manager' },
        { key: 'cashier', name: 'Cashier' },
      ]));
  }, []);

  const isCashier = role === 'cashier';

  function toggleStore(id) {
    setStoreIds(prev => {
      if (isCashier) return [id];
      return prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id];
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!email.trim()) return toast.error('Email is required');
    if (isCashier && storeIds.length !== 1) return toast.error('Cashiers must be assigned to exactly one store');

    setSubmitting(true);
    try {
      const result = await createInvitation({
        email: email.trim(),
        phone: phone.trim() || undefined,
        role,
        storeIds: storeIds.length ? storeIds : undefined,
      });
      onCreated(result);
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to send invitation');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="inv-modal-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="inv-modal">
        <div className="inv-modal-header">
          <h2>Invite Team Member</h2>
          <button className="inv-modal-close" onClick={onClose}><X size={20} /></button>
        </div>
        <form onSubmit={handleSubmit} className="inv-modal-form">
          <div className="inv-field">
            <label>Email address *</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@company.com" required autoFocus />
          </div>

          <div className="inv-field">
            <label>Phone (optional)</label>
            <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+1 555 0100" />
            <p className="inv-hint">We'll text them the invite link if an SMS provider is configured.</p>
          </div>

          <div className="inv-field">
            <label>Role *</label>
            <div className="inv-role-row">
              {roles.map(r => (
                <label key={r.key} className={`inv-role-option ${role === r.key ? 'inv-role-option--active' : ''}`}>
                  <input type="radio" name="role" value={r.key} checked={role === r.key} onChange={() => setRole(r.key)} />
                  <span>{r.name}</span>
                </label>
              ))}
            </div>
          </div>

          {stores.length > 0 && (
            <div className="inv-field">
              <label>{isCashier ? 'Assigned store *' : 'Store access (optional)'}</label>
              <div className="inv-store-list">
                {stores.map(s => (
                  <label key={s.id} className={`inv-store-option ${storeIds.includes(s.id) ? 'inv-store-option--active' : ''}`}>
                    <input
                      type={isCashier ? 'radio' : 'checkbox'}
                      checked={storeIds.includes(s.id)}
                      onChange={() => toggleStore(s.id)}
                    />
                    <span>
                      <strong>{s.name}</strong>
                      {s.orgName && <em className="inv-store-org"> · {s.orgName}</em>}
                    </span>
                  </label>
                ))}
              </div>
              {!isCashier && (
                <p className="inv-hint">Leave empty to grant access to all stores in this organisation.</p>
              )}
            </div>
          )}

          <div className="inv-modal-actions">
            <button type="button" className="inv-btn" onClick={onClose} disabled={submitting}>Cancel</button>
            <button type="submit" className="inv-btn inv-btn--primary" disabled={submitting}>
              {submitting ? 'Sending…' : 'Send Invitation'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
