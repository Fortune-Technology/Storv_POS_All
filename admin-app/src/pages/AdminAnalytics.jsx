import React, { useState, useEffect } from 'react';
import { Users, Building2, Store, Receipt, Loader } from 'lucide-react';
import { LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import AdminSidebar from '../components/AdminSidebar';
import { getAdminAnalyticsDashboard } from '../services/api';
import { toast } from 'react-toastify';
import '../styles/admin.css';

const StatCard = ({ icon, label, value, color }) => (
  <div className="admin-stat-card">
    <div className="admin-stat-header">
      <div className="admin-stat-icon" style={{ background: `${color}15`, color }}>
        {icon}
      </div>
      <span className="admin-stat-label">{label}</span>
    </div>
    <div className="admin-stat-value">{value ?? '-'}</div>
  </div>
);

const TICKET_COLORS = { open: '#3b82f6', in_progress: '#f59e0b', resolved: '#10b981', closed: '#6b7280' };
const TICKET_LABELS = { open: 'Open', in_progress: 'In Progress', resolved: 'Resolved', closed: 'Closed' };

const AdminAnalytics = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getAdminAnalyticsDashboard()
      .then(r => setData(r.data))
      .catch(() => toast.error('Failed to load analytics'))
      .finally(() => setLoading(false));
  }, []);

  const ticketData = data?.ticketStats
    ? Object.entries(data.ticketStats).map(([key, value]) => ({ name: TICKET_LABELS[key] || key, value, color: TICKET_COLORS[key] || '#6b7280' }))
    : [];

  return (
    <div className="layout-container">
      <AdminSidebar />
      <main className="main-content admin-page">
        <div className="admin-header">
          <div className="admin-header-left">
            <h1>System Analytics</h1>
            <p>Platform-wide metrics and trends</p>
          </div>
        </div>

        {loading ? (
          <div className="admin-loading">
            <Loader className="animate-spin" size={24} />
          </div>
        ) : (
          <>
            {/* Stat Cards */}
            <div className="admin-stats-grid">
              <StatCard icon={<Users size={18} />} label="Total Users" value={data?.totalUsers} color="#3b82f6" />
              <StatCard icon={<Building2 size={18} />} label="Total Organizations" value={data?.totalOrgs} color="var(--accent-primary)" />
              <StatCard icon={<Store size={18} />} label="Total Stores" value={data?.totalStores} color="#f59e0b" />
              <StatCard icon={<Receipt size={18} />} label="Total Transactions" value={data?.totalTransactions?.toLocaleString()} color="#8b5cf6" />
            </div>

            {/* Charts Row */}
            <div className="admin-charts-grid">
              {/* Line Chart */}
              <div className="admin-chart-card">
                <h2 className="admin-chart-title">Signups Over Last 30 Days</h2>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={data?.chartData || []}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
                    <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 12 }} stroke="rgba(0,0,0,0.06)" />
                    <YAxis tick={{ fill: '#64748b', fontSize: 12 }} stroke="rgba(0,0,0,0.06)" allowDecimals={false} />
                    <Tooltip
                      contentStyle={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', color: '#1e293b' }}
                      labelStyle={{ color: '#64748b' }}
                    />
                    <Line type="monotone" dataKey="users" stroke="#3b82f6" strokeWidth={2} dot={false} name="Users" />
                    <Line type="monotone" dataKey="orgs" stroke="var(--accent-primary)" strokeWidth={2} dot={false} name="Organizations" />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Pie Chart */}
              <div className="admin-chart-card">
                <h2 className="admin-chart-title">Ticket Status</h2>
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={ticketData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} innerRadius={45} paddingAngle={3}>
                      {ticketData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', color: '#1e293b' }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="admin-chart-legend">
                  {ticketData.map(t => (
                    <div key={t.name} className="admin-chart-legend-item">
                      <div className="admin-chart-legend-dot" style={{ background: t.color }} />
                      {t.name} ({t.value})
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
};

export default AdminAnalytics;
