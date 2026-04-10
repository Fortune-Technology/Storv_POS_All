import React, { useState, useEffect, useCallback } from 'react';
import { Activity, Wifi, WifiOff, RefreshCw, Search, Loader, Monitor } from 'lucide-react';
import { toast } from 'react-toastify';

import { getAdminPaymentTerminals, pingAdminTerminal } from '../services/api';
import '../styles/admin.css';
import './AdminPaymentTerminals.css';

const STATUS_COLORS = {
  active:   { bg: 'rgba(34,197,94,.15)',  border: 'rgba(34,197,94,.4)',  text: '#22c55e' },
  inactive: { bg: 'rgba(239,68,68,.13)',  border: 'rgba(239,68,68,.35)', text: '#ef4444' },
  unknown:  { bg: 'rgba(148,163,184,.13)',border: 'rgba(148,163,184,.3)',text: '#94a3b8' },
};

function StatusBadge({ status }) {
  const c = STATUS_COLORS[status] || STATUS_COLORS.unknown;
  return (
    <span className="apt-status-badge" style={{ background: c.bg, border: `1px solid ${c.border}`, color: c.text }}>
      <span className="apt-status-dot" style={{ background: c.text }} />
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

  const active   = terminals.filter(t => t.status === 'active').length;
  const inactive = terminals.filter(t => t.status === 'inactive').length;
  const unknown  = terminals.filter(t => t.status === 'unknown').length;
  const totalPages = Math.ceil(total / limit);

  const pingClass = (ms) => ms < 300 ? 'apt-ping-fast' : ms < 800 ? 'apt-ping-mid' : 'apt-ping-slow';

  return (
    <>
        <div className="admin-page-header">
          <div className="admin-header-left">
            <div className="admin-header-icon"><Monitor size={22} /></div>
            <div>
              <h1 className="admin-page-title">Payment Terminals</h1>
              <p className="admin-page-subtitle">Cross-org terminal health monitor</p>
            </div>
          </div>
          <button className="admin-btn admin-btn-secondary" onClick={fetch} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh
          </button>
        </div>

        {/* ── Stat cards ──────────────────────────────────────────────── */}
        <div className="apt-stat-grid">
          {[
            { label: 'Total',    value: terminals.length, color: 'var(--text-primary)',   bg: 'var(--bg-card)' },
            { label: 'Active',   value: active,   color: '#22c55e', bg: 'rgba(34,197,94,.07)' },
            { label: 'Inactive', value: inactive, color: '#ef4444', bg: 'rgba(239,68,68,.07)' },
            { label: 'Unknown',  value: unknown,  color: '#94a3b8', bg: 'rgba(148,163,184,.07)' },
          ].map(c => (
            <div key={c.label} className="apt-stat-card" style={{ background: c.bg }}>
              <span className="apt-stat-label">{c.label}</span>
              <span className="apt-stat-value" style={{ color: c.color }}>{c.value}</span>
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
                <tr><td colSpan={9} className="apt-empty">
                  <Loader size={18} className="spin" /> Loading...
                </td></tr>
              ) : terminals.length === 0 ? (
                <tr><td colSpan={9} className="apt-empty">
                  <Monitor size={28} className="apt-empty-icon" />
                  No terminals found
                </td></tr>
              ) : terminals.map(t => (
                <tr key={t.id}>
                  <td>
                    <div className="apt-org-name">{t.orgName || t.orgId.slice(0, 8)}</div>
                    <div className="apt-org-meta">
                      {t.merchant?.isLive ? '🟢 Live' : '🟡 UAT'} · {t.merchant?.site || '—'}
                    </div>
                  </td>
                  <td className="apt-cell-bold">{t.name || '—'}</td>
                  <td><code className="apt-code">{t.hsn}</code></td>
                  <td className="apt-cell-muted">{t.model || '—'}</td>
                  <td className="apt-cell-station">{t.station?.name || '—'}</td>
                  <td><StatusBadge status={t.status} /></td>
                  <td className="apt-cell-seen">{fmtDate(t.lastSeenAt)}</td>
                  <td>
                    {t.lastPingMs != null ? (
                      <span className={pingClass(t.lastPingMs)}>
                        {t.lastPingMs}ms
                      </span>
                    ) : <span className="apt-ping-none">—</span>}
                  </td>
                  <td>
                    <button
                      onClick={() => handlePing(t)}
                      disabled={pingingId === t.id}
                      className="apt-btn-ping"
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
            <span className="apt-page-info">Page {page} of {totalPages}</span>
            <button className="admin-btn admin-btn-secondary" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>Next →</button>
          </div>
        )}
    </>
  );
}
