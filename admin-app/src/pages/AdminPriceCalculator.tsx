/**
 * Admin Price Calculator — Interchange-plus pricing scenarios.
 *
 * Sales-team tool for pitching the StoreVeu processing model. All inputs
 * are number fields (no sliders) and saved scenarios replace the legacy
 * hard-coded store presets. Calculation constants (D&A card-brand fees,
 * GP Schedule A buy rates) are fixed and mirror the source spreadsheet.
 *
 * Superadmin-only. Route: /price-calculator
 */
import { useState, useMemo, useEffect, ReactNode } from 'react';
import { toast } from 'react-toastify';
import {
  Calculator, Plus, Trash2, Save, Search, Loader,
  BarChart3, Scale, Wallet, Sliders, Copy,
} from 'lucide-react';
import {
  listPriceScenarios, getPriceScenario, createPriceScenario,
  updatePriceScenario, deletePriceScenario,
} from '../services/api';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { useConfirm } from '../hooks/useConfirmDialog.jsx';
import './AdminPriceCalculator.css';

// ── D&A rates (fixed card-brand fees — not negotiable) ──
const DA = {
  mc_assessment:   0.0014,
  vi_assessment:   0.0014,
  disc_assessment: 0.0014,
  mc_nabu:         0.0195,
  vi_napf_cr:      0.0195,
  vi_napf_db:      0.0155,
  vi_base2:        0.0187,
};

// ── GP Schedule A buy rates (fixed per contract) ──
const GP = {
  auth_buy:    0.03,
  batch_buy:   0.03,
  pci_buy:     14.95,  pci_must:    19.95,
  breach_buy:  5.00,   breach_must: 6.95,
  gw_buy:      5.00,   gw_must:     10.00,
  acct_buy:    5.00,
  batches:     26,
  ipos:        9.95,
};

interface Inputs {
  storeName: string;
  location: string;
  mcc: string;
  notes: string;
  volume: number;
  txns: number;
  trueIc: number;
  mcVol: number;
  viVol: number;
  discVol: number;
  amexVol: number;
  mcCredit: number;
  mcDebit: number;
  viCredit: number;
  viDebit: number;
  svPct: number;
  svTxn: number;
  svSaas: number;
  currentProc: number;
  currentPosSaas: number;
}

interface Results {
  trueIc: number; total_da: number; ic_da: number;
  da_mc_vol: number; da_vi_vol: number; da_disc_vol: number;
  da_mc_nabu: number; da_vi_cr: number; da_vi_db: number; da_vi_b2: number;
  pct_rev: number; txn_rev: number; batch_rev: number; markup: number;
  fixed: number; total_proc: number; eff_rate: number; allin: number; allin_rate: number;
  earn_pct: number; earn_txn: number; earn_batch: number; earn_pci: number; earn_breach: number; earn_gw: number;
  sv_gross: number; sv_net: number; sv_total: number;
  current_allin: number; saves_mo: number; saves_yr: number;
  ic_pct: number; da_pct: number; markup_pct: number; fixed_pct: number;
}

interface Scenario {
  id: string | number;
  storeName: string;
  location?: string;
  mcc?: string;
  notes?: string;
  inputs?: Partial<Inputs>;
  results?: Partial<Results>;
}

const BLANK_INPUTS: Inputs = {
  storeName: '',
  location: '',
  mcc: '',
  notes: '',
  volume: 0, txns: 0, trueIc: 0,
  mcVol: 0, viVol: 0, discVol: 0, amexVol: 0,
  mcCredit: 0, mcDebit: 0, viCredit: 0, viDebit: 0,
  svPct: 0.05, svTxn: 0.05, svSaas: 79,
  currentProc: 0, currentPosSaas: 0,
};

function calcAll(i: Inputs): Results {
  const {
    volume, txns, trueIc,
    mcVol, viVol, discVol,
    viCredit, viDebit,
    svPct, svTxn, svSaas,
    currentProc, currentPosSaas,
  } = i;

  const vol = Math.max(volume, 0.01);
  const svPctDecimal = svPct / 100;

  // Layer 2: D&A
  const da_mc_vol   = mcVol   * DA.mc_assessment;
  const da_vi_vol   = viVol   * DA.vi_assessment;
  const da_disc_vol = discVol * DA.disc_assessment;
  const da_mc_nabu  = txns    * DA.mc_nabu;
  const da_vi_cr    = viCredit * DA.vi_napf_cr;
  const da_vi_db    = viDebit  * DA.vi_napf_db;
  const da_vi_b2    = viCredit * DA.vi_base2;
  const total_da    = da_mc_vol + da_vi_vol + da_disc_vol + da_mc_nabu + da_vi_cr + da_vi_db + da_vi_b2;
  const ic_da       = trueIc + total_da;

  // Layer 3: SV markup
  const pct_rev   = volume * svPctDecimal;
  const txn_rev   = txns   * svTxn;
  const batch_rev = GP.batches * 0.05;
  const markup    = pct_rev + txn_rev + batch_rev;

  // Layer 4: GP fixed
  const fixed = GP.pci_must + GP.breach_must + GP.gw_must + GP.acct_buy;

  const total_proc = ic_da + markup + fixed;
  const eff_rate   = (total_proc / vol) * 100;
  const allin      = total_proc + svSaas;
  const allin_rate = (allin / vol) * 100;

  // SV earnings
  const txn_margin   = txn_rev - (txns * GP.auth_buy);
  const batch_margin = batch_rev - (GP.batches * GP.batch_buy);
  const earn_pct    = pct_rev    * 0.80;
  const earn_txn    = txn_margin * 0.80;
  const earn_batch  = batch_margin * 0.80;
  const earn_pci    = (GP.pci_must - GP.pci_buy) * 0.50;
  const earn_breach = (GP.breach_must - GP.breach_buy) * 0.80;
  const earn_gw     = (GP.gw_must - GP.gw_buy) * 0.80;
  const sv_gross    = earn_pct + earn_txn + earn_batch + earn_pci + earn_breach + earn_gw;
  const sv_net      = sv_gross - GP.ipos;
  const sv_total    = sv_net + svSaas;

  // Savings vs current
  const current_allin  = currentProc + currentPosSaas;
  const saves_mo       = current_allin - allin;
  const saves_yr       = saves_mo * 12;

  return {
    trueIc, total_da, ic_da,
    da_mc_vol, da_vi_vol, da_disc_vol, da_mc_nabu, da_vi_cr, da_vi_db, da_vi_b2,
    pct_rev, txn_rev, batch_rev, markup,
    fixed, total_proc, eff_rate, allin, allin_rate,
    earn_pct, earn_txn, earn_batch, earn_pci, earn_breach, earn_gw,
    sv_gross, sv_net, sv_total,
    current_allin, saves_mo, saves_yr,
    ic_pct:     (trueIc   / vol) * 100,
    da_pct:     (total_da / vol) * 100,
    markup_pct: (markup   / vol) * 100,
    fixed_pct:  (fixed    / vol) * 100,
  };
}

const fmt  = (n: number | string, d = 2) => `$${parseFloat(String(n || 0)).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
const fmtP = (n: number | string, d = 3) => `${parseFloat(String(n || 0)).toFixed(d)}%`;
const rateColor = (r: number) => r < 1.80 ? '#059669' : r < 2.00 ? '#10b981' : r < 2.20 ? '#f59e0b' : '#ef4444';

interface NumFieldProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  prefix?: string;
  suffix?: string;
  note?: ReactNode;
  step?: number;
}

function NumField({ label, value, onChange, prefix = '$', suffix = '', note, step = 0.01 }: NumFieldProps) {
  return (
    <div className="apc-field">
      <div className="apc-field-head">
        <label className="apc-field-label">{label}</label>
        {note && <span className="apc-field-note">{note}</span>}
      </div>
      <div className="apc-field-input">
        {prefix && <span className="apc-field-prefix">{prefix}</span>}
        <input
          type="number"
          step={step}
          value={value}
          onChange={e => onChange(parseFloat(e.target.value) || 0)}
          className="apc-field-number"
        />
        {suffix && <span className="apc-field-suffix">{suffix}</span>}
      </div>
    </div>
  );
}

interface TextFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multi?: boolean;
}

function TextField({ label, value, onChange, placeholder, multi }: TextFieldProps) {
  return (
    <div className="apc-field">
      <label className="apc-field-label">{label}</label>
      {multi ? (
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          rows={2}
          className="apc-field-text"
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="apc-field-text"
        />
      )}
    </div>
  );
}

type Tab = 'calculator' | 'breakdown' | 'earnings' | 'compare';

export default function AdminPriceCalculator() {
  const confirm = useConfirm();
  const [scenarios,    setScenarios]    = useState<Scenario[]>([]);
  const [loadingList,  setLoadingList]  = useState(true);
  const [search,       setSearch]       = useState('');
  const [activeId,     setActiveId]     = useState<string | number | null>(null);
  const [form,         setForm]         = useState<Inputs>(BLANK_INPUTS);
  const [dirty,        setDirty]        = useState(false);
  const [saving,       setSaving]       = useState(false);
  const [tab,          setTab]          = useState<Tab>('calculator');

  const loadList = async () => {
    setLoadingList(true);
    try {
      const res = await listPriceScenarios();
      setScenarios(res.scenarios || []);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to load scenarios');
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => { loadList(); }, []);

  const setField = (patch: Partial<Inputs>) => { setForm(f => ({ ...f, ...patch })); setDirty(true); };

  const results = useMemo<Results>(() => calcAll(form), [form]);

  const handleNew = async () => {
    if (dirty && !await confirm({
      title: 'Discard unsaved changes?',
      message: 'Discard unsaved changes?',
      confirmLabel: 'Discard',
      danger: true,
    })) return;
    setActiveId(null);
    setForm(BLANK_INPUTS);
    setDirty(false);
    setTab('calculator');
  };

  const handleLoad = async (id: string | number) => {
    if (dirty && !await confirm({
      title: 'Discard unsaved changes?',
      message: 'Discard unsaved changes?',
      confirmLabel: 'Discard',
      danger: true,
    })) return;
    try {
      const s = await getPriceScenario(id);
      setActiveId(s.id);
      setForm({
        ...BLANK_INPUTS,
        ...s.inputs,
        storeName: s.storeName || '',
        location:  s.location  || '',
        mcc:       s.mcc       || '',
        notes:     s.notes     || '',
      });
      setDirty(false);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to load scenario');
    }
  };

  const handleSave = async () => {
    if (!form.storeName.trim()) {
      toast.error('Store name is required');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        storeName: form.storeName,
        location:  form.location,
        mcc:       form.mcc,
        notes:     form.notes,
        inputs:    form,
        results,
      };
      let saved;
      if (activeId) {
        saved = await updatePriceScenario(activeId, payload);
        toast.success('Scenario updated');
      } else {
        saved = await createPriceScenario(payload);
        setActiveId(saved.id);
        toast.success('Scenario saved');
      }
      setDirty(false);
      loadList();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to save scenario');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAs = async () => {
    if (!form.storeName.trim()) {
      toast.error('Store name is required');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        storeName: form.storeName + ' (Copy)',
        location:  form.location,
        mcc:       form.mcc,
        notes:     form.notes,
        inputs:    { ...form, storeName: form.storeName + ' (Copy)' },
        results,
      };
      const saved = await createPriceScenario(payload);
      setActiveId(saved.id);
      setForm(f => ({ ...f, storeName: payload.storeName }));
      setDirty(false);
      toast.success('Saved as copy');
      loadList();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to copy scenario');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!activeId) return;
    if (!await confirm({
      title: 'Delete scenario?',
      message: `Delete scenario "${form.storeName}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    })) return;
    try {
      await deletePriceScenario(activeId);
      toast.success('Scenario deleted');
      setActiveId(null);
      setForm(BLANK_INPUTS);
      setDirty(false);
      loadList();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to delete scenario');
    }
  };

  const filteredScenarios = useMemo(() => {
    if (!search.trim()) return scenarios;
    const s = search.toLowerCase();
    return scenarios.filter(x =>
      (x.storeName || '').toLowerCase().includes(s) ||
      (x.location  || '').toLowerCase().includes(s)
    );
  }, [scenarios, search]);

  return (
    <div className="apc-page">
      <div className="apc-header">
        <div className="apc-header-left">
          <div className="apc-header-icon"><Calculator size={22} /></div>
          <div>
            <h1 className="apc-title">Price Calculator</h1>
            <p className="apc-subtitle">Build and save Interchange-plus pricing scenarios for prospective merchants.</p>
          </div>
        </div>
        <div className="apc-header-right">
          {/* Live rate chips */}
          <div className="apc-chip">
            <span className="apc-chip-label">Processing Rate</span>
            <span className="apc-chip-value" style={{ color: rateColor(results.eff_rate) }}>{fmtP(results.eff_rate)}</span>
          </div>
          <div className="apc-chip">
            <span className="apc-chip-label">All-in Rate</span>
            <span className="apc-chip-value" style={{ color: rateColor(results.allin_rate) }}>{fmtP(results.allin_rate)}</span>
          </div>
          <div className="apc-chip">
            <span className="apc-chip-label">Saves/mo</span>
            <span className="apc-chip-value" style={{ color: results.saves_mo > 0 ? '#10b981' : '#ef4444' }}>{fmt(results.saves_mo)}</span>
          </div>
          <div className="apc-chip">
            <span className="apc-chip-label">SV Earns/mo</span>
            <span className="apc-chip-value apc-chip-value--brand">{fmt(results.sv_total)}</span>
          </div>
        </div>
      </div>

      <div className="apc-shell">
        {/* ── Scenario list (left) ── */}
        <aside className="apc-sidebar">
          <div className="apc-sidebar-head">
            <button className="apc-new-btn" onClick={handleNew}><Plus size={14} /> New</button>
          </div>
          <div className="apc-search-wrap">
            <Search size={13} className="apc-search-icon" />
            <input
              className="apc-search"
              placeholder="Search scenarios…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div className="apc-scenarios">
            {loadingList ? (
              <div className="apc-loading"><Loader size={14} className="apc-spin" /> Loading…</div>
            ) : filteredScenarios.length === 0 ? (
              <div className="apc-empty">
                {search.trim() ? 'No matches' : 'No saved scenarios yet'}
              </div>
            ) : (
              filteredScenarios.map(s => {
                const active = s.id === activeId;
                return (
                  <button
                    key={s.id}
                    onClick={() => handleLoad(s.id)}
                    className={`apc-scenario-card ${active ? 'apc-scenario-card--active' : ''}`}
                  >
                    <div className="apc-scenario-name">{s.storeName}</div>
                    {s.location && <div className="apc-scenario-location">{s.location}</div>}
                    {s.results && (
                      <div className="apc-scenario-meta">
                        <span>{fmtP(s.results.eff_rate || 0)}</span>
                        <span>·</span>
                        <span>{fmt(s.results.saves_mo || 0)}/mo</span>
                      </div>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* ── Calculator body (right) ── */}
        <section className="apc-body">
          <div className="apc-tabs">
            {([
              { id: 'calculator', label: 'Calculator', icon: <Sliders size={13} /> },
              { id: 'breakdown',  label: 'Rate Breakdown', icon: <BarChart3 size={13} /> },
              { id: 'earnings',   label: 'Earnings', icon: <Wallet size={13} /> },
              { id: 'compare',    label: 'vs Current', icon: <Scale size={13} /> },
            ] as { id: Tab; label: string; icon: ReactNode }[]).map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`apc-tab ${tab === t.id ? 'apc-tab--active' : ''}`}
              >
                {t.icon} {t.label}
              </button>
            ))}
            <div className="apc-tabs-spacer" />
            {activeId && (
              <button className="apc-danger-btn" onClick={handleDelete} title="Delete scenario">
                <Trash2 size={13} /> Delete
              </button>
            )}
            <button className="apc-secondary-btn" onClick={handleSaveAs} disabled={saving}>
              <Copy size={13} /> Save As
            </button>
            <button className="apc-primary-btn" onClick={handleSave} disabled={saving || (!dirty && !!activeId)}>
              {saving
                ? <><Loader size={13} className="apc-spin" /> Saving…</>
                : <><Save size={13} /> {activeId ? 'Save' : 'Save Scenario'}</>
              }
            </button>
          </div>

          {tab === 'calculator' && (
            <div className="apc-grid-3">
              {/* Panel 1: Identity + Merchant data */}
              <div className="apc-card">
                <div className="apc-card-head">📋 Scenario</div>
                <TextField label="Store name"      value={form.storeName} onChange={v => setField({ storeName: v })} placeholder="e.g. Smith's Market" />
                <TextField label="Location"        value={form.location}  onChange={v => setField({ location: v })}  placeholder="City, State" />
                <TextField label="MCC / category"  value={form.mcc}       onChange={v => setField({ mcc: v })}       placeholder="5921 Liquor, Retail, etc." />
                <TextField label="Notes"           value={form.notes}     onChange={v => setField({ notes: v })}     placeholder="Internal notes" multi />

                <div className="apc-card-divider">MERCHANT DATA</div>
                <NumField label="Monthly Volume"        value={form.volume}  onChange={v => setField({ volume: v })} note="Total card sales" step={100} />
                <NumField label="Monthly Transactions"  value={form.txns}    onChange={v => setField({ txns: v })} prefix="" suffix="txns" step={1} />
                <NumField label="True Interchange"      value={form.trueIc}  onChange={v => setField({ trueIc: v })} note="From statement" />

                <div className="apc-card-divider">CARD VOLUME SPLIT</div>
                <NumField label="MC Volume"       value={form.mcVol}   onChange={v => setField({ mcVol: v })} step={10} />
                <NumField label="Visa Volume"     value={form.viVol}   onChange={v => setField({ viVol: v })} step={10} />
                <NumField label="Discover Volume" value={form.discVol} onChange={v => setField({ discVol: v })} step={10} />
                <NumField label="Amex Volume"     value={form.amexVol} onChange={v => setField({ amexVol: v })} step={10} />

                <div className="apc-card-divider">TXN SPLIT</div>
                <NumField label="MC Credit Txns"   value={form.mcCredit} onChange={v => setField({ mcCredit: v })} prefix="" suffix="txns" step={1} />
                <NumField label="MC Debit Txns"    value={form.mcDebit}  onChange={v => setField({ mcDebit: v })}  prefix="" suffix="txns" step={1} />
                <NumField label="Visa Credit Txns" value={form.viCredit} onChange={v => setField({ viCredit: v })} prefix="" suffix="txns" step={1} />
                <NumField label="Visa Debit Txns"  value={form.viDebit}  onChange={v => setField({ viDebit: v })}  prefix="" suffix="txns" step={1} />
              </div>

              {/* Panel 2: StoreVeu Pricing */}
              <div className="apc-card apc-card--brand">
                <div className="apc-card-head apc-card-head--brand">⚙️ StoreVeu Pricing (editable)</div>
                <NumField label="Volume Markup %"      value={form.svPct}  onChange={v => setField({ svPct: v })} prefix="" suffix="%" step={0.01}
                  note={`$${(form.volume * form.svPct / 100).toFixed(2)}/mo on $${(form.volume / 1000).toFixed(0)}K`} />
                <NumField label="Per-Transaction Fee"  value={form.svTxn}  onChange={v => setField({ svTxn: v })} step={0.01}
                  note={`$${(form.txns * form.svTxn).toFixed(2)}/mo on ${form.txns} txns`} />
                <NumField label="StoreVeu SaaS Price"  value={form.svSaas} onChange={v => setField({ svSaas: v })} step={1}
                  note="What the merchant pays for POS" />

                <div className="apc-callout apc-callout--brand">
                  <div className="apc-callout-head">MARKUP IMPACT LIVE</div>
                  {[
                    { l: `${form.svPct.toFixed(2)}% × $${(form.volume / 1000).toFixed(0)}K`, v: fmt(form.volume * form.svPct / 100) },
                    { l: `$${form.svTxn.toFixed(2)} × ${form.txns} txns`,                   v: fmt(form.txns * form.svTxn) },
                    { l: 'Batch (26 × $0.05)',                                               v: fmt(26 * 0.05) },
                    { l: 'Total markup',                                                     v: fmt(results.markup), bold: true },
                    { l: 'Markup as % of vol',                                               v: fmtP(results.markup_pct) },
                  ].map(r => (
                    <div key={r.l} className="apc-callout-row">
                      <span>{r.l}</span>
                      <span className={r.bold ? 'apc-callout-val--bold' : 'apc-callout-val'}>{r.v}</span>
                    </div>
                  ))}
                </div>

                <div className="apc-callout apc-callout--purple">
                  <div className="apc-callout-head apc-callout-head--purple">GP Fixed Fees (Schedule A — not editable)</div>
                  {[
                    { l: 'PCI Non-Validation', v: '$19.95 (buy $14.95)' },
                    { l: 'Breach Coverage',    v: '$6.95 (buy $5.00)' },
                    { l: 'Gateway Monthly',    v: '$10.00 (buy $5.00)' },
                    { l: 'Account on File',    v: '$5.00 (GP keeps)' },
                    { l: 'iPOSpays cost',      v: '-$9.95 (your cost)' },
                  ].map(r => (
                    <div key={r.l} className="apc-callout-row">
                      <span>{r.l}</span>
                      <span>{r.v}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Panel 3: Current Processor + Key Results */}
              <div className="apc-card apc-card--danger">
                <div className="apc-card-head apc-card-head--danger">🏷️ Current Processor</div>
                <NumField label="Current Processing Fees/mo"       value={form.currentProc}    onChange={v => setField({ currentProc: v })} note="From their statement" />
                <NumField label="Current POS / SaaS / Other fees"  value={form.currentPosSaas} onChange={v => setField({ currentPosSaas: v })} note="$35 POS, $99 stmt, etc." />

                <div className="apc-callout apc-callout--danger">
                  <div className="apc-callout-head apc-callout-head--danger">CURRENT COST SUMMARY</div>
                  {[
                    { l: 'Processing fees',   v: fmt(form.currentProc) },
                    { l: 'POS / SaaS / Other', v: fmt(form.currentPosSaas) },
                    { l: 'Total all-in',       v: fmt(results.current_allin), bold: true },
                    { l: 'Implied eff. rate',  v: fmtP((form.currentProc / Math.max(form.volume, 0.01)) * 100) },
                  ].map(r => (
                    <div key={r.l} className="apc-callout-row">
                      <span>{r.l}</span>
                      <span className={r.bold ? 'apc-callout-val--bold' : 'apc-callout-val'}>{r.v}</span>
                    </div>
                  ))}
                </div>

                <div className="apc-card-divider">KEY RESULTS</div>
                {[
                  { l: 'IC + D&A floor',       v: fmt(results.ic_da),        sub: fmtP((results.ic_da / Math.max(form.volume, 0.01)) * 100) },
                  { l: 'SV processing',        v: fmt(results.total_proc),   sub: fmtP(results.eff_rate), color: rateColor(results.eff_rate) },
                  { l: 'SV all-in (+SaaS)',    v: fmt(results.allin),        sub: fmtP(results.allin_rate) },
                  { l: 'Current all-in',       v: fmt(results.current_allin), sub: 'cur' },
                  { l: 'Merchant saves/mo',    v: fmt(results.saves_mo),     sub: `${fmt(results.saves_yr)}/yr`, color: results.saves_mo > 0 ? '#10b981' : '#ef4444', bold: true },
                  { l: 'SV earns/mo',          v: fmt(results.sv_total),     sub: `${fmt(results.sv_total * 12)}/yr`, color: 'var(--accent-primary)', bold: true },
                ].map(r => (
                  <div key={r.l} className="apc-keyrow">
                    <span>{r.l}</span>
                    <div className="apc-keyrow-right">
                      <div className={r.bold ? 'apc-keyrow-val--bold' : 'apc-keyrow-val'} style={r.color ? { color: r.color } : {}}>{r.v}</div>
                      <div className="apc-keyrow-sub">{r.sub}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'breakdown' && (
            <div className="apc-grid-2">
              <div className="apc-card">
                <div className="apc-card-head">RATE COMPONENT STACK</div>
                {[
                  { l: 'True Interchange',      v: results.trueIc,      pv: results.ic_pct,                                  lock: true, note: 'From actual statement' },
                  { l: 'MC Assessment 0.14%',   v: results.da_mc_vol,   pv: (results.da_mc_vol / Math.max(form.volume, 0.01)) * 100,  lock: true, note: `0.14% × $${(form.mcVol / 1000).toFixed(0)}K MC vol` },
                  { l: 'Visa Assessment 0.14%', v: results.da_vi_vol,   pv: (results.da_vi_vol / Math.max(form.volume, 0.01)) * 100,  lock: true, note: `0.14% × $${(form.viVol / 1000).toFixed(0)}K Visa vol` },
                  { l: 'MC NABU auth fee',      v: results.da_mc_nabu,  pv: (results.da_mc_nabu / Math.max(form.volume, 0.01)) * 100, lock: true, note: `${form.txns} txns × $0.0195` },
                  { l: 'Visa NAPF credit',      v: results.da_vi_cr,    pv: (results.da_vi_cr / Math.max(form.volume, 0.01)) * 100,   lock: true, note: `${form.viCredit} cr txns × $0.0195` },
                  { l: 'Visa NAPF debit',       v: results.da_vi_db,    pv: (results.da_vi_db / Math.max(form.volume, 0.01)) * 100,   lock: true, note: `${form.viDebit} db txns × $0.0155` },
                  { l: 'Visa Base II trans.',   v: results.da_vi_b2,    pv: (results.da_vi_b2 / Math.max(form.volume, 0.01)) * 100,   lock: true, note: `${form.viCredit} cr txns × $0.0187` },
                  { l: 'Disc Assessment',       v: results.da_disc_vol, pv: (results.da_disc_vol / Math.max(form.volume, 0.01)) * 100,lock: true, note: `0.14% × $${(form.discVol / 1000).toFixed(0)}K Disc` },
                ].map(r => (
                  <div key={r.l} className="apc-stack-row">
                    <span className="apc-stack-lock">🔒</span>
                    <div className="apc-stack-body">
                      <div className="apc-stack-label">{r.l}</div>
                      <div className="apc-stack-note">{r.note}</div>
                    </div>
                    <div className="apc-stack-right">
                      <span className="apc-stack-v">{fmt(r.v)}</span>
                      <span className="apc-stack-pv">({fmtP(r.pv)})</span>
                    </div>
                  </div>
                ))}

                <div className="apc-stack-subtotal">
                  <span>IC + D&A (floor)</span>
                  <span>{fmt(results.ic_da)} ({fmtP((results.ic_da / Math.max(form.volume, 0.01)) * 100)})</span>
                </div>

                {[
                  { l: `${form.svPct.toFixed(2)}% vol markup`,      v: results.pct_rev,   pv: (results.pct_rev / Math.max(form.volume, 0.01)) * 100,   lock: false, note: '✏️ editable' },
                  { l: `$${form.svTxn.toFixed(2)} × ${form.txns} txns`, v: results.txn_rev, pv: (results.txn_rev / Math.max(form.volume, 0.01)) * 100, lock: false, note: '✏️ editable' },
                  { l: 'Batch 26 × $0.05',    v: results.batch_rev, pv: (results.batch_rev / Math.max(form.volume, 0.01)) * 100, lock: false, note: 'minor' },
                  { l: 'PCI Non-Validation',  v: GP.pci_must,       pv: (GP.pci_must / Math.max(form.volume, 0.01)) * 100,       lock: true,  note: 'must bill $19.95' },
                  { l: 'Breach Coverage',     v: GP.breach_must,    pv: (GP.breach_must / Math.max(form.volume, 0.01)) * 100,    lock: true,  note: 'must bill $6.95' },
                  { l: 'Gateway Monthly',     v: GP.gw_must,        pv: (GP.gw_must / Math.max(form.volume, 0.01)) * 100,        lock: true,  note: 'must bill $10.00' },
                  { l: 'Account on File',     v: GP.acct_buy,       pv: (GP.acct_buy / Math.max(form.volume, 0.01)) * 100,       lock: true,  note: 'GP keeps all' },
                ].map(r => (
                  <div key={r.l} className="apc-stack-row">
                    <span className="apc-stack-lock">{r.lock ? '🔒' : '✏️'}</span>
                    <div className="apc-stack-body">
                      <div className="apc-stack-label">{r.l}</div>
                      <div className="apc-stack-note">{r.note}</div>
                    </div>
                    <div className="apc-stack-right">
                      <span className="apc-stack-v">{fmt(r.v)}</span>
                      <span className="apc-stack-pv">({fmtP(r.pv)})</span>
                    </div>
                  </div>
                ))}

                <div className="apc-totals-box">
                  {[
                    { l: 'IC + D&A (non-negotiable floor)', v: results.ic_da,  p: fmtP((results.ic_da / Math.max(form.volume, 0.01)) * 100) },
                    { l: 'SV Markup (your pricing)',        v: results.markup, p: fmtP(results.markup_pct) },
                    { l: 'GP Fixed Fees',                   v: results.fixed,  p: fmtP(results.fixed_pct) },
                  ].map(r => (
                    <div key={r.l} className="apc-totals-row">
                      <span>{r.l}</span>
                      <span>{fmt(r.v)} <small>({r.p})</small></span>
                    </div>
                  ))}
                  <div className="apc-totals-grand">
                    <span>TOTAL PROCESSING</span>
                    <div className="apc-totals-grand-right">
                      <div className="apc-totals-grand-rate" style={{ color: rateColor(results.eff_rate) }}>{fmtP(results.eff_rate)}</div>
                      <div className="apc-totals-grand-amt">{fmt(results.total_proc)}/mo</div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="apc-card">
                <div className="apc-card-head">VISUAL RATE STACK</div>
                {[
                  { l: 'IC (passthrough)',          pv: results.ic_pct,                               c: '#94a3b8', v: results.trueIc },
                  { l: 'D&A (passthrough)',         pv: results.da_pct,                               c: '#64748b', v: results.total_da },
                  { l: `SV ${form.svPct.toFixed(2)}% markup`, pv: (results.pct_rev / Math.max(form.volume, 0.01)) * 100, c: '#10b981', v: results.pct_rev },
                  { l: `SV $${form.svTxn.toFixed(2)}/txn`,    pv: (results.txn_rev / Math.max(form.volume, 0.01)) * 100, c: '#059669', v: results.txn_rev },
                  { l: 'Fixed fees',                pv: results.fixed_pct,                            c: '#7c3aed', v: results.fixed },
                ].map(r => (
                  <div key={r.l} className="apc-bar-row">
                    <div className="apc-bar-head">
                      <span>{r.l}</span>
                      <span className="apc-bar-val" style={{ color: r.c }}>{fmt(r.v)} <small>({fmtP(r.pv)})</small></span>
                    </div>
                    <div className="apc-bar-track">
                      <div className="apc-bar-fill" style={{ width: `${Math.min((r.pv / 2.5) * 100, 100)}%`, background: r.c }} />
                    </div>
                  </div>
                ))}

                <div className="apc-total-line">
                  <div className="apc-total-line-head">
                    <span>TOTAL EFFECTIVE RATE</span>
                    <span className="apc-total-line-rate" style={{ color: rateColor(results.eff_rate) }}>{fmtP(results.eff_rate)}</span>
                  </div>
                  <div className="apc-bar-track apc-bar-track--tall">
                    <div className="apc-bar-fill apc-bar-fill--gradient" style={{ width: `${Math.min((results.eff_rate / 2.5) * 100, 100)}%` }} />
                  </div>
                  <div className="apc-scale">
                    <span>0%</span><span>1.0%</span><span>1.5%</span><span>2.0%</span><span>2.5%</span>
                  </div>
                </div>

                <div className="apc-benchmarks">
                  <div className="apc-benchmarks-head">RATE BENCHMARKS</div>
                  {[
                    { l: 'Theoretical minimum (IC+D&A only, $0 markup)', v: (results.ic_da / Math.max(form.volume, 0.01)) * 100 },
                    { l: 'Your current setting',                         v: results.eff_rate, color: rateColor(results.eff_rate) },
                    { l: 'Target ceiling',                               v: 1.990, color: '#f59e0b' },
                    { l: 'Current processor rate',                       v: (form.currentProc / Math.max(form.volume, 0.01)) * 100, color: '#ef4444' },
                  ].map(r => (
                    <div key={r.l} className="apc-benchmarks-row">
                      <span>{r.l}</span>
                      <span style={r.color ? { color: r.color } : {}}>{fmtP(r.v)}</span>
                    </div>
                  ))}
                  <div className="apc-benchmarks-foot">
                    Headroom to 1.99%: <strong style={{ color: results.eff_rate < 1.99 ? '#10b981' : '#ef4444' }}>
                      {results.eff_rate < 1.99 ? `+${fmtP(1.99 - results.eff_rate)}` : `-${fmtP(results.eff_rate - 1.99)}`}
                    </strong>
                  </div>
                </div>
              </div>
            </div>
          )}

          {tab === 'earnings' && (
            <div className="apc-grid-2">
              <div className="apc-card">
                <div className="apc-card-head">STOREVEU EARNINGS BREAKDOWN</div>
                {[
                  { l: `${form.svPct.toFixed(2)}% vol markup → 80%`,       earn: results.earn_pct,    billed: fmt(results.pct_rev),   note: `margin = ${fmt(results.pct_rev)}, 80% → ${fmt(results.earn_pct)}` },
                  { l: `$${form.svTxn.toFixed(2)}/txn net $${(form.svTxn - 0.03).toFixed(2)} → 80%`, earn: results.earn_txn, billed: fmt(results.txn_rev), note: `buy $0.03, net $${(form.svTxn - 0.03).toFixed(2)} × ${form.txns}` },
                  { l: 'Batch $0.02 net × 26 → 80%',                        earn: results.earn_batch,  billed: '$1.30',                note: 'buy $0.03, bill $0.05' },
                  { l: 'PCI $5.00 margin → 50%',                            earn: results.earn_pci,    billed: '$19.95',               note: 'buy $14.95, 50% split' },
                  { l: 'Breach $1.95 margin → 80%',                         earn: results.earn_breach, billed: '$6.95',                note: 'buy $5.00, 80% split' },
                  { l: 'Gateway $5.00 margin → 80%',                        earn: results.earn_gw,     billed: '$10.00',               note: 'buy $5.00, 80% split' },
                  { l: 'Account on File',                                    earn: 0,                    billed: '$5.00',                note: 'GP keeps 100%' },
                  { l: 'D&A passthrough',                                    earn: 0,                    billed: fmt(results.total_da),  note: 'zero margin — passthrough' },
                ].map(r => (
                  <div key={r.l} className="apc-earnings-row">
                    <div>
                      <div className="apc-earnings-label">{r.l}</div>
                      <div className="apc-earnings-note">{r.note}</div>
                    </div>
                    <div className="apc-earnings-right">
                      <div className="apc-earnings-billed">billed: {r.billed}</div>
                      <div className={r.earn > 0 ? 'apc-earnings-val apc-earnings-val--active' : 'apc-earnings-val'}>
                        earns: {r.earn > 0 ? fmt(r.earn) : '$0.00'}
                      </div>
                    </div>
                  </div>
                ))}

                <div className="apc-totals-box">
                  {[
                    { l: 'Gross processing residual', v: fmt(results.sv_gross) },
                    { l: 'Less: iPOSpays gateway',    v: '-$9.95', danger: true },
                    { l: 'Net processing residual',   v: fmt(results.sv_net), bold: true },
                    { l: `+ SaaS ($${form.svSaas}/mo)`, v: `+${fmt(form.svSaas)}` },
                  ].map(r => (
                    <div key={r.l} className={`apc-totals-row ${r.danger ? 'apc-totals-row--danger' : ''}`}>
                      <span>{r.l}</span>
                      <span className={r.bold ? 'apc-totals-row-val--bold' : ''}>{r.v}</span>
                    </div>
                  ))}
                  <div className="apc-totals-grand">
                    <span>TOTAL / MERCHANT / MO</span>
                    <span className="apc-totals-grand-rate apc-totals-grand-rate--brand">{fmt(results.sv_total)}</span>
                  </div>
                  <div className="apc-totals-grand-sub">Annual: <strong>{fmt(results.sv_total * 12)}</strong></div>
                </div>
              </div>

              <div className="apc-card">
                <div className="apc-card-head">PORTFOLIO SCALE</div>
                <table className="apc-scale-table">
                  <thead>
                    <tr>
                      <th>Merchants</th>
                      <th>Net Resid</th>
                      <th>SaaS</th>
                      <th>Total/mo</th>
                      <th>Annual</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[5, 10, 15, 25, 50, 100, 200].map(n => (
                      <tr key={n}>
                        <td>{n}</td>
                        <td>{fmt(results.sv_net * n, 0)}</td>
                        <td>{fmt(form.svSaas * n, 0)}</td>
                        <td className="apc-scale-cell--brand">{fmt(results.sv_total * n, 0)}</td>
                        <td>{fmt(results.sv_total * n * 12, 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="apc-unit-econ">
                  <div className="apc-unit-econ-head">UNIT ECONOMICS</div>
                  {[
                    { l: 'SV earns per $1K of merchant volume',  v: fmt(results.sv_total / Math.max(form.volume / 1000, 0.01)) },
                    { l: 'Processing residual % of SV revenue', v: fmtP((results.sv_net / Math.max(results.sv_total, 0.01)) * 100) },
                    { l: 'SaaS % of SV revenue',                 v: fmtP((form.svSaas / Math.max(results.sv_total, 0.01)) * 100) },
                    { l: 'iPOSpays as % of gross residual',     v: fmtP((9.95 / Math.max(results.sv_gross, 0.01)) * 100) },
                    { l: 'Effective SV markup above IC+D&A',    v: fmtP(results.markup_pct + results.fixed_pct) },
                  ].map(r => (
                    <div key={r.l} className="apc-unit-econ-row">
                      <span>{r.l}</span>
                      <span>{r.v}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {tab === 'compare' && (
            <div>
              <div className="apc-grid-2">
                <div className="apc-card apc-card--danger">
                  <div className="apc-compare-small-head">CURRENT PROCESSOR</div>
                  <div className="apc-compare-tag apc-compare-tag--danger">What merchant pays now</div>
                  <div className="apc-compare-big">
                    <div className="apc-compare-big-label">EFFECTIVE RATE</div>
                    <div className="apc-compare-big-val apc-compare-big-val--danger">{fmtP((form.currentProc / Math.max(form.volume, 0.01)) * 100)}</div>
                  </div>
                  {[
                    { l: 'Processing fees', v: fmt(form.currentProc),    c: '#ef4444' },
                    { l: 'POS / SaaS',      v: fmt(form.currentPosSaas), c: '#f59e0b' },
                    { l: 'TOTAL ALL-IN',    v: fmt(results.current_allin), c: '#ef4444', bold: true },
                  ].map(r => (
                    <div key={r.l} className="apc-compare-row">
                      <span>{r.l}</span>
                      <span style={{ color: r.c, fontWeight: r.bold ? 800 : 600 }}>{r.v}</span>
                    </div>
                  ))}
                </div>

                <div className="apc-card" style={{ borderColor: `${rateColor(results.eff_rate)}55` }}>
                  <div className="apc-compare-small-head">STOREVEU</div>
                  <div className="apc-compare-tag" style={{ color: rateColor(results.eff_rate) }}>
                    IC + {form.svPct.toFixed(2)}% + ${form.svTxn.toFixed(2)}/txn + ${form.svSaas} SaaS
                  </div>
                  <div className="apc-compare-big">
                    <div className="apc-compare-big-label">EFFECTIVE RATE</div>
                    <div className="apc-compare-big-val" style={{ color: rateColor(results.eff_rate) }}>{fmtP(results.eff_rate)}</div>
                  </div>
                  {[
                    { l: 'Processing fees',          v: fmt(results.total_proc), c: rateColor(results.eff_rate) },
                    { l: `SaaS ($${form.svSaas}/mo)`, v: fmt(form.svSaas),       c: '#7c3aed' },
                    { l: 'TOTAL ALL-IN',             v: fmt(results.allin),     c: rateColor(results.eff_rate), bold: true },
                  ].map(r => (
                    <div key={r.l} className="apc-compare-row">
                      <span>{r.l}</span>
                      <span style={{ color: r.c, fontWeight: r.bold ? 800 : 600 }}>{r.v}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className={`apc-savings-card ${results.saves_mo > 0 ? 'apc-savings-card--pos' : 'apc-savings-card--neg'}`}>
                <div className="apc-savings-grid">
                  {[
                    { l: 'Rate Improvement',  v: `${fmtP((form.currentProc / Math.max(form.volume, 0.01)) * 100)} → ${fmtP(results.eff_rate)}`, c: results.saves_mo > 0 ? '#10b981' : '#ef4444' },
                    { l: 'Saves per Month',   v: fmt(results.saves_mo),  c: results.saves_mo > 0 ? '#10b981' : '#ef4444' },
                    { l: 'Saves per Year',    v: fmt(results.saves_yr),  c: results.saves_mo > 0 ? '#10b981' : '#ef4444' },
                    { l: 'StoreVeu Earns/mo', v: fmt(results.sv_total),  c: 'var(--accent-primary)' },
                  ].map(b => (
                    <div key={b.l} className="apc-savings-cell">
                      <div className="apc-savings-cell-label">{b.l}</div>
                      <div className="apc-savings-cell-val" style={{ color: b.c }}>{b.v}</div>
                    </div>
                  ))}
                </div>
                {results.saves_mo < 0 && (
                  <div className="apc-savings-warn">
                    ⚠️ At these settings, StoreVeu all-in is more expensive than current. Try reducing the SaaS price, or this merchant has a particularly high IC rate (often Amex-heavy). The IC+D&A floor is already <strong>{fmtP((results.ic_da / Math.max(form.volume, 0.01)) * 100)}</strong> — there's limited room.
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
