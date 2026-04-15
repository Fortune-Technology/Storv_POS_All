/**
 * OpenItemModal — Ring up a custom item by entering a name + amount.
 *
 * Used when a cashier needs to sell something that isn't in the catalog:
 *   - One-off items
 *   - Deli / counter-made items
 *   - Misc adjustments
 *
 * The item gets added to the cart like any normal product but with isOpenItem=true.
 */

import React, { useState, useEffect, useRef } from 'react';
import { X, Edit3, DollarSign, Check } from 'lucide-react';
import { useCartStore } from '../../stores/useCartStore.js';
import './OpenItemModal.css';

const TAX_CLASSES = [
  { value: 'grocery',     label: 'Grocery (food)' },
  { value: 'standard',    label: 'Standard tax' },
  { value: 'alcohol',     label: 'Alcohol' },
  { value: 'tobacco',     label: 'Tobacco' },
  { value: 'hot_food',    label: 'Hot Food' },
  { value: 'non_taxable', label: 'Non-Taxable' },
];

const QUICK_AMOUNTS = [1, 2, 5, 10, 20];

export default function OpenItemModal({ onClose }) {
  const addOpenItem = useCartStore(s => s.addOpenItem);

  const [name,     setName]     = useState('');
  const [amount,   setAmount]   = useState('0.00');
  const [taxClass, setTaxClass] = useState('standard');
  const [taxable,  setTaxable]  = useState(true);
  const nameRef = useRef(null);

  useEffect(() => { nameRef.current?.focus(); }, []);

  const displayVal = parseFloat(amount) || 0;
  const canAdd = name.trim().length > 0 && displayVal > 0;

  // Numpad handler
  const handleKey = (key) => {
    setAmount(prev => {
      if (key === '⌫') {
        if (prev.length <= 1) return '0';
        return prev.slice(0, -1);
      }
      if (key === '.') {
        return prev.includes('.') ? prev : prev + '.';
      }
      if (prev === '0') return key;
      if (prev.includes('.') && prev.split('.')[1].length >= 2) return prev;
      return prev + key;
    });
  };

  const handleClear = () => setAmount('0.00');

  const handleAdd = () => {
    if (!canAdd) return;
    addOpenItem({
      name: name.trim(),
      price: displayVal,
      taxClass,
      taxable,
    });
    onClose();
  };

  const NUMPAD = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '.', '0', '⌫'];

  return (
    <div className="oim-overlay" onClick={onClose}>
      <div className="oim-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="oim-header">
          <div className="oim-header-title">
            <Edit3 size={16} /> Open Item / Manual Entry
          </div>
          <button className="oim-close" onClick={onClose}><X size={16} /></button>
        </div>

        {/* Body */}
        <div className="oim-body">
          {/* Name */}
          <div className="oim-field">
            <label className="oim-label">Item Name</label>
            <input
              ref={nameRef}
              className="oim-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Coffee, Deli Sandwich, Service Fee"
              onKeyDown={(e) => { if (e.key === 'Enter') nameRef.current?.blur(); }}
            />
          </div>

          {/* Amount Display */}
          <div className="oim-amount-display">
            <div className="oim-amount-label">Amount</div>
            <div className="oim-amount-value">
              <span className="oim-dollar">$</span>
              {displayVal.toFixed(2)}
            </div>
          </div>

          {/* Quick amounts */}
          <div className="oim-quick-row">
            {QUICK_AMOUNTS.map(n => (
              <button key={n} className="oim-quick-btn" onClick={() => setAmount(String(n))}>
                ${n}
              </button>
            ))}
            <button className="oim-quick-btn oim-clear-btn" onClick={handleClear}>
              Clear
            </button>
          </div>

          {/* Numpad */}
          <div className="oim-numpad">
            {NUMPAD.map(k => (
              <button key={k} className="oim-num-btn" onClick={() => handleKey(k)}>
                {k}
              </button>
            ))}
          </div>

          {/* Tax settings */}
          <div className="oim-tax-row">
            <div className="oim-field">
              <label className="oim-label">Tax Class</label>
              <select className="oim-input" value={taxClass} onChange={(e) => setTaxClass(e.target.value)}>
                {TAX_CLASSES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <label className="oim-toggle">
              <input type="checkbox" checked={taxable} onChange={(e) => setTaxable(e.target.checked)} />
              Taxable
            </label>
          </div>
        </div>

        {/* Footer */}
        <div className="oim-footer">
          <button className="oim-btn oim-btn-cancel" onClick={onClose}>Cancel</button>
          <button className="oim-btn oim-btn-add" onClick={handleAdd} disabled={!canAdd}>
            <Check size={14} /> Add to Cart
          </button>
        </div>
      </div>
    </div>
  );
}
