import React, { useState, useEffect } from 'react';
import { Loader, TrendingUp } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

import { getAdminStorePerformance } from '../services/api';
import { toast } from 'react-toastify';
import '../styles/admin.css';

const AdminStorePerformance = () => {
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getAdminStorePerformance()
      .then(r => setStores(r.data || []))
      .catch(() => toast.error('Failed to load store performance'))
      .finally(() => setLoading(false));
  }, []);

  const top10 = [...stores]
    .sort((a, b) => (b.transactionCount || 0) - (a.transactionCount || 0))
    .slice(0, 10)
    .map(s => ({ name: s.name?.length > 18 ? s.name.slice(0, 18) + '...' : s.name, transactions: s.transactionCount || 0 }));

  return (
    <>
        <div className="admin-header">
          <div className="admin-header-left">
            <div className="admin-header-icon"><TrendingUp size={22} /></div>
            <div>
              <h1>Store Performance</h1>
              <p>Transaction volumes and station counts across all stores</p>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="admin-loading">
            <Loader className="animate-spin" size={24} />
          </div>
        ) : (
          <>
            {/* Bar Chart - Top 10 */}
            {top10.length > 0 && (
              <div className="admin-chart-card">
                <h2 className="admin-chart-title">Top 10 Stores by Transactions</h2>
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart data={top10} layout="vertical" margin={{ left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
                    <XAxis type="number" tick={{ fill: '#64748b', fontSize: 12 }} stroke="rgba(0,0,0,0.06)" />
                    <YAxis dataKey="name" type="category" width={140} tick={{ fill: '#334155', fontSize: 12 }} stroke="rgba(0,0,0,0.06)" />
                    <Tooltip
                      contentStyle={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', color: '#1e293b' }}
                      labelStyle={{ color: '#64748b' }}
                    />
                    <Bar dataKey="transactions" fill="var(--accent-primary)" radius={[0, 6, 6, 0]} barSize={20} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Table */}
            <div className="admin-card-wrap">
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      {['Store Name', 'Organization', 'Transactions', 'Stations', 'Created'].map(h => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {stores.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="admin-empty">
                          No stores found
                        </td>
                      </tr>
                    ) : stores.map(store => (
                      <tr key={store.id}>
                        <td className="primary">{store.name}</td>
                        <td>{store.organization?.name || '-'}</td>
                        <td>{(store.transactionCount ?? 0).toLocaleString()}</td>
                        <td>{store.stationCount ?? 0}</td>
                        <td className="muted">
                          {store.createdAt ? new Date(store.createdAt).toLocaleDateString() : '-'}
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

export default AdminStorePerformance;
