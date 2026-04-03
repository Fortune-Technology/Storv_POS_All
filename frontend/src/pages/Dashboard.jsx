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
import { TrendingUp, Users, DollarSign, Package } from 'lucide-react';
import Sidebar from '../components/Sidebar';

const data = [
  { name: 'Jan', revenue: 4000, points: 2400 },
  { name: 'Feb', revenue: 3000, points: 1398 },
  { name: 'Mar', revenue: 2000, points: 9800 },
  { name: 'Apr', revenue: 2780, points: 3908 },
  { name: 'May', revenue: 1890, points: 4800 },
  { name: 'Jun', revenue: 2390, points: 3800 },
];

const StatCard = ({ title, value, icon, color }) => (
  <div className="glass-card" style={{ padding: '1.5rem', flex: 1, minWidth: '240px' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <div>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '0.5rem' }}>{title}</p>
        <h3 style={{ fontSize: '1.75rem', color: 'var(--text-primary)' }}>{value}</h3>
      </div>
      <div style={{ background: `${color}20`, padding: '0.75rem', borderRadius: '12px', color }}>
        {icon}
      </div>
    </div>
    <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', color: 'var(--success)', fontSize: '0.875rem' }}>
      <TrendingUp size={16} style={{ marginRight: '0.25rem' }} />
      <span>+12.5% from last month</span>
    </div>
  </div>
);

const Dashboard = () => {
  return (
    <div className="layout-container">
      <Sidebar />
      <main className="main-content animate-fade-in">
        <header style={{ marginBottom: '2.5rem' }}>
          <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Dashboard Overview</h1>
          <p style={{ color: 'var(--text-secondary)' }}>Welcome back to your business analytics hub.</p>
        </header>

        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', marginBottom: '2.5rem' }}>
          <StatCard title="Total Revenue" value="$42,500" icon={<DollarSign />} color="#3b82f6" />
          <StatCard title="Active Customers" value="1,284" icon={<Users />} color="#10b981" />
          <StatCard title="Total Products" value="452" icon={<Package />} color="#a855f7" />
          <StatCard title="Loyalty Points Issued" value="18.5k" icon={<TrendingUp />} color="#f59e0b" />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '1.5rem' }}>
          <div className="glass-card" style={{ height: '400px' }}>
            <h3 style={{ marginBottom: '1.5rem' }}>Revenue Trends</h3>
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

          <div className="glass-card" style={{ height: '400px' }}>
            <h3 style={{ marginBottom: '1.5rem' }}>Loyalty Points Activity</h3>
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
      </main>
    </div>
  );
};

export default Dashboard;
