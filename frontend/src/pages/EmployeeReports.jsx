/**
 * EmployeeReports — Back-office employee hours + sales report.
 * GET /api/reports/employees?storeId=&from=&to=
 */
import React, { useState } from 'react';
import axios from 'axios';
import { Users, Clock, ShoppingCart, DollarSign, RefreshCw, AlertCircle } from 'lucide-react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

function fmt$(n) {
  return '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function firstOfMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

export default function EmployeeReports() {
  const user    = (() => { try { return JSON.parse(localStorage.getItem('user')); } catch { return null; } })();
  const storeId = localStorage.getItem('activeStoreId') || user?.storeId;

  const [from,    setFrom]    = useState(firstOfMonthStr());
  const [to,      setTo]      = useState(todayStr());
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const [data,    setData]    = useState(null);

  const run = async () => {
    if (!storeId) { setError('No store selected. Please select a store first.'); return; }
    setLoading(true);
    setError('');
    try {
      const res = await axios.get(`${API}/reports/employees`, {
        params: { storeId, from, to },
        headers: { Authorization: `Bearer ${user?.token}` },
      });
      setData(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load employee report');
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = {
    padding: '0.5rem 0.75rem',
    borderRadius: 8,
    border: '1px solid var(--border, #2a2a3a)',
    background: 'var(--bg-input, #1a1a2a)',
    color: 'var(--text-primary, #e2e8f0)',
    fontSize: '0.875rem',
    height: 38,
  };

  return (
    <div style={{ padding: '1.5rem 2rem', maxWidth: 1100, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '1.5rem' }}>
        <div style={{
          width: 38, height: 38, borderRadius: 10,
          background: 'rgba(122,193,67,.12)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <Users size={18} color="var(--green, #7ac143)" />
        </div>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary, #e2e8f0)' }}>
            Employee Reports
          </h1>
          <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted, #6b7280)' }}>
            Clock hours and sales by cashier
          </p>
        </div>
      </div>

      {/* Filters */}
      <div style={{
        display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap',
        padding: '1rem 1.25rem',
        background: 'var(--bg-panel, #111827)',
        borderRadius: 12,
        border: '1px solid var(--border, #2a2a3a)',
        marginBottom: '1.5rem',
      }}>
        <div>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted, #6b7280)', marginBottom: 4, letterSpacing: '0.05em' }}>FROM</div>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={inputStyle} />
        </div>
        <div>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted, #6b7280)', marginBottom: 4, letterSpacing: '0.05em' }}>TO</div>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} style={inputStyle} />
        </div>
        <button
          onClick={run}
          disabled={loading}
          style={{
            height: 38, padding: '0 1.25rem', borderRadius: 8, border: 'none',
            background: loading ? 'var(--bg-input, #1a1a2a)' : 'var(--green, #7ac143)',
            color: loading ? 'var(--text-muted, #6b7280)' : '#0f1117',
            fontWeight: 700, fontSize: '0.875rem',
            cursor: loading ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          <RefreshCw size={14} style={{ animation: loading ? 'spin 0.9s linear infinite' : 'none' }} />
          {loading ? 'Loading…' : 'Run Report'}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '0.875rem 1rem', borderRadius: 10,
          background: 'rgba(224,63,63,.08)', border: '1px solid rgba(224,63,63,.25)',
          color: '#f87171', fontWeight: 600, fontSize: '0.875rem',
          marginBottom: '1.5rem',
        }}>
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {/* Results */}
      {data && (
        <>
          {/* Summary */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: 12, marginBottom: '1.5rem',
          }}>
            {[
              { label: 'Employees', value: data.employees?.length || 0, icon: Users, color: 'var(--blue, #63b3ed)', bg: 'rgba(99,179,237,.08)' },
              { label: 'Total Hours', value: data.employees?.reduce((s, e) => s + parseFloat(e.totalHours || 0), 0).toFixed(1) + ' hrs', icon: Clock, color: 'var(--amber, #f59e0b)', bg: 'rgba(245,158,11,.08)' },
              { label: 'Transactions', value: data.employees?.reduce((s, e) => s + (e.txCount || 0), 0), icon: ShoppingCart, color: 'var(--green, #7ac143)', bg: 'rgba(122,193,67,.08)' },
              { label: 'Total Sales', value: fmt$(data.employees?.reduce((s, e) => s + (e.txTotal || 0), 0)), icon: DollarSign, color: 'var(--green, #7ac143)', bg: 'rgba(122,193,67,.08)' },
            ].map(m => (
              <div key={m.label} style={{
                padding: '1rem', borderRadius: 12,
                background: m.bg, border: `1px solid ${m.bg.replace('.08)', '.2)')}`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <m.icon size={15} color={m.color} />
                  <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted, #6b7280)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>{m.label}</span>
                </div>
                <div style={{ fontSize: '1.4rem', fontWeight: 900, color: m.color }}>{m.value}</div>
              </div>
            ))}
          </div>

          {/* Table */}
          {data.employees?.length === 0 ? (
            <div style={{
              padding: '3rem', textAlign: 'center',
              background: 'var(--bg-panel, #111827)', borderRadius: 12,
              border: '1px solid var(--border, #2a2a3a)',
              color: 'var(--text-muted, #6b7280)', fontWeight: 600,
            }}>
              No employee data found for this period.
            </div>
          ) : (
            <div style={{
              background: 'var(--bg-panel, #111827)', borderRadius: 12,
              border: '1px solid var(--border, #2a2a3a)',
              overflow: 'hidden',
            }}>
              {/* Table header */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '2fr 1fr 1fr 1fr 1.2fr',
                padding: '0.75rem 1.25rem',
                borderBottom: '1px solid var(--border, #2a2a3a)',
                fontSize: '0.7rem', fontWeight: 700,
                color: 'var(--text-muted, #6b7280)', letterSpacing: '0.06em',
                textTransform: 'uppercase',
              }}>
                <span>Employee</span>
                <span>Hours Worked</span>
                <span>Sessions</span>
                <span>Transactions</span>
                <span style={{ textAlign: 'right' }}>Total Sales</span>
              </div>

              {/* Table rows */}
              {data.employees.map((emp, i) => (
                <div
                  key={emp.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '2fr 1fr 1fr 1fr 1.2fr',
                    padding: '0.875rem 1.25rem',
                    borderBottom: i < data.employees.length - 1 ? '1px solid var(--border, #2a2a3a)' : 'none',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary, #e2e8f0)' }}>
                      {emp.name || emp.email}
                    </div>
                    {emp.name && (
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted, #6b7280)' }}>{emp.email}</div>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Clock size={13} color="var(--amber, #f59e0b)" />
                    <span style={{ fontWeight: 700, color: 'var(--text-primary, #e2e8f0)' }}>
                      {emp.totalHours} hrs
                    </span>
                  </div>
                  <div style={{ color: 'var(--text-secondary, #9ca3af)', fontWeight: 600 }}>
                    {emp.sessionCount || 0}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <ShoppingCart size={13} color="var(--green, #7ac143)" />
                    <span style={{ fontWeight: 700, color: 'var(--text-primary, #e2e8f0)' }}>{emp.txCount || 0}</span>
                  </div>
                  <div style={{ textAlign: 'right', fontWeight: 800, color: 'var(--green, #7ac143)', fontSize: '0.95rem' }}>
                    {fmt$(emp.txTotal)}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Date range note */}
          <div style={{ marginTop: '0.75rem', fontSize: '0.72rem', color: 'var(--text-muted, #6b7280)', textAlign: 'right' }}>
            Report period: {data.from} to {data.to}
          </div>
        </>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
