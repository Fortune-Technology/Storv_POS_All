/**
 * LotteryModal — combined Sale + Payout in one modal.
 *
 * Tab switcher at top toggles between Sale (green) and Payout (amber).
 * Both types add directly to the cart via useCartStore.addLotteryItem.
 * A shared "Added this session" list shows all items before closing.
 */

import React, { useState } from 'react';
import { X, Ticket } from 'lucide-react';
import { useCartStore } from '../../stores/useCartStore.js';

const NUMPAD   = ['7','8','9','4','5','6','1','2','3','.','0','⌫'];
const SALE_PRESETS   = [1, 2, 3, 5, 10, 20];
const PAYOUT_PRESETS = [5, 10, 20, 50, 100, 200];

function NumKey({ k, onPress }) {
  return (
    <button
      onClick={() => onPress(k)}
      style={{
        padding: '14px 0', borderRadius: 10, fontSize: '1.1rem', fontWeight: 700,
        cursor: 'pointer', border: '1.5px solid #e5e7eb',
        background: k === '⌫' ? '#fff1f2' : '#f9fafb',
        color:      k === '⌫' ? '#ef4444' : '#111827',
        transition: 'background .08s',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = k === '⌫' ? '#ffe4e6' : '#f3f4f6'; }}
      onMouseLeave={e => { e.currentTarget.style.background = k === '⌫' ? '#fff1f2' : '#f9fafb'; }}
    >
      {k}
    </button>
  );
}

export default function LotteryModal({ open, games = [], onClose }) {
  const addLotteryItem = useCartStore(s => s.addLotteryItem);

  const [tab,          setTab]          = useState('sale');    // 'sale' | 'payout'
  const [selectedGame, setSelectedGame] = useState(null);
  const [display,      setDisplay]      = useState('0');
  const [note,         setNote]         = useState('');
  const [added,        setAdded]        = useState([]);        // shared session list
  const [qty,          setQty]          = useState(1);

  if (!open) return null;

  // ── Numpad handler (shared) ─────────────────────────────────────────────────
  const handleKey = (key) => {
    setDisplay(prev => {
      if (key === '⌫') return prev.length > 1 ? prev.slice(0, -1) : '0';
      if (key === '.') return prev.includes('.') ? prev : prev + '.';
      if (prev === '0') return key;
      if (prev.includes('.') && prev.split('.')[1].length >= 2) return prev;
      return prev + key;
    });
  };

  const switchTab = (t) => {
    setTab(t);
    setDisplay('0');
    setNote('');
    setQty(1);
    // keep selectedGame across tabs
  };

  // When a game is selected in sale mode, amount is derived from price × qty
  const saleAmount = selectedGame
    ? Number(selectedGame.ticketPrice) * qty
    : (parseFloat(display) || 0);

  const amount = parseFloat(display) || 0;

  // ── Add handlers ────────────────────────────────────────────────────────────
  const handleAddSale = () => {
    const amt = selectedGame ? Number(selectedGame.ticketPrice) * qty : (parseFloat(display) || 0);
    if (amt <= 0) return;
    const gameName = selectedGame?.name || 'Lottery';
    addLotteryItem({ lotteryType: 'sale', amount: amt, gameId: selectedGame?.id || null, gameName, qty: selectedGame ? qty : 1 });
    setAdded(a => [...a, { type: 'sale', label: `🎟️ ${gameName}${selectedGame ? ` ×${qty}` : ''}`, amount: amt }]);
    setQty(1);
    setDisplay('0');
  };

  const handleAddPayout = () => {
    if (amount <= 0) return;
    addLotteryItem({ lotteryType: 'payout', amount, notes: note.trim() || undefined });
    setAdded(a => [...a, { type: 'payout', label: `💰 Payout${note.trim() ? ' — ' + note.trim() : ''}`, amount }]);
    setDisplay('0');
    setNote('');
  };

  const handleDone = () => {
    setAdded([]);
    setDisplay('0');
    setNote('');
    setSelectedGame(null);
    setQty(1);
    setTab('sale');
    onClose();
  };

  // ── Colors ──────────────────────────────────────────────────────────────────
  const isSale      = tab === 'sale';
  const accent      = isSale ? '#16a34a' : '#d97706';
  const accentLight = isSale ? '#f0fdf4' : '#fffbeb';
  const accentBorder= isSale ? '#bbf7d0' : '#fde68a';
  const accentText  = isSale ? '#15803d' : '#92400e';
  const displayBg   = isSale ? '#f9fafb' : '#fffbeb';
  const displayBorder=isSale ? '#e5e7eb' : '#fde68a';
  const displayColor= isSale ? '#111827' : '#92400e';

  const saleCount   = added.filter(a => a.type === 'sale').length;
  const payoutCount = added.filter(a => a.type === 'payout').length;
  const saleTotal   = added.filter(a => a.type === 'sale').reduce((s, a) => s + a.amount, 0);
  const payoutTotal = added.filter(a => a.type === 'payout').reduce((s, a) => s + a.amount, 0);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9000,
      background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(3px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '12px',
    }}>
      <div style={{
        background: '#ffffff', borderRadius: 20,
        width: '100%', maxWidth: 500,
        maxHeight: '96vh', overflowY: 'auto',
        boxShadow: '0 24px 80px rgba(0,0,0,0.25)',
        border: '1px solid #e5e7eb',
        display: 'flex', flexDirection: 'column',
      }}>

        {/* ── Header ── */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px 12px', borderBottom: '1px solid #f3f4f6', flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10,
              background: '#f0fdf4', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Ticket size={18} color="#16a34a" />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: '1rem', color: '#111827' }}>Lottery</div>
              <div style={{ fontSize: '0.7rem', color: '#6b7280' }}>Adds to cart · tendered with order</div>
            </div>
          </div>
          <button onClick={handleDone} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', padding: 4 }}>
            <X size={20} />
          </button>
        </div>

        {/* ── Tab switcher ── */}
        <div style={{ display: 'flex', padding: '10px 20px 0', gap: 8, flexShrink: 0 }}>
          {[
            { id: 'sale',   label: '🎟️  Sale',   desc: 'Customer buys ticket' },
            { id: 'payout', label: '💰  Payout', desc: 'Pay winning customer'  },
          ].map(t => (
            <button key={t.id} onClick={() => switchTab(t.id)} style={{
              flex: 1, padding: '10px 14px', borderRadius: 12, cursor: 'pointer',
              border: tab === t.id
                ? `2px solid ${t.id === 'sale' ? '#16a34a' : '#d97706'}`
                : '2px solid #e5e7eb',
              background: tab === t.id
                ? (t.id === 'sale' ? '#f0fdf4' : '#fffbeb')
                : '#f9fafb',
              color: tab === t.id
                ? (t.id === 'sale' ? '#15803d' : '#92400e')
                : '#6b7280',
              fontWeight: tab === t.id ? 700 : 500,
              fontSize: '0.88rem', transition: 'all .12s',
              textAlign: 'center',
            }}>
              <div>{t.label}</div>
              <div style={{ fontSize: '0.68rem', opacity: 0.75, marginTop: 2 }}>{t.desc}</div>
            </button>
          ))}
        </div>

        {/* ── Body ── */}
        <div style={{ padding: '14px 20px 20px', flex: 1 }}>

          {/* Game selector — only for sales */}
          {tab === 'sale' && games.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#6b7280', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 7 }}>Select Game</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {games.map(g => (
                  <button key={g.id} onClick={() => { setSelectedGame(selectedGame?.id === g.id ? null : g); setQty(1); setDisplay('0'); }} style={{
                    padding: '6px 11px', borderRadius: 8, cursor: 'pointer', fontSize: '0.79rem', fontWeight: 600,
                    border: selectedGame?.id === g.id ? '2px solid #16a34a' : '1.5px solid #e5e7eb',
                    background: selectedGame?.id === g.id ? '#f0fdf4' : '#fff',
                    color: selectedGame?.id === g.id ? '#16a34a' : '#374151',
                    transition: 'all .1s',
                  }}>
                    {g.name}
                    <span style={{ marginLeft: 5, fontSize: '0.67rem', opacity: 0.65 }}>${Number(g.ticketPrice).toFixed(2)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Sale tab: quantity mode when game selected; freeform numpad otherwise */}
          {tab === 'sale' && selectedGame ? (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: '0.7rem', color: '#6b7280', marginBottom: 4 }}>{selectedGame.name} — ${Number(selectedGame.ticketPrice).toFixed(2)} each</div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginBottom: 12 }}>
                <button onClick={() => setQty(q => Math.max(1, q - 1))} style={{ width: 44, height: 44, borderRadius: 10, border: '1.5px solid #e5e7eb', background: '#f9fafb', fontSize: '1.4rem', fontWeight: 700, cursor: 'pointer' }}>−</button>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '2rem', fontWeight: 800, color: '#111827' }}>{qty}</div>
                  <div style={{ fontSize: '0.72rem', color: '#6b7280' }}>tickets</div>
                </div>
                <button onClick={() => setQty(q => q + 1)} style={{ width: 44, height: 44, borderRadius: 10, border: '1.5px solid #e5e7eb', background: '#f9fafb', fontSize: '1.4rem', fontWeight: 700, cursor: 'pointer' }}>+</button>
              </div>
              <div style={{ background: '#f0fdf4', border: '1.5px solid #bbf7d0', borderRadius: 10, padding: '10px 16px', textAlign: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: '0.8rem', color: '#6b7280' }}>{qty} × ${Number(selectedGame.ticketPrice).toFixed(2)} = </span>
                <span style={{ fontSize: '1.6rem', fontWeight: 800, color: '#16a34a' }}>${saleAmount.toFixed(2)}</span>
              </div>
              {/* Quick qty presets */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 5, marginTop: 8 }}>
                {[1,2,3,5,10].map(n => (
                  <button key={n} onClick={() => setQty(n)} style={{ padding: '7px 0', borderRadius: 8, border: qty === n ? '2px solid #16a34a' : '1.5px solid #e5e7eb', background: qty === n ? '#f0fdf4' : '#f9fafb', color: qty === n ? '#16a34a' : '#374151', fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer' }}>{n}</button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {/* Amount display (freeform — sale without game, or payout) */}
              <div style={{
                background: displayBg, borderRadius: 12, padding: '12px 16px',
                marginBottom: 9, textAlign: 'right', border: `1.5px solid ${displayBorder}`,
              }}>
                <div style={{ fontSize: '0.68rem', fontWeight: 600, color: displayColor, opacity: 0.6, marginBottom: 2, textAlign: 'left' }}>
                  {isSale ? 'Lottery Sale Amount' : 'Payout Amount'}
                </div>
                <span style={{ fontSize: '2rem', fontWeight: 800, color: displayColor, letterSpacing: '-0.03em' }}>
                  ${display}
                </span>
              </div>

              {/* Presets */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 5, marginBottom: 8 }}>
                {(isSale ? SALE_PRESETS : PAYOUT_PRESETS).map(p => (
                  <button key={p} onClick={() => setDisplay(String(p))} style={{
                    padding: '7px 0', borderRadius: 8, fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer',
                    border: `1.5px solid ${displayBorder}`, background: displayBg, color: accentText,
                  }}>
                    ${p}
                  </button>
                ))}
              </div>

              {/* Numpad */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginBottom: 10 }}>
                {NUMPAD.map(k => <NumKey key={k} k={k} onPress={handleKey} />)}
              </div>
            </>
          )}

          {/* Payout note field */}
          {tab === 'payout' && (
            <input
              type="text"
              placeholder="Note — e.g. ticket #12345 (optional)"
              value={note}
              onChange={e => setNote(e.target.value)}
              style={{
                width: '100%', padding: '9px 12px', borderRadius: 8, marginBottom: 9,
                border: '1.5px solid #e5e7eb', background: '#f9fafb',
                color: '#111827', fontSize: '0.87rem', boxSizing: 'border-box',
              }}
            />
          )}

          {/* Add button */}
          {(() => {
            const btnAmt = isSale ? saleAmount : amount;
            const isDisabled = btnAmt <= 0;
            return (
              <button
                onClick={isSale ? handleAddSale : handleAddPayout}
                disabled={isDisabled}
                style={{
                  width: '100%', padding: '13px', borderRadius: 12, marginBottom: 12,
                  border: 'none', fontSize: '0.95rem', fontWeight: 700,
                  cursor: isDisabled ? 'not-allowed' : 'pointer',
                  background: isDisabled ? '#f3f4f6' : accent,
                  color: isDisabled ? '#9ca3af' : '#fff',
                  transition: 'background .12s',
                }}
              >
                {tab === 'sale' && selectedGame
                  ? `Add ${qty} × ${selectedGame.name} — $${saleAmount.toFixed(2)}`
                  : tab === 'sale'
                    ? `Add Lottery Sale — $${(parseFloat(display) || 0).toFixed(2)}`
                    : `Add Payout — $${amount.toFixed(2)}`
                }
              </button>
            );
          })()}

          {/* ── Shared session summary ── */}
          {added.length > 0 && (
            <div style={{
              background: '#f9fafb', border: '1px solid #e5e7eb',
              borderRadius: 12, padding: '12px 14px', marginBottom: 10,
            }}>
              <div style={{ fontSize: '0.67rem', fontWeight: 700, color: '#6b7280', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
                Added to Cart ({added.length} item{added.length !== 1 ? 's' : ''})
              </div>

              {added.map((a, i) => (
                <div key={i} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '4px 0',
                  borderBottom: i < added.length - 1 ? '1px solid #f3f4f6' : 'none',
                }}>
                  <span style={{ fontSize: '0.85rem', color: '#374151' }}>{a.label}</span>
                  <span style={{
                    fontSize: '0.88rem', fontWeight: 700,
                    color: a.type === 'sale' ? '#16a34a' : '#d97706',
                  }}>
                    {a.type === 'payout' ? '-' : '+'}${a.amount.toFixed(2)}
                  </span>
                </div>
              ))}

              {/* Mini totals row */}
              <div style={{
                display: 'flex', gap: 12, marginTop: 8, paddingTop: 8,
                borderTop: '1px solid #e5e7eb', fontSize: '0.78rem',
              }}>
                {saleCount > 0 && (
                  <span style={{ color: '#15803d', fontWeight: 700 }}>
                    🎟️ {saleCount} sale{saleCount !== 1 ? 's' : ''} · +${saleTotal.toFixed(2)}
                  </span>
                )}
                {payoutCount > 0 && (
                  <span style={{ color: '#b45309', fontWeight: 700 }}>
                    💰 {payoutCount} payout{payoutCount !== 1 ? 's' : ''} · -${payoutTotal.toFixed(2)}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Done button */}
          <button onClick={handleDone} style={{
            width: '100%', padding: '13px', borderRadius: 12,
            border: added.length > 0 ? '2px solid #16a34a' : '2px solid #e5e7eb',
            background: '#fff',
            color: added.length > 0 ? '#16a34a' : '#9ca3af',
            fontSize: '0.95rem', fontWeight: 700, cursor: 'pointer',
            transition: 'all .12s',
          }}>
            {added.length > 0 ? `Done — ${added.length} item${added.length !== 1 ? 's' : ''} in cart` : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
}
