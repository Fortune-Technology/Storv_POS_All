/**
 * LotterySaleModal — light-theme modal for adding lottery sales to the cart.
 * Items are added to the cart (useCartStore.addLotteryItem) so they get
 * tendered together with regular products.
 */

import React, { useState } from 'react';
import { X } from 'lucide-react';
import { useCartStore } from '../../stores/useCartStore.js';

const NUMPAD = ['7','8','9','4','5','6','1','2','3','.','0','⌫'];
const PRESETS = [1, 2, 3, 5, 10, 20];

export default function LotterySaleModal({ open, games = [], onClose }) {
  const addLotteryItem = useCartStore(s => s.addLotteryItem);
  const [selectedGame, setSelectedGame] = useState(null);
  const [display, setDisplay] = useState('0');
  const [added, setAdded] = useState([]);  // { gameName, amount } for preview

  if (!open) return null;

  const handleKey = (key) => {
    setDisplay(prev => {
      if (key === '⌫') return prev.length > 1 ? prev.slice(0, -1) : '0';
      if (key === '.') return prev.includes('.') ? prev : prev + '.';
      if (prev === '0') return key;
      if (prev.includes('.') && prev.split('.')[1].length >= 2) return prev;
      return prev + key;
    });
  };

  const amount = parseFloat(display) || 0;

  const handleAdd = () => {
    if (amount <= 0) return;
    const gameName = selectedGame?.name || 'Lottery';
    addLotteryItem({
      lotteryType: 'sale',
      amount,
      gameId:   selectedGame?.id || null,
      gameName,
    });
    setAdded(a => [...a, { gameName, amount }]);
    setDisplay('0');
  };

  const handleDone = () => {
    setAdded([]);
    setDisplay('0');
    setSelectedGame(null);
    onClose();
  };

  const fmt = (n) => `$${Number(n).toFixed(2)}`;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9000,
      background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(3px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: '#ffffff',
        borderRadius: 20, width: '100%', maxWidth: 480,
        maxHeight: '92vh', overflowY: 'auto',
        boxShadow: '0 24px 80px rgba(0,0,0,0.25)',
        border: '1px solid #e5e7eb',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 20px 12px', borderBottom: '1px solid #f3f4f6' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: '#f0fdf4', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>🎟️</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: '1rem', color: '#111827' }}>Lottery Sale</div>
              <div style={{ fontSize: '0.72rem', color: '#6b7280' }}>Adds to cart · tendered with order</div>
            </div>
          </div>
          <button onClick={handleDone} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', padding: 4 }}><X size={20} /></button>
        </div>

        <div style={{ padding: '16px 20px 20px' }}>
          {/* Game selector */}
          {games.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#6b7280', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>Game (optional)</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {games.map(g => (
                  <button
                    key={g.id}
                    onClick={() => setSelectedGame(selectedGame?.id === g.id ? null : g)}
                    style={{
                      padding: '6px 12px', borderRadius: 8, cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600,
                      border: selectedGame?.id === g.id ? '2px solid #16a34a' : '1.5px solid #e5e7eb',
                      background: selectedGame?.id === g.id ? '#f0fdf4' : '#fff',
                      color: selectedGame?.id === g.id ? '#16a34a' : '#374151',
                      transition: 'all .1s',
                    }}
                  >
                    {g.name}
                    <span style={{ marginLeft: 5, fontSize: '0.68rem', opacity: 0.7 }}>${Number(g.ticketPrice).toFixed(2)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Amount display */}
          <div style={{
            background: '#f9fafb', borderRadius: 12, padding: '14px 18px',
            marginBottom: 10, textAlign: 'right',
            border: '1.5px solid #e5e7eb',
          }}>
            <span style={{ fontSize: '2.2rem', fontWeight: 800, color: '#111827', letterSpacing: '-0.03em' }}>${display}</span>
          </div>

          {/* Quick presets */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6, marginBottom: 10 }}>
            {PRESETS.map(p => (
              <button key={p} onClick={() => setDisplay(String(p))}
                style={{ padding: '7px 0', borderRadius: 8, border: '1.5px solid #e5e7eb', background: '#f9fafb', color: '#374151', fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer' }}>
                ${p}
              </button>
            ))}
          </div>

          {/* Numpad */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 7, marginBottom: 12 }}>
            {NUMPAD.map(k => (
              <button key={k} onClick={() => handleKey(k)} style={{
                padding: '13px 0', borderRadius: 10, fontSize: '1.1rem', fontWeight: 700, cursor: 'pointer',
                border: '1.5px solid #e5e7eb',
                background: k === '⌫' ? '#fff1f2' : '#f9fafb',
                color: k === '⌫' ? '#ef4444' : '#111827',
                transition: 'background .08s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = k === '⌫' ? '#ffe4e6' : '#f3f4f6'; }}
              onMouseLeave={e => { e.currentTarget.style.background = k === '⌫' ? '#fff1f2' : '#f9fafb'; }}
              >{k}</button>
            ))}
          </div>

          {/* Add to cart button */}
          <button onClick={handleAdd} disabled={amount <= 0}
            style={{
              width: '100%', padding: '13px', borderRadius: 12, marginBottom: 10,
              border: 'none', fontSize: '0.95rem', fontWeight: 700, cursor: amount > 0 ? 'pointer' : 'not-allowed',
              background: amount > 0 ? '#16a34a' : '#f3f4f6',
              color: amount > 0 ? '#fff' : '#9ca3af',
              transition: 'background .12s',
            }}>
            Add {selectedGame ? selectedGame.name : 'Lottery'} — {`$${amount.toFixed(2)}`} to Cart
          </button>

          {/* Added items preview */}
          {added.length > 0 && (
            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '10px 14px' }}>
              <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#15803d', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>Added to Cart</div>
              {added.map((a, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: '#166534', padding: '2px 0' }}>
                  <span>🎟️ {a.gameName}</span>
                  <span style={{ fontWeight: 700 }}>${a.amount.toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}

          {/* Done button */}
          {added.length > 0 && (
            <button onClick={handleDone} style={{
              width: '100%', padding: '13px', borderRadius: 12, marginTop: 10,
              border: '2px solid #16a34a', background: '#fff', color: '#16a34a',
              fontSize: '0.95rem', fontWeight: 700, cursor: 'pointer',
            }}>
              Done — {added.length} item{added.length > 1 ? 's' : ''} in cart
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
