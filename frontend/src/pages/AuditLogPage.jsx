import React, { useState, useEffect, useCallback } from 'react';
import {
  Shield, Loader, Search, ChevronDown, ChevronUp, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { toast } from 'react-toastify';

import { getAuditLogs, getTenantUsers } from '../services/api';
import SortableHeader from '../components/SortableHeader';
import { useTableSort } from '../hooks/useTableSort';
import '../styles/portal.css';
import './AuditLogPage.css';

/* ── Helpers ────────────────────────────────────────────────────────────── */
function fmtDateTime(d) {
  if (!d) return '--';
  return new Date(d).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

const ACTION_META = {
  create:       { label: 'Create',       cls: 'p-badge-green' },
  update:       { label: 'Update',       cls: 'p-badge-blue' },
  delete:       { label: 'Delete',       cls: 'p-badge-red' },
  void:         { label: 'Void',         cls: 'p-badge-red' },
  login:        { label: 'Login',        cls: 'p-badge-purple' },
  price_change: { label: 'Price Change', cls: 'p-badge-amber' },
};

const ENTITY_OPTS = [
  'product', 'transaction', 'employee', 'customer', 'department',
  'promotion', 'store', 'user', 'setting', 'payout',
];

const ACTION_OPTS = Object.keys(ACTION_META);

/* ── Detail Expander ────────────────────────────────────────────────────── */
const DetailsCell = ({ details }) => {
  const [open, setOpen] = useState(false);
  if (!details || (typeof details === 'object' && Object.keys(details).length === 0)) {
    return <span className="al-muted">--</span>;
  }
  const str = typeof details === 'string' ? details : JSON.stringify(details, null, 2);
  return (
    <div className="al-details-cell">
      <button className="al-details-toggle" onClick={() => setOpen(o => !o)}>
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        {open ? 'Hide' : 'View'}
      </button>
      {open && <pre className="al-details-json">{str}</pre>}
    </div>
  );
};

/* ── Main Page ──────────────────────────────────────────────────────────── */
const AuditLogPage = () => {
  const [logs, setLogs]     = useState([]);
  // Session 39 Round 3 — column sort (default: newest first)
  // `sort` defined after `logs` so it captures updates on each render.
  const [total, setTotal]   = useState(0);
  const [page, setPage]     = useState(1);
  const [loading, setLoading] = useState(true);
  const [users, setUsers]   = useState([]);

  /* Filters */
  const [dateFrom, setDateFrom]     = useState('');
  const [dateTo, setDateTo]         = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [entityFilter, setEntityFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [search, setSearch]         = useState('');

  const perPage = 25;

  /* ── Load users for filter dropdown ─────────────────────────────────── */
  useEffect(() => {
    (async () => {
      try {
        const data = await getTenantUsers();
        setUsers(Array.isArray(data) ? data : data.users || []);
      } catch { /* silent */ }
    })();
  }, []);

  /* ── Load logs ──────────────────────────────────────────────────────── */
  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: perPage };
      if (dateFrom)     params.from   = dateFrom;
      if (dateTo)       params.to     = dateTo;
      if (userFilter)   params.userId = userFilter;
      if (entityFilter) params.entity = entityFilter;
      if (actionFilter) params.action = actionFilter;
      if (search.trim()) params.search = search.trim();

      const data = await getAuditLogs(params);
      setLogs(Array.isArray(data) ? data : data.logs || data.entries || []);
      setTotal(data.total || data.count || (Array.isArray(data) ? data.length : 0));
    } catch { toast.error('Failed to load audit logs'); }
    finally { setLoading(false); }
  }, [page, dateFrom, dateTo, userFilter, entityFilter, actionFilter, search]);

  useEffect(() => { loadLogs(); }, [loadLogs]);

  /* Reset page when filters change */
  useEffect(() => { setPage(1); }, [dateFrom, dateTo, userFilter, entityFilter, actionFilter, search]);

  const totalPages = Math.max(1, Math.ceil(total / perPage));

  /* Session 39 Round 3 — column sort */
  const logSort = useTableSort(logs, {
    initial: 'date',
    initialDir: 'desc',
    accessors: {
      date:     (l) => new Date(l.createdAt || l.at),
      userName: (l) => l.userName || l.actorName || '',
      userRole: (l) => l.userRole || l.actorRole || '',
      action:   (l) => l.action || '',
      entity:   (l) => l.entity || l.entityType || '',
      entityId: (l) => l.entityId || '',
      source:   (l) => l.source || '',
      ip:       (l) => l.ip || l.ipAddress || '',
    },
  });

  /* ── Render ─────────────────────────────────────────────────────────── */
  return (
    <div className="p-page">
      {/* Header */}
      <div className="p-header">
        <div className="p-header-left">
          <div className="p-header-icon"><Shield size={22} /></div>
          <div>
            <h1 className="p-title">Audit Log</h1>
            <p className="p-subtitle">All changes are permanently recorded</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="al-filter-bar">
        <div className="al-filter-group">
          <label className="al-filter-label">From</label>
          <input className="p-input al-filter-input" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
        </div>
        <div className="al-filter-group">
          <label className="al-filter-label">To</label>
          <input className="p-input al-filter-input" type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
        </div>
        <div className="al-filter-group">
          <label className="al-filter-label">User</label>
          <select className="p-select al-filter-input" value={userFilter} onChange={e => setUserFilter(e.target.value)}>
            <option value="">All Users</option>
            {users.map(u => (
              <option key={u.id || u._id} value={u.id || u._id}>{u.name || u.email}</option>
            ))}
          </select>
        </div>
        <div className="al-filter-group">
          <label className="al-filter-label">Entity</label>
          <select className="p-select al-filter-input" value={entityFilter} onChange={e => setEntityFilter(e.target.value)}>
            <option value="">All Entities</option>
            {ENTITY_OPTS.map(e => <option key={e} value={e}>{e.charAt(0).toUpperCase() + e.slice(1)}</option>)}
          </select>
        </div>
        <div className="al-filter-group">
          <label className="al-filter-label">Action</label>
          <select className="p-select al-filter-input" value={actionFilter} onChange={e => setActionFilter(e.target.value)}>
            <option value="">All Actions</option>
            {ACTION_OPTS.map(a => <option key={a} value={a}>{ACTION_META[a].label}</option>)}
          </select>
        </div>
        <div className="al-filter-group al-filter-search">
          <label className="al-filter-label">Search</label>
          <div className="al-search-wrap">
            <Search size={13} className="al-search-icon" />
            <input
              className="p-input al-filter-input al-search-input"
              placeholder="Search logs..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="p-loading"><Loader size={14} className="p-spin" /> Loading audit logs...</div>
      ) : logs.length === 0 ? (
        <div className="p-empty">
          <Shield size={36} />
          No audit log entries found matching your filters.
        </div>
      ) : (
        <>
          <div className="p-card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="p-table-wrap">
              <table className="p-table">
                <thead>
                  <tr>
                    <SortableHeader label="Date / Time" sortKey="date"     sort={logSort} />
                    <SortableHeader label="User"        sortKey="userName" sort={logSort} />
                    <SortableHeader label="Role"        sortKey="userRole" sort={logSort} />
                    <SortableHeader label="Action"      sortKey="action"   sort={logSort} />
                    <SortableHeader label="Entity"      sortKey="entity"   sort={logSort} />
                    <SortableHeader label="Entity ID"   sortKey="entityId" sort={logSort} />
                    <SortableHeader label="Details"     sortable={false} />
                    <SortableHeader label="Source"      sortKey="source"   sort={logSort} />
                    <SortableHeader label="IP"          sortKey="ip"       sort={logSort} />
                  </tr>
                </thead>
                <tbody>
                  {logSort.sorted.map((log, i) => {
                    const action = ACTION_META[log.action] || { label: log.action, cls: 'p-badge-gray' };
                    return (
                      <tr key={log.id || log._id || i}>
                        <td className="p-td-strong" style={{ whiteSpace: 'nowrap' }}>
                          {fmtDateTime(log.createdAt || log.created_at || log.timestamp)}
                        </td>
                        <td>{log.userName || log.user_name || log.userEmail || log.user_email || '--'}</td>
                        <td>
                          {log.userRole || log.user_role
                            ? <span className="p-badge p-badge-purple">{log.userRole || log.user_role}</span>
                            : '--'}
                        </td>
                        <td><span className={`p-badge ${action.cls}`}>{action.label}</span></td>
                        <td>{log.entity || log.entityType || log.entity_type || '--'}</td>
                        <td className="al-mono">{log.entityId || log.entity_id || '--'}</td>
                        <td><DetailsCell details={log.details || log.changes || log.metadata} /></td>
                        <td className="al-muted">{log.source || '--'}</td>
                        <td className="al-mono al-muted">{log.ip || log.ipAddress || log.ip_address || '--'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination */}
          <div className="al-pagination">
            <span className="al-page-info">
              Page {page} of {totalPages} ({total} entries)
            </span>
            <div className="al-page-btns">
              <button
                className="p-btn p-btn-sm p-btn-ghost"
                disabled={page <= 1}
                onClick={() => setPage(p => p - 1)}
              >
                <ChevronLeft size={14} /> Prev
              </button>
              <button
                className="p-btn p-btn-sm p-btn-ghost"
                disabled={page >= totalPages}
                onClick={() => setPage(p => p + 1)}
              >
                Next <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default AuditLogPage;
