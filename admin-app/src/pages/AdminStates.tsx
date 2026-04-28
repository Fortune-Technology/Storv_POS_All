/**
 * AdminStates — superadmin-managed US-state catalog.
 *
 * Each state carries defaults (sales tax rate, bottle-deposit rules,
 * alcohol/tobacco age limits, lottery commission) that stores inherit
 * when their stateCode is set in Store Settings. Lottery games tagged
 * to a state via LotteryGame.state are filtered by this same code.
 */
import { useState, useEffect, useMemo } from 'react';
import { toast } from 'react-toastify';
import { Plus, Edit2, Trash2, Search, MapPin, Loader, X, Save, Check } from 'lucide-react';
import {
  listAdminStates, createAdminState, updateAdminState, deleteAdminState,
} from '../services/api';
import './AdminStates.css';

interface DepositRule {
  containerType?: string;
  material?: string;
  minVolumeOz?: string | number | null;
  maxVolumeOz?: string | number | null;
  depositAmount?: string | number;
}

interface PackSizeRule {
  maxPrice?: string | number;
  packSize?: string | number;
}

interface LotteryGameStub {
  [key: string]: unknown;
}

interface StateForm {
  code: string;
  name: string;
  country: string;
  defaultTaxRate: string;
  defaultLotteryCommission: string;
  instantSalesCommRate: string;
  instantCashingCommRate: string;
  machineSalesCommRate: string;
  machineCashingCommRate: string;
  alcoholAgeLimit: string | number;
  tobaccoAgeLimit: string | number;
  bottleDepositRules: DepositRule[];
  lotteryGameStubs: LotteryGameStub[];
  lotteryPackSizeRules: PackSizeRule[];
  // Session 50 — dual pricing per-state policy
  surchargeTaxable: boolean;
  maxSurchargePercent: string;
  dualPricingAllowed: boolean;
  pricingFraming: 'surcharge' | 'cash_discount';
  surchargeDisclosureText: string;
  notes: string;
  active: boolean;
}

interface UsState {
  code: string;
  name: string;
  country?: string;
  defaultTaxRate?: number | null;
  defaultLotteryCommission?: number | null;
  instantSalesCommRate?: number | null;
  instantCashingCommRate?: number | null;
  machineSalesCommRate?: number | null;
  machineCashingCommRate?: number | null;
  alcoholAgeLimit?: number;
  tobaccoAgeLimit?: number;
  bottleDepositRules?: DepositRule[];
  lotteryGameStubs?: LotteryGameStub[];
  lotteryPackSizeRules?: PackSizeRule[];
  // Session 50 — dual pricing per-state policy
  surchargeTaxable?: boolean;
  maxSurchargePercent?: number | string | null;
  dualPricingAllowed?: boolean;
  pricingFraming?: 'surcharge' | 'cash_discount' | string;
  surchargeDisclosureText?: string | null;
  notes?: string;
  active?: boolean;
}

type ModalMode = 'create' | 'edit' | null;

const BLANK: StateForm = {
  code: '', name: '', country: 'US',
  defaultTaxRate: '', defaultLotteryCommission: '',
  // 3e — per-revenue-stream commission rates (superadmin, state-wide)
  instantSalesCommRate: '', instantCashingCommRate: '',
  machineSalesCommRate: '', machineCashingCommRate: '',
  alcoholAgeLimit: 21, tobaccoAgeLimit: 21,
  bottleDepositRules: [],
  lotteryGameStubs: [],
  lotteryPackSizeRules: [],
  // Session 50 — dual pricing per-state policy defaults
  surchargeTaxable: false,
  maxSurchargePercent: '4.000',
  dualPricingAllowed: true,
  pricingFraming: 'surcharge',
  surchargeDisclosureText: '',
  notes: '', active: true,
};

const BLANK_DEPOSIT: DepositRule  = { containerType: 'bottle', material: 'glass', minVolumeOz: '', maxVolumeOz: '', depositAmount: 0.05 };
const BLANK_PACK_RULE: PackSizeRule = { maxPrice: '', packSize: '' };

// Default pack-size rules for the US — prefilled when superadmin picks
// "Use default" on an empty list. Matches the backend DEFAULT_PACK_SIZE_RULES.
const DEFAULT_US_PACK_RULES: PackSizeRule[] = [
  { maxPrice: 1,    packSize: 300 },
  { maxPrice: 2,    packSize: 200 },
  { maxPrice: 3,    packSize: 200 },
  { maxPrice: 5,    packSize: 100 },
  { maxPrice: 10,   packSize: 50  },
  { maxPrice: 20,   packSize: 30  },
  { maxPrice: 30,   packSize: 20  },
  { maxPrice: 9999, packSize: 10  },
];

export default function AdminStates() {
  const [states,      setStates]   = useState<UsState[]>([]);
  const [loading,     setLoading]  = useState(true);
  const [search,      setSearch]   = useState('');
  const [modalMode,   setModalMode] = useState<ModalMode>(null);
  const [form,        setForm]     = useState<StateForm>(BLANK);
  const [saving,      setSaving]   = useState(false);

  const loadStates = async () => {
    setLoading(true);
    try {
      const res = await listAdminStates();
      // Shared UsStateRecord types the JSON columns as unknown[]; the page uses
      // narrower local shapes (DepositRule / PackSizeRule) derived from the same rows.
      setStates((res.states || []) as UsState[]);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to load states');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadStates(); }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return states;
    const s = search.toLowerCase();
    return states.filter(x =>
      (x.code || '').toLowerCase().includes(s) ||
      (x.name || '').toLowerCase().includes(s)
    );
  }, [states, search]);

  const openCreate = () => { setForm(BLANK); setModalMode('create'); };
  const openEdit   = (s: UsState) => {
    setForm({
      code:                     s.code,
      name:                     s.name,
      country:                  s.country || 'US',
      defaultTaxRate:           s.defaultTaxRate != null ? String(s.defaultTaxRate) : '',
      defaultLotteryCommission: s.defaultLotteryCommission != null ? String(s.defaultLotteryCommission) : '',
      instantSalesCommRate:     s.instantSalesCommRate     != null ? String(s.instantSalesCommRate)     : '',
      instantCashingCommRate:   s.instantCashingCommRate   != null ? String(s.instantCashingCommRate)   : '',
      machineSalesCommRate:     s.machineSalesCommRate     != null ? String(s.machineSalesCommRate)     : '',
      machineCashingCommRate:   s.machineCashingCommRate   != null ? String(s.machineCashingCommRate)   : '',
      alcoholAgeLimit:          s.alcoholAgeLimit || 21,
      tobaccoAgeLimit:          s.tobaccoAgeLimit || 21,
      bottleDepositRules:       Array.isArray(s.bottleDepositRules) ? s.bottleDepositRules : [],
      lotteryGameStubs:         Array.isArray(s.lotteryGameStubs) ? s.lotteryGameStubs : [],
      lotteryPackSizeRules:     Array.isArray(s.lotteryPackSizeRules) ? s.lotteryPackSizeRules : [],
      // Session 50 — dual pricing per-state policy
      surchargeTaxable:         !!s.surchargeTaxable,
      maxSurchargePercent:      s.maxSurchargePercent != null ? String(s.maxSurchargePercent) : '',
      dualPricingAllowed:       s.dualPricingAllowed !== false,
      pricingFraming:           s.pricingFraming === 'cash_discount' ? 'cash_discount' : 'surcharge',
      surchargeDisclosureText:  s.surchargeDisclosureText || '',
      notes:                    s.notes || '',
      active:                   s.active !== false,
    });
    setModalMode('edit');
  };
  const closeModal = () => setModalMode(null);

  const setField = (patch: Partial<StateForm>) => setForm(f => ({ ...f, ...patch }));

  const addDeposit    = () => setField({ bottleDepositRules: [...form.bottleDepositRules, { ...BLANK_DEPOSIT }] });
  const updateDeposit = (idx: number, patch: Partial<DepositRule>) => {
    const next = [...form.bottleDepositRules];
    next[idx] = { ...next[idx], ...patch };
    setField({ bottleDepositRules: next });
  };
  const removeDeposit = (idx: number) => setField({ bottleDepositRules: form.bottleDepositRules.filter((_, i) => i !== idx) });

  // Lottery pack-size rule helpers
  const addPackRule     = () => setField({ lotteryPackSizeRules: [...form.lotteryPackSizeRules, { ...BLANK_PACK_RULE }] });
  const updatePackRule  = (idx: number, patch: Partial<PackSizeRule>) => {
    const next = [...form.lotteryPackSizeRules];
    next[idx] = { ...next[idx], ...patch };
    setField({ lotteryPackSizeRules: next });
  };
  const removePackRule  = (idx: number) => setField({ lotteryPackSizeRules: form.lotteryPackSizeRules.filter((_, i) => i !== idx) });
  const loadDefaultPackRules = () => setField({
    lotteryPackSizeRules: DEFAULT_US_PACK_RULES.map(r => ({ ...r })),
  });

  const handleSave = async () => {
    if (!form.code || !/^[A-Z]{2}$/.test(form.code.toUpperCase())) {
      toast.error('Code must be a 2-letter US state code');
      return;
    }
    if (!form.name.trim()) {
      toast.error('Name is required');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        code:                     form.code.toUpperCase(),
        name:                     form.name.trim(),
        country:                  form.country,
        defaultTaxRate:           form.defaultTaxRate === '' ? null : Number(form.defaultTaxRate),
        defaultLotteryCommission: form.defaultLotteryCommission === '' ? null : Number(form.defaultLotteryCommission),
        instantSalesCommRate:     form.instantSalesCommRate   === '' ? null : Number(form.instantSalesCommRate),
        instantCashingCommRate:   form.instantCashingCommRate === '' ? null : Number(form.instantCashingCommRate),
        machineSalesCommRate:     form.machineSalesCommRate   === '' ? null : Number(form.machineSalesCommRate),
        machineCashingCommRate:   form.machineCashingCommRate === '' ? null : Number(form.machineCashingCommRate),
        alcoholAgeLimit:          Number(form.alcoholAgeLimit) || 21,
        tobaccoAgeLimit:          Number(form.tobaccoAgeLimit) || 21,
        bottleDepositRules:       form.bottleDepositRules.map(r => ({
          containerType: r.containerType || 'bottle',
          material:      r.material || 'glass',
          minVolumeOz:   r.minVolumeOz === '' ? null : Number(r.minVolumeOz),
          maxVolumeOz:   r.maxVolumeOz === '' ? null : Number(r.maxVolumeOz),
          depositAmount: Number(r.depositAmount) || 0,
        })),
        lotteryGameStubs:         form.lotteryGameStubs,
        // Pack-size rules: strip any blank rows, coerce numbers, order by
        // maxPrice asc so the lookup picks the smallest bracket first.
        lotteryPackSizeRules:     form.lotteryPackSizeRules
          .filter(r => r.maxPrice !== '' && r.packSize !== '')
          .map(r => ({ maxPrice: Number(r.maxPrice), packSize: Number(r.packSize) }))
          .sort((a, b) => a.maxPrice - b.maxPrice),
        // Session 50 — dual pricing per-state policy
        surchargeTaxable:         !!form.surchargeTaxable,
        maxSurchargePercent:      form.maxSurchargePercent === '' ? null : Number(form.maxSurchargePercent),
        dualPricingAllowed:       !!form.dualPricingAllowed,
        pricingFraming:           form.pricingFraming === 'cash_discount' ? 'cash_discount' : 'surcharge',
        surchargeDisclosureText:  form.surchargeDisclosureText.trim() || null,
        notes:                    form.notes || null,
        active:                   !!form.active,
      };
      if (modalMode === 'create') {
        await createAdminState(payload);
        toast.success('State created');
      } else {
        await updateAdminState(form.code, payload);
        toast.success('State updated');
      }
      closeModal();
      loadStates();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to save state');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (s: UsState) => {
    if (!window.confirm(`Delete ${s.name} (${s.code})?`)) return;
    try {
      await deleteAdminState(s.code);
      toast.success('State deleted');
      loadStates();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to delete state');
    }
  };

  return (
    <div className="as-page">
      <div className="as-header">
        <div className="as-header-left">
          <div className="as-header-icon"><MapPin size={22} /></div>
          <div>
            <h1 className="as-title">US States</h1>
            <p className="as-subtitle">Manage per-state defaults — stores inherit these when their state is selected.</p>
          </div>
        </div>
        <div className="as-header-actions">
          <div className="as-search-wrap">
            <Search size={13} className="as-search-icon" />
            <input className="as-search" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <button className="as-btn-primary" onClick={openCreate}><Plus size={13} /> Add State</button>
        </div>
      </div>

      {loading ? (
        <div className="as-loading"><Loader size={16} className="as-spin" /> Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="as-empty">
          <MapPin size={28} className="as-empty-icon" />
          <p>{search.trim() ? 'No states match your search' : 'No states yet — click "Add State" to get started'}</p>
        </div>
      ) : (
        <div className="as-grid">
          {filtered.map(s => (
            <div key={s.code} className={`as-card ${s.active ? '' : 'as-card--inactive'}`}>
              <div className="as-card-head">
                <div>
                  <div className="as-card-code">{s.code}</div>
                  <div className="as-card-name">{s.name}</div>
                </div>
                <div className="as-card-actions">
                  <button className="as-icon-btn" onClick={() => openEdit(s)} title="Edit"><Edit2 size={13} /></button>
                  <button className="as-icon-btn as-icon-btn--danger" onClick={() => handleDelete(s)} title="Delete"><Trash2 size={13} /></button>
                </div>
              </div>
              <div className="as-card-stats">
                <div className="as-stat">
                  <span className="as-stat-label">Tax</span>
                  <span className="as-stat-val">{s.defaultTaxRate != null ? `${(Number(s.defaultTaxRate) * 100).toFixed(2)}%` : '—'}</span>
                </div>
                <div className="as-stat">
                  <span className="as-stat-label">Lottery comm</span>
                  <span className="as-stat-val">{s.defaultLotteryCommission != null ? `${(Number(s.defaultLotteryCommission) * 100).toFixed(2)}%` : '—'}</span>
                </div>
                <div className="as-stat">
                  <span className="as-stat-label">Alcohol</span>
                  <span className="as-stat-val">{s.alcoholAgeLimit}+</span>
                </div>
                <div className="as-stat">
                  <span className="as-stat-label">Tobacco</span>
                  <span className="as-stat-val">{s.tobaccoAgeLimit}+</span>
                </div>
                <div className="as-stat">
                  <span className="as-stat-label">Deposit rules</span>
                  <span className="as-stat-val">{(s.bottleDepositRules || []).length}</span>
                </div>
                <div className="as-stat">
                  <span className="as-stat-label">Status</span>
                  <span className={`as-stat-val ${s.active ? 'as-stat-val--ok' : 'as-stat-val--muted'}`}>
                    {s.active ? <><Check size={10} /> Active</> : 'Inactive'}
                  </span>
                </div>
              </div>
              {s.notes && <div className="as-card-notes">{s.notes}</div>}
            </div>
          ))}
        </div>
      )}

      {/* ── Create / Edit modal ── */}
      {modalMode && (
        <div className="as-modal-backdrop" onClick={closeModal}>
          <div className="as-modal" onClick={e => e.stopPropagation()}>
            <div className="as-modal-head">
              <h2>{modalMode === 'create' ? 'Add State' : `Edit ${form.name || form.code}`}</h2>
              <button className="as-icon-btn" onClick={closeModal}><X size={16} /></button>
            </div>

            <div className="as-modal-body">
              <div className="as-form-grid">
                <div className="as-field">
                  <label>State Code (2 letters)</label>
                  <input
                    value={form.code}
                    maxLength={2}
                    disabled={modalMode === 'edit'}
                    onChange={e => setField({ code: e.target.value.toUpperCase().replace(/[^A-Z]/g, '') })}
                    placeholder="MA"
                  />
                </div>
                <div className="as-field">
                  <label>Name</label>
                  <input value={form.name} onChange={e => setField({ name: e.target.value })} placeholder="Massachusetts" />
                </div>
                <div className="as-field">
                  <label>Default Sales Tax (decimal)</label>
                  <input
                    type="number"
                    step="0.0001"
                    value={form.defaultTaxRate}
                    onChange={e => setField({ defaultTaxRate: e.target.value })}
                    placeholder="0.0625"
                  />
                  <span className="as-hint">e.g. 0.0625 = 6.25%</span>
                </div>
                <div className="as-field">
                  <label>Lottery Commission — legacy single rate</label>
                  <input
                    type="number"
                    step="0.0001"
                    value={form.defaultLotteryCommission}
                    onChange={e => setField({ defaultLotteryCommission: e.target.value })}
                    placeholder="0.05"
                  />
                  <span className="as-hint">Fallback if the per-stream rates below are blank. e.g. 0.05 = 5%.</span>
                </div>

                {/* 3e — per-revenue-stream commission rates */}
                <div className="as-field as-field--full">
                  <div style={{
                    padding: '8px 10px',
                    background: 'rgba(99, 102, 241, 0.06)',
                    border: '1px solid rgba(99, 102, 241, 0.2)',
                    borderRadius: 6,
                    fontSize: '0.78rem',
                    color: 'var(--text-primary)',
                    marginBottom: 8,
                  }}>
                    <strong>Per-revenue-stream commission rates.</strong> Set by superadmin; applies to every store in this state.
                    Each field is a decimal (e.g. <code>0.054</code> = 5.4%). Leave blank to fall back to the legacy single rate above.
                  </div>
                </div>
                <div className="as-field">
                  <label>Instant Sales Commission</label>
                  <input
                    type="number" step="0.0001" placeholder="0.054"
                    value={form.instantSalesCommRate}
                    onChange={e => setField({ instantSalesCommRate: e.target.value })}
                  />
                  <span className="as-hint">% earned on scratch-off sales</span>
                </div>
                <div className="as-field">
                  <label>Instant Cashing Commission</label>
                  <input
                    type="number" step="0.0001" placeholder="0.01"
                    value={form.instantCashingCommRate}
                    onChange={e => setField({ instantCashingCommRate: e.target.value })}
                  />
                  <span className="as-hint">% earned on scratch-off winnings cashed at this store</span>
                </div>
                <div className="as-field">
                  <label>Machine Draw Sales Commission</label>
                  <input
                    type="number" step="0.0001" placeholder="0.054"
                    value={form.machineSalesCommRate}
                    onChange={e => setField({ machineSalesCommRate: e.target.value })}
                  />
                  <span className="as-hint">% earned on draw-game terminal sales</span>
                </div>
                <div className="as-field">
                  <label>Machine Draw Cashing Commission</label>
                  <input
                    type="number" step="0.0001" placeholder="0.01"
                    value={form.machineCashingCommRate}
                    onChange={e => setField({ machineCashingCommRate: e.target.value })}
                  />
                  <span className="as-hint">% earned on draw-game winnings cashed at this store</span>
                </div>
                <div className="as-field">
                  <label>Alcohol Age Limit</label>
                  <input type="number" value={form.alcoholAgeLimit} onChange={e => setField({ alcoholAgeLimit: e.target.value })} />
                </div>
                <div className="as-field">
                  <label>Tobacco Age Limit</label>
                  <input type="number" value={form.tobaccoAgeLimit} onChange={e => setField({ tobaccoAgeLimit: e.target.value })} />
                </div>

                {/* Session 50 — Dual Pricing / Cash Discount per-state policy */}
                <div className="as-field as-field--full">
                  <div style={{
                    padding: '8px 10px',
                    background: 'rgba(16, 185, 129, 0.06)',
                    border: '1px solid rgba(16, 185, 129, 0.2)',
                    borderRadius: 6,
                    fontSize: '0.78rem',
                    color: 'var(--text-primary)',
                    marginBottom: 8,
                  }}>
                    <strong>Dual Pricing / Cash Discount policy.</strong> Drives per-state defaults for stores that
                    enable dual pricing — stores can override the disclosure text but inherit taxability + cap +
                    framing from this state record. Verify against the state's DOR + payment-card statute before
                    enabling stores.
                  </div>
                </div>
                <div className="as-field">
                  <label>Max Surcharge %</label>
                  <input
                    type="number" step="0.001" min="0" max="10"
                    placeholder="4.000"
                    value={form.maxSurchargePercent}
                    onChange={e => setField({ maxSurchargePercent: e.target.value })}
                  />
                  <span className="as-hint">Federal Visa/MC cap = 4%. Leave blank for no cap.</span>
                </div>
                <div className="as-field">
                  <label>Pricing Framing</label>
                  <select value={form.pricingFraming} onChange={e => setField({ pricingFraming: e.target.value as 'surcharge' | 'cash_discount' })}>
                    <option value="surcharge">Surcharge (+ added at checkout)</option>
                    <option value="cash_discount">Cash Discount (− subtracted at checkout)</option>
                  </select>
                  <span className="as-hint">Use cash_discount for states where surcharge is illegal (MA, CT, OK, CO).</span>
                </div>
                <div className="as-field">
                  <label>
                    <input type="checkbox" checked={form.surchargeTaxable} onChange={e => setField({ surchargeTaxable: e.target.checked })} />
                    {' '}Surcharge is taxable in this state
                  </label>
                  <span className="as-hint">NY/FL/TX/PA/NJ/MD/VA/NC/SC/GA require sales tax on the surcharge.</span>
                </div>
                <div className="as-field">
                  <label>
                    <input type="checkbox" checked={form.dualPricingAllowed} onChange={e => setField({ dualPricingAllowed: e.target.checked })} />
                    {' '}Dual pricing (surcharge model) allowed
                  </label>
                  <span className="as-hint">Uncheck for states where surcharge is statutorily prohibited — UI forces cash-discount framing.</span>
                </div>
                <div className="as-field as-field--full">
                  <label>Default Disclosure Text</label>
                  <textarea
                    rows={2}
                    value={form.surchargeDisclosureText}
                    onChange={e => setField({ surchargeDisclosureText: e.target.value })}
                    placeholder="A 3% + $0.30 fee is added to credit and debit transactions. A discount equivalent to this amount is available for cash payment."
                  />
                  <span className="as-hint">Verbatim text printed on receipts + posted at register. Stores can override per-store.</span>
                </div>

                <div className="as-field as-field--full">
                  <label>Notes</label>
                  <textarea rows={2} value={form.notes} onChange={e => setField({ notes: e.target.value })} placeholder="Internal notes (bottle bill info, exemptions, etc.)" />
                </div>
                <div className="as-field">
                  <label><input type="checkbox" checked={form.active} onChange={e => setField({ active: e.target.checked })} /> Active (shown in store dropdown)</label>
                </div>
              </div>

              <div className="as-section">
                <div className="as-section-head">
                  <span>Bottle Deposit Rules</span>
                  <button className="as-btn-ghost" onClick={addDeposit}><Plus size={12} /> Add rule</button>
                </div>
                {form.bottleDepositRules.length === 0 ? (
                  <div className="as-subtle">No deposit rules configured — add tiers if this state has a bottle bill.</div>
                ) : (
                  form.bottleDepositRules.map((r, i) => (
                    <div key={i} className="as-deposit-row">
                      <select value={r.containerType || 'bottle'} onChange={e => updateDeposit(i, { containerType: e.target.value })}>
                        <option value="bottle">Bottle</option>
                        <option value="can">Can</option>
                        <option value="carton">Carton</option>
                      </select>
                      <select value={r.material || 'glass'} onChange={e => updateDeposit(i, { material: e.target.value })}>
                        <option value="glass">Glass</option>
                        <option value="plastic">Plastic</option>
                        <option value="aluminum">Aluminum</option>
                      </select>
                      <input type="number" step="0.1" placeholder="Min oz" value={r.minVolumeOz ?? ''} onChange={e => updateDeposit(i, { minVolumeOz: e.target.value })} />
                      <input type="number" step="0.1" placeholder="Max oz" value={r.maxVolumeOz ?? ''} onChange={e => updateDeposit(i, { maxVolumeOz: e.target.value })} />
                      <input type="number" step="0.01" placeholder="Deposit $" value={r.depositAmount ?? ''} onChange={e => updateDeposit(i, { depositAmount: e.target.value })} />
                      <button className="as-icon-btn as-icon-btn--danger" onClick={() => removeDeposit(i)}><Trash2 size={12} /></button>
                    </div>
                  ))
                )}
              </div>

              <div className="as-section">
                <div className="as-section-head">
                  <span>Lottery Pack-Size Rules</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {form.lotteryPackSizeRules.length === 0 && (
                      <button className="as-btn-ghost" onClick={loadDefaultPackRules} title="Prefill with MA / US-standard pack sizes">
                        Use US default
                      </button>
                    )}
                    <button className="as-btn-ghost" onClick={addPackRule}><Plus size={12} /> Add rule</button>
                  </div>
                </div>
                <div className="as-subtle" style={{ marginBottom: 8 }}>
                  State lottery APIs don't expose pack size — we infer it from the ticket price.
                  First rule with <strong>maxPrice ≥ ticket price</strong> wins. For each new game,
                  the scan/receive flow picks this pack size as the default (cashier can override per scan).
                </div>
                {form.lotteryPackSizeRules.length === 0 ? (
                  <div className="as-subtle">Empty — backend default applies (MA/US conventions: $1→300, $5→100, $10→50, $20→30, $30→20, $50+→10).</div>
                ) : (
                  form.lotteryPackSizeRules.map((r, i) => (
                    <div key={i} className="as-deposit-row" style={{ gridTemplateColumns: '1fr 1fr auto' }}>
                      <input
                        type="number"
                        step="0.01"
                        placeholder="Max ticket price ($)"
                        value={r.maxPrice ?? ''}
                        onChange={e => updatePackRule(i, { maxPrice: e.target.value })}
                      />
                      <input
                        type="number"
                        placeholder="Pack size (tickets)"
                        value={r.packSize ?? ''}
                        onChange={e => updatePackRule(i, { packSize: e.target.value })}
                      />
                      <button className="as-icon-btn as-icon-btn--danger" onClick={() => removePackRule(i)}><Trash2 size={12} /></button>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="as-modal-foot">
              <button className="as-btn-secondary" onClick={closeModal}>Cancel</button>
              <button className="as-btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? <><Loader size={13} className="as-spin" /> Saving…</> : <><Save size={13} /> {modalMode === 'create' ? 'Create' : 'Save'}</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
