import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import './analytics.css';
import {
  Store, Plus, X, Loader, AlertCircle, RefreshCw,
  MapPin, Clock, Pencil, PowerOff, Eye, EyeOff, Save,
  Monitor, DollarSign, Zap, CheckCircle2, Radio, Palette,
} from 'lucide-react';
import { getStores, createStore, updateStore, deactivateStore } from '../services/api';
import { useStore } from '../contexts/StoreContext';
import { toast } from 'react-toastify';

/* ── Constants ───────────────────────────────────────────────────────────── */
const TIMEZONES = [
  { label: 'Eastern  (ET)',  value: 'America/New_York'    },
  { label: 'Central  (CT)',  value: 'America/Chicago'     },
  { label: 'Mountain (MT)',  value: 'America/Denver'      },
  { label: 'Pacific  (PT)',  value: 'America/Los_Angeles' },
  { label: 'Arizona  (AZ)',  value: 'America/Phoenix'     },
  { label: 'Alaska   (AK)',  value: 'America/Anchorage'   },
  { label: 'Hawaii   (HI)',  value: 'Pacific/Honolulu'    },
];

/**
 * One POS per store.
 * IT Retail and MarktPOS are the same system — unified under 'itretail'.
 */
const POS_OPTIONS = [
  { value: 'none',       label: 'No POS connected',         color: 'var(--text-muted)'   },
  { value: 'itretail',   label: 'IT Retail / MarktPOS',     color: '#7ac143'              },
  { value: 'square',     label: 'Square',                   color: '#3b82f6'              },
  { value: 'clover',     label: 'Clover',                   color: '#f97316'              },
  { value: 'toast',      label: 'Toast',                    color: '#e30613'              },
  { value: 'lightspeed', label: 'Lightspeed',               color: '#8b5cf6'              },
];

const POS_LABEL = Object.fromEntries(POS_OPTIONS.map(p => [p.value, p.label]));
const POS_COLOR = Object.fromEntries(POS_OPTIONS.map(p => [p.value, p.color]));

const EMPTY_POS = { type: 'none', username: '', password: '', storeCode: '', chainCode: '', locationId: '', merchantId: '', restaurantGuid: '', apiKey: '' };

const EMPTY_FORM = {
  name: '', address: '', timezone: 'America/New_York',
  stationCount: 1,
  pos: EMPTY_POS,
};

const fmt = (n) => '$' + Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Pricing: $99/mo per store (includes 2 registers) + $39/mo per extra register
const calcMonthly = (registers) => {
  const r = Math.max(1, registers || 1);
  return 99 + Math.max(0, r - 2) * 39;
};

/* ── Password field with show/hide ──────────────────────────────────────── */
function PasswordInput({ value, onChange, placeholder }) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <input
        type={show ? 'text' : 'password'}
        className="form-input"
        style={{ paddingRight: '2.5rem' }}
        placeholder={placeholder || '••••••••'}
        value={value}
        onChange={onChange}
      />
      <button type="button" onClick={() => setShow(v => !v)} style={{
        position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)',
        background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)',
      }}>
        {show ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  );
}

/* ── POS credentials section ─────────────────────────────────────────────── */
function PosCredentials({ posType, pos, setPos }) {
  const setField = (k, v) => setPos(p => ({ ...p, [k]: v }));

  if (posType === 'none' || !posType) return (
    <div style={{ padding: '1.25rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.825rem', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)', border: '1px dashed var(--border-color)' }}>
      Select a POS system above to configure credentials
    </div>
  );

  const fields = {
    itretail: [
      { key: 'username',  label: 'Username',            type: 'text',     hint: null },
      { key: 'password',  label: 'Password',            type: 'password', hint: null },
      { key: 'storeCode', label: 'IT Retail Store Code', type: 'text',    hint: "IT Retail's ID for this store in their system" },
      { key: 'chainCode', label: 'IT Retail Chain Code', type: 'text',    hint: "IT Retail's ID for your company/chain in their system" },
    ],
    square: [
      { key: 'locationId', label: 'Location ID', type: 'text'     },
      { key: 'apiKey',     label: 'API Key',     type: 'password' },
    ],
    clover: [
      { key: 'merchantId', label: 'Merchant ID', type: 'text'     },
      { key: 'apiKey',     label: 'API Key',     type: 'password' },
    ],
    toast: [
      { key: 'restaurantGuid', label: 'Restaurant GUID', type: 'text'     },
      { key: 'apiKey',         label: 'API Key',         type: 'password' },
    ],
    lightspeed: [
      { key: 'apiKey', label: 'API Key', type: 'password' },
    ],
  };

  const fieldList = fields[posType] || [];

  return (
    <div style={{
      border: `1px solid ${POS_COLOR[posType]}40`,
      borderRadius: 'var(--radius-md)',
      padding: '1rem',
      background: `${POS_COLOR[posType]}08`,
      marginTop: '0.75rem',
    }}>
      <div style={{ fontSize: '0.72rem', color: POS_COLOR[posType], fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.875rem' }}>
        {POS_LABEL[posType]} credentials
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: fieldList.length > 2 ? '1fr 1fr' : '1fr', gap: '0.6rem' }}>
        {fieldList.map(({ key, label, type, hint }) => (
          <div key={key} className="form-group" style={{ margin: 0 }}>
            <label className="form-label" style={{ marginBottom: '0.3rem' }}>
              {label}
              {hint && <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 400, marginTop: '0.1rem' }}>{hint}</span>}
            </label>
            {type === 'password'
              ? <PasswordInput value={pos[key] || ''} onChange={e => setField(key, e.target.value)} />
              : <input type="text" className="form-input" value={pos[key] || ''} onChange={e => setField(key, e.target.value)} />
            }
          </div>
        ))}
      </div>
      <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.75rem', marginBottom: 0 }}>
        Credentials are encrypted at rest and never shown after saving.
      </p>
    </div>
  );
}

/* ── Store form modal (create + edit) ────────────────────────────────────── */
function StoreModal({ store, onClose, onSaved, onLimitHit }) {
  const isEdit = !!store;

  const buildForm = (s) => ({
    name:         s?.name     || '',
    address:      s?.address  || '',
    timezone:     s?.timezone || 'America/New_York',
    stationCount: s?.stationCount ?? 1,
    pos: {
      type:           s?.pos?.type           || 'none',
      username:       s?.pos?.username       || s?.marktPOSUsername  || '',
      password:       '',  // never pre-fill passwords
      storeCode:      s?.pos?.storeCode      || s?.itRetailStoreId   || '',
      chainCode:      s?.pos?.chainCode      || s?.itRetailTenantId  || '',
      locationId:     s?.pos?.locationId     || '',
      merchantId:     s?.pos?.merchantId     || '',
      restaurantGuid: s?.pos?.restaurantGuid || '',
      apiKey:         '',  // never pre-fill
    },
  });

  const [form,    setForm]    = useState(buildForm(store));
  const [loading, setLoading] = useState(false);
  const [section, setSection] = useState('location');

  const registers     = Math.max(1, parseInt(form.stationCount) || 1);
  const monthlyPreview = calcMonthly(registers);
  const extraRegisters = Math.max(0, registers - 2);

  const setPos = (updater) => setForm(f => ({ ...f, pos: typeof updater === 'function' ? updater(f.pos) : updater }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      // Strip blank secret fields so we don't overwrite with empty strings
      const pos = { ...form.pos };
      if (!pos.password) delete pos.password;
      if (!pos.apiKey)   delete pos.apiKey;

      const payload = {
        name:         form.name,
        address:      form.address || null,
        timezone:     form.timezone,
        stationCount: registers,
        pos,
      };

      const result = isEdit
        ? await updateStore(store._id, payload)
        : await createStore(payload);

      onSaved(result, isEdit);
      toast.success(isEdit ? 'Store updated.' : 'Store created.');
      onClose();
    } catch (err) {
      if (err.response?.status === 402) {
        // Plan store limit hit — surface as a banner, close modal
        onLimitHit?.(err.response.data?.error || 'Store limit reached for your plan.');
        onClose();
      } else {
        toast.error(err.response?.data?.error || 'Could not save store.');
      }
    } finally {
      setLoading(false);
    }
  };

  const Tab = ({ id, label }) => (
    <button type="button" onClick={() => setSection(id)} style={{
      padding: '0.5rem 1rem', border: 'none', background: 'none',
      cursor: 'pointer', fontSize: '0.825rem', fontWeight: section === id ? 700 : 500,
      color: section === id ? 'var(--accent-primary)' : 'var(--text-muted)',
      borderBottom: `2px solid ${section === id ? 'var(--accent-primary)' : 'transparent'}`,
      marginBottom: '-1px', transition: 'all 0.15s',
    }}>
      {label}
    </button>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', padding: '1.75rem', width: '100%', maxWidth: '560px', boxShadow: 'var(--shadow-lg)', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>

        {/* Modal header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
          <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--text-primary)' }}>
            <Store size={18} style={{ marginRight: '0.5rem', verticalAlign: 'middle', color: 'var(--accent-primary)' }} />
            {isEdit ? 'Edit store' : 'Add store'}
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
            <X size={20} />
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', marginBottom: '1.25rem', gap: '0.25rem' }}>
          <Tab id="location"     label="Location"     />
          <Tab id="billing"      label="Billing"      />
          <Tab id="pos"          label="POS System"   />
        </div>

        <form onSubmit={handleSubmit} style={{ flex: 1, overflowY: 'auto' }}>

          {/* ── Location tab ────────────────────────────────────────────── */}
          {section === 'location' && (
            <>
              <div className="form-group">
                <label className="form-label">Store name <span style={{ color: 'var(--error)' }}>*</span></label>
                <input className="form-input" placeholder="e.g. Downtown Location" required
                  value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">
                  <MapPin size={12} style={{ marginRight: '0.3rem', verticalAlign: 'middle' }} />Address
                </label>
                <input className="form-input" placeholder="123 Main St, City, State"
                  value={form.address} onChange={(e) => setForm(f => ({ ...f, address: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">
                  <Clock size={12} style={{ marginRight: '0.3rem', verticalAlign: 'middle' }} />Timezone
                </label>
                <select className="form-input" value={form.timezone} onChange={(e) => setForm(f => ({ ...f, timezone: e.target.value }))} style={{ cursor: 'pointer' }}>
                  {TIMEZONES.map(tz => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
                </select>
              </div>
            </>
          )}

          {/* ── Billing tab ──────────────────────────────────────────────── */}
          {section === 'billing' && (
            <>
              {/* Pricing summary hero */}
              <div style={{ background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)', padding: '1.1rem', marginBottom: '1.25rem',
                border: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase',
                  letterSpacing: '0.05em', marginBottom: '0.4rem' }}>Monthly for this store</div>
                <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--accent-primary)', lineHeight: 1 }}>
                  {fmt(monthlyPreview)}
                  <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)', fontWeight: 400 }}>/mo</span>
                </div>
                {/* Breakdown */}
                <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    <span>Base store fee (includes 2 registers)</span>
                    <span style={{ fontWeight: 600 }}>$99.00</span>
                  </div>
                  {extraRegisters > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      <span>{extraRegisters} additional register{extraRegisters > 1 ? 's' : ''} × $39</span>
                      <span style={{ fontWeight: 600 }}>{fmt(extraRegisters * 39)}</span>
                    </div>
                  )}
                  <div style={{ borderTop: '1px solid var(--border-color)', marginTop: '0.3rem', paddingTop: '0.3rem',
                    display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Annual total</span>
                    <span style={{ fontWeight: 700, color: '#3b82f6' }}>{fmt(monthlyPreview * 12)}/yr</span>
                  </div>
                </div>
              </div>

              {/* Register count picker */}
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">
                  <Monitor size={12} style={{ marginRight: '0.3rem', verticalAlign: 'middle' }} />
                  How many registers at this store?
                </label>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                  {[1, 2, 3, 4, 5, 6].map(n => (
                    <button key={n} type="button"
                      onClick={() => setForm(f => ({ ...f, stationCount: n }))}
                      style={{ padding: '0.45rem 0.9rem', borderRadius: 6, fontSize: '0.85rem', fontWeight: 700,
                        cursor: 'pointer', border: 'none',
                        background: registers === n ? 'var(--accent-primary)' : 'var(--bg-tertiary)',
                        color:      registers === n ? '#fff' : 'var(--text-secondary)',
                        outline:    registers === n ? '2px solid var(--accent-primary)' : '1px solid var(--border-color)',
                        outlineOffset: registers === n ? '2px' : '0',
                      }}>
                      {n}
                    </button>
                  ))}
                  <input type="number" className="form-input" min={1} max={99} placeholder="Custom"
                    style={{ width: 80 }}
                    value={![1,2,3,4,5,6].includes(registers) ? registers : ''}
                    onChange={e => setForm(f => ({ ...f, stationCount: Math.max(1, parseInt(e.target.value) || 1) }))} />
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  First 2 registers included in base fee · additional registers $39/mo each
                </div>
              </div>
            </>
          )}

          {/* ── POS System tab ───────────────────────────────────────────── */}
          {section === 'pos' && (
            <>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
                One POS system per store. IT Retail and MarktPOS are the same platform — select <strong>IT Retail / MarktPOS</strong>.
              </p>

              {/* POS selector tiles */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.25rem' }}>
                {POS_OPTIONS.map(({ value, label, color }) => {
                  const isSelected = form.pos.type === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setPos(p => ({ ...p, type: value }))}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '0.6rem',
                        padding: '0.75rem 0.875rem',
                        border: `1.5px solid ${isSelected ? color : 'var(--border-color)'}`,
                        borderRadius: 'var(--radius-md)',
                        background: isSelected ? `${color}12` : 'var(--bg-tertiary)',
                        cursor: 'pointer',
                        transition: 'all 0.15s',
                        textAlign: 'left',
                      }}
                    >
                      {isSelected
                        ? <CheckCircle2 size={15} style={{ color, flexShrink: 0 }} />
                        : <Radio size={15} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                      }
                      <span style={{ fontSize: '0.825rem', fontWeight: isSelected ? 700 : 500, color: isSelected ? color : 'var(--text-secondary)' }}>
                        {label}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Credentials for selected POS */}
              <PosCredentials posType={form.pos.type} pos={form.pos} setPos={setPos} />
            </>
          )}

          {/* Save / Cancel */}
          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid var(--border-color)' }}>
            <button type="button" onClick={onClose} style={{ flex: 1, padding: '0.875rem', background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" style={{ flex: 2, padding: '0.875rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }} disabled={loading}>
              {loading ? <Loader size={16} className="animate-spin" /> : <><Save size={15} />{isEdit ? 'Save changes' : 'Create store'}</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Store card ──────────────────────────────────────────────────────────── */
function StoreCard({ store, onEdit, onDeactivate }) {
  const [removing, setRemoving] = useState(false);
  const { activeStoreId, switchStore } = useStore();
  const navigate = useNavigate();
  const isActive = store._id === activeStoreId;

  const tzLabel = TIMEZONES.find(t => t.value === store.timezone)?.label || store.timezone;
  const monthly = calcMonthly(store.stationCount ?? 1);
  const posType  = store.pos?.type || 'none';
  const posLabel = POS_LABEL[posType];
  const posColor = POS_COLOR[posType];

  const handleDeactivate = async () => {
    if (!window.confirm(`Deactivate "${store.name}"? It can be reactivated later.`)) return;
    setRemoving(true);
    try {
      await deactivateStore(store._id);
      onDeactivate(store._id);
      toast.success(`${store.name} deactivated.`);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Could not deactivate store.');
      setRemoving(false);
    }
  };

  return (
    <div
      className="analytics-stat-card"
      style={{
        flexDirection: 'column', alignItems: 'flex-start', gap: '0.875rem', padding: '1.25rem',
        border: isActive ? '1.5px solid rgba(122,193,67,0.45)' : '1px solid var(--border-color)',
        cursor: 'pointer',
        transition: 'border-color 0.2s',
      }}
      onClick={() => switchStore(store._id)}
      title={isActive ? 'Currently viewing' : 'Click to switch to this store'}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', gap: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <div style={{
            width: 38, height: 38, borderRadius: '10px',
            background: isActive ? 'rgba(122,193,67,0.2)' : 'rgba(122,193,67,0.1)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <Store size={18} color="var(--accent-primary)" />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>{store.name}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginTop: '0.1rem' }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: isActive ? 'var(--accent-primary)' : '#64748b' }} />
              <span style={{ fontSize: '0.68rem', color: isActive ? 'var(--accent-primary)' : 'var(--text-muted)', fontWeight: 600 }}>
                {isActive ? 'Active view' : 'Click to switch'}
              </span>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.35rem' }} onClick={e => e.stopPropagation()}>
          <button
            onClick={() => navigate(`/portal/branding?store=${store._id}`)}
            title="Customize POS branding"
            style={{
              display: 'flex', alignItems: 'center', gap: '0.3rem',
              background: 'rgba(122,193,67,.08)', border: '1px solid rgba(122,193,67,.3)',
              borderRadius: '8px', padding: '0.3rem 0.6rem', cursor: 'pointer',
              color: '#7ac143', fontSize: '0.72rem', fontWeight: 700,
            }}
          >
            <Palette size={12} /> Branding
          </button>
          <button onClick={() => onEdit(store)} title="Edit"
            style={{ background: 'none', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.3rem 0.45rem', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>
            <Pencil size={13} />
          </button>
          <button onClick={handleDeactivate} title="Deactivate" disabled={removing}
            style={{ background: 'none', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.3rem 0.45rem', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>
            {removing ? <Loader size={13} className="animate-spin" /> : <PowerOff size={13} />}
          </button>
        </div>
      </div>

      {/* Details */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', width: '100%', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
        {store.address && (
          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'flex-start' }}>
            <MapPin size={12} style={{ flexShrink: 0, marginTop: '2px', color: 'var(--text-muted)' }} />
            {store.address}
          </div>
        )}
        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          <Clock size={12} style={{ color: 'var(--text-muted)' }} />
          {tzLabel}
        </div>
      </div>

      {/* Billing + registers */}
      <div style={{
        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)', padding: '0.625rem 0.875rem',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <Monitor size={13} style={{ color: 'var(--text-muted)' }} />
          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            {store.stationCount ?? 1} register{(store.stationCount ?? 1) !== 1 ? 's' : ''}
          </span>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--accent-primary)' }}>
            {fmt(monthly)}<span style={{ fontSize: '0.7rem', fontWeight: 400, color: 'var(--text-muted)' }}>/mo</span>
          </div>
          {(store.stationCount ?? 1) > 2 && (
            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
              $99 base + {fmt((Math.max(0,(store.stationCount??1)-2)) * 39)} extra
            </div>
          )}
        </div>
      </div>

      {/* POS badge */}
      {posType !== 'none' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.7rem', fontWeight: 700, background: `${posColor}12`, color: posColor, padding: '0.2rem 0.6rem', borderRadius: '9999px' }}>
          <Zap size={9} />{posLabel}
        </div>
      ) : (
        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>No POS connected</div>
      )}
    </div>
  );
}

/* ── Plan limit wall ─────────────────────────────────────────────────────── */
function PlanLimitBanner({ message, onDismiss }) {
  if (!message) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0.875rem 1.25rem',
      background: '#f59e0b0d', border: '1px solid #f59e0b40', borderRadius: 10, marginBottom: '1.5rem' }}>
      <AlertCircle size={18} color="#f59e0b" style={{ flexShrink: 0 }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: '0.875rem', fontWeight: 700, color: '#f59e0b' }}>Store limit reached</div>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: 2 }}>{message}</div>
      </div>
      <button onClick={onDismiss}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
        <X size={15} />
      </button>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════ */
export default function StoreManagement() {
  const [stores,      setStores]      = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState(null);
  const [limitMsg,    setLimitMsg]    = useState(null);
  const [showModal,   setShowModal]   = useState(false);
  const [editStore,   setEditStore]   = useState(null);
  const { reload }                    = useStore();

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setStores(await getStores()); }
    catch (e) { setError(e.response?.data?.error || 'Could not load stores.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSaved = (result, isEdit) => {
    setStores(prev => isEdit ? prev.map(s => s._id === result._id ? result : s) : [...prev, result]);
    setLimitMsg(null);
    reload(); // refresh store switcher in sidebar
  };
  const handleLimitHit    = (msg)   => { setLimitMsg(msg); };
  const handleEdit        = (store) => { setEditStore(store); setShowModal(true); };
  const handleDeactivated = (id)    => { setStores(prev => prev.filter(s => s._id !== id)); reload(); };
  const openAdd           = ()      => { setEditStore(null); setShowModal(true); };

  const totalRegisters = stores.reduce((n, s) => n + (s.stationCount || 1), 0);
  const totalMonthly   = stores.reduce((n, s) => n + calcMonthly(s.stationCount || 1), 0);

  return (
    <div className="layout-container">
      <Sidebar />
      <main className="main-content animate-fade-in">

        <div className="analytics-header">
          <div>
            <h1 className="analytics-title" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <Store size={26} style={{ color: 'var(--accent-primary)' }} />Stores
            </h1>
            <p className="analytics-subtitle">Manage your locations, registers and POS connections</p>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button className="filter-btn" onClick={load} disabled={loading}
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <RefreshCw size={14} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />Refresh
            </button>
            <button className="btn btn-primary" onClick={openAdd}
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.55rem 1rem' }}>
              <Plus size={15} />Add store
            </button>
          </div>
        </div>

        {error    && <div className="analytics-error" style={{ marginBottom: '1.5rem' }}><AlertCircle size={16} /><span>{error}</span></div>}
        <PlanLimitBanner message={limitMsg} onDismiss={() => setLimitMsg(null)} />

        {/* KPI row */}
        <div className="analytics-stats-row" style={{ marginBottom: '1.75rem' }}>
          {[
            { label: 'Active stores',    value: stores.length,          color: '#7ac143', bg: 'rgba(122,193,67,0.12)', icon: <Store size={20} /> },
            { label: 'Total registers',  value: totalRegisters,         color: '#3b82f6', bg: 'rgba(59,130,246,0.12)', icon: <Monitor size={20} /> },
            { label: 'Monthly total',    value: fmt(totalMonthly),      color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', icon: <DollarSign size={20} /> },
            { label: 'Annual total',     value: fmt(totalMonthly * 12), color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)', icon: <DollarSign size={20} /> },
          ].map(k => (
            <div key={k.label} className="analytics-stat-card">
              <div className="analytics-stat-icon" style={{ background: k.bg, color: k.color }}>{k.icon}</div>
              <div>
                <span className="analytics-stat-label">{k.label}</span>
                <span className="analytics-stat-value" style={{ color: k.color }}>{k.value}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Store grid */}
        {loading && !stores.length ? (
          <div className="analytics-loading"><div className="analytics-loading-spinner" /><span>Loading stores…</span></div>
        ) : stores.length === 0 ? (
          <div className="analytics-chart-card" style={{ textAlign: 'center', padding: '3.5rem' }}>
            <Store size={40} style={{ opacity: 0.15, marginBottom: '0.75rem' }} />
            <p style={{ color: 'var(--text-muted)', marginBottom: '1.25rem' }}>No stores yet. Add your first location.</p>
            <button className="btn btn-primary" onClick={openAdd} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
              <Plus size={15} />Add store
            </button>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1.25rem' }}>
            {stores.map(s => (
              <StoreCard key={s._id} store={s} onEdit={handleEdit} onDeactivate={handleDeactivated} />
            ))}
          </div>
        )}
      </main>

      {showModal && (
        <StoreModal
          store={editStore}
          onClose={() => { setShowModal(false); setEditStore(null); }}
          onSaved={handleSaved}
          onLimitHit={handleLimitHit}
        />
      )}
    </div>
  );
}
