/**
 * VendorPayouts — Back-office vendor payment management.
 * View, filter, and record vendor payments (expense & merchandise).
 * Uses VendorPayment model (not shift-tied).
 */
import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpCircle, Plus, DollarSign, ShoppingCart, RefreshCw, Check, AlertCircle, X } from 'lucide-react';
import { getVendorPayments, createVendorPaymentEntry, getCatalogVendors, getPOSConfig } from '../services/api';
import PriceInput from '../components/PriceInput';

import { fmt$, todayStr, firstOfMonthStr, fmtDate } from '../utils/formatters';
import './VendorPayouts.css';

const EMPTY_FORM = {
  vendorId: '', vendorName: '', amount: '', paymentType: 'expense',
  tenderMethod: 'cash', notes: '', paymentDate: todayStr(), storeId: '',
};

export default function VendorPayouts() {
  const user    = (() => { try { return JSON.parse(localStorage.getItem('user')); } catch { return null; } })();
  const storeId = localStorage.getItem('activeStoreId') || user?.storeId;

  const [dateFrom,   setDateFrom]   = useState(firstOfMonthStr());
  const [dateTo,     setDateTo]     = useState(todayStr());
  const [typeFilter, setTypeFilter] = useState('');
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState('');
  const [payments,   setPayments]   = useState(null);
  const [summary,    setSummary]    = useState(null);
  const [vendors,       setVendors]       = useState([]);
  const [tenderMethods, setTenderMethods] = useState([{ id: 'cash', label: 'Cash', enabled: true }, { id: 'cheque', label: 'Cheque', enabled: true }]);
  const [showForm,   setShowForm]   = useState(false);
  const [form,       setForm]       = useState(EMPTY_FORM);
  const [saving,     setSaving]     = useState(false);
  const [formError,  setFormError]  = useState('');

  // Load vendors for dropdown
  const loadVendors = useCallback(async () => {
    if (vendors.length > 0) return;
    try {
      const res = await getCatalogVendors();
      const list = Array.isArray(res) ? res : (res?.data || res?.vendors || []);
      setVendors(list);
    } catch { /* silently fail */ }
    if (storeId) {
      getPOSConfig(storeId).then(cfg => {
        if (cfg.vendorTenderMethods) setTenderMethods(cfg.vendorTenderMethods.filter(t => t.enabled));
      }).catch(() => {});
    }
  }, [vendors.length, storeId]);

  const openForm = () => {
    loadVendors();
    setForm({ ...EMPTY_FORM, storeId: storeId || '' });
    setShowForm(true);
    setFormError('');
  };

  const run = useCallback(async () => {
    if (!storeId) { setError('No store selected.'); return; }
    setLoading(true); setError('');
    try {
      const params = { storeId, dateFrom, dateTo, limit: 500 };
      if (typeFilter) params.paymentType = typeFilter;
      const res = await getVendorPayments(params);
      setPayments(res.payments || []);
      setSummary(res.summary || {});
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load payments');
    } finally { setLoading(false); }
  }, [storeId, dateFrom, dateTo, typeFilter]);

  const handleSave = async () => {
    if (!form.amount || isNaN(parseFloat(form.amount)) || parseFloat(form.amount) <= 0) {
      setFormError('Amount must be a positive number.'); return;
    }
    if (!form.paymentType) { setFormError('Select a payment type.'); return; }
    setFormError(''); setSaving(true);
    try {
      const selectedVendor = vendors.find(v => String(v.id) === String(form.vendorId));
      await createVendorPaymentEntry({
        storeId:      form.storeId || storeId,
        vendorId:     form.vendorId ? parseInt(form.vendorId) : undefined,
        vendorName:   selectedVendor?.name || form.vendorName || null,
        amount:       parseFloat(form.amount),
        paymentType:  form.paymentType,
        tenderMethod: form.tenderMethod || 'cash',
        notes:        form.notes || null,
        paymentDate:  form.paymentDate || new Date().toISOString(),
      });
      setShowForm(false);
      setForm(EMPTY_FORM);
      run(); // refresh list
    } catch (err) {
      setFormError(err.response?.data?.error || 'Failed to save payment');
    } finally { setSaving(false); }
  };

  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
      <div className="p-page">
        <div className="vp-page">

          {/* Header */}
          <div className="p-header">
            <div className="p-header-left">
              <div className="p-header-icon">
                <ArrowUpCircle size={22} />
              </div>
              <div>
                <h1 className="p-title">Vendor Payouts</h1>
                <p className="p-subtitle">Track and record vendor payments — expenses &amp; merchandise</p>
              </div>
            </div>
            <div className="p-header-actions">
              <button className="p-btn p-btn-primary" onClick={openForm}>
                <Plus size={15} /> Add Payment
              </button>
            </div>
          </div>

          {/* Summary cards */}
          {summary && (
            <div className="vp-summary">
              <div className="vp-card">
                <div className="vp-card-icon" style={{ background: 'rgba(245,158,11,.12)' }}>
                  <DollarSign size={16} color="#f59e0b" />
                </div>
                <div>
                  <span className="vp-card-label">Total Expenses</span>
                  <div className="vp-card-value" style={{ color: '#f59e0b' }}>{fmt$(summary.totalExpense)}</div>
                </div>
              </div>
              <div className="vp-card">
                <div className="vp-card-icon" style={{ background: 'rgba(168,85,247,.12)' }}>
                  <ShoppingCart size={16} color="#a855f7" />
                </div>
                <div>
                  <span className="vp-card-label">Merchandise</span>
                  <div className="vp-card-value" style={{ color: '#a855f7' }}>{fmt$(summary.totalMerchandise)}</div>
                </div>
              </div>
              <div className="vp-card">
                <div className="vp-card-icon" style={{ background: 'rgba(248,113,113,.12)' }}>
                  <ArrowUpCircle size={16} color="#f87171" />
                </div>
                <div>
                  <span className="vp-card-label">Total Paid Out</span>
                  <div className="vp-card-value" style={{ color: '#f87171' }}>{fmt$(summary.total)}</div>
                </div>
              </div>
            </div>
          )}

          {/* Inline add form */}
          {showForm && (
            <div className="vp-form">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <span style={{ fontWeight: 800, fontSize: '0.9rem', color: '#a855f7' }}>New Vendor Payment</span>
                <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted, #6b7280)' }} onClick={() => setShowForm(false)}><X size={16} /></button>
              </div>
              <div className="vp-form-grid">
                <div className="vp-form-field">
                  <label className="vp-form-label">Vendor</label>
                  <select className="vp-form-select" value={form.vendorId} onChange={e => setF('vendorId', e.target.value)}>
                    <option value="">-- Select Vendor --</option>
                    {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                </div>
                {!form.vendorId && (
                  <div className="vp-form-field">
                    <label className="vp-form-label">Vendor Name (manual)</label>
                    <input className="vp-form-input" value={form.vendorName} onChange={e => setF('vendorName', e.target.value)} placeholder="e.g. ABC Distributors" />
                  </div>
                )}
                <div className="vp-form-field">
                  <label className="vp-form-label">Amount *</label>
                  <div className="vp-dollar-wrap">
                    <span className="vp-dollar-sign">$</span>
                    <PriceInput className="vp-form-input vp-dollar-input" value={form.amount} onChange={(v) => setF('amount', v)} placeholder="0.00" />
                  </div>
                </div>
                <div className="vp-form-field">
                  <label className="vp-form-label">Payment Date *</label>
                  <input className="vp-form-input" type="date" value={form.paymentDate} onChange={e => setF('paymentDate', e.target.value)} />
                </div>
                <div className="vp-form-field">
                  <label className="vp-form-label">Tender Method</label>
                  <select className="vp-form-select" value={form.tenderMethod || 'cash'} onChange={e => setF('tenderMethod', e.target.value)}>
                    {tenderMethods.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </select>
                </div>
                <div className="vp-form-field">
                  <label className="vp-form-label">Type *</label>
                  <div className="vp-type-toggle">
                    <button className={`vp-type-btn${form.paymentType === 'expense' ? ' vp-type-btn--expense' : ''}`} type="button" onClick={() => setF('paymentType', 'expense')}>
                      <DollarSign size={13} /> Expense
                    </button>
                    <button className={`vp-type-btn${form.paymentType === 'merchandise' ? ' vp-type-btn--merch' : ''}`} type="button" onClick={() => setF('paymentType', 'merchandise')}>
                      <ShoppingCart size={13} /> Merchandise
                    </button>
                  </div>
                </div>
                <div className="vp-form-field vp-form-field--full">
                  <label className="vp-form-label">Notes / Invoice Ref</label>
                  <textarea className="vp-form-textarea" rows={2} value={form.notes} onChange={e => setF('notes', e.target.value)} placeholder="Optional notes, invoice number…" />
                </div>
              </div>
              {formError && <div className="vp-error" style={{ marginBottom: 12 }}>{formError}</div>}
              <div className="vp-form-actions">
                <button className="vp-btn-cancel-sm" onClick={() => setShowForm(false)}>Cancel</button>
                <button className="vp-btn-save" onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving…' : <><Check size={14} /> Save Payment</>}
                </button>
              </div>
            </div>
          )}

          {/* Filters */}
          <div className="vp-filters">
            <div className="vp-filter-group">
              <span className="vp-filter-label">From</span>
              <input className="vp-input" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
            </div>
            <div className="vp-filter-group">
              <span className="vp-filter-label">To</span>
              <input className="vp-input" type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
            </div>
            <div className="vp-filter-group">
              <span className="vp-filter-label">Type</span>
              <select className="vp-select" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
                <option value="">All Types</option>
                <option value="expense">Expense</option>
                <option value="merchandise">Merchandise</option>
              </select>
            </div>
            <button className="vp-btn-run" onClick={run} disabled={loading}>
              <RefreshCw size={14} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
              {loading ? 'Loading…' : 'Load Payments'}
            </button>
          </div>

          {error && <div className="vp-error">{error}</div>}

          {/* Table */}
          {payments !== null && (
            <div className="vp-table-wrap">
              <div className="vp-table-toolbar">
                <span className="vp-table-count">{payments.length} payment{payments.length !== 1 ? 's' : ''}</span>
              </div>
              {payments.length === 0 ? (
                <div className="vp-empty">
                  <AlertCircle size={28} style={{ marginBottom: 8, opacity: 0.3 }} /><br />
                  No payments found for the selected period.
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="vp-table">
                    <thead>
                      <tr>
                        <th className="vp-th">Date</th>
                        <th className="vp-th">Vendor / Payee</th>
                        <th className="vp-th">Type</th>
                        <th className="vp-th">Tender</th>
                        <th className="vp-th">Notes</th>
                        <th className="vp-th">Recorded by</th>
                        <th className="vp-th vp-th--right">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payments.map((p, i) => (
                        <tr key={p.id || i} className="vp-tr">
                          <td className="vp-td">{fmtDate(p.paymentDate || p.createdAt)}</td>
                          <td className="vp-td vp-td--primary">{p.vendorName || 'N/A'}</td>
                          <td className="vp-td">
                            <span className={`vp-type-badge${p.paymentType === 'merchandise' ? ' vp-type-badge--merch' : ' vp-type-badge--expense'}`}>
                              {p.paymentType === 'merchandise' ? <ShoppingCart size={10} /> : <DollarSign size={10} />}
                              {p.paymentType === 'merchandise' ? 'Merchandise' : 'Expense'}
                            </span>
                          </td>
                          <td className="vp-td">{p.tenderMethod || 'cash'}</td>
                          <td className="vp-td" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {p.notes || <em style={{ opacity: 0.5 }}>N/A</em>}
                          </td>
                          <td className="vp-td">{p.createdByName || 'N/A'}</td>
                          <td className="vp-td vp-td--amount">-{fmt$(p.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="vp-tfoot">
                        <td colSpan={6} style={{ color: 'var(--text-secondary, #9ca3af)', fontSize: '0.8rem' }}>
                          Total ({payments.length} records)
                        </td>
                        <td style={{ textAlign: 'right', color: '#f87171' }}>
                          -{fmt$(payments.reduce((s, p) => s + Number(p.amount), 0))}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          )}

          {payments === null && !loading && !error && (
            <div style={{ textAlign: 'center', padding: '4rem 2rem', background: 'var(--bg-secondary, #111827)', border: '1px solid var(--border-color, #1f2937)', borderRadius: 12, color: 'var(--text-muted, #6b7280)', fontSize: '0.875rem' }}>
              <ArrowUpCircle size={36} style={{ marginBottom: 12, opacity: 0.2 }} /><br />
              Select a date range and click <strong style={{ color: 'var(--text-secondary, #9ca3af)' }}>Load Payments</strong> to view history.
            </div>
          )}
        </div>
        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>
  );
}
