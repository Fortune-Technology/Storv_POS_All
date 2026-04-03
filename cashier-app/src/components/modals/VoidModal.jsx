/**
 * VoidModal — Manager-only. Look up a transaction by number and void it.
 */
import React, { useState, useEffect } from 'react';
import { X, Ban, Search, AlertTriangle, Check } from 'lucide-react';
import { listTransactions, voidTransaction as apiVoid } from '../../api/pos.js';
import { fmt$ } from '../../utils/formatters.js';
import { useAuthStore } from '../../stores/useAuthStore.js';

const BACKDROP = { position:'fixed', inset:0, zIndex:210, background:'rgba(0,0,0,.75)', display:'flex', alignItems:'center', justifyContent:'center', padding:'1rem' };

export default function VoidModal({ onClose, onVoided }) {
  const cashier = useAuthStore(s => s.cashier);
  const storeId = cashier?.storeId;
  const today   = new Date().toISOString().split('T')[0];

  const [txs,     setTxs]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected,setSelected]= useState(null);
  const [note,    setNote]    = useState('');
  const [saving,  setSaving]  = useState(false);
  const [done,    setDone]    = useState(false);
  const [search,  setSearch]  = useState('');

  useEffect(() => {
    listTransactions({ storeId, date: today, status: 'complete', limit: 50 })
      .then(r => setTxs(r.transactions || []))
      .catch(() => setTxs([]))
      .finally(() => setLoading(false));
  }, [storeId, today]);

  const visible = txs.filter(t =>
    !search || t.txNumber?.toLowerCase().includes(search.toLowerCase())
  );

  const doVoid = async () => {
    if (!selected || saving) return;
    setSaving(true);
    try {
      await apiVoid(selected.id, note);
      setDone(true);
      setTimeout(() => { onVoided?.(); onClose(); }, 1200);
    } catch (e) {
      alert(e.response?.data?.error || 'Failed to void transaction');
      setSaving(false);
    }
  };

  return (
    <div style={BACKDROP}>
      <div style={{ width:'100%', maxWidth:560, maxHeight:'90vh', background:'var(--bg-panel)', borderRadius:20, border:'1px solid rgba(224,63,63,.3)', display:'flex', flexDirection:'column', overflow:'hidden', boxShadow:'0 32px 80px rgba(0,0,0,.65)' }}>
        {/* Header */}
        <div style={{ padding:'1rem 1.25rem', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center', background:'rgba(224,63,63,.06)', flexShrink:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <Ban size={16} color="var(--red)" />
            <span style={{ fontWeight:800, fontSize:'0.95rem', color:'var(--red)' }}>Void Transaction</span>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', color:'var(--text-muted)', cursor:'pointer', padding:6, display:'flex' }}><X size={16} /></button>
        </div>

        {done ? (
          <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:12 }}>
            <div style={{ width:52, height:52, borderRadius:'50%', background:'rgba(224,63,63,.12)', display:'flex', alignItems:'center', justifyContent:'center' }}>
              <Check size={24} color="var(--red)" />
            </div>
            <div style={{ fontWeight:700, color:'var(--red)' }}>Transaction Voided</div>
          </div>
        ) : selected ? (
          /* Confirm void */
          <div style={{ flex:1, padding:'1.25rem', display:'flex', flexDirection:'column', gap:12 }}>
            <div style={{ background:'rgba(224,63,63,.06)', border:'1px solid rgba(224,63,63,.2)', borderRadius:12, padding:'1rem' }}>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:8 }}>
                <span style={{ fontWeight:800 }}>{selected.txNumber}</span>
                <span style={{ fontWeight:900, fontSize:'1.1rem', color:'var(--green)' }}>{fmt$(selected.grandTotal)}</span>
              </div>
              <div style={{ fontSize:'0.78rem', color:'var(--text-muted)' }}>
                {selected.cashierName} · {(selected.lineItems || []).length} items · {(selected.tenderLines || []).map(l => l.method).join(' + ')}
              </div>
            </div>

            <div style={{ background:'rgba(245,158,11,.06)', border:'1px solid rgba(245,158,11,.2)', borderRadius:8, padding:'0.75rem', display:'flex', gap:8 }}>
              <AlertTriangle size={15} color="var(--amber)" style={{ flexShrink:0, marginTop:1 }} />
              <span style={{ fontSize:'0.78rem', color:'var(--amber)', fontWeight:600 }}>This action cannot be undone. The transaction will be marked as voided.</span>
            </div>

            <input
              value={note} onChange={e => setNote(e.target.value)}
              placeholder="Reason for void (optional)…"
              style={{ width:'100%', padding:'0.75rem', background:'var(--bg-input)', border:'1px solid var(--border)', borderRadius:8, color:'var(--text-primary)', fontSize:'0.875rem', boxSizing:'border-box' }}
            />

            <div style={{ display:'flex', gap:8, marginTop:'auto' }}>
              <button onClick={() => setSelected(null)} style={{ flex:1, padding:'0.875rem', background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:10, color:'var(--text-secondary)', fontWeight:700, cursor:'pointer' }}>
                ← Back
              </button>
              <button onClick={doVoid} disabled={saving} style={{ flex:2, padding:'0.875rem', background:saving?'var(--bg-input)':'var(--red)', border:'none', borderRadius:10, color:saving?'var(--text-muted)':'#fff', fontWeight:800, cursor:saving?'not-allowed':'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:6 }}>
                <Ban size={16} /> {saving ? 'Voiding…' : 'Void Transaction'}
              </button>
            </div>
          </div>
        ) : (
          /* Select transaction */
          <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
            <div style={{ padding:'0.75rem 1.25rem', borderBottom:'1px solid var(--border)', flexShrink:0 }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, background:'var(--bg-input)', border:'1px solid var(--border)', borderRadius:8, padding:'0 0.75rem' }}>
                <Search size={14} color="var(--text-muted)" />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by TX#…"
                  style={{ flex:1, background:'none', border:'none', color:'var(--text-primary)', fontSize:'0.875rem', padding:'0.5rem 0', outline:'none' }} />
              </div>
            </div>
            <div style={{ flex:1, overflowY:'auto' }}>
              {loading ? (
                <div style={{ padding:'2rem', textAlign:'center', color:'var(--text-muted)' }}>Loading…</div>
              ) : visible.length === 0 ? (
                <div style={{ padding:'2rem', textAlign:'center', color:'var(--text-muted)', fontSize:'0.875rem' }}>No voidable transactions today</div>
              ) : visible.map(tx => (
                <div key={tx.id} onClick={() => setSelected(tx)}
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
      </div>
    </div>
  );
}
