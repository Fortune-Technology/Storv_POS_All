import React, { useState, useEffect, useCallback } from 'react';
import {
  Shield, Loader, Search, ChevronDown, ChevronUp, ChevronLeft, ChevronRight,
  Download, X, Info,
} from 'lucide-react';
import { toast } from 'react-toastify';

import { getAuditLogs, getTenantUsers } from '../services/api';
import SortableHeader from '../components/SortableHeader';
import { useTableSort } from '../hooks/useTableSort';
import { downloadCSV } from '../utils/exportUtils';
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
  create:          { label: 'Create',           cls: 'p-badge-green' },
  update:          { label: 'Update',           cls: 'p-badge-blue' },
  delete:          { label: 'Delete',           cls: 'p-badge-red' },
  void:            { label: 'Void',             cls: 'p-badge-red' },
  refund:          { label: 'Refund',           cls: 'p-badge-amber' },
  login:           { label: 'Login',            cls: 'p-badge-purple' },
  login_failed:    { label: 'Login Failed',     cls: 'p-badge-red' },
  login_blocked:   { label: 'Login Blocked',    cls: 'p-badge-red' },
  logout:          { label: 'Logout',           cls: 'p-badge-gray' },
  password_reset:  { label: 'Password Reset',   cls: 'p-badge-amber' },
  price_change:    { label: 'Price Change',     cls: 'p-badge-amber' },
  shift_open:      { label: 'Shift Open',       cls: 'p-badge-green' },
  shift_close:     { label: 'Shift Close',      cls: 'p-badge-gray' },
  settings_change: { label: 'Settings Change',  cls: 'p-badge-blue' },
};

const ENTITY_OPTS = [
  'product', 'transaction', 'employee', 'customer', 'department',
  'promotion', 'store', 'user', 'setting', 'payout',
  'role', 'user_roles', 'auth', 'shift', 'task', 'vendor', 'vendor_payment',
  'lottery', 'fuel', 'invoice', 'tax_rule', 'deposit_rule',
];

// Modules map to the first URL segment written by the autoAudit middleware.
const MODULE_OPTS = [
  'auth', 'catalog', 'customers', 'stores', 'users', 'roles',
  'pos-terminal', 'tasks', 'chat', 'lottery', 'fuel',
  'invoice', 'exchange', 'reports', 'sales', 'admin', 'ai-assistant',
];

const ACTION_OPTS = Object.keys(ACTION_META);

/* ── Detail Expander ────────────────────────────────────────────────────── */
// Formats value for display. null/undefined → "(empty)"; objects → short JSON.
function fmtValue(v) {
  if (v == null) return <em className="al-muted">(empty)</em>;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'object') return JSON.stringify(v);
  const s = String(v);
  return s.length > 120 ? s.substring(0, 117) + '…' : s;
}

const DetailsCell = ({ details }) => {
  const [open, setOpen] = useState(false);
  if (!details || (typeof details === 'object' && Object.keys(details).length === 0)) {
    return <span className="al-muted">--</span>;
  }

  // If the detail payload carries a structured `changes` object, render a
  // before/after diff table. Otherwise fall back to pretty-printed JSON.
  const hasChanges = typeof details === 'object' && details.changes && typeof details.changes === 'object';

  return (
    <div className="al-details-cell">
      <button className="al-details-toggle" onClick={() => setOpen(o => !o)}>
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        {open ? 'Hide' : 'View'}
      </button>

      {open && hasChanges && (
        <div className="al-diff-wrap">
          {details.name && (
            <div className="al-diff-heading"><Info size={11} /> {details.name}</div>
          )}
          <table className="al-diff-table">
            <thead>
              <tr><th>Field</th><th>Before</th><th>After</th></tr>
            </thead>
            <tbody>
              {Object.entries(details.changes).map(([k, v]) => {
                // Added/removed lists (e.g. permissions + roles diffs)
                if (v && typeof v === 'object' && (Array.isArray(v.added) || Array.isArray(v.removed))) {
                  return (
                    <tr key={k}>
                      <td className="al-diff-field">{k}</td>
                      <td colSpan={2}>
                        {v.removed?.length > 0 && (
                          <div><span className="al-diff-badge al-diff-badge--rem">Removed</span> {v.removed.join(', ')}</div>
                        )}
                        {v.added?.length > 0 && (
                          <div><span className="al-diff-badge al-diff-badge--add">Added</span> {v.added.join(', ')}</div>
                        )}
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={k}>
                    <td className="al-diff-field">{k}</td>
                    <td className="al-diff-before">{fmtValue(v?.before)}</td>
                    <td className="al-diff-after">{fmtValue(v?.after)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {open && !hasChanges && (
        <pre className="al-details-json">
          {typeof details === 'string' ? details : JSON.stringify(details, null, 2)}
        </pre>
      )}
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
  const [moduleFilter, setModuleFilter] = useState('');
  const [search, setSearch]         = useState('');

  const perPage = 25;

  const hasActiveFilters =
    dateFrom || dateTo || userFilter || entityFilter || actionFilter || moduleFilter || search.trim();

  const clearFilters = () => {
    setDateFrom(''); setDateTo(''); setUserFilter('');
    setEntityFilter(''); setActionFilter(''); setModuleFilter(''); setSearch('');
  };

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
      if (dateFrom)     params.from    = dateFrom;
      if (dateTo)       params.to      = dateTo;
      if (userFilter)   params.userId  = userFilter;
      if (entityFilter) params.entity  = entityFilter;
      if (actionFilter) params.action  = actionFilter;
      if (moduleFilter) params.module  = moduleFilter;
      if (search.trim()) params.search = search.trim();

      const data = await getAuditLogs(params);
      setLogs(Array.isArray(data) ? data : data.logs || data.entries || []);
      setTotal(data.total || data.count || (Array.isArray(data) ? data.length : 0));
    } catch { toast.error('Failed to load audit logs'); }
    finally { setLoading(false); }
  }, [page, dateFrom, dateTo, userFilter, entityFilter, actionFilter, moduleFilter, search]);

  useEffect(() => { loadLogs(); }, [loadLogs]);

  /* Reset page when filters change */
  useEffect(() => { setPage(1); }, [dateFrom, dateTo, userFilter, entityFilter, actionFilter, moduleFilter, search]);

  /* ── CSV export ─ pulls up to 5000 matching rows, applies filters ───── */
  const [exporting, setExporting] = useState(false);
  const exportCsv = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const params = { limit: 5000, page: 1 };
      if (dateFrom)     params.from    = dateFrom;
      if (dateTo)       params.to      = dateTo;
      if (userFilter)   params.userId  = userFilter;
      if (entityFilter) params.entity  = entityFilter;
      if (actionFilter) params.action  = actionFilter;
      if (moduleFilter) params.module  = moduleFilter;
      if (search.trim()) params.search = search.trim();
      const data = await getAuditLogs(params);
      const rows = Array.isArray(data) ? data : data.logs || [];
      const cols = [
        { key: 'createdAt',  label: 'Date / Time',  format: (v) => fmtDateTime(v) },
        { key: 'userName',   label: 'User' },
        { key: 'userRole',   label: 'Role' },
        { key: 'action',     label: 'Action' },
        { key: 'entity',     label: 'Entity' },
        { key: 'entityId',   label: 'Entity ID' },
        { key: 'source',     label: 'Source' },
        { key: 'ipAddress',  label: 'IP' },
        { key: 'details',    label: 'Details', format: (v) => v ? JSON.stringify(v) : '' },
      ];
      downloadCSV(rows, cols, `audit-log-${new Date().toISOString().slice(0, 10)}.csv`);
      toast.success(`Exported ${rows.length} entries`);
    } catch {
      toast.error('Export failed');
    } finally {
      setExporting(false);
    }
  };

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
        <div className="p-header-actions">
          {hasActiveFilters && (
            <button
              className="p-btn p-btn-sm p-btn-ghost"
              onClick={clearFilters}
              title="Clear all filters"
            >
              <X size={14} /> Clear
            </button>
          )}
          <button
            className="p-btn p-btn-sm p-btn-secondary"
            onClick={exportCsv}
            disabled={exporting}
            title="Export current view to CSV (up to 5000 rows)"
          >
            {exporting
              ? <><Loader size={14} className="p-spin" /> Exporting…</>
              : <><Download size={14} /> Export CSV</>}
          </button>
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
          <label className="al-filter-label">Module</label>
          <select className="p-select al-filter-input" value={moduleFilter} onChange={e => setModuleFilter(e.target.value)}>
            <option value="">All Modules</option>
            {MODULE_OPTS.map(m => <option key={m} value={m}>{m}</option>)}
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
