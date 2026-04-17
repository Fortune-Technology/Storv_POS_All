/**
 * AdminMerchants.jsx
 *
 * Superadmin page for managing Dejavoo payment merchant credentials
 * per store. Each store has exactly one merchant row holding SPIn
 * (in-person), HPP (online), and Transact (card-on-file) credentials.
 *
 * Store owners + managers cannot access this page. Credentials never
 * leave the admin panel — the portal only gets a read-only status chip.
 *
 * New in this version:
 *   • Activation workflow — new merchants start `pending`, must pass a
 *     successful /test within 24h before they can be `active`.
 *   • Disable kill-switch — one click flips to `disabled` (blocks POS
 *     payment processing org-wide for that store).
 *   • Audit log drawer — shows every create/update/delete/test/activate/
 *     disable event for a merchant (secrets masked as `{changed: true}`).
 *   • Terminals drawer — per-device CRUD for P17/Z8/Z11 terminals, one
 *     per station, with optional per-device TPN override + live ping.
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  CreditCard, Plus, Edit3, Trash2, Play, X, Shield, RefreshCw,
  CheckCircle, XCircle, History, Cpu, Wifi, Lock, AlertTriangle,
} from 'lucide-react';
import { toast } from 'react-toastify';
import {
  listPaymentMerchants,
  createPaymentMerchant,
  updatePaymentMerchant,
  deletePaymentMerchant,
  testPaymentMerchant,
  activatePaymentMerchant,
  disablePaymentMerchant,
  getPaymentMerchantAudit,
  listPaymentTerminals,
  createPaymentTerminal,
  updatePaymentTerminal,
  deletePaymentTerminal,
  pingPaymentTerminal,
  getAdminOrganizations,
  getAdminStores,
} from '../services/api';
import './AdminMerchants.css';

const BLANK_FORM = {
  orgId: '',
  storeId: '',
  provider: 'dejavoo',
  environment: 'uat',
  spinTpn: '',
  spinAuthKey: '',
  spinBaseUrl: '',
  hppMerchantId: '',
  hppAuthKey: '',
  hppBaseUrl: '',
  transactApiKey: '',
  transactBaseUrl: '',
  ebtEnabled: false,
  debitEnabled: true,
  tokenizeEnabled: false,
  status: 'pending',
  notes: '',
};

const BLANK_TERMINAL = {
  merchantId: '',
  stationId: '',
  nickname: '',
  deviceSerialNumber: '',
  deviceModel: 'P17',
  overrideTpn: '',
  notes: '',
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function hoursSince(iso) {
  if (!iso) return Infinity;
  return (Date.now() - new Date(iso).getTime()) / 3600000;
}

// Can this merchant be activated right now?
// Rule: must have passed a test within the last 24h.
function canActivate(m) {
  if (m.status === 'active') return false;
  if (m.lastTestResult !== 'ok') return false;
  return hoursSince(m.lastTestedAt) <= 24;
}

function StatusPill({ status }) {
  const cls = {
    active:   'am-pill am-pill-active',
    pending:  'am-pill am-pill-pending',
    disabled: 'am-pill am-pill-disabled',
  }[status] || 'am-pill am-pill-untested';
  const label = (status || 'unknown').toUpperCase();
  return <span className={cls}>{label}</span>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export default function AdminMerchants() {
  const [merchants, setMerchants] = useState([]);
  const [orgs, setOrgs]       = useState([]);
  const [stores, setStores]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterOrg, setFilterOrg] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [search, setSearch]   = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm]       = useState(BLANK_FORM);
  const [saving, setSaving]   = useState(false);

  // Drawers
  const [auditFor, setAuditFor]       = useState(null); // merchant being inspected
  const [auditEntries, setAuditEntries] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);

  const [termFor, setTermFor]         = useState(null); // merchant whose terminals we're editing
  const [terminals, setTerminals]     = useState([]);
  const [termLoading, setTermLoading] = useState(false);
  const [termEditing, setTermEditing] = useState(null);
  const [termForm, setTermForm]       = useState(BLANK_TERMINAL);

  // ── Load merchants + scope ──
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [mRes, oRes, sRes] = await Promise.all([
        listPaymentMerchants(),
        getAdminOrganizations(),
        getAdminStores(),
      ]);
      setMerchants(mRes.merchants || []);
      setOrgs(oRes.organizations || oRes.data || []);
      setStores(sRes.stores || sRes.data || []);
    } catch (err) {
      toast.error('Failed to load merchants: ' + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Create / Edit ──
  const openCreate = () => {
    setEditingId(null);
    setForm(BLANK_FORM);
    setModalOpen(true);
  };

  const openEdit = (merchant) => {
    setEditingId(merchant.id);
    setForm({
      ...BLANK_FORM,
      orgId:           merchant.orgId,
      storeId:         merchant.storeId,
      provider:        merchant.provider,
      environment:     merchant.environment,
      spinTpn:         merchant.spinTpn       || '',
      spinAuthKey:     '',  // empty on edit = "leave unchanged"
      spinBaseUrl:     merchant.spinBaseUrl   || '',
      hppMerchantId:   merchant.hppMerchantId || '',
      hppAuthKey:      '',
      hppBaseUrl:      merchant.hppBaseUrl    || '',
      transactApiKey:  '',
      transactBaseUrl: merchant.transactBaseUrl || '',
      ebtEnabled:      !!merchant.ebtEnabled,
      debitEnabled:    merchant.debitEnabled !== false,
      tokenizeEnabled: !!merchant.tokenizeEnabled,
      status:          merchant.status || 'pending',
      notes:           merchant.notes  || '',
      spinAuthKeySet:    merchant.spinAuthKeySet,
      spinAuthKeyPreview: merchant.spinAuthKeyPreview,
      hppAuthKeySet:     merchant.hppAuthKeySet,
      hppAuthKeyPreview: merchant.hppAuthKeyPreview,
      transactApiKeySet:    merchant.transactApiKeySet,
      transactApiKeyPreview: merchant.transactApiKeyPreview,
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.orgId || !form.storeId) {
      toast.error('Organization and Store are required');
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        await updatePaymentMerchant(editingId, form);
        toast.success('Merchant updated — sensitive changes reset status to Pending');
      } else {
        await createPaymentMerchant(form);
        toast.success('Merchant created as Pending — test the terminal, then activate');
      }
      setModalOpen(false);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.error || err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (merchant) => {
    if (!window.confirm(`Delete payment merchant for "${merchant.storeName}"?\n\nThis cannot be undone and will also remove all linked terminals.`)) return;
    try {
      await deletePaymentMerchant(merchant.id);
      toast.success('Merchant deleted');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || err.message);
    }
  };

  const handleTest = async (merchant) => {
    try {
      const res = await testPaymentMerchant(merchant.id);
      if (res.success) toast.success('Credentials OK — terminal reachable. You can now Activate.');
      else toast.warn(res.result || 'Test failed');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || err.message);
    }
  };

  const handleActivate = async (merchant) => {
    if (!canActivate(merchant)) {
      toast.warn('Test the terminal successfully within the last 24 hours before activating.');
      return;
    }
    if (!window.confirm(`Activate payment processing for "${merchant.storeName}"?\n\nThe POS will immediately start accepting real card payments.`)) return;
    try {
      await activatePaymentMerchant(merchant.id);
      toast.success('Merchant activated');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || err.message);
    }
  };

  const handleDisable = async (merchant) => {
    const reason = window.prompt(
      `Disable payment processing for "${merchant.storeName}"?\n\n` +
      'This is a kill-switch — the POS will stop accepting card payments immediately.\n\n' +
      'Reason (shown in audit log):'
    );
    if (reason === null) return; // cancelled
    try {
      await disablePaymentMerchant(merchant.id, reason || 'No reason provided');
      toast.success('Merchant disabled');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || err.message);
    }
  };

  // ── Audit drawer ──
  const openAudit = async (merchant) => {
    setAuditFor(merchant);
    setAuditEntries([]);
    setAuditLoading(true);
    try {
      const res = await getPaymentMerchantAudit(merchant.id);
      setAuditEntries(res.entries || res.audit || []);
    } catch (err) {
      toast.error('Failed to load audit log: ' + (err.response?.data?.error || err.message));
    } finally {
      setAuditLoading(false);
    }
  };

  // ── Terminals drawer ──
  const openTerminals = async (merchant) => {
    setTermFor(merchant);
    setTerminals([]);
    setTermEditing(null);
    setTermForm({ ...BLANK_TERMINAL, merchantId: merchant.id });
    setTermLoading(true);
    try {
      const res = await listPaymentTerminals({ merchantId: merchant.id });
      setTerminals(res.terminals || []);
    } catch (err) {
      toast.error('Failed to load terminals: ' + (err.response?.data?.error || err.message));
    } finally {
      setTermLoading(false);
    }
  };

  const refreshTerminals = async () => {
    if (!termFor) return;
    try {
      const res = await listPaymentTerminals({ merchantId: termFor.id });
      setTerminals(res.terminals || []);
    } catch (err) {
      toast.error('Failed to refresh: ' + (err.response?.data?.error || err.message));
    }
  };

  const editTerminal = (t) => {
    setTermEditing(t.id);
    setTermForm({
      merchantId:         t.merchantId,
      stationId:          t.stationId || '',
      nickname:           t.nickname || '',
      deviceSerialNumber: t.deviceSerialNumber || '',
      deviceModel:        t.deviceModel || 'P17',
      overrideTpn:        t.overrideTpn || '',
      notes:              t.notes || '',
    });
  };

  const cancelTerminalEdit = () => {
    setTermEditing(null);
    setTermForm({ ...BLANK_TERMINAL, merchantId: termFor?.id || '' });
  };

  const saveTerminal = async () => {
    try {
      if (termEditing) {
        await updatePaymentTerminal(termEditing, termForm);
        toast.success('Terminal updated');
      } else {
        await createPaymentTerminal(termForm);
        toast.success('Terminal added');
      }
      cancelTerminalEdit();
      refreshTerminals();
    } catch (err) {
      toast.error(err.response?.data?.error || err.message);
    }
  };

  const removeTerminal = async (t) => {
    if (!window.confirm(`Remove terminal "${t.nickname || t.deviceSerialNumber || t.id}"?`)) return;
    try {
      await deletePaymentTerminal(t.id);
      toast.success('Terminal removed');
      refreshTerminals();
    } catch (err) {
      toast.error(err.response?.data?.error || err.message);
    }
  };

  const pingTerm = async (t) => {
    try {
      const res = await pingPaymentTerminal(t.id);
      if (res.success) toast.success('Terminal reachable');
      else toast.warn(res.message || 'Terminal unreachable');
      refreshTerminals();
    } catch (err) {
      toast.error(err.response?.data?.error || err.message);
    }
  };

  // ── Filter ──
  const filtered = merchants.filter(m => {
    if (filterOrg && m.orgId !== filterOrg) return false;
    if (filterStatus && m.status !== filterStatus) return false;
    if (search) {
      const s = search.toLowerCase();
      if (!(m.storeName || '').toLowerCase().includes(s) &&
          !(m.orgName || '').toLowerCase().includes(s) &&
          !(m.spinTpn || '').toLowerCase().includes(s)) return false;
    }
    return true;
  });

  const storesForOrg = form.orgId ? stores.filter(s => s.orgId === form.orgId) : [];

  return (
    <div className="am-page">
      <div className="am-header">
        <div className="am-header-left">
          <div className="am-header-icon"><CreditCard size={22} /></div>
          <div>
            <h1>Payment Merchants</h1>
            <p>Per-store Dejavoo credentials — superadmin only</p>
          </div>
        </div>
        <div className="am-toolbar">
          <button className="am-btn" onClick={load}><RefreshCw size={14} /> Refresh</button>
          <button className="am-btn am-btn-primary" onClick={openCreate}>
            <Plus size={14} /> New Merchant
          </button>
        </div>
      </div>

      <div className="am-warn">
        <Shield size={16} />
        <div>
          All credentials are encrypted at rest (AES-256-GCM) and never leave the admin panel.
          New merchants start in <strong>Pending</strong> — they only process real card payments
          once a successful test passes and you Activate them.
        </div>
      </div>

      <div className="am-filters">
        <input
          className="am-filter-input"
          placeholder="Search store, org, TPN…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="am-filter-select" value={filterOrg} onChange={e => setFilterOrg(e.target.value)}>
          <option value="">All organizations</option>
          {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <select className="am-filter-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="pending">Pending</option>
          <option value="disabled">Disabled</option>
        </select>
      </div>

      <div className="am-table-wrap">
        {loading ? (
          <div className="am-loading">Loading merchants…</div>
        ) : filtered.length === 0 ? (
          <div className="am-empty">
            No payment merchants configured. Click "New Merchant" to add one for a store.
          </div>
        ) : (
          <table className="am-table">
            <thead>
              <tr>
                <th>Store</th>
                <th>Organization</th>
                <th>Env</th>
                <th>TPN</th>
                <th>Status</th>
                <th>Last Test</th>
                <th className="am-th-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(m => {
                const activateOk = canActivate(m);
                return (
                  <tr key={m.id}>
                    <td><strong>{m.storeName || '—'}</strong></td>
                    <td>{m.orgName || '—'}</td>
                    <td><span className={`am-pill am-pill-${m.environment}`}>{m.environment}</span></td>
                    <td className="am-td-tpn">{m.spinTpn || <span className="am-muted">—</span>}</td>
                    <td><StatusPill status={m.status} /></td>
                    <td>
                      {m.lastTestedAt ? (
                        <div className="am-test-cell">
                          <span className={`am-pill ${m.lastTestResult === 'ok' ? 'am-pill-ok' : 'am-pill-fail'}`}>
                            {m.lastTestResult === 'ok' ? 'OK' : 'Failed'}
                          </span>
                          <span className="am-test-time">{fmtTime(m.lastTestedAt)}</span>
                        </div>
                      ) : (
                        <span className="am-pill am-pill-untested">Untested</span>
                      )}
                    </td>
                    <td>
                      <div className="am-row-actions">
                        <button className="am-icon-btn" title="Test connection" onClick={() => handleTest(m)}><Play size={14} /></button>

                        {m.status !== 'active' && (
                          <button
                            className={`am-icon-btn am-icon-btn-ok ${!activateOk ? 'am-icon-btn-disabled' : ''}`}
                            title={activateOk ? 'Activate merchant' : 'Pass a test within 24h to activate'}
                            onClick={() => handleActivate(m)}
                            disabled={!activateOk}
                          >
                            <CheckCircle size={14} />
                          </button>
                        )}

                        {m.status === 'active' && (
                          <button
                            className="am-icon-btn am-icon-btn-warn"
                            title="Disable (kill-switch)"
                            onClick={() => handleDisable(m)}
                          >
                            <Lock size={14} />
                          </button>
                        )}

                        <button className="am-icon-btn" title="Terminals" onClick={() => openTerminals(m)}><Cpu size={14} /></button>
                        <button className="am-icon-btn" title="Audit log" onClick={() => openAudit(m)}><History size={14} /></button>
                        <button className="am-icon-btn" title="Edit" onClick={() => openEdit(m)}><Edit3 size={14} /></button>
                        <button className="am-icon-btn am-icon-btn-danger" title="Delete" onClick={() => handleDelete(m)}><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ────────────────────────────────────────────── Create / Edit Modal */}
      {modalOpen && (
        <div className="am-modal-backdrop" onClick={() => setModalOpen(false)}>
          <div className="am-modal" onClick={e => e.stopPropagation()}>
            <div className="am-modal-header">
              <h3>{editingId ? 'Edit Payment Merchant' : 'New Payment Merchant'}</h3>
              <button className="am-icon-btn" onClick={() => setModalOpen(false)}><X size={16} /></button>
            </div>

            <div className="am-modal-body">
              {editingId && (
                <div className="am-warn am-warn-amber">
                  <AlertTriangle size={16} />
                  <div>
                    Changing TPN, auth keys, environment, or base URL will reset this merchant
                    to <strong>Pending</strong> and require a fresh test before re-activation.
                  </div>
                </div>
              )}

              {/* Scope */}
              <div className="am-section">
                <div className="am-section-title">Scope</div>
                <div className="am-grid">
                  <div className="am-field">
                    <label>Organization *</label>
                    <select
                      value={form.orgId}
                      disabled={!!editingId}
                      onChange={e => setForm({ ...form, orgId: e.target.value, storeId: '' })}
                    >
                      <option value="">Select organization…</option>
                      {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                  </div>
                  <div className="am-field">
                    <label>Store *</label>
                    <select
                      value={form.storeId}
                      disabled={!!editingId}
                      onChange={e => setForm({ ...form, storeId: e.target.value })}
                    >
                      <option value="">Select store…</option>
                      {storesForOrg.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                  <div className="am-field">
                    <label>Environment</label>
                    <select value={form.environment} onChange={e => setForm({ ...form, environment: e.target.value })}>
                      <option value="uat">UAT / Sandbox</option>
                      <option value="prod">Production</option>
                    </select>
                  </div>
                  <div className="am-field">
                    <label>Status</label>
                    <input value={(form.status || 'pending').toUpperCase()} disabled readOnly />
                    <span className="am-field-hint">Status is managed via Activate / Disable actions.</span>
                  </div>
                </div>
              </div>

              {/* SPIn */}
              <div className="am-section">
                <div className="am-section-title">SPIn — In-Person Terminal</div>
                <div className="am-grid">
                  <div className="am-field">
                    <label>TPN (Terminal Profile Number)</label>
                    <input
                      value={form.spinTpn}
                      onChange={e => setForm({ ...form, spinTpn: e.target.value })}
                      placeholder="e.g. 220926502033"
                    />
                  </div>
                  <div className="am-field">
                    <label>SPIn Auth Key</label>
                    <input
                      type="password"
                      value={form.spinAuthKey}
                      onChange={e => setForm({ ...form, spinAuthKey: e.target.value })}
                      placeholder={form.spinAuthKeySet ? '•••• (leave blank to keep)' : 'Enter 10-char auth key'}
                      autoComplete="new-password"
                    />
                    {form.spinAuthKeySet && (
                      <span className="am-field-hint">Already saved. Leave blank to keep current value.</span>
                    )}
                  </div>
                  <div className="am-field am-grid-full">
                    <label>SPIn Base URL (optional override)</label>
                    <input
                      value={form.spinBaseUrl}
                      onChange={e => setForm({ ...form, spinBaseUrl: e.target.value })}
                      placeholder="Leave blank to use env default"
                    />
                  </div>
                </div>
              </div>

              {/* HPP */}
              <div className="am-section">
                <div className="am-section-title">HPP — Online Checkout (optional)</div>
                <div className="am-grid">
                  <div className="am-field">
                    <label>HPP Merchant ID</label>
                    <input
                      value={form.hppMerchantId}
                      onChange={e => setForm({ ...form, hppMerchantId: e.target.value })}
                    />
                  </div>
                  <div className="am-field">
                    <label>HPP Auth Key</label>
                    <input
                      type="password"
                      value={form.hppAuthKey}
                      onChange={e => setForm({ ...form, hppAuthKey: e.target.value })}
                      placeholder={form.hppAuthKeySet ? '•••• (leave blank to keep)' : 'Enter key'}
                      autoComplete="new-password"
                    />
                  </div>
                </div>
              </div>

              {/* Features */}
              <div className="am-section">
                <div className="am-section-title">Features</div>
                <div className="am-checkbox-row">
                  <input
                    type="checkbox" id="ebtEnabled"
                    checked={form.ebtEnabled}
                    onChange={e => setForm({ ...form, ebtEnabled: e.target.checked })}
                  />
                  <label htmlFor="ebtEnabled">Enable EBT (SNAP / Cash Benefit)</label>
                </div>
                <div className="am-checkbox-row">
                  <input
                    type="checkbox" id="debitEnabled"
                    checked={form.debitEnabled}
                    onChange={e => setForm({ ...form, debitEnabled: e.target.checked })}
                  />
                  <label htmlFor="debitEnabled">Enable Debit (PIN entry on terminal)</label>
                </div>
                <div className="am-checkbox-row">
                  <input
                    type="checkbox" id="tokenizeEnabled"
                    checked={form.tokenizeEnabled}
                    onChange={e => setForm({ ...form, tokenizeEnabled: e.target.checked })}
                  />
                  <label htmlFor="tokenizeEnabled">Enable card tokenization (card-on-file)</label>
                </div>
              </div>

              {/* Notes */}
              <div className="am-section">
                <div className="am-section-title">Admin Notes</div>
                <div className="am-field am-grid-full">
                  <textarea
                    rows={3}
                    value={form.notes}
                    onChange={e => setForm({ ...form, notes: e.target.value })}
                    placeholder="Internal notes — not visible to merchant"
                  />
                </div>
              </div>
            </div>

            <div className="am-modal-footer">
              <button className="am-btn" onClick={() => setModalOpen(false)} disabled={saving}>Cancel</button>
              <button className="am-btn am-btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Create Merchant'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ────────────────────────────────────────────── Audit Drawer */}
      {auditFor && (
        <div className="am-drawer-backdrop" onClick={() => setAuditFor(null)}>
          <div className="am-drawer" onClick={e => e.stopPropagation()}>
            <div className="am-drawer-header">
              <div>
                <h3><History size={16} /> Audit Log</h3>
                <p>{auditFor.storeName} · {auditFor.orgName}</p>
              </div>
              <button className="am-icon-btn" onClick={() => setAuditFor(null)}><X size={16} /></button>
            </div>
            <div className="am-drawer-body">
              {auditLoading ? (
                <div className="am-loading">Loading audit log…</div>
              ) : auditEntries.length === 0 ? (
                <div className="am-empty">No audit entries yet.</div>
              ) : (
                <ul className="am-audit-list">
                  {auditEntries.map(e => (
                    <li key={e.id} className="am-audit-item">
                      <div className="am-audit-head">
                        <span className={`am-pill am-audit-${e.action}`}>{e.action}</span>
                        <span className="am-audit-by">{e.changedByName || 'system'}</span>
                        <span className="am-audit-time">{fmtTime(e.createdAt)}</span>
                      </div>
                      {e.note && <div className="am-audit-note">{e.note}</div>}
                      {e.changes && Object.keys(e.changes).length > 0 && (
                        <pre className="am-audit-diff">{JSON.stringify(e.changes, null, 2)}</pre>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ────────────────────────────────────────────── Terminals Drawer */}
      {termFor && (
        <div className="am-drawer-backdrop" onClick={() => setTermFor(null)}>
          <div className="am-drawer am-drawer-wide" onClick={e => e.stopPropagation()}>
            <div className="am-drawer-header">
              <div>
                <h3><Cpu size={16} /> Terminals</h3>
                <p>{termFor.storeName} · default TPN {termFor.spinTpn || '—'}</p>
              </div>
              <button className="am-icon-btn" onClick={() => setTermFor(null)}><X size={16} /></button>
            </div>

            <div className="am-drawer-body">
              {/* Terminal list */}
              {termLoading ? (
                <div className="am-loading">Loading terminals…</div>
              ) : terminals.length === 0 ? (
                <div className="am-empty">No terminals added yet.</div>
              ) : (
                <table className="am-term-table">
                  <thead>
                    <tr>
                      <th>Nickname</th>
                      <th>Station</th>
                      <th>Model / Serial</th>
                      <th>Effective TPN</th>
                      <th>Status</th>
                      <th className="am-th-actions">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {terminals.map(t => (
                      <tr key={t.id}>
                        <td><strong>{t.nickname || '—'}</strong></td>
                        <td>{t.stationName || <span className="am-muted">unassigned</span>}</td>
                        <td>
                          <div>{t.deviceModel || '—'}</div>
                          <div className="am-muted am-sm">{t.deviceSerialNumber || '—'}</div>
                        </td>
                        <td>
                          {t.effectiveTpn || '—'}
                          {t.overrideTpn && <div className="am-muted am-sm">override</div>}
                        </td>
                        <td>
                          <span className={`am-pill am-pill-${t.status === 'active' ? 'active' : 'disabled'}`}>
                            {(t.status || 'active').toUpperCase()}
                          </span>
                          {t.lastPingedAt && (
                            <div className="am-muted am-sm">pinged {fmtTime(t.lastPingedAt)}</div>
                          )}
                        </td>
                        <td>
                          <div className="am-row-actions">
                            <button className="am-icon-btn" title="Ping" onClick={() => pingTerm(t)}><Wifi size={14} /></button>
                            <button className="am-icon-btn" title="Edit" onClick={() => editTerminal(t)}><Edit3 size={14} /></button>
                            <button className="am-icon-btn am-icon-btn-danger" title="Remove" onClick={() => removeTerminal(t)}><Trash2 size={14} /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {/* Add / Edit form */}
              <div className="am-term-form">
                <div className="am-section-title">
                  {termEditing ? 'Edit Terminal' : 'Add Terminal'}
                </div>
                <div className="am-grid">
                  <div className="am-field">
                    <label>Nickname</label>
                    <input
                      value={termForm.nickname}
                      onChange={e => setTermForm({ ...termForm, nickname: e.target.value })}
                      placeholder="e.g. Front Counter"
                    />
                  </div>
                  <div className="am-field">
                    <label>Station ID</label>
                    <input
                      value={termForm.stationId}
                      onChange={e => setTermForm({ ...termForm, stationId: e.target.value })}
                      placeholder="station ID (optional)"
                    />
                    <span className="am-field-hint">Bind this device to a specific cashier station.</span>
                  </div>
                  <div className="am-field">
                    <label>Device Model</label>
                    <select
                      value={termForm.deviceModel}
                      onChange={e => setTermForm({ ...termForm, deviceModel: e.target.value })}
                    >
                      <option value="P17">P17</option>
                      <option value="Z8">Z8</option>
                      <option value="Z11">Z11</option>
                      <option value="QD4">QD4</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div className="am-field">
                    <label>Serial Number</label>
                    <input
                      value={termForm.deviceSerialNumber}
                      onChange={e => setTermForm({ ...termForm, deviceSerialNumber: e.target.value })}
                      placeholder="physical device serial"
                    />
                  </div>
                  <div className="am-field am-grid-full">
                    <label>Override TPN (optional)</label>
                    <input
                      value={termForm.overrideTpn}
                      onChange={e => setTermForm({ ...termForm, overrideTpn: e.target.value })}
                      placeholder={`Leave blank to use merchant default (${termFor.spinTpn || 'none'})`}
                    />
                    <span className="am-field-hint">
                      Use when the processor assigned a unique TPN per lane/device.
                    </span>
                  </div>
                  <div className="am-field am-grid-full">
                    <label>Notes</label>
                    <textarea
                      rows={2}
                      value={termForm.notes}
                      onChange={e => setTermForm({ ...termForm, notes: e.target.value })}
                      placeholder="Install location, firmware, etc."
                    />
                  </div>
                </div>
                <div className="am-term-form-actions">
                  {termEditing && (
                    <button className="am-btn" onClick={cancelTerminalEdit}>Cancel</button>
                  )}
                  <button className="am-btn am-btn-primary" onClick={saveTerminal}>
                    {termEditing ? 'Save Terminal' : 'Add Terminal'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
