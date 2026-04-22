/**
 * CustomerLookupModal.jsx — Search/create/attach customer + loyalty rewards
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Search, User, Star, X, UserCheck, UserPlus, Phone,
  Check, RefreshCw, Gift,
} from 'lucide-react';
import { useCartStore }  from '../../stores/useCartStore.js';
import { useAuthStore }  from '../../stores/useAuthStore.js';
import { searchCustomers, createCustomer, getLoyaltyConfig } from '../../api/pos.js';
import './CustomerLookupModal.css';

export default function CustomerLookupModal({ onClose }) {
  const setCustomer          = useCartStore(s => s.setCustomer);
  const clearCustomer        = useCartStore(s => s.clearCustomer);
  const current              = useCartStore(s => s.customer);
  const applyLoyaltyRedemption  = useCartStore(s => s.applyLoyaltyRedemption);
  const removeLoyaltyRedemption = useCartStore(s => s.removeLoyaltyRedemption);
  const loyaltyRedemption    = useCartStore(s => s.loyaltyRedemption);
  const cashier              = useAuthStore(s => s.cashier);
  const station              = useAuthStore(s => s.station);

  const [tab, setTab] = useState('search');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  // Richer create form — mirrors the back-office Customers.jsx CustomerForm
  // so cashiers and managers see the exact same fields in the same layout.
  // Session 39 — "New customer form = back-office form" requirement.
  const [newFirst, setNewFirst] = useState('');
  const [newLast, setNewLast] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newCardNo, setNewCardNo] = useState('');
  const [newLoyaltyPoints, setNewLoyaltyPoints] = useState('');
  const [newDiscount, setNewDiscount] = useState('');
  const [newBalance, setNewBalance] = useState('');
  const [newBalanceLimit, setNewBalanceLimit] = useState('');
  const [newInstoreCharge, setNewInstoreCharge] = useState(false);
  const [newBirthDate, setNewBirthDate] = useState('');
  const [newExpDate, setNewExpDate] = useState('');
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState('');

  const [loyaltyConfig, setLoyaltyConfig] = useState(null);
  const [loyaltyLoading, setLoyaltyLoading] = useState(false);

  const inputRef = useRef(null);
  useEffect(() => { inputRef.current?.focus(); }, [tab]);

  const storeId = station?.storeId || cashier?.storeId;
  useEffect(() => {
    if (!storeId) return;
    setLoyaltyLoading(true);
    getLoyaltyConfig(storeId).then(cfg => setLoyaltyConfig(cfg)).catch(() => setLoyaltyConfig(null)).finally(() => setLoyaltyLoading(false));
  }, [storeId]);

  useEffect(() => {
    if (tab !== 'search') return;
    if (!query.trim()) { setResults([]); return; }
    const timer = setTimeout(async () => {
      setLoading(true);
      try { setResults(await searchCustomers(query.trim(), storeId)); } catch { setResults([]); }
      finally { setLoading(false); }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, tab]);

  const attach = (c) => {
    setCustomer({
      id: c.id || c._id,
      name: c.name || [c.firstName, c.lastName].filter(Boolean).join(' ') || 'Customer',
      phone: c.phone || null, email: c.email || null,
      loyaltyPoints: c.loyaltyPoints ?? null, cardNo: c.cardNo || null, discount: c.discount ?? null,
    });
    removeLoyaltyRedemption();
    onClose();
  };

  const detach = () => { clearCustomer(); removeLoyaltyRedemption(); onClose(); };

  const applyReward = (reward) => {
    applyLoyaltyRedemption({
      rewardId: reward.id, rewardName: reward.name, pointsCost: reward.pointsCost,
      discountType: reward.rewardType, discountValue: Number(reward.rewardValue),
    });
    onClose();
  };

  const removeReward = () => removeLoyaltyRedemption();

  const affordableRewards = (() => {
    if (!loyaltyConfig?.enabled || !loyaltyConfig.rewards?.length) return [];
    const pts = current?.loyaltyPoints ?? 0;
    return loyaltyConfig.rewards.filter(r => r.active && r.pointsCost <= pts);
  })();

  const handleCreate = async (e) => {
    e.preventDefault();
    setCreateErr('');
    // Q7 — name required, at least one of {phone, email} required, everything else optional
    const hasName = !!(newFirst.trim() || newLast.trim());
    const hasContact = !!(newPhone.trim() || newEmail.trim());
    if (!hasName) { setCreateErr('First or last name is required.'); return; }
    if (!hasContact) { setCreateErr('Enter a phone number or email.'); return; }
    setCreating(true);
    try {
      const payload = {
        firstName:     newFirst.trim() || undefined,
        lastName:      newLast.trim()  || undefined,
        phone:         newPhone.trim() || undefined,
        email:         newEmail.trim() || undefined,
        cardNo:        newCardNo.trim() || undefined,
        loyaltyPoints: newLoyaltyPoints !== '' ? parseInt(newLoyaltyPoints, 10) : 0,
        // discount stored as decimal — matches back-office convention (5% → 0.05)
        discount:      newDiscount !== ''     ? parseFloat(newDiscount) / 100 : null,
        balance:       newBalance !== ''      ? parseFloat(newBalance)      : null,
        balanceLimit:  newBalanceLimit !== '' ? parseFloat(newBalanceLimit) : null,
        instoreChargeEnabled: newInstoreCharge,
        birthDate:     newBirthDate || undefined,
        expirationDate: newExpDate  || undefined,
        storeId:       storeId || undefined,
      };
      const customer = await createCustomer(payload);
      attach(customer);
    } catch (err) {
      setCreateErr(err?.response?.data?.error || 'Failed to create customer.');
    } finally { setCreating(false); }
  };

  const hasLoyalty = loyaltyConfig?.enabled && current?.loyaltyPoints != null;

  return (
    <div className="clm-backdrop" onClick={onClose}>
      <div className="clm-modal" onClick={e => e.stopPropagation()}>

        <div className="clm-header">
          <UserCheck size={18} color="var(--green)" />
          <div className="clm-header-title">Customer</div>
          <button className="clm-close-btn" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="clm-tabs">
          <button className={`clm-tab${tab === 'search' ? ' clm-tab--active' : ''}`} onClick={() => setTab('search')}>
            <Search size={13} /> Search
          </button>
          <button className={`clm-tab${tab === 'create' ? ' clm-tab--active' : ''}`} onClick={() => setTab('create')}>
            <UserPlus size={13} /> New Customer
          </button>
          {hasLoyalty && (
            <button className={`clm-tab${tab === 'redeem' ? ' clm-tab--active' : ''}`} onClick={() => setTab('redeem')}>
              <Gift size={13} /> Rewards
              {affordableRewards.length > 0 && <span className="clm-tab-badge">{affordableRewards.length}</span>}
            </button>
          )}
        </div>

        <div className="clm-body">

          {/* SEARCH TAB */}
          {tab === 'search' && (
            <>
              {current && (
                <div className="clm-current">
                  <User size={15} color="var(--green)" />
                  <div style={{ flex: 1 }}>
                    <div className="clm-current-name">{current.name}</div>
                    <div className="clm-current-meta">
                      {current.phone && <span><Phone size={9} /> {current.phone}</span>}
                      {current.loyaltyPoints != null && <span className="clm-current-points"><Star size={9} /> {current.loyaltyPoints.toLocaleString()} pts</span>}
                      {current.discount != null && <span>{(parseFloat(current.discount)*100).toFixed(1)}% off</span>}
                    </div>
                  </div>
                  <button className="clm-current-remove" onClick={detach}><X size={14} /></button>
                </div>
              )}

              {loyaltyRedemption && (
                <div className="clm-redemption">
                  <Gift size={12} color="#f59e0b" />
                  <div style={{ flex: 1 }}>
                    <span className="clm-redemption-name">{loyaltyRedemption.rewardName}</span>
                    {' '} - {loyaltyRedemption.pointsCost.toLocaleString()} pts
                    {' '} = {loyaltyRedemption.discountType === 'dollar_off'
                      ? `$${Number(loyaltyRedemption.discountValue).toFixed(2)} off`
                      : `${loyaltyRedemption.discountValue}% off`}
                  </div>
                  <button className="clm-redemption-remove" onClick={removeReward}><X size={13} /></button>
                </div>
              )}

              <div className="clm-search-wrap">
                <Search size={14} color="var(--text-muted)" className="clm-search-icon" />
                <input ref={inputRef} className="clm-search-input" value={query} onChange={e => setQuery(e.target.value)} placeholder="Name, phone or email..." />
              </div>

              <div className="clm-results">
                {loading && <div className="clm-loading"><RefreshCw size={14} /> Searching...</div>}
                {!loading && query.trim() && results.length === 0 && (
                  <div className="clm-no-results">
                    No customers found.{' '}
                    <button className="clm-add-new-link"
                      onClick={() => { setTab('create'); setNewPhone(query.trim().match(/^\d/) ? query.trim() : ''); setNewFirst(!query.trim().match(/^\d/) ? query.trim() : ''); }}>
                      Add new?
                    </button>
                  </div>
                )}
                {results.map(c => {
                  const name = c.name || [c.firstName, c.lastName].filter(Boolean).join(' ') || 'Unknown';
                  return (
                    <button key={c.id || c._id} className="clm-result-row" onClick={() => attach(c)}>
                      <div className="clm-avatar">{name.charAt(0).toUpperCase()}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="clm-result-name">{name}</div>
                        <div className="clm-result-meta">
                          {c.phone && <span>{c.phone}</span>}
                          {c.email && <span>{c.email}</span>}
                          {!c.phone && !c.email && <span>No contact info</span>}
                        </div>
                      </div>
                      <div className="clm-result-right">
                        {c.loyaltyPoints != null && <div className="clm-result-points"><Star size={9} /> {c.loyaltyPoints.toLocaleString()} pts</div>}
                        {c.discount != null && parseFloat(c.discount) > 0 && <div className="clm-result-discount">{(parseFloat(c.discount) * 100).toFixed(1)}% off</div>}
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {/* CREATE TAB — mirrors the back-office Customers form layout.
              Required: name (first or last) + (phone OR email). Everything
              else is optional. */}
          {tab === 'create' && (
            <form onSubmit={handleCreate}>
              {/* Name row */}
              <div className="clm-form-row">
                <label className="clm-form-label">First Name
                  <input ref={inputRef} className="clm-form-input" value={newFirst}
                    onChange={e => setNewFirst(e.target.value)} placeholder="Jane" />
                </label>
                <label className="clm-form-label">Last Name
                  <input className="clm-form-input" value={newLast}
                    onChange={e => setNewLast(e.target.value)} placeholder="Smith" />
                </label>
              </div>

              {/* Contact row — at least one required */}
              <div className="clm-form-row">
                <label className="clm-form-label">Phone
                  <input className="clm-form-input" value={newPhone}
                    onChange={e => setNewPhone(e.target.value)}
                    placeholder="555-000-1234" type="tel" />
                </label>
                <label className="clm-form-label">Email
                  <input className="clm-form-input" value={newEmail}
                    onChange={e => setNewEmail(e.target.value)}
                    placeholder="jane@example.com" type="email" />
                </label>
              </div>

              {/* Card + loyalty points */}
              <div className="clm-form-row">
                <label className="clm-form-label">Card Number (optional)
                  <input className="clm-form-input" value={newCardNo}
                    onChange={e => setNewCardNo(e.target.value)}
                    placeholder="Loyalty card #" />
                </label>
                <label className="clm-form-label">Loyalty Points
                  <input className="clm-form-input" value={newLoyaltyPoints}
                    onChange={e => setNewLoyaltyPoints(e.target.value)}
                    type="number" min="0" step="1" placeholder="0" />
                </label>
              </div>

              {/* Discount + balance + balance limit */}
              <div className="clm-form-row">
                <label className="clm-form-label">Discount (%)
                  <input className="clm-form-input" value={newDiscount}
                    onChange={e => setNewDiscount(e.target.value)}
                    type="number" min="0" max="100" step="0.1" placeholder="e.g. 5" />
                </label>
                <label className="clm-form-label">Balance ($)
                  <input className="clm-form-input" value={newBalance}
                    onChange={e => setNewBalance(e.target.value)}
                    type="number" step="0.01" placeholder="0.00" />
                </label>
                <label className="clm-form-label">Balance Limit ($)
                  <input className="clm-form-input" value={newBalanceLimit}
                    onChange={e => setNewBalanceLimit(e.target.value)}
                    type="number" step="0.01" min="0" placeholder="0.00" />
                </label>
              </div>

              {/* Dates */}
              <div className="clm-form-row">
                <label className="clm-form-label">Birth Date
                  <input className="clm-form-input" value={newBirthDate}
                    min="1900-01-01" max="2100-12-31"
                    onChange={e => setNewBirthDate(e.target.value)} type="date" />
                </label>
                <label className="clm-form-label">Expiration Date
                  <input className="clm-form-input" value={newExpDate}
                    min="1900-01-01" max="2100-12-31"
                    onChange={e => setNewExpDate(e.target.value)} type="date" />
                </label>
              </div>

              {/* In-store charge toggle */}
              <div className="clm-toggle-row">
                <span>In-Store Charge Account</span>
                <button type="button"
                  className={`clm-toggle${newInstoreCharge ? ' clm-toggle--on' : ''}`}
                  onClick={() => setNewInstoreCharge(v => !v)}>
                  <span className="clm-toggle-knob" />
                </button>
                <span className="clm-toggle-state">
                  {newInstoreCharge ? 'Enabled' : 'Disabled'}
                </span>
              </div>

              {createErr && <div className="clm-err-box">{createErr}</div>}
              <button type="submit" className="clm-submit-btn" disabled={creating}>
                {creating ? <RefreshCw size={15} /> : <Check size={15} />}
                {creating ? 'Creating…' : 'Add & Attach Customer'}
              </button>
            </form>
          )}

          {/* REWARDS TAB */}
          {tab === 'redeem' && hasLoyalty && (
            <div>
              <div className="clm-points-card">
                <Star size={16} color="#f59e0b" />
                <div>
                  <div className="clm-points-value">{(current?.loyaltyPoints ?? 0).toLocaleString()} pts</div>
                  <div className="clm-points-label">{current?.name}'s balance</div>
                </div>
                {loyaltyRedemption && <div className="clm-applied-badge"><Check size={10} /> Applied</div>}
              </div>

              {loyaltyRedemption && (
                <div className="clm-active-reward">
                  <Gift size={14} color="var(--green)" />
                  <div className="clm-active-reward-info" style={{ flex: 1 }}>
                    <strong>{loyaltyRedemption.rewardName}</strong>
                    {' '} -- {loyaltyRedemption.discountType === 'dollar_off'
                      ? `$${Number(loyaltyRedemption.discountValue).toFixed(2)} off`
                      : `${loyaltyRedemption.discountValue}% off`}
                    <span className="clm-active-reward-pts">({loyaltyRedemption.pointsCost.toLocaleString()} pts)</span>
                  </div>
                  <button className="clm-remove-reward-btn" onClick={removeReward}>Remove</button>
                </div>
              )}

              {loyaltyLoading ? (
                <div className="clm-loading"><RefreshCw size={14} /> Loading...</div>
              ) : loyaltyConfig?.rewards?.length === 0 ? (
                <div className="clm-no-results">No rewards configured for this store.</div>
              ) : (
                <div className="clm-rewards-list">
                  {loyaltyConfig.rewards
                    .filter(r => r.active)
                    .sort((a, b) => a.sortOrder - b.sortOrder || a.pointsCost - b.pointsCost)
                    .map(reward => {
                      const pts = current?.loyaltyPoints ?? 0;
                      const canAfford = pts >= reward.pointsCost;
                      const isApplied = loyaltyRedemption?.rewardId === reward.id;
                      return (
                        <button
                          key={reward.id}
                          className={`clm-reward-btn${isApplied ? ' clm-reward-btn--applied' : !canAfford ? ' clm-reward-btn--cant-afford clm-reward-btn--disabled' : ''}`}
                          onClick={() => canAfford ? (isApplied ? removeReward() : applyReward(reward)) : null}
                          disabled={!canAfford}
                        >
                          <div className={`clm-reward-icon${isApplied ? ' clm-reward-icon--applied' : ' clm-reward-icon--default'}`}>
                            <Gift size={14} />
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className="clm-reward-name">{reward.name}</div>
                            {reward.description && <div className="clm-reward-desc">{reward.description}</div>}
                          </div>
                          <div style={{ flexShrink: 0, textAlign: 'right' }}>
                            <div className="clm-reward-cost">{reward.pointsCost.toLocaleString()} pts</div>
                            <div className="clm-reward-value">
                              {reward.rewardType === 'dollar_off'
                                ? `$${Number(reward.rewardValue).toFixed(2)} off`
                                : `${Number(reward.rewardValue).toFixed(1)}% off`}
                            </div>
                          </div>
                          {isApplied && <Check size={14} color="var(--green)" style={{ flexShrink: 0 }} />}
                        </button>
                      );
                    })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
