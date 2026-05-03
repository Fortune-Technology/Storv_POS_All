/**
 * LoyaltyProgram.jsx
 *
 * Three-tab admin page for managing the store loyalty programme:
 *   1. Settings   — program on/off, earn rate, redemption rate, bonuses
 *   2. Earn Rules — include/exclude/multiply departments & products
 *   3. Rewards    — define redeemable reward tiers
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Star, Settings, Gift, Plus, Trash2, Edit2, Check, X,
  RefreshCw, AlertCircle, ToggleLeft, ToggleRight, Search,
  Zap, Package, Layers,
} from 'lucide-react';
import {
  getLoyaltyProgram, upsertLoyaltyProgram,
  getLoyaltyEarnRules, createLoyaltyEarnRule, updateLoyaltyEarnRule, deleteLoyaltyEarnRule,
  getLoyaltyRewards, createLoyaltyReward, updateLoyaltyReward, deleteLoyaltyReward,
  getCatalogDepartments, searchCatalogProducts,
} from '../services/api.js';
import { fmtMoney } from '../utils/formatters';
import { useConfirm } from '../hooks/useConfirmDialog.jsx';
import './LoyaltyProgram.css';

/* ────────────────────────────────────────────────────────────── helpers ── */
const fmtPts   = (n) => Number(n ?? 0).toLocaleString();
const fmtMult  = (n) => `${Number(n ?? 1).toFixed(2)}×`;

/* ══════════════════════════════════════════════════════════════════════════
   Main page
══════════════════════════════════════════════════════════════════════════ */
export default function LoyaltyProgram({ embedded, forceTab, hideHeader }) {
  const storeId = localStorage.getItem('activeStoreId');
  const [tabState, setTabState] = useState('settings');
  const tab = forceTab || tabState;
  const setTab = forceTab ? () => {} : setTabState;
  const showTabs = !forceTab;
  const showHeader = !hideHeader;

  const content = (
    <>
      {/* ── Header ── */}
      {showHeader && (
        <div className="lp-header">
          <div className="lp-header-icon"><Star size={18} /></div>
          <div>
            <h1 className="lp-title">Loyalty Program</h1>
            <p className="lp-subtitle">Manage points earning rules and rewards for your customers</p>
          </div>
        </div>
      )}

      {!storeId ? (
        <div className="lp-no-store">
          <AlertCircle size={28} />
          <p>Please select a store to manage loyalty settings.</p>
        </div>
      ) : (
        <>
          {/* ── Tab bar ── */}
          {showTabs && (
            <div className="lp-tabs">
              <button className={`lp-tab${tab === 'settings'   ? ' active' : ''}`} onClick={() => setTab('settings')}>
                <Settings size={13} /> Settings
              </button>
              <button className={`lp-tab${tab === 'earn-rules' ? ' active' : ''}`} onClick={() => setTab('earn-rules')}>
                <Zap size={13} /> Earn Rules
              </button>
              <button className={`lp-tab${tab === 'rewards'    ? ' active' : ''}`} onClick={() => setTab('rewards')}>
                <Gift size={13} /> Rewards
              </button>
            </div>
          )}

          {/* ── Body ── */}
          <div className="lp-body">
            {tab === 'settings'   && <SettingsTab   storeId={storeId} />}
            {tab === 'earn-rules' && <EarnRulesTab  storeId={storeId} />}
            {tab === 'rewards'    && <RewardsTab    storeId={storeId} />}
          </div>
        </>
      )}
    </>
  );

  if (embedded) return <div className="p-tab-content lp-page">{content}</div>;

  return content;
}

/* ══════════════════════════════════════════════════════════════════════════
   Settings Tab
══════════════════════════════════════════════════════════════════════════ */
function SettingsTab({ storeId }) {
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [err,     setErr]     = useState('');
  const [success, setSuccess] = useState('');
  const [form,    setForm]    = useState({
    enabled:               true,
    programName:           'Loyalty Rewards',
    pointsPerDollar:       1,
    redeemPointsPerDollar: 100,
    minPointsToRedeem:     100,
    maxRedemptionPerTx:    '',
    welcomeBonus:          0,
    birthdayBonus:         0,
    expiryDays:            '',
  });

  useEffect(() => {
    (async () => {
      try {
        const data = await getLoyaltyProgram(storeId);
        if (data) {
          setForm({
            enabled:               data.enabled ?? true,
            programName:           data.programName || 'Loyalty Rewards',
            pointsPerDollar:       Number(data.pointsPerDollar ?? 1),
            redeemPointsPerDollar: Number(data.redeemPointsPerDollar ?? 100),
            minPointsToRedeem:     data.minPointsToRedeem ?? 100,
            maxRedemptionPerTx:    data.maxRedemptionPerTx != null ? Number(data.maxRedemptionPerTx) : '',
            welcomeBonus:          data.welcomeBonus ?? 0,
            birthdayBonus:         data.birthdayBonus ?? 0,
            expiryDays:            data.expiryDays != null ? data.expiryDays : '',
          });
        }
      } catch { /* first time — defaults are fine */ }
      setLoading(false);
    })();
  }, [storeId]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = async (e) => {
    e.preventDefault();
    setErr(''); setSuccess('');
    if (!form.programName.trim()) return setErr('Program name is required.');
    if (Number(form.pointsPerDollar) <= 0) return setErr('Points per dollar must be > 0.');
    if (Number(form.redeemPointsPerDollar) <= 0) return setErr('Points per $1 off must be > 0.');
    setSaving(true);
    try {
      await upsertLoyaltyProgram({
        storeId,
        enabled:               form.enabled,
        programName:           form.programName.trim(),
        pointsPerDollar:       Number(form.pointsPerDollar),
        redeemPointsPerDollar: Number(form.redeemPointsPerDollar),
        minPointsToRedeem:     parseInt(form.minPointsToRedeem) || 0,
        maxRedemptionPerTx:    form.maxRedemptionPerTx !== '' ? parseFloat(form.maxRedemptionPerTx) : null,
        welcomeBonus:          parseInt(form.welcomeBonus) || 0,
        birthdayBonus:         parseInt(form.birthdayBonus) || 0,
        expiryDays:            form.expiryDays !== '' ? parseInt(form.expiryDays) : null,
      });
      setSuccess('Settings saved successfully.');
    } catch (e) {
      setErr(e?.response?.data?.error || 'Failed to save settings.');
    }
    setSaving(false);
  };

  if (loading) return <div className="lp-loading"><RefreshCw size={18} className="lp-spin" /> Loading…</div>;

  return (
    <form className="lp-settings-form" onSubmit={save}>

      {/* ── Enable toggle ── */}
      <div className="lp-setting-row lp-setting-toggle-row">
        <div>
          <div className="lp-setting-label">Enable Loyalty Program</div>
          <div className="lp-setting-hint">When disabled, no points are earned or accepted at checkout.</div>
        </div>
        <button type="button" className={`lp-toggle ${form.enabled ? 'on' : ''}`} onClick={() => set('enabled', !form.enabled)}>
          <span className="lp-toggle-knob" />
        </button>
      </div>

      <div className="lp-section-label">Program Details</div>

      <div className="lp-setting-row">
        <label className="lp-setting-label">Program Name</label>
        <input className="lp-input lp-input-md" value={form.programName}
          onChange={e => set('programName', e.target.value)} placeholder="Loyalty Rewards" />
      </div>

      <div className="lp-section-label">Earning</div>
      <div className="lp-grid-2">
        <div className="lp-field">
          <label className="lp-field-label">Points earned per $1 spent</label>
          <input className="lp-input" type="number" min="0.01" step="0.01"
            value={form.pointsPerDollar} onChange={e => set('pointsPerDollar', e.target.value)} />
          <span className="lp-field-hint">e.g. 1 = 1 pt per dollar</span>
        </div>
        <div className="lp-field">
          <label className="lp-field-label">Points needed for $1 off</label>
          <input className="lp-input" type="number" min="1" step="1"
            value={form.redeemPointsPerDollar} onChange={e => set('redeemPointsPerDollar', e.target.value)} />
          <span className="lp-field-hint">e.g. 100 = 100 pts → $1</span>
        </div>
      </div>

      <div className="lp-section-label">Redemption</div>
      <div className="lp-grid-2">
        <div className="lp-field">
          <label className="lp-field-label">Minimum points to redeem</label>
          <input className="lp-input" type="number" min="0" step="1"
            value={form.minPointsToRedeem} onChange={e => set('minPointsToRedeem', e.target.value)} />
        </div>
        <div className="lp-field">
          <label className="lp-field-label">Max redemption per transaction ($)</label>
          <input className="lp-input" type="number" min="0" step="0.01"
            value={form.maxRedemptionPerTx} onChange={e => set('maxRedemptionPerTx', e.target.value)}
            placeholder="No limit" />
          <span className="lp-field-hint">Leave blank for no limit</span>
        </div>
      </div>

      <div className="lp-section-label">Bonuses</div>
      <div className="lp-grid-2">
        <div className="lp-field">
          <label className="lp-field-label">Welcome bonus (pts)</label>
          <input className="lp-input" type="number" min="0" step="1"
            value={form.welcomeBonus} onChange={e => set('welcomeBonus', e.target.value)} />
          <span className="lp-field-hint">Awarded on new customer creation</span>
        </div>
        <div className="lp-field">
          <label className="lp-field-label">Birthday bonus (pts)</label>
          <input className="lp-input" type="number" min="0" step="1"
            value={form.birthdayBonus} onChange={e => set('birthdayBonus', e.target.value)} />
        </div>
      </div>

      <div className="lp-section-label">Expiry</div>
      <div className="lp-field lp-field-expiry">
        <label className="lp-field-label">Points expire after (days)</label>
        <input className="lp-input" type="number" min="1" step="1"
          value={form.expiryDays} onChange={e => set('expiryDays', e.target.value)}
          placeholder="Never expire" />
        <span className="lp-field-hint">Leave blank for no expiry</span>
      </div>

      {/* ── Live example ── */}
      <div className="lp-example-box">
        <Star size={12} className="lp-example-icon" />
        <span>
          Example: spend $10 → earn <strong>{Math.floor(10 * Number(form.pointsPerDollar || 1))} pts</strong>.
          &nbsp;{Number(form.redeemPointsPerDollar || 100)} pts = <strong>$1.00 off</strong>.
          {form.minPointsToRedeem > 0 && <> Min to redeem: <strong>{fmtPts(form.minPointsToRedeem)} pts</strong>.</>}
        </span>
      </div>

      {err     && <div className="lp-error">{err}</div>}
      {success && <div className="lp-success">{success}</div>}

      <button type="submit" className="lp-btn-save" disabled={saving}>
        {saving ? <RefreshCw size={14} className="lp-spin" /> : <Check size={14} />}
        {saving ? 'Saving…' : 'Save Settings'}
      </button>
    </form>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Earn Rules Tab
══════════════════════════════════════════════════════════════════════════ */
function EarnRulesTab({ storeId }) {
  const confirm = useConfirm();
  const [rules,    setRules]    = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editRule, setEditRule] = useState(null);
  const [err,      setErr]      = useState('');

  const [departments, setDepartments] = useState([]);
  const [prodSearch,  setProdSearch]  = useState('');
  const [prodResults, setProdResults] = useState([]);
  const [prodLoading, setProdLoading] = useState(false);

  const [form, setForm] = useState({
    targetType: 'department', targetId: '', targetName: '', action: 'exclude', multiplier: 2,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, deps] = await Promise.all([
        getLoyaltyEarnRules(storeId),
        getCatalogDepartments(),
      ]);
      setRules(Array.isArray(r) ? r : []);
      const dArr = Array.isArray(deps) ? deps : (deps?.data ?? deps?.departments ?? []);
      setDepartments(dArr);
    } catch { setRules([]); }
    setLoading(false);
  }, [storeId]);

  useEffect(() => { load(); }, [load]);

  // Debounced product search
  useEffect(() => {
    if (form.targetType !== 'product' || !prodSearch.trim()) { setProdResults([]); return; }
    const t = setTimeout(async () => {
      setProdLoading(true);
      try {
        const res = await searchCatalogProducts(prodSearch.trim(), { limit: 8 });
        const arr = Array.isArray(res) ? res : (res?.data ?? []);
        setProdResults(arr);
      } catch { setProdResults([]); }
      setProdLoading(false);
    }, 300);
    return () => clearTimeout(t);
  }, [prodSearch, form.targetType]);

  const openAdd = () => {
    setEditRule(null);
    setForm({ targetType: 'department', targetId: '', targetName: '', action: 'exclude', multiplier: 2 });
    setProdSearch(''); setProdResults([]);
    setErr('');
    setShowForm(true);
  };

  const openEdit = (r) => {
    setEditRule(r);
    setForm({ targetType: r.targetType, targetId: r.targetId, targetName: r.targetName || '', action: r.action, multiplier: Number(r.multiplier) });
    setProdSearch(r.targetType === 'product' ? (r.targetName || '') : '');
    setErr('');
    setShowForm(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErr('');
    if (!form.targetId) return setErr('Please select a department or product.');
    try {
      if (editRule) {
        const updated = await updateLoyaltyEarnRule(editRule.id, {
          action:     form.action,
          multiplier: form.action === 'multiply' ? form.multiplier : 1,
          targetName: form.targetName,
        });
        setRules(prev => prev.map(r => r.id === editRule.id ? updated : r));
      } else {
        const created = await createLoyaltyEarnRule({
          storeId, targetType: form.targetType, targetId: form.targetId,
          targetName: form.targetName, action: form.action,
          multiplier: form.action === 'multiply' ? form.multiplier : 1,
        });
        setRules(prev => [...prev, created]);
      }
      setShowForm(false);
    } catch (e) {
      setErr(e?.response?.data?.error || 'Failed to save rule.');
    }
  };

  const handleDelete = async (id) => {
    if (!await confirm({
      title: 'Delete earn rule?',
      message: 'Customers will stop earning bonus / multiplier points from this rule on future purchases.',
      confirmLabel: 'Delete',
      danger: true,
    })) return;
    try {
      await deleteLoyaltyEarnRule(id);
      setRules(prev => prev.filter(r => r.id !== id));
    } catch { alert('Failed to delete rule.'); }
  };

  const toggleActive = async (rule) => {
    try {
      const updated = await updateLoyaltyEarnRule(rule.id, { active: !rule.active });
      setRules(prev => prev.map(r => r.id === rule.id ? updated : r));
    } catch { alert('Failed to update rule.'); }
  };

  return (
    <div className="lp-earn-rules">
      <div className="lp-section-header">
        <div>
          <h3 className="lp-section-title">Earn Rules</h3>
          <p className="lp-section-desc">
            By default all purchases earn points. Use rules to exclude categories or apply bonus multipliers.
          </p>
        </div>
        <button className="lp-btn-add" onClick={openAdd}>
          <Plus size={14} /> Add Rule
        </button>
      </div>

      {/* ── Add / Edit Form ── */}
      {showForm && (
        <div className="lp-card lp-rule-form">
          <div className="lp-rule-form-title">
            {editRule ? 'Edit Rule' : 'New Earn Rule'}
            <button className="lp-icon-btn" onClick={() => setShowForm(false)}><X size={15} /></button>
          </div>

          <form onSubmit={handleSubmit}>
            {!editRule && (
              <div className="lp-field-row">
                <div className="lp-field">
                  <label className="lp-field-label">Target Type</label>
                  <select className="lp-input" value={form.targetType}
                    onChange={e => { setForm(f => ({ ...f, targetType: e.target.value, targetId: '', targetName: '' })); setProdSearch(''); setProdResults([]); }}>
                    <option value="department">Department</option>
                    <option value="product">Product</option>
                  </select>
                </div>

                <div className="lp-field lp-field-target">
                  <label className="lp-field-label">
                    {form.targetType === 'department' ? 'Department' : 'Product'}
                  </label>
                  {form.targetType === 'department' ? (
                    <select className="lp-input" value={form.targetId}
                      onChange={e => {
                        const dep = departments.find(d => String(d.id) === e.target.value);
                        setForm(f => ({ ...f, targetId: e.target.value, targetName: dep?.name || '' }));
                      }}>
                      <option value="">— select —</option>
                      {departments.map(d => (
                        <option key={d.id} value={String(d.id)}>{d.name}</option>
                      ))}
                    </select>
                  ) : (
                    <div className="lp-prod-search-wrap">
                      <Search size={13} className="lp-prod-search-icon" />
                      <input className="lp-input lp-prod-search-input"
                        value={prodSearch}
                        onChange={e => { setProdSearch(e.target.value); setForm(f => ({ ...f, targetId: '', targetName: '' })); }}
                        placeholder="Search product name or UPC…" />
                      {(prodLoading || prodResults.length > 0) && (
                        <div className="lp-prod-dropdown">
                          {prodLoading && <div className="lp-prod-loading"><RefreshCw size={12} className="lp-spin" /> Searching…</div>}
                          {prodResults.map(p => (
                            <button type="button" key={p.id} className="lp-prod-row"
                              onClick={() => {
                                setForm(f => ({ ...f, targetId: p.id, targetName: p.name }));
                                setProdSearch(p.name);
                                setProdResults([]);
                              }}>
                              <Package size={12} />
                              <span>{p.name}</span>
                              {p.upc && <span className="lp-prod-upc">{p.upc}</span>}
                            </button>
                          ))}
                        </div>
                      )}
                      {form.targetId && (
                        <div className="lp-prod-selected">
                          <Check size={11} /> {form.targetName}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {editRule && (
              <div className="lp-rule-edit-target">
                {editRule.targetType === 'department' ? <Layers size={13} /> : <Package size={13} />}
                <strong>{editRule.targetName || editRule.targetId}</strong>
                <span className="lp-badge lp-badge-muted">{editRule.targetType}</span>
              </div>
            )}

            <div className="lp-field-row">
              <div className="lp-field">
                <label className="lp-field-label">Action</label>
                <select className="lp-input" value={form.action}
                  onChange={e => setForm(f => ({ ...f, action: e.target.value }))}>
                  <option value="exclude">Exclude (no points)</option>
                  <option value="multiply">Multiply (bonus points)</option>
                </select>
              </div>
              {form.action === 'multiply' && (
                <div className="lp-field">
                  <label className="lp-field-label">Multiplier</label>
                  <input className="lp-input" type="number" min="0.1" step="0.1"
                    value={form.multiplier} onChange={e => setForm(f => ({ ...f, multiplier: e.target.value }))} />
                  <span className="lp-field-hint">e.g. 2 = double points</span>
                </div>
              )}
            </div>

            {err && <div className="lp-error">{err}</div>}

            <div className="lp-form-actions">
              <button type="button" className="lp-btn-cancel" onClick={() => setShowForm(false)}>Cancel</button>
              <button type="submit" className="lp-btn-save">
                <Check size={13} /> {editRule ? 'Update Rule' : 'Add Rule'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Rules list ── */}
      {loading ? (
        <div className="lp-loading"><RefreshCw size={16} className="lp-spin" /> Loading rules…</div>
      ) : rules.length === 0 ? (
        <div className="lp-empty">
          <Zap size={28} />
          <p>No earn rules yet. All purchases earn points at the standard rate.</p>
        </div>
      ) : (
        <div className="lp-rules-list">
          {rules.map(r => (
            <div key={r.id} className={`lp-card lp-rule-row ${r.active ? '' : 'inactive'}`}>
              <div className="lp-rule-icon">
                {r.targetType === 'department' ? <Layers size={14} /> : <Package size={14} />}
              </div>
              <div className="lp-rule-info">
                <div className="lp-rule-name">{r.targetName || r.targetId}</div>
                <div className="lp-rule-meta">
                  <span className="lp-badge lp-badge-muted">{r.targetType}</span>
                  {r.action === 'exclude'
                    ? <span className="lp-badge lp-badge-red">No points</span>
                    : <span className="lp-badge lp-badge-green">{fmtMult(r.multiplier)} points</span>
                  }
                </div>
              </div>
              <div className="lp-rule-actions">
                <button className="lp-icon-btn lp-toggle-active" title={r.active ? 'Disable' : 'Enable'} onClick={() => toggleActive(r)}>
                  {r.active ? <ToggleRight size={16} className="lp-toggle-on-icon" /> : <ToggleLeft size={16} />}
                </button>
                <button className="lp-icon-btn" title="Edit" onClick={() => openEdit(r)}>
                  <Edit2 size={13} />
                </button>
                <button className="lp-icon-btn lp-icon-btn-red" title="Delete" onClick={() => handleDelete(r.id)}>
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Rewards Tab
══════════════════════════════════════════════════════════════════════════ */
function RewardsTab({ storeId }) {
  const confirm = useConfirm();
  const [rewards,  setRewards]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId,   setEditId]   = useState(null);
  const [err,      setErr]      = useState('');
  const [form,     setForm]     = useState({
    name: '', description: '', pointsCost: 500, rewardType: 'dollar_off', rewardValue: 5, sortOrder: 0,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await getLoyaltyRewards(storeId);
      setRewards(Array.isArray(r) ? r : []);
    } catch { setRewards([]); }
    setLoading(false);
  }, [storeId]);

  useEffect(() => { load(); }, [load]);

  const openAdd = () => {
    setEditId(null);
    setForm({ name: '', description: '', pointsCost: 500, rewardType: 'dollar_off', rewardValue: 5, sortOrder: rewards.length });
    setErr('');
    setShowForm(true);
  };

  const openEdit = (r) => {
    setEditId(r.id);
    setForm({
      name: r.name, description: r.description || '', pointsCost: r.pointsCost,
      rewardType: r.rewardType, rewardValue: Number(r.rewardValue), sortOrder: r.sortOrder,
    });
    setErr('');
    setShowForm(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErr('');
    if (!form.name.trim()) return setErr('Name is required.');
    if (Number(form.pointsCost) <= 0) return setErr('Points cost must be greater than 0.');
    if (Number(form.rewardValue) <= 0) return setErr('Reward value must be greater than 0.');
    try {
      const payload = {
        storeId, name: form.name.trim(), description: form.description.trim(),
        pointsCost: parseInt(form.pointsCost), rewardType: form.rewardType,
        rewardValue: parseFloat(form.rewardValue), sortOrder: parseInt(form.sortOrder) || 0,
      };
      if (editId) {
        const updated = await updateLoyaltyReward(editId, payload);
        setRewards(prev => prev.map(r => r.id === editId ? updated : r));
      } else {
        const created = await createLoyaltyReward(payload);
        setRewards(prev => [...prev, created]);
      }
      setShowForm(false);
    } catch (e) {
      setErr(e?.response?.data?.error || 'Failed to save reward.');
    }
  };

  const handleDelete = async (id) => {
    if (!await confirm({
      title: 'Delete reward?',
      message: 'Customers will no longer be able to redeem points for this reward.',
      confirmLabel: 'Delete',
      danger: true,
    })) return;
    try {
      await deleteLoyaltyReward(id);
      setRewards(prev => prev.filter(r => r.id !== id));
    } catch { alert('Failed to delete reward.'); }
  };

  const toggleActive = async (r) => {
    try {
      const updated = await updateLoyaltyReward(r.id, { active: !r.active });
      setRewards(prev => prev.map(x => x.id === r.id ? updated : x));
    } catch { alert('Failed to update reward.'); }
  };

  return (
    <div className="lp-rewards">
      <div className="lp-section-header">
        <div>
          <h3 className="lp-section-title">Rewards</h3>
          <p className="lp-section-desc">
            Define tiers customers can redeem at checkout using their points.
          </p>
        </div>
        <button className="lp-btn-add" onClick={openAdd}>
          <Plus size={14} /> Add Reward
        </button>
      </div>

      {/* ── Add / Edit Form ── */}
      {showForm && (
        <div className="lp-card lp-reward-form">
          <div className="lp-rule-form-title">
            {editId ? 'Edit Reward' : 'New Reward'}
            <button className="lp-icon-btn" onClick={() => setShowForm(false)}><X size={15} /></button>
          </div>
          <form onSubmit={handleSubmit}>
            <div className="lp-field">
              <label className="lp-field-label">Reward Name</label>
              <input className="lp-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Free Coffee, $5 Off" />
            </div>
            <div className="lp-field">
              <label className="lp-field-label">Description (optional)</label>
              <input className="lp-input" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Short description shown to customer" />
            </div>
            <div className="lp-field-row">
              <div className="lp-field">
                <label className="lp-field-label">Points Cost</label>
                <input className="lp-input" type="number" min="1" step="1"
                  value={form.pointsCost} onChange={e => setForm(f => ({ ...f, pointsCost: e.target.value }))} />
              </div>
              <div className="lp-field">
                <label className="lp-field-label">Reward Type</label>
                <select className="lp-input" value={form.rewardType}
                  onChange={e => setForm(f => ({ ...f, rewardType: e.target.value }))}>
                  <option value="dollar_off">Dollar Off ($)</option>
                  <option value="pct_off">Percent Off (%)</option>
                </select>
              </div>
              <div className="lp-field">
                <label className="lp-field-label">
                  {form.rewardType === 'dollar_off' ? 'Dollar Amount ($)' : 'Percent Off (%)'}
                </label>
                <input className="lp-input" type="number" min="0.01" step="0.01"
                  value={form.rewardValue} onChange={e => setForm(f => ({ ...f, rewardValue: e.target.value }))} />
              </div>
            </div>
            <div className="lp-field lp-field-sort">
              <label className="lp-field-label">Sort Order</label>
              <input className="lp-input" type="number" min="0" step="1"
                value={form.sortOrder} onChange={e => setForm(f => ({ ...f, sortOrder: e.target.value }))} />
            </div>

            {/* Preview */}
            <div className="lp-example-box">
              <Gift size={12} className="lp-example-icon lp-example-icon--green" />
              <span>
                <strong>{form.name || 'Reward'}</strong>
                {' '}costs <strong>{fmtPts(form.pointsCost)} pts</strong> and gives{' '}
                <strong>
                  {form.rewardType === 'dollar_off'
                    ? `$${Number(form.rewardValue).toFixed(2)} off`
                    : `${Number(form.rewardValue).toFixed(1)}% off`}
                </strong>
              </span>
            </div>

            {err && <div className="lp-error">{err}</div>}
            <div className="lp-form-actions">
              <button type="button" className="lp-btn-cancel" onClick={() => setShowForm(false)}>Cancel</button>
              <button type="submit" className="lp-btn-save">
                <Check size={13} /> {editId ? 'Update Reward' : 'Add Reward'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Rewards grid ── */}
      {loading ? (
        <div className="lp-loading"><RefreshCw size={16} className="lp-spin" /> Loading rewards…</div>
      ) : rewards.length === 0 ? (
        <div className="lp-empty">
          <Gift size={28} />
          <p>No rewards yet. Add some tiers for customers to redeem.</p>
        </div>
      ) : (
        <div className="lp-rewards-grid">
          {rewards.sort((a, b) => a.sortOrder - b.sortOrder || a.pointsCost - b.pointsCost).map(r => (
            <div key={r.id} className={`lp-card lp-reward-card ${r.active ? '' : 'inactive'}`}>
              <div className="lp-reward-top">
                <div className="lp-reward-icon"><Gift size={16} /></div>
                <div className="lp-reward-actions">
                  <button className="lp-icon-btn" onClick={() => toggleActive(r)} title={r.active ? 'Disable' : 'Enable'}>
                    {r.active ? <ToggleRight size={16} className="lp-toggle-on-icon" /> : <ToggleLeft size={16} />}
                  </button>
                  <button className="lp-icon-btn" onClick={() => openEdit(r)} title="Edit">
                    <Edit2 size={13} />
                  </button>
                  <button className="lp-icon-btn lp-icon-btn-red" onClick={() => handleDelete(r.id)} title="Delete">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
              <div className="lp-reward-name">{r.name}</div>
              {r.description && <div className="lp-reward-desc">{r.description}</div>}
              <div className="lp-reward-pts">{fmtPts(r.pointsCost)} pts</div>
              <div className="lp-reward-value">
                {r.rewardType === 'dollar_off'
                  ? `${fmtMoney(r.rewardValue)} off`
                  : `${Number(r.rewardValue).toFixed(1)}% off`}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
