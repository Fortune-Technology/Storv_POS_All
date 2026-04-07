/**
 * BottleRedemptionModal
 * Adds bottle/can deposit returns as negative line items to the active cart.
 * The cashier then tenders the cart normally — cash drawer opens at tender time.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Recycle, Check, AlertCircle, Delete } from 'lucide-react';
import { X } from 'lucide-react';
import { getDepositRules } from '../../api/pos.js';
import { useCartStore }    from '../../stores/useCartStore.js';
import { fmt$ }            from '../../utils/formatters.js';
import './BottleRedemptionModal.css';

const NUMPAD_KEYS = ['7','8','9','C','4','5','6','⌫','1','2','3','','0',''];

function buildQty(current, key) {
  if (key === 'C') return 0;
  if (key === '⌫') return Math.floor(current / 10);
  if (key === '') return current;
  const digit = parseInt(key);
  if (isNaN(digit)) return current;
  const next = current * 10 + digit;
  return next > 9999 ? current : next;
}

export default function BottleRedemptionModal({ onClose, onComplete }) {
  const addBottleReturnItems = useCartStore(s => s.addBottleReturnItems);

  const [rules,    setRules]    = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [counts,   setCounts]   = useState({});
  const [activeId, setActiveId] = useState(null);
  const [added,    setAdded]    = useState(false);
  const [error,    setError]    = useState('');

  useEffect(() => {
    getDepositRules()
      .then(r => {
        const list = Array.isArray(r) ? r : (r?.data || r?.rules || []);
        const active = list.filter(rule => rule.active !== false);
        setRules(active);
        if (active.length > 0) setActiveId(active[0].id);
      })
      .catch(() => setRules([]))
      .finally(() => setLoading(false));
  }, []);

  const handleNumKey = useCallback((key) => {
    if (!activeId) return;
    setCounts(prev => ({
      ...prev,
      [activeId]: buildQty(prev[activeId] || 0, key),
    }));
  }, [activeId]);

  const lineItems = rules
    .map(r => ({ rule: r, qty: counts[r.id] || 0, lineTotal: (counts[r.id] || 0) * Number(r.depositAmount) }))
    .filter(l => l.qty > 0);

  const grandTotal = lineItems.reduce((s, l) => s + l.lineTotal, 0);

  const handleAddToCart = () => {
    if (!grandTotal) { setError('Select at least one bottle type with a quantity.'); return; }
    setError('');
    addBottleReturnItems(lineItems);
    setAdded(true);
    setTimeout(() => {
      onComplete?.();
      onClose();
    }, 900);
  };

  const activeRule = rules.find(r => r.id === activeId);

  return (
    <div className="brm-backdrop">
      <div className="brm-modal">

        {/* Header */}
        <div className="brm-header">
          <div className="brm-header-left">
            <Recycle size={18} color="#34d399" />
            <div>
              <h2>Bottle Return</h2>
              <p>Tap a container type, then enter count</p>
            </div>
          </div>
          <button className="brm-close-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {/* Two-column: LEFT = rule list, RIGHT = numpad */}
        <div className="brm-content">

          {/* LEFT: Bottle list */}
          <div className="brm-left-col">
            {loading ? (
              <div className="brm-loading">Loading deposit rules…</div>
            ) : rules.length === 0 ? (
              <div className="brm-empty">
                <AlertCircle size={28} style={{ opacity: 0.4 }} />
                No deposit rules configured.
                <span style={{ fontSize: '0.75rem' }}>Set them up in Back Office → Deposit Rules.</span>
              </div>
            ) : (
              rules.map(rule => {
                const qty = counts[rule.id] || 0;
                const lineTotal = qty * Number(rule.depositAmount);
                const isActive = rule.id === activeId;
                return (
                  <div
                    key={rule.id}
                    className={`brm-rule-row${isActive ? ' brm-rule-row--active' : ''}`}
                    onClick={() => setActiveId(rule.id)}
                  >
                    <div className="brm-rule-info">
                      <div className="brm-rule-name">{rule.name}</div>
                      <div className="brm-rule-meta">
                        {fmt$(rule.depositAmount)} each
                        {rule.containerTypes ? ` · ${rule.containerTypes.replace(/,/g, ', ')}` : ''}
                        {rule.state ? ` · ${rule.state}` : ''}
                      </div>
                    </div>
                    <div className="brm-rule-qty">{qty > 0 ? qty : '—'}</div>
                    <div className={`brm-rule-total${qty === 0 ? ' brm-rule-total--zero' : ''}`}>
                      {qty > 0 ? fmt$(lineTotal) : '—'}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* RIGHT: numpad + summary */}
          <div className="brm-right-col">
            {/* Qty display */}
            <div className="brm-numpad-display">
              <span className="brm-numpad-label">
                {activeRule ? activeRule.name : 'Select a type'}
              </span>
              <span className="brm-numpad-value">
                {counts[activeId] || 0}
              </span>
            </div>

            {/* Numpad */}
            <div className="brm-numpad-grid">
              {NUMPAD_KEYS.map((k, i) => (
                <button
                  key={i}
                  className={`brm-nkey${k === 'C' ? ' brm-nkey--clear' : ''}${k === '⌫' ? ' brm-nkey--back' : ''}`}
                  onClick={() => k && handleNumKey(k)}
                  disabled={!k || !activeId}
                  style={!k ? { visibility: 'hidden' } : {}}
                >
                  {k === '⌫' ? <Delete size={16} /> : k}
                </button>
              ))}
            </div>

            {/* Summary */}
            {lineItems.length > 0 && (
              <div className="brm-summary">
                {lineItems.map(l => (
                  <div key={l.rule.id} className="brm-line-item">
                    <span>{l.qty} × {l.rule.name}</span>
                    <span>-{fmt$(l.lineTotal)}</span>
                  </div>
                ))}
                <div className="brm-total-row">
                  <span>REFUND DUE</span>
                  <span>-{fmt$(grandTotal)}</span>
                </div>
              </div>
            )}

            {/* Error */}
            {error && <div className="brm-error">{error}</div>}
          </div>
        </div>

        {/* Footer */}
        <div className="brm-footer">
          <button className="brm-btn-cancel" onClick={onClose}>Cancel</button>
          <button
            className={`brm-btn-submit${added ? ' brm-btn-submit--success' : grandTotal ? ' brm-btn-submit--active' : ' brm-btn-submit--disabled'}`}
            onClick={handleAddToCart}
            disabled={added || !grandTotal}
          >
            {added
              ? <><Check size={16} /> Added to Cart!</>
              : `Add to Cart ${grandTotal ? `(-${fmt$(grandTotal)})` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
