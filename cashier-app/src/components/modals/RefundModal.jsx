/**
 * RefundModal — Industry-standard c-store refund flow.
 *
 * Two modes (tabs):
 *   WITH RECEIPT  — find transaction → select items → method → done
 *   NO RECEIPT    — scan/search product → qty → method → done
 *
 * With Receipt:
 *   - Scan receipt barcode or type TX# → jumps directly
 *   - Date filters: Today / Yesterday / 7 Days / 30 Days
 *   - All items pre-checked; uncheck to exclude; qty stepper for qty>1
 *   - Refund method: Cash | Original Payment
 *
 * No Receipt:
 *   - Scan product barcode or search by name
 *   - Add multiple items with quantities
 *   - Cash refund only (no original transaction to reverse)
 *   - Reason required
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  X, RotateCcw, Search, Check, Plus, Minus,
  Scan, ChevronRight, AlertTriangle, DollarSign,
  CreditCard, Package, Trash2,
} from 'lucide-react';
import { listTransactions, createRefund as apiRefund, createOpenRefund } from '../../api/pos.js';
import { searchProducts } from '../../db/dexie.js';
import { fmt$ } from '../../utils/formatters.js';
import { useAuthStore } from '../../stores/useAuthStore.js';
import { useStationStore } from '../../stores/useStationStore.js';

// ── Helpers ────────────────────────────────────────────────────────────────
function isoDate(d) { return d.toISOString().split('T')[0]; }

const today     = isoDate(new Date());
const yesterday = isoDate(new Date(Date.now() - 86400000));

const DATE_FILTERS = [
  { label: 'Today',    dateFrom: today,                  dateTo: today   },
  { label: 'Yesterday',dateFrom: yesterday,              dateTo: yesterday },
  { label: '7 Days',   dateFrom: isoDate(new Date(Date.now() - 6 * 86400000)), dateTo: today },
  { label: '30 Days',  dateFrom: isoDate(new Date(Date.now() - 29 * 86400000)), dateTo: today },
];

const BACKDROP = {
  position: 'fixed', inset: 0, zIndex: 210,
  background: 'rgba(0,0,0,.78)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: '1rem',
};

// ── Step dots ──────────────────────────────────────────────────────────────
function Steps({ labels, current }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      {labels.map((s, i) => (
        <React.Fragment key={s}>
          <div style={{
            fontSize: '0.65rem', fontWeight: 800,
            padding: '2px 8px', borderRadius: 12,
            background: i === current ? 'var(--blue)' : i < current ? 'rgba(59,130,246,.18)' : 'var(--bg-input)',
            color: i === current ? '#fff' : i < current ? 'var(--blue)' : 'var(--text-muted)',
          }}>
            {i < current && <Check size={9} style={{ display:'inline', marginRight:2 }} />}
            {s}
          </div>
          {i < labels.length - 1 && (
            <div style={{ width:14, height:1, background: i < current ? 'var(--blue)' : 'var(--border)' }} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
//  WITH-RECEIPT FLOW
// ══════════════════════════════════════════════════════════════════════════
function WithReceipt({ onClose, onRefunded, storeId }) {
  const scanRef  = useRef(null);
  const [step,     setStep]     = useState('lookup');   // lookup | items | method | done
  const [txQuery,  setTxQuery]  = useState('');
  const [dateIdx,  setDateIdx]  = useState(0);
  const [txs,      setTxs]      = useState([]);
  const [loading,  setLoading]  = useState(false);
  const [selected, setSelected] = useState(null);
  const [checks,   setChecks]   = useState({});
  const [qtys,     setQtys]     = useState({});
  const [method,   setMethod]   = useState('cash');
  const [note,     setNote]     = useState('');
  const [saving,   setSaving]   = useState(false);
  const [refundTotal, setRefundTotal] = useState(0);

  // Load transactions
  useEffect(() => {
    if (step !== 'lookup') return;
    setLoading(true);
    const f = DATE_FILTERS[dateIdx];
    listTransactions({ storeId, dateFrom: f.dateFrom, dateTo: f.dateTo, status: 'complete', limit: 500 })
      .then(r => setTxs(r.transactions || []))
      .catch(() => setTxs([]))
      .finally(() => setLoading(false));
  }, [storeId, dateIdx, step]);

  useEffect(() => {
    if (step === 'lookup') setTimeout(() => scanRef.current?.focus(), 80);
  }, [step]);

  const handleScanEnter = useCallback((e) => {
    if (e.key !== 'Enter') return;
    const q = txQuery.trim().toUpperCase();
    if (!q) return;
    const match = txs.find(t => t.txNumber?.toUpperCase() === q);
    if (match) selectTx(match);
  }, [txQuery, txs]); // eslint-disable-line

  const selectTx = (tx) => {
    setSelected(tx);
    const c = {}, q = {};
    (tx.lineItems || []).forEach(item => { c[item.lineId] = true; q[item.lineId] = item.qty; });
    setChecks(c); setQtys(q);
    setStep('items');
  };

  useEffect(() => {
    if (!selected) return;
    const total = (selected.lineItems || []).reduce((sum, item) => {
      if (!checks[item.lineId]) return sum;
      return sum + item.lineTotal * ((qtys[item.lineId] || 0) / item.qty);
    }, 0);
    setRefundTotal(Math.round(total * 100) / 100);
  }, [checks, qtys, selected]);

  const toggleItem = (lineId) => setChecks(c => ({ ...c, [lineId]: !c[lineId] }));
  const toggleAll  = () => {
    const allOn = (selected.lineItems || []).every(i => checks[i.lineId]);
    const next  = {};
    (selected.lineItems || []).forEach(i => { next[i.lineId] = !allOn; });
    setChecks(next);
  };
  const adjustQty  = (lineId, delta, max) =>
    setQtys(prev => ({ ...prev, [lineId]: Math.max(1, Math.min(max, (prev[lineId] || 1) + delta)) }));

  const refundItems = selected
    ? (selected.lineItems || []).filter(i => checks[i.lineId] && (qtys[i.lineId] || 0) > 0)
    : [];
  const allChecked = selected ? (selected.lineItems || []).every(i => checks[i.lineId]) : false;

  const doRefund = async () => {
    if (!selected || !refundItems.length || saving) return;
    setSaving(true);
    try {
      const lineItems   = refundItems.map(item => ({
        ...item, qty: qtys[item.lineId],
        lineTotal: item.lineTotal * (qtys[item.lineId] / item.qty),
      }));
      const tenderLines = method === 'cash'
        ? [{ method: 'cash', amount: refundTotal }]
        : (selected.tenderLines || []).map(l => ({ ...l, amount: refundTotal * (l.amount / selected.grandTotal) }));
      await apiRefund(selected.id, {
        lineItems, tenderLines, grandTotal: refundTotal, subtotal: refundTotal, taxTotal: 0,
        refundMethod: method, note: note || `Refund for ${selected.txNumber}`,
      });
      setStep('done');
      setTimeout(() => { onRefunded?.(); onClose(); }, 1600);
    } catch (e) {
      alert(e.response?.data?.error || 'Refund failed. Please try again.');
      setSaving(false);
    }
  };

  const visible = txs.filter(t =>
    !txQuery ||
    t.txNumber?.toLowerCase().includes(txQuery.toLowerCase()) ||
    t.cashierName?.toLowerCase().includes(txQuery.toLowerCase())
  );

  // ── Lookup step ───────────────────────────────────────────────────────
  if (step === 'lookup') return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      {/* Scan bar */}
      <div style={{ padding:'0.875rem 1.25rem', borderBottom:'1px solid var(--border)', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, background:'var(--bg-input)', border:'1px solid var(--border-light)', borderRadius:10, padding:'0 1rem' }}>
          <Scan size={16} color="var(--blue)" style={{ flexShrink:0 }} />
          <input
            ref={scanRef}
            value={txQuery}
            onChange={e => setTxQuery(e.target.value)}
            onKeyDown={handleScanEnter}
            placeholder="Scan receipt barcode  or  type TX#  and press Enter…"
            style={{ flex:1, background:'none', border:'none', color:'var(--text-primary)', fontSize:'0.88rem', padding:'0.75rem 0', outline:'none' }}
          />
          {txQuery && <button onClick={() => setTxQuery('')} style={{ background:'none', border:'none', color:'var(--text-muted)', cursor:'pointer', padding:2, display:'flex' }}><X size={13} /></button>}
        </div>
      </div>

      {/* Date filters */}
      <div style={{ padding:'0.5rem 1.25rem', display:'flex', gap:6, alignItems:'center', borderBottom:'1px solid var(--border)', flexShrink:0 }}>
        <span style={{ fontSize:'0.65rem', fontWeight:700, color:'var(--text-muted)', marginRight:4 }}>SHOW:</span>
        {DATE_FILTERS.map((f, i) => (
          <button key={f.label} onClick={() => setDateIdx(i)} style={{
            padding:'3px 12px', borderRadius:20, fontWeight:700, fontSize:'0.72rem',
            background: dateIdx === i ? 'var(--blue)' : 'var(--bg-input)',
            color: dateIdx === i ? '#fff' : 'var(--text-muted)',
            border:`1px solid ${dateIdx === i ? 'var(--blue)' : 'var(--border)'}`,
            cursor:'pointer',
          }}>{f.label}</button>
        ))}
        <span style={{ marginLeft:'auto', fontSize:'0.7rem', color:'var(--text-muted)' }}>
          {loading ? 'Loading…' : `${visible.length} transaction${visible.length !== 1 ? 's' : ''}`}
        </span>
      </div>

      {/* Transaction list */}
      <div style={{ flex:1, overflowY:'auto' }}>
        {loading ? (
          <div style={{ padding:'3rem', textAlign:'center', color:'var(--text-muted)' }}>Loading…</div>
        ) : visible.length === 0 ? (
          <div style={{ padding:'3rem', textAlign:'center', color:'var(--text-muted)', fontSize:'0.875rem' }}>No transactions found for this period</div>
        ) : visible.map(tx => (
          <div key={tx.id} onClick={() => selectTx(tx)}
            style={{ padding:'0.75rem 1.25rem', borderBottom:'1px solid var(--border)', cursor:'pointer', display:'flex', alignItems:'center', gap:12, transition:'background .1s' }}
            onMouseEnter={e => e.currentTarget.style.background='rgba(59,130,246,.04)'}
            onMouseLeave={e => e.currentTarget.style.background='transparent'}
          >
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <span style={{ fontWeight:800, fontSize:'0.9rem' }}>{tx.txNumber}</span>
                <span style={{ fontSize:'0.68rem', color:'var(--text-muted)' }}>
                  {new Date(tx.createdAt).toLocaleDateString([], { month:'short', day:'numeric' })}
                  {' '}
                  {new Date(tx.createdAt).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })}
                </span>
              </div>
              <div style={{ fontSize:'0.72rem', color:'var(--text-muted)', marginTop:2 }}>
                {tx.cashierName} · {(tx.lineItems||[]).length} item{(tx.lineItems||[]).length!==1?'s':''} · {(tx.tenderLines||[]).map(l=>l.method.replace('_',' ')).join(' + ')}
              </div>
            </div>
            <span style={{ fontWeight:900, fontSize:'1rem', color:'var(--green)', flexShrink:0 }}>{fmt$(tx.grandTotal)}</span>
            <ChevronRight size={14} color="var(--text-muted)" style={{ flexShrink:0 }} />
          </div>
        ))}
      </div>
    </div>
  );

  // ── Items step ────────────────────────────────────────────────────────
  if (step === 'items') return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      {/* Tx strip */}
      <div style={{ padding:'0.5rem 1.25rem', background:'var(--bg-card)', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0 }}>
        <div>
          <span style={{ fontWeight:800, fontSize:'0.88rem' }}>{selected.txNumber}</span>
          <span style={{ fontSize:'0.7rem', color:'var(--text-muted)', marginLeft:8 }}>
            {new Date(selected.createdAt).toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})} · {selected.cashierName}
          </span>
        </div>
        <span style={{ fontWeight:900, color:'var(--green)' }}>{fmt$(selected.grandTotal)}</span>
      </div>

      {/* Select-all */}
      <div style={{ padding:'0.5rem 1.25rem', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:10, flexShrink:0 }}>
        <button onClick={toggleAll} style={{ width:22, height:22, borderRadius:6, background:allChecked?'var(--blue)':'var(--bg-input)', border:`2px solid ${allChecked?'var(--blue)':'var(--border)'}`, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}>
          {allChecked && <Check size={13} color="#fff" strokeWidth={3} />}
        </button>
        <span style={{ fontSize:'0.78rem', fontWeight:700, color:'var(--text-secondary)' }}>{allChecked ? 'Deselect all' : 'Select all items'}</span>
        <span style={{ marginLeft:'auto', fontSize:'0.72rem', color:'var(--text-muted)' }}>{refundItems.length} of {(selected.lineItems||[]).length} selected</span>
      </div>

      {/* Items */}
      <div style={{ flex:1, overflowY:'auto' }}>
        {(selected.lineItems||[]).map(item => {
          const checked  = !!checks[item.lineId];
          const qty      = qtys[item.lineId] || item.qty;
          const lineCost = item.lineTotal * (qty / item.qty);
          return (
            <div key={item.lineId} style={{ padding:'0.65rem 1.25rem', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:12, background:checked?'rgba(59,130,246,.03)':'transparent', opacity:checked?1:0.4, transition:'all .1s' }}>
              <button onClick={() => toggleItem(item.lineId)} style={{ width:22, height:22, borderRadius:6, background:checked?'var(--blue)':'var(--bg-input)', border:`2px solid ${checked?'var(--blue)':'var(--border)'}`, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', flexShrink:0 }}>
                {checked && <Check size={13} color="#fff" strokeWidth={3} />}
              </button>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontWeight:600, fontSize:'0.875rem' }}>{item.name}</div>
                <div style={{ fontSize:'0.7rem', color:'var(--text-muted)', marginTop:1 }}>{fmt$(item.unitPrice)} each</div>
              </div>
              {item.qty > 1 && checked ? (
                <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                  <button onClick={() => adjustQty(item.lineId,-1,item.qty)} style={{ width:26, height:26, borderRadius:6, background:'var(--bg-input)', border:'1px solid var(--border)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}><Minus size={11} /></button>
                  <span style={{ width:24, textAlign:'center', fontWeight:800, fontSize:'0.9rem' }}>{qty}</span>
                  <button onClick={() => adjustQty(item.lineId,1,item.qty)} style={{ width:26, height:26, borderRadius:6, background:'var(--bg-input)', border:'1px solid var(--border)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}><Plus size={11} /></button>
                </div>
              ) : item.qty > 1 ? (
                <span style={{ fontSize:'0.75rem', color:'var(--text-muted)', width:40, textAlign:'right' }}>×{item.qty}</span>
              ) : null}
              <span style={{ fontWeight:700, fontSize:'0.9rem', color:checked?'var(--blue)':'var(--text-muted)', minWidth:54, textAlign:'right', flexShrink:0 }}>
                {checked ? `-${fmt$(lineCost)}` : fmt$(item.lineTotal)}
              </span>
            </div>
          );
        })}
      </div>

      <div style={{ padding:'0.875rem 1.25rem', borderTop:'1px solid var(--border)', flexShrink:0 }}>
        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:10 }}>
          <span style={{ fontSize:'0.78rem', color:'var(--text-muted)', fontWeight:600 }}>{refundItems.length} item{refundItems.length!==1?'s':''} selected</span>
          <span style={{ fontWeight:900, fontSize:'1.2rem', color:'var(--blue)' }}>-{fmt$(refundTotal)}</span>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={() => setStep('lookup')} style={{ flex:1, padding:'0.875rem', background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:10, color:'var(--text-secondary)', fontWeight:700, cursor:'pointer' }}>← Back</button>
          <button onClick={() => setStep('method')} disabled={!refundItems.length} style={{ flex:3, padding:'0.875rem', background:refundItems.length?'var(--blue)':'var(--bg-input)', border:'none', borderRadius:10, color:refundItems.length?'#fff':'var(--text-muted)', fontWeight:800, cursor:refundItems.length?'pointer':'not-allowed' }}>
            Continue — Refund {fmt$(refundTotal)} →
          </button>
        </div>
      </div>
    </div>
  );

  // ── Method step ───────────────────────────────────────────────────────
  if (step === 'method') return (
    <div style={{ flex:1, padding:'1.25rem', display:'flex', flexDirection:'column', gap:14, overflowY:'auto' }}>
      <div style={{ background:'var(--bg-card)', borderRadius:12, padding:'1rem', border:'1px solid var(--border)' }}>
        <div style={{ fontSize:'0.65rem', fontWeight:700, color:'var(--text-muted)', letterSpacing:'0.06em', marginBottom:8 }}>REFUNDING FROM {selected?.txNumber}</div>
        {refundItems.map(item => (
          <div key={item.lineId} style={{ display:'flex', justifyContent:'space-between', padding:'0.3rem 0', borderBottom:'1px solid var(--border)' }}>
            <span style={{ fontSize:'0.875rem', color:'var(--text-secondary)' }}>{qtys[item.lineId]>1?`${qtys[item.lineId]}× `:''}{item.name}</span>
            <span style={{ fontWeight:700 }}>-{fmt$(item.lineTotal * qtys[item.lineId] / item.qty)}</span>
          </div>
        ))}
        <div style={{ display:'flex', justifyContent:'space-between', paddingTop:'0.625rem', marginTop:'0.25rem' }}>
          <span style={{ fontWeight:800 }}>Refund Total</span>
          <span style={{ fontWeight:900, fontSize:'1.3rem', color:'var(--blue)' }}>-{fmt$(refundTotal)}</span>
        </div>
      </div>

      <div>
        <div style={{ fontSize:'0.68rem', fontWeight:700, color:'var(--text-muted)', letterSpacing:'0.06em', marginBottom:8 }}>HOW TO REFUND</div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
          {[
            { id:'cash',     label:'Cash',            sub:'Give cash from drawer',  Icon:DollarSign, color:'var(--green)', bg:'rgba(122,193,67,.12)', border:'rgba(122,193,67,.4)' },
            { id:'original', label:'Original Method', sub:(selected?.tenderLines||[]).map(l=>l.method.replace('_',' ')).join(' + ')||'Same as purchase', Icon:CreditCard, color:'var(--blue)', bg:'rgba(59,130,246,.12)', border:'rgba(59,130,246,.4)' },
          ].map(opt => (
            <button key={opt.id} onClick={() => setMethod(opt.id)} style={{ padding:'1rem', borderRadius:12, cursor:'pointer', background:method===opt.id?opt.bg:'var(--bg-input)', border:`2px solid ${method===opt.id?opt.border:'var(--border)'}`, display:'flex', flexDirection:'column', alignItems:'flex-start', gap:4, textAlign:'left', transition:'border .1s' }}>
              <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                {method===opt.id
                  ? <div style={{ width:18, height:18, borderRadius:'50%', background:opt.color, display:'flex', alignItems:'center', justifyContent:'center' }}><Check size={11} color="#fff" strokeWidth={3} /></div>
                  : <div style={{ width:18, height:18, borderRadius:'50%', border:'2px solid var(--border)' }} />
                }
                <span style={{ fontWeight:800, fontSize:'0.88rem', color:method===opt.id?opt.color:'var(--text-primary)' }}>{opt.label}</span>
              </div>
              <span style={{ fontSize:'0.7rem', color:'var(--text-muted)', paddingLeft:24, textTransform:'capitalize' }}>{opt.sub}</span>
            </button>
          ))}
        </div>
      </div>

      {method === 'cash' && (
        <div style={{ background:'rgba(245,158,11,.06)', border:'1px solid rgba(245,158,11,.2)', borderRadius:8, padding:'0.625rem 0.875rem', display:'flex', gap:8 }}>
          <AlertTriangle size={14} color="var(--amber)" style={{ flexShrink:0, marginTop:1 }} />
          <span style={{ fontSize:'0.75rem', color:'var(--amber)', fontWeight:600 }}>Give the customer {fmt$(refundTotal)} cash from the drawer.</span>
        </div>
      )}

      <input value={note} onChange={e => setNote(e.target.value)} placeholder="Reason for refund (optional)…" autoFocus
        style={{ width:'100%', padding:'0.75rem', background:'var(--bg-input)', border:'1px solid var(--border)', borderRadius:8, color:'var(--text-primary)', fontSize:'0.875rem', boxSizing:'border-box', outline:'none' }} />

      <div style={{ display:'flex', gap:8, marginTop:'auto' }}>
        <button onClick={() => setStep('items')} style={{ flex:1, padding:'0.875rem', background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:10, color:'var(--text-secondary)', fontWeight:700, cursor:'pointer' }}>← Back</button>
        <button onClick={doRefund} disabled={saving} style={{ flex:3, padding:'0.875rem', background:saving?'var(--bg-input)':'var(--blue)', border:'none', borderRadius:10, color:saving?'var(--text-muted)':'#fff', fontWeight:800, cursor:saving?'not-allowed':'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:8, fontSize:'0.95rem' }}>
          <RotateCcw size={16} /> {saving ? 'Processing…' : `Process Refund ${fmt$(refundTotal)}`}
        </button>
      </div>
    </div>
  );

  // ── Done step ─────────────────────────────────────────────────────────
  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:16, padding:'3rem' }}>
      <div style={{ width:64, height:64, borderRadius:'50%', background:'rgba(59,130,246,.12)', border:'2px solid rgba(59,130,246,.3)', display:'flex', alignItems:'center', justifyContent:'center' }}>
        <Check size={30} color="var(--blue)" strokeWidth={2.5} />
      </div>
      <div style={{ textAlign:'center' }}>
        <div style={{ fontWeight:800, fontSize:'1.1rem', color:'var(--blue)', marginBottom:4 }}>Refund Processed</div>
        <div style={{ fontSize:'2rem', fontWeight:900, color:'var(--blue)' }}>-{fmt$(refundTotal)}</div>
        <div style={{ fontSize:'0.78rem', color:'var(--text-muted)', marginTop:6 }}>
          {method === 'cash' ? 'Cash returned to customer' : 'Returned to original payment method'}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
//  NO-RECEIPT FLOW
// ══════════════════════════════════════════════════════════════════════════
function NoReceipt({ onClose, onRefunded, storeId }) {
  const cashier   = useAuthStore(s => s.cashier);
  const scanRef   = useRef(null);
  const [step,    setStep]    = useState('items');  // items | confirm | done
  const [query,   setQuery]   = useState('');
  const [results, setResults] = useState([]);
  const [basket,  setBasket]  = useState([]);  // { product, qty, unitPrice }
  const [note,    setNote]    = useState('');
  const [saving,  setSaving]  = useState(false);

  useEffect(() => { setTimeout(() => scanRef.current?.focus(), 80); }, []);

  // Product search
  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    searchProducts(query, null, 20).then(setResults);
  }, [query]);

  // Add product to basket (or increment qty if already there)
  const addToBasket = (product) => {
    setBasket(b => {
      const existing = b.find(r => r.product.id === product.id);
      if (existing) return b.map(r => r.product.id === product.id ? { ...r, qty: r.qty + 1 } : r);
      return [...b, { product, qty: 1, unitPrice: product.retailPrice }];
    });
    setQuery('');
    setResults([]);
    scanRef.current?.focus();
  };

  const removeFromBasket = (productId) => setBasket(b => b.filter(r => r.product.id !== productId));
  const adjustBasketQty  = (productId, delta) =>
    setBasket(b => b.map(r => r.product.id === productId ? { ...r, qty: Math.max(1, r.qty + delta) } : r));

  const refundTotal = basket.reduce((s, r) => s + r.unitPrice * r.qty, 0);

  const doRefund = async () => {
    if (!basket.length || saving) return;
    setSaving(true);
    try {
      const lineItems = basket.map((r, i) => ({
        lineId:    `nr-${i}`,
        name:      r.product.name,
        upc:       r.product.upc,
        productId: r.product.id,
        qty:       r.qty,
        unitPrice: r.unitPrice,
        lineTotal: r.unitPrice * r.qty,
        ebtEligible: r.product.ebtEligible || false,
      }));
      await createOpenRefund({
        storeId,
        lineItems,
        tenderLines:  [{ method: 'cash', amount: refundTotal }],
        grandTotal:   refundTotal,
        subtotal:     refundTotal,
        taxTotal:     0,
        note: note || 'No-receipt return',
      });
      setStep('done');
      setTimeout(() => { onRefunded?.(); onClose(); }, 1600);
    } catch (e) {
      alert(e.response?.data?.error || 'Refund failed. Please try again.');
      setSaving(false);
    }
  };

  // ── Items step ────────────────────────────────────────────────────────
  if (step === 'items') return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      {/* Product search */}
      <div style={{ padding:'0.875rem 1.25rem', borderBottom:'1px solid var(--border)', flexShrink:0, position:'relative' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, background:'var(--bg-input)', border:'1px solid var(--border-light)', borderRadius:10, padding:'0 1rem' }}>
          <Scan size={16} color="var(--blue)" style={{ flexShrink:0 }} />
          <input
            ref={scanRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Scan item barcode  or  search by name…"
            style={{ flex:1, background:'none', border:'none', color:'var(--text-primary)', fontSize:'0.88rem', padding:'0.75rem 0', outline:'none' }}
          />
          {query && <button onClick={() => { setQuery(''); setResults([]); }} style={{ background:'none', border:'none', color:'var(--text-muted)', cursor:'pointer', padding:2, display:'flex' }}><X size={13} /></button>}
        </div>
        {/* Search dropdown */}
        {results.length > 0 && (
          <div style={{ position:'absolute', left:'1.25rem', right:'1.25rem', top:'100%', background:'var(--bg-card)', border:'1px solid var(--border-light)', borderRadius:10, zIndex:10, boxShadow:'0 8px 32px rgba(0,0,0,.4)', overflow:'hidden', maxHeight:220, overflowY:'auto' }}>
            {results.map(p => (
              <button key={p.id} onMouseDown={() => addToBasket(p)} style={{ width:'100%', padding:'0.65rem 1rem', textAlign:'left', background:'none', border:'none', display:'flex', justifyContent:'space-between', alignItems:'center', cursor:'pointer', borderBottom:'1px solid var(--border)' }}
                onMouseEnter={e => e.currentTarget.style.background='rgba(59,130,246,.06)'}
                onMouseLeave={e => e.currentTarget.style.background='none'}
              >
                <div>
                  <div style={{ fontSize:'0.875rem', fontWeight:600, color:'var(--text-primary)' }}>{p.name}</div>
                  <div style={{ fontSize:'0.7rem', color:'var(--text-muted)' }}>{p.upc}</div>
                </div>
                <span style={{ fontWeight:700, color:'var(--green)', flexShrink:0, marginLeft:12 }}>{fmt$(p.retailPrice)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Basket */}
      <div style={{ flex:1, overflowY:'auto' }}>
        {basket.length === 0 ? (
          <div style={{ padding:'3rem', textAlign:'center', color:'var(--text-muted)', opacity:0.5 }}>
            <Package size={40} style={{ marginBottom:12 }} />
            <div style={{ fontSize:'0.875rem' }}>Scan or search for items to return</div>
          </div>
        ) : basket.map(r => (
          <div key={r.product.id} style={{ padding:'0.75rem 1.25rem', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:12 }}>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontWeight:600, fontSize:'0.875rem' }}>{r.product.name}</div>
              <div style={{ fontSize:'0.7rem', color:'var(--text-muted)' }}>{fmt$(r.unitPrice)} each</div>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:5 }}>
              <button onClick={() => adjustBasketQty(r.product.id,-1)} style={{ width:26, height:26, borderRadius:6, background:'var(--bg-input)', border:'1px solid var(--border)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}><Minus size={11} /></button>
              <span style={{ width:28, textAlign:'center', fontWeight:800 }}>{r.qty}</span>
              <button onClick={() => adjustBasketQty(r.product.id,1)} style={{ width:26, height:26, borderRadius:6, background:'var(--bg-input)', border:'1px solid var(--border)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}><Plus size={11} /></button>
            </div>
            <span style={{ fontWeight:700, color:'var(--blue)', minWidth:56, textAlign:'right', flexShrink:0 }}>-{fmt$(r.unitPrice * r.qty)}</span>
            <button onClick={() => removeFromBasket(r.product.id)} style={{ background:'none', border:'none', color:'var(--red)', cursor:'pointer', padding:4, display:'flex', flexShrink:0 }}><Trash2 size={14} /></button>
          </div>
        ))}
      </div>

      {basket.length > 0 && (
        <div style={{ padding:'0.875rem 1.25rem', borderTop:'1px solid var(--border)', flexShrink:0 }}>
          <div style={{ display:'flex', justifyContent:'space-between', marginBottom:10 }}>
            <span style={{ fontSize:'0.78rem', color:'var(--text-muted)', fontWeight:600 }}>{basket.length} item{basket.length!==1?'s':''} to return</span>
            <span style={{ fontWeight:900, fontSize:'1.2rem', color:'var(--blue)' }}>-{fmt$(refundTotal)}</span>
          </div>
          <button onClick={() => setStep('confirm')} style={{ width:'100%', padding:'0.875rem', background:'var(--blue)', border:'none', borderRadius:10, color:'#fff', fontWeight:800, cursor:'pointer', fontSize:'0.875rem' }}>
            Continue — Cash Refund {fmt$(refundTotal)} →
          </button>
        </div>
      )}
    </div>
  );

  // ── Confirm step ──────────────────────────────────────────────────────
  if (step === 'confirm') return (
    <div style={{ flex:1, padding:'1.25rem', display:'flex', flexDirection:'column', gap:14, overflowY:'auto' }}>
      <div style={{ background:'var(--bg-card)', borderRadius:12, padding:'1rem', border:'1px solid var(--border)' }}>
        <div style={{ fontSize:'0.65rem', fontWeight:700, color:'var(--text-muted)', letterSpacing:'0.06em', marginBottom:8 }}>NO-RECEIPT RETURN</div>
        {basket.map(r => (
          <div key={r.product.id} style={{ display:'flex', justifyContent:'space-between', padding:'0.3rem 0', borderBottom:'1px solid var(--border)' }}>
            <span style={{ fontSize:'0.875rem', color:'var(--text-secondary)' }}>{r.qty>1?`${r.qty}× `:''}{r.product.name}</span>
            <span style={{ fontWeight:700 }}>-{fmt$(r.unitPrice * r.qty)}</span>
          </div>
        ))}
        <div style={{ display:'flex', justifyContent:'space-between', paddingTop:'0.625rem', marginTop:'0.25rem' }}>
          <span style={{ fontWeight:800 }}>Cash Refund</span>
          <span style={{ fontWeight:900, fontSize:'1.3rem', color:'var(--blue)' }}>-{fmt$(refundTotal)}</span>
        </div>
      </div>

      <div style={{ background:'rgba(245,158,11,.06)', border:'1px solid rgba(245,158,11,.2)', borderRadius:8, padding:'0.75rem', display:'flex', gap:8 }}>
        <AlertTriangle size={14} color="var(--amber)" style={{ flexShrink:0, marginTop:1 }} />
        <span style={{ fontSize:'0.75rem', color:'var(--amber)', fontWeight:600 }}>
          Give the customer {fmt$(refundTotal)} cash from the drawer. No original receipt — manager authorization required.
        </span>
      </div>

      <input value={note} onChange={e => setNote(e.target.value)} placeholder="Reason for return (required for no-receipt)…" required autoFocus
        style={{ width:'100%', padding:'0.75rem', background:'var(--bg-input)', border:`1px solid ${!note.trim()?'rgba(224,63,63,.5)':'var(--border)'}`, borderRadius:8, color:'var(--text-primary)', fontSize:'0.875rem', boxSizing:'border-box', outline:'none' }} />

      <div style={{ display:'flex', gap:8, marginTop:'auto' }}>
        <button onClick={() => setStep('items')} style={{ flex:1, padding:'0.875rem', background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:10, color:'var(--text-secondary)', fontWeight:700, cursor:'pointer' }}>← Back</button>
        <button onClick={doRefund} disabled={saving || !note.trim()} style={{ flex:3, padding:'0.875rem', background:(saving||!note.trim())?'var(--bg-input)':'var(--blue)', border:'none', borderRadius:10, color:(saving||!note.trim())?'var(--text-muted)':'#fff', fontWeight:800, cursor:(saving||!note.trim())?'not-allowed':'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:8, fontSize:'0.95rem' }}>
          <RotateCcw size={16} /> {saving ? 'Processing…' : `Process Refund ${fmt$(refundTotal)}`}
        </button>
      </div>
    </div>
  );

  // ── Done step ─────────────────────────────────────────────────────────
  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:16, padding:'3rem' }}>
      <div style={{ width:64, height:64, borderRadius:'50%', background:'rgba(59,130,246,.12)', border:'2px solid rgba(59,130,246,.3)', display:'flex', alignItems:'center', justifyContent:'center' }}>
        <Check size={30} color="var(--blue)" strokeWidth={2.5} />
      </div>
      <div style={{ textAlign:'center' }}>
        <div style={{ fontWeight:800, fontSize:'1.1rem', color:'var(--blue)', marginBottom:4 }}>Refund Processed</div>
        <div style={{ fontSize:'2rem', fontWeight:900, color:'var(--blue)' }}>-{fmt$(refundTotal)}</div>
        <div style={{ fontSize:'0.78rem', color:'var(--text-muted)', marginTop:6 }}>Cash returned to customer</div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
//  ROOT MODAL
// ══════════════════════════════════════════════════════════════════════════
export default function RefundModal({ onClose, onRefunded }) {
  const cashier = useAuthStore(s => s.cashier);
  const station = useStationStore(s => s.station);
  const storeId = cashier?.storeId || station?.storeId;

  const [mode, setMode] = useState('receipt');  // 'receipt' | 'noreceipt'
  const [step, setStep] = useState('lookup');   // track for header label

  return (
    <div style={BACKDROP}>
      <div style={{ width:'100%', maxWidth:640, maxHeight:'93vh', background:'var(--bg-panel)', borderRadius:20, border:'1px solid rgba(59,130,246,.25)', display:'flex', flexDirection:'column', overflow:'hidden', boxShadow:'0 32px 80px rgba(0,0,0,.65)' }}>

        {/* ── Header ── */}
        <div style={{ padding:'0.875rem 1.25rem', borderBottom:'1px solid var(--border)', background:'rgba(59,130,246,.06)', flexShrink:0 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.625rem' }}>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <RotateCcw size={16} color="var(--blue)" />
              <span style={{ fontWeight:800, fontSize:'0.95rem', color:'var(--blue)' }}>Refund</span>
            </div>
            <button onClick={onClose} style={{ background:'none', border:'none', color:'var(--text-muted)', cursor:'pointer', padding:6, display:'flex' }}><X size={16} /></button>
          </div>
          {/* Mode tabs */}
          <div style={{ display:'flex', gap:6 }}>
            {[
              { id:'receipt',   label:'With Receipt',  icon:'🧾' },
              { id:'noreceipt', label:'No Receipt',    icon:'📦' },
            ].map(tab => (
              <button key={tab.id} onClick={() => setMode(tab.id)} style={{
                padding:'5px 14px', borderRadius:20, fontWeight:700, fontSize:'0.75rem',
                background: mode === tab.id ? 'var(--blue)' : 'var(--bg-input)',
                color:      mode === tab.id ? '#fff'        : 'var(--text-muted)',
                border:`1px solid ${mode === tab.id ? 'var(--blue)' : 'var(--border)'}`,
                cursor:'pointer',
              }}>
                {tab.icon} {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Content ── */}
        {mode === 'receipt'
          ? <WithReceipt  key="receipt"   onClose={onClose} onRefunded={onRefunded} storeId={storeId} />
          : <NoReceipt    key="noreceipt" onClose={onClose} onRefunded={onRefunded} storeId={storeId} />
        }
      </div>
    </div>
  );
}
