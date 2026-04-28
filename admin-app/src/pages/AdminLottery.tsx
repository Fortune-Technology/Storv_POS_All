/**
 * AdminLottery — superadmin management of the platform-wide lottery ticket
 * catalog and state requests.
 *
 * Ticket Catalog rows are state-scoped (e.g. "MA 498 — Billion Dollars $50"
 * only visible to MA stores). Stores see this catalog in their portal under
 * Lottery → Receive Order when pulling in a book they want to activate.
 *
 * Ticket Requests come in when a store scans or orders a book for a game
 * the catalog doesn't have yet. Admin reviews → approves (creates a catalog
 * entry) or rejects.
 */

import { useState, useEffect, useMemo, useCallback, FormEvent } from 'react';
import { toast } from 'react-toastify';
import { Plus, Edit2, Trash2, Search, Ticket, Check, X, Save, Inbox, RotateCcw, RefreshCw, ChevronDown } from 'lucide-react';
import {
  listAdminLotteryCatalog, createAdminLotteryCatalog,
  updateAdminLotteryCatalog, deleteAdminLotteryCatalog,
  listAdminLotteryRequests, reviewAdminLotteryRequest,
  listAdminLotterySupportedStates,
  syncAdminLotteryCatalog,
} from '../services/api';
// useConfirmDialog is a shared .jsx file (no TS types needed) — see hooks dir.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { useConfirm } from '../hooks/useConfirmDialog.jsx';
import './AdminLottery.css';

const CATEGORIES = ['instant', 'draw', 'daily', 'other'] as const;

type Category = typeof CATEGORIES[number];

interface SupportedState {
  code: string;
  name: string;
}

interface CatalogForm {
  name: string;
  gameNumber: string;
  ticketPrice: number;
  ticketsPerBook: number;
  state: string;
  category: Category;
  active: boolean;
}

interface CatalogRow {
  id: string | number;
  name: string;
  gameNumber?: string;
  ticketPrice: number;
  ticketsPerBook: number;
  state?: string;
  category?: string;
  active?: boolean;
}

interface LotteryRequest {
  id: string | number;
  storeName?: string;
  storeId?: string | number;
  name: string;
  gameNumber?: string;
  ticketPrice?: number;
  ticketsPerBook?: number;
  state?: string;
  status?: 'pending' | 'approved' | 'rejected';
  createdAt?: string;
  notes?: string;
}

interface ReviewDraft {
  name: string;
  gameNumber: string;
  ticketPrice: number;
  ticketsPerBook: number;
  state: string;
  category: Category;
  active: boolean;
  adminNotes: string;
}

type ModalMode = 'create' | 'edit' | null;
type ActiveFilter = 'all' | 'active' | 'inactive';

const BLANK: CatalogForm = {
  name: '',
  gameNumber: '',
  ticketPrice: 1,
  ticketsPerBook: 30,
  state: '',
  category: 'instant',
  active: true,
};

export default function AdminLottery() {
  const confirm = useConfirm();
  const [tab, setTab]                 = useState<'catalog' | 'requests'>('catalog');
  const [catalog, setCatalog]         = useState<CatalogRow[]>([]);
  const [requests, setRequests]       = useState<LotteryRequest[]>([]);
  const [supportedStates, setStates]  = useState<SupportedState[]>([]);
  const [loading, setLoading]         = useState(true);
  const [search, setSearch]           = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [priceFilter, setPriceFilter] = useState('');
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>('active');
  const [modalMode, setModalMode]     = useState<ModalMode>(null);
  const [form, setForm]               = useState<CatalogForm>(BLANK);
  const [editingId, setEditingId]     = useState<string | number | null>(null);
  const [saving, setSaving]           = useState(false);

  // Requests tab
  const [reviewing, setReviewing]     = useState<LotteryRequest | null>(null);

  // Sync tab — pull latest games from state lottery's public feed
  const [syncing, setSyncing]         = useState<string | null>(null);
  const [syncMenuOpen, setSyncMenuOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Fallback `[]` is accepted by the union return type of each list endpoint
      // and keeps the Array.isArray guards below working.
      const [cat, reqs, sts] = await Promise.all([
        listAdminLotteryCatalog().catch(() => [] as CatalogRow[]),
        listAdminLotteryRequests().catch(() => [] as LotteryRequest[]),
        listAdminLotterySupportedStates().catch(() => [] as SupportedState[]),
      ]);
      setCatalog(Array.isArray(cat) ? cat : (cat?.data || cat?.tickets || []) as CatalogRow[]);
      setRequests(Array.isArray(reqs) ? reqs : (reqs?.data || reqs?.requests || []) as LotteryRequest[]);
      setStates(Array.isArray(sts) ? sts : (sts?.states || []) as SupportedState[]);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to load lottery data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const pendingCount = useMemo(
    () => requests.filter(r => (r.status || 'pending') === 'pending').length,
    [requests]
  );

  const filteredCatalog = useMemo(() => {
    const s = search.trim().toLowerCase();
    return catalog.filter((t) => {
      if (stateFilter && t.state !== stateFilter) return false;
      if (priceFilter && Number(t.ticketPrice) !== Number(priceFilter)) return false;
      if (activeFilter === 'active'   && !t.active) return false;
      if (activeFilter === 'inactive' &&  t.active) return false;
      if (s && !(t.name || '').toLowerCase().includes(s) && !(t.gameNumber || '').toLowerCase().includes(s)) return false;
      return true;
    });
  }, [catalog, search, stateFilter, priceFilter, activeFilter]);

  const openCreate = () => { setForm(BLANK); setEditingId(null); setModalMode('create'); };
  const openEdit = (row: CatalogRow) => {
    setForm({
      name:           row.name || '',
      gameNumber:     row.gameNumber || '',
      ticketPrice:    Number(row.ticketPrice) || 1,
      ticketsPerBook: Number(row.ticketsPerBook) || 30,
      state:          row.state || '',
      category:       (row.category || 'instant') as Category,
      active:         row.active !== false,
    });
    setEditingId(row.id);
    setModalMode('edit');
  };
  const closeModal = () => { setModalMode(null); setEditingId(null); };

  const setField = (patch: Partial<CatalogForm>) => setForm((f) => ({ ...f, ...patch }));

  const submit = async (e?: FormEvent) => {
    e?.preventDefault?.();
    if (!form.name.trim()) { toast.error('Name is required'); return; }
    if (!form.state)       { toast.error('State is required'); return; }
    if (!form.ticketPrice || Number(form.ticketPrice) <= 0) { toast.error('Ticket price must be > 0'); return; }

    setSaving(true);
    try {
      const payload = {
        name:           form.name.trim(),
        gameNumber:     form.gameNumber.trim() || null,
        ticketPrice:    Number(form.ticketPrice),
        ticketsPerBook: Math.max(1, Number(form.ticketsPerBook) || 30),
        state:          form.state,
        category:       form.category || 'instant',
        active:         !!form.active,
      };
      if (modalMode === 'edit' && editingId !== null) {
        await updateAdminLotteryCatalog(editingId, payload);
        toast.success('Game updated');
      } else {
        await createAdminLotteryCatalog(payload);
        toast.success('Game added to catalog');
      }
      closeModal();
      await load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || err?.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row: CatalogRow) => {
    if (!await confirm({
      title: `Delete "${row.name}" from the catalog?`,
      message: 'Stores will no longer see this game when receiving new books. Existing books already activated at stores keep working.',
      confirmLabel: 'Delete',
      danger: true,
    })) return;
    try {
      await deleteAdminLotteryCatalog(row.id);
      toast.success('Removed');
      await load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || err?.message);
    }
  };

  const handleSync = async (stateCode: string) => {
    if (syncing) return;
    const label = stateCode === 'all' ? 'all supported states' : stateCode;
    if (!await confirm({
      title: `Sync catalog for ${label}?`,
      message: (
        <>
          <p>Pull the latest games from the state lottery's public feed.</p>
          <p>
            • New games are added as <b>Active</b><br/>
            • Existing games refresh name + price<br/>
            • Games no longer in the feed are marked <b>Inactive</b> (never deleted)
          </p>
          <p>Admin-set <code>ticketsPerBook</code> + active overrides are preserved on existing games.</p>
        </>
      ),
      confirmLabel: 'Sync now',
    })) return;
    setSyncing(stateCode);
    setSyncMenuOpen(false);
    try {
      const body = await syncAdminLotteryCatalog(stateCode);
      if (body?.result?.unsupported) {
        toast.warning(body.result.error || `${label} sync isn't supported yet`);
      } else if (body?.result) {
        const r = body.result;
        toast.success(
          `${r.state}: ${r.fetched} from feed · ${r.created} new · ${r.updated} updated · ${r.nowInactive} marked inactive`,
          { autoClose: 7000 }
        );
      } else if (Array.isArray(body?.results)) {
        const summary = body.results.map((r: any) => r.error
          ? `${r.state}: ${r.error}`
          : `${r.state}: +${r.created} / ~${r.updated} / -${r.nowInactive}`
        ).join(' · ');
        toast.success(summary, { autoClose: 7000 });
      } else {
        toast.info('Sync completed');
      }
      await load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || err?.message);
    } finally {
      setSyncing(null);
    }
  };

  const reviewRequest = async (action: 'approve' | 'reject', catalogDraft: ReviewDraft | null = null) => {
    if (!reviewing) return;
    try {
      // Backend shape: { status: 'approved'|'rejected', adminNotes?, addToCatalog?, catalogData? }
      const payload: Record<string, unknown> = {
        status: action === 'approve' ? 'approved' : 'rejected',
        adminNotes: catalogDraft?.adminNotes || null,
      };
      if (action === 'approve' && catalogDraft) {
        payload.addToCatalog = true;
        payload.catalogData = {
          name:           catalogDraft.name,
          gameNumber:     catalogDraft.gameNumber || null,
          ticketPrice:    Number(catalogDraft.ticketPrice),
          ticketsPerBook: Number(catalogDraft.ticketsPerBook) || 30,
          state:          catalogDraft.state,
          category:       catalogDraft.category || 'instant',
        };
      }
      await reviewAdminLotteryRequest(reviewing.id, payload);
      toast.success(action === 'approve' ? 'Approved — added to catalog' : 'Rejected');
      setReviewing(null);
      await load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || err?.message);
    }
  };

  // Price tiers summary for the header strip
  const priceGroups = useMemo(() => {
    const map = new Map<number, number>();
    for (const t of catalog) {
      if (!t.active) continue;
      const k = Number(t.ticketPrice);
      map.set(k, (map.get(k) || 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
  }, [catalog]);

  return (
    <div className="adm-lot-wrap">
      <div className="admin-header">
        <div className="admin-header-left">
          <div className="admin-header-icon"><Ticket size={18} /></div>
          <div>
            <h1>Lottery Catalog</h1>
            <p>Platform-wide instant & draw game catalog. Games here are visible to stores whose state code matches.</p>
          </div>
        </div>
        <div className="admin-header-actions">
          {tab === 'catalog' && (
            <>
              <button className="admin-btn admin-btn-primary" onClick={openCreate}>
                <Plus size={14} /> Add Game
              </button>
              <div className="adm-lot-sync-wrap">
                <button
                  className="admin-btn admin-btn-secondary"
                  onClick={() => setSyncMenuOpen((o) => !o)}
                  disabled={!!syncing}
                  title="Pull the latest games from state lottery public feeds"
                >
                  <RefreshCw size={14} className={syncing ? 'adm-lot-spin' : ''} />
                  {syncing ? `Syncing ${syncing}…` : 'Sync from State'}
                  <ChevronDown size={12} />
                </button>
                {syncMenuOpen && !syncing && (
                  <div className="adm-lot-sync-menu">
                    <button onClick={() => handleSync('MA')}>Massachusetts (MA)</button>
                    <button onClick={() => handleSync('ME')} title="Maine sync coming soon — currently manual">
                      Maine (ME) <span className="adm-lot-soon">soon</span>
                    </button>
                    <div className="adm-lot-sync-divider" />
                    <button onClick={() => handleSync('all')}>All supported states</button>
                  </div>
                )}
              </div>
            </>
          )}
          <button className="admin-btn admin-btn-secondary" onClick={load} disabled={loading}>
            <RotateCcw size={14} /> Refresh
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="admin-tabs">
        <button className={`admin-tab ${tab === 'catalog' ? 'active' : ''}`} onClick={() => setTab('catalog')}>
          <Ticket size={13} /> Catalog <span className="admin-tab-count">{catalog.length}</span>
        </button>
        <button className={`admin-tab ${tab === 'requests' ? 'active' : ''}`} onClick={() => setTab('requests')}>
          <Inbox size={13} /> Requests
          {pendingCount > 0 && <span className="admin-tab-badge">{pendingCount}</span>}
        </button>
      </div>

      {tab === 'catalog' && (
        <>
          {/* Price-tier pills for quick overview */}
          {priceGroups.length > 0 && (
            <div className="adm-lot-price-strip">
              {priceGroups.map(([price, count]) => (
                <button
                  key={price}
                  className={`adm-lot-price-pill ${priceFilter === String(price) ? 'active' : ''}`}
                  onClick={() => setPriceFilter(priceFilter === String(price) ? '' : String(price))}
                >
                  <span className="adm-lot-price-val">${price}</span>
                  <span className="adm-lot-price-count">{count}</span>
                </button>
              ))}
            </div>
          )}

          <div className="adm-lot-filters">
            <div className="adm-lot-search">
              <Search size={14} />
              <input
                type="text"
                placeholder="Search name or game number…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <select value={stateFilter} onChange={(e) => setStateFilter(e.target.value)}>
              <option value="">All states</option>
              {supportedStates.map((s) => (
                <option key={s.code} value={s.code}>{s.code} — {s.name}</option>
              ))}
            </select>
            <select value={activeFilter} onChange={(e) => setActiveFilter(e.target.value as ActiveFilter)}>
              <option value="all">All statuses</option>
              <option value="active">Active only</option>
              <option value="inactive">Inactive only</option>
            </select>
          </div>

          {loading && <div className="adm-lot-loading">Loading catalog…</div>}
          {!loading && filteredCatalog.length === 0 && (
            <div className="adm-lot-empty">
              <Ticket size={32} />
              <div>No games match your filters.</div>
              <button className="admin-btn admin-btn-secondary" onClick={openCreate}>Add first game</button>
            </div>
          )}

          {!loading && filteredCatalog.length > 0 && (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>State</th>
                    <th>Game #</th>
                    <th>Name</th>
                    <th>Price</th>
                    <th>Tickets/Book</th>
                    <th>Category</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCatalog.map((t) => (
                    <tr key={t.id}>
                      <td><code className="adm-lot-state">{t.state || '—'}</code></td>
                      <td><code>{t.gameNumber || '—'}</code></td>
                      <td className="adm-lot-name">{t.name}</td>
                      <td className="adm-lot-price">${Number(t.ticketPrice).toFixed(2)}</td>
                      <td>{t.ticketsPerBook}</td>
                      <td><span className="adm-lot-cat">{t.category || 'instant'}</span></td>
                      <td>
                        {t.active
                          ? <span className="adm-lot-badge adm-lot-badge--active">Active</span>
                          : <span className="adm-lot-badge adm-lot-badge--inactive">Inactive</span>}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => openEdit(t)}>
                          <Edit2 size={13} />
                        </button>
                        <button className="admin-btn admin-btn-danger admin-btn-sm" onClick={() => remove(t)}>
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === 'requests' && (
        <RequestsTab requests={requests} onReview={(r) => setReviewing(r)} loading={loading} />
      )}

      {/* ── Catalog Modal ───────────────────────────────────────── */}
      {modalMode && (
        <div className="admin-modal-overlay" onClick={closeModal}>
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <div className="admin-modal-header">
              <h3>{modalMode === 'create' ? 'Add Game' : 'Edit Game'}</h3>
              <button onClick={closeModal}><X size={16} /></button>
            </div>
            <form onSubmit={submit} className="admin-modal-body">
              <div className="adm-lot-form-grid">
                <div className="adm-lot-field">
                  <label>State *</label>
                  <select value={form.state} onChange={(e) => setField({ state: e.target.value })} required>
                    <option value="">— Select —</option>
                    {supportedStates.map((s) => (
                      <option key={s.code} value={s.code}>{s.code} — {s.name}</option>
                    ))}
                  </select>
                </div>
                <div className="adm-lot-field">
                  <label>Game Number</label>
                  <input
                    type="text"
                    placeholder="e.g. 498"
                    value={form.gameNumber}
                    onChange={(e) => setField({ gameNumber: e.target.value })}
                  />
                  <small>3-digit state lottery code (optional). Required for scan matching.</small>
                </div>
                <div className="adm-lot-field adm-lot-field--full">
                  <label>Name *</label>
                  <input
                    type="text"
                    placeholder="e.g. Billion Dollars"
                    value={form.name}
                    onChange={(e) => setField({ name: e.target.value })}
                    required
                  />
                </div>
                <div className="adm-lot-field">
                  <label>Ticket Price ($) *</label>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={form.ticketPrice}
                    onChange={(e) => setField({ ticketPrice: Number(e.target.value) })}
                    required
                  />
                </div>
                <div className="adm-lot-field">
                  <label>Tickets per Book</label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={form.ticketsPerBook}
                    onChange={(e) => setField({ ticketsPerBook: Math.max(1, Number(e.target.value)) })}
                  />
                </div>
                <div className="adm-lot-field">
                  <label>Category</label>
                  <select value={form.category} onChange={(e) => setField({ category: e.target.value as Category })}>
                    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="adm-lot-field adm-lot-toggle">
                  <label>
                    <input type="checkbox" checked={form.active} onChange={(e) => setField({ active: e.target.checked })} />
                    <span>Active (visible to stores)</span>
                  </label>
                </div>
              </div>
              <div className="admin-modal-footer">
                <button type="button" className="admin-btn admin-btn-secondary" onClick={closeModal}>Cancel</button>
                <button type="submit" className="admin-btn admin-btn-primary" disabled={saving}>
                  <Save size={13} /> {saving ? 'Saving…' : modalMode === 'create' ? 'Add Game' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Review Modal ────────────────────────────────────────── */}
      {reviewing && (
        <ReviewRequestModal
          request={reviewing}
          supportedStates={supportedStates}
          onClose={() => setReviewing(null)}
          onApprove={(draft) => reviewRequest('approve', draft)}
          onReject={() => reviewRequest('reject')}
        />
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────
 * Requests Tab — store-submitted "please add this game" tickets
 * ──────────────────────────────────────────────────────────────── */
interface RequestsTabProps {
  requests: LotteryRequest[];
  onReview: (r: LotteryRequest) => void;
  loading: boolean;
}

function RequestsTab({ requests, onReview, loading }: RequestsTabProps) {
  const [statusFilter, setStatusFilter] = useState('pending');
  const filtered = requests.filter((r) => !statusFilter || (r.status || 'pending') === statusFilter);
  const pendingCount = requests.filter((r) => (r.status || 'pending') === 'pending').length;

  return (
    <>
      <div className="adm-lot-filters">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          <option value="pending">Pending ({pendingCount})</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>
      {loading && <div className="adm-lot-loading">Loading requests…</div>}
      {!loading && filtered.length === 0 && (
        <div className="adm-lot-empty">
          <Inbox size={32} />
          <div>No {statusFilter || ''} requests.</div>
        </div>
      )}
      {!loading && filtered.length > 0 && (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Store</th>
                <th>Name</th>
                <th>Game #</th>
                <th>State</th>
                <th>Price</th>
                <th>Submitted</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td>{r.storeName || r.storeId || '—'}</td>
                  <td className="adm-lot-name">{r.name}</td>
                  <td><code>{r.gameNumber || '—'}</code></td>
                  <td><code>{r.state || '—'}</code></td>
                  <td className="adm-lot-price">{r.ticketPrice != null ? `$${Number(r.ticketPrice).toFixed(2)}` : '—'}</td>
                  <td style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                    {r.createdAt ? new Date(r.createdAt).toLocaleDateString() : '—'}
                  </td>
                  <td>
                    <span className={`adm-lot-badge adm-lot-badge--${r.status || 'pending'}`}>{r.status || 'pending'}</span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {(r.status || 'pending') === 'pending' && (
                      <button className="admin-btn admin-btn-primary admin-btn-sm" onClick={() => onReview(r)}>
                        Review
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/* ────────────────────────────────────────────────────────────────
 * Review Request Modal — prefills the catalog form, admin confirms
 * ──────────────────────────────────────────────────────────────── */
interface ReviewRequestModalProps {
  request: LotteryRequest;
  supportedStates: SupportedState[];
  onClose: () => void;
  onApprove: (draft: ReviewDraft) => void;
  onReject: () => void;
}

function ReviewRequestModal({ request, supportedStates, onClose, onApprove, onReject }: ReviewRequestModalProps) {
  const [draft, setDraft] = useState<ReviewDraft>({
    name:           request.name || '',
    gameNumber:     request.gameNumber || '',
    ticketPrice:    Number(request.ticketPrice) || 1,
    ticketsPerBook: Number(request.ticketsPerBook) || 30,
    state:          request.state || '',
    category:       'instant',
    active:         true,
    adminNotes:     '',
  });
  const set = (patch: Partial<ReviewDraft>) => setDraft((d) => ({ ...d, ...patch }));

  return (
    <div className="admin-modal-overlay" onClick={onClose}>
      <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
        <div className="admin-modal-header">
          <h3>Review Request</h3>
          <button onClick={onClose}><X size={16} /></button>
        </div>
        <div className="admin-modal-body">
          <div className="adm-lot-request-summary">
            <div><strong>From:</strong> {request.storeName || request.storeId || 'Unknown store'}</div>
            <div><strong>Submitted:</strong> {request.createdAt ? new Date(request.createdAt).toLocaleString() : '—'}</div>
            {request.notes && <div><strong>Store note:</strong> {request.notes}</div>}
          </div>

          <div className="adm-lot-form-grid">
            <div className="adm-lot-field">
              <label>State *</label>
              <select value={draft.state} onChange={(e) => set({ state: e.target.value })}>
                <option value="">— Select —</option>
                {supportedStates.map((s) => <option key={s.code} value={s.code}>{s.code} — {s.name}</option>)}
              </select>
            </div>
            <div className="adm-lot-field">
              <label>Game Number</label>
              <input type="text" value={draft.gameNumber} onChange={(e) => set({ gameNumber: e.target.value })} />
            </div>
            <div className="adm-lot-field adm-lot-field--full">
              <label>Name *</label>
              <input type="text" value={draft.name} onChange={(e) => set({ name: e.target.value })} />
            </div>
            <div className="adm-lot-field">
              <label>Ticket Price ($)</label>
              <input type="number" step="0.01" value={draft.ticketPrice} onChange={(e) => set({ ticketPrice: Number(e.target.value) })} />
            </div>
            <div className="adm-lot-field">
              <label>Tickets per Book</label>
              <input type="number" step="1" value={draft.ticketsPerBook} onChange={(e) => set({ ticketsPerBook: Number(e.target.value) })} />
            </div>
            <div className="adm-lot-field adm-lot-field--full">
              <label>Admin Note (optional)</label>
              <textarea rows={2} value={draft.adminNotes} onChange={(e) => set({ adminNotes: e.target.value })}
                placeholder="Visible to the requesting store" />
            </div>
          </div>
        </div>
        <div className="admin-modal-footer">
          <button className="admin-btn admin-btn-danger" onClick={onReject}>
            <X size={13} /> Reject
          </button>
          <button className="admin-btn admin-btn-primary" onClick={() => onApprove(draft)}>
            <Check size={13} /> Approve & Add to Catalog
          </button>
        </div>
      </div>
    </div>
  );
}
