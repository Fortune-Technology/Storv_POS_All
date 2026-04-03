/**
 * EndOfDayModal — Manager summary of the day's sales, tenders, and clock events.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { X, BarChart2, Printer, RefreshCw, Clock, DollarSign, CreditCard, Leaf } from 'lucide-react';
import { getEndOfDayReport } from '../../api/pos.js';
import { fmt$ } from '../../utils/formatters.js';
import { useAuthStore } from '../../stores/useAuthStore.js';

const BACKDROP = { position:'fixed', inset:0, zIndex:210, background:'rgba(0,0,0,.75)', display:'flex', alignItems:'center', justifyContent:'center', padding:'1rem' };

const TENDER_ICON  = { cash: DollarSign, card: CreditCard, ebt: Leaf, manual_card: CreditCard, manual_ebt: Leaf };
const TENDER_COLOR = { cash:'var(--green)', card:'var(--blue)', ebt:'#34d399', manual_card:'var(--blue)', manual_ebt:'#34d399' };

function fmt12(ts) {
  const d = new Date(ts);
  const h = d.getHours(), m = String(d.getMinutes()).padStart(2,'0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${m} ${ampm}`;
}

export default function EndOfDayModal({ onClose }) {
  const cashier = useAuthStore(s => s.cashier);
  const storeId = cashier?.storeId;
  const today   = new Date().toISOString().split('T')[0];

  const [report,  setReport]  = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setReport(await getEndOfDayReport(storeId, today)); }
    catch { setReport(null); }
    finally { setLoading(false); }
  }, [storeId, today]);

  useEffect(() => { load(); }, [load]);

  const handlePrint = () => window.print();

  return (
    <div style={BACKDROP}>
      <div style={{ width:'100%', maxWidth:620, maxHeight:'92vh', background:'var(--bg-panel)', borderRadius:20, border:'1px solid var(--border-light)', display:'flex', flexDirection:'column', overflow:'hidden', boxShadow:'0 32px 80px rgba(0,0,0,.65)' }}>
        {/* Header */}
        <div style={{ padding:'1rem 1.25rem', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <BarChart2 size={16} color="var(--green)" />
            <div>
              <div style={{ fontWeight:800, fontSize:'0.95rem' }}>End of Day Report</div>
              <div style={{ fontSize:'0.68rem', color:'var(--text-muted)' }}>{today}</div>
            </div>
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={load} title="Refresh" style={{ background:'none', border:'none', color:'var(--text-muted)', cursor:'pointer', padding:6, display:'flex' }}><RefreshCw size={15} /></button>
            <button onClick={handlePrint} title="Print" style={{ background:'none', border:'none', color:'var(--text-muted)', cursor:'pointer', padding:6, display:'flex' }}><Printer size={15} /></button>
            <button onClick={onClose} style={{ background:'none', border:'none', color:'var(--text-muted)', cursor:'pointer', padding:6, display:'flex' }}><X size={16} /></button>
          </div>
        </div>

        <div style={{ flex:1, overflowY:'auto', padding:'1rem' }}>
          {loading ? (
            <div style={{ textAlign:'center', padding:'3rem', color:'var(--text-muted)' }}>Loading…</div>
          ) : !report ? (
            <div style={{ textAlign:'center', padding:'3rem', color:'var(--text-muted)' }}>Unable to load report</div>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
              {/* Big total */}
              <div style={{ background:'rgba(122,193,67,.07)', border:'1px solid rgba(122,193,67,.2)', borderRadius:14, padding:'1.25rem', textAlign:'center' }}>
                <div style={{ fontSize:'0.65rem', fontWeight:700, color:'var(--text-muted)', letterSpacing:'0.08em', marginBottom:6 }}>NET SALES</div>
                <div style={{ fontSize:'3rem', fontWeight:900, color:'var(--green)', letterSpacing:'-0.03em' }}>{fmt$(report.netSales)}</div>
                <div style={{ display:'flex', gap:16, justifyContent:'center', marginTop:10, fontSize:'0.78rem', color:'var(--text-secondary)' }}>
                  <span>{report.transactionCount} sales</span>
                  <span style={{ opacity:.4 }}>·</span>
                  <span>{report.refundCount} refunds</span>
                  <span style={{ opacity:.4 }}>·</span>
                  <span>{report.voidedCount} voided</span>
                </div>
              </div>

              {/* Key metrics row */}
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8 }}>
                {[
                  { label:'Gross Sales', value:fmt$(report.totalSales),   color:'var(--text-primary)' },
                  { label:'Tax',         value:fmt$(report.totalTax),     color:'var(--text-secondary)' },
                  { label:'Refunds',     value:fmt$(report.totalRefunds), color:'var(--amber)' },
                ].map(m => (
                  <div key={m.label} style={{ background:'var(--bg-card)', borderRadius:10, padding:'0.75rem', textAlign:'center' }}>
                    <div style={{ fontSize:'0.6rem', color:'var(--text-muted)', fontWeight:700, letterSpacing:'0.05em', marginBottom:4 }}>{m.label}</div>
                    <div style={{ fontWeight:800, fontSize:'1rem', color:m.color }}>{m.value}</div>
                  </div>
                ))}
              </div>

              {/* Tender breakdown */}
              <div style={{ background:'var(--bg-card)', borderRadius:12, padding:'0.875rem' }}>
                <div style={{ fontSize:'0.65rem', fontWeight:700, color:'var(--text-muted)', letterSpacing:'0.06em', marginBottom:10 }}>TENDER BREAKDOWN</div>
                {Object.entries(report.tenderBreakdown || {}).map(([method, amount]) => {
                  const Icon  = TENDER_ICON[method] || DollarSign;
                  const color = TENDER_COLOR[method] || 'var(--text-secondary)';
                  return (
                    <div key={method} style={{ display:'flex', alignItems:'center', gap:10, padding:'0.4rem 0', borderBottom:'1px solid var(--border)' }}>
                      <Icon size={14} color={color} />
                      <span style={{ flex:1, fontSize:'0.82rem', color:'var(--text-secondary)', textTransform:'capitalize' }}>{method.replace('_',' ')}</span>
                      <span style={{ fontWeight:800, fontSize:'0.95rem', color }}>{fmt$(amount)}</span>
                    </div>
                  );
                })}
              </div>

              {/* Cashier breakdown */}
              {report.cashierBreakdown?.length > 0 && (
                <div style={{ background:'var(--bg-card)', borderRadius:12, padding:'0.875rem' }}>
                  <div style={{ fontSize:'0.65rem', fontWeight:700, color:'var(--text-muted)', letterSpacing:'0.06em', marginBottom:10 }}>BY CASHIER</div>
                  {report.cashierBreakdown.map((c, i) => (
                    <div key={i} style={{ display:'flex', alignItems:'center', padding:'0.4rem 0', borderBottom:'1px solid var(--border)' }}>
                      <span style={{ flex:1, fontSize:'0.85rem', fontWeight:600 }}>{c.name}</span>
                      <span style={{ fontSize:'0.78rem', color:'var(--text-muted)', marginRight:12 }}>{c.count} txns</span>
                      <span style={{ fontWeight:800, color:'var(--green)' }}>{fmt$(c.total)}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Clock events */}
              {report.clockEvents?.length > 0 && (
                <div style={{ background:'var(--bg-card)', borderRadius:12, padding:'0.875rem' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:10 }}>
                    <Clock size={13} color="var(--text-muted)" />
                    <span style={{ fontSize:'0.65rem', fontWeight:700, color:'var(--text-muted)', letterSpacing:'0.06em' }}>CLOCK EVENTS</span>
                  </div>
                  {report.clockEvents.map((e, i) => (
                    <div key={i} style={{ display:'flex', alignItems:'center', gap:10, padding:'0.35rem 0', borderBottom:'1px solid var(--border)' }}>
                      <span style={{ fontSize:'0.68rem', fontWeight:700, padding:'2px 7px', borderRadius:10, background: e.type==='in'?'rgba(122,193,67,.12)':'rgba(224,63,63,.12)', color:e.type==='in'?'var(--green)':'var(--red)' }}>
                        {e.type.toUpperCase()}
                      </span>
                      <span style={{ flex:1, fontSize:'0.82rem', fontWeight:600 }}>{e.userName}</span>
                      <span style={{ fontSize:'0.75rem', color:'var(--text-muted)' }}>{fmt12(e.createdAt)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ padding:'0.875rem 1.25rem', borderTop:'1px solid var(--border)', flexShrink:0 }}>
          <button onClick={onClose} style={{ width:'100%', padding:'0.875rem', background:'var(--green)', border:'none', borderRadius:12, color:'#0f1117', fontWeight:800, fontSize:'0.95rem', cursor:'pointer' }}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
