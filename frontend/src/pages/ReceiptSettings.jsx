/**
 * ReceiptSettings.jsx
 * Configure per-store receipt template with live thermal preview.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Save, Printer, RefreshCw, Info, FileText, Check, Receipt } from 'lucide-react';
import { getStores, getStoreBranding, updateStoreBranding } from '../services/api.js';
import { toast } from 'react-toastify';

import './ReceiptSettings.css';

// ── Preview helpers ───────────────────────────────────────────────────────────
const W80 = 42;
const W58 = 32;

const lineRow = (l, r, W) => {
  const rv = String(r || '');
  const lv = String(l || '').substring(0, W - rv.length).padEnd(W - rv.length);
  return lv + rv;
};
const centre = (s, W) => {
  const str = String(s || '').substring(0, W);
  const sp  = Math.max(0, Math.floor((W - str.length) / 2));
  return ' '.repeat(sp) + str;
};

function buildPreview(cfg, storeName) {
  const W    = cfg.receiptPaperWidth === '58mm' ? W58 : W80;
  const dash = '-'.repeat(W);
  const lines = [];

  lines.push(centre(storeName || 'YOUR STORE NAME', W));
  if (cfg.storeAddress)       lines.push(centre(cfg.storeAddress, W));
  if (cfg.storePhone)         lines.push(centre(cfg.storePhone, W));
  if (cfg.storeEmail)         lines.push(centre(cfg.storeEmail, W));
  if (cfg.storeWebsite)       lines.push(centre(cfg.storeWebsite, W));
  if (cfg.storeTaxId)         lines.push(centre((cfg.taxIdLabel || 'Tax ID') + ': ' + cfg.storeTaxId, W));
  if (cfg.receiptHeaderLine1) lines.push(centre(cfg.receiptHeaderLine1, W));
  if (cfg.receiptHeaderLine2) lines.push(centre(cfg.receiptHeaderLine2, W));
  lines.push('');
  lines.push(dash);

  if (cfg.receiptShowCashier !== false)      lines.push('Cashier: Jane Smith');
  lines.push('Date: ' + new Date().toLocaleDateString() + ' ' + new Date().toLocaleTimeString());
  if (cfg.receiptShowTransactionId !== false) lines.push('Ref: TXN-' + Date.now().toString().slice(-6));
  lines.push(dash);

  lines.push(lineRow('Organic Apples x2', '$7.98', W));
  lines.push(lineRow('Whole Milk 1gal',   '$4.49', W));
  lines.push(lineRow('Sourdough Bread',   '$5.99', W));
  if (cfg.receiptShowSavings !== false)
    lines.push(lineRow('  Member Discount', '-$0.60', W));
  lines.push(dash);

  lines.push(lineRow('Subtotal', '$17.86', W));
  if (cfg.receiptShowTaxBreakdown) {
    lines.push(lineRow('  GST 5%', '$0.62', W));
    lines.push(lineRow('  PST 7%', '$0.87', W));
  } else {
    lines.push(lineRow('Tax', '$1.49', W));
  }
  if (cfg.receiptShowSavings !== false) lines.push(lineRow('Savings', '-$0.60', W));
  lines.push(lineRow('TOTAL', '$18.75', W));
  lines.push(dash);
  lines.push(lineRow('CASH', '$20.00', W));
  lines.push(lineRow('CHANGE', '$1.25', W));
  lines.push(dash);

  lines.push('');
  const addLines = (text) => {
    if (!text) return;
    text.split('\n').forEach(l => { if (l.trim()) lines.push(centre(l, W)); });
  };
  addLines(cfg.receiptFooterLine1);
  addLines(cfg.receiptFooterLine2);

  if (cfg.receiptShowReturnPolicy && cfg.receiptReturnPolicy) {
    lines.push('');
    addLines(cfg.receiptReturnPolicy);
  }
  if (cfg.receiptShowItemCount) {
    lines.push('');
    lines.push(centre('3 items purchased', W));
  }
  lines.push('');
  lines.push(centre('* * *', W));
  return lines;
}

// ── Sub-components ────────────────────────────────────────────────────────────
function SectionCard({ title, subtitle, children }) {
  return (
    <div className="card" style={{ marginBottom: '1.5rem' }}>
      <div className="card-header" style={{ padding: '1rem 1.5rem' }}>
        <h3 className="card-title" style={{ fontSize: '0.95rem', margin: 0 }}>{title}</h3>
        {subtitle && (
          <p style={{ margin: '2px 0 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>{subtitle}</p>
        )}
      </div>
      <div className="card-body" style={{ padding: '1.25rem 1.5rem' }}>
        {children}
      </div>
    </div>
  );
}

function Field({ label, hint, children, half }) {
  return (
    <div style={{ marginBottom: '1rem', ...(half ? {} : {}) }}>
      {label && (
        <label style={{
          display: 'block', marginBottom: 5,
          fontSize: '0.8rem', fontWeight: 600,
          color: 'var(--text-secondary)',
        }}>
          {label}
        </label>
      )}
      {children}
      {hint && (
        <p style={{ margin: '4px 0 0', fontSize: '0.72rem', color: 'var(--text-muted)' }}>{hint}</p>
      )}
    </div>
  );
}

const inputStyle = {
  width: '100%', boxSizing: 'border-box',
  padding: '0.6rem 0.85rem',
  background: 'var(--bg-tertiary)',
  border: '1px solid var(--border-color)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text-primary)',
  fontSize: '0.875rem',
  outline: 'none',
  transition: 'border-color .15s, box-shadow .15s',
  fontFamily: 'var(--font-body)',
};

function Input({ value, onChange, placeholder, maxLength, readOnly }) {
  const [focused, setFocused] = useState(false);
  return (
    <input
      value={value || ''}
      onChange={readOnly ? undefined : e => onChange(e.target.value)}
      placeholder={placeholder}
      maxLength={maxLength}
      readOnly={readOnly}
      style={{
        ...inputStyle,
        background: readOnly ? 'var(--bg-tertiary)' : 'var(--bg-secondary)',
        cursor: readOnly ? 'not-allowed' : 'text',
        color: readOnly ? 'var(--text-muted)' : 'var(--text-primary)',
        borderColor: focused ? 'var(--accent-primary)' : 'var(--border-color)',
        boxShadow: focused ? '0 0 0 3px var(--brand-10)' : 'none',
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    />
  );
}

function Textarea({ value, onChange, placeholder, rows = 3, hint }) {
  const [focused, setFocused] = useState(false);
  return (
    <textarea
      value={value || ''}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      style={{
        ...inputStyle,
        background: 'var(--bg-secondary)',
        resize: 'vertical',
        lineHeight: 1.5,
        borderColor: focused ? 'var(--accent-primary)' : 'var(--border-color)',
        boxShadow: focused ? '0 0 0 3px var(--brand-10)' : 'none',
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    />
  );
}

function Toggle({ label, value, onChange, hint }) {
  return (
    <label style={{
      display: 'flex', alignItems: 'flex-start', gap: 12,
      cursor: 'pointer', padding: '0.6rem 0',
      borderBottom: '1px solid var(--border-light)',
    }}>
      <div
        onClick={() => onChange(!value)}
        style={{
          width: 40, height: 22, borderRadius: 11,
          position: 'relative', flexShrink: 0, marginTop: 1,
          background: value ? 'var(--accent-primary)' : 'var(--border-color)',
          transition: 'background .2s',
          boxShadow: value ? 'var(--shadow-brand)' : 'none',
        }}
      >
        <div style={{
          position: 'absolute', top: 3,
          left: value ? 21 : 3,
          width: 16, height: 16,
          borderRadius: '50%',
          background: '#fff',
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
          transition: 'left .2s',
        }} />
      </div>
      <div>
        <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.4 }}>
          {label}
        </div>
        {hint && (
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>{hint}</div>
        )}
      </div>
    </label>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
const DEFAULT_CFG = {
  storeAddress: '', storePhone: '', storeEmail: '', storeWebsite: '',
  storeTaxId: '', taxIdLabel: 'Tax ID',
  receiptHeaderLine1: '', receiptHeaderLine2: '',
  receiptShowCashier: true, receiptShowTransactionId: true,
  receiptShowItemCount: false, receiptShowTaxBreakdown: false, receiptShowSavings: true,
  receiptFooterLine1: 'Thank you for your purchase!\nPlease come again.',
  receiptFooterLine2: '',
  receiptShowReturnPolicy: false, receiptReturnPolicy: '',
  receiptPaperWidth: '80mm',
  receiptPrintBehavior: 'always',
  theme: 'dark', primaryColor: '#7ac143', logoText: '',
};

export default function ReceiptSettings({ embedded }) {
  const [stores,    setStores]    = useState([]);
  const [storeId,   setStoreId]   = useState('');
  const [storeName, setStoreName] = useState('');
  const [cfg,       setCfg]       = useState(DEFAULT_CFG);
  const [loading,   setLoading]   = useState(false);
  const [saving,    setSaving]    = useState(false);
  const [saved,     setSaved]     = useState(false);

  // Load stores
  useEffect(() => {
    getStores().then(d => {
      const list = d.stores || d || [];
      setStores(list);
      if (list.length) setStoreId(list[0].id);
    }).catch(() => {});
  }, []);

  // Load branding when store changes
  useEffect(() => {
    if (!storeId) return;
    setLoading(true);
    getStoreBranding(storeId)
      .then(data => {
        setStoreName(data.storeName || '');
        setCfg(prev => ({
          ...prev,
          storeAddress:  data.storeAddress  || '',
          storePhone:    data.storePhone     || '',
          storeEmail:    data.storeEmail     || '',
          storeWebsite:  data.storeWebsite   || '',
          storeTaxId:    data.storeTaxId     || '',
          taxIdLabel:    data.taxIdLabel     || 'Tax ID',
          receiptHeaderLine1: data.receiptHeaderLine1 || '',
          receiptHeaderLine2: data.receiptHeaderLine2 || '',
          receiptShowCashier:       data.receiptShowCashier       !== false,
          receiptShowTransactionId: data.receiptShowTransactionId !== false,
          receiptShowItemCount:     Boolean(data.receiptShowItemCount),
          receiptShowTaxBreakdown:  Boolean(data.receiptShowTaxBreakdown),
          receiptShowSavings:       data.receiptShowSavings !== false,
          receiptFooterLine1:  data.receiptFooterLine1  || 'Thank you for your purchase!\nPlease come again.',
          receiptFooterLine2:  data.receiptFooterLine2  || '',
          receiptShowReturnPolicy: Boolean(data.receiptShowReturnPolicy),
          receiptReturnPolicy:     data.receiptReturnPolicy || '',
          receiptPaperWidth:       data.receiptPaperWidth   || '80mm',
          receiptPrintBehavior:    data.receiptPrintBehavior || 'always',
          theme:        data.theme        || 'dark',
          primaryColor: data.primaryColor || '#7ac143',
          logoText:     data.logoText     || '',
        }));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [storeId]);

  const set = useCallback((key, val) => setCfg(prev => ({ ...prev, [key]: val })), []);

  const handleSave = async () => {
    if (!storeId) return;
    setSaving(true);
    setSaved(false);
    try {
      await updateStoreBranding(storeId, cfg);
      toast.success('Receipt settings saved!');
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      toast.error('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const preview = buildPreview(cfg, storeName);
  const W = cfg.receiptPaperWidth === '58mm' ? W58 : W80;

  const content = (
    <>

        {/* ── Page header ── */}
        <div className="p-header">
          <div className="p-header-left">
            <div className="p-header-icon">
              <Receipt size={22} />
            </div>
            <div>
              <h1 className="p-title">Receipt Settings</h1>
              <p className="p-subtitle">Customise what prints on every receipt — changes apply to all registers in this store.</p>
            </div>
          </div>
          <div className="p-header-actions">
            <button
              onClick={handleSave}
              disabled={saving || !storeId}
              className="btn btn-primary"
              style={{
                gap: 7, fontSize: '0.875rem', padding: '0.6rem 1.35rem',
                opacity: saving || !storeId ? 0.65 : 1,
                minWidth: 110, flexShrink: 0,
              }}
            >
              {saving ? (
                <RefreshCw size={15} style={{ animation: 'spin 1s linear infinite' }} />
              ) : saved ? (
                <Check size={15} />
              ) : (
                <Save size={15} />
              )}
              {saving ? 'Saving…' : saved ? 'Saved!' : 'Save'}
            </button>
          </div>
        </div>

        {/* ── Two-column layout ── */}
        <div style={{ display: 'flex', gap: '1.75rem', alignItems: 'flex-start' }}>

          {/* ── LEFT: form ── */}
          <div style={{ flex: 1, minWidth: 0 }}>

            {/* Store picker */}
            {stores.length > 1 && (
              <SectionCard title="Store" subtitle="Apply these receipt settings to a specific store">
                <Field label="Configure settings for">
                  <select
                    value={storeId}
                    onChange={e => setStoreId(e.target.value)}
                    className="form-select"
                  >
                    {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </Field>
              </SectionCard>
            )}

            {loading ? (
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                gap: 10, padding: '4rem', color: 'var(--text-muted)', fontSize: '0.9rem',
              }}>
                <RefreshCw size={18} style={{ animation: 'spin 1s linear infinite' }} />
                Loading settings…
              </div>
            ) : (
              <>
                {/* ── Store Info ── */}
                <SectionCard
                  title="Store Information"
                  subtitle="Printed in the header of every receipt"
                >
                  <Field label="Store Name" hint="Edit the store name in Store Settings">
                    <Input value={storeName} readOnly placeholder="Your store name" />
                  </Field>
                  <div className="grid grid-2" style={{ gap: '0.75rem', marginBottom: '1rem' }}>
                    <Field label="Address">
                      <Input value={cfg.storeAddress} onChange={v => set('storeAddress', v)} placeholder="123 Main St, City, State" />
                    </Field>
                    <Field label="Phone Number">
                      <Input value={cfg.storePhone} onChange={v => set('storePhone', v)} placeholder="(555) 123-4567" />
                    </Field>
                    <Field label="Email (optional)">
                      <Input value={cfg.storeEmail} onChange={v => set('storeEmail', v)} placeholder="store@example.com" />
                    </Field>
                    <Field label="Website (optional)">
                      <Input value={cfg.storeWebsite} onChange={v => set('storeWebsite', v)} placeholder="www.example.com" />
                    </Field>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '0.75rem' }}>
                    <Field label="Tax ID Label">
                      <Input value={cfg.taxIdLabel} onChange={v => set('taxIdLabel', v)} placeholder="Tax ID" maxLength={14} />
                    </Field>
                    <Field label="Tax / GST / VAT Number">
                      <Input value={cfg.storeTaxId} onChange={v => set('storeTaxId', v)} placeholder="e.g. 12-3456789" />
                    </Field>
                  </div>
                </SectionCard>

                {/* ── Custom Header ── */}
                <SectionCard
                  title="Custom Header Lines"
                  subtitle="Printed below store info — great for taglines or promotions"
                >
                  <Field label="Header Line 1" hint="Leave blank to hide">
                    <Input value={cfg.receiptHeaderLine1} onChange={v => set('receiptHeaderLine1', v)} placeholder="e.g. Quality Groceries Since 2010" maxLength={W} />
                  </Field>
                  <Field label="Header Line 2" hint="Leave blank to hide">
                    <Input value={cfg.receiptHeaderLine2} onChange={v => set('receiptHeaderLine2', v)} placeholder="e.g. Member Rewards Available" maxLength={W} />
                  </Field>
                </SectionCard>

                {/* ── Receipt Body ── */}
                <SectionCard
                  title="Receipt Body"
                  subtitle="Toggle which fields appear on printed receipts"
                >
                  <Toggle
                    label="Show Cashier Name"
                    value={cfg.receiptShowCashier}
                    onChange={v => set('receiptShowCashier', v)}
                  />
                  <Toggle
                    label="Show Transaction Reference"
                    value={cfg.receiptShowTransactionId}
                    onChange={v => set('receiptShowTransactionId', v)}
                    hint="The TXN reference number printed after the date"
                  />
                  <Toggle
                    label="Show Item Count"
                    value={cfg.receiptShowItemCount}
                    onChange={v => set('receiptShowItemCount', v)}
                    hint="e.g. '3 items purchased' — printed at the footer"
                  />
                  <Toggle
                    label="Show Tax Breakdown"
                    value={cfg.receiptShowTaxBreakdown}
                    onChange={v => set('receiptShowTaxBreakdown', v)}
                    hint="Show each tax type separately (GST, PST, etc.)"
                  />
                  <Toggle
                    label="Show Savings / Discounts"
                    value={cfg.receiptShowSavings}
                    onChange={v => set('receiptShowSavings', v)}
                    hint="Show discount amounts on individual item lines"
                  />
                </SectionCard>

                {/* ── Footer ── */}
                <SectionCard
                  title="Receipt Footer"
                  subtitle="Custom messages printed below the totals. Use Enter to add multiple lines."
                >
                  <Field
                    label="Footer Message"
                    hint="Use Enter to add new lines. Each line is centred on the receipt."
                  >
                    <Textarea
                      value={cfg.receiptFooterLine1}
                      onChange={v => set('receiptFooterLine1', v)}
                      placeholder={"Thank you for your purchase!\nPlease come again."}
                      rows={3}
                    />
                  </Field>
                  <Field
                    label="Additional Footer Text (optional)"
                    hint="A second block of footer text — e.g. hours, social media, loyalty info."
                  >
                    <Textarea
                      value={cfg.receiptFooterLine2}
                      onChange={v => set('receiptFooterLine2', v)}
                      placeholder={"Mon–Fri: 8am–10pm\nSat–Sun: 9am–9pm"}
                      rows={2}
                    />
                  </Field>
                  <div style={{ marginTop: '0.5rem' }}>
                    <Toggle
                      label="Show Return Policy"
                      value={cfg.receiptShowReturnPolicy}
                      onChange={v => set('receiptShowReturnPolicy', v)}
                    />
                    {cfg.receiptShowReturnPolicy && (
                      <Field label="Return Policy Text" hint="Use Enter to add multiple lines.">
                        <Textarea
                          value={cfg.receiptReturnPolicy}
                          onChange={v => set('receiptReturnPolicy', v)}
                          placeholder={"Returns accepted within 14 days with receipt.\nFinal sale on marked items."}
                          rows={2}
                        />
                      </Field>
                    )}
                  </div>
                </SectionCard>

                {/* ── Paper Settings ── */}
                <SectionCard
                  title="Paper Size"
                  subtitle="Choose the paper width your thermal printer uses"
                >
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                    {[
                      { w: '80mm', chars: '42 chars', desc: 'Standard receipt printer' },
                      { w: '58mm', chars: '32 chars', desc: 'Compact receipt printer' },
                    ].map(({ w, chars, desc }) => {
                      const active = cfg.receiptPaperWidth === w;
                      return (
                        <button
                          key={w}
                          onClick={() => set('receiptPaperWidth', w)}
                          style={{
                            padding: '0.9rem 1rem', textAlign: 'left',
                            borderRadius: 'var(--radius-md)',
                            border: `2px solid ${active ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                            background: active ? 'var(--brand-08)' : 'var(--bg-secondary)',
                            cursor: 'pointer',
                            transition: 'all .15s',
                            display: 'flex', alignItems: 'center', gap: 10,
                          }}
                        >
                          <div style={{
                            width: 20, height: 20, borderRadius: '50%',
                            border: `2px solid ${active ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                            background: active ? 'var(--accent-primary)' : 'transparent',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            flexShrink: 0,
                          }}>
                            {active && <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#fff' }} />}
                          </div>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: '0.9rem', color: active ? 'var(--accent-primary)' : 'var(--text-primary)' }}>
                              {w}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 1 }}>
                              {chars} · {desc}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </SectionCard>

                {/* ── Print Behaviour ── */}
                <SectionCard
                  title="Print Behaviour"
                  subtitle="What happens after every transaction is completed"
                >
                  {[
                    { value: 'always', label: 'Always print',   desc: 'Automatically send receipt to printer after every sale — no prompt.' },
                    { value: 'ask',    label: 'Ask customer',   desc: 'Show a "Print receipt?" prompt after each sale — cashier or customer can choose.' },
                    { value: 'never',  label: 'Never print',    desc: 'Skip receipt printing entirely — move straight to the next transaction.' },
                  ].map(({ value, label, desc }) => {
                    const active = cfg.receiptPrintBehavior === value;
                    return (
                      <button
                        key={value}
                        onClick={() => set('receiptPrintBehavior', value)}
                        style={{
                          display: 'flex', alignItems: 'flex-start', gap: 12,
                          width: '100%', textAlign: 'left', padding: '0.85rem 1rem',
                          borderRadius: 'var(--radius-md)', cursor: 'pointer',
                          border: `2px solid ${active ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                          background: active ? 'var(--brand-08)' : 'var(--bg-secondary)',
                          marginBottom: 8, transition: 'all .15s',
                        }}
                      >
                        <div style={{
                          width: 20, height: 20, borderRadius: '50%', flexShrink: 0, marginTop: 1,
                          border: `2px solid ${active ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                          background: active ? 'var(--accent-primary)' : 'transparent',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          {active && <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#fff' }} />}
                        </div>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: '0.875rem', color: active ? 'var(--accent-primary)' : 'var(--text-primary)' }}>
                            {label}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>{desc}</div>
                        </div>
                      </button>
                    );
                  })}
                </SectionCard>

                {/* ── Info banner ── */}
                <div style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10,
                  padding: '0.85rem 1.1rem',
                  background: 'var(--info-bg)',
                  border: '1px solid rgba(59,130,246,.25)',
                  borderRadius: 'var(--radius-md)',
                  marginBottom: '1.5rem',
                }}>
                  <Info size={15} color="var(--info)" style={{ flexShrink: 0, marginTop: 1 }} />
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
                    Receipts print <strong>directly</strong> to your configured thermal printer — no pop-up dialogs.
                    Configure your printer in <strong>POS Settings → Hardware Setup</strong>.
                  </p>
                </div>

                {/* ── Bottom save ── */}
                <button
                  onClick={handleSave}
                  disabled={saving || !storeId}
                  className="btn btn-primary"
                  style={{
                    width: '100%', justifyContent: 'center', gap: 7,
                    fontSize: '0.95rem', padding: '0.75rem',
                    opacity: saving || !storeId ? 0.65 : 1,
                    marginBottom: '2rem',
                  }}
                >
                  {saving ? (
                    <RefreshCw size={15} style={{ animation: 'spin 1s linear infinite' }} />
                  ) : saved ? (
                    <Check size={15} />
                  ) : (
                    <Save size={15} />
                  )}
                  {saving ? 'Saving…' : saved ? 'Settings Saved!' : 'Save Receipt Settings'}
                </button>
              </>
            )}
          </div>

          {/* ── RIGHT: Live Preview ── */}
          <div style={{ width: 300, flexShrink: 0, position: 'sticky', top: '1.5rem', alignSelf: 'flex-start' }}>
            {/* Preview header */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              marginBottom: '0.6rem',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Printer size={13} color="var(--text-muted)" />
                <span style={{
                  fontSize: '0.7rem', fontWeight: 700,
                  color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em',
                }}>
                  Live Preview
                </span>
              </div>
              <span style={{
                fontSize: '0.68rem', fontWeight: 700,
                background: 'var(--brand-10)', color: 'var(--accent-primary)',
                padding: '2px 8px', borderRadius: 'var(--radius-full)',
                border: '1px solid var(--border-brand)',
              }}>
                {cfg.receiptPaperWidth} thermal
              </span>
            </div>

            {/* Tape visual */}
            <div style={{
              borderRadius: 'var(--radius-md)',
              overflow: 'hidden',
              boxShadow: 'var(--shadow-lg)',
              border: '1px solid var(--border-color)',
            }}>
              {/* Tape serrated top */}
              <div style={{
                height: 10, background: '#e2e8f0',
                backgroundImage: 'repeating-linear-gradient(90deg, transparent 0, transparent 6px, #f8fafc 6px, #f8fafc 8px)',
              }} />

              {/* Receipt paper */}
              <div style={{
                background: '#fefefe',
                padding: '1rem 0.9rem',
                fontFamily: "'Courier New', Courier, monospace",
                fontSize: cfg.receiptPaperWidth === '58mm' ? '9.5px' : '10.5px',
                lineHeight: 1.65,
                color: '#1a1a1a',
                maxHeight: '75vh',
                overflowY: 'auto',
              }}>
                {preview.map((ln, i) => (
                  <div key={i} style={{ whiteSpace: 'pre', minHeight: '1em' }}>{ln || '\u00A0'}</div>
                ))}
              </div>

              {/* Cut line */}
              <div style={{
                background: '#e2e8f0',
                padding: '6px 0',
                display: 'flex', alignItems: 'center', gap: 0,
              }}>
                <div style={{ flex: 1, borderTop: '1.5px dashed #94a3b8', margin: '0 10px' }} />
                <span style={{ fontSize: '9px', color: '#94a3b8', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>✂ cut</span>
                <div style={{ flex: 1, borderTop: '1.5px dashed #94a3b8', margin: '0 10px' }} />
              </div>

              {/* Tape serrated bottom */}
              <div style={{
                height: 10, background: '#e2e8f0',
                backgroundImage: 'repeating-linear-gradient(90deg, transparent 0, transparent 6px, #f8fafc 6px, #f8fafc 8px)',
              }} />
            </div>

            <p style={{
              marginTop: '0.6rem', fontSize: '0.7rem',
              color: 'var(--text-muted)', textAlign: 'center',
            }}>
              Preview updates as you type
            </p>
          </div>

        </div>
    </>
  );

  if (embedded) return <div className="p-tab-content">{content}</div>;

  return (
      <div className="p-page rs-content">
        {content}
      </div>
  );
}
