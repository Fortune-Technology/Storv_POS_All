import React, { useState, useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import {
  Search, User, Phone, Mail, Award, Info, ChevronRight, X,
  Download, Loader, CreditCard, DollarSign, RefreshCw,
  CheckCircle, AlertTriangle, Calendar, Clock, ChevronLeft,
  ChevronRight as ChevronRightIcon, Trash2, ShieldCheck, ShieldX,
  UserPlus
} from 'lucide-react';
import Sidebar from '../components/Sidebar';
import {
  fetchCustomers,
  phoneLookup as customerPhoneLookup,
  syncCustomers,
  setSelectedCustomer,
  clearSyncStats,
  setPage
} from '../store/slices/customerSlice';
import { toast } from 'react-toastify';

const Customers = () => {
  const dispatch = useDispatch();
  const {
    items: customers,
    total: totalCustomers,
    page: currentPage,
    totalPages,
    status,
    syncStatus,
    syncStats,
    selectedCustomer
  } = useSelector((state) => state.customers);

  const [searchTerm, setSearchTerm] = useState('');
  const [phoneSearch, setPhoneSearch] = useState('');

  // Fetch customers when searchTerm or page changes
  useEffect(() => {
    dispatch(fetchCustomers({ name: searchTerm, page: currentPage, limit: 10 }));
  }, [dispatch, searchTerm, currentPage]);

  const handlePhoneLookup = async (e) => {
    e.preventDefault();
    if (!phoneSearch) return;
    try {
      await dispatch(customerPhoneLookup(phoneSearch)).unwrap();
      toast.success('Customer found!');
    } catch (error) {
      toast.error(error?.error || 'Customer not found');
    }
  };

  const handleSyncCustomers = async () => {
    try {
      await dispatch(syncCustomers()).unwrap();
      toast.success('✅ Customer sync complete');
      dispatch(fetchCustomers({ name: searchTerm, page: 1, limit: 10 }));
    } catch (error) {
      toast.error(error?.error || 'Failed to sync customers');
    }
  };

  const getDisplayName = (customer) => {
    if (customer.name && customer.name !== 'Unknown') return customer.name;
    const first = customer.firstName || '';
    const last = customer.lastName || '';
    return [first, last].filter(Boolean).join(' ') || 'Unknown';
  };

  const getInitial = (customer) => {
    const name = getDisplayName(customer);
    return name.charAt(0).toUpperCase();
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    try {
      return new Date(dateStr).toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (e) {
      return dateStr;
    }
  };

  const formatCurrency = (val) => {
    if (val === null || val === undefined) return '—';
    return `$${parseFloat(val).toFixed(2)}`;
  };

  const handlePageChange = (newPage) => {
    dispatch(setPage(newPage));
  };

  return (
    <div className="layout-container">
      <Sidebar />
      <main className="main-content animate-fade-in">
        <header style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem', color: 'var(--text-primary)' }}>Customers Management</h1>
            <p style={{ color: 'var(--text-secondary)' }}>View customer profiles and loyalty points.</p>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
            {/* Phone lookup */}
            <div className="glass-card" style={{ padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', gap: '0.75rem', border: '1px solid var(--accent-primary)' }}>
              <Phone size={18} color="var(--accent-primary)" />
              <form onSubmit={handlePhoneLookup} style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  type="text"
                  placeholder="Check points by phone..."
                  style={{ background: 'transparent', border: 'none', color: 'white', outline: 'none', width: '170px', fontSize: '0.875rem' }}
                  value={phoneSearch}
                  onChange={(e) => setPhoneSearch(e.target.value)}
                />
                <button type="submit" className="btn-primary btn" style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }} disabled={status === 'loading'}>
                  {status === 'loading' ? <Loader size={14} className="pos-spin" /> : 'Check'}
                </button>
              </form>
            </div>
            {/* Sync button */}
            <button
              onClick={handleSyncCustomers}
              className="btn btn-primary"
              disabled={syncStatus === 'loading'}
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
              id="sync-customers-btn"
            >
              {syncStatus === 'loading' ? <Loader size={16} className="pos-spin" /> : <Download size={16} />}
              {syncStatus === 'loading' ? 'Syncing...' : 'Sync from MarktPOS'}
            </button>
          </div>
        </header>

        {/* Sync results */}
        {syncStats && (
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="pos-sync-badge pos-sync-success"><CheckCircle size={14} /> {syncStats.synced} new</span>
            <span className="pos-sync-badge pos-sync-updated"><RefreshCw size={14} /> {syncStats.updated} updated</span>
            {syncStats.skipped > 0 && <span className="pos-sync-badge" style={{ background: 'rgba(245, 158, 11, 0.12)', color: '#fbbf24' }}><AlertTriangle size={14} /> {syncStats.skipped} skipped</span>}
            {syncStats.failed > 0 && <span className="pos-sync-badge pos-sync-failed"><AlertTriangle size={14} /> {syncStats.failed} failed</span>}
            <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              Total Processed: {syncStats.total}
            </span>
            <button
              onClick={() => dispatch(clearSyncStats())}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '0 0.5rem' }}
            >
              <X size={14} />
            </button>
          </div>
        )}

        <div className="glass-card" style={{ padding: '1.5rem', marginBottom: '2.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem', background: 'var(--bg-tertiary)', padding: '0.75rem 1rem', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
            <Search size={20} color="var(--text-muted)" />
            <input
              type="text"
              className="form-input"
              placeholder="Search by name..."
              style={{ background: 'transparent', border: 'none', color: 'white', outline: 'none', width: '100%', padding: '0' }}
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                dispatch(setPage(1));
              }}
            />
          </div>

          <div className="table-container">
            {status === 'loading' && customers.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '4rem' }}>
                <Loader size={40} className="pos-spin" color="var(--accent-primary)" />
                <p style={{ marginTop: '1rem', color: 'var(--text-muted)' }}>Loading customers...</p>
              </div>
            ) : (
              <>
                <table>
                  <thead>
                    <tr>
                      <th>Customer Profile</th>
                      <th>Card No</th>
                      <th>Loyalty Points</th>
                      <th>Discount</th>
                      <th>Contact Info</th>
                      <th>Balance</th>
                      <th style={{ textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customers.length === 0 ? (
                      <tr>
                        <td colSpan={7} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                          {searchTerm ? 'No customers match your search.' : 'No customers found. Click "Sync from MarktPOS" to import.'}
                        </td>
                      </tr>
                    ) : (
                      customers.map((customer) => (
                        <tr key={customer.id}>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                              <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'var(--accent-gradient)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 600, flexShrink: 0 }}>
                                {getInitial(customer)}
                              </div>
                              <div>
                                <p style={{ fontWeight: 600 }}>{getDisplayName(customer)}</p>
                                <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                                  {customer.posCustomerId ? `POS: ${customer.posCustomerId.substring(0, 8)}...` : `ID: ${customer.id.slice(-8)}`}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td>
                            {customer.cardNo ? (
                              <span style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontFamily: 'monospace', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                <CreditCard size={14} /> {customer.cardNo}
                              </span>
                            ) : '—'}
                          </td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--warning)', fontWeight: 700 }}>
                              <Award size={18} /> {customer.loyaltyPoints || 0} pts
                            </div>
                          </td>
                          <td>
                            {customer.discount != null ? (
                              <span style={{ color: '#34d399', fontWeight: 600 }}>{customer.discount}%</span>
                            ) : '—'}
                          </td>
                          <td>
                            <div style={{ fontSize: '0.875rem' }}>
                              {customer.phone && <p style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}><Phone size={14} /> {customer.phone}</p>}
                              {customer.email && <p style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Mail size={14} /> {customer.email}</p>}
                              {!customer.phone && !customer.email && <span style={{ color: 'var(--text-muted)' }}>—</span>}
                            </div>
                          </td>
                          <td>
                            {customer.balance != null ? (
                              <span style={{ fontFamily: 'monospace', fontWeight: 600, color: customer.balance > 0 ? '#34d399' : 'var(--text-secondary)' }}>
                                {formatCurrency(customer.balance)}
                              </span>
                            ) : '—'}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <button
                              onClick={() => dispatch(setSelectedCustomer(customer))}
                              className="btn btn-secondary"
                              style={{ padding: '0.4rem 0.8rem', fontSize: '0.875rem' }}
                            >
                              View Profile
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>

                {/* Pagination (Style matching POSAPI.jsx) */}
                {customers.length > 0 && (
                  <div className="pos-pagination" style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="pos-pagination-info" style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                      Showing {((currentPage - 1) * 10) + 1}–{Math.min(currentPage * 10, totalCustomers)} of {totalCustomers}
                    </span>
                    <div className="pos-pagination-btns" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <button
                        onClick={() => handlePageChange(Math.max(1, currentPage - 1))}
                        disabled={currentPage === 1}
                        className="btn btn-secondary btn-sm"
                        style={{ padding: '0.25rem 0.5rem' }}
                      >
                        <ChevronLeft size={16} />
                      </button>
                      <span className="pos-page-number" style={{ margin: '0 0.5rem', fontWeight: 600 }}>{currentPage} / {totalPages}</span>
                      <button
                        onClick={() => handlePageChange(Math.min(totalPages, currentPage + 1))}
                        disabled={currentPage === totalPages}
                        className="btn btn-secondary btn-sm"
                        style={{ padding: '0.25rem 0.5rem' }}
                      >
                        <ChevronRightIcon size={16} />
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Selected Customer Modal (Enhanced & Positional Fix) */}
        {selectedCustomer && (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0,0,0,0.85)',
              zIndex: 1000,
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'center',
              overflowY: 'auto',
              padding: '2rem 1rem'
            }}
            onClick={() => dispatch(setSelectedCustomer(null))}
          >
            <div
              className="glass-card animate-fade-in"
              style={{
                width: '100%',
                maxWidth: '850px',
                padding: '2.5rem',
                position: 'relative',
                background: 'rgba(23, 23, 33, 0.95)',
                backdropFilter: 'blur(16px)',
                border: '1px solid var(--border-color)',
                borderRadius: '24px',
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => dispatch(setSelectedCustomer(null))}
                style={{
                  position: 'absolute',
                  top: '1.5rem',
                  right: '1.5rem',
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                  width: '36px',
                  height: '36px',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.2s'
                }}
                className="hover-glow"
              >
                <X size={20} />
              </button>

              <div style={{ display: 'flex', gap: '2rem', marginBottom: '2.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{
                  width: '120px',
                  height: '120px',
                  borderRadius: '30px',
                  background: 'var(--accent-gradient)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'white',
                  fontSize: '3rem',
                  fontWeight: 600,
                  boxShadow: '0 10px 20px -5px var(--accent-primary-alpha)'
                }}>
                  {getInitial(selectedCustomer)}
                </div>
                <div>
                  <h2 style={{ fontSize: '2.25rem', marginBottom: '0.75rem', letterSpacing: '-0.025em' }}>{getDisplayName(selectedCustomer)}</h2>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
                    <span className="pos-feature-tag"><ShieldCheck size={14} /> Active Member</span>
                    {selectedCustomer.posCustomerId && <span className="pos-feature-tag" style={{ background: 'rgba(99, 102, 241, 0.15)', color: '#818cf8' }}>POS Synced</span>}
                    {selectedCustomer.instoreChargeEnabled && <span className="pos-feature-tag" style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#34d399' }}>Charge Enabled</span>}
                  </div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.25rem', marginBottom: '2.5rem' }}>
                <div className="glass hover-glow" style={{ padding: '1.5rem', textAlign: 'center', borderRadius: '16px' }}>
                  <Award size={24} color="var(--warning)" style={{ margin: '0 auto 0.5rem' }} />
                  <p style={{ color: 'var(--text-secondary)', marginBottom: '0.25rem', fontSize: '0.85rem' }}>Loyalty Points</p>
                  <h3 style={{ fontSize: '2rem', color: 'var(--warning)', fontWeight: 700 }}>{selectedCustomer.loyaltyPoints || 0}</h3>
                </div>
                <div className="glass hover-glow" style={{ padding: '1.5rem', textAlign: 'center', borderRadius: '16px' }}>
                  <DollarSign size={24} color="#34d399" style={{ margin: '0 auto 0.5rem' }} />
                  <p style={{ color: 'var(--text-secondary)', marginBottom: '0.25rem', fontSize: '0.85rem' }}>Discount Rate</p>
                  <h3 style={{ fontSize: '2rem', color: '#34d399', fontWeight: 700 }}>{selectedCustomer.discount != null ? `${selectedCustomer.discount}%` : '0%'}</h3>
                </div>
                <div className="glass hover-glow" style={{ padding: '1.5rem', textAlign: 'center', borderRadius: '16px' }}>
                  <CreditCard size={24} color="var(--info)" style={{ margin: '0 auto 0.5rem' }} />
                  <p style={{ color: 'var(--text-secondary)', marginBottom: '0.25rem', fontSize: '0.85rem' }}>Current Balance</p>
                  <h3 style={{ fontSize: '2rem', color: 'var(--info)', fontWeight: 700 }}>{formatCurrency(selectedCustomer.balance)}</h3>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: '2rem' }}>
                {/* Contact & Personal */}
                <div>
                  <h4 style={{ fontSize: '1.125rem', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-secondary)' }}>
                    <User size={18} /> Contact & Personal Info
                  </h4>
                  <div className="glass" style={{ borderRadius: '16px', overflow: 'hidden' }}>
                    <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-muted)' }}><Phone size={14} style={{ marginRight: '0.5rem' }} /> Phone</span>
                      <span style={{ fontWeight: 500 }}>{selectedCustomer.phone || 'N/A'}</span>
                    </div>
                    <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-muted)' }}><Mail size={14} style={{ marginRight: '0.5rem' }} /> Email</span>
                      <span style={{ fontWeight: 500 }}>{selectedCustomer.email || 'N/A'}</span>
                    </div>
                    <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-muted)' }}><CreditCard size={14} style={{ marginRight: '0.5rem' }} /> Card Number</span>
                      <span style={{ fontWeight: 500, fontFamily: 'monospace' }}>{selectedCustomer.cardNo || 'N/A'}</span>
                    </div>
                    <div style={{ padding: '1rem 1.25rem', display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-muted)' }}><Calendar size={14} style={{ marginRight: '0.5rem' }} /> Birth Date</span>
                      <span style={{ fontWeight: 500 }}>{formatDate(selectedCustomer.birthDate) || 'N/A'}</span>
                    </div>
                  </div>
                </div>

                {/* Account & Metadata */}
                <div>
                  <h4 style={{ fontSize: '1.125rem', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-secondary)' }}>
                    <Info size={18} /> Account Details
                  </h4>
                  <div className="glass" style={{ borderRadius: '16px', overflow: 'hidden' }}>
                    <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Balance Limit</span>
                      <span style={{ fontWeight: 500 }}>{formatCurrency(selectedCustomer.balanceLimit)}</span>
                    </div>
                    <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-muted)' }}>In-store Charge</span>
                      <span style={{ color: selectedCustomer.instoreChargeEnabled ? '#34d399' : '#f87171', fontWeight: 600 }}>
                        {selectedCustomer.instoreChargeEnabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </div>
                    <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-muted)' }}>POS Customer ID</span>
                      <span style={{ fontWeight: 500, fontSize: '0.8rem', color: 'var(--text-muted)' }}>{selectedCustomer.posCustomerId || 'Not Linked'}</span>
                    </div>
                    <div style={{ padding: '1rem 1.25rem', display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Status</span>
                      <span style={{ color: selectedCustomer.deleted ? 'var(--error)' : 'var(--success)', fontWeight: 600 }}>
                        {selectedCustomer.deleted ? 'Deleted' : 'Active'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* System Timestamps */}
              <div style={{ marginTop: '2.5rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                <div style={{ background: 'rgba(255,255,255,0.03)', padding: '0.75rem 1rem', borderRadius: '12px', flex: 1, minWidth: '200px' }}>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Created At</p>
                  <p style={{ fontSize: '0.875rem', fontWeight: 500 }}><Clock size={12} style={{ marginRight: '0.4rem' }} /> {formatDate(selectedCustomer.createdAt)}</p>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.03)', padding: '0.75rem 1rem', borderRadius: '12px', flex: 1, minWidth: '200px' }}>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Last Updated</p>
                  <p style={{ fontSize: '0.875rem', fontWeight: 500 }}><RefreshCw size={12} style={{ marginRight: '0.4rem' }} /> {formatDate(selectedCustomer.updatedAt)}</p>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.03)', padding: '0.75rem 1rem', borderRadius: '12px', flex: 1, minWidth: '200px' }}>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Account Expiry</p>
                  <p style={{ fontSize: '0.875rem', fontWeight: 500 }}><Calendar size={12} style={{ marginRight: '0.4rem' }} /> {formatDate(selectedCustomer.expirationDate)}</p>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.03)', padding: '0.75rem 1rem', borderRadius: '12px', flex: 1, minWidth: '200px' }}>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>POS Last Synced</p>
                  <p style={{ fontSize: '0.875rem', fontWeight: 500 }}><Download size={12} style={{ marginRight: '0.4rem' }} /> {formatDate(selectedCustomer.posSyncedAt)}</p>
                </div>
              </div>

              {/* Points History */}
              {selectedCustomer.pointsHistory && selectedCustomer.pointsHistory.length > 0 && (
                <div style={{ marginTop: '2.5rem' }}>
                  <h4 style={{ fontSize: '1.25rem', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <Award size={20} /> Points Transaction History
                  </h4>
                  <div className="glass" style={{ borderRadius: '20px', overflow: 'hidden', border: '1px solid var(--border-color)' }}>
                    <div style={{ maxHeight: '250px', overflowY: 'auto', padding: '0 1.25rem' }}>
                      {selectedCustomer.pointsHistory.map((h, i) => (
                        <div key={i} style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          padding: '1.25rem 0',
                          borderBottom: i === selectedCustomer.pointsHistory.length - 1 ? 'none' : '1px solid var(--border-color)',
                          alignItems: 'center'
                        }}>
                          <div>
                            <p style={{ fontWeight: 600, fontSize: '1rem', marginBottom: '0.2rem' }}>{h.reason || 'Transaction'}</p>
                            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                              <Calendar size={12} /> {formatDate(h.date)}
                            </p>
                          </div>
                          <span style={{
                            background: h.amount > 0 ? 'rgba(52, 211, 153, 0.1)' : 'rgba(248, 113, 113, 0.1)',
                            color: h.amount > 0 ? '#34d399' : '#f87171',
                            padding: '0.5rem 1rem',
                            borderRadius: '12px',
                            fontWeight: 700,
                            fontSize: '1rem'
                          }}>
                            {h.amount > 0 ? '+' : ''}{h.amount} pts
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default Customers;
