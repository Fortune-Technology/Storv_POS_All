/**
 * AdminMerchants.tsx
 *
 * Superadmin page for managing Dejavoo payment merchant credentials
 * per store. Each store has exactly one merchant row holding SPIn
 * (in-person), HPP (online), and Transact (card-on-file) credentials.
 *
 * Store owners + managers cannot access this page. Credentials never
 * leave the admin panel — the portal only gets a read-only status chip.
 */

import { useEffect, useState, useCallback } from 'react';
import {
  CreditCard, Plus, Edit3, Trash2, Play, X, Shield, RefreshCw,
  CheckCircle, History, Cpu, Wifi, Lock, AlertTriangle,
  Globe, Copy, Check, KeyRound,
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
  listStationsForStore,
  getHppWebhookUrl,
  regenerateHppWebhookSecret,
  getAdminOrganizations,
  getAdminStores,
} from '../services/api';
import './AdminMerchants.css';

type MerchantStatus = 'active' | 'pending' | 'disabled';
type Environment = 'uat' | 'prod';

interface MerchantForm {
  orgId: string;
  storeId: string;
  provider: string;
  environment: Environment;
  spinTpn: string;
  spinAuthKey: string;
  spinBaseUrl: string;
  spinRegisterId: string;
  hppMerchantId: string;
  hppAuthKey: string;
  hppBaseUrl: string;
  hppEnabled: boolean;
  transactApiKey: string;
  transactBaseUrl: string;
  ebtEnabled: boolean;
  debitEnabled: boolean;
  tokenizeEnabled: boolean;
  status: MerchantStatus;
  notes: string;
  // Preview fields set when editing (read-only metadata)
  spinAuthKeySet?: boolean;
  spinAuthKeyPreview?: string;
  hppAuthKeySet?: boolean;
  hppAuthKeyPreview?: string;
  hppWebhookSecretSet?: boolean;
  transactApiKeySet?: boolean;
  transactApiKeyPreview?: string;
}

interface Merchant {
  id: string | number;
  orgId: string;
  storeId: string;
  orgName?: string;
  storeName?: string;
  provider: string;
  environment: Environment;
  spinTpn?: string;
  spinBaseUrl?: string;
  spinRegisterId?: string;
  hppMerchantId?: string;
  hppBaseUrl?: string;
  hppEnabled?: boolean;
  transactBaseUrl?: string;
  ebtEnabled?: boolean;
  debitEnabled?: boolean;
  tokenizeEnabled?: boolean;
  status?: MerchantStatus;
  notes?: string;
  lastTestedAt?: string;
  lastTestResult?: 'ok' | 'fail';
  spinAuthKeySet?: boolean;
  spinAuthKeyPreview?: string;
  hppAuthKeySet?: boolean;
  hppAuthKeyPreview?: string;
  hppWebhookSecretSet?: boolean;
  transactApiKeySet?: boolean;
  transactApiKeyPreview?: string;
}

interface Organization {
  id: string | number;
  name: string;
}

interface AdminStore {
  id: string | number;
  name: string;
  orgId?: string;
}

interface AuditEntry {
  id: string | number;
  action: string;
  changedByName?: string;
  createdAt?: string;
  note?: string;
  changes?: Record<string, unknown>;
}

interface Terminal {
  id: string | number;
  merchantId: string;
  stationId?: string;
  stationName?: string;
  nickname?: string;
  deviceSerialNumber?: string;
  deviceModel?: string;
  overrideTpn?: string;
  effectiveTpn?: string;
  notes?: string;
  status?: string;
  lastPingedAt?: string;
}

interface TerminalForm {
  merchantId: string;
  stationId: string;
  nickname: string;
  deviceSerialNumber: string;
  deviceModel: string;
  overrideTpn: string;
  notes: string;
}

interface StationOption {
  id: string;
  name: string;
  lastSeenAt?: string | null;
  paired: boolean;
  pairedTerminalId: string | null;
  pairedTerminalNickname: string | null;
  pairedTerminalModel: string | null;
}

const BLANK_FORM: MerchantForm = {
  orgId: '',
  storeId: '',
  provider: 'dejavoo',
  environment: 'uat',
  spinTpn: '',
  spinAuthKey: '',
  spinBaseUrl: '',
  spinRegisterId: '',
  hppMerchantId: '',
  hppAuthKey: '',
  hppBaseUrl: '',
  hppEnabled: false,
  transactApiKey: '',
  transactBaseUrl: '',
  ebtEnabled: false,
  debitEnabled: true,
  tokenizeEnabled: false,
  status: 'pending',
  notes: '',
};

const BLANK_TERMINAL: TerminalForm = {
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

function fmtTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function hoursSince(iso?: string | null): number {
  if (!iso) return Infinity;
  return (Date.now() - new Date(iso).getTime()) / 3600000;
}

// Can this merchant be activated right now?
// Rule: must have passed a test within the last 24h.
function canActivate(m: Merchant): boolean {
  if (m.status === 'active') return false;
  if (m.lastTestResult !== 'ok') return false;
  return hoursSince(m.lastTestedAt) <= 24;
}

interface StatusPillProps { status?: string }

function StatusPill({ status }: StatusPillProps) {
  const cls: Record<string, string> = {
    active:   'am-pill am-pill-active',
    pending:  'am-pill am-pill-pending',
    disabled: 'am-pill am-pill-disabled',
  };
  const selected = cls[status || ''] || 'am-pill am-pill-untested';
  const label = (status || 'unknown').toUpperCase();
  return <span className={selected}>{label}</span>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export default function AdminMerchants() {
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [orgs, setOrgs]       = useState<Organization[]>([]);
  const [stores, setStores]   = useState<AdminStore[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterOrg, setFilterOrg] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [search, setSearch]   = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | number | null>(null);
  const [form, setForm]       = useState<MerchantForm>(BLANK_FORM);
  const [saving, setSaving]   = useState(false);

  // Drawers
  const [auditFor, setAuditFor]       = useState<Merchant | null>(null);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  const [termFor, setTermFor]         = useState<Merchant | null>(null);
  const [terminals, setTerminals]     = useState<Terminal[]>([]);
  const [termLoading, setTermLoading] = useState(false);
  const [termEditing, setTermEditing] = useState<string | number | null>(null);
  const [termForm, setTermForm]       = useState<TerminalForm>(BLANK_TERMINAL);
  const [stationOptions, setStationOptions] = useState<StationOption[]>([]);

  // ── HPP webhook state ──
  // savedWebhookUrl: the URL we already have on record (fetched on Edit open)
  // freshWebhook: the URL+secret returned ONCE by regenerate; shown in a banner
  //                until the modal is closed (the secret is never recoverable
  //                from the server after this — only the URL stays).
  const [savedWebhookUrl, setSavedWebhookUrl] = useState<string | null>(null);
  const [freshWebhook, setFreshWebhook] = useState<{ url: string; secret: string } | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [copied, setCopied] = useState<'url' | 'fresh' | null>(null);

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
    } catch (err: any) {
      toast.error('Failed to load merchants: ' + (err?.response?.data?.error || err?.message));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Create / Edit ──
  const openCreate = () => {
    setEditingId(null);
    setForm(BLANK_FORM);
    setSavedWebhookUrl(null);
    setFreshWebhook(null);
    setModalOpen(true);
  };

  const openEdit = (merchant: Merchant) => {
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
      spinRegisterId:  merchant.spinRegisterId || '',
      hppMerchantId:   merchant.hppMerchantId || '',
      hppAuthKey:      '',
      hppBaseUrl:      merchant.hppBaseUrl    || '',
      hppEnabled:      !!merchant.hppEnabled,
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
      hppWebhookSecretSet: merchant.hppWebhookSecretSet,
      transactApiKeySet:    merchant.transactApiKeySet,
      transactApiKeyPreview: merchant.transactApiKeyPreview,
    });
    setFreshWebhook(null);
    setSavedWebhookUrl(null);
    setModalOpen(true);
    // Load the existing webhook URL (best effort; failures don't block editing)
    if (merchant.hppWebhookSecretSet) {
      getHppWebhookUrl(merchant.id)
        .then(res => { if (res.configured && res.webhookUrl) setSavedWebhookUrl(res.webhookUrl); })
        .catch(() => { /* silent */ });
    }
  };

  // ── Regenerate the per-store HPP webhook secret ──
  // Returns plaintext URL + secret ONCE — admin must copy them now and
  // paste into iPOSpays. After this modal closes, only the encrypted
  // ciphertext lives in the DB; the plaintext is gone for good.
  const handleRegenerateWebhook = async () => {
    if (!editingId) {
      toast.warn('Save the merchant first, then regenerate the webhook secret');
      return;
    }
    const isFirstTime = !form.hppWebhookSecretSet;
    const verb = isFirstTime ? 'generate' : 'regenerate';
    if (!isFirstTime) {
      const ok = window.confirm(
        'Regenerate the HPP webhook secret?\n\n' +
        'The OLD URL will stop working immediately. iPOSpays will fail to deliver ' +
        'callbacks until you paste the new URL into the merchant settings there.\n\n' +
        'Only do this if you suspect the secret was leaked or want to rotate it.'
      );
      if (!ok) return;
    }
    setRegenerating(true);
    try {
      const res = await regenerateHppWebhookSecret(editingId);
      setFreshWebhook({ url: res.webhookUrl, secret: res.webhookSecret });
      setSavedWebhookUrl(res.webhookUrl);
      setForm(prev => ({ ...prev, hppWebhookSecretSet: true }));
      toast.success(`Webhook ${verb}d — copy the URL now and paste into iPOSpays`);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || err?.message);
    } finally {
      setRegenerating(false);
    }
  };

  const copyToClipboard = async (text: string, which: 'url' | 'fresh') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied(c => (c === which ? null : c)), 1500);
    } catch {
      toast.warn('Copy failed — please select and copy manually');
    }
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
    } catch (err: any) {
      toast.error(err?.response?.data?.error || err?.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (merchant: Merchant) => {
    if (!window.confirm(`Delete payment merchant for "${merchant.storeName}"?\n\nThis cannot be undone and will also remove all linked terminals.`)) return;
    try {
      await deletePaymentMerchant(merchant.id);
      toast.success('Merchant deleted');
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || err?.message);
    }
  };

  const handleTest = async (merchant: Merchant) => {
    try {
      const res = await testPaymentMerchant(merchant.id);
      // The backend probe only validates credentials + cloud reachability — it
      // does NOT push to the physical terminal. So "test passed" means you can
      // safely Activate, but the first real card sale is what proves the P17
      // itself is plugged in + online.
      if (res.success) toast.success('Credentials valid — cloud reachable. Run a test card sale to verify the P17 device is online.');
      else toast.warn(res.result || 'Test failed');
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || err?.message);
    }
  };

  const handleActivate = async (merchant: Merchant) => {
    if (!canActivate(merchant)) {
      toast.warn('Test the terminal successfully within the last 24 hours before activating.');
      return;
    }
    if (!window.confirm(`Activate payment processing for "${merchant.storeName}"?\n\nThe POS will immediately start accepting real card payments.`)) return;
    try {
      await activatePaymentMerchant(merchant.id);
      toast.success('Merchant activated');
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || err?.message);
    }
  };

  const handleDisable = async (merchant: Merchant) => {
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
    } catch (err: any) {
      toast.error(err?.response?.data?.error || err?.message);
    }
  };

  // ── Audit drawer ──
  const openAudit = async (merchant: Merchant) => {
    setAuditFor(merchant);
    setAuditEntries([]);
    setAuditLoading(true);
    try {
      const res = await getPaymentMerchantAudit(merchant.id);
      setAuditEntries(res.entries || res.audit || []);
    } catch (err: any) {
      toast.error('Failed to load audit log: ' + (err?.response?.data?.error || err?.message));
    } finally {
      setAuditLoading(false);
    }
  };

  // ── Terminals drawer ──
  // Loads terminals AND the station picker options. Stations are fetched
  // separately because the picker needs to know which stations are already
  // paired to disable those entries.
  const loadStations = async (storeId: string) => {
    try {
      const res = await listStationsForStore(storeId);
      setStationOptions(res.stations || []);
    } catch (err: any) {
      // Non-fatal — terminal form still works with manual entry as a fallback
      // if the dropdown can't load. We just won't show a curated list.
      console.warn('[loadStations]', err?.response?.data?.error || err?.message);
      setStationOptions([]);
    }
  };

  const openTerminals = async (merchant: Merchant) => {
    setTermFor(merchant);
    setTerminals([]);
    setStationOptions([]);
    setTermEditing(null);
    setTermForm({ ...BLANK_TERMINAL, merchantId: String(merchant.id) });
    setTermLoading(true);
    try {
      // Load terminals + stations in parallel — both are scoped to this merchant's store
      const [termRes] = await Promise.all([
        listPaymentTerminals({ merchantId: merchant.id }),
        loadStations(merchant.storeId),
      ]);
      setTerminals(termRes.terminals || []);
    } catch (err: any) {
      toast.error('Failed to load terminals: ' + (err?.response?.data?.error || err?.message));
    } finally {
      setTermLoading(false);
    }
  };

  const refreshTerminals = async () => {
    if (!termFor) return;
    try {
      const [res] = await Promise.all([
        listPaymentTerminals({ merchantId: termFor.id }),
        // Re-fetch stations too so paired-status reflects the latest pairing
        loadStations(termFor.storeId),
      ]);
      setTerminals(res.terminals || []);
    } catch (err: any) {
      toast.error('Failed to refresh: ' + (err?.response?.data?.error || err?.message));
    }
  };

  const editTerminal = (t: Terminal) => {
    setTermEditing(t.id);
    setTermForm({
      merchantId:         String(t.merchantId),
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
    setTermForm({ ...BLANK_TERMINAL, merchantId: termFor ? String(termFor.id) : '' });
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
    } catch (err: any) {
      toast.error(err?.response?.data?.error || err?.message);
    }
  };

  const removeTerminal = async (t: Terminal) => {
    if (!window.confirm(`Remove terminal "${t.nickname || t.deviceSerialNumber || t.id}"?`)) return;
    try {
      await deletePaymentTerminal(t.id);
      toast.success('Terminal removed');
      refreshTerminals();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || err?.message);
    }
  };

  const pingTerm = async (t: Terminal) => {
    try {
      const res = await pingPaymentTerminal(t.id);
      if (res.success) toast.success('Terminal reachable');
      else toast.warn(res.message || 'Terminal unreachable');
      refreshTerminals();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || err?.message);
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
                    <select value={form.environment} onChange={e => setForm({ ...form, environment: e.target.value as Environment })}>
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
                  <div className="am-field">
                    <label>Register Id *</label>
                    <input
                      value={form.spinRegisterId}
                      onChange={e => setForm({ ...form, spinRegisterId: e.target.value })}
                      placeholder="e.g. 837602"
                    />
                    <span className="am-field-hint">
                      iPOSpays portal: TPN → Edit Parameter → Integration → Register Id.
                      Required by SPIn v2 — Dejavoo returns 400 without it.
                    </span>
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
                <div className="am-section-title">HPP — Online Checkout (Storefront)</div>

                <div className="am-checkbox-row">
                  <input
                    type="checkbox" id="hppEnabled"
                    checked={form.hppEnabled}
                    onChange={e => setForm({ ...form, hppEnabled: e.target.checked })}
                  />
                  <label htmlFor="hppEnabled">
                    <strong>Enable HPP for online checkout</strong>
                    <span className="am-field-hint" style={{ marginLeft: 6 }}>
                      Storefront orders will redirect to Dejavoo's hosted page.
                    </span>
                  </label>
                </div>

                <div className="am-grid">
                  <div className="am-field">
                    <label>HPP Merchant ID</label>
                    <input
                      value={form.hppMerchantId}
                      onChange={e => setForm({ ...form, hppMerchantId: e.target.value })}
                      placeholder="From iPOSpays HPP onboarding"
                    />
                  </div>
                  <div className="am-field">
                    <label>HPP Auth Key (or JWT token)</label>
                    <input
                      type="password"
                      value={form.hppAuthKey}
                      onChange={e => setForm({ ...form, hppAuthKey: e.target.value })}
                      placeholder={form.hppAuthKeySet ? '•••• (leave blank to keep)' : 'Enter key'}
                      autoComplete="new-password"
                    />
                    {form.hppAuthKeySet && (
                      <span className="am-field-hint">Already saved. Leave blank to keep.</span>
                    )}
                  </div>
                  <div className="am-field am-grid-full">
                    <label>HPP Base URL (optional override)</label>
                    <input
                      value={form.hppBaseUrl}
                      onChange={e => setForm({ ...form, hppBaseUrl: e.target.value })}
                      placeholder="Leave blank to use env default (DEJAVOO_HPP_BASE_UAT/PROD)"
                    />
                  </div>
                </div>

                {/* ── Webhook URL section ──
                    Visible only when editing an existing merchant. The URL embeds an
                    opaque per-store secret; admin pastes it into iPOSpays so payment
                    callbacks land scoped to this store. */}
                {editingId && (
                  <div className="am-webhook-block">
                    <div className="am-webhook-head">
                      <Globe size={14} />
                      <strong>Webhook URL for iPOSpays</strong>
                    </div>

                    {freshWebhook ? (
                      <div className="am-webhook-fresh">
                        <div className="am-webhook-fresh-head">
                          <CheckCircle size={14} />
                          <strong>New webhook URL — copy NOW and paste into iPOSpays</strong>
                        </div>
                        <p className="am-webhook-warn">
                          The plaintext secret is shown ONCE and cannot be recovered after
                          you close this modal. The old URL is now invalid.
                        </p>
                        <div className="am-webhook-row">
                          <code>{freshWebhook.url}</code>
                          <button
                            type="button"
                            className="am-btn am-btn-primary"
                            onClick={() => copyToClipboard(freshWebhook.url, 'fresh')}
                          >
                            {copied === 'fresh' ? <Check size={14} /> : <Copy size={14} />}
                            {copied === 'fresh' ? 'Copied' : 'Copy URL'}
                          </button>
                        </div>
                      </div>
                    ) : savedWebhookUrl ? (
                      <div className="am-webhook-saved">
                        <div className="am-webhook-row">
                          <code>{savedWebhookUrl}</code>
                          <button
                            type="button"
                            className="am-btn"
                            onClick={() => copyToClipboard(savedWebhookUrl, 'url')}
                          >
                            {copied === 'url' ? <Check size={14} /> : <Copy size={14} />}
                            {copied === 'url' ? 'Copied' : 'Copy'}
                          </button>
                          <button
                            type="button"
                            className="am-btn am-btn-warn"
                            onClick={handleRegenerateWebhook}
                            disabled={regenerating}
                          >
                            <KeyRound size={14} />
                            {regenerating ? 'Working…' : 'Regenerate'}
                          </button>
                        </div>
                        <span className="am-field-hint">
                          Paste this URL into the iPOSpays HPP merchant's "Webhook" /
                          "Notify URL" field. Regenerate if you suspect the secret was leaked.
                        </span>
                      </div>
                    ) : (
                      <div className="am-webhook-empty">
                        <p>No webhook secret configured for this merchant yet.</p>
                        <button
                          type="button"
                          className="am-btn am-btn-primary"
                          onClick={handleRegenerateWebhook}
                          disabled={regenerating}
                        >
                          <KeyRound size={14} />
                          {regenerating ? 'Generating…' : 'Generate Webhook Secret'}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {!editingId && (
                  <div className="am-field-hint" style={{ marginTop: 8 }}>
                    Save the merchant first, then re-open it to generate the webhook URL.
                  </div>
                )}
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
                    <label>Station</label>
                    {/*
                      Dropdown of stations belonging to this merchant's store.
                      Already-paired stations are disabled (a station can only own
                      one terminal). The currently-edited terminal's station stays
                      selectable so the existing binding doesn't break.
                    */}
                    <select
                      value={termForm.stationId}
                      onChange={e => setTermForm({ ...termForm, stationId: e.target.value })}
                    >
                      <option value="">— Unassigned (set later) —</option>
                      {stationOptions.map(s => {
                        // Allow selecting a paired station only if it's the one we're
                        // currently editing (so save doesn't change anything).
                        const editingThisStation = !!termEditing
                          && terminals.find(t => t.id === termEditing)?.stationId === s.id;
                        const disabled = s.paired && !editingThisStation;
                        // Include full station ID in the option text so an
                        // implementation engineer can verify the right station
                        // is being bound (matches DB / cashier-app station ID).
                        return (
                          <option key={s.id} value={s.id} disabled={disabled}>
                            {s.name} · {s.id}{disabled ? ` — paired with ${s.pairedTerminalNickname || s.pairedTerminalModel || 'terminal'}` : ''}
                          </option>
                        );
                      })}
                    </select>
                    {/*
                      Show the FULL station ID of the currently-selected option
                      below the dropdown — copy-friendly, monospace-styled, and
                      always visible (the option text in a closed select is
                      truncated by the browser, so this is the reliable place
                      to verify which station ID is going to be saved).
                    */}
                    {termForm.stationId && (
                      <span
                        className="am-field-hint"
                        style={{
                          fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
                          color: '#475569',
                          marginTop: 4,
                          display: 'block',
                          wordBreak: 'break-all',
                        }}
                      >
                        Selected station ID: <strong>{termForm.stationId}</strong>
                      </span>
                    )}
                    <span className="am-field-hint">
                      {stationOptions.length === 0
                        ? 'No stations registered for this store yet — pair one in the cashier app first.'
                        : `${stationOptions.length} station${stationOptions.length === 1 ? '' : 's'} for this store. Greyed-out entries already have a terminal paired.`}
                    </span>
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
