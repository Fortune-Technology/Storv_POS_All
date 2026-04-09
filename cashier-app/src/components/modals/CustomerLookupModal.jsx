/**
 * CustomerLookupModal.jsx
 *
 * Search for a customer to attach to the active cart transaction.
 * Also supports quick-creating a new customer inline.
 * Shows loyalty points balance and lets cashier redeem rewards.
 *
 * Props:
 *   onClose  — close the modal
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Search, User, Star, X, UserCheck, UserPlus, Phone, Mail,
  Check, RefreshCw, Gift, Zap, ChevronRight,
} from 'lucide-react';
import { useCartStore }  from '../../stores/useCartStore.js';
import { useAuthStore }  from '../../stores/useAuthStore.js';
import { searchCustomers, createCustomer, getLoyaltyConfig } from '../../api/pos.js';

export default function CustomerLookupModal({ onClose }) {
  const setCustomer          = useCartStore(s => s.setCustomer);
  const clearCustomer        = useCartStore(s => s.clearCustomer);
  const current              = useCartStore(s => s.customer);
  const applyLoyaltyRedemption  = useCartStore(s => s.applyLoyaltyRedemption);
  const removeLoyaltyRedemption = useCartStore(s => s.removeLoyaltyRedemption);
  const loyaltyRedemption    = useCartStore(s => s.loyaltyRedemption);
  const cashier              = useAuthStore(s => s.cashier);
  const station              = useAuthStore(s => s.station);

  const [tab,      setTab]     = useState('search');   // 'search' | 'create' | 'redeem'
  const [query,    setQuery]   = useState('');
  const [results,  setResults] = useState([]);
  const [loading,  setLoading] = useState(false);

  // Create form state
  const [newFirst,  setNewFirst]  = useState('');
  const [newLast,   setNewLast]   = useState('');
  const [newPhone,  setNewPhone]  = useState('');
  const [newEmail,  setNewEmail]  = useState('');
  const [creating,  setCreating]  = useState(false);
  const [createErr, setCreateErr] = useState('');

  // Loyalty config
  const [loyaltyConfig, setLoyaltyConfig] = useState(null);
  const [loyaltyLoading, setLoyaltyLoading] = useState(false);

  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, [tab]);

  // Load loyalty config for this store
  const storeId = station?.storeId || cashier?.storeId;
  useEffect(() => {
    if (!storeId) return;
    setLoyaltyLoading(true);
    getLoyaltyConfig(storeId)
      .then(cfg => setLoyaltyConfig(cfg))
      .catch(() => setLoyaltyConfig(null))
      .finally(() => setLoyaltyLoading(false));
  }, [storeId]);

  /* ── Debounced search ─────────────────────────────────────────────────────── */
  useEffect(() => {
    if (tab !== 'search') return;
    if (!query.trim()) { setResults([]); return; }
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await searchCustomers(query.trim(), storeId);
        setResults(data);
      } catch { setResults([]); }
      finally { setLoading(false); }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, tab]);

  /* ── Attach customer to cart ─────────────────────────────────────────────── */
  const attach = (c) => {
    setCustomer({
      id:            c.id || c._id,
      name:          c.name || [c.firstName, c.lastName].filter(Boolean).join(' ') || 'Customer',
      phone:         c.phone         || null,
      email:         c.email         || null,
      loyaltyPoints: c.loyaltyPoints ?? null,
      cardNo:        c.cardNo        || null,
      discount:      c.discount      ?? null,
    });
    // If there's already a redemption applied, clear it since customer changed
    removeLoyaltyRedemption();
    onClose();
  };

  const detach = () => { clearCustomer(); removeLoyaltyRedemption(); onClose(); };

  /* ── Loyalty redemption ──────────────────────────────────────────────────── */
  const applyReward = (reward) => {
    applyLoyaltyRedemption({
      rewardId:      reward.id,
      rewardName:    reward.name,
      pointsCost:    reward.pointsCost,
      discountType:  reward.rewardType,    // 'dollar_off' | 'pct_off'
      discountValue: Number(reward.rewardValue),
    });
    onClose();
  };

  const removeReward = () => {
    removeLoyaltyRedemption();
  };

  // Rewards the customer can afford
  const affordableRewards = (() => {
    if (!loyaltyConfig?.enabled || !loyaltyConfig.rewards?.length) return [];
    const pts = current?.loyaltyPoints ?? 0;
    return loyaltyConfig.rewards.filter(r => r.active && r.pointsCost <= pts);
  })();

  /* ── Quick create ────────────────────────────────────────────────────────── */
  const handleCreate = async (e) => {
    e.preventDefault();
    setCreateErr('');
    if (!newFirst.trim() && !newLast.trim() && !newPhone.trim()) {
      setCreateErr('Enter at least a name or phone number.');
      return;
    }
    setCreating(true);
    try {
      const customer = await createCustomer({
        firstName: newFirst.trim()  || undefined,
        lastName:  newLast.trim()   || undefined,
        phone:     newPhone.trim()  || undefined,
        email:     newEmail.trim()  || undefined,
        storeId:   storeId          || undefined,
      });
      attach(customer);
    } catch (err) {
      setCreateErr(err?.response?.data?.error || 'Failed to create customer.');
    } finally {
      setCreating(false);
    }
  };

  /* ── Has loyalty program ─────────────────────────────────────────────────── */
  const hasLoyalty = loyaltyConfig?.enabled && current?.loyaltyPoints != null;

  /* ── Styles ──────────────────────────────────────────────────────────────── */
  const s = {
    overlay: {
      position: 'fixed', inset: 0, zIndex: 150,
      background: 'rgba(0,0,0,.65)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '1rem',
    },
    card: {
      background: 'var(--bg-panel)', borderRadius: 18,
      border: '1px solid var(--border-light)',
      width: '100%', maxWidth: 460,
      boxShadow: '0 24px 60px rgba(0,0,0,.5)',
      display: 'flex', flexDirection: 'column', maxHeight: '90vh',
    },
    header: {
      padding: '1.1rem 1.5rem', borderBottom: '1px solid var(--border)',
      display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
    },
    tabBar: {
      display: 'flex', gap: 4,
      padding: '0.6rem 1rem 0',
      borderBottom: '1px solid var(--border)',
      flexShrink: 0,
    },
    tab: (active) => ({
      flex: 1, padding: '0.45rem', borderRadius: '8px 8px 0 0',
      border: 'none', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 700,
      background: active ? 'var(--bg-input)' : 'transparent',
      color: active ? 'var(--text-primary)' : 'var(--text-muted)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
      borderBottom: active ? '2px solid var(--green)' : '2px solid transparent',
    }),
    body: { padding: '1rem 1.5rem', overflowY: 'auto', flex: 1 },
    currentBox: {
      background: 'rgba(122,193,67,.08)', border: '1px solid rgba(122,193,67,.25)',
      borderRadius: 10, padding: '0.7rem 0.875rem', marginBottom: '0.875rem',
      display: 'flex', alignItems: 'center', gap: 10,
    },
    searchWrap: { position: 'relative', marginBottom: '0.75rem' },
    searchInput: {
      width: '100%', boxSizing: 'border-box',
      paddingLeft: '2.25rem', height: 44,
      background: 'var(--bg-input)', border: '1px solid var(--border-light)',
      borderRadius: 10, color: 'var(--text-primary)', fontSize: '0.88rem',
    },
    resultList: { maxHeight: 240, overflowY: 'auto' },
    resultRow: {
      width: '100%', padding: '0.7rem 0.5rem', textAlign: 'left',
      background: 'none', border: 'none',
      borderBottom: '1px solid var(--border)', cursor: 'pointer',
      display: 'flex', alignItems: 'center', gap: 10, borderRadius: 0,
    },
    avatar: {
      width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
      background: 'var(--bg-input)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    },
    formLabel: {
      display: 'flex', flexDirection: 'column', gap: 4,
      fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)',
      textTransform: 'uppercase', letterSpacing: '0.05em',
      marginBottom: '0.625rem',
    },
    formInput: {
      padding: '0.5rem 0.7rem', borderRadius: 8,
      background: 'var(--bg-input)', border: '1px solid var(--border-light)',
      color: 'var(--text-primary)', fontSize: '0.88rem', width: '100%',
      boxSizing: 'border-box',
    },
    formRow: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.625rem' },
    submitBtn: {
      width: '100%', padding: '0.6rem', borderRadius: 10, marginTop: '1rem',
      background: 'var(--green)', border: 'none',
      color: '#fff', fontWeight: 800, fontSize: '0.88rem', cursor: 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    },
    errBox: {
      background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)',
      borderRadius: 8, padding: '0.5rem 0.75rem',
      color: '#ef4444', fontSize: '0.78rem', marginTop: '0.5rem',
    },
  };

  const tabCount = hasLoyalty ? 3 : 2;

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.card} onClick={e => e.stopPropagation()}>

        {/* ── Header ── */}
        <div style={s.header}>
          <UserCheck size={18} color="var(--green)" />
          <div style={{ flex: 1, fontWeight: 800, color: 'var(--text-primary)' }}>Customer</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <X size={16} />
          </button>
        </div>

        {/* ── Tab bar ── */}
        <div style={s.tabBar}>
          <button style={s.tab(tab === 'search')} onClick={() => setTab('search')}>
            <Search size={13} /> Search
          </button>
          <button style={s.tab(tab === 'create')} onClick={() => setTab('create')}>
            <UserPlus size={13} /> New Customer
          </button>
          {hasLoyalty && (
            <button style={s.tab(tab === 'redeem')} onClick={() => setTab('redeem')}>
              <Gift size={13} /> Rewards
              {affordableRewards.length > 0 && (
                <span style={{
                  background: '#f59e0b', color: '#000',
                  fontSize: '0.62rem', fontWeight: 900,
                  borderRadius: '99px', padding: '0 5px', lineHeight: '15px',
                }}>{affordableRewards.length}</span>
              )}
            </button>
          )}
        </div>

        {/* ── Body ── */}
        <div style={s.body}>

          {/* ════ SEARCH TAB ════ */}
          {tab === 'search' && (
            <>
              {/* Currently attached */}
              {current && (
                <div style={s.currentBox}>
                  <User size={15} color="var(--green)" />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, color: 'var(--green)', fontSize: '0.88rem' }}>{current.name}</div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      {current.phone && <span><Phone size={9} style={{ display:'inline', marginRight: 3 }}/>{current.phone}</span>}
                      {current.loyaltyPoints != null && (
                        <span style={{ color: '#f59e0b', fontWeight: 700 }}>
                          <Star size={9} style={{ display:'inline', marginRight: 3 }}/>{current.loyaltyPoints.toLocaleString()} pts
                        </span>
                      )}
                      {current.discount != null && <span>{(parseFloat(current.discount)*100).toFixed(1)}% off</span>}
                    </div>
                  </div>
                  <button onClick={detach} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                    <X size={14} />
                  </button>
                </div>
              )}

              {/* Applied redemption indicator */}
              {loyaltyRedemption && (
                <div style={{
                  background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)',
                  borderRadius: 8, padding: '0.5rem 0.75rem', marginBottom: '0.75rem',
                  display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.78rem',
                }}>
                  <Gift size={12} color="#f59e0b" />
                  <div style={{ flex: 1 }}>
                    <span style={{ fontWeight: 700 }}>{loyaltyRedemption.rewardName}</span>
                    {' '}· {loyaltyRedemption.pointsCost.toLocaleString()} pts
                    {' '}→ {loyaltyRedemption.discountType === 'dollar_off'
                      ? `$${Number(loyaltyRedemption.discountValue).toFixed(2)} off`
                      : `${loyaltyRedemption.discountValue}% off`}
                  </div>
                  <button onClick={removeReward}
                    style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                    <X size={13} />
                  </button>
                </div>
              )}

              {/* Search input */}
              <div style={s.searchWrap}>
                <Search size={14} color="var(--text-muted)" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Name, phone or email…"
                  style={s.searchInput}
                />
              </div>

              {/* Results */}
              <div style={s.resultList}>
                {loading && (
                  <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1rem', fontSize: '0.83rem' }}>
                    <RefreshCw size={14} style={{ display: 'inline', animation: 'spin 0.8s linear infinite', marginRight: 6 }} />
                    Searching…
                  </div>
                )}
                {!loading && query.trim() && results.length === 0 && (
                  <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1.5rem 0', fontSize: '0.83rem' }}>
                    No customers found.{' '}
                    <button
                      onClick={() => { setTab('create'); setNewPhone(query.trim().match(/^\d/) ? query.trim() : ''); setNewFirst(!query.trim().match(/^\d/) ? query.trim() : ''); }}
                      style={{ background: 'none', border: 'none', color: 'var(--green)', cursor: 'pointer', fontWeight: 700 }}
                    >
                      Add new?
                    </button>
                  </div>
                )}
                {results.map(c => {
                  const name = c.name || [c.firstName, c.lastName].filter(Boolean).join(' ') || 'Unknown';
                  const init = name.charAt(0).toUpperCase();
                  return (
                    <button
                      key={c.id || c._id}
                      onClick={() => attach(c)}
                      style={s.resultRow}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'none'}
                    >
                      <div style={{ ...s.avatar, background: 'rgba(122,193,67,0.15)', color: 'var(--green)', fontWeight: 800, fontSize: '0.85rem' }}>
                        {init}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.88rem' }}>{name}</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'flex', gap: 8 }}>
                          {c.phone && <span>{c.phone}</span>}
                          {c.email && <span>{c.email}</span>}
                          {!c.phone && !c.email && <span>No contact info</span>}
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, flexShrink: 0 }}>
                        {c.loyaltyPoints != null && (
                          <div style={{ fontSize: '0.7rem', color: '#f59e0b', fontWeight: 700 }}>
                            <Star size={9} style={{ display: 'inline', marginRight: 3 }} />
                            {c.loyaltyPoints.toLocaleString()} pts
                          </div>
                        )}
                        {c.discount != null && parseFloat(c.discount) > 0 && (
                          <div style={{ fontSize: '0.68rem', color: '#10b981', fontWeight: 700 }}>
                            {(parseFloat(c.discount) * 100).toFixed(1)}% off
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {/* ════ CREATE TAB ════ */}
          {tab === 'create' && (
            <form onSubmit={handleCreate}>
              <div style={s.formRow}>
                <label style={s.formLabel}>
                  First Name
                  <input ref={inputRef} style={s.formInput} value={newFirst} onChange={e => setNewFirst(e.target.value)} placeholder="Jane" />
                </label>
                <label style={s.formLabel}>
                  Last Name
                  <input style={s.formInput} value={newLast} onChange={e => setNewLast(e.target.value)} placeholder="Smith" />
                </label>
              </div>
              <label style={s.formLabel}>
                Phone
                <input style={s.formInput} value={newPhone} onChange={e => setNewPhone(e.target.value)} placeholder="555-000-1234" type="tel" />
              </label>
              <label style={{ ...s.formLabel, marginTop: '0.5rem' }}>
                Email (optional)
                <input style={s.formInput} value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="jane@example.com" type="email" />
              </label>

              {createErr && <div style={s.errBox}>{createErr}</div>}

              <button type="submit" style={s.submitBtn} disabled={creating}>
                {creating ? <RefreshCw size={15} style={{ animation: 'spin 0.8s linear infinite' }} /> : <Check size={15} />}
                {creating ? 'Creating…' : 'Add & Attach Customer'}
              </button>
            </form>
          )}

          {/* ════ REWARDS TAB ════ */}
          {tab === 'redeem' && hasLoyalty && (
            <div>
              {/* Customer points summary */}
              <div style={{
                background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)',
                borderRadius: 10, padding: '0.75rem 1rem', marginBottom: '1rem',
                display: 'flex', alignItems: 'center', gap: 10,
              }}>
                <Star size={16} color="#f59e0b" />
                <div>
                  <div style={{ fontWeight: 800, color: '#f59e0b', fontSize: '1rem' }}>
                    {(current?.loyaltyPoints ?? 0).toLocaleString()} pts
                  </div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                    {current?.name}'s balance
                  </div>
                </div>
                {loyaltyRedemption && (
                  <div style={{
                    marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5,
                    background: 'rgba(122,193,67,0.1)', borderRadius: 8, padding: '0.25rem 0.6rem',
                    fontSize: '0.72rem', color: 'var(--green)', fontWeight: 700,
                  }}>
                    <Check size={10} /> Applied
                  </div>
                )}
              </div>

              {/* Active redemption */}
              {loyaltyRedemption && (
                <div style={{
                  background: 'rgba(122,193,67,0.08)', border: '1px solid rgba(122,193,67,0.25)',
                  borderRadius: 10, padding: '0.7rem 0.875rem', marginBottom: '0.875rem',
                  display: 'flex', alignItems: 'center', gap: 10,
                }}>
                  <Gift size={14} color="var(--green)" />
                  <div style={{ flex: 1, fontSize: '0.82rem' }}>
                    <strong>{loyaltyRedemption.rewardName}</strong>
                    {' '}— {loyaltyRedemption.discountType === 'dollar_off'
                      ? `$${Number(loyaltyRedemption.discountValue).toFixed(2)} off`
                      : `${loyaltyRedemption.discountValue}% off`}
                    <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>
                      ({loyaltyRedemption.pointsCost.toLocaleString()} pts)
                    </span>
                  </div>
                  <button onClick={removeReward}
                    style={{ background: 'rgba(239,68,68,0.08)', border: 'none', borderRadius: 6, padding: '4px 8px', color: '#ef4444', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 700 }}>
                    Remove
                  </button>
                </div>
              )}

              {/* Available rewards */}
              {loyaltyLoading ? (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1rem', fontSize: '0.83rem' }}>
                  <RefreshCw size={14} style={{ display: 'inline', marginRight: 6, animation: 'spin 0.8s linear infinite' }} />
                  Loading…
                </div>
              ) : loyaltyConfig?.rewards?.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1.5rem 0', fontSize: '0.83rem' }}>
                  No rewards configured for this store.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {loyaltyConfig.rewards
                    .filter(r => r.active)
                    .sort((a, b) => a.sortOrder - b.sortOrder || a.pointsCost - b.pointsCost)
                    .map(reward => {
                      const pts        = current?.loyaltyPoints ?? 0;
                      const canAfford  = pts >= reward.pointsCost;
                      const isApplied  = loyaltyRedemption?.rewardId === reward.id;
                      return (
                        <button
                          key={reward.id}
                          onClick={() => canAfford ? (isApplied ? removeReward() : applyReward(reward)) : null}
                          disabled={!canAfford}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 10,
                            padding: '0.7rem 0.875rem', borderRadius: 10, textAlign: 'left',
                            border: isApplied
                              ? '1.5px solid var(--green)'
                              : '1px solid var(--border-light)',
                            background: isApplied
                              ? 'rgba(122,193,67,0.08)'
                              : canAfford ? 'var(--bg-panel)' : 'var(--bg-input)',
                            cursor: canAfford ? 'pointer' : 'not-allowed',
                            opacity: canAfford ? 1 : 0.55,
                            width: '100%',
                          }}
                          onMouseEnter={e => { if (canAfford && !isApplied) e.currentTarget.style.background = 'var(--bg-hover)'; }}
                          onMouseLeave={e => { if (!isApplied) e.currentTarget.style.background = canAfford ? 'var(--bg-panel)' : 'var(--bg-input)'; }}
                        >
                          <div style={{
                            width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                            background: isApplied ? 'rgba(122,193,67,0.15)' : 'var(--bg-hover)',
                            color: isApplied ? 'var(--green)' : 'var(--text-muted)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}>
                            <Gift size={14} />
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.85rem' }}>
                              {reward.name}
                            </div>
                            {reward.description && (
                              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{reward.description}</div>
                            )}
                          </div>
                          <div style={{ flexShrink: 0, textAlign: 'right' }}>
                            <div style={{ fontWeight: 800, color: '#f59e0b', fontSize: '0.82rem' }}>
                              {reward.pointsCost.toLocaleString()} pts
                            </div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--green)', fontWeight: 700 }}>
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
