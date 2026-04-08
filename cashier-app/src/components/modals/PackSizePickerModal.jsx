/**
 * PackSizePickerModal
 *
 * Appears when a scanned product has multiple pack sizes configured.
 * Cashier taps the appropriate size (Single / 6-Pack / 12-Pack, etc.)
 * and that variant is added to the cart with the correct price and unit count.
 *
 * Props:
 *   product   — the master product (with .packSizes array)
 *   onSelect  — (sizeObj) => void  — called with the chosen pack size
 *   onCancel  — () => void         — called when dismissed without choosing
 */

import React from 'react';
import { X } from 'lucide-react';
import './PackSizePickerModal.css';

export default function PackSizePickerModal({ product, onSelect, onCancel }) {
  if (!product) return null;

  const sizes = product.packSizes ?? [];

  const fmt$ = (v) => {
    const n = parseFloat(v);
    return isNaN(n) ? '—' : '$' + n.toFixed(2);
  };

  return (
    <div className="pspm-overlay" onClick={onCancel}>
      <div className="pspm-modal" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="pspm-header">
          <div>
            <p className="pspm-product-name">{product.name}</p>
            <p className="pspm-subtitle">Select pack size to add to cart</p>
          </div>
          <button
            className="pspm-close-btn"
            onClick={onCancel}
            aria-label="Cancel"
          >
            <X size={16} />
          </button>
        </div>

        {/* Size grid */}
        <div className="pspm-body">
          <div className="pspm-grid">
            {sizes.map(size => (
              <button
                key={size.id}
                className={`pspm-size-btn${size.isDefault ? ' default' : ''}`}
                onClick={() => onSelect(size)}
                autoFocus={size.isDefault}
              >
                <span className="pspm-size-label">{size.label}</span>
                {size.unitCount > 1 && (
                  <span className="pspm-size-units">{size.unitCount} units</span>
                )}
                <span className="pspm-size-price">{fmt$(size.retailPrice)}</span>
                {size.isDefault && (
                  <span className="pspm-size-default-tag">default</span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
