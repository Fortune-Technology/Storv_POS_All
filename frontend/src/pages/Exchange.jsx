/**
 * StoreVeu Exchange Hub — top-level page for all B2B wholesale workflow.
 *
 * Tabs:
 *   Dashboard   — KPI cards + pending-action callouts
 *   Orders      — unified list of sent + received with direction/status filters
 *   Balances    — partner balances with settle action
 *   Partners    — trading partner handshakes (incoming + outgoing)
 *   Settings    — my store code + availability tool
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import { useConfirm } from '../hooks/useConfirmDialog.jsx';
import {
  Repeat, Inbox, Send, Handshake, Wallet, Settings2, Check, X,
  ArrowRight, ArrowLeft, Copy, Search, Plus, AlertTriangle,
  RefreshCw, DollarSign, FileText, Clock,
} from 'lucide-react';
import {
  listWholesaleOrders, listPartnerBalances, listTradingPartners,
  listAcceptedPartners, listPendingPartnerRequests,
  getMyStoreCode, checkStoreCode, setMyStoreCode, lookupStoreByCode,
  sendPartnerRequest, acceptPartnerRequest, rejectPartnerRequest, revokePartnership,
  recordSettlement,
  listSettlements as listSettlementsApi,
  confirmSettlement as confirmSettlementApi,
  disputeSettlement as disputeSettlementApi,
  archiveWholesaleOrder, unarchiveWholesaleOrder,
} from '../services/api';
import { usePermissions } from '../hooks/usePermissions';
import './Exchange.css';

const TABS = [
  { key: 'dashboard', label: 'Dashboard', icon: Repeat },
  { key: 'orders',    label: 'Orders',    icon: FileText },
  { key: 'balances',  label: 'Partner Balances', icon: Wallet },
  { key: 'partners',  label: 'Trading Partners', icon: Handshake },
  { key: 'settings',  label: 'Store Code', icon: Settings2 },
];

const STATUS_META = {
  draft:                { label: 'Draft',           color: '#64748b' },
  sent:                 { label: 'Sent',            color: '#0ea5e9' },
  confirmed:            { label: 'Confirmed',       color: '#16a34a' },
  partially_confirmed:  { label: 'Partial',         color: '#f59e0b' },
  rejected:             { label: 'Rejected',        color: '#ef4444' },
  cancelled:            { label: 'Cancelled',       color: '#94a3b8' },
  expired:              { label: 'Expired',         color: '#a16207' },
};

const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A';
const fmtDateTime = (d) => d ? new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'N/A';

export default function Exchange() {
  const { can } = usePermissions();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState(searchParams.get('tab') || 'dashboard');
  const [loading, setLoading] = useState(true);

  // Shared data
  const [orders, setOrders] = useState([]);
  const [balances, setBalances] = useState([]);
  const [balanceSummary, setBalanceSummary] = useState(null);
  const [partners, setPartners] = useState([]);
  const [pendingIn, setPendingIn] = useState([]);
  const [myCode, setMyCode] = useState(null);
  // Session 39 — archived-order toggle
  const [showArchived, setShowArchived] = useState(false);

  const changeTab = (key) => {
    setTab(key);
    setSearchParams({ tab: key });
  };

  const refreshAll = useCallback(async () => {
    setLoading(true);
    try {
      const [ordersRes, balRes, partnersRes, pendingRes, codeRes] = await Promise.all([
        listWholesaleOrders({ limit: 100, showArchived: showArchived ? 'true' : undefined }).catch(() => ({ data: [] })),
        listPartnerBalances().catch(() => ({ data: [], summary: null })),
        listTradingPartners().catch(() => []),
        listPendingPartnerRequests().catch(() => ({ data: [], count: 0 })),
        getMyStoreCode().catch(() => null),
      ]);
      setOrders(ordersRes.data || []);
      setBalances(balRes.data || []);
      setBalanceSummary(balRes.summary || null);
      setPartners(Array.isArray(partnersRes) ? partnersRes : partnersRes.data || []);
      setPendingIn(pendingRes.data || []);
      setMyCode(codeRes || null);
    } catch (err) {
      console.warn('[Exchange] refresh failed', err.message);
    } finally {
      setLoading(false);
    }
  }, [showArchived]);

  useEffect(() => { refreshAll(); }, [refreshAll]);

  // ── KPI summaries ──
  const kpi = useMemo(() => {
    const pendingIncoming = orders.filter(o => o.direction === 'incoming' && o.status === 'sent').length;
    const pendingOutgoing = orders.filter(o => o.direction === 'outgoing' && o.status === 'sent').length;
    const drafts = orders.filter(o => o.direction === 'outgoing' && o.status === 'draft').length;
    return {
      pendingIncoming, pendingOutgoing, drafts,
      totalOwedToMe: balanceSummary?.totalOwedToMe || 0,
      totalIOwe: balanceSummary?.totalIOwe || 0,
      netPosition: balanceSummary?.netPosition || 0,
      partnerCount: partners.filter(p => p.status === 'accepted').length,
      pendingPartnerRequests: pendingIn.length,
    };
  }, [orders, balanceSummary, partners, pendingIn]);

  return (
    <div className="p-page ex-page">
      <header className="p-header">
        <div className="p-header-left">
          <div className="p-header-icon"><Repeat size={22} /></div>
          <div>
            <h1 className="p-title">StoreVeu Exchange</h1>
            <p className="p-subtitle">B2B wholesale between trading partners — orders, balances, and settlement.</p>
          </div>
        </div>
        <div className="p-header-actions">
          <button className="p-btn p-btn-ghost" onClick={refreshAll} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'ex-spin' : ''} /> Refresh
          </button>
          {can('exchange.create') && (
            <button className="p-btn p-btn-primary" onClick={() => navigate('/portal/exchange/new')}>
              <Plus size={15} /> New Wholesale Order
            </button>
          )}
        </div>
      </header>

      <div className="p-tabs">
        {TABS.map(t => (
          <button
            key={t.key}
            className={`p-tab ${tab === t.key ? 'active' : ''}`}
            onClick={() => changeTab(t.key)}
          >
            <t.icon size={14} /> {t.label}
            {t.key === 'partners' && kpi.pendingPartnerRequests > 0 && (
              <span className="ex-tab-badge">{kpi.pendingPartnerRequests}</span>
            )}
            {t.key === 'orders' && kpi.pendingIncoming > 0 && (
              <span className="ex-tab-badge ex-tab-badge--blue">{kpi.pendingIncoming}</span>
            )}
          </button>
        ))}
      </div>

      {tab === 'dashboard' && <DashboardTab kpi={kpi} orders={orders} balances={balances} navigate={navigate} myCode={myCode} onClaimCode={() => changeTab('settings')} />}
      {tab === 'orders'    && <OrdersTab orders={orders} loading={loading} onRefresh={refreshAll} navigate={navigate}
                                          showArchived={showArchived} setShowArchived={setShowArchived} />}
      {tab === 'balances'  && <BalancesTab balances={balances} summary={balanceSummary} partners={partners} onRefresh={refreshAll} />}
      {tab === 'partners'  && <PartnersTab partners={partners} pendingIn={pendingIn} onRefresh={refreshAll} can={can} />}
      {tab === 'settings'  && <SettingsTab myCode={myCode} onSaved={refreshAll} can={can} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// DASHBOARD TAB
// ═══════════════════════════════════════════════════════════════

function DashboardTab({ kpi, orders, balances, navigate, myCode, onClaimCode }) {
  const recent = orders.slice(0, 8);
  const topBalances = balances.filter(b => Math.abs(b.netBalance) > 0.005).slice(0, 5);
  const needsCode = !myCode?.storeCode;

  return (
    <div className="ex-dashboard">
      {needsCode && (
        <div className="ex-claim-banner">
          <div className="ex-claim-banner-icon"><Settings2 size={22} /></div>
          <div className="ex-claim-banner-text">
            <h3>Claim your Store Code to get started</h3>
            <p>Trading partners find you by a unique store code (like a username). Claim one now — you can share it with stores you want to trade with.</p>
          </div>
          <button className="p-btn p-btn-primary" onClick={onClaimCode}>
            Claim Store Code →
          </button>
        </div>
      )}
      {!needsCode && (
        <div className="ex-code-pill-row">
          <span className="ex-muted ex-muted--small">Your Store Code:</span>
          <code className="ex-code-pill">{myCode.storeCode}</code>
          <button className="ex-link" onClick={() => { navigator.clipboard.writeText(myCode.storeCode); toast.success('Copied'); }}>
            <Copy size={11} /> copy
          </button>
          <span className="ex-muted ex-muted--small">— share with partners so they can find you</span>
        </div>
      )}
      <div className="ex-kpi-grid">
        <KpiCard
          icon={<Inbox size={18} />}
          label="Pending Incoming"
          value={kpi.pendingIncoming}
          accent="#0ea5e9"
          sub="POs awaiting your confirmation"
        />
        <KpiCard
          icon={<Send size={18} />}
          label="Pending Outgoing"
          value={kpi.pendingOutgoing}
          accent="#f59e0b"
          sub="Sent POs awaiting partner confirmation"
        />
        <KpiCard
          icon={<FileText size={18} />}
          label="Drafts"
          value={kpi.drafts}
          accent="#64748b"
          sub="POs you're building"
        />
        <KpiCard
          icon={<Handshake size={18} />}
          label="Active Partners"
          value={kpi.partnerCount}
          accent="#7c3aed"
          sub={`${kpi.pendingPartnerRequests} pending invites`}
        />
        <KpiCard
          icon={<DollarSign size={18} />}
          label="Partners Owe Me"
          value={money(kpi.totalOwedToMe)}
          accent="#16a34a"
        />
        <KpiCard
          icon={<DollarSign size={18} />}
          label="I Owe Partners"
          value={money(kpi.totalIOwe)}
          accent="#ef4444"
        />
        <KpiCard
          icon={<Wallet size={18} />}
          label="Net Position"
          value={money(kpi.netPosition)}
          accent={kpi.netPosition >= 0 ? '#16a34a' : '#ef4444'}
          sub={kpi.netPosition >= 0 ? 'partners owe you net' : 'you owe partners net'}
        />
      </div>

      <div className="ex-dash-cols">
        <div className="p-card">
          <div className="p-card-head">
            <h3>Recent Orders</h3>
            <button className="ex-link" onClick={() => navigate('/portal/exchange?tab=orders')}>See all →</button>
          </div>
          {recent.length === 0 ? (
            <div className="p-empty">No orders yet. Send your first wholesale order to a trading partner.</div>
          ) : (
            <table className="p-table ex-mini-table">
              <thead>
                <tr><th>#</th><th>Partner</th><th>Direction</th><th>Status</th><th className="right">Total</th></tr>
              </thead>
              <tbody>
                {recent.map(o => (
                  <tr key={o.id} onClick={() => navigate(`/portal/exchange/orders/${o.id}`)} className="ex-row-click">
                    <td><strong>{o.orderNumber}</strong></td>
                    <td>{o.partner?.name || 'N/A'}</td>
                    <td>
                      <span className={`ex-dir ex-dir--${o.direction}`}>
                        {o.direction === 'outgoing' ? <ArrowRight size={12} /> : <ArrowLeft size={12} />}
                        {o.direction}
                      </span>
                    </td>
                    <td><StatusBadge status={o.status} /></td>
                    <td className="right"><strong>{money(o.confirmedGrandTotal || o.grandTotal)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="p-card">
          <div className="p-card-head">
            <h3>Outstanding Balances</h3>
            <button className="ex-link" onClick={() => navigate('/portal/exchange?tab=balances')}>Manage →</button>
          </div>
          {topBalances.length === 0 ? (
            <div className="p-empty">All partner balances are settled.</div>
          ) : (
            <div className="ex-balance-list">
              {topBalances.map(b => (
                <div key={b.id} className="ex-balance-row">
                  <div>
                    <div className="ex-balance-name">{b.partnerName}</div>
                    <div className="ex-muted">{b.partnerStoreCode}</div>
                  </div>
                  <div className={`ex-balance-amt ex-balance-amt--${b.direction}`}>
                    {b.direction === 'partner_owes_me' ? `+${money(b.netBalance)}` :
                      b.direction === 'i_owe_partner' ? `-${money(Math.abs(b.netBalance))}` :
                      money(0)}
                    <div className="ex-muted ex-muted--small">
                      {b.direction === 'partner_owes_me' ? 'owes you' :
                       b.direction === 'i_owe_partner' ? 'you owe' : 'settled'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function KpiCard({ icon, label, value, accent, sub }) {
  return (
    <div className="ex-kpi-card" style={{ borderLeftColor: accent }}>
      <div className="ex-kpi-top">
        <span className="ex-kpi-icon" style={{ background: `${accent}22`, color: accent }}>{icon}</span>
        <span className="ex-kpi-label">{label}</span>
      </div>
      <div className="ex-kpi-value" style={{ color: accent }}>{value}</div>
      {sub && <div className="ex-kpi-sub">{sub}</div>}
    </div>
  );
}

function StatusBadge({ status }) {
  const m = STATUS_META[status] || { label: status, color: '#64748b' };
  return (
    <span className="ex-status" style={{ background: `${m.color}22`, color: m.color }}>
      {m.label}
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════
// ORDERS TAB
// ═══════════════════════════════════════════════════════════════

function OrdersTab({ orders, loading, onRefresh, navigate, showArchived, setShowArchived }) {
  const [directionFilter, setDirectionFilter] = useState('all');   // all | outgoing | incoming
  const [statusFilter, setStatusFilter]       = useState('all');   // all | active | drafts | completed | cancelled
  const [search, setSearch]                   = useState('');
  const [archivingId, setArchivingId]         = useState(null);

  // Determine from the order + active user's store side whether "I" have archived it.
  // Backend already filters archived rows out of the default list; this is purely
  // for labeling the Archive/Unarchive button correctly when showing archived.
  const myStoreId = (typeof window !== 'undefined')
    ? (localStorage.getItem('activeStoreId') || null)
    : null;
  const isMyArchive = (o) => {
    if (!myStoreId) return false;
    if (o.senderStoreId   === myStoreId) return !!o.senderArchived;
    if (o.receiverStoreId === myStoreId) return !!o.receiverArchived;
    return false;
  };

  const handleArchive = async (e, o) => {
    e.stopPropagation();
    if (archivingId) return;
    setArchivingId(o.id);
    try {
      if (isMyArchive(o)) {
        await unarchiveWholesaleOrder(o.id);
        toast.success('Order unarchived');
      } else {
        await archiveWholesaleOrder(o.id);
        toast.success('Order archived');
      }
      onRefresh();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Archive action failed');
    } finally {
      setArchivingId(null);
    }
  };

  const canArchive = (o) =>
    ['confirmed', 'partially_confirmed', 'rejected', 'cancelled', 'expired'].includes(o.status);

  const filtered = useMemo(() => {
    return orders.filter(o => {
      if (directionFilter !== 'all' && o.direction !== directionFilter) return false;
      if (statusFilter === 'active' && !['sent'].includes(o.status)) return false;
      if (statusFilter === 'drafts' && o.status !== 'draft') return false;
      if (statusFilter === 'completed' && !['confirmed', 'partially_confirmed'].includes(o.status)) return false;
      if (statusFilter === 'cancelled' && !['cancelled', 'rejected', 'expired'].includes(o.status)) return false;
      if (search) {
        const s = search.toLowerCase();
        if (!o.orderNumber.toLowerCase().includes(s) &&
            !(o.partner?.name || '').toLowerCase().includes(s) &&
            !(o.partner?.storeCode || '').toLowerCase().includes(s)) return false;
      }
      return true;
    });
  }, [orders, directionFilter, statusFilter, search]);

  return (
    <div className="ex-orders">
      <div className="ex-filters">
        <div className="ex-seg">
          {['all', 'outgoing', 'incoming'].map(v => (
            <button key={v} className={directionFilter === v ? 'ex-seg-active' : ''} onClick={() => setDirectionFilter(v)}>
              {v === 'all' ? 'All' : v === 'outgoing' ? 'Outgoing' : 'Incoming'}
            </button>
          ))}
        </div>
        <div className="ex-seg">
          {[
            { k: 'all', l: 'All' },
            { k: 'active', l: 'Action needed' },
            { k: 'drafts', l: 'Drafts' },
            { k: 'completed', l: 'Completed' },
            { k: 'cancelled', l: 'Cancelled' },
          ].map(v => (
            <button key={v.k} className={statusFilter === v.k ? 'ex-seg-active' : ''} onClick={() => setStatusFilter(v.k)}>
              {v.l}
            </button>
          ))}
        </div>
        <div className="ex-search">
          <Search size={14} />
          <input placeholder="Order # or partner…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <label className="ex-archive-toggle" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', color: 'var(--text-secondary)', cursor: 'pointer', userSelect: 'none' }}>
          <input type="checkbox" checked={!!showArchived} onChange={e => setShowArchived(e.target.checked)} />
          Show archived
        </label>
      </div>

      {loading ? (
        <div className="p-loading">Loading orders…</div>
      ) : filtered.length === 0 ? (
        <div className="p-empty">
          {orders.length === 0
            ? "No orders yet. Click \"New Wholesale Order\" to send your first one."
            : "No orders match these filters."}
        </div>
      ) : (
        <table className="p-table ex-orders-table">
          <thead>
            <tr>
              <th>Order #</th>
              <th>Direction</th>
              <th>Partner</th>
              <th>Status</th>
              <th>Created</th>
              <th>Items</th>
              <th className="right">Total</th>
              <th style={{ width: 90 }}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(o => (
              <tr key={o.id} onClick={() => navigate(`/portal/exchange/orders/${o.id}`)} className="ex-row-click">
                <td>
                  <strong>{o.orderNumber}</strong>
                  {isMyArchive(o) && (
                    <span style={{ marginLeft: 6, fontSize: '0.65rem', padding: '1px 6px', borderRadius: 4,
                      background: 'rgba(100,116,139,.15)', color: '#64748b', fontWeight: 700 }}>ARCHIVED</span>
                  )}
                </td>
                <td>
                  <span className={`ex-dir ex-dir--${o.direction}`}>
                    {o.direction === 'outgoing' ? <ArrowRight size={12} /> : <ArrowLeft size={12} />}
                    {o.direction}
                  </span>
                </td>
                <td>
                  <div>{o.partner?.name}</div>
                  <div className="ex-muted ex-muted--small">{o.partner?.storeCode}</div>
                </td>
                <td><StatusBadge status={o.status} /></td>
                <td className="ex-muted">{fmtDateTime(o.createdAt)}</td>
                <td>{o._count?.items || 0}</td>
                <td className="right"><strong>{money(o.confirmedGrandTotal || o.grandTotal)}</strong></td>
                <td onClick={e => e.stopPropagation()}>
                  {canArchive(o) && (
                    <button
                      onClick={(e) => handleArchive(e, o)}
                      disabled={archivingId === o.id}
                      title={isMyArchive(o) ? 'Unarchive' : 'Archive'}
                      style={{
                        padding: '3px 10px', fontSize: '0.7rem', fontWeight: 600,
                        border: '1px solid var(--border-color)', borderRadius: 5,
                        background: isMyArchive(o) ? 'rgba(16,185,129,.1)' : 'var(--bg-tertiary)',
                        color: isMyArchive(o) ? '#10b981' : 'var(--text-secondary)',
                        cursor: 'pointer',
                      }}
                    >
                      {archivingId === o.id ? '…' : (isMyArchive(o) ? 'Unarchive' : 'Archive')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// BALANCES TAB — partner cards with settle action
// ═══════════════════════════════════════════════════════════════

function BalancesTab({ balances, summary, partners, onRefresh }) {
  const [settleModal, setSettleModal] = useState(null);   // { partner, direction }
  const [pendingSettlements, setPendingSettlements] = useState([]);
  const [settlementsBusy, setSettlementsBusy] = useState(false);

  const acceptedPartners = partners.filter(p => p.status === 'accepted');

  // Load all settlements and filter to pending/incoming
  const loadSettlements = useCallback(async () => {
    try {
      const r = await listSettlementsApi();
      setPendingSettlements((r || []).filter(s => s.status === 'pending'));
    } catch (err) { console.warn('settlements load', err.message); }
  }, []);
  useEffect(() => { loadSettlements(); }, [loadSettlements]);

  const confirm = async (id) => {
    setSettlementsBusy(true);
    try {
      await confirmSettlementApi(id);
      toast.success('Settlement confirmed — ledger updated.');
      await Promise.all([loadSettlements(), onRefresh()]);
    } catch (err) {
      toast.error(err.response?.data?.error || err.message);
    } finally { setSettlementsBusy(false); }
  };
  const dispute = async (id) => {
    const reason = prompt('Reason for dispute (required):');
    if (!reason?.trim()) return;
    setSettlementsBusy(true);
    try {
      await disputeSettlementApi(id, reason);
      toast.info('Settlement disputed — partner notified.');
      await loadSettlements();
    } catch (err) { toast.error(err.response?.data?.error || err.message); }
    finally { setSettlementsBusy(false); }
  };

  return (
    <div className="ex-balances">
      {/* Pending settlements — need my confirmation */}
      {pendingSettlements.filter(s => s.needsMyConfirmation).length > 0 && (
        <div className="p-card ex-pending-settlements">
          <div className="p-card-head">
            <h3><AlertTriangle size={16} /> Pending Settlements — Action Required</h3>
            <span className="ex-muted ex-muted--small">
              Ledger won't update until you confirm each one
            </span>
          </div>
          <div className="ex-pending-list">
            {pendingSettlements.filter(s => s.needsMyConfirmation).map(s => {
              const partner = balances.find(b =>
                b.partnerStoreId === (s.payerStoreId !== s.storeAId ? s.payerStoreId : s.payeeStoreId) ||
                b.partnerStoreId === (s.payerStoreId === s.storeAId ? s.payeeStoreId : s.payerStoreId)
              );
              const partnerName = partner?.partnerName || 'Partner';
              const paidByMe = s.payerStoreId === partner?.partnerStoreId ? false : true;
              // Simpler: if recorder says THEY paid me, s.paidByMe in API is from RECORDER's view.
              // For us (other party), invert:
              const partnerClaimsPaid = !s.paidByMe;  // recorder's paidByMe inverted
              return (
                <div key={s.id} className="ex-pending-row">
                  <div className="ex-pending-main">
                    <div className="ex-pending-title">
                      {partnerClaimsPaid
                        ? <>Partner says <strong>they paid you</strong> {money(s.amount)}</>
                        : <>Partner says <strong>you paid them</strong> {money(s.amount)}</>}
                    </div>
                    <div className="ex-muted ex-muted--small">
                      {s.method}{s.methodRef ? ` #${s.methodRef}` : ''} · {fmtDateTime(s.recordedAt)}
                      {s.note && <> · "{s.note}"</>}
                    </div>
                  </div>
                  <div className="ex-pending-actions">
                    <button className="p-btn p-btn-primary" onClick={() => confirm(s.id)} disabled={settlementsBusy}>
                      <Check size={14} /> Confirm
                    </button>
                    <button className="p-btn p-btn-ghost" onClick={() => dispute(s.id)} disabled={settlementsBusy}>
                      <X size={14} /> Dispute
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Awaiting partner confirmation (mine that they haven't confirmed yet) */}
      {pendingSettlements.filter(s => s.recordedByMe).length > 0 && (
        <div className="p-card ex-awaiting-settlements">
          <div className="p-card-head">
            <h3><Clock size={16} /> Awaiting Partner Confirmation</h3>
          </div>
          <div className="ex-pending-list">
            {pendingSettlements.filter(s => s.recordedByMe).map(s => (
              <div key={s.id} className="ex-pending-row">
                <div className="ex-pending-main">
                  <div className="ex-pending-title">
                    {s.paidByMe
                      ? <>You recorded paying {money(s.amount)}</>
                      : <>You recorded receiving {money(s.amount)}</>}
                  </div>
                  <div className="ex-muted ex-muted--small">
                    {s.method}{s.methodRef ? ` #${s.methodRef}` : ''} · {fmtDateTime(s.recordedAt)}
                  </div>
                </div>
                <div className="ex-muted ex-muted--small">Waiting for partner to confirm…</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {summary && (
        <div className="ex-bal-summary">
          <div className="ex-bal-summary-card">
            <span className="ex-bal-summary-label">Partners owe you</span>
            <span className="ex-bal-summary-value ex-bal-pos">{money(summary.totalOwedToMe)}</span>
          </div>
          <div className="ex-bal-summary-card">
            <span className="ex-bal-summary-label">You owe partners</span>
            <span className="ex-bal-summary-value ex-bal-neg">{money(summary.totalIOwe)}</span>
          </div>
          <div className="ex-bal-summary-card">
            <span className="ex-bal-summary-label">Net position</span>
            <span className={`ex-bal-summary-value ${summary.netPosition >= 0 ? 'ex-bal-pos' : 'ex-bal-neg'}`}>
              {summary.netPosition >= 0 ? '+' : ''}{money(summary.netPosition)}
            </span>
          </div>
        </div>
      )}

      {balances.length === 0 ? (
        <div className="p-empty">
          No balances yet. Balances appear after your first wholesale order is confirmed.
        </div>
      ) : (
        <div className="ex-balance-cards">
          {balances.map(b => (
            <div key={b.id} className="ex-balance-card">
              <div className="ex-balance-card-top">
                <div>
                  <h4>{b.partnerName}</h4>
                  <div className="ex-muted ex-muted--small">
                    {b.partnerStoreCode} · {b.partnerOrgName}
                  </div>
                </div>
                <div className={`ex-balance-card-amt ex-balance-amt--${b.direction}`}>
                  {b.direction === 'partner_owes_me' ? `+${money(b.netBalance)}` :
                   b.direction === 'i_owe_partner' ? `-${money(Math.abs(b.netBalance))}` :
                   money(0)}
                </div>
              </div>
              <div className="ex-balance-card-state">
                {b.direction === 'partner_owes_me' && <span className="ex-bal-pill ex-bal-pill--pos">Partner owes you</span>}
                {b.direction === 'i_owe_partner' && <span className="ex-bal-pill ex-bal-pill--neg">You owe partner</span>}
                {b.direction === 'settled' && <span className="ex-bal-pill ex-bal-pill--zero">Settled</span>}
                <span className="ex-muted ex-muted--small">Last activity {fmtDate(b.lastActivityAt)}</span>
              </div>
              <div className="ex-balance-card-actions">
                <button
                  className="p-btn p-btn-primary"
                  disabled={b.direction === 'settled'}
                  onClick={() => setSettleModal({
                    partner: { id: b.partnerStoreId, name: b.partnerName },
                    direction: b.direction,
                    amount: Math.abs(b.netBalance),
                  })}
                >
                  <DollarSign size={14} /> Record Settlement
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Free-form settlement for pre-payment (no outstanding balance) */}
      {acceptedPartners.length > 0 && balances.length === 0 && (
        <div className="ex-bal-prepay">
          <p>Want to record a pre-payment? Pick a partner:</p>
          <div className="ex-bal-prepay-list">
            {acceptedPartners.map(p => (
              <button key={p.id} className="p-btn p-btn-ghost"
                onClick={() => setSettleModal({ partner: { id: p.partner.id, name: p.partner.name }, direction: 'settled', amount: 0 })}>
                {p.partner.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {settleModal && (
        <SettlementModal
          {...settleModal}
          onClose={() => setSettleModal(null)}
          onSaved={() => { setSettleModal(null); onRefresh(); }}
        />
      )}
    </div>
  );
}

function SettlementModal({ partner, direction, amount, onClose, onSaved }) {
  // Who paid whom — default direction based on the balance:
  //   partner_owes_me → expected: partner paid me (paidByMe = false)
  //   i_owe_partner   → expected: I paid partner (paidByMe = true)
  //   settled         → pre-payment, user picks
  const [paidByMe, setPaidByMe] = useState(direction === 'i_owe_partner');
  const [amt, setAmt]           = useState(String(amount || ''));
  const [method, setMethod]     = useState('cash');
  const [methodRef, setMethodRef] = useState('');
  const [note, setNote]         = useState('');
  const [saving, setSaving]     = useState(false);

  const submit = async () => {
    const n = Number(amt);
    if (!n || n <= 0) return toast.error('Amount must be > 0');
    setSaving(true);
    try {
      await recordSettlement({
        partnerStoreId: partner.id,
        amount: n,
        method,
        methodRef: methodRef || undefined,
        note: note || undefined,
        paidByMe,
      });
      toast.success('Settlement recorded — partner notified.');
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.error || err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-modal-overlay" onClick={onClose}>
      <div className="p-modal" onClick={e => e.stopPropagation()}>
        <div className="p-modal-head">
          <h3>Record Settlement — {partner.name}</h3>
          <button className="p-modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="p-modal-body">
          <div className="ex-seg ex-seg-full">
            <button className={paidByMe ? 'ex-seg-active' : ''} onClick={() => setPaidByMe(true)}>I paid the partner</button>
            <button className={!paidByMe ? 'ex-seg-active' : ''} onClick={() => setPaidByMe(false)}>Partner paid me</button>
          </div>
          <div className="ex-field">
            <label>Amount ($)</label>
            <input type="number" min="0" step="0.01" value={amt} onChange={e => setAmt(e.target.value)} autoFocus />
          </div>
          <div className="ex-field">
            <label>Method</label>
            <select value={method} onChange={e => setMethod(e.target.value)}>
              <option value="cash">Cash</option>
              <option value="check">Check</option>
              <option value="bank_transfer">Bank Transfer</option>
              <option value="zelle">Zelle</option>
              <option value="venmo">Venmo</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div className="ex-field">
            <label>Reference # <span className="ex-muted">(optional: check #, txn ID)</span></label>
            <input value={methodRef} onChange={e => setMethodRef(e.target.value)} placeholder="e.g. 1042" />
          </div>
          <div className="ex-field">
            <label>Note</label>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} />
          </div>
          <div className="ex-modal-info">
            <Clock size={13} /> Partner will be notified by email. The ledger only updates after they confirm receipt.
          </div>
        </div>
        <div className="p-modal-foot">
          <button className="p-btn p-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="p-btn p-btn-primary" onClick={submit} disabled={saving}>
            {saving ? 'Saving…' : 'Record Settlement'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PARTNERS TAB — handshake management
// ═══════════════════════════════════════════════════════════════

function PartnersTab({ partners, pendingIn, onRefresh, can }) {
  const confirm = useConfirm();
  const [lookupCode, setLookupCode] = useState('');
  const [lookupResult, setLookupResult] = useState(null);
  const [lookupErr, setLookupErr] = useState(null);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');

  const accepted = partners.filter(p => p.status === 'accepted');
  const outgoing = partners.filter(p => p.direction === 'outgoing' && p.status === 'pending');
  const rejected = partners.filter(p => p.status === 'rejected' || p.status === 'revoked');

  const doLookup = async () => {
    if (!lookupCode.trim()) return;
    setLookupBusy(true);
    setLookupErr(null);
    setLookupResult(null);
    try {
      const r = await lookupStoreByCode(lookupCode.trim());
      setLookupResult(r);
    } catch (err) {
      setLookupErr(err.response?.data?.error || err.message);
    } finally {
      setLookupBusy(false);
    }
  };

  const sendRequest = async () => {
    try {
      await sendPartnerRequest({ partnerStoreId: lookupResult.storeId, requestNote: noteDraft || undefined });
      toast.success('Partner request sent.');
      setLookupResult(null); setLookupCode(''); setNoteDraft('');
      onRefresh();
    } catch (err) {
      toast.error(err.response?.data?.error || err.message);
    }
  };

  const accept = async (id) => {
    try {
      await acceptPartnerRequest(id);
      toast.success('Partnership accepted.');
      onRefresh();
    } catch (err) { toast.error(err.response?.data?.error || err.message); }
  };
  const reject = async (id) => {
    const reason = prompt('Optional reason?') || '';
    try {
      await rejectPartnerRequest(id, reason);
      toast.info('Request rejected.');
      onRefresh();
    } catch (err) { toast.error(err.response?.data?.error || err.message); }
  };
  const revoke = async (id) => {
    if (!await confirm({
      title: 'End partnership?',
      message: 'End partnership? They will no longer be able to send you POs.',
      confirmLabel: 'End',
      danger: true,
    })) return;
    try {
      await revokePartnership(id, '');
      toast.info('Partnership ended.');
      onRefresh();
    } catch (err) { toast.error(err.response?.data?.error || err.message); }
  };

  return (
    <div className="ex-partners">
      {/* Lookup & invite */}
      {can('exchange.manage') && (
        <div className="p-card ex-lookup-card">
          <div className="p-card-head"><h3>Find a Trading Partner</h3></div>
          <div className="ex-lookup-row">
            <div className="ex-search ex-search--lg">
              <Search size={14} />
              <input
                placeholder="Enter their Store Code (e.g. MAIN-ST-BROOKLYN)"
                value={lookupCode}
                onChange={e => setLookupCode(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && doLookup()}
              />
            </div>
            <button className="p-btn p-btn-primary" onClick={doLookup} disabled={lookupBusy || !lookupCode.trim()}>
              {lookupBusy ? 'Looking up…' : 'Look up'}
            </button>
          </div>
          {lookupErr && <div className="ex-error">{lookupErr}</div>}
          {lookupResult && (
            <div className="ex-lookup-result">
              <div>
                <h4>{lookupResult.name}</h4>
                <div className="ex-muted">
                  {lookupResult.address || 'N/A'} · {lookupResult.orgName}
                </div>
                <div className="ex-code-chip">{lookupResult.storeCode}</div>
              </div>
              {lookupResult.isSelf ? (
                <div className="ex-info-chip">This is your store</div>
              ) : lookupResult.partnership?.status === 'accepted' ? (
                <div className="ex-info-chip ex-info-chip--good">Already partnered</div>
              ) : lookupResult.partnership?.status === 'pending' ? (
                <div className="ex-info-chip">Pending request exists</div>
              ) : (
                <div className="ex-lookup-invite">
                  <input
                    placeholder="Optional note to introduce yourself…"
                    value={noteDraft}
                    onChange={e => setNoteDraft(e.target.value)}
                  />
                  <button className="p-btn p-btn-primary" onClick={sendRequest}>
                    <Handshake size={14} /> Send Partner Request
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Pending incoming */}
      {pendingIn.length > 0 && (
        <div className="p-card">
          <div className="p-card-head">
            <h3>Pending Requests <span className="ex-pill ex-pill--amber">{pendingIn.length}</span></h3>
          </div>
          <div className="ex-partner-list">
            {pendingIn.map(p => (
              <div key={p.id} className="ex-partner-row">
                <div>
                  <h4>{p.requesterStore.name}</h4>
                  <div className="ex-muted">
                    {p.requesterStore.storeCode} · {p.requesterStore.organization?.name}
                  </div>
                  {p.requestNote && <div className="ex-req-note">"{p.requestNote}"</div>}
                </div>
                <div className="ex-partner-actions">
                  <button className="p-btn p-btn-primary" onClick={() => accept(p.id)}>
                    <Check size={14} /> Accept
                  </button>
                  <button className="p-btn p-btn-ghost" onClick={() => reject(p.id)}>
                    <X size={14} /> Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Accepted partners */}
      <div className="p-card">
        <div className="p-card-head">
          <h3>Active Partners <span className="ex-pill">{accepted.length}</span></h3>
        </div>
        {accepted.length === 0 ? (
          <div className="p-empty">No active trading partners. Look up a store code above to start one.</div>
        ) : (
          <div className="ex-partner-list">
            {accepted.map(p => (
              <div key={p.id} className="ex-partner-row">
                <div>
                  <h4>{p.partner.name}</h4>
                  <div className="ex-muted">
                    {p.partner.storeCode} · {p.partner.organization?.name}
                  </div>
                  <div className="ex-muted ex-muted--small">
                    Partnered since {fmtDate(p.respondedAt)}
                  </div>
                </div>
                <div className="ex-partner-actions">
                  {can('exchange.manage') && (
                    <button className="p-btn p-btn-ghost ex-danger-btn" onClick={() => revoke(p.id)}>
                      End Partnership
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Outgoing pending */}
      {outgoing.length > 0 && (
        <div className="p-card">
          <div className="p-card-head">
            <h3>Awaiting Response <span className="ex-pill">{outgoing.length}</span></h3>
          </div>
          <div className="ex-partner-list">
            {outgoing.map(p => (
              <div key={p.id} className="ex-partner-row">
                <div>
                  <h4>{p.partner.name}</h4>
                  <div className="ex-muted">
                    {p.partner.storeCode} · Sent {fmtDate(p.requestedAt)}
                  </div>
                </div>
                <div className="ex-partner-actions">
                  <button className="p-btn p-btn-ghost" onClick={() => revoke(p.id)}>Cancel Request</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SETTINGS TAB — store code claim/update
// ═══════════════════════════════════════════════════════════════

function SettingsTab({ myCode, onSaved, can }) {
  const [draft, setDraft] = useState(myCode?.storeCode || '');
  const [check, setCheck] = useState(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef(null);

  useEffect(() => {
    if (!draft || draft === myCode?.storeCode) { setCheck(null); return; }
    clearTimeout(debounceRef.current);
    setChecking(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const r = await checkStoreCode(draft);
        setCheck(r);
      } catch (err) {
        setCheck({ available: false, reason: err.message });
      } finally {
        setChecking(false);
      }
    }, 400);
  }, [draft, myCode?.storeCode]);

  const save = async () => {
    setSaving(true);
    try {
      await setMyStoreCode(draft);
      toast.success('Store code updated.');
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.error || err.message);
    } finally {
      setSaving(false);
    }
  };

  const copyCode = () => {
    if (!myCode?.storeCode) return;
    navigator.clipboard.writeText(myCode.storeCode);
    toast.success('Code copied');
  };

  const isLocked = !!myCode?.locked;
  const isDirty = draft !== (myCode?.storeCode || '');

  return (
    <div className="ex-settings">
      <div className="p-card">
        <div className="p-card-head">
          <h3>My Store Code</h3>
        </div>

        {myCode?.storeCode ? (
          <div className="ex-current-code">
            <div className="ex-current-code-box">
              <span className="ex-muted ex-muted--small">Share with trading partners:</span>
              <div className="ex-code-display">
                <span>{myCode.storeCode}</span>
                <button className="p-btn p-btn-ghost" onClick={copyCode}><Copy size={14} /></button>
              </div>
            </div>
            {isLocked && (
              <div className="ex-locked-note">
                <AlertTriangle size={14} /> Locked — first partnership or PO has been created. Contact support to change.
              </div>
            )}
          </div>
        ) : (
          <p className="ex-muted">You haven't claimed a store code yet. Pick one unique to your store so partners can find you.</p>
        )}

        {!isLocked && can('exchange.manage') && (
          <div className="ex-claim">
            <label>{myCode?.storeCode ? 'Change code to:' : 'Claim your code:'}</label>
            <div className="ex-claim-row">
              <input
                value={draft}
                onChange={e => setDraft(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))}
                placeholder="e.g. MAIN-STREET-BROOKLYN"
                maxLength={24}
              />
              <button
                className="p-btn p-btn-primary"
                disabled={saving || checking || !check?.available || !isDirty}
                onClick={save}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
            {checking && <div className="ex-check">Checking…</div>}
            {check && !checking && check.available && (
              <div className="ex-check ex-check-ok"><Check size={13} /> {draft} is available</div>
            )}
            {check && !checking && !check.available && (
              <div className="ex-check ex-check-bad">
                <X size={13} /> {check.reason || 'Taken'}
                {check.suggestion && (
                  <button className="ex-link" onClick={() => setDraft(check.suggestion)}>
                    Try "{check.suggestion}"?
                  </button>
                )}
              </div>
            )}
            <div className="ex-muted ex-muted--small">
              3–24 characters · letters, numbers, and dashes · must start with a letter or number
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
