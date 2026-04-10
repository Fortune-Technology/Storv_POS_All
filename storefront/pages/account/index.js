/**
 * My Account — profile editing, addresses, order history.
 */

import { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import Header from '../../components/layout/Header';
import Footer from '../../components/layout/Footer';
import CartDrawer from '../../components/cart/CartDrawer';
import { useAuth } from '../../lib/auth';
import { useCart } from '../../lib/cart';
import { FulfillmentIcon } from '../../components/icons';
import { User, Package, MapPin, LogOut, Save, Plus, Trash2, ChevronRight } from 'lucide-react';
import axios from 'axios';

const ECOM_API = process.env.NEXT_PUBLIC_ECOM_API_URL || 'http://localhost:5005/api';

function fmt(n) { return `$${Number(n).toFixed(2)}`; }
function fmtDate(d) { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }

export default function AccountPage() {
  const { customer, token, isLoggedIn, logout, getOrders, storeSlug } = useAuth();
  const { storeSlug: sq } = useCart();
  const router = useRouter();
  const [tab, setTab] = useState('profile');
  const [orders, setOrders] = useState([]);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isLoggedIn) { router.push(`/account/login?store=${sq}`); return; }
    loadData();
  }, [isLoggedIn]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [profileRes, ordersData] = await Promise.all([
        axios.get(`${ECOM_API}/store/${storeSlug}/auth/me`, { headers: { Authorization: `Bearer ${token}` } }),
        getOrders(),
      ]);
      setProfile(profileRes.data?.data);
      setOrders(ordersData);
    } catch {}
    setLoading(false);
  };

  const handleSaveProfile = async () => {
    if (!profile) return;
    setSaving(true);
    try {
      await axios.put(`${ECOM_API}/store/${storeSlug}/auth/me`, {
        firstName: profile.firstName, lastName: profile.lastName, phone: profile.phone, addresses: profile.addresses,
      }, { headers: { Authorization: `Bearer ${token}` } });
    } catch {}
    setSaving(false);
  };

  const handleAddAddress = () => {
    setProfile(p => ({ ...p, addresses: [...(p.addresses || []), { label: 'Home', street: '', city: '', state: '', zip: '', isDefault: false }] }));
  };

  const handleRemoveAddress = (idx) => {
    setProfile(p => ({ ...p, addresses: p.addresses.filter((_, i) => i !== idx) }));
  };

  const setAddr = (idx, field, value) => {
    setProfile(p => {
      const addrs = [...p.addresses];
      addrs[idx] = { ...addrs[idx], [field]: value };
      return { ...p, addresses: addrs };
    });
  };

  if (!isLoggedIn) return null;

  const TABS = [
    { id: 'profile', label: 'Profile', Icon: User },
    { id: 'orders', label: 'My Orders', Icon: Package },
    { id: 'addresses', label: 'Addresses', Icon: MapPin },
  ];

  return (
    <>
      <Head><title>My Account</title></Head>
      <Header />
      <CartDrawer />
      <main className="sf-container acc-main">
        <h1 className="sf-page-title sf-page-title--mb20">My Account</h1>

        <div className="acc-tabs">
          {TABS.map(t => (
            <button key={t.id} className={`acc-tab ${tab === t.id ? 'acc-tab--active' : ''}`} onClick={() => setTab(t.id)}>
              <t.Icon size={16} /> {t.label}
            </button>
          ))}
          <button className="acc-tab acc-tab--logout" onClick={() => { logout(); router.push(`/?store=${sq}`); }}>
            <LogOut size={16} /> Sign Out
          </button>
        </div>

        {loading ? <p className="acc-loading">Loading...</p> : (
          <>
            {/* Profile Tab */}
            {tab === 'profile' && profile && (
              <div className="acc-section">
                <div className="acc-avatar-row">
                  <div className="acc-avatar-lg">{profile.firstName?.charAt(0)?.toUpperCase() || profile.name?.charAt(0)?.toUpperCase() || '?'}</div>
                  <div>
                    <div className="acc-name-lg">{profile.firstName} {profile.lastName}</div>
                    <div className="acc-email-sm">{profile.email}</div>
                    <div className="acc-member-since">Member since {fmtDate(profile.createdAt)}</div>
                  </div>
                </div>

                <div className="acc-form-grid">
                  <div className="acc-field">
                    <label className="acc-label">First Name</label>
                    <input className="acc-input" value={profile.firstName || ''} onChange={e => setProfile(p => ({ ...p, firstName: e.target.value }))} />
                  </div>
                  <div className="acc-field">
                    <label className="acc-label">Last Name</label>
                    <input className="acc-input" value={profile.lastName || ''} onChange={e => setProfile(p => ({ ...p, lastName: e.target.value }))} />
                  </div>
                  <div className="acc-field">
                    <label className="acc-label">Email</label>
                    <input className="acc-input acc-input--disabled" value={profile.email} disabled />
                  </div>
                  <div className="acc-field">
                    <label className="acc-label">Phone</label>
                    <input className="acc-input" value={profile.phone || ''} onChange={e => setProfile(p => ({ ...p, phone: e.target.value }))} placeholder="(555) 123-4567" />
                  </div>
                </div>

                <div className="acc-stats-row">
                  <div className="acc-stat"><span className="acc-stat-num">{profile.orderCount}</span><span className="acc-stat-label">Orders</span></div>
                  <div className="acc-stat"><span className="acc-stat-num">{fmt(profile.totalSpent)}</span><span className="acc-stat-label">Total Spent</span></div>
                </div>

                <button className="acc-save-btn" onClick={handleSaveProfile} disabled={saving}>
                  <Save size={16} /> {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            )}

            {/* Orders Tab */}
            {tab === 'orders' && (
              <div className="acc-section">
                {orders.length === 0 ? (
                  <div className="sf-empty"><Package size={48} className="acc-empty-icon" /><p>No orders yet</p><Link href={`/products?store=${sq}`} className="sc-continue-btn sc-continue-btn--mt12">Start Shopping</Link></div>
                ) : (
                  <div className="acc-order-list">
                    {orders.map(o => (
                      <Link key={o.id} href={`/account/orders/${o.id}?store=${sq}`} className="acc-order-card">
                        <div className="acc-order-header">
                          <span className="acc-order-number">{o.orderNumber}</span>
                          <span className={`acc-order-status acc-order-status--${o.status}`}>{o.status}</span>
                        </div>
                        <div className="acc-order-meta">
                          <span>{fmtDate(o.createdAt)}</span>
                          <span className="acc-fulfillment-type"><FulfillmentIcon type={o.fulfillmentType} /> {o.fulfillmentType === 'pickup' ? 'Pickup' : 'Delivery'}</span>
                          <span className="acc-order-total">{fmt(o.grandTotal)}</span>
                        </div>
                        <div className="acc-order-items">
                          {(Array.isArray(o.lineItems) ? o.lineItems : []).slice(0, 3).map((it, i) => (
                            <span key={i} className="acc-order-item">{it.name} x {it.qty}</span>
                          ))}
                        </div>
                        <ChevronRight size={16} className="acc-order-arrow" />
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Addresses Tab */}
            {tab === 'addresses' && profile && (
              <div className="acc-section">
                {(profile.addresses || []).map((addr, idx) => (
                  <div key={idx} className="acc-address-card">
                    <div className="acc-address-header">
                      <input className="acc-input acc-input--sm acc-input--label" value={addr.label || ''} onChange={e => setAddr(idx, 'label', e.target.value)} placeholder="Label (Home, Work...)" />
                      <button className="acc-remove-btn" onClick={() => handleRemoveAddress(idx)}><Trash2 size={14} /></button>
                    </div>
                    <div className="acc-form-grid">
                      <div className="acc-field acc-field--full"><label className="acc-label">Street</label><input className="acc-input" value={addr.street || ''} onChange={e => setAddr(idx, 'street', e.target.value)} /></div>
                      <div className="acc-field"><label className="acc-label">City</label><input className="acc-input" value={addr.city || ''} onChange={e => setAddr(idx, 'city', e.target.value)} /></div>
                      <div className="acc-field"><label className="acc-label">State</label><input className="acc-input" value={addr.state || ''} onChange={e => setAddr(idx, 'state', e.target.value)} /></div>
                      <div className="acc-field"><label className="acc-label">ZIP</label><input className="acc-input" value={addr.zip || ''} onChange={e => setAddr(idx, 'zip', e.target.value)} /></div>
                    </div>
                  </div>
                ))}
                <button className="acc-add-addr-btn" onClick={handleAddAddress}><Plus size={16} /> Add Address</button>
                <button className="acc-save-btn acc-save-btn--mt16" onClick={handleSaveProfile} disabled={saving}>
                  <Save size={16} /> {saving ? 'Saving...' : 'Save Addresses'}
                </button>
              </div>
            )}
          </>
        )}
      </main>
      <Footer />
    </>
  );
}

export async function getServerSideProps(ctx) {
  const { withStore } = await import('../../lib/resolveStore.js');
  return withStore(ctx);
}
