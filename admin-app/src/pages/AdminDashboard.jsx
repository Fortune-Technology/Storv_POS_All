import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users, Building2, Ticket, Clock, AlertCircle, CheckCircle, Loader,
  TrendingUp, PieChart as PieIcon, UserCheck, Store, FileText, LayoutDashboard,
} from 'lucide-react';
import {
  AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';

import { getAdminDashboard } from '../services/api';
import '../styles/admin.css';
import './AdminDashboard.css';

const ROLE_COLORS = {
  superadmin: '#ef4444',
  admin:      '#f59e0b',
  owner:      '#3d56b5',
  manager:    '#3b82f6',
  cashier:    '#8b5cf6',
  staff:      '#6b7280',
};

const PLAN_COLORS = {
  enterprise: '#f59e0b',
  pro:        '#8b5cf6',
  starter:    '#3b82f6',
  trial:      '#6b7280',
  none:       '#94a3b8',
};

// Recharts Tooltip contentStyle requires inline style objects — these are not JSX inline styles
const tooltipStyle = {
  background: '#ffffff',
  border: '1px solid #e2e8f0',
  borderRadius: '8px',
  fontSize: '0.78rem',
  color: '#1e293b',
  boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
};

const StatCard = ({ icon, label, value, color, onClick }) => (
  <div
    className={`admin-stat-card${onClick ? ' clickable' : ''}`}
    onClick={onClick}
  >
    <div className="admin-stat-header">
      <div className="admin-stat-icon" style={{ background: `${color}15`, color }}>
        {icon}
      </div>
      <span className="admin-stat-label">{label}</span>
    </div>
    <div className="admin-stat-value">{value ?? '-'}</div>
  </div>
);

const fmtDate = (iso) => {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const fmtShortDate = (dateStr) => {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const AdminDashboard = () => {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    getAdminDashboard()
      .then(r => setStats(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const roleData = stats?.usersByRole
    ? Object.entries(stats.usersByRole).map(([name, value]) => ({ name, value }))
    : [];

  const planData = stats?.orgsByPlan
    ? Object.entries(stats.orgsByPlan).map(([name, value]) => ({ name, value }))
    : [];

  return (
    <>
        <div className="admin-header">
          <div className="admin-header-left">
            <div className="admin-header-icon"><LayoutDashboard size={22} /></div>
            <div>
              <h1>Admin Dashboard</h1>
              <p>System overview and quick actions</p>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="admin-loading">
            <Loader className="animate-spin" size={24} />
          </div>
        ) : (
          <>
            {/* ── Stat Cards ──────────────────────────────── */}
            <div className="admin-stats-grid">
              <StatCard icon={<Users size={18} />}        label="Total Users"      value={stats?.totalUsers}   color="#3b82f6" onClick={() => navigate('/users')} />
              <StatCard icon={<Clock size={18} />}         label="Pending Approval" value={stats?.pendingUsers} color="#f59e0b" onClick={() => navigate('/users?status=pending')} />
              <StatCard icon={<Building2 size={18} />}     label="Organizations"    value={stats?.totalOrgs}    color="var(--accent-primary)" onClick={() => navigate('/organizations')} />
              <StatCard icon={<CheckCircle size={18} />}   label="Active Orgs"      value={stats?.activeOrgs}   color="#10b981" />
              <StatCard icon={<Ticket size={18} />}        label="Open Tickets"     value={stats?.openTickets}  color="#ef4444" onClick={() => navigate('/tickets')} />
            </div>

            {/* ── Charts Row ──────────────────────────────── */}
            <div className="admin-dash-grid">
              {/* 7-day signups area chart */}
              <div className="admin-dash-card">
                <div className="admin-dash-card-title">
                  <TrendingUp size={16} />
                  Signups — Last 7 Days
                </div>
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={stats?.chartData || []}>
                    <defs>
                      <linearGradient id="colorUsers" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} />
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="colorOrgs" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.15} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
                    <XAxis dataKey="date" tickFormatter={fmtShortDate} fontSize={11} stroke="#94a3b8" tickLine={false} axisLine={false} />
                    <YAxis fontSize={11} stroke="#94a3b8" tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip contentStyle={tooltipStyle} labelFormatter={fmtShortDate} />
                    <Area type="monotone" dataKey="users" stroke="#3b82f6" strokeWidth={2} fill="url(#colorUsers)" name="Users" />
                    <Area type="monotone" dataKey="orgs" stroke="#10b981" strokeWidth={2} fill="url(#colorOrgs)" name="Organizations" />
                  </AreaChart>
                </ResponsiveContainer>
                <div className="admin-chart-legend">
                  <span className="admin-chart-legend-item"><span className="admin-chart-legend-dot" style={{ background: '#3b82f6' }} /> Users</span>
                  <span className="admin-chart-legend-item"><span className="admin-chart-legend-dot" style={{ background: '#10b981' }} /> Organizations</span>
                </div>
              </div>

              {/* Role distribution pie */}
              <div className="admin-dash-card">
                <div className="admin-dash-card-title">
                  <PieIcon size={16} />
                  Users by Role
                </div>
                {roleData.length > 0 ? (
                  <>
                    <ResponsiveContainer width="100%" height={180}>
                      <PieChart>
                        <Pie data={roleData} cx="50%" cy="50%" innerRadius={45} outerRadius={75} dataKey="value" paddingAngle={2}>
                          {roleData.map((entry) => (
                            <Cell key={entry.name} fill={ROLE_COLORS[entry.name] || '#94a3b8'} />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={tooltipStyle} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="admin-chart-legend">
                      {roleData.map((r) => (
                        <span key={r.name} className="admin-chart-legend-item">
                          <span className="admin-chart-legend-dot" style={{ background: ROLE_COLORS[r.name] || '#94a3b8' }} />
                          {r.name} ({r.value})
                        </span>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="adsh-empty">No data</div>
                )}
              </div>
            </div>

            {/* ── Recent Users + Recent Orgs ───────────────── */}
            <div className="admin-dash-grid-half">
              <div className="admin-dash-card">
                <div className="admin-dash-card-title">
                  <UserCheck size={16} />
                  Recent Users
                </div>
                <table className="admin-dash-mini-table">
                  <thead>
                    <tr><th>Name</th><th>Role</th><th>Status</th><th>Joined</th></tr>
                  </thead>
                  <tbody>
                    {(stats?.recentUsers || []).map(u => (
                      <tr key={u.id}>
                        <td className="primary">{u.name || u.email}</td>
                        <td><span className={`admin-badge sm ${u.role}`}>{u.role}</span></td>
                        <td><span className={`admin-badge sm ${u.status}`}>{u.status}</span></td>
                        <td>{fmtDate(u.createdAt)}</td>
                      </tr>
                    ))}
                    {(!stats?.recentUsers || stats.recentUsers.length === 0) && (
                      <tr><td colSpan={4} className="adsh-empty">No users yet</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="admin-dash-card">
                <div className="admin-dash-card-title">
                  <Store size={16} />
                  Recent Organizations
                </div>
                <table className="admin-dash-mini-table">
                  <thead>
                    <tr><th>Name</th><th>Plan</th><th>Users</th><th>Stores</th><th>Created</th></tr>
                  </thead>
                  <tbody>
                    {(stats?.recentOrgs || []).map(o => (
                      <tr key={o.id}>
                        <td className="primary">{o.name}</td>
                        <td><span className={`admin-badge sm ${o.plan || 'trial'}`}>{o.plan || 'trial'}</span></td>
                        <td>{o.userCount ?? 0}</td>
                        <td>{o.storeCount ?? 0}</td>
                        <td>{fmtDate(o.createdAt)}</td>
                      </tr>
                    ))}
                    {(!stats?.recentOrgs || stats.recentOrgs.length === 0) && (
                      <tr><td colSpan={5} className="adsh-empty">No organizations yet</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* ── Recent Tickets ────────────────────────────── */}
            {stats?.recentTickets && stats.recentTickets.length > 0 && (
              <div className="admin-dash-card">
                <div className="admin-dash-card-title">
                  <FileText size={16} />
                  Recent Support Tickets
                </div>
                <table className="admin-dash-mini-table">
                  <thead>
                    <tr><th>Subject</th><th>Status</th><th>Priority</th><th>Created</th></tr>
                  </thead>
                  <tbody>
                    {stats.recentTickets.map(t => (
                      <tr key={t.id} className="adsh-ticket-row" onClick={() => navigate('/tickets')}>
                        <td className="primary">{t.subject}</td>
                        <td><span className={`admin-badge sm ${t.status}`}>{t.status?.replace('_', ' ')}</span></td>
                        <td><span className={`admin-badge sm ${t.priority || 'normal'}`}>{t.priority || 'normal'}</span></td>
                        <td>{fmtDate(t.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* ── Pending alert ─────────────────────────────── */}
            {stats?.pendingUsers > 0 && (
              <div className="admin-alert warning" onClick={() => navigate('/users?status=pending')}>
                <AlertCircle size={18} />
                <span>
                  {stats.pendingUsers} user{stats.pendingUsers > 1 ? 's' : ''} waiting for approval
                </span>
              </div>
            )}
          </>
        )}
    </>
  );
};

export default AdminDashboard;
