import React, { useState, useEffect, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area,
} from 'recharts';
import {
  TrendingUp, TrendingDown, Users, DollarSign, Package, LayoutDashboard, Loader,
} from 'lucide-react';
import {
  getSalesMonthly, getCatalogProducts, getCustomers,
} from '../services/api';
import './Dashboard.css';

// ─── Helpers ─────────────────────────────────────────────────────────────────
const fmtCurrency = (n) =>
  n == null ? '$0' : Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const fmtNum = (n) =>
  n == null ? '0' : Number(n).toLocaleString('en-US');
const fmtCompact = (n) => {
  if (n == null) return '0';
  const num = Number(n);
  if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
  return String(num);
};

// ─── Stat Card ───────────────────────────────────────────────────────────────
const StatCard = ({ title, value, icon, color, trend }) => (
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
    {trend != null && (
      <div className="dsh-stat-trend">
        {trend >= 0 ? <TrendingUp size={16} className="dsh-trend-icon" />
                    : <TrendingDown size={16} className="dsh-trend-icon" style={{ color: '#ef4444' }} />}
        <span style={{ color: trend >= 0 ? '#10b981' : '#ef4444' }}>
          {trend >= 0 ? '+' : ''}{trend.toFixed(1)}% from last month
        </span>
      </div>
    )}
  </div>
);

// ─── Dashboard ───────────────────────────────────────────────────────────────
const Dashboard = () => {
  const [monthlyData, setMonthlyData]   = useState([]);
  const [aggregation, setAggregation]   = useState(null);
  const [productCount, setProductCount] = useState(0);
  const [customerCount, setCustomerCount] = useState(0);
  const [loading, setLoading] = useState(true);

  // Compute date range — last 6 months
  const today = new Date();
  const to = today.toISOString().slice(0, 10);
  const from = new Date(today.getFullYear(), today.getMonth() - 5, 1).toISOString().slice(0, 10);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [monthly, products, customers] = await Promise.all([
        getSalesMonthly({ from, to }).catch(() => ({ value: [], '@odata.aggregation': {} })),
        getCatalogProducts({ page: 1, limit: 1 }).catch(() => ({ total: 0 })),
        getCustomers({ page: 1, limit: 1 }).catch(() => ({ total: 0 })),
      ]);

      // Parse monthly sales into chart format
      const rows = monthly?.value || [];
      const chart = rows.map(r => ({
        name: r.Month ? new Date(r.Date + 'T12:00:00').toLocaleDateString(undefined, { month: 'short' }) : r.Date,
        revenue: r.TotalNetSales || 0,
        transactions: r.TotalTransactionsCount || 0,
      }));
      setMonthlyData(chart);
      setAggregation(monthly?.['@odata.aggregation'] || null);
      setProductCount(products?.total || products?.data?.length || 0);
      setCustomerCount(customers?.total || customers?.customers?.length || 0);
    } catch (e) {
      console.error('[Dashboard] load failed:', e);
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  // Compute month-over-month trend
  const thisMonth = monthlyData[monthlyData.length - 1]?.revenue || 0;
  const lastMonth = monthlyData[monthlyData.length - 2]?.revenue || 0;
  const trendPct = lastMonth > 0 ? ((thisMonth - lastMonth) / lastMonth) * 100 : null;

  const totalRevenue = aggregation?.TotalNetSales || 0;
  const totalTransactions = aggregation?.TotalTransactionsCount || 0;

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

      {loading && (
        <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
          <Loader size={18} className="p-spin" /> Loading dashboard...
        </div>
      )}

      {!loading && (
        <>
          <div className="dsh-stats-row">
            <StatCard
              title="Revenue (6 months)"
              value={fmtCurrency(totalRevenue)}
              icon={<DollarSign />}
              color="#3b82f6"
              trend={trendPct}
            />
            <StatCard
              title="Transactions (6 months)"
              value={fmtNum(totalTransactions)}
              icon={<TrendingUp />}
              color="#10b981"
            />
            <StatCard
              title="Total Products"
              value={fmtNum(productCount)}
              icon={<Package />}
              color="#a855f7"
            />
            <StatCard
              title="Total Customers"
              value={fmtCompact(customerCount)}
              icon={<Users />}
              color="#f59e0b"
            />
          </div>

          <div className="dsh-charts-grid">
            <div className="glass-card dsh-chart-card">
              <h3 className="dsh-chart-title">Revenue Trends (Last 6 Months)</h3>
              {monthlyData.length === 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '90%', color: 'var(--text-muted)' }}>
                  No sales data yet — process some transactions to see revenue trends.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="90%">
                  <AreaChart data={monthlyData}>
                    <defs>
                      <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="name" stroke="var(--text-muted)" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis stroke="var(--text-muted)" fontSize={12} tickLine={false} axisLine={false}
                      tickFormatter={(v) => '$' + (v >= 1000 ? (v/1000).toFixed(0) + 'k' : v)} />
                    <Tooltip
                      contentStyle={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)', borderRadius: '8px' }}
                      itemStyle={{ color: 'var(--text-primary)' }}
                      formatter={(v) => fmtCurrency(v)}
                    />
                    <Area type="monotone" dataKey="revenue" stroke="#6366f1" fillOpacity={1} fill="url(#colorRev)" />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="glass-card dsh-chart-card">
              <h3 className="dsh-chart-title">Transactions Per Month</h3>
              {monthlyData.length === 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '90%', color: 'var(--text-muted)' }}>
                  No transaction data yet.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="90%">
                  <BarChart data={monthlyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="name" stroke="var(--text-muted)" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis stroke="var(--text-muted)" fontSize={12} tickLine={false} axisLine={false} />
                    <Tooltip
                      contentStyle={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)', borderRadius: '8px' }}
                    />
                    <Bar dataKey="transactions" fill="#a855f7" radius={[4, 4, 0, 0]} barSize={40} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default Dashboard;
