/**
 * TransactionHistoryModal
 * Browse all past transactions with date picker, search, filter.
 * onPrintTx(tx)  → direct hardware print (no intermediate modal)
 * onViewTx(tx)   → open ReprintReceiptModal to see on-screen
 */
import React, { useState, useEffect, useCallback } from 'react';
import { X, Search, Printer, Eye, RotateCcw, ChevronRight, Ban, RefreshCw, Calendar, ChevronLeft } from 'lucide-react';
import { listTransactions } from '../../api/pos.js';
import { fmt$ } from '../../utils/formatters.js';
import { useAuthStore } from '../../stores/useAuthStore.js';

const STATUS_COLOR = {
  complete:  'var(--green)',
  voided:    'var(--red)',
  refund:    'var(--amber)',
  suspended: 'var(--text-muted)',
};

const BACKDROP = { position:'fixed', inset:0, zIndex:210, background:'rgba(0,0,0,.75)', display:'flex', alignItems:'center', justifyContent:'center', padding:'1rem' };
const MODAL    = { width:'100%', maxWidth:740, maxHeight:'94vh', background:'var(--bg-panel)', borderRadius:20, border:'1px solid var(--border-light)', display:'flex', flexDirection:'column', boxShadow:'0 32px 80px rgba(0,0,0,.65)', overflow:'hidden' };
const HDR      = { padding:'1rem 1.25rem', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0 };

function fmtDuration(ts) {
  const now  = Date.now();
  const diff = now - new Date(ts).getTime();
  const min  = Math.floor(diff / 60000);
  if (min < 1)  return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ${min % 60}m ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function toLocalDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function shiftDate(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return toLocalDateStr(d);
}

export default function TransactionHistoryModal({ onClose, onPrintTx, onViewTx }) {
  const cashier      = useAuthStore(s => s.cashier);
  const storeId      = cashier?.storeId;
  const today        = toLocalDateStr(new Date());

  const [date,    setDate]    = useState(today);
  const [txs,     setTxs]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState('');
  const [filter,  setFilter]  = useState('all');
  const [detail,  setDetail]  = useState(null);

  const load = useCallback(async (d) => {
    setLoading(true);
    try {
      const res = await listTransactions({ storeId, date: d || date, limit: 300 });
      setTxs(res.transactions || []);
    } catch { setTxs([]); }
    finally  { setLoading(false); }
  }, [storeId, date]);

  useEffect(() => { load(date); }, [date]); // eslint-disable-line

  const visible = txs.filter(t => {
    if (filter !== 'all' && t.status !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return t.txNumber?.toLowerCase().includes(q) || t.cashierName?.toLowerCase().includes(q);
    }
    return true;
  });

  const totals = visible.reduce((acc, t) => {
    if (t.status === 'complete') acc.sales += t.grandTotal;
    if (t.status === 'refund')   acc.refunds += Math.abs(t.grandTotal);
    if (t.status === 'voided')   acc.voided++;
    return acc;
  }, { sales: 0, refunds: 0, voided: 0 });

  const isToday = date === today;

  return (
    <div style={BACKDROP}>
      <div style={{ ...MODAL, position:'relative' }}>

        {/* ── Header ── */}
        <div style={HDR}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <div>
              <div style={{ fontWeight:800, fontSize:'1rem' }}>Transaction History</div>
              <div style={{ fontSize:'0.72rem', color:'var(--text-muted)', marginTop:1 }}>
                {txs.length} transaction{txs.length !== 1 ? 's' : ''} · {date}
              </div>
            </div>
          </div>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            <button onClick={() => load(date)} title="Refresh"
              style={{ background:'none', border:'none', color:'var(--text-muted)', cursor:'pointer', padding:6, display:'flex' }}>
              <RefreshCw size={15} style={{ animation: loading ? 'spin 0.9s linear infinite' : 'none' }} />
            </button>
            <button onClick={onClose}
              style={{ background:'none', border:'none', color:'var(--text-muted)', cursor:'pointer', padding:6, display:'flex' }}>
              <X size={16} />
            </button>
          </div>
        </div>

        {/* ── Date navigation ── */}
        <div style={{ padding:'0.625rem 1.25rem', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:8, flexShrink:0, background:'var(--bg-card)' }}>
          <button
            onClick={() => setDate(d => shiftDate(d, -1))}
            style={{ background:'var(--bg-input)', border:'1px solid var(--border)', borderRadius:8, padding:'0.35rem 0.6rem', cursor:'pointer', color:'var(--text-muted)', display:'flex', alignItems:'center' }}
          >
            <ChevronLeft size={15} />
          </button>

          <div style={{ flex:1, display:'flex', alignItems:'center', gap:6, background:'var(--bg-input)', border:'1px solid var(--border)', borderRadius:8, padding:'0.35rem 0.75rem' }}>
            <Calendar size={13} color="var(--text-muted)" />
            <input
              type="date"
              value={date}
              max={today}
              onChange={e => setDate(e.target.value)}
              style={{ background:'none', border:'none', color:'var(--text-primary)', fontSize:'0.85rem', outline:'none', cursor:'pointer', flex:1 }}
            />
          </div>

          <button
            onClick={() => setDate(d => shiftDate(d, 1))}
            disabled={isToday}
            style={{ background: isToday ? 'var(--bg-card)' : 'var(--bg-input)', border:'1px solid var(--border)', borderRadius:8, padding:'0.35rem 0.6rem', cursor: isToday ? 'not-allowed' : 'pointer', color: isToday ? 'var(--text-muted)' : 'var(--text-secondary)', display:'flex', alignItems:'center', opacity: isToday ? 0.4 : 1 }}
          >
            <ChevronRight size={15} />
          </button>

          {!isToday && (
            <button
              onClick={() => setDate(today)}
              style={{ background:'var(--bg-input)', border:'1px solid var(--border)', borderRadius:8, padding:'0.35rem 0.7rem', cursor:'pointer', color:'var(--accent-primary)', fontSize:'0.75rem', fontWeight:700 }}
            >
              Today
            </button>
          )}
        </div>

        {/* ── Summary bar ── */}
        <div style={{ padding:'0.625rem 1.25rem', background:'var(--bg-card)', borderBottom:'1px solid var(--border)', display:'flex', gap:24, flexShrink:0 }}>
          {[
            { label:'Net Sales', value:fmt$(totals.sales - totals.refunds), color:'var(--green)'  },
            { label:'Refunds',   value:fmt$(totals.refunds),                color:'var(--amber)'  },
            { label:'Voided',    value:String(totals.voided),               color:'var(--red)'    },
          ].map(item => (
            <div key={item.label}>
              <div style={{ fontSize:'0.6rem', color:'var(--text-muted)', fontWeight:700, letterSpacing:'0.06em' }}>{item.label}</div>
              <div style={{ fontSize:'1rem', fontWeight:800, color:item.color }}>{item.value}</div>
            </div>
          ))}
        </div>

        {/* ── Search + filter ── */}
        <div style={{ padding:'0.75rem 1.25rem', borderBottom:'1px solid var(--border)', display:'flex', gap:8, flexShrink:0 }}>
          <div style={{ flex:1, display:'flex', alignItems:'center', gap:8, background:'var(--bg-input)', border:'1px solid var(--border)', borderRadius:8, padding:'0 0.75rem' }}>
            <Search size={14} color="var(--text-muted)" />
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search by TX# or cashier…"
              style={{ flex:1, background:'none', border:'none', color:'var(--text-primary)', fontSize:'0.875rem', padding:'0.5rem 0', outline:'none' }}
            />
          </div>
          {['all','complete','refund','voided'].map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              padding:'0.5rem 0.75rem', borderRadius:8, fontWeight:700, fontSize:'0.72rem',
              background: filter === f ? 'var(--bg-panel)' : 'var(--bg-input)',
              border: `1px solid ${filter === f ? 'var(--border-light)' : 'var(--border)'}`,
              color: filter === f ? 'var(--text-primary)' : 'var(--text-muted)',
              cursor:'pointer', textTransform:'capitalize',
            }}>{f}</button>
          ))}
        </div>

        {/* ── Transaction list ── */}
        <div style={{ flex:1, overflowY:'auto' }}>
          {loading ? (
            <div style={{ padding:'3rem', textAlign:'center', color:'var(--text-muted)', display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
              <RefreshCw size={16} style={{ animation:'spin 0.9s linear infinite' }} /> Loading…
            </div>
          ) : visible.length === 0 ? (
            <div style={{ padding:'3rem', textAlign:'center', color:'var(--text-muted)', fontSize:'0.875rem' }}>
              No transactions found for {date}
            </div>
          ) : visible.map(tx => (
            <div
              key={tx.id}
              style={{ padding:'0.7rem 1.25rem', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:10 }}
            >
              {/* Clickable row → detail panel */}
              <div
                onClick={() => setDetail(tx)}
                style={{ flex:1, minWidth:0, cursor:'pointer', display:'flex', alignItems:'center', gap:10 }}
                onMouseEnter={e => e.currentTarget.parentElement.style.background = 'rgba(255,255,255,.03)'}
                onMouseLeave={e => e.currentTarget.parentElement.style.background = 'transparent'}
              >
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:7, marginBottom:2 }}>
                    <span style={{ fontWeight:800, fontSize:'0.88rem', color:'var(--text-primary)' }}>{tx.txNumber}</span>
                    <span style={{ fontSize:'0.63rem', fontWeight:700, padding:'1px 6px', borderRadius:10, background:`${STATUS_COLOR[tx.status]}20`, color:STATUS_COLOR[tx.status] }}>
                      {tx.status.toUpperCase()}
                    </span>
                  </div>
                  <div style={{ fontSize:'0.7rem', color:'var(--text-muted)' }}>
                    {tx.cashierName} · {fmtDuration(tx.createdAt)} · {(tx.lineItems || []).length} items
                  </div>
                </div>
                <div style={{ textAlign:'right', flexShrink:0 }}>
                  <div style={{ fontWeight:900, fontSize:'0.95rem', color: tx.status === 'voided' ? 'var(--text-muted)' : tx.grandTotal < 0 ? 'var(--amber)' : 'var(--text-primary)', textDecoration: tx.status === 'voided' ? 'line-through' : 'none' }}>
                    {tx.grandTotal < 0 ? '-' : ''}{fmt$(Math.abs(tx.grandTotal))}
                  </div>
                  <div style={{ fontSize:'0.68rem', color:'var(--text-muted)' }}>
                    {(tx.tenderLines || []).map(l => l.method).join(' + ')}
                  </div>
                </div>
                <ChevronRight size={13} color="var(--text-muted)" style={{ flexShrink:0 }} />
              </div>

              {/* Action buttons */}
              <div style={{ display:'flex', gap:5, flexShrink:0 }}>
                {/* View on-screen */}
                {onViewTx && (
                  <button
                    onClick={() => onViewTx(tx)}
                    title="View receipt"
                    style={{
                      display:'flex', alignItems:'center', gap:4,
                      padding:'0.3rem 0.6rem', borderRadius:7,
                      background:'var(--bg-input)', border:'1px solid var(--border)',
                      color:'var(--text-muted)', fontWeight:700, fontSize:'0.7rem',
                      cursor:'pointer', whiteSpace:'nowrap',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor='var(--border-light)'; e.currentTarget.style.color='var(--text-primary)'; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.color='var(--text-muted)'; }}
                  >
                    <Eye size={11} /> View
                  </button>
                )}
                {/* Direct print */}
                {tx.status !== 'voided' && onPrintTx && (
                  <button
                    onClick={() => onPrintTx(tx)}
                    title="Print receipt"
                    style={{
                      display:'flex', alignItems:'center', gap:4,
                      padding:'0.3rem 0.65rem', borderRadius:7,
                      background:'var(--bg-input)', border:'1px solid var(--border)',
                      color:'var(--text-secondary)', fontWeight:700, fontSize:'0.7rem',
                      cursor:'pointer', whiteSpace:'nowrap',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background='rgba(122,193,67,.1)'; e.currentTarget.style.borderColor='rgba(122,193,67,.35)'; e.currentTarget.style.color='var(--green)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background='var(--bg-input)'; e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.color='var(--text-secondary)'; }}
                  >
                    <Printer size={11} /> Print
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* ── Detail panel overlay ── */}
        {detail && (
          <div style={{ position:'absolute', inset:0, background:'var(--bg-panel)', display:'flex', flexDirection:'column', borderRadius:20 }}>
            <div style={{ ...HDR }}>
              <div>
                <div style={{ fontWeight:800, fontSize:'1rem' }}>{detail.txNumber}</div>
                <div style={{ fontSize:'0.72rem', color:'var(--text-muted)' }}>
                  {detail.cashierName} · {new Date(detail.createdAt).toLocaleString()}
                </div>
              </div>
              <div style={{ display:'flex', gap:8 }}>
                {detail.status !== 'voided' && onPrintTx && (
                  <button
                    onClick={() => { onPrintTx(detail); setDetail(null); }}
                    style={{ display:'flex', alignItems:'center', gap:6, padding:'0.45rem 1rem', background:'var(--green)', border:'none', borderRadius:8, color:'#fff', fontWeight:700, fontSize:'0.82rem', cursor:'pointer' }}
                  >
                    <Printer size={14} /> Print Receipt
                  </button>
                )}
                <button onClick={() => setDetail(null)}
                  style={{ background:'none', border:'none', color:'var(--text-muted)', cursor:'pointer', padding:6, display:'flex' }}>
                  <X size={16} />
                </button>
              </div>
            </div>

            <div style={{ flex:1, overflowY:'auto', padding:'1rem 1.25rem' }}>
              {/* Status badge */}
              <div style={{ marginBottom:'0.875rem' }}>
                <span style={{ fontSize:'0.7rem', fontWeight:800, padding:'3px 10px', borderRadius:20, background:`${STATUS_COLOR[detail.status]}20`, color:STATUS_COLOR[detail.status] }}>
                  {detail.status.toUpperCase()}
                </span>
              </div>

              {/* Line items */}
              <div style={{ marginBottom:'1rem' }}>
                <div style={{ fontSize:'0.62rem', fontWeight:700, color:'var(--text-muted)', letterSpacing:'0.06em', marginBottom:6 }}>ITEMS</div>
                {(detail.lineItems || []).map((item, i) => (
                  <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'0.4rem 0', borderBottom:'1px solid var(--border)' }}>
                    <span style={{ fontSize:'0.875rem', color:'var(--text-secondary)' }}>
                      {item.qty > 1 ? `${item.qty}× ` : ''}{item.name}
                    </span>
                    <span style={{ fontWeight:700, fontSize:'0.875rem' }}>{fmt$(item.lineTotal)}</span>
                  </div>
                ))}
              </div>

              {/* Totals card */}
              <div style={{ background:'var(--bg-card)', borderRadius:10, padding:'0.875rem' }}>
                <div style={{ display:'flex', justifyContent:'space-between', padding:'0.3rem 0', borderBottom:'1px solid var(--border)', marginBottom:'0.4rem' }}>
                  <span style={{ fontWeight:800, fontSize:'1rem' }}>Total</span>
                  <span style={{ fontWeight:900, fontSize:'1.1rem', color:'var(--green)' }}>{fmt$(Math.abs(detail.grandTotal))}</span>
                </div>
                {(detail.tenderLines || []).map((l, i) => (
                  <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'0.25rem 0', fontSize:'0.82rem', color:'var(--text-muted)' }}>
                    <span>{l.method.replace('_',' ').toUpperCase()}</span>
                    <span style={{ fontWeight:600 }}>{fmt$(l.amount)}</span>
                  </div>
                ))}
                {detail.changeGiven > 0 && (
                  <div style={{ display:'flex', justifyContent:'space-between', padding:'0.25rem 0', fontSize:'0.82rem', color:'var(--amber)', fontWeight:700 }}>
                    <span>Change Given</span>
                    <span>{fmt$(detail.changeGiven)}</span>
                  </div>
                )}
              </div>

              {detail.notes && (
                <div style={{ marginTop:'0.75rem', padding:'0.75rem', background:'rgba(224,63,63,.06)', border:'1px solid rgba(224,63,63,.2)', borderRadius:8, fontSize:'0.82rem', color:'var(--text-muted)' }}>
                  {detail.notes}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
