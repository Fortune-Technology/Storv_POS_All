/**
 * RefundModal — Industry-standard c-store refund flow.
 * Two modes: WITH RECEIPT and NO RECEIPT.
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  X, RotateCcw, Search, Check, Plus, Minus,
  Scan, ChevronRight, AlertTriangle, DollarSign,
  CreditCard, Package, Trash2,
} from 'lucide-react';
import { listTransactions, createRefund as apiRefund, createOpenRefund, dejavooRefund } from '../../api/pos.js';
import { searchProducts } from '../../db/dexie.js';
import { fmt$ } from '../../utils/formatters.js';
import { useAuthStore } from '../../stores/useAuthStore.js';
import { useStationStore } from '../../stores/useStationStore.js';
import './RefundModal.css';

// Bug-fix: use LOCAL date components, not UTC. d.toISOString() gives UTC,
// so after local midnight but before UTC midnight (i.e. evening in the
// Americas) "today" silently becomes tomorrow and the filter misses every
// transaction made earlier in the same business day.
function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// DATE_FILTERS is now a function so dates are recomputed each render rather
// than once at module-eval time (so the modal stays correct across midnight).
function buildDateFilters() {
  const today     = isoDate(new Date());
  const yesterday = isoDate(new Date(Date.now() - 86400000));
  return [
    { label: 'Today',     dateFrom: today,                                          dateTo: today     },
    { label: 'Yesterday', dateFrom: yesterday,                                      dateTo: yesterday },
    { label: '7 Days',    dateFrom: isoDate(new Date(Date.now() - 6 * 86400000)),   dateTo: today     },
    { label: '30 Days',   dateFrom: isoDate(new Date(Date.now() - 29 * 86400000)),  dateTo: today     },
  ];
}
const DATE_FILTERS = buildDateFilters();

function Steps({ labels, current }) {
  return (
    <div className="rfm-steps">
      {labels.map((s, i) => (
        <React.Fragment key={s}>
          <div className={`rfm-step${i === current ? ' rfm-step--current' : i < current ? ' rfm-step--done' : ' rfm-step--pending'}`}>
            {i < current && <Check size={9} />}{s}
          </div>
          {i < labels.length - 1 && <div className={`rfm-step-divider${i < current ? ' rfm-step-divider--done' : ' rfm-step-divider--pending'}`} />}
        </React.Fragment>
      ))}
    </div>
  );
}

// ══ WITH-RECEIPT FLOW ══
function WithReceipt({ onClose, onRefunded, storeId, dualPricing }) {
  const scanRef = useRef(null);
  const [step, setStep] = useState('lookup');
  const [txQuery, setTxQuery] = useState('');
  const [dateIdx, setDateIdx] = useState(0);
  const [txs, setTxs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null);
  const [checks, setChecks] = useState({});
  const [qtys, setQtys] = useState({});
  const [method, setMethod] = useState('cash');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [refundTotal, setRefundTotal] = useState(0);

  useEffect(() => {
    if (step !== 'lookup') return;
    setLoading(true);
    const f = DATE_FILTERS[dateIdx];
    listTransactions({ storeId, dateFrom: f.dateFrom, dateTo: f.dateTo, status: 'complete', limit: 500 })
      .then(r => setTxs(r.transactions || [])).catch(() => setTxs([])).finally(() => setLoading(false));
  }, [storeId, dateIdx, step]);

  useEffect(() => { if (step === 'lookup') setTimeout(() => scanRef.current?.focus(), 80); }, [step]);

  const handleScanEnter = useCallback((e) => {
    if (e.key !== 'Enter') return;
    const q = txQuery.trim().toUpperCase();
    if (!q) return;
    const match = txs.find(t => t.txNumber?.toUpperCase() === q);
    if (match) selectTx(match);
  }, [txQuery, txs]);

  const selectTx = (tx) => {
    setSelected(tx);
    const c = {}, q = {};
    (tx.lineItems || []).forEach(item => { c[item.lineId] = true; q[item.lineId] = item.qty; });
    setChecks(c); setQtys(q); setStep('items');
  };

  useEffect(() => {
    if (!selected) return;
    const total = (selected.lineItems || []).reduce((sum, item) => {
      if (!checks[item.lineId]) return sum;
      return sum + item.lineTotal * ((qtys[item.lineId] || 0) / item.qty);
    }, 0);
    setRefundTotal(Math.round(total * 100) / 100);
  }, [checks, qtys, selected]);

  // ── Session 52 — Dual Pricing refund-surcharge projection ─────────────
  // Computes the surcharge that will be added to the refund (or NOT, depending
  // on store policy) so the cashier can explain to the customer exactly what
  // they're getting back. The math mirrors the backend's createRefund logic
  // EXACTLY so the UI projection matches what the customer ends up receiving.
  const refundSurchargeProjection = useMemo(() => {
    if (!selected) return null;
    const origSurcharge    = Number(selected.surchargeAmount    || 0);
    const origSurchargeTax = Number(selected.surchargeTaxAmount || 0);
    const origBase         = Number(selected.baseSubtotal       || selected.subtotal || 0);
    if (origSurcharge <= 0.005 || origBase <= 0.005) return null;

    const policy = !!dualPricing?.refundSurcharge;
    const ratio = Math.min(1, refundTotal / origBase);
    const projectedSurcharge    = policy ? Math.round(origSurcharge * ratio * 100) / 100 : 0;
    const projectedSurchargeTax = policy ? Math.round(origSurchargeTax * ratio * 100) / 100 : 0;

    return {
      origSurcharge,
      origSurchargeTax,
      origCombined:        Math.round((origSurcharge + origSurchargeTax) * 100) / 100,
      projectedSurcharge,
      projectedSurchargeTax,
      projectedCombined:   Math.round((projectedSurcharge + projectedSurchargeTax) * 100) / 100,
      policy,
      ratio,
    };
  }, [selected, refundTotal, dualPricing]);

  // The total amount the customer will actually receive (principal +
  // projected surcharge if any). Used for the "Process Refund $X" button.
  const customerReceivesTotal = refundTotal + (refundSurchargeProjection?.projectedCombined || 0);

  const toggleItem = (lineId) => setChecks(c => ({ ...c, [lineId]: !c[lineId] }));
  const toggleAll = () => {
    const allOn = (selected.lineItems || []).every(i => checks[i.lineId]);
    const next = {};
    (selected.lineItems || []).forEach(i => { next[i.lineId] = !allOn; });
    setChecks(next);
  };
  const adjustQty = (lineId, delta, max) =>
    setQtys(prev => ({ ...prev, [lineId]: Math.max(1, Math.min(max, (prev[lineId] || 1) + delta)) }));

  const refundItems = selected ? (selected.lineItems || []).filter(i => checks[i.lineId] && (qtys[i.lineId] || 0) > 0) : [];
  const allChecked = selected ? (selected.lineItems || []).every(i => checks[i.lineId]) : false;

  const doRefund = async () => {
    if (!selected || !refundItems.length || saving) return;
    setSaving(true);
    try {
      const lineItems = refundItems.map(item => ({ ...item, qty: qtys[item.lineId], lineTotal: item.lineTotal * (qtys[item.lineId] / item.qty) }));
      // Session 52 — Tender lines reflect what the customer actually receives.
      // When dual_pricing AND store policy refunds the surcharge, that's
      // customerReceivesTotal (principal + projected surcharge). Backend's
      // createRefund handler persists matching surchargeAmount/surchargeTaxAmount
      // snapshot fields based on the same policy lookup.
      const refundReceived = customerReceivesTotal;
      const tenderLines = method === 'cash'
        ? [{ method: 'cash', amount: refundReceived }]
        : (selected.tenderLines || []).map(l => ({ ...l, amount: refundReceived * (l.amount / selected.grandTotal) }));

      // ── Dejavoo card refund — push the money back to the customer's card ──
      // When refunding to the original method AND the original was a Dejavoo
      // card/EBT payment, call SPIn Return BEFORE recording the POS refund.
      // This ensures we never record a POS refund that didn't actually process.
      if (method === 'original') {
        const djLine = (selected.tenderLines || []).find(
          l => l.provider === 'dejavoo' && (l.method === 'card' || l.method === 'ebt')
        );
        if (djLine) {
          const stationId = station?.id;
          if (!stationId) throw new Error('No station — cannot process card refund');
          const r = await dejavooRefund({
            stationId,
            // Session 52 — push the FULL amount the customer receives to
            // the terminal (principal + projected surcharge if policy
            // refunds it). Otherwise the card customer gets less back than
            // the receipt total claims.
            amount:              refundReceived,
            paymentType:         djLine.method === 'ebt' ? 'ebt_food' : 'card',
            originalReferenceId: djLine.referenceId || null,
            invoiceNumber:       selected.txNumber,
          });
          if (!r?.success) {
            throw new Error(r?.result?.message || 'Card refund was declined on the terminal');
          }
          // Annotate the tender line with the refund reference for the receipt
          tenderLines.forEach(tl => {
            if (tl.method === djLine.method) {
              tl.refundReferenceId = r?.result?.referenceId || null;
              tl.refundAuthCode    = r?.result?.authCode    || null;
            }
          });
        }
      }

      await apiRefund(selected.id, { lineItems, tenderLines, grandTotal: refundTotal, subtotal: refundTotal, taxTotal: 0, refundMethod: method, note: note || `Refund for ${selected.txNumber}` });
      setStep('done');
      setTimeout(() => { onRefunded?.(); onClose(); }, 1600);
    } catch (e) {
      alert(e.response?.data?.error || e.message || 'Refund failed. Please try again.');
      setSaving(false);
    }
  };

  const visible = txs.filter(t => !txQuery || t.txNumber?.toLowerCase().includes(txQuery.toLowerCase()) || t.cashierName?.toLowerCase().includes(txQuery.toLowerCase()));

  if (step === 'lookup') return (
    <div className="rfm-content">
      <div className="rfm-scan-bar">
        <div className="rfm-scan-input-wrap">
          <Scan size={16} color="var(--blue)" />
          <input ref={scanRef} className="rfm-scan-input" value={txQuery} onChange={e => setTxQuery(e.target.value)} onKeyDown={handleScanEnter} placeholder="Scan receipt barcode or type TX# and press Enter..." />
          {txQuery && <button className="rfm-scan-clear" onClick={() => setTxQuery('')}><X size={13} /></button>}
        </div>
      </div>
      <div className="rfm-date-bar">
        <span className="rfm-date-label">SHOW:</span>
        {DATE_FILTERS.map((f, i) => (
          <button key={f.label} className={`rfm-date-btn${dateIdx === i ? ' rfm-date-btn--active' : ' rfm-date-btn--inactive'}`} onClick={() => setDateIdx(i)}>{f.label}</button>
        ))}
        <span className="rfm-date-count">{loading ? 'Loading...' : `${visible.length} transaction${visible.length !== 1 ? 's' : ''}`}</span>
      </div>
      <div className="rfm-list">
        {loading ? <div className="rfm-loading">Loading...</div> : visible.length === 0 ? <div className="rfm-empty">No transactions found for this period</div> : visible.map(tx => (
          <div key={tx.id} className="rfm-tx-row" onClick={() => selectTx(tx)}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div><span className="rfm-tx-number">{tx.txNumber}</span> <span className="rfm-tx-date">{new Date(tx.createdAt).toLocaleDateString([], { month:'short', day:'numeric' })} {new Date(tx.createdAt).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })}</span></div>
              <div className="rfm-tx-meta">{tx.cashierName} - {(tx.lineItems||[]).length} item{(tx.lineItems||[]).length!==1?'s':''} - {(tx.tenderLines||[]).map(l=>l.method.replace('_',' ')).join(' + ')}</div>
            </div>
            <span className="rfm-tx-total">{fmt$(tx.grandTotal)}</span>
            <ChevronRight size={14} color="var(--text-muted)" />
          </div>
        ))}
      </div>
    </div>
  );

  if (step === 'items') return (
    <div className="rfm-content">
      <div className="rfm-tx-strip">
        <div><span className="rfm-tx-number">{selected.txNumber}</span> <span className="rfm-tx-date">{new Date(selected.createdAt).toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})} - {selected.cashierName}</span></div>
        <span className="rfm-tx-total">{fmt$(selected.grandTotal)}</span>
      </div>
      <div className="rfm-select-all">
        <button className={`rfm-checkbox${allChecked ? ' rfm-checkbox--checked' : ''}`} onClick={toggleAll}>{allChecked && <Check size={13} color="#fff" strokeWidth={3} />}</button>
        <span className="rfm-footer-count">{allChecked ? 'Deselect all' : 'Select all items'}</span>
        <span className="rfm-date-count">{refundItems.length} of {(selected.lineItems||[]).length} selected</span>
      </div>
      <div className="rfm-list">
        {(selected.lineItems||[]).map(item => {
          const checked = !!checks[item.lineId];
          const qty = qtys[item.lineId] || item.qty;
          const lineCost = item.lineTotal * (qty / item.qty);
          return (
            <div key={item.lineId} className={`rfm-item-row${checked ? ' rfm-item-row--checked' : ' rfm-item-row--unchecked'}`}>
              <button className={`rfm-checkbox${checked ? ' rfm-checkbox--checked' : ''}`} onClick={() => toggleItem(item.lineId)}>{checked && <Check size={13} color="#fff" strokeWidth={3} />}</button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="rfm-item-name">{item.name}</div>
                <div className="rfm-item-price">{fmt$(item.unitPrice)} each</div>
              </div>
              {item.qty > 1 && checked ? (
                <div className="rfm-qty-stepper">
                  <button className="rfm-qty-btn" onClick={() => adjustQty(item.lineId,-1,item.qty)}><Minus size={11} /></button>
                  <span className="rfm-qty-value">{qty}</span>
                  <button className="rfm-qty-btn" onClick={() => adjustQty(item.lineId,1,item.qty)}><Plus size={11} /></button>
                </div>
              ) : item.qty > 1 ? <span className="rfm-qty-label">x{item.qty}</span> : null}
              <span className={`rfm-item-amount${checked ? ' rfm-item-amount--checked' : ' rfm-item-amount--unchecked'}`}>{checked ? `-${fmt$(lineCost)}` : fmt$(item.lineTotal)}</span>
            </div>
          );
        })}
      </div>
      {/* Session 52 — Surcharge notice on the items step */}
      {refundSurchargeProjection && refundItems.length > 0 && (
        <div className={`rfm-surcharge-notice${refundSurchargeProjection.policy ? ' rfm-surcharge-notice--include' : ' rfm-surcharge-notice--exclude'}`}>
          <AlertTriangle size={14} className="rfm-surcharge-notice-icon" />
          <div className="rfm-surcharge-notice-body">
            <strong>Original surcharge: {fmt$(refundSurchargeProjection.origCombined)}</strong>
            <span className="rfm-surcharge-notice-detail">
              {refundSurchargeProjection.policy
                ? <>Will be refunded proportionally — customer gets back {fmt$(refundSurchargeProjection.projectedCombined)} extra (total {fmt$(customerReceivesTotal)}).</>
                : <>Per store policy, surcharge stays with the merchant. Customer receives only the principal {fmt$(refundTotal)}.</>}
            </span>
          </div>
        </div>
      )}
      <div className="rfm-footer-bar">
        <div className="rfm-footer-summary">
          <span className="rfm-footer-count">{refundItems.length} item{refundItems.length!==1?'s':''} selected</span>
          <span className="rfm-footer-total">-{fmt$(customerReceivesTotal)}</span>
        </div>
        <div className="rfm-footer-actions">
          <button className="rfm-btn-back" onClick={() => setStep('lookup')}>Back</button>
          <button className={`rfm-btn-continue${refundItems.length ? ' rfm-btn-continue--active' : ' rfm-btn-continue--disabled'}`} onClick={() => setStep('method')} disabled={!refundItems.length}>Continue — Refund {fmt$(customerReceivesTotal)}</button>
        </div>
      </div>
    </div>
  );

  if (step === 'method') return (
    <div className="rfm-method-content">
      <div className="rfm-summary-card">
        <div className="rfm-summary-label">REFUNDING FROM {selected?.txNumber}</div>
        {refundItems.map(item => (
          <div key={item.lineId} className="rfm-summary-row">
            <span className="rfm-summary-item-name">{qtys[item.lineId]>1?`${qtys[item.lineId]}x `:''}{item.name}</span>
            <span className="rfm-summary-item-amount">-{fmt$(item.lineTotal * qtys[item.lineId] / item.qty)}</span>
          </div>
        ))}
        {/* Session 52 — Surcharge line on the method-step summary */}
        {refundSurchargeProjection && refundSurchargeProjection.projectedCombined > 0.005 && (
          <div className="rfm-summary-row">
            <span className="rfm-summary-item-name">+ Surcharge refund (per store policy)</span>
            <span className="rfm-summary-item-amount">-{fmt$(refundSurchargeProjection.projectedCombined)}</span>
          </div>
        )}
        {refundSurchargeProjection && !refundSurchargeProjection.policy && refundSurchargeProjection.origCombined > 0.005 && (
          <div className="rfm-summary-row">
            <span className="rfm-summary-item-name" style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
              Original surcharge ({fmt$(refundSurchargeProjection.origCombined)}) not refunded — store policy
            </span>
            <span className="rfm-summary-item-amount" style={{ color: 'var(--text-muted)' }}>—</span>
          </div>
        )}
        <div className="rfm-summary-total-row">
          <span className="rfm-summary-total-label">Refund Total</span>
          <span className="rfm-summary-total-amount">-{fmt$(customerReceivesTotal)}</span>
        </div>
      </div>
      <div>
        <div className="rfm-method-label">HOW TO REFUND</div>
        <div className="rfm-method-grid">
          {[
            { id:'cash', label:'Cash', sub:'Give cash from drawer', Icon:DollarSign },
            { id:'original', label:'Original Method', sub:(selected?.tenderLines||[]).map(l=>l.method.replace('_',' ')).join(' + ')||'Same as purchase', Icon:CreditCard },
          ].map(opt => (
            <button key={opt.id} className={`rfm-method-btn${method===opt.id ? ' rfm-method-btn--active' : ''}`} onClick={() => setMethod(opt.id)}>
              <div className="rfm-header-left">
                {method===opt.id ? <div className="rfm-method-radio rfm-method-radio--selected"><Check size={11} color="#fff" strokeWidth={3} /></div> : <div className="rfm-method-radio" />}
                <span className="rfm-method-label-text">{opt.label}</span>
              </div>
              <span className="rfm-method-sub">{opt.sub}</span>
            </button>
          ))}
        </div>
      </div>
      {method === 'cash' && (
        <div className="rfm-warning">
          <AlertTriangle size={14} color="var(--amber)" className="rfm-warning-icon" />
          <span className="rfm-warning-text">Give the customer {fmt$(customerReceivesTotal)} cash from the drawer.</span>
        </div>
      )}
      <input className="rfm-note-input" value={note} onChange={e => setNote(e.target.value)} placeholder="Reason for refund (optional)..." autoFocus />
      <div className="rfm-method-actions">
        <button className="rfm-btn-back" onClick={() => setStep('items')}>Back</button>
        <button className={`rfm-btn-continue${saving ? ' rfm-btn-continue--disabled' : ' rfm-btn-continue--active'}`} onClick={doRefund} disabled={saving}>
          <RotateCcw size={16} /> {saving ? 'Processing...' : `Process Refund ${fmt$(customerReceivesTotal)}`}
        </button>
      </div>
    </div>
  );

  return (
    <div className="rfm-done">
      <div className="rfm-done-icon"><Check size={30} color="var(--blue)" strokeWidth={2.5} /></div>
      <div>
        <div className="rfm-done-title">Refund Processed</div>
        <div className="rfm-done-amount">-{fmt$(refundTotal)}</div>
        <div className="rfm-done-method">{method === 'cash' ? 'Cash returned to customer' : 'Returned to original payment method'}</div>
      </div>
    </div>
  );
}

// ══ NO-RECEIPT FLOW ══
function NoReceipt({ onClose, onRefunded, storeId }) {
  const scanRef = useRef(null);
  const [step, setStep] = useState('items');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [basket, setBasket] = useState([]);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { setTimeout(() => scanRef.current?.focus(), 80); }, []);

  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    searchProducts(query, null, 20).then(setResults);
  }, [query]);

  const addToBasket = (product) => {
    setBasket(b => {
      const existing = b.find(r => r.product.id === product.id);
      if (existing) return b.map(r => r.product.id === product.id ? { ...r, qty: r.qty + 1 } : r);
      return [...b, { product, qty: 1, unitPrice: product.retailPrice }];
    });
    setQuery(''); setResults([]); scanRef.current?.focus();
  };

  const removeFromBasket = (productId) => setBasket(b => b.filter(r => r.product.id !== productId));
  const adjustBasketQty = (productId, delta) => setBasket(b => b.map(r => r.product.id === productId ? { ...r, qty: Math.max(1, r.qty + delta) } : r));
  const refundTotal = basket.reduce((s, r) => s + r.unitPrice * r.qty, 0);

  const doRefund = async () => {
    if (!basket.length || saving) return;
    setSaving(true);
    try {
      const lineItems = basket.map((r, i) => ({
        lineId: `nr-${i}`, name: r.product.name, upc: r.product.upc, productId: r.product.id,
        qty: r.qty, unitPrice: r.unitPrice, lineTotal: r.unitPrice * r.qty, ebtEligible: r.product.ebtEligible || false,
      }));
      await createOpenRefund({ storeId, lineItems, tenderLines: [{ method: 'cash', amount: refundTotal }], grandTotal: refundTotal, subtotal: refundTotal, taxTotal: 0, note: note || 'No-receipt return' });
      setStep('done');
      setTimeout(() => { onRefunded?.(); onClose(); }, 1600);
    } catch (e) {
      alert(e.response?.data?.error || 'Refund failed. Please try again.');
      setSaving(false);
    }
  };

  if (step === 'items') return (
    <div className="rfm-content">
      <div className="rfm-scan-bar" style={{ position: 'relative' }}>
        <div className="rfm-scan-input-wrap">
          <Scan size={16} color="var(--blue)" />
          <input ref={scanRef} className="rfm-scan-input" value={query} onChange={e => setQuery(e.target.value)} placeholder="Scan item barcode or search by name..." />
          {query && <button className="rfm-scan-clear" onClick={() => { setQuery(''); setResults([]); }}><X size={13} /></button>}
        </div>
        {results.length > 0 && (
          <div className="rfm-search-dropdown">
            {results.map(p => (
              <button key={p.id} className="rfm-search-result" onMouseDown={() => addToBasket(p)}>
                <div><div className="rfm-search-name">{p.name}</div><div className="rfm-search-upc">{p.upc}</div></div>
                <span className="rfm-search-price">{fmt$(p.retailPrice)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="rfm-list">
        {basket.length === 0 ? (
          <div className="rfm-basket-empty"><Package size={40} className="rfm-basket-icon" /><div className="rfm-basket-text">Scan or search for items to return</div></div>
        ) : basket.map(r => (
          <div key={r.product.id} className="rfm-basket-row">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="rfm-basket-name">{r.product.name}</div>
              <div className="rfm-basket-price">{fmt$(r.unitPrice)} each</div>
            </div>
            <div className="rfm-qty-stepper">
              <button className="rfm-qty-btn" onClick={() => adjustBasketQty(r.product.id,-1)}><Minus size={11} /></button>
              <span className="rfm-qty-value">{r.qty}</span>
              <button className="rfm-qty-btn" onClick={() => adjustBasketQty(r.product.id,1)}><Plus size={11} /></button>
            </div>
            <span className="rfm-basket-amount">-{fmt$(r.unitPrice * r.qty)}</span>
            <button className="rfm-basket-delete" onClick={() => removeFromBasket(r.product.id)}><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
      {basket.length > 0 && (
        <div className="rfm-footer-bar">
          <div className="rfm-footer-summary">
            <span className="rfm-footer-count">{basket.length} item{basket.length!==1?'s':''} to return</span>
            <span className="rfm-footer-total">-{fmt$(refundTotal)}</span>
          </div>
          <button className="rfm-btn-continue rfm-btn-continue--active" onClick={() => setStep('confirm')}>Continue — Cash Refund {fmt$(refundTotal)}</button>
        </div>
      )}
    </div>
  );

  if (step === 'confirm') return (
    <div className="rfm-method-content">
      <div className="rfm-summary-card">
        <div className="rfm-summary-label">NO-RECEIPT RETURN</div>
        {basket.map(r => (
          <div key={r.product.id} className="rfm-summary-row">
            <span className="rfm-summary-item-name">{r.qty>1?`${r.qty}x `:''}{r.product.name}</span>
            <span className="rfm-summary-item-amount">-{fmt$(r.unitPrice * r.qty)}</span>
          </div>
        ))}
        <div className="rfm-summary-total-row">
          <span className="rfm-summary-total-label">Cash Refund</span>
          <span className="rfm-summary-total-amount">-{fmt$(refundTotal)}</span>
        </div>
      </div>
      <div className="rfm-warning">
        <AlertTriangle size={14} color="var(--amber)" className="rfm-warning-icon" />
        <span className="rfm-warning-text">Give the customer {fmt$(refundTotal)} cash from the drawer. No original receipt — manager authorization required.</span>
      </div>
      <input className={`rfm-note-input${!note.trim() ? ' rfm-note-input--required' : ''}`} value={note} onChange={e => setNote(e.target.value)} placeholder="Reason for return (required for no-receipt)..." required autoFocus />
      <div className="rfm-method-actions">
        <button className="rfm-btn-back" onClick={() => setStep('items')}>Back</button>
        <button className={`rfm-btn-continue${(saving||!note.trim()) ? ' rfm-btn-continue--disabled' : ' rfm-btn-continue--active'}`} onClick={doRefund} disabled={saving || !note.trim()}>
          <RotateCcw size={16} /> {saving ? 'Processing...' : `Process Refund ${fmt$(refundTotal)}`}
        </button>
      </div>
    </div>
  );

  return (
    <div className="rfm-done">
      <div className="rfm-done-icon"><Check size={30} color="var(--blue)" strokeWidth={2.5} /></div>
      <div>
        <div className="rfm-done-title">Refund Processed</div>
        <div className="rfm-done-amount">-{fmt$(refundTotal)}</div>
        <div className="rfm-done-method">Cash returned to customer</div>
      </div>
    </div>
  );
}

// ══ ROOT MODAL ══
// Session 52 — `dualPricing` is the resolved store config from usePOSConfig.
// Used by WithReceipt to surface the refund-surcharge policy to the cashier
// so they explain the right amount to the customer.
export default function RefundModal({ onClose, onRefunded, storeId: storeIdProp, dualPricing }) {
  const cashier = useAuthStore(s => s.cashier);
  const station = useStationStore(s => s.station);
  const storeId = storeIdProp || cashier?.storeId || station?.storeId;
  const [mode, setMode] = useState('receipt');

  return (
    <div className="rfm-backdrop">
      <div className="rfm-modal">
        <div className="rfm-header">
          <div className="rfm-header-top">
            <div className="rfm-header-left">
              <RotateCcw size={16} color="var(--blue)" />
              <span className="rfm-header-title">Refund</span>
            </div>
            <button className="rfm-close-btn" onClick={onClose}><X size={16} /></button>
          </div>
          <div className="rfm-mode-tabs">
            {[
              { id:'receipt', label:'With Receipt' },
              { id:'noreceipt', label:'No Receipt' },
            ].map(tab => (
              <button key={tab.id} className={`rfm-mode-tab${mode === tab.id ? ' rfm-mode-tab--active' : ' rfm-mode-tab--inactive'}`} onClick={() => setMode(tab.id)}>
                {tab.label}
              </button>
            ))}
          </div>
        </div>
        {mode === 'receipt'
          ? <WithReceipt key="receipt" onClose={onClose} onRefunded={onRefunded} storeId={storeId} dualPricing={dualPricing} />
          : <NoReceipt key="noreceipt" onClose={onClose} onRefunded={onRefunded} storeId={storeId} />
        }
      </div>
    </div>
  );
}
