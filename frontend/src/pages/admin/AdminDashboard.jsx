import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Building2, Ticket, Clock, AlertCircle, CheckCircle, Loader } from 'lucide-react';
import AdminSidebar from '../../components/AdminSidebar';
import { getAdminDashboard } from '../../services/api';
import './admin.css';

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

  return (
    <div className="layout-container">
      <AdminSidebar />
      <main className="main-content admin-page">
        <div className="admin-header">
          <div className="admin-header-left">
            <h1>Admin Dashboard</h1>
            <p>System overview and quick actions</p>
          </div>
        </div>

        {loading ? (
          <div className="admin-loading">
            <Loader className="animate-spin" size={24} />
          </div>
        ) : (
          <div className="admin-stats-grid">
            <StatCard icon={<Users size={18} />}        label="Total Users"      value={stats?.totalUsers}   color="#3b82f6" onClick={() => navigate('/admin/users')} />
            <StatCard icon={<Clock size={18} />}         label="Pending Approval" value={stats?.pendingUsers} color="#f59e0b" onClick={() => navigate('/admin/users?status=pending')} />
            <StatCard icon={<Building2 size={18} />}     label="Organizations"    value={stats?.totalOrgs}    color="var(--accent-primary)" onClick={() => navigate('/admin/organizations')} />
            <StatCard icon={<CheckCircle size={18} />}   label="Active Orgs"      value={stats?.activeOrgs}   color="#10b981" />
            <StatCard icon={<Ticket size={18} />}        label="Open Tickets"     value={stats?.openTickets}  color="#ef4444" onClick={() => navigate('/admin/tickets')} />
          </div>
        )}

        {/* Quick actions */}
        {stats?.pendingUsers > 0 && (
          <div className="admin-alert warning" onClick={() => navigate('/admin/users?status=pending')}>
            <AlertCircle size={18} />
            <span>
              {stats.pendingUsers} user{stats.pendingUsers > 1 ? 's' : ''} waiting for approval
            </span>
          </div>
        )}
      </main>
    </div>
  );
};

export default AdminDashboard;
