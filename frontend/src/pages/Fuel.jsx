/**
 * Fuel.jsx — Fuel Module Portal Page
 *
 * Tabs:
 *   Overview   — KPIs (today / month) + by-type breakdown
 *   Fuel Types — CRUD: name, grade label, $/gal (3-decimal), color, default, taxable
 *   Sales Report — date range, by type, gallons + amount + avg price
 *   Settings   — enable, default entry mode, default fuel type, cash-only, allow refunds
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Fuel as FuelIcon, Plus, X, Edit2, Trash2, RefreshCw,
  BarChart2, Settings2, AlertCircle, Star,
  Container, Truck, Gauge, TrendingUp, DollarSign, Droplet,
  Zap,
} from 'lucide-react';
import {
  getFuelTypes, createFuelType, updateFuelType, deleteFuelType,
  getFuelSettings, updateFuelSettings,
  getFuelDashboard, getFuelReport,
  listFuelTanks, createFuelTank, updateFuelTank, deleteFuelTank,
  listManifoldGroups, createManifoldGroup, deleteManifoldGroup,
  listFuelDeliveries, createFuelDelivery, createFuelDeliveryWithMeta, deleteFuelDelivery,
  listStickReadings, createStickReading, deleteStickReading,
  listBlendConfigs, upsertBlendConfig, deleteBlendConfig,
  getFuelInventoryStatus, getFuelPnlReport,
  listFuelPumps, createFuelPump, updateFuelPump, deleteFuelPump,
} from '../services/api';
import TankVisualizer from '../components/fuel/TankVisualizer';
import FuelPumpIcon from '../components/fuel/FuelPumpIcon';
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
          { id: 'overview',   label: 'Overview',       icon: BarChart2 },
          { id: 'types',      label: 'Fuel Types',     icon: FuelIcon },
          { id: 'tanks',      label: 'Tanks',          icon: Container },
          { id: 'pumps',      label: 'Pumps',          icon: Zap },
          { id: 'deliveries', label: 'Deliveries',     icon: Truck },
          { id: 'reconcile',  label: 'Reconciliation', icon: Gauge },
          { id: 'report',     label: 'Reports',        icon: TrendingUp },
          { id: 'settings',   label: 'Settings',       icon: Settings2 },
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

      {storeId && tab === 'overview'   && <OverviewTab    storeId={storeId} setErr={setErr} />}
      {storeId && tab === 'types'      && <TypesTab       storeId={storeId} setErr={setErr} />}
      {storeId && tab === 'tanks'      && <TanksTab       storeId={storeId} setErr={setErr} />}
      {storeId && tab === 'pumps'      && <PumpsTab       storeId={storeId} setErr={setErr} />}
      {storeId && tab === 'deliveries' && <DeliveriesTab  storeId={storeId} setErr={setErr} />}
      {storeId && tab === 'reconcile'  && <ReconcileTab   storeId={storeId} setErr={setErr} />}
      {storeId && tab === 'report'     && <ReportTab      storeId={storeId} setErr={setErr} />}
      {storeId && tab === 'settings'   && <SettingsTab    storeId={storeId} setErr={setErr} />}
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
  const [from, setFrom]               = useState(daysAgoStr(7));
  const [to, setTo]                   = useState(todayStr());
  const [granularity, setGranularity] = useState('daily');
  const [pnl, setPnl]                 = useState(null);
  const [byType, setByType]           = useState(null);
  const [loading, setLoad]            = useState(false);

  const load = useCallback(() => {
    setLoad(true); setErr(null);
    Promise.all([
      getFuelPnlReport({ storeId, from, to, granularity }),
      getFuelReport({ storeId, from, to }),
    ])
      .then(([p, r]) => { setPnl(p); setByType(r); })
      .catch(e => setErr(e.response?.data?.error || e.message))
      .finally(() => setLoad(false));
  }, [storeId, from, to, granularity, setErr]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="fuel-report-tab">
      <div className="fuel-card-head">
        <h3>Sales & P&L Report</h3>
        <div className="fuel-filter-row">
          <label>From</label>
          <input type="date" className="fuel-input" value={from} onChange={e => setFrom(e.target.value)} />
          <label>To</label>
          <input type="date" className="fuel-input" value={to} onChange={e => setTo(e.target.value)} />
          <label>Granularity</label>
          <select className="fuel-input" value={granularity} onChange={e => setGranularity(e.target.value)}>
            <option value="hourly">Hourly</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
          <button className="fuel-btn fuel-btn-ghost" onClick={load}><RefreshCw size={13} /> Refresh</button>
        </div>
      </div>

      {loading && !pnl && <div className="fuel-loading">Loading…</div>}
      {pnl && (
        <>
          <div className="fuel-stat-grid">
            <StatCard label="Net Gallons" value={Number(pnl.totals.gallons || 0).toFixed(1)} color="#16a34a" />
            <StatCard label="Revenue"     value={fmtMoney(pnl.totals.revenue)}                color="#2563eb" />
            <StatCard label="COGS (FIFO)" value={fmtMoney(pnl.totals.cogs)}                   color="#f59e0b" />
            <StatCard label="Profit"      value={fmtMoney(pnl.totals.profit)}                 color="#16a34a" />
            <StatCard label="Margin"      value={`${Number(pnl.totals.marginPct || 0).toFixed(1)}%`} color="#7c3aed" />
            <StatCard label="Avg $/Gal"   value={fmtPrice(pnl.totals.avgPrice)}                color="#0891b2" />
          </div>

          <div className="fuel-card">
            <div className="fuel-card-head"><h3>{granularity.charAt(0).toUpperCase() + granularity.slice(1)} Breakdown (FIFO P&L)</h3></div>
            {pnl.rows.length === 0 ? (
              <div className="fuel-empty">No fuel sales in this date range.</div>
            ) : (
              <div className="fuel-table-wrap">
                <table className="fuel-table">
                  <thead>
                    <tr>
                      <th>Bucket</th>
                      <th style={{ textAlign: 'right' }}>Gallons</th>
                      <th style={{ textAlign: 'right' }}>Revenue</th>
                      <th style={{ textAlign: 'right' }}>COGS</th>
                      <th style={{ textAlign: 'right' }}>Profit</th>
                      <th style={{ textAlign: 'right' }}>Margin</th>
                      <th style={{ textAlign: 'right' }}>Avg $/gal</th>
                      <th style={{ textAlign: 'right' }}>Txns</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pnl.rows.map(r => (
                      <tr key={r.bucket}>
                        <td><b>{r.bucket}</b></td>
                        <td style={{ textAlign: 'right' }}>{Number(r.gallons).toFixed(1)}</td>
                        <td style={{ textAlign: 'right' }}>{fmtMoney(r.revenue)}</td>
                        <td style={{ textAlign: 'right' }}>{fmtMoney(r.cogs)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: r.profit >= 0 ? '#16a34a' : '#dc2626' }}>{fmtMoney(r.profit)}</td>
                        <td style={{ textAlign: 'right' }}>{Number(r.marginPct).toFixed(1)}%</td>
                        <td style={{ textAlign: 'right' }}>{fmtPrice(r.avgPrice)}</td>
                        <td style={{ textAlign: 'right' }}>{r.txCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="fuel-pnl-note">
              COGS + Profit only populated for sales with FIFO trace (recorded after fuel inventory was enabled).
              Pre-FIFO sales show COGS as $0, which reads as 100% margin — scope to dates after your first delivery for meaningful P&L.
            </div>
          </div>
        </>
      )}

      {byType && (
        <div className="fuel-card">
          <div className="fuel-card-head"><h3>By Fuel Type (net of refunds)</h3></div>
          {byType.byType.length === 0 ? (
            <div className="fuel-empty">No fuel sales in this date range.</div>
          ) : (
            <div className="fuel-table-wrap">
              <table className="fuel-table">
                <thead>
                  <tr>
                    <th>Fuel Type</th>
                    <th style={{ textAlign: 'right' }}>Sales Gal</th>
                    <th style={{ textAlign: 'right' }}>Sales $</th>
                    <th style={{ textAlign: 'right' }}>Refund Gal</th>
                    <th style={{ textAlign: 'right' }}>Refund $</th>
                    <th style={{ textAlign: 'right' }}>Net Gal</th>
                    <th style={{ textAlign: 'right' }}>Net $</th>
                    <th style={{ textAlign: 'right' }}>Avg $/gal</th>
                  </tr>
                </thead>
                <tbody>
                  {byType.byType.map(r => (
                    <tr key={r.fuelTypeId}>
                      <td>
                        <span className="fuel-color-dot" style={{ background: r.color || '#94a3b8' }} />
                        {r.name}
                      </td>
                      <td style={{ textAlign: 'right' }}>{Number(r.salesGallons).toFixed(1)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtMoney(r.salesAmount)}</td>
                      <td style={{ textAlign: 'right' }}>{Number(r.refundsGallons).toFixed(1)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtMoney(r.refundsAmount)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>{Number(r.netGallons).toFixed(1)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtMoney(r.netAmount)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtPrice(r.avgPrice)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
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
        reconciliationCadence:  settings.reconciliationCadence,
        varianceAlertThreshold: Number(settings.varianceAlertThreshold),
        blendingEnabled:        settings.blendingEnabled,
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

        {/* ── Pump Tracking (V1.5) ─────────────────────────────────────── */}
        <div className="fuel-settings-subsection">
          <div className="fuel-settings-subsection-title-row">
            <div className="fuel-settings-subsection-title">PUMP TRACKING</div>
            <ToggleSwitch on={!!settings.pumpTrackingEnabled} onChange={v => set('pumpTrackingEnabled', v)} />
          </div>
          <div className="fuel-field-help" style={{ marginTop: 0 }}>
            When <b>ON</b>, cashiers pick a pump in the Fuel modal on every sale and sales get attributed per-pump.
            When <b>OFF</b>, all sales aggregate to the grade's primary/manifold tank with no pump picker in the
            cashier UI. Turn this on to start configuring pumps in the Pumps tab.
          </div>
        </div>

        {/* ── Inventory reconciliation ─────────────────────────────────── */}
        <div className="fuel-settings-subsection">
          <div className="fuel-settings-subsection-title">INVENTORY RECONCILIATION</div>
          <div className="fuel-settings-grid">
            <div className="fuel-field">
              <label>Stick-Reading Cadence</label>
              <select
                className="fuel-input"
                value={settings.reconciliationCadence || 'shift'}
                onChange={e => set('reconciliationCadence', e.target.value)}
              >
                <option value="shift">Per shift (End of Day close)</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="on_demand">On demand</option>
              </select>
              <div className="fuel-field-help">How often managers should enter a measured tank reading.</div>
            </div>
            <div className="fuel-field">
              <label>Variance Alert Threshold (%)</label>
              <input
                type="number"
                min={0}
                step={0.1}
                className="fuel-input"
                value={settings.varianceAlertThreshold ?? 2}
                onChange={e => set('varianceAlertThreshold', e.target.value)}
              />
              <div className="fuel-field-help">Readings whose variance exceeds this % flag an alert on the Reconciliation tab.</div>
            </div>
            <div className="fuel-field">
              <label>Delivery Cost Variance Alert (%)</label>
              <input
                type="number"
                min={0}
                step={0.1}
                className="fuel-input"
                value={settings.deliveryCostVarianceThreshold ?? 5}
                onChange={e => set('deliveryCostVarianceThreshold', e.target.value)}
              />
              <div className="fuel-field-help">
                A new delivery whose $/gal is above the last-3-delivery average by more than this % triggers a warning on save.
                Industry default is 5%; tighten to 3% in volatile markets.
              </div>
            </div>
          </div>
        </div>

        {/* ── Advanced: Dispenser Blending ─────────────────────────────── */}
        <div className="fuel-settings-subsection">
          <div className="fuel-settings-subsection-title-row">
            <div className="fuel-settings-subsection-title">ADVANCED: DISPENSER BLENDING</div>
            <ToggleSwitch on={settings.blendingEnabled} onChange={v => set('blendingEnabled', v)} />
          </div>
          <div className="fuel-field-help" style={{ marginTop: 0 }}>
            Turn this on if your dispensers blend a middle grade (e.g. Plus/89) from two tanks
            (base Regular 87 + Premium 93) rather than drawing from a dedicated tank. When on,
            a "Blends" section appears below to map each blended grade to its base and premium
            tanks with the mix ratio.
          </div>
          {settings.blendingEnabled && (
            <div style={{ marginTop: 14 }}>
              <BlendConfigPanel storeId={storeId} types={types} setErr={setErr} />
            </div>
          )}
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

// ─── Blend config panel — rendered inline inside Settings when enabled ─────
function BlendConfigPanel({ storeId, types, setErr }) {
  const [blends, setBlends]   = useState([]);
  const [adding, setAdding]   = useState(false);

  const load = useCallback(() => {
    listBlendConfigs({ storeId })
      .then(b => setBlends(b || []))
      .catch(e => setErr(e.response?.data?.error || e.message));
  }, [storeId, setErr]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (form) => {
    try {
      await upsertBlendConfig({
        storeId,
        middleFuelTypeId:  form.middleFuelTypeId,
        baseFuelTypeId:    form.baseFuelTypeId,
        premiumFuelTypeId: form.premiumFuelTypeId,
        baseRatio:         Number(form.baseRatio),
        active:            true,
      });
      setAdding(false);
      load();
    } catch (e) {
      setErr(e.response?.data?.error || e.message);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this blend mapping?')) return;
    try {
      await deleteBlendConfig(id);
      load();
    } catch (e) {
      setErr(e.response?.data?.error || e.message);
    }
  };

  return (
    <div className="fuel-blend-panel">
      <div className="fuel-blend-panel-head">
        <div className="fuel-blend-panel-title">Active Blend Mappings</div>
        <button className="fuel-btn fuel-btn-primary" onClick={() => setAdding(true)}>
          <Plus size={12} /> Add Blend
        </button>
      </div>
      {blends.length === 0 ? (
        <div style={{ fontSize: '0.75rem', color: '#64748b', fontStyle: 'italic' }}>
          No blends configured yet.
        </div>
      ) : (
        <div>
          {blends.map(b => (
            <div key={b.id} className="fuel-blend-row">
              <div className="fuel-blend-row-text">
                <b>{b.middleFuelType?.name}</b>
                {' '}= <b>{(Number(b.baseRatio) * 100).toFixed(0)}%</b> {b.baseFuelType?.name}
                {' '}+ <b>{(Number(b.premiumRatio) * 100).toFixed(0)}%</b> {b.premiumFuelType?.name}
              </div>
              <button className="fuel-btn fuel-btn-ghost" onClick={() => handleDelete(b.id)} style={{ color: '#dc2626' }}>
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      {adding && (
        <BlendForm
          types={types}
          existing={blends}
          onSave={handleSave}
          onCancel={() => setAdding(false)}
        />
      )}
    </div>
  );
}

function BlendForm({ types, existing, onSave, onCancel }) {
  const alreadyBlended = new Set(existing.map(b => b.middleFuelTypeId));
  const available = types.filter(t => !alreadyBlended.has(t.id));
  const [form, setForm] = useState({
    middleFuelTypeId:  available[0]?.id || '',
    baseFuelTypeId:    '',
    premiumFuelTypeId: '',
    baseRatio:         '0.67',
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="fuel-modal-overlay" onClick={onCancel}>
      <div className="fuel-modal" onClick={e => e.stopPropagation()}>
        <div className="fuel-modal-head">
          <h3>Add Blend Mapping</h3>
          <button onClick={onCancel} className="fuel-btn fuel-btn-ghost"><X size={14} /></button>
        </div>
        <div className="fuel-modal-body">
          <div className="fuel-form-row">
            <label>Middle Grade (e.g. Plus 89)</label>
            <select value={form.middleFuelTypeId} onChange={e => set('middleFuelTypeId', e.target.value)}>
              <option value="">— Select —</option>
              {available.map(t => <option key={t.id} value={t.id}>{t.name}{t.gradeLabel ? ` (${t.gradeLabel})` : ''}</option>)}
            </select>
          </div>
          <div className="fuel-form-row">
            <label>Base Grade (e.g. Regular 87)</label>
            <select value={form.baseFuelTypeId} onChange={e => set('baseFuelTypeId', e.target.value)}>
              <option value="">— Select —</option>
              {types.filter(t => t.id !== form.middleFuelTypeId).map(t => (
                <option key={t.id} value={t.id}>{t.name}{t.gradeLabel ? ` (${t.gradeLabel})` : ''}</option>
              ))}
            </select>
          </div>
          <div className="fuel-form-row">
            <label>Premium Grade (e.g. Premium 93)</label>
            <select value={form.premiumFuelTypeId} onChange={e => set('premiumFuelTypeId', e.target.value)}>
              <option value="">— Select —</option>
              {types.filter(t => t.id !== form.middleFuelTypeId && t.id !== form.baseFuelTypeId).map(t => (
                <option key={t.id} value={t.id}>{t.name}{t.gradeLabel ? ` (${t.gradeLabel})` : ''}</option>
              ))}
            </select>
          </div>
          <div className="fuel-form-row">
            <label>Base Ratio <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(0 to 1 — the rest is premium)</span></label>
            <input type="number" min={0} max={1} step={0.01} value={form.baseRatio} onChange={e => set('baseRatio', e.target.value)} />
            <div className="fuel-field-help">
              Example: 0.67 → 67% base + 33% premium. Typical 87+93 blend for 89 grade uses 0.67.
            </div>
          </div>
        </div>
        <div className="fuel-modal-foot">
          <button className="fuel-btn fuel-btn-ghost" onClick={onCancel}>Cancel</button>
          <button
            className="fuel-btn fuel-btn-primary"
            disabled={!form.middleFuelTypeId || !form.baseFuelTypeId || !form.premiumFuelTypeId || Number(form.baseRatio) < 0 || Number(form.baseRatio) > 1}
            onClick={() => onSave(form)}
          >
            Create Blend
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

// ═══════════════════════════════════════════════════════════════════════════
// TANKS TAB — list of tanks per grade with the horizontal-cylinder viz
// ═══════════════════════════════════════════════════════════════════════════
function TanksTab({ storeId, setErr }) {
  const [tanks, setTanks]     = useState([]);
  const [types, setTypes]     = useState([]);
  const [groups, setGroups]   = useState([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(null); // null | {} for new | tank object for edit

  const load = useCallback(() => {
    setLoading(true); setErr(null);
    Promise.all([
      listFuelTanks({ storeId }),
      getFuelTypes({ storeId }),
      listManifoldGroups({ storeId }),
    ])
      .then(([t, types, groups]) => { setTanks(t || []); setTypes(types || []); setGroups(groups || []); })
      .catch(e => setErr(e.response?.data?.error || e.message))
      .finally(() => setLoading(false));
  }, [storeId, setErr]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (data) => {
    try {
      if (editing?.id) await updateFuelTank(editing.id, data);
      else              await createFuelTank({ ...data, storeId });
      setEditing(null);
      load();
    } catch (e) {
      setErr(e.response?.data?.error || e.message);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this tank? (Soft delete — historical data preserved.)')) return;
    try {
      await deleteFuelTank(id);
      load();
    } catch (e) {
      setErr(e.response?.data?.error || e.message);
    }
  };

  // Group tanks by fuelTypeId for easier scanning
  const byType = useMemo(() => {
    const m = new Map();
    for (const t of tanks) {
      const k = t.fuelTypeId || 'unknown';
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(t);
    }
    return m;
  }, [tanks]);

  return (
    <div className="fuel-tanks">
      <div className="fuel-card-head">
        <h3>Tanks</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={load} className="fuel-btn fuel-btn-ghost"><RefreshCw size={13} /> Refresh</button>
          <button onClick={() => setEditing({})} className="fuel-btn fuel-btn-primary" disabled={types.length === 0}>
            <Plus size={13} /> New Tank
          </button>
        </div>
      </div>

      {types.length === 0 && (
        <div className="fuel-empty">Create at least one Fuel Type before adding tanks.</div>
      )}

      {loading && <div className="fuel-loading">Loading tanks…</div>}

      {[...byType.entries()].map(([typeId, list]) => {
        const type = types.find(t => t.id === typeId);
        return (
          <div key={typeId} style={{ marginBottom: '1.75rem' }}>
            <div className="fuel-tank-group-header">
              {type?.name || 'Unknown grade'}
              {type?.gradeLabel && <span className="fuel-tank-group-sub">· {type.gradeLabel}</span>}
              <span className="fuel-tank-group-sub">· {list.length} tank{list.length === 1 ? '' : 's'}</span>
            </div>
            <div className="fuel-tanks-grid">
              {list.map(t => (
                <div key={t.id} className="fuel-tank-card">
                  <TankVisualizer
                    label={t.name + (t.tankCode ? ` (${t.tankCode})` : '') + (t.isPrimary ? ' ★' : '')}
                    fuelTypeName={type?.name}
                    fuelColor={type?.color}
                    currentGal={t.currentLevelGal || 0}
                    capacityGal={Number(t.capacityGal)}
                  />
                  <div className="fuel-tank-card-actions">
                    <button
                      onClick={() => setEditing(t)}
                      className="fuel-btn fuel-btn-ghost"
                      title="Edit tank"
                    >
                      <Edit2 size={13} />
                    </button>
                    <button
                      onClick={() => handleDelete(t.id)}
                      className="fuel-btn fuel-btn-ghost"
                      style={{ color: '#dc2626' }}
                      title="Delete tank"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                  <div className="fuel-tank-card-meta">
                    <span>Topology: <b>{t.topology}</b></span>
                    {t.manifoldGroup && <span>Group: <b>{t.manifoldGroup.name}</b></span>}
                    {t.diameterInches && <span><b>{t.diameterInches}"</b> Ø × <b>{t.lengthInches}"</b> L</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {editing && (
        <TankForm
          tank={editing}
          types={types}
          groups={groups}
          onSave={handleSave}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function TankForm({ tank, types, groups, onSave, onCancel }) {
  const [form, setForm] = useState({
    name:            tank?.name            || '',
    tankCode:        tank?.tankCode        || '',
    fuelTypeId:      tank?.fuelTypeId      || (types[0]?.id || ''),
    capacityGal:     tank?.capacityGal     || 10000,
    diameterInches:  tank?.diameterInches  || 96,
    lengthInches:    tank?.lengthInches    || 300,
    topology:        tank?.topology        || 'independent',
    manifoldGroupId: tank?.manifoldGroupId || '',
    isPrimary:       tank?.isPrimary       !== false,
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="fuel-modal-overlay" onClick={onCancel}>
      <div className="fuel-modal" onClick={e => e.stopPropagation()}>
        <div className="fuel-modal-head">
          <h3>{tank?.id ? 'Edit Tank' : 'Add Tank'}</h3>
          <button onClick={onCancel} className="fuel-btn fuel-btn-ghost"><X size={14} /></button>
        </div>
        <div className="fuel-modal-body">
          <div className="fuel-form-row">
            <label>Name</label>
            <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="Tank A - Regular 87" />
          </div>
          <div className="fuel-form-row">
            <label>Tank Code <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
            <input value={form.tankCode} onChange={e => set('tankCode', e.target.value)} placeholder="A1" />
          </div>
          <div className="fuel-form-row">
            <label>Fuel Grade</label>
            <select value={form.fuelTypeId} onChange={e => set('fuelTypeId', e.target.value)}>
              {types.map(t => <option key={t.id} value={t.id}>{t.name}{t.gradeLabel ? ` (${t.gradeLabel})` : ''}</option>)}
            </select>
          </div>
          <div className="fuel-form-row">
            <label>Capacity (gallons)</label>
            <input type="number" min={1} step={1} value={form.capacityGal} onChange={e => set('capacityGal', e.target.value)} />
          </div>
          <div className="fuel-form-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label>Diameter (inches)</label>
              <input type="number" min={1} step={1} value={form.diameterInches} onChange={e => set('diameterInches', e.target.value)} />
            </div>
            <div>
              <label>Length (inches)</label>
              <input type="number" min={1} step={1} value={form.lengthInches} onChange={e => set('lengthInches', e.target.value)} />
            </div>
          </div>
          <div className="fuel-form-row">
            <label>Topology</label>
            <select value={form.topology} onChange={e => set('topology', e.target.value)}>
              <option value="independent">Independent (standalone)</option>
              <option value="manifolded">Manifolded (shares level with group)</option>
              <option value="sequential">Sequential (V1.5 — reserved)</option>
            </select>
          </div>
          {form.topology === 'manifolded' && (
            <div className="fuel-form-row">
              <label>Manifold Group</label>
              <select value={form.manifoldGroupId} onChange={e => set('manifoldGroupId', e.target.value)}>
                <option value="">— Select a group —</option>
                {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
          )}
          <div className="fuel-form-row">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={form.isPrimary} onChange={e => set('isPrimary', e.target.checked)} />
              Primary tank for this grade (when multiple independent tanks exist, sales deduct from this one)
            </label>
          </div>
        </div>
        <div className="fuel-modal-foot">
          <button className="fuel-btn fuel-btn-ghost" onClick={onCancel}>Cancel</button>
          <button
            className="fuel-btn fuel-btn-primary"
            disabled={!form.name.trim() || !form.fuelTypeId || !form.capacityGal}
            onClick={() => onSave({
              ...form,
              capacityGal:    Number(form.capacityGal),
              diameterInches: form.diameterInches ? Number(form.diameterInches) : null,
              lengthInches:   form.lengthInches   ? Number(form.lengthInches)   : null,
              manifoldGroupId: form.topology === 'manifolded' ? (form.manifoldGroupId || null) : null,
            })}
          >
            {tank?.id ? 'Save Changes' : 'Create Tank'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// DELIVERIES TAB — record BOL with per-tank split; show history + FIFO layers
// ═══════════════════════════════════════════════════════════════════════════
function DeliveriesTab({ storeId, setErr }) {
  const [deliveries, setDeliveries] = useState([]);
  const [tanks, setTanks]           = useState([]);
  const [adding, setAdding]         = useState(false);
  const [loading, setLoading]       = useState(false);
  const [varianceWarnings, setVarianceWarnings] = useState([]);

  const load = useCallback(() => {
    setLoading(true); setErr(null);
    Promise.all([
      listFuelDeliveries({ storeId, limit: 50 }),
      listFuelTanks({ storeId }),
    ])
      .then(([d, t]) => { setDeliveries(d || []); setTanks(t || []); })
      .catch(e => setErr(e.response?.data?.error || e.message))
      .finally(() => setLoading(false));
  }, [storeId, setErr]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (payload) => {
    try {
      // V1.5: use the meta-aware helper so we can surface varianceWarnings
      const resp = await createFuelDeliveryWithMeta({ ...payload, storeId });
      setAdding(false);
      if (Array.isArray(resp.varianceWarnings) && resp.varianceWarnings.length > 0) {
        setVarianceWarnings(resp.varianceWarnings);
      } else {
        setVarianceWarnings([]);
      }
      load();
    } catch (e) {
      setErr(e.response?.data?.error || e.message);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this delivery? Only allowed if no fuel from it has been sold.')) return;
    try {
      await deleteFuelDelivery(id);
      load();
    } catch (e) {
      setErr(e.response?.data?.error || e.message);
    }
  };

  return (
    <div className="fuel-deliveries">
      <div className="fuel-card-head">
        <h3>Deliveries</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={load} className="fuel-btn fuel-btn-ghost"><RefreshCw size={13} /> Refresh</button>
          <button onClick={() => setAdding(true)} className="fuel-btn fuel-btn-primary" disabled={tanks.length === 0}>
            <Plus size={13} /> Record Delivery
          </button>
        </div>
      </div>

      {tanks.length === 0 && (
        <div className="fuel-empty">Create at least one tank before recording deliveries.</div>
      )}

      {/* V1.5: Delivery cost variance warnings from the last save */}
      {varianceWarnings.length > 0 && (
        <div className="fuel-variance-warn">
          <AlertCircle size={18} color="#b45309" style={{ flexShrink: 0, marginTop: 1 }} />
          <div className="fuel-variance-warn-body">
            <div className="fuel-variance-warn-title">
              Cost variance alert — price{varianceWarnings.length > 1 ? 's differ' : ' differs'} from recent-delivery average
            </div>
            <div>
              {varianceWarnings.length} of this delivery's tank-lines priced {varianceWarnings.some(w => w.variancePct > 0) ? 'higher' : 'lower'} than the last-3-delivery rolling average by more than the configured threshold ({varianceWarnings[0]?.thresholdPct?.toFixed(1) ?? '5'}%).
            </div>
            {varianceWarnings.map((w, i) => (
              <div key={i} className="fuel-variance-warn-row">
                • <b>{w.tankName}</b>: new ${Number(w.newPricePerGallon).toFixed(3)}/gal vs rolling avg ${Number(w.avgPricePerGallon).toFixed(3)}/gal
                {' '}= <b>{w.variancePct >= 0 ? '+' : ''}{w.variancePct.toFixed(1)}%</b>
              </div>
            ))}
            <div style={{ marginTop: 6, fontStyle: 'italic', fontSize: '0.72rem' }}>
              The delivery is saved. Review your BOL to confirm pricing is correct.
            </div>
          </div>
          <button
            onClick={() => setVarianceWarnings([])}
            className="fuel-btn fuel-btn-ghost"
            style={{ padding: '4px 8px', flexShrink: 0 }}
            title="Dismiss warning"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {loading && <div className="fuel-loading">Loading…</div>}

      {deliveries.length === 0 && !loading ? (
        <div className="fuel-empty">No deliveries recorded yet.</div>
      ) : (
        <div className="fuel-table-wrap">
          <table className="fuel-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Supplier</th>
                <th>BOL #</th>
                <th>Tanks Filled</th>
                <th style={{ textAlign: 'right' }}>Total Gallons</th>
                <th style={{ textAlign: 'right' }}>Total Cost</th>
                <th style={{ textAlign: 'right' }}>Avg $/gal</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {deliveries.map(d => (
                <tr key={d.id}>
                  <td>{new Date(d.deliveryDate).toLocaleDateString()}</td>
                  <td>{d.supplier || <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                  <td>{d.bolNumber || <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                  <td>
                    {(d.items || []).map((it, i) => (
                      <div key={i} style={{ fontSize: '0.72rem' }}>
                        <b>{it.tank?.name || '—'}</b>: {Number(it.gallonsReceived).toFixed(0)} gal @ ${Number(it.pricePerGallon).toFixed(3)}/gal
                        {Number(it.remainingGallons) < Number(it.gallonsReceived) && (
                          <span style={{ color: '#f59e0b', marginLeft: 6 }}>
                            ({Number(it.remainingGallons).toFixed(1)} remaining)
                          </span>
                        )}
                      </div>
                    ))}
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{Number(d.totalGallons).toFixed(1)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtMoney(d.totalCost)}</td>
                  <td style={{ textAlign: 'right' }}>{Number(d.totalGallons) > 0 ? fmtPrice(Number(d.totalCost) / Number(d.totalGallons)) : '—'}</td>
                  <td>
                    <button onClick={() => handleDelete(d.id)} className="fuel-btn fuel-btn-ghost" style={{ color: '#dc2626' }}>
                      <Trash2 size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {adding && (
        <DeliveryForm
          tanks={tanks}
          onSave={handleSave}
          onCancel={() => setAdding(false)}
        />
      )}
    </div>
  );
}

function DeliveryForm({ tanks, onSave, onCancel }) {
  const [deliveryDate, setDeliveryDate] = useState(todayStr());
  const [supplier, setSupplier]         = useState('');
  const [bolNumber, setBolNumber]       = useState('');
  const [notes, setNotes]               = useState('');
  const [items, setItems]               = useState([{ tankId: tanks[0]?.id || '', gallonsReceived: '', pricePerGallon: '' }]);

  const addRow = () => setItems(i => [...i, { tankId: tanks[0]?.id || '', gallonsReceived: '', pricePerGallon: '' }]);
  const removeRow = (idx) => setItems(i => i.filter((_, n) => n !== idx));
  const updateRow = (idx, patch) => setItems(i => i.map((r, n) => n === idx ? { ...r, ...patch } : r));

  const valid = items.length > 0
    && items.every(r => r.tankId && Number(r.gallonsReceived) > 0 && Number(r.pricePerGallon) >= 0);
  const totalGal  = items.reduce((s, r) => s + (Number(r.gallonsReceived) || 0), 0);
  const totalCost = items.reduce((s, r) => s + (Number(r.gallonsReceived) || 0) * (Number(r.pricePerGallon) || 0), 0);

  return (
    <div className="fuel-modal-overlay" onClick={onCancel}>
      <div className="fuel-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 720 }}>
        <div className="fuel-modal-head">
          <h3>Record Delivery</h3>
          <button onClick={onCancel} className="fuel-btn fuel-btn-ghost"><X size={14} /></button>
        </div>
        <div className="fuel-modal-body">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div className="fuel-form-row">
              <label>Delivery Date</label>
              <input type="date" value={deliveryDate} onChange={e => setDeliveryDate(e.target.value)} />
            </div>
            <div className="fuel-form-row">
              <label>Supplier</label>
              <input value={supplier} onChange={e => setSupplier(e.target.value)} placeholder="Shell Distributor" />
            </div>
          </div>
          <div className="fuel-form-row">
            <label>BOL Number</label>
            <input value={bolNumber} onChange={e => setBolNumber(e.target.value)} placeholder="BOL-20260423-001" />
          </div>

          <div style={{ marginTop: 16, fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.06em' }}>
            TANKS FILLED (one truck-drop may split across multiple tanks)
          </div>
          {items.map((row, idx) => (
            <div key={idx} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 32px', gap: 8, marginTop: 8, alignItems: 'center' }}>
              <select value={row.tankId} onChange={e => updateRow(idx, { tankId: e.target.value })}>
                {tanks.map(t => <option key={t.id} value={t.id}>{t.name} ({t.capacityGal} gal)</option>)}
              </select>
              <input type="number" min={0} step={0.1} placeholder="Gallons" value={row.gallonsReceived} onChange={e => updateRow(idx, { gallonsReceived: e.target.value })} />
              <input type="number" min={0} step={0.001} placeholder="$/gal" value={row.pricePerGallon} onChange={e => updateRow(idx, { pricePerGallon: e.target.value })} />
              <button className="fuel-btn fuel-btn-ghost" onClick={() => removeRow(idx)} disabled={items.length === 1} title="Remove">
                <X size={12} />
              </button>
            </div>
          ))}
          <button onClick={addRow} className="fuel-btn fuel-btn-ghost" style={{ marginTop: 8 }}>
            <Plus size={12} /> Add Tank Line
          </button>

          <div className="fuel-form-row" style={{ marginTop: 16 }}>
            <label>Notes</label>
            <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
          </div>

          <div className="fuel-delivery-total">
            <div className="fuel-delivery-total-item">
              <div className="fuel-delivery-total-label">TOTAL</div>
              <div className="fuel-delivery-total-value">{totalGal.toFixed(1)} gal</div>
            </div>
            <div className="fuel-delivery-total-item" style={{ textAlign: 'right' }}>
              <div className="fuel-delivery-total-label">COST</div>
              <div className="fuel-delivery-total-value">{fmtMoney(totalCost)}</div>
            </div>
          </div>
        </div>
        <div className="fuel-modal-foot">
          <button className="fuel-btn fuel-btn-ghost" onClick={onCancel}>Cancel</button>
          <button
            className="fuel-btn fuel-btn-primary"
            disabled={!valid}
            onClick={() => onSave({
              deliveryDate,
              supplier: supplier.trim() || null,
              bolNumber: bolNumber.trim() || null,
              notes:    notes.trim()   || null,
              items: items.map(r => ({
                tankId:          r.tankId,
                gallonsReceived: Number(r.gallonsReceived),
                pricePerGallon:  Number(r.pricePerGallon),
              })),
            })}
          >
            Record Delivery
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// RECONCILIATION TAB — stick-reading entry + variance report
// ═══════════════════════════════════════════════════════════════════════════
function ReconcileTab({ storeId, setErr }) {
  const [readings, setReadings] = useState([]);
  const [tanks, setTanks]       = useState([]);
  const [status, setStatus]     = useState(null);
  const [adding, setAdding]     = useState(false);
  const [loading, setLoading]   = useState(false);

  const load = useCallback(() => {
    setLoading(true); setErr(null);
    Promise.all([
      listStickReadings({ storeId, limit: 100 }),
      listFuelTanks({ storeId }),
      getFuelInventoryStatus({ storeId }),
    ])
      .then(([r, t, st]) => { setReadings(r || []); setTanks(t || []); setStatus(st); })
      .catch(e => setErr(e.response?.data?.error || e.message))
      .finally(() => setLoading(false));
  }, [storeId, setErr]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (payload) => {
    try {
      await createStickReading({ ...payload, storeId });
      setAdding(false);
      load();
    } catch (e) {
      setErr(e.response?.data?.error || e.message);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this stick reading?')) return;
    try {
      await deleteStickReading(id);
      load();
    } catch (e) {
      setErr(e.response?.data?.error || e.message);
    }
  };

  const threshold = Number(status?.threshold || 2);

  return (
    <div className="fuel-reconcile">
      <div className="fuel-card-head">
        <h3>Reconciliation</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={load} className="fuel-btn fuel-btn-ghost"><RefreshCw size={13} /> Refresh</button>
          <button onClick={() => setAdding(true)} className="fuel-btn fuel-btn-primary" disabled={tanks.length === 0}>
            <Plus size={13} /> New Stick Reading
          </button>
        </div>
      </div>

      {status && (
        <div className="fuel-reconcile-info">
          Variance threshold: <b>{threshold.toFixed(1)}%</b> · Cadence: <b>{status.cadence}</b> — change in Settings tab.
        </div>
      )}

      {status?.rows && (
        <div className="fuel-reconcile-grid">
          {status.rows.map(r => (
            <div key={r.tank.id} className={'fuel-reconcile-card' + (r.alerting ? ' fuel-reconcile-card--alert' : '')}>
              <div className="fuel-reconcile-card-head">
                <div>{r.tank.name}</div>
                <div className={'fuel-reconcile-card-status' + (r.alerting ? ' fuel-reconcile-card-status--alert' : '')}>
                  {r.alerting ? '⚠ VARIANCE' : 'OK'}
                </div>
              </div>
              <div className="fuel-reconcile-card-meta">
                {r.tank.fuelType?.name} · {Number(r.currentLevelGal).toFixed(1)} / {Number(r.tank.capacityGal).toFixed(0)} gal
              </div>
              {r.lastReading && (
                <div className="fuel-reconcile-card-reading">
                  Last: <b>{Number(r.lastReading.actualGallons).toFixed(1)}</b> vs expected <b>{Number(r.lastReading.expectedGallons).toFixed(1)}</b> =
                  <span style={{ color: Math.abs(Number(r.lastReading.variancePct)) > threshold ? '#dc2626' : '#16a34a', fontWeight: 700, marginLeft: 4 }}>
                    {Number(r.lastReading.variancePct) >= 0 ? '+' : ''}{Number(r.lastReading.variancePct).toFixed(2)}%
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div style={{ fontSize: '0.82rem', fontWeight: 700, margin: '0.75rem 0 0.5rem' }}>Reading History</div>
      {loading && <div className="fuel-loading">Loading…</div>}
      {readings.length === 0 && !loading ? (
        <div className="fuel-empty">No stick readings recorded yet.</div>
      ) : (
        <div className="fuel-table-wrap">
          <table className="fuel-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Tank</th>
                <th style={{ textAlign: 'right' }}>Actual</th>
                <th style={{ textAlign: 'right' }}>Expected</th>
                <th style={{ textAlign: 'right' }}>Variance</th>
                <th style={{ textAlign: 'right' }}>%</th>
                <th>Notes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {readings.map(r => {
                const pct = Number(r.variancePct);
                const out = Math.abs(pct) > threshold;
                return (
                  <tr key={r.id}>
                    <td>{new Date(r.readingDate).toLocaleString()}</td>
                    <td>{r.tank?.name || '—'}</td>
                    <td style={{ textAlign: 'right' }}>{Number(r.actualGallons).toFixed(1)}</td>
                    <td style={{ textAlign: 'right' }}>{Number(r.expectedGallons).toFixed(1)}</td>
                    <td style={{ textAlign: 'right' }}>{Number(r.variance).toFixed(1)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: out ? '#dc2626' : '#16a34a' }}>
                      {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
                    </td>
                    <td style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{r.notes || '—'}</td>
                    <td>
                      <button onClick={() => handleDelete(r.id)} className="fuel-btn fuel-btn-ghost" style={{ color: '#dc2626' }}>
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {adding && (
        <StickReadingForm
          tanks={tanks}
          onSave={handleSave}
          onCancel={() => setAdding(false)}
        />
      )}
    </div>
  );
}

function StickReadingForm({ tanks, onSave, onCancel }) {
  const [tankId, setTankId]           = useState(tanks[0]?.id || '');
  const [actualGallons, setActual]    = useState('');
  const [notes, setNotes]             = useState('');
  const selected = tanks.find(t => t.id === tankId);
  const expected = selected ? Number(selected.currentLevelGal || 0) : 0;
  const variance = Number(actualGallons || 0) - expected;
  const variancePct = expected > 0 ? (variance / expected) * 100 : 0;

  return (
    <div className="fuel-modal-overlay" onClick={onCancel}>
      <div className="fuel-modal" onClick={e => e.stopPropagation()}>
        <div className="fuel-modal-head">
          <h3>New Stick Reading</h3>
          <button onClick={onCancel} className="fuel-btn fuel-btn-ghost"><X size={14} /></button>
        </div>
        <div className="fuel-modal-body">
          <div className="fuel-form-row">
            <label>Tank</label>
            <select value={tankId} onChange={e => setTankId(e.target.value)}>
              {tanks.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div className="fuel-form-row">
            <label>Actual Gallons (measured)</label>
            <input type="number" min={0} step={0.1} value={actualGallons} onChange={e => setActual(e.target.value)} placeholder="e.g. 8240.5" />
          </div>
          {selected && (
            <div className="fuel-reconcile-info" style={{ marginBottom: 0 }}>
              Software-expected: <b>{expected.toFixed(1)} gal</b>
              {actualGallons && (
                <div style={{ marginTop: 6 }}>
                  Variance: <b style={{ color: Math.abs(variancePct) > 2 ? '#dc2626' : '#16a34a' }}>
                    {variance >= 0 ? '+' : ''}{variance.toFixed(1)} gal ({variancePct >= 0 ? '+' : ''}{variancePct.toFixed(2)}%)
                  </b>
                </div>
              )}
            </div>
          )}
          <div className="fuel-form-row">
            <label>Notes <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
            <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
        </div>
        <div className="fuel-modal-foot">
          <button className="fuel-btn fuel-btn-ghost" onClick={onCancel}>Cancel</button>
          <button
            className="fuel-btn fuel-btn-primary"
            disabled={!tankId || !actualGallons}
            onClick={() => onSave({ tankId, actualGallons: Number(actualGallons), notes: notes.trim() || null })}
          >
            Save Reading
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PUMPS TAB (V1.5)
// ═══════════════════════════════════════════════════════════════════════════
function PumpsTab({ storeId, setErr }) {
  const [pumps, setPumps]         = useState([]);
  const [types, setTypes]         = useState([]);
  const [tanks, setTanks]         = useState([]);
  const [settings, setSettings]   = useState(null);
  const [loading, setLoading]     = useState(false);
  const [editing, setEditing]     = useState(null);

  const load = useCallback(() => {
    setLoading(true); setErr(null);
    Promise.all([
      listFuelPumps({ storeId }),
      getFuelTypes({ storeId }),
      listFuelTanks({ storeId }),
      getFuelSettings(storeId),
    ])
      .then(([p, t, k, s]) => { setPumps(p || []); setTypes(t || []); setTanks(k || []); setSettings(s || null); })
      .catch(e => setErr(e.response?.data?.error || e.message))
      .finally(() => setLoading(false));
  }, [storeId, setErr]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (data) => {
    try {
      if (editing?.id) await updateFuelPump(editing.id, data);
      else              await createFuelPump({ ...data, storeId });
      setEditing(null);
      load();
    } catch (e) {
      setErr(e.response?.data?.error || e.message);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this pump? Historical sales keep their pump attribution.')) return;
    try { await deleteFuelPump(id); load(); }
    catch (e) { setErr(e.response?.data?.error || e.message); }
  };

  const tracking = settings?.pumpTrackingEnabled !== false && settings?.pumpTrackingEnabled !== undefined;

  return (
    <div className="fuel-pumps-tab">
      <div className="fuel-card-head">
        <h3>Pumps</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={load} className="fuel-btn fuel-btn-ghost"><RefreshCw size={13} /> Refresh</button>
          <button onClick={() => setEditing({})} className="fuel-btn fuel-btn-primary">
            <Plus size={13} /> New Pump
          </button>
        </div>
      </div>

      {!tracking && (
        <div className="fuel-reconcile-info" style={{ borderLeft: '3px solid #f59e0b' }}>
          ℹ Pump tracking is currently <b>disabled</b>. Cashiers will not see a pump picker in the Fuel modal.
          Enable it in the Settings tab to start attributing sales to specific pumps.
        </div>
      )}

      {loading && <div className="fuel-loading">Loading…</div>}
      {pumps.length === 0 && !loading ? (
        <div className="fuel-empty">No pumps configured. Add your first pump to start tracking sales per-dispenser.</div>
      ) : (
        <div className="fuel-pumps-grid">
          {pumps.map(p => (
            <div key={p.id} className="fuel-pump-card">
              <FuelPumpIcon
                pumpNumber={p.pumpNumber}
                label={p.label}
                color={p.color}
                size={120}
                showLabel
              />
              <div className="fuel-pump-card-actions">
                <button onClick={() => setEditing(p)} className="fuel-btn fuel-btn-ghost" title="Edit pump">
                  <Edit2 size={13} />
                </button>
                <button onClick={() => handleDelete(p.id)} className="fuel-btn fuel-btn-ghost" style={{ color: '#dc2626' }} title="Delete pump">
                  <Trash2 size={13} />
                </button>
              </div>
              {p.tankOverrides && Object.keys(p.tankOverrides).length > 0 && (
                <div className="fuel-pump-card-meta">
                  <b>Tank overrides:</b>
                  {Object.entries(p.tankOverrides).map(([fuelTypeId, tankId]) => {
                    const type = types.find(t => t.id === fuelTypeId);
                    const tank = tanks.find(t => t.id === tankId);
                    return (
                      <span key={fuelTypeId}>
                        {type?.name || fuelTypeId} → {tank?.name || tankId}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {editing && (
        <PumpForm
          pump={editing}
          types={types}
          tanks={tanks}
          onSave={handleSave}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function PumpForm({ pump, types, tanks, onSave, onCancel }) {
  const [form, setForm] = useState({
    pumpNumber:    pump?.pumpNumber  || '',
    label:         pump?.label       || '',
    color:         pump?.color       || '#16a34a',
    tankOverrides: pump?.tankOverrides || {},
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const setTankOverride = (fuelTypeId, tankId) => {
    setForm(f => {
      const next = { ...(f.tankOverrides || {}) };
      if (!tankId) delete next[fuelTypeId];
      else         next[fuelTypeId] = tankId;
      return { ...f, tankOverrides: next };
    });
  };

  const COLORS = ['#16a34a', '#dc2626', '#2563eb', '#f59e0b', '#7c3aed', '#0891b2', '#475569'];

  return (
    <div className="fuel-modal-overlay" onClick={onCancel}>
      <div className="fuel-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="fuel-modal-head">
          <h3>{pump?.id ? 'Edit Pump' : 'Add Pump'}</h3>
          <button onClick={onCancel} className="fuel-btn fuel-btn-ghost"><X size={14} /></button>
        </div>
        <div className="fuel-modal-body">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
            <div className="fuel-form-row">
              <label>Pump #</label>
              <input
                type="number"
                min={1}
                value={form.pumpNumber}
                onChange={e => set('pumpNumber', e.target.value)}
                placeholder="1"
              />
            </div>
            <div className="fuel-form-row">
              <label>Label <span style={{ color: '#64748b', fontWeight: 400 }}>(optional)</span></label>
              <input
                value={form.label}
                onChange={e => set('label', e.target.value)}
                placeholder="e.g. Entry side"
              />
            </div>
          </div>

          <div className="fuel-form-row">
            <label>Accent Colour</label>
            <div className="fuel-color-row">
              {COLORS.map(c => (
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

          {/* Live preview */}
          <div style={{ display: 'flex', justifyContent: 'center', padding: '0.75rem 0' }}>
            <FuelPumpIcon
              pumpNumber={form.pumpNumber || '?'}
              label={form.label || null}
              color={form.color}
              size={110}
              showLabel
            />
          </div>

          {/* Per-grade tank overrides — advanced */}
          {types.length > 0 && tanks.length > 0 && (
            <details style={{ marginTop: '0.5rem' }}>
              <summary style={{ fontSize: '0.82rem', fontWeight: 700, color: '#475569', cursor: 'pointer' }}>
                Advanced: per-grade tank override
              </summary>
              <div style={{ fontSize: '0.72rem', color: '#64748b', margin: '0.5rem 0' }}>
                Default: this pump draws from each grade's primary tank. Override only when the pump is routed to a specific non-primary tank.
              </div>
              {types.map(t => {
                const tanksForGrade = tanks.filter(k => k.fuelTypeId === t.id);
                if (tanksForGrade.length <= 1) return null;
                return (
                  <div key={t.id} className="fuel-form-row">
                    <label>{t.name}{t.gradeLabel ? ` (${t.gradeLabel})` : ''}</label>
                    <select
                      value={form.tankOverrides?.[t.id] || ''}
                      onChange={e => setTankOverride(t.id, e.target.value)}
                    >
                      <option value="">Use primary (default)</option>
                      {tanksForGrade.map(tk => (
                        <option key={tk.id} value={tk.id}>{tk.name}</option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </details>
          )}
        </div>
        <div className="fuel-modal-foot">
          <button className="fuel-btn fuel-btn-ghost" onClick={onCancel}>Cancel</button>
          <button
            className="fuel-btn fuel-btn-primary"
            disabled={!Number.isFinite(Number(form.pumpNumber)) || Number(form.pumpNumber) <= 0}
            onClick={() => onSave({
              pumpNumber: Number(form.pumpNumber),
              label:      form.label.trim() || null,
              color:      form.color || null,
              tankOverrides: form.tankOverrides || {},
            })}
          >
            {pump?.id ? 'Save Changes' : 'Create Pump'}
          </button>
        </div>
      </div>
    </div>
  );
}
