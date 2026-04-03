/**
 * RefundModal — Manager-only. Find a transaction and refund selected items.
 */
import React, { useState, useEffect } from 'react';
import { X, RotateCcw, Search, Check, Plus, Minus } from 'lucide-react';
import { listTransactions, createRefund as apiRefund } from '../../api/pos.js';
import { fmt$ } from '../../utils/formatters.js';
import { useAuthStore } from '../../stores/useAuthStore.js';

const BACKDROP = { position:'fixed', inset:0, zIndex:210, background:'rgba(0,0,0,.75)', display:'flex', alignItems:'center', justifyContent:'center', padding:'1rem' };

export default function RefundModal({ onClose, onRefunded }) {
  const cashier = useAuthStore(s => s.cashier);
  const storeId = cashier?.storeId;
  const today   = new Date().toISOString().split('T')[0];

  const [step,     setStep]     = useState('search');  // 'search' | 'items' | 'confirm' | 'done'
  const [txs,      setTxs]      = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [selected, setSelected] = useState(null);
  const [refQtys,  setRefQtys]  = useState({});  // lineId → qty to refund
  const [note,     setNote]     = useState('');
  const [saving,   setSaving]   = useState(false);
  const [search,   setSearch]   = useState('');

  useEffect(() => {
    listTransactions({ storeId, date: today, limit: 100 })
      .then(r => setTxs((r.transactions || []).filter(t => t.status === 'complete')))
      .catch(() => setTxs([]))
      .finally(() => setLoading(false));
  }, [storeId, today]);

  const selectTx = (tx) => {
    setSelected(tx);
    // Init all items at full qty
    const init = {};
    (tx.lineItems || []).forEach(item => { init[item.lineId] = item.qty; });
    setRefQtys(init);
    setStep('items');
  };

  const adjustQty = (lineId, delta, max) => {
    setRefQtys(prev => ({ ...prev, [lineId]: Math.max(0, Math.min(max, (prev[lineId] || 0) + delta)) }));
  };

  const refundItems = selected ? (selected.lineItems || []).filter(item => (refQtys[item.lineId] || 0) > 0) : [];

  const refundTotal = refundItems.reduce((sum, item) => {
    const ratio = (refQtys[item.lineId] || 0) / item.qty;
    return sum + (item.lineTotal * ratio);
  }, 0);

  const doRefund = async () => {
    if (!selected || !refundItems.length || saving) return;
    setSaving(true);
    try {
      const lineItems  = refundItems.map(item => ({
        ...item,
        qty:       refQtys[item.lineId],
        lineTotal: item.lineTotal * (refQtys[item.lineId] / item.qty),
      }));
      const tenderLines = (selected.tenderLines || []).map(l => ({ ...l, amount: refundTotal * (l.amount / selected.grandTotal) }));

      await apiRefund(selected.id, {
        lineItems,
        tenderLines,
        grandTotal:   refundTotal,
        subtotal:     refundTotal,
        taxTotal:     0,
        note: note || `Refund for ${selected.txNumber}`,
      });

      setStep('done');
      setTimeout(() => { onRefunded?.(); onClose(); }, 1400);
    } catch (e) {
      alert(e.response?.data?.error || 'Refund failed');
      setSaving(false);
    }
  };

  const visible = txs.filter(t => !search || t.txNumber?.toLowerCase().includes(search.toLowerCase()) || t.cashierName?.toLowerCase().includes(search.toLowerCase()));

  return (
    <div style={BACKDROP}>
      <div style={{ width:'100%', maxWidth:600, maxHeight:'92vh', background:'var(--bg-panel)', borderRadius:20, border:'1px solid rgba(59,130,246,.25)', display:'flex', flexDirection:'column', overflow:'hidden', boxShadow:'0 32px 80px rgba(0,0,0,.65)' }}>
        {/* Header */}
        <div style={{ padding:'1rem 1.25rem', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center', background:'rgba(59,130,246,.06)', flexShrink:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <RotateCcw size={16} color="var(--blue)" />
            <span style={{ fontWeight:800, fontSize:'0.95rem', color:'var(--blue)' }}>
              {step === 'search' ? 'Refund — Select Transaction' : step === 'items' ? `Refund — ${selected?.txNumber}` : 'Confirm Refund'}
            </span>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', color:'var(--text-muted)', cursor:'pointer', padding:6, display:'flex' }}><X size={16} /></button>
        </div>

        {/* Step: done */}
        {step === 'done' && (
          <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:12 }}>
            <div style={{ width:52, height:52, borderRadius:'50%', background:'rgba(59,130,246,.12)', display:'flex', alignItems:'center', justifyContent:'center' }}><Check size={24} color="var(--blue)" /></div>
            <div style={{ fontWeight:700, color:'var(--blue)' }}>Refund Processed</div>
            <div style={{ fontSize:'1.5rem', fontWeight:900, color:'var(--blue)' }}>-{fmt$(refundTotal)}</div>
          </div>
        )}

        {/* Step: search */}
        {step === 'search' && (
          <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
            <div style={{ padding:'0.75rem 1.25rem', borderBottom:'1px solid var(--border)', flexShrink:0 }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, background:'var(--bg-input)', border:'1px solid var(--border)', borderRadius:8, padding:'0 0.75rem' }}>
                <Search size={14} color="var(--text-muted)" />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by TX# or cashier…"
                  style={{ flex:1, background:'none', border:'none', color:'var(--text-primary)', fontSize:'0.875rem', padding:'0.5rem 0', outline:'none' }} />
              </div>
            </div>
            <div style={{ flex:1, overflowY:'auto' }}>
              {loading ? (
                <div style={{ padding:'2rem', textAlign:'center', color:'var(--text-muted)' }}>Loading…</div>
              ) : visible.length === 0 ? (
                <div style={{ padding:'2rem', textAlign:'center', color:'var(--text-muted)', fontSize:'0.875rem' }}>No refundable transactions today</div>
              ) : visible.map(tx => (
                <div key={tx.id} onClick={() => selectTx(tx)}
                  style={{ padding:'0.875rem 1.25rem', borderBottom:'1px solid var(--border)', cursor:'pointer', display:'flex', justifyContent:'space-between', alignItems:'center' }}
                  onMouseEnter={e => e.currentTarget.style.background='rgba(255,255,255,.03)'}
                  onMouseLeave={e => e.currentTarget.style.background='transparent'}
                >
                  <div>
                    <div style={{ fontWeight:800, fontSize:'0.88rem' }}>{tx.txNumber}</div>
                    <div style={{ fontSize:'0.72rem', color:'var(--text-muted)' }}>{tx.cashierName} · {(tx.lineItems||[]).length} items</div>
                  </div>
                  <span style={{ fontWeight:900, color:'var(--green)' }}>{fmt$(tx.grandTotal)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Step: select items */}
        {step === 'items' && selected && (
          <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
            <div style={{ flex:1, overflowY:'auto', padding:'0.875rem' }}>
              <div style={{ fontSize:'0.65rem', fontWeight:700, color:'var(--text-muted)', letterSpacing:'0.06em', marginBottom:8 }}>SELECT ITEMS TO REFUND</div>
              {(selected.lineItems || []).map(item => (
                <div key={item.lineId} style={{ display:'flex', alignItems:'center', gap:10, padding:'0.625rem', marginBottom:4, background:'var(--bg-card)', borderRadius:10, border:'1px solid var(--border)' }}>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontWeight:600, fontSize:'0.875rem' }}>{item.name}</div>
                    <div style={{ fontSize:'0.72rem', color:'var(--text-muted)' }}>{fmt$(item.unitPrice)} × {item.qty} = {fmt$(item.lineTotal)}</div>
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <button onClick={() => adjustQty(item.lineId, -1, item.qty)} style={{ width:32, height:32, borderRadius:8, background:'var(--bg-input)', border:'1px solid var(--border)', color:'var(--text-secondary)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
                      <Minus size={14} />
                    </button>
                    <span style={{ width:24, textAlign:'center', fontWeight:800 }}>{refQtys[item.lineId] ?? item.qty}</span>
                    <button onClick={() => adjustQty(item.lineId, 1, item.qty)} style={{ width:32, height:32, borderRadius:8, background:'var(--bg-input)', border:'1px solid var(--border)', color:'var(--text-secondary)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
                      <Plus size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ padding:'0.875rem 1.25rem', borderTop:'1px solid var(--border)', display:'flex', gap:8, flexShrink:0 }}>
              <button onClick={() => setStep('search')} style={{ flex:1, padding:'0.875rem', background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:10, color:'var(--text-secondary)', fontWeight:700, cursor:'pointer' }}>← Back</button>
              <button onClick={() => setStep('confirm')} disabled={refundItems.length === 0} style={{ flex:2, padding:'0.875rem', background: refundItems.length ? 'var(--blue)' : 'var(--bg-input)', border:'none', borderRadius:10, color:refundItems.length?'#fff':'var(--text-muted)', fontWeight:800, cursor:refundItems.length?'pointer':'not-allowed' }}>
                Review Refund — {fmt$(refundTotal)}
              </button>
            </div>
          </div>
        )}

        {/* Step: confirm */}
        {step === 'confirm' && (
          <div style={{ flex:1, padding:'1.25rem', display:'flex', flexDirection:'column', gap:12 }}>
            <div style={{ background:'var(--bg-card)', borderRadius:12, padding:'1rem' }}>
              <div style={{ fontSize:'0.65rem', fontWeight:700, color:'var(--text-muted)', letterSpacing:'0.06em', marginBottom:8 }}>REFUNDING</div>
              {refundItems.map(item => (
                <div key={item.lineId} style={{ display:'flex', justifyContent:'space-between', padding:'0.3rem 0', borderBottom:'1px solid var(--border)' }}>
                  <span style={{ fontSize:'0.875rem', color:'var(--text-secondary)' }}>{refQtys[item.lineId]}× {item.name}</span>
                  <span style={{ fontWeight:700 }}>-{fmt$(item.lineTotal * refQtys[item.lineId] / item.qty)}</span>
                </div>
              ))}
              <div style={{ display:'flex', justifyContent:'space-between', paddingTop:'0.75rem', marginTop:'0.25rem' }}>
                <span style={{ fontWeight:800 }}>Refund Total</span>
                <span style={{ fontWeight:900, fontSize:'1.25rem', color:'var(--blue)' }}>-{fmt$(refundTotal)}</span>
              </div>
            </div>
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="Reason for refund (optional)…"
              style={{ width:'100%', padding:'0.75rem', background:'var(--bg-input)', border:'1px solid var(--border)', borderRadius:8, color:'var(--text-primary)', fontSize:'0.875rem', boxSizing:'border-box' }} />
            <div style={{ display:'flex', gap:8, marginTop:'auto' }}>
              <button onClick={() => setStep('items')} style={{ flex:1, padding:'0.875rem', background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:10, color:'var(--text-secondary)', fontWeight:700, cursor:'pointer' }}>← Back</button>
              <button onClick={doRefund} disabled={saving} style={{ flex:2, padding:'0.875rem', background:saving?'var(--bg-input)':'var(--blue)', border:'none', borderRadius:10, color:saving?'var(--text-muted)':'#fff', fontWeight:800, cursor:saving?'not-allowed':'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:6 }}>
                <RotateCcw size={16} /> {saving ? 'Processing…' : 'Process Refund'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
