/**
 * Fuel.jsx — Fuel Module Portal Page
 *
 * Tabs:
 *   Overview   — KPIs (today / month) + by-type breakdown
 *   Fuel Types — CRUD: name, grade label, $/gal (3-decimal), color, default, taxable
 *   Sales Report — date range, by type, gallons + amount + avg price
 *   Settings   — enable, default entry mode, default fuel type, cash-only, allow refunds
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Fuel as FuelIcon, Plus, X, Edit2, Trash2, RefreshCw,
  BarChart2, Settings2, AlertCircle, Star,
} from 'lucide-react';
import {
  getFuelTypes, createFuelType, updateFuelType, deleteFuelType,
  getFuelSettings, updateFuelSettings,
  getFuelDashboard, getFuelReport,
} from '../services/api';
import ModuleDisabled from '../components/ModuleDisabled';
import { useStoreModules } from '../hooks/useStoreModules';
import './Fuel.css';

const fmtMoney = (n) => n == null ? '—' : `$${Number(n).toFixed(2)}`;
const fmtPrice = (n) => n == null ? '—' : `$${Number(n).toFixed(3)}`;
const fmtGal   = (n) => n == null ? '—' : `${Number(n).toFixed(3)} gal`;

const toDateStr  = (d) => d.toISOString().slice(0, 10);
const todayStr   = ()  => toDateStr(new Date());
const daysAgoStr = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return toDateStr(d); };

const COLOR_SWATCHES = ['#16a34a', '#dc2626', '#2563eb', '#f59e0b', '#7c3aed', '#0891b2', '#475569'];

// Default export is a thin gate — hooks-rule-safe. Only the gate hook runs
// until we decide whether to mount the full page body.
export default function Fuel() {
  const { modules, loading } = useStoreModules();
  if (loading) return null;
  if (!modules.fuel) {
    return (
      <ModuleDisabled
        icon={FuelIcon}
        title="Fuel module is disabled for this store"
        description="Enable the Fuel module in Store Settings to configure fuel grades, pump pricing, pre-authorised pump sales, and end-of-day fuel reports."
      />
    );
  }
  return <FuelBody />;
}

function FuelBody() {
  const [tab, setTab]               = useState('overview');
  const [storeId, setStoreId]       = useState(localStorage.getItem('activeStoreId') || '');
  const [loading, setLoading]       = useState(false);
  const [err, setErr]               = useState(null);

  // Re-read active storeId whenever it could change
  useEffect(() => {
    const onStorage = () => setStoreId(localStorage.getItem('activeStoreId') || '');
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return (
    <div className="fuel-page">
      <div className="fuel-header">
        <div className="fuel-header-left">
          <div className="fuel-header-icon"><FuelIcon size={20} /></div>
          <div>
            <h1 className="fuel-title">Fuel Sales</h1>
            <div className="fuel-subtitle">Configure fuel types and review sales reports</div>
          </div>
        </div>
      </div>

      <div className="fuel-tabs">
        {[
          { id: 'overview', label: 'Overview',    icon: BarChart2 },
          { id: 'types',    label: 'Fuel Types',  icon: FuelIcon },
          { id: 'report',   label: 'Sales Report', icon: BarChart2 },
          { id: 'settings', label: 'Settings',    icon: Settings2 },
        ].map(t => {
          const Ico = t.icon;
          return (
            <button
              key={t.id}
              className={'fuel-tab' + (tab === t.id ? ' fuel-tab--active' : '')}
              onClick={() => setTab(t.id)}
            >
              <Ico size={14} /> {t.label}
            </button>
          );
        })}
      </div>

      {!storeId && (
        <div className="fuel-warn"><AlertCircle size={14} /> Select a store to use the Fuel module.</div>
      )}
      {err && <div className="fuel-error"><AlertCircle size={14} /> {err}</div>}

      {storeId && tab === 'overview' && <OverviewTab storeId={storeId} setErr={setErr} />}
      {storeId && tab === 'types'    && <TypesTab    storeId={storeId} setErr={setErr} />}
      {storeId && tab === 'report'   && <ReportTab   storeId={storeId} setErr={setErr} />}
      {storeId && tab === 'settings' && <SettingsTab storeId={storeId} setErr={setErr} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// OVERVIEW
// ═══════════════════════════════════════════════════════════════════════════
function OverviewTab({ storeId, setErr }) {
  const [data, setData]     = useState(null);
  const [loading, setLoad]  = useState(false);

  const load = useCallback(() => {
    setLoad(true); setErr(null);
    getFuelDashboard({ storeId })
      .then(d => setData(d))
      .catch(e => setErr(e.response?.data?.error || e.message))
      .finally(() => setLoad(false));
  }, [storeId, setErr]);

  useEffect(() => { load(); }, [load]);

  if (loading && !data) return <div className="fuel-loading">Loading…</div>;
  if (!data) return null;

  return (
    <div className="fuel-overview">
      <div className="fuel-stat-grid">
        <StatCard label="Today — Gallons"    value={fmtGal(data.today.gallons)}    color="#16a34a" />
        <StatCard label="Today — Sales"      value={fmtMoney(data.today.amount)}    color="#16a34a" />
        <StatCard label="Month — Gallons"    value={fmtGal(data.month.gallons)}    color="#2563eb" />
        <StatCard label="Month — Sales"      value={fmtMoney(data.month.amount)}    color="#2563eb" />
        <StatCard label="Active Fuel Types"  value={data.activeTypes}              color="#f59e0b" />
      </div>

      <div className="fuel-card">
        <div className="fuel-card-head">
          <h3>Today by Fuel Type</h3>
          <button onClick={load} className="fuel-btn fuel-btn-ghost"><RefreshCw size={13} /> Refresh</button>
        </div>
        {data.todayByType.length === 0 ? (
          <div className="fuel-empty">No fuel sales today.</div>
        ) : (
          <div className="fuel-table-wrap">
            <table className="fuel-table">
              <thead>
                <tr>
                  <th>Fuel Type</th>
                  <th>Gallons</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.todayByType.map(r => (
                  <tr key={r.fuelTypeId}>
                    <td>
                      <span className="fuel-color-dot" style={{ background: r.color || '#94a3b8' }} />
                      {r.name}
                    </td>
                    <td>{fmtGal(r.gallons)}</td>
                    <td>{fmtMoney(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, color }) {
  return (
    <div className="fuel-stat-card">
      <div className="fuel-stat-label">{label}</div>
      <div className="fuel-stat-value" style={{ color }}>{value}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TYPES (CRUD)
// ═══════════════════════════════════════════════════════════════════════════
function TypesTab({ storeId, setErr }) {
  const [types, setTypes]     = useState([]);
  const [editing, setEditing] = useState(null);   // FuelType being edited / 'new'
  const [loading, setLoad]    = useState(false);

  const load = useCallback(() => {
    setLoad(true); setErr(null);
    getFuelTypes({ storeId })
      .then(t => setTypes(Array.isArray(t) ? t : []))
      .catch(e => setErr(e.response?.data?.error || e.message))
      .finally(() => setLoad(false));
  }, [storeId, setErr]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (t) => {
    if (!window.confirm(`Delete fuel type "${t.name}"?`)) return;
    try {
      await deleteFuelType(t.id);
      load();
    } catch (e) { setErr(e.response?.data?.error || e.message); }
  };

  return (
    <div className="fuel-types-tab">
      <div className="fuel-card-head">
        <h3>Fuel Types ({types.length})</h3>
        <button className="fuel-btn fuel-btn-primary" onClick={() => setEditing('new')} data-tour="fuel-new-btn">
          <Plus size={13} /> Add Fuel Type
        </button>
      </div>

      {types.length === 0 && !loading ? (
        <div className="fuel-empty">
          No fuel types yet. Add at least one (e.g. "Regular 87" at $3.999/gal) to enable fuel sales at the cashier.
        </div>
      ) : (
        <div className="fuel-types-grid">
          {types.map(t => (
            <div key={t.id} className="fuel-type-card">
              <div className="fuel-type-header">
                <div className="fuel-color-pill" style={{ background: t.color || '#94a3b8' }} />
                <div className="fuel-type-name">
                  {t.name}
                  {t.gradeLabel && <span className="fuel-type-grade"> · {t.gradeLabel}</span>}
                </div>
                {t.isDefault && <span className="fuel-default-badge"><Star size={11} /> Default</span>}
              </div>
              <div className="fuel-type-price">{fmtPrice(t.pricePerGallon)} <span>/ gallon</span></div>
              <div className="fuel-type-meta">
                {t.isTaxable
                  ? <span className="fuel-tag fuel-tag-amber">Taxable {t.taxRate ? `(${(Number(t.taxRate)*100).toFixed(2)}%)` : ''}</span>
                  : <span className="fuel-tag fuel-tag-gray">Non-taxable</span>}
                {!t.active && <span className="fuel-tag fuel-tag-red">Inactive</span>}
              </div>
              <div className="fuel-type-actions">
                <button className="fuel-btn fuel-btn-ghost" onClick={() => setEditing(t)}>
                  <Edit2 size={12} /> Edit
                </button>
                <button className="fuel-btn fuel-btn-danger" onClick={() => handleDelete(t)}>
                  <Trash2 size={12} /> Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <FuelTypeModal
          type={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
          setErr={setErr}
        />
      )}
    </div>
  );
}

function FuelTypeModal({ type, onClose, onSaved, setErr }) {
  const [form, setForm] = useState({
    name:           type?.name || '',
    gradeLabel:     type?.gradeLabel || '',
    pricePerGallon: type?.pricePerGallon != null ? Number(type.pricePerGallon).toFixed(3) : '',
    color:          type?.color || '#16a34a',
    isDefault:      type?.isDefault || false,
    isTaxable:      type?.isTaxable || false,
    taxRate:        type?.taxRate != null ? Number(type.taxRate) : '',
    sortOrder:      type?.sortOrder || 0,
    active:         type?.active != null ? type.active : true,
  });
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.name.trim()) { setErr('Name is required'); return; }
    const price = Number(form.pricePerGallon);
    if (!Number.isFinite(price) || price < 0) { setErr('Price must be a positive number (e.g. 3.999)'); return; }
    const data = {
      name:           form.name.trim(),
      gradeLabel:     form.gradeLabel.trim() || null,
      pricePerGallon: price,
      color:          form.color,
      isDefault:      Boolean(form.isDefault),
      isTaxable:      Boolean(form.isTaxable),
      taxRate:        form.isTaxable && form.taxRate !== '' ? Number(form.taxRate) : null,
      sortOrder:      Number(form.sortOrder) || 0,
      active:         Boolean(form.active),
    };
    setSaving(true);
    try {
      if (type) await updateFuelType(type.id, data);
      else      await createFuelType(data);
      onSaved();
    } catch (e) {
      setErr(e.response?.data?.error || e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fuel-modal-backdrop" onClick={onClose}>
      <div className="fuel-modal" onClick={e => e.stopPropagation()}>
        <div className="fuel-modal-head">
          <h3>{type ? 'Edit Fuel Type' : 'Add Fuel Type'}</h3>
          <button onClick={onClose} className="fuel-modal-close"><X size={16} /></button>
        </div>
        <div className="fuel-modal-body">
          <div className="fuel-field">
            <label>Name *</label>
            <input className="fuel-input" value={form.name} onChange={e => set('name', e.target.value)} placeholder="Regular" />
          </div>
          <div className="fuel-field">
            <label>Grade Label</label>
            <input className="fuel-input" value={form.gradeLabel} onChange={e => set('gradeLabel', e.target.value)} placeholder="87 Octane" />
          </div>
          <div className="fuel-field">
            <label>Price per Gallon * (3 decimal places, e.g. 3.999)</label>
            <input
              className="fuel-input"
              type="number"
              step="0.001"
              min="0"
              value={form.pricePerGallon}
              onChange={e => set('pricePerGallon', e.target.value)}
              placeholder="3.999"
            />
          </div>
          <div className="fuel-field">
            <label>Color</label>
            <div className="fuel-color-row">
              {COLOR_SWATCHES.map(c => (
                <button
                  key={c}
                  type="button"
                  className={'fuel-color-swatch' + (form.color === c ? ' fuel-color-swatch--active' : '')}
                  style={{ background: c }}
                  onClick={() => set('color', c)}
                />
              ))}
            </div>
          </div>
          <div className="fuel-row">
            <label className="fuel-checkbox">
              <input type="checkbox" checked={form.isDefault} onChange={e => set('isDefault', e.target.checked)} />
              Set as default fuel type (pre-selected at cashier)
            </label>
          </div>
          <div className="fuel-row">
            <label className="fuel-checkbox">
              <input type="checkbox" checked={form.isTaxable} onChange={e => set('isTaxable', e.target.checked)} />
              Taxable
            </label>
            {form.isTaxable && (
              <input
                className="fuel-input fuel-input-narrow"
                type="number"
                step="0.0001"
                min="0"
                value={form.taxRate}
                onChange={e => set('taxRate', e.target.value)}
                placeholder="0.0825"
                title="Tax rate (e.g. 0.0825 = 8.25%)"
              />
            )}
          </div>
          {type && (
            <div className="fuel-row">
              <label className="fuel-checkbox">
                <input type="checkbox" checked={form.active} onChange={e => set('active', e.target.checked)} />
                Active
              </label>
            </div>
          )}
        </div>
        <div className="fuel-modal-foot">
          <button className="fuel-btn fuel-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="fuel-btn fuel-btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : type ? 'Save Changes' : 'Create Fuel Type'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SALES REPORT
// ═══════════════════════════════════════════════════════════════════════════
function ReportTab({ storeId, setErr }) {
  const [from, setFrom]     = useState(daysAgoStr(7));
  const [to, setTo]         = useState(todayStr());
  const [data, setData]     = useState(null);
  const [loading, setLoad]  = useState(false);

  const load = useCallback(() => {
    setLoad(true); setErr(null);
    getFuelReport({ storeId, from, to })
      .then(r => setData(r))
      .catch(e => setErr(e.response?.data?.error || e.message))
      .finally(() => setLoad(false));
  }, [storeId, from, to, setErr]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="fuel-report-tab">
      <div className="fuel-card-head">
        <h3>Sales Report</h3>
        <div className="fuel-filter-row">
          <label>From</label>
          <input type="date" className="fuel-input" value={from} onChange={e => setFrom(e.target.value)} />
          <label>To</label>
          <input type="date" className="fuel-input" value={to} onChange={e => setTo(e.target.value)} />
          <button className="fuel-btn fuel-btn-ghost" onClick={load}><RefreshCw size={13} /> Refresh</button>
        </div>
      </div>

      {loading && !data && <div className="fuel-loading">Loading…</div>}
      {data && (
        <>
          <div className="fuel-stat-grid">
            <StatCard label="Net Gallons"   value={fmtGal(data.totals.gallons)}      color="#16a34a" />
            <StatCard label="Net Sales"     value={fmtMoney(data.totals.amount)}      color="#16a34a" />
            <StatCard label="Sales Count"   value={data.totals.salesCount}            color="#2563eb" />
            <StatCard label="Refund Count"  value={data.totals.refundsCount}          color="#dc2626" />
            <StatCard label="Avg $/Gallon"  value={fmtPrice(data.totals.avgPrice)}    color="#f59e0b" />
          </div>

          <div className="fuel-card">
            <div className="fuel-card-head"><h3>By Fuel Type</h3></div>
            {data.byType.length === 0 ? (
              <div className="fuel-empty">No fuel sales in this date range.</div>
            ) : (
              <div className="fuel-table-wrap">
                <table className="fuel-table">
                  <thead>
                    <tr>
                      <th>Fuel Type</th>
                      <th>Sales Gal</th>
                      <th>Sales $</th>
                      <th>Refund Gal</th>
                      <th>Refund $</th>
                      <th>Net Gal</th>
                      <th>Net $</th>
                      <th>Avg $/gal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byType.map(r => (
                      <tr key={r.fuelTypeId}>
                        <td>
                          <span className="fuel-color-dot" style={{ background: r.color || '#94a3b8' }} />
                          {r.name}
                        </td>
                        <td>{fmtGal(r.salesGallons)}</td>
                        <td>{fmtMoney(r.salesAmount)}</td>
                        <td>{fmtGal(r.refundsGallons)}</td>
                        <td>{fmtMoney(r.refundsAmount)}</td>
                        <td><strong>{fmtGal(r.netGallons)}</strong></td>
                        <td><strong>{fmtMoney(r.netAmount)}</strong></td>
                        <td>{fmtPrice(r.avgPrice)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════════════════════
function SettingsTab({ storeId, setErr }) {
  const [settings, setSettings] = useState(null);
  const [types, setTypes]       = useState([]);
  const [saving, setSaving]     = useState(false);
  const [savedAt, setSavedAt]   = useState(null);

  const load = useCallback(async () => {
    try {
      const [s, t] = await Promise.all([
        getFuelSettings(storeId),
        getFuelTypes({ storeId }),
      ]);
      setSettings(s);
      setTypes(Array.isArray(t) ? t : []);
    } catch (e) {
      setErr(e.response?.data?.error || e.message);
    }
  }, [storeId, setErr]);

  useEffect(() => { load(); }, [load]);

  if (!settings) return <div className="fuel-loading">Loading…</div>;

  const set = (k, v) => setSettings(s => ({ ...s, [k]: v }));

  const save = async () => {
    setSaving(true); setErr(null);
    try {
      await updateFuelSettings({
        storeId,
        enabled:           settings.enabled,
        cashOnly:          settings.cashOnly,
        allowRefunds:      settings.allowRefunds,
        defaultEntryMode:  settings.defaultEntryMode,
        defaultFuelTypeId: settings.defaultFuelTypeId,
      });
      setSavedAt(new Date().toLocaleTimeString());
    } catch (e) {
      setErr(e.response?.data?.error || e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fuel-settings-tab">
      <div className="fuel-card">
        <div className="fuel-card-head">
          <h3>Fuel Module Settings</h3>
          {savedAt && <span className="fuel-saved">Saved at {savedAt}</span>}
        </div>

        <div className="fuel-settings-grid">
          <div className="fuel-toggle-row">
            <div>
              <div className="fuel-toggle-label">Enable Fuel Module</div>
              <div className="fuel-toggle-desc">Show fuel sale & refund buttons on the cashier app for this store.</div>
            </div>
            <ToggleSwitch on={settings.enabled} onChange={v => set('enabled', v)} />
          </div>

          <div className="fuel-toggle-row">
            <div>
              <div className="fuel-toggle-label">Cash-Only Fuel Sales</div>
              <div className="fuel-toggle-desc">Restrict carts containing fuel items to cash payment only.</div>
            </div>
            <ToggleSwitch on={settings.cashOnly} onChange={v => set('cashOnly', v)} />
          </div>

          <div className="fuel-toggle-row">
            <div>
              <div className="fuel-toggle-label">Allow Fuel Refunds</div>
              <div className="fuel-toggle-desc">Show the "Fuel Refund" tab in the cashier fuel modal.</div>
            </div>
            <ToggleSwitch on={settings.allowRefunds} onChange={v => set('allowRefunds', v)} />
          </div>

          <div className="fuel-field">
            <label>Default Entry Mode</label>
            <div className="fuel-segmented">
              <button
                className={'fuel-seg' + (settings.defaultEntryMode === 'amount'  ? ' fuel-seg--active' : '')}
                onClick={() => set('defaultEntryMode', 'amount')}
              >
                Amount ($)
              </button>
              <button
                className={'fuel-seg' + (settings.defaultEntryMode === 'gallons' ? ' fuel-seg--active' : '')}
                onClick={() => set('defaultEntryMode', 'gallons')}
              >
                Gallons
              </button>
            </div>
            <div className="fuel-field-help">Cashier can toggle either way; this is the pre-selected mode.</div>
          </div>

          <div className="fuel-field">
            <label>Default Fuel Type</label>
            <select
              className="fuel-input"
              value={settings.defaultFuelTypeId || ''}
              onChange={e => set('defaultFuelTypeId', e.target.value || null)}
            >
              <option value="">— Use type marked "Default" in Fuel Types tab —</option>
              {types.map(t => (
                <option key={t.id} value={t.id}>{t.name}{t.gradeLabel ? ` (${t.gradeLabel})` : ''}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="fuel-modal-foot fuel-settings-foot">
          <button className="fuel-btn fuel-btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ToggleSwitch({ on, onChange }) {
  return (
    <button
      type="button"
      className={'fuel-switch' + (on ? ' fuel-switch--on' : '')}
      onClick={() => onChange(!on)}
    >
      <span className="fuel-switch-knob" />
    </button>
  );
}
