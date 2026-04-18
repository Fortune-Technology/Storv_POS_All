import React, { useState } from 'react';
import { X, ShieldAlert, Copy, Check, Mail, ArrowRight, CheckCircle2 } from 'lucide-react';
import { toast } from 'react-toastify';
import { createInvitation } from '../services/api';
import './TransferOwnershipModal.css';

/**
 * Transfer ownership of a store/organisation to a new owner.
 *
 *   Phase 2 created the backend plumbing (`transferOwnership: true` on the
 *   invitation). This modal is the UI that sets that flag.
 *
 *   On successful send, we show the generated accept URL so the current
 *   owner can deliver it out-of-band (SMS, WhatsApp, in person). The same
 *   email is also sent automatically via SMTP.
 *
 * Props:
 *   store     — the store being transferred (includes orgId, orgName, name)
 *   onClose() — close without transferring
 *   onSent(invitation, acceptUrl) — after a successful send
 */
export default function TransferOwnershipModal({ store, onClose, onSent }) {
  const [email,       setEmail]       = useState('');
  const [phone,       setPhone]       = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [submitting,  setSubmitting]  = useState(false);

  // Success state — persists the generated acceptUrl so the admin can copy.
  const [sentInvitation, setSentInvitation] = useState(null);
  const [copied,         setCopied]         = useState(false);

  const canSend =
    !!email.trim() &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) &&
    confirmText === 'TRANSFER' &&
    !submitting;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSend) return;
    setSubmitting(true);
    try {
      // X-Store-Id override — the backend derives req.orgId from the active
      // store. When transferring a store that isn't the user's *current*
      // active store, we explicitly pin the header to the target store's
      // id so req.orgId resolves to the right org.
      const result = await createInvitation(
        {
          email:             email.trim().toLowerCase(),
          phone:             phone.trim() || undefined,
          role:              'owner',
          transferOwnership: true,
          storeIds:          [],                 // transfer affects whole org, not store-scoped
        },
        { 'X-Store-Id': store.id },
      );
      setSentInvitation(result);
      onSent?.(result.invitation, result.acceptUrl);
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Could not send transfer invitation.');
    } finally {
      setSubmitting(false);
    }
  }

  async function copyUrl() {
    if (!sentInvitation?.acceptUrl) return;
    try {
      await navigator.clipboard.writeText(sentInvitation.acceptUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Could not copy link.');
    }
  }

  return (
    <div
      className="tom-backdrop"
      onMouseDown={e => e.target === e.currentTarget && onClose()}
    >
      <div className="tom-modal">
        {sentInvitation ? (
          // ── Success screen ────────────────────────────────────────────
          <>
            <div className="tom-header tom-header--success">
              <CheckCircle2 size={22} />
              <h2>Transfer invitation sent</h2>
              <button className="tom-close" onClick={onClose}><X size={18} /></button>
            </div>
            <div className="tom-body">
              <p className="tom-lead">
                We've emailed <strong>{sentInvitation.invitation.email}</strong> a secure accept link.
                Nothing changes until they accept.
              </p>
              <div className="tom-hint-box">
                <strong>Until accepted:</strong>
                <ul>
                  <li>You still own and manage <strong>{store.orgName || store.name}</strong>.</li>
                  <li>The pending invitation can be revoked from <em>Invitations</em>.</li>
                  <li>Ownership transfers the instant the recipient clicks "Accept Transfer".</li>
                </ul>
              </div>
              <div className="tom-copy-row">
                <div className="tom-copy-label">Accept link (in case they miss the email)</div>
                <div className="tom-copy-wrap">
                  <input
                    type="text"
                    value={sentInvitation.acceptUrl}
                    readOnly
                    onFocus={e => e.target.select()}
                  />
                  <button type="button" className="tom-copy-btn" onClick={copyUrl}>
                    {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
              <div className="tom-footer">
                <button type="button" className="tom-btn tom-btn--primary" onClick={onClose}>Done</button>
              </div>
            </div>
          </>
        ) : (
          // ── Form screen ───────────────────────────────────────────────
          <form onSubmit={handleSubmit}>
            <div className="tom-header tom-header--danger">
              <ShieldAlert size={22} />
              <h2>Transfer Ownership</h2>
              <button type="button" className="tom-close" onClick={onClose}><X size={18} /></button>
            </div>
            <div className="tom-body">
              <div className="tom-store-row">
                <div>
                  <div className="tom-store-label">You are about to transfer</div>
                  <div className="tom-store-name">
                    {store.orgName || 'Organisation'}
                  </div>
                  <div className="tom-store-sub">
                    Including all stores, products, vendors, customers, sales history,
                    staff records, and reports.
                  </div>
                </div>
                <ArrowRight size={24} className="tom-arrow" />
              </div>

              <div className="tom-warning">
                <strong>This is permanent.</strong> Once accepted:
                <ul>
                  <li>The new owner has full control of this account.</li>
                  <li><strong>You will lose all access</strong> — you won't be able to view products, transactions, or anything else in this organisation.</li>
                  <li>All historical data (sales, customers, inventory, staff) transfers with the business.</li>
                  <li>Your login still works for any other organisations you belong to.</li>
                </ul>
              </div>

              <div className="tom-field">
                <label>New owner's email *</label>
                <div className="tom-input-wrap">
                  <Mail size={14} className="tom-input-icon" />
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="buyer@example.com"
                    required
                    autoFocus
                  />
                </div>
              </div>

              <div className="tom-field">
                <label>New owner's phone (optional)</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  placeholder="+1 555 0100"
                />
                <p className="tom-hint">We'll text them the accept link if an SMS provider is configured.</p>
              </div>

              <div className="tom-field tom-field--confirm">
                <label>Type <code>TRANSFER</code> to confirm</label>
                <input
                  type="text"
                  value={confirmText}
                  onChange={e => setConfirmText(e.target.value)}
                  placeholder="TRANSFER"
                  autoComplete="off"
                  spellCheck="false"
                />
              </div>

              <div className="tom-footer">
                <button type="button" className="tom-btn" onClick={onClose} disabled={submitting}>Cancel</button>
                <button type="submit" className="tom-btn tom-btn--danger" disabled={!canSend}>
                  {submitting ? 'Sending…' : 'Send Transfer Invitation'}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
