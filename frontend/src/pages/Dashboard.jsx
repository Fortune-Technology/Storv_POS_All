import React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area
} from 'recharts';
import { TrendingUp, Users, DollarSign, Package, LayoutDashboard } from 'lucide-react';
import './Dashboard.css';

const data = [
  { name: 'Jan', revenue: 4000, points: 2400 },
  { name: 'Feb', revenue: 3000, points: 1398 },
  { name: 'Mar', revenue: 2000, points: 9800 },
  { name: 'Apr', revenue: 2780, points: 3908 },
  { name: 'May', revenue: 1890, points: 4800 },
  { name: 'Jun', revenue: 2390, points: 3800 },
];

const StatCard = ({ title, value, icon, color }) => (
  <div className="glass-card dsh-stat-card">
    <div className="dsh-stat-top">
      <div>
        <p className="dsh-stat-label">{title}</p>
        <h3 className="dsh-stat-value">{value}</h3>
      </div>
      <div className="dsh-stat-icon" style={{ background: `${color}20`, color }}>
        {icon}
      </div>
    </div>
    <div className="dsh-stat-trend">
      <TrendingUp size={16} className="dsh-trend-icon" />
      <span>+12.5% from last month</span>
    </div>
  </div>
);

const Dashboard = () => {
  return (
      <div className="p-page animate-fade-in">
        <div className="p-header">
          <div className="p-header-left">
            <div className="p-header-icon">
              <LayoutDashboard size={22} />
            </div>
            <div>
              <h1 className="p-title">Dashboard Overview</h1>
              <p className="p-subtitle">Welcome back to your business analytics hub.</p>
            </div>
          </div>
          <div className="p-header-actions"></div>
        </div>

        <div className="dsh-stats-row">
          <StatCard title="Total Revenue" value="$42,500" icon={<DollarSign />} color="#3b82f6" />
          <StatCard title="Active Customers" value="1,284" icon={<Users />} color="#10b981" />
          <StatCard title="Total Products" value="452" icon={<Package />} color="#a855f7" />
          <StatCard title="Loyalty Points Issued" value="18.5k" icon={<TrendingUp />} color="#f59e0b" />
        </div>

        <div className="dsh-charts-grid">
          <div className="glass-card dsh-chart-card">
            <h3 className="dsh-chart-title">Revenue Trends</h3>
            <ResponsiveContainer width="100%" height="90%">
              <AreaChart data={data}>
                <defs>
                  <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="name" stroke="var(--text-muted)" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="var(--text-muted)" fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)', borderRadius: '8px' }}
                  itemStyle={{ color: 'var(--text-primary)' }}
                />
                <Area type="monotone" dataKey="revenue" stroke="#6366f1" fillOpacity={1} fill="url(#colorRev)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="glass-card dsh-chart-card">
            <h3 className="dsh-chart-title">Loyalty Points Activity</h3>
            <ResponsiveContainer width="100%" height="90%">
              <BarChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="name" stroke="var(--text-muted)" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="var(--text-muted)" fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)', borderRadius: '8px' }}
                />
                <Bar dataKey="points" fill="#a855f7" radius={[4, 4, 0, 0]} barSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
  );
};

export default Dashboard;
