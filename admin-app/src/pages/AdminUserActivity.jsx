import React, { useState, useEffect } from 'react';
import { Loader, Activity } from 'lucide-react';
import { PieChart, Pie, Cell, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

import { getAdminUserActivity } from '../services/api';
import { toast } from 'react-toastify';
import '../styles/admin.css';
import './AdminUserActivity.css';

const ROLE_COLORS = ['#3b82f6', 'var(--accent-primary)', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4'];
const STATUS_COLORS = { active: '#10b981', pending: '#f59e0b', suspended: '#ef4444' };

const ChartCard = ({ title, children }) => (
  <div className="admin-chart-card">
    <h2 className="admin-chart-title">{title}</h2>
    {children}
  </div>
);

const PieLegend = ({ data, colors }) => (
  <div className="admin-chart-legend">
    {data.map((entry, i) => (
      <div key={entry.role || entry.status || i} className="admin-chart-legend-item">
        <div className="admin-chart-legend-dot" style={{ background: typeof colors === 'function' ? colors(entry, i) : colors[i % colors.length] }} />
        {(entry.role || entry.status || 'Unknown')} ({entry.count})
      </div>
    ))}
  </div>
);

const tooltipStyle = { background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', color: '#1e293b' };

const AdminUserActivity = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getAdminUserActivity()
      .then(r => setData(r.data))
      .catch(() => toast.error('Failed to load user activity'))
      .finally(() => setLoading(false));
  }, []);

  const roleData = (data?.roleDistribution || []).map(r => ({ ...r, name: r.role, value: r.count }));
  const statusData = (data?.statusDistribution || []).map(s => ({ ...s, name: s.status, value: s.count }));

  return (
    <>
        <div className="admin-header">
          <div className="admin-header-left">
            <div className="admin-header-icon"><Activity size={22} /></div>
            <div>
              <h1>User Activity</h1>
              <p>User distribution, signups, and recent activity</p>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="admin-loading">
            <Loader className="animate-spin" size={24} />
          </div>
        ) : (
          <>
            {/* Charts Row */}
            <div className="admin-charts-row">
              {/* Role Distribution */}
              <ChartCard title="Role Distribution">
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={roleData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} innerRadius={40} paddingAngle={3}>
                      {roleData.map((_, i) => <Cell key={i} fill={ROLE_COLORS[i % ROLE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} />
                  </PieChart>
                </ResponsiveContainer>
                <PieLegend data={data?.roleDistribution || []} colors={ROLE_COLORS} />
              </ChartCard>

              {/* Status Distribution */}
              <ChartCard title="Status Distribution">
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={statusData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} innerRadius={40} paddingAngle={3}>
                      {statusData.map((entry, i) => <Cell key={i} fill={STATUS_COLORS[entry.name] || '#6b7280'} />)}
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} />
                  </PieChart>
                </ResponsiveContainer>
                <PieLegend data={data?.statusDistribution || []} colors={(entry) => STATUS_COLORS[entry.status] || '#6b7280'} />
              </ChartCard>

              {/* Weekly Signups */}
              <ChartCard title="Weekly Signups">
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={data?.weeklySignups || []}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
                    <XAxis dataKey="week" tick={{ fill: '#64748b', fontSize: 11 }} stroke="rgba(0,0,0,0.06)" />
                    <YAxis tick={{ fill: '#64748b', fontSize: 11 }} stroke="rgba(0,0,0,0.06)" allowDecimals={false} />
                    <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#64748b' }} />
                    <Line type="monotone" dataKey="count" stroke="var(--accent-primary)" strokeWidth={2} dot={{ fill: 'var(--accent-primary)', r: 3 }} name="Signups" />
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>

            {/* Recent Signups Table */}
            <div className="admin-card-wrap">
              <div className="admin-section-header">
                <h2>Recent Signups</h2>
              </div>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      {['Name', 'Email', 'Role', 'Status', 'Organization', 'Joined'].map(h => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.recentSignups || []).length === 0 ? (
                      <tr>
                        <td colSpan={6} className="admin-empty">
                          No recent signups
                        </td>
                      </tr>
                    ) : (data?.recentSignups || []).map(user => (
                      <tr key={user.id}>
                        <td className="primary">{user.name}</td>
                        <td>{user.email}</td>
                        <td>
                          <span className={`admin-badge sm ${user.role}`}>{user.role}</span>
                        </td>
                        <td>
                          <span className={`admin-badge ${user.status}`}>{user.status}</span>
                        </td>
                        <td>{user.organization?.name || '-'}</td>
                        <td className="muted">
                          {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
    </>
  );
};

export default AdminUserActivity;
