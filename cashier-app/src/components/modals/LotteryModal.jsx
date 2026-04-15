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
import { digitsToDisplay, digitsToNumber } from '../pos/NumPadInline.jsx';
import './LotteryModal.css';

const NUMPAD   = ['7','8','9','4','5','6','1','2','3','C','0','⌫'];
const MAX_DIGITS = 7;
const SALE_PRESETS   = [1, 2, 3, 5, 10, 20];
const PAYOUT_PRESETS = [5, 10, 20, 50, 100, 200];

export default function LotteryModal({ open, games = [], onClose }) {
  const addLotteryItem = useCartStore(s => s.addLotteryItem);

  const [tab,          setTab]          = useState('sale');    // 'sale' | 'payout'
  const [selectedGame, setSelectedGame] = useState(null);
  // Cent-based digit buffer (matches TenderModal / VendorPayoutModal).
  // "587" -> "$5.87". Empty string == $0.00.
  const [display,      setDisplay]      = useState('');
  const [note,         setNote]         = useState('');
  const [added,        setAdded]        = useState([]);        // shared session list
  const [qty,          setQty]          = useState(1);

  if (!open) return null;

  // ── Numpad handler (cent-based) ────────────────────────────────────────────
  const handleKey = (key) => {
    setDisplay(prev => {
      if (key === 'C')  return '';
      if (key === '⌫') return prev.slice(0, -1);
      if (key === '.') return prev;                // legacy no-op
      if (prev.length >= MAX_DIGITS) return prev;
      if (prev === '' && key === '0') return '';   // ignore leading zero
      return prev + key;
    });
  };

  const switchTab = (t) => {
    setTab(t);
    setDisplay('');
    setNote('');
    setQty(1);
  };

  const amount = digitsToNumber(display, 2);
  const saleAmount = selectedGame
    ? Number(selectedGame.ticketPrice) * qty
    : amount;

  // ── Add handlers ────────────────────────────────────────────────────────────
  const handleAddSale = () => {
    const amt = selectedGame ? Number(selectedGame.ticketPrice) * qty : amount;
    if (amt <= 0) return;
    const gameName = selectedGame?.name || 'Lottery';
    addLotteryItem({ lotteryType: 'sale', amount: amt, gameId: selectedGame?.id || null, gameName, qty: selectedGame ? qty : 1 });
    setAdded(a => [...a, { type: 'sale', label: `Sale: ${gameName}${selectedGame ? ` x${qty}` : ''}`, amount: amt }]);
    setQty(1);
    setDisplay('');
  };

  const handleAddPayout = () => {
    if (amount <= 0) return;
    addLotteryItem({ lotteryType: 'payout', amount, notes: note.trim() || undefined });
    setAdded(a => [...a, { type: 'payout', label: `Payout${note.trim() ? ' — ' + note.trim() : ''}`, amount }]);
    setDisplay('');
    setNote('');
  };

  const handleDone = () => {
    setAdded([]);
    setDisplay('');
    setNote('');
    setSelectedGame(null);
    setQty(1);
    setTab('sale');
    onClose();
  };

  const isSale = tab === 'sale';

  const saleCount   = added.filter(a => a.type === 'sale').length;
  const payoutCount = added.filter(a => a.type === 'payout').length;
  const saleTotal   = added.filter(a => a.type === 'sale').reduce((s, a) => s + a.amount, 0);
  const payoutTotal = added.filter(a => a.type === 'payout').reduce((s, a) => s + a.amount, 0);

  return (
    <div className="lm-backdrop">
      <div className="lm-modal">

        {/* ── Header ── */}
        <div className="lm-header">
          <div className="lm-header-left">
            <div className="lm-header-icon">
              <Ticket size={18} color="#16a34a" />
            </div>
            <div>
              <div className="lm-header-title">Lottery</div>
              <div className="lm-header-sub">Adds to cart - tendered with order</div>
            </div>
          </div>
          <button className="lm-close-btn" onClick={handleDone}>
            <X size={20} />
          </button>
        </div>

        {/* ── Tab switcher ── */}
        <div className="lm-tabs">
          {[
            { id: 'sale',   label: 'Sale',   desc: 'Customer buys ticket' },
            { id: 'payout', label: 'Payout', desc: 'Pay winning customer'  },
          ].map(t => (
            <button
              key={t.id}
              className={`lm-tab${tab === t.id ? (t.id === 'sale' ? ' lm-tab--active-sale' : ' lm-tab--active-payout') : ''}`}
              onClick={() => switchTab(t.id)}
            >
              <div>{t.label}</div>
              <div className="lm-tab-desc">{t.desc}</div>
            </button>
          ))}
        </div>

        {/* ── Body ── */}
        <div className="lm-body">

          {/* Game selector — only for sales */}
          {tab === 'sale' && games.length > 0 && (
            <div>
              <div className="lm-section-label">Select Game</div>
              <div className="lm-games">
                {games.map(g => (
                  <button
                    key={g.id}
                    className={`lm-game-btn${selectedGame?.id === g.id ? ' lm-game-btn--active' : ''}`}
                    onClick={() => { setSelectedGame(selectedGame?.id === g.id ? null : g); setQty(1); setDisplay('0'); }}
                  >
                    {g.name}
                    <span className="lm-game-price">${Number(g.ticketPrice).toFixed(2)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Sale tab: quantity mode when game selected; freeform numpad otherwise */}
          {tab === 'sale' && selectedGame ? (
            <div>
              <div className="lm-qty-info">{selectedGame.name} — ${Number(selectedGame.ticketPrice).toFixed(2)} each</div>
              <div className="lm-qty-row">
                <button className="lm-qty-btn" onClick={() => setQty(q => Math.max(1, q - 1))}>-</button>
                <div>
                  <div className="lm-qty-value">{qty}</div>
                  <div className="lm-qty-label">tickets</div>
                </div>
                <button className="lm-qty-btn" onClick={() => setQty(q => q + 1)}>+</button>
              </div>
              <div className="lm-qty-total-box">
                <span className="lm-qty-total-label">{qty} x ${Number(selectedGame.ticketPrice).toFixed(2)} = </span>
                <span className="lm-qty-total-value">${saleAmount.toFixed(2)}</span>
              </div>
              <div className="lm-qty-presets">
                {[1,2,3,5,10].map(n => (
                  <button
                    key={n}
                    className={`lm-qty-preset${qty === n ? ' lm-qty-preset--active' : ''}`}
                    onClick={() => setQty(n)}
                  >{n}</button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {/* Amount display (freeform — sale without game, or payout) */}
              <div className={`lm-display${isSale ? ' lm-display--sale' : ' lm-display--payout'}`}>
                <div className={`lm-display-label${isSale ? ' lm-display-label--sale' : ' lm-display-label--payout'}`}>
                  {isSale ? 'Lottery Sale Amount' : 'Payout Amount'}
                </div>
                <span className={`lm-display-value${isSale ? ' lm-display-value--sale' : ' lm-display-value--payout'}`}>
                  ${digitsToDisplay(display, 2)}
                </span>
              </div>

              {/* Presets */}
              <div className="lm-presets">
                {(isSale ? SALE_PRESETS : PAYOUT_PRESETS).map(p => (
                  <button
                    key={p}
                    className={`lm-preset-btn${isSale ? ' lm-preset-btn--sale' : ' lm-preset-btn--payout'}`}
                    onClick={() => setDisplay(String(p))}
                  >
                    ${p}
                  </button>
                ))}
              </div>

              {/* Numpad */}
              <div className="lm-numpad">
                {NUMPAD.map(k => (
                  <button
                    key={k}
                    className={`lm-numkey${k === '⌫' ? ' lm-numkey--backspace' : ''}`}
                    onClick={() => handleKey(k)}
                  >
                    {k}
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Payout note field */}
          {tab === 'payout' && (
            <input
              type="text"
              className="lm-note-input"
              placeholder="Note — e.g. ticket #12345 (optional)"
              value={note}
              onChange={e => setNote(e.target.value)}
            />
          )}

          {/* Add button */}
          {(() => {
            const btnAmt = isSale ? saleAmount : amount;
            const isDisabled = btnAmt <= 0;
            return (
              <button
                className={`lm-add-btn${isDisabled ? ' lm-add-btn--disabled' : ` lm-add-btn--active${isSale ? ' lm-add-btn--sale' : ' lm-add-btn--payout'}`}`}
                onClick={isSale ? handleAddSale : handleAddPayout}
                disabled={isDisabled}
              >
                {tab === 'sale' && selectedGame
                  ? `Add ${qty} x ${selectedGame.name} — $${saleAmount.toFixed(2)}`
                  : tab === 'sale'
                    ? `Add Lottery Sale — $${amount.toFixed(2)}`
                    : `Add Payout — $${amount.toFixed(2)}`
                }
              </button>
            );
          })()}

          {/* ── Shared session summary ── */}
          {added.length > 0 && (
            <div className="lm-session">
              <div className="lm-session-label">
                Added to Cart ({added.length} item{added.length !== 1 ? 's' : ''})
              </div>

              {added.map((a, i) => (
                <div key={i} className="lm-session-item">
                  <span className="lm-session-item-label">{a.label}</span>
                  <span className={`lm-session-item-amount${a.type === 'sale' ? ' lm-session-item-amount--sale' : ' lm-session-item-amount--payout'}`}>
                    {a.type === 'payout' ? '-' : '+'}${a.amount.toFixed(2)}
                  </span>
                </div>
              ))}

              <div className="lm-session-totals">
                {saleCount > 0 && (
                  <span className="lm-session-totals-sale">
                    {saleCount} sale{saleCount !== 1 ? 's' : ''} - +${saleTotal.toFixed(2)}
                  </span>
                )}
                {payoutCount > 0 && (
                  <span className="lm-session-totals-payout">
                    {payoutCount} payout{payoutCount !== 1 ? 's' : ''} - -${payoutTotal.toFixed(2)}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Done button */}
          <button
            className={`lm-done-btn${added.length > 0 ? ' lm-done-btn--has-items' : ''}`}
            onClick={handleDone}
          >
            {added.length > 0 ? `Done — ${added.length} item${added.length !== 1 ? 's' : ''} in cart` : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
}
