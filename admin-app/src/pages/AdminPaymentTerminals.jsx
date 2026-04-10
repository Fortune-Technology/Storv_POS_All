import React, { useState, useEffect, useCallback } from 'react';
import { Activity, Wifi, WifiOff, RefreshCw, Search, Loader, Monitor } from 'lucide-react';
import { toast } from 'react-toastify';
import AdminSidebar from '../components/AdminSidebar';
import { getAdminPaymentTerminals, pingAdminTerminal } from '../services/api';
import '../styles/admin.css';

const STATUS_COLORS = {
  active:   { bg: 'rgba(34,197,94,.15)',  border: 'rgba(34,197,94,.4)',  text: '#22c55e' },
  inactive: { bg: 'rgba(239,68,68,.13)',  border: 'rgba(239,68,68,.35)', text: '#ef4444' },
  unknown:  { bg: 'rgba(148,163,184,.13)',border: 'rgba(148,163,184,.3)',text: '#94a3b8' },
};

function StatusBadge({ status }) {
  const c = STATUS_COLORS[status] || STATUS_COLORS.unknown;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '2px 10px', borderRadius: 20,
      background: c.bg, border: `1px solid ${c.border}`,
      color: c.text, fontSize: '0.72rem', fontWeight: 700,
      textTransform: 'uppercase', letterSpacing: '0.04em',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: c.text, flexShrink: 0 }} />
      {status}
    </span>
  );
}

function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  return dt.toLocaleDateString() + ' ' + dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function AdminPaymentTerminals() {
  const [terminals, setTerminals] = useState([]);
  const [total, setTotal]         = useState(0);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');
  const [statusFilter, setStatus] = useState('');
  const [page, setPage]           = useState(1);
  const [pingingId, setPingingId] = useState(null);
  const limit = 25;

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit };
      if (statusFilter) params.status = statusFilter;
      const res = await getAdminPaymentTerminals(params);
      // Client-side search filter (name or HSN)
      const all = res.data || [];
      const filtered = search
        ? all.filter(t =>
            (t.name || '').toLowerCase().includes(search.toLowerCase()) ||
            (t.hsn  || '').toLowerCase().includes(search.toLowerCase()) ||
            (t.orgName || '').toLowerCase().includes(search.toLowerCase())
          )
        : all;
      setTerminals(filtered);
      setTotal(search ? filtered.length : (res.total || 0));
    } catch {
      toast.error('Failed to load terminals');
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, search]);

  useEffect(() => { fetch(); }, [fetch]);

  const handlePing = async (terminal) => {
    setPingingId(terminal.id);
    try {
      const result = await pingAdminTerminal(terminal.id);
      setTerminals(prev => prev.map(t =>
        t.id === terminal.id
          ? { ...t,
              status:     result.connected ? 'active'   : 'inactive',
              lastPingMs: result.latencyMs ?? null,
              lastSeenAt: result.connected ? new Date().toISOString() : t.lastSeenAt,
            }
          : t
      ));
      if (result.connected) {
        toast.success(`${terminal.name || terminal.hsn} — ${result.latencyMs}ms`);
      } else {
        toast.warn(`${terminal.name || terminal.hsn} — unreachable`);
      }
    } catch {
      toast.error('Ping failed');
    } finally {
      setPingingId(null);
    }
  };

  // Stats
  const active   = terminals.filter(t => t.status === 'active').length;
  const inactive = terminals.filter(t => t.status === 'inactive').length;
  const unknown  = terminals.filter(t => t.status === 'unknown').length;
  const totalPages = Math.ceil(total / limit);

  return (
    <div className="admin-layout">
      <AdminSidebar />
      <main className="admin-main">
        <div className="admin-page-header">
          <div>
            <h1 className="admin-page-title">Payment Terminals</h1>
            <p className="admin-page-subtitle">Cross-org terminal health monitor</p>
          </div>
          <button className="admin-btn admin-btn-secondary" onClick={fetch} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh
          </button>
        </div>

        {/* ── Stat cards ──────────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
          {[
            { label: 'Total',    value: terminals.length, color: 'var(--text-primary)',   bg: 'var(--bg-card)' },
            { label: 'Active',   value: active,   color: '#22c55e', bg: 'rgba(34,197,94,.07)' },
            { label: 'Inactive', value: inactive, color: '#ef4444', bg: 'rgba(239,68,68,.07)' },
            { label: 'Unknown',  value: unknown,  color: '#94a3b8', bg: 'rgba(148,163,184,.07)' },
          ].map(c => (
            <div key={c.label} style={{
              background: c.bg, border: '1px solid var(--border)',
              borderRadius: 10, padding: '14px 18px',
              display: 'flex', flexDirection: 'column', gap: 4,
            }}>
              <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{c.label}</span>
              <span style={{ fontSize: '1.6rem', fontWeight: 800, color: c.color, lineHeight: 1 }}>{c.value}</span>
            </div>
          ))}
        </div>

        {/* ── Filters ─────────────────────────────────────────────────── */}
        <div className="admin-filters">
          <div className="admin-search-wrapper">
            <Search size={14} className="admin-search-icon" />
            <input
              className="admin-search"
              placeholder="Search by name, HSN, or org..."
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
          <select
            className="admin-select"
            value={statusFilter}
            onChange={e => { setStatus(e.target.value); setPage(1); }}
          >
            <option value="">All Statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="unknown">Unknown</option>
          </select>
        </div>

        {/* ── Table ───────────────────────────────────────────────────── */}
        <div className="admin-table-wrapper">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Org</th>
                <th>Terminal</th>
                <th>HSN</th>
                <th>Model</th>
                <th>Station</th>
                <th>Status</th>
                <th>Last Seen</th>
                <th>Ping</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                  <Loader size={18} className="spin" style={{ marginRight: 8 }} />Loading...
                </td></tr>
              ) : terminals.length === 0 ? (
                <tr><td colSpan={9} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                  <Monitor size={28} style={{ display: 'block', margin: '0 auto 8px', opacity: 0.3 }} />
                  No terminals found
                </td></tr>
              ) : terminals.map(t => (
                <tr key={t.id}>
                  <td>
                    <div style={{ fontWeight: 600, fontSize: '0.82rem' }}>{t.orgName || t.orgId.slice(0, 8)}</div>
                    <div style={{ fontSize: '0.71rem', color: 'var(--text-muted)' }}>
                      {t.merchant?.isLive ? '🟢 Live' : '🟡 UAT'} · {t.merchant?.site || '—'}
                    </div>
                  </td>
                  <td style={{ fontWeight: 600 }}>{t.name || '—'}</td>
                  <td><code style={{ fontSize: '0.78rem', background: 'var(--bg-input)', padding: '2px 6px', borderRadius: 4 }}>{t.hsn}</code></td>
                  <td style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>{t.model || '—'}</td>
                  <td style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{t.station?.name || '—'}</td>
                  <td><StatusBadge status={t.status} /></td>
                  <td style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{fmtDate(t.lastSeenAt)}</td>
                  <td>
                    {t.lastPingMs != null ? (
                      <span style={{
                        fontSize: '0.78rem', fontWeight: 700,
                        color: t.lastPingMs < 300 ? '#22c55e' : t.lastPingMs < 800 ? '#f59e0b' : '#ef4444',
                      }}>
                        {t.lastPingMs}ms
                      </span>
                    ) : <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>—</span>}
                  </td>
                  <td>
                    <button
                      onClick={() => handlePing(t)}
                      disabled={pingingId === t.id}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        padding: '4px 12px', borderRadius: 6, fontSize: '0.78rem', fontWeight: 600,
                        background: 'var(--bg-input)', border: '1px solid var(--border)',
                        color: 'var(--text-secondary)', cursor: pingingId === t.id ? 'not-allowed' : 'pointer',
                        opacity: pingingId === t.id ? 0.6 : 1,
                      }}
                    >
                      {pingingId === t.id
                        ? <Loader size={12} className="spin" />
                        : (t.status === 'active' ? <Wifi size={12} /> : <WifiOff size={12} />)
                      }
                      Ping
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── Pagination ──────────────────────────────────────────────── */}
        {totalPages > 1 && (
          <div className="admin-pagination">
            <button className="admin-btn admin-btn-secondary" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>← Prev</button>
            <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Page {page} of {totalPages}</span>
            <button className="admin-btn admin-btn-secondary" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>Next →</button>
          </div>
        )}
      </main>
    </div>
  );
}
