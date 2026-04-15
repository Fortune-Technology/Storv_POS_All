/**
 * ProductEditModal — Quick product detail view + edit from cart.
 * Shows UPC, department, tax class, pricing. Manager can edit name/price.
 */

import React, { useState } from 'react';
import {
  X, Package, Tag, DollarSign, Barcode, Save, Loader,
  ShoppingCart, Percent, Leaf, Printer,
} from 'lucide-react';
import { fmt$ } from '../../utils/formatters.js';
import { useCartStore } from '../../stores/useCartStore.js';
import { toast } from 'react-toastify';
import api from '../../api/client.js';
import './ProductEditModal.css';

export default function ProductEditModal({ item, onClose, hasLabelPrinter, onPrintLabel }) {
  const overridePrice = useCartStore(s => s.overridePrice);

  const [editName, setEditName] = useState(item.name || '');
  const [editPrice, setEditPrice] = useState(String(item.unitPrice || ''));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [printing, setPrinting] = useState(false);

  const handlePrintLabel = async () => {
    if (!onPrintLabel) return;
    setPrinting(true);
    try {
      await onPrintLabel({
        name: editName || item.name,
        upc: item.upc,
        defaultRetailPrice: parseFloat(editPrice) || item.unitPrice,
        size: item.size,
        sizeUnit: item.sizeUnit,
      });
      toast.success('Label sent to printer');
    } catch (err) {
      toast.error('Print failed: ' + (err.message || 'unknown error'));
    } finally {
      setPrinting(false);
    }
  };

  const hasNameChange = editName.trim() !== (item.name || '');
  const hasPriceChange = editPrice !== String(item.unitPrice || '');
  const hasChanges = hasNameChange || hasPriceChange;

  const handleSave = async () => {
    setSaving(true);
    try {
      const updates = {};
      if (hasNameChange) updates.name = editName.trim();
      if (hasPriceChange) updates.defaultRetailPrice = parseFloat(editPrice);

      // Update in catalog (backend)
      if (item.productId && Object.keys(updates).length > 0) {
        await api.put(`/catalog/products/${item.productId}`, updates).catch(() => {});
      }

      // Update price in cart immediately
      if (hasPriceChange) {
        overridePrice(item.lineId, parseFloat(editPrice));
      }

      setSaved(true);
      setTimeout(() => onClose(), 600);
    } catch {
      // Silently fail catalog update — cart price still overridden
      if (hasPriceChange) overridePrice(item.lineId, parseFloat(editPrice));
      setSaved(true);
      setTimeout(() => onClose(), 600);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="pem-overlay" onClick={onClose}>
      <div className="pem-modal" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="pem-header">
          <Package size={16} color="var(--green)" />
          <span className="pem-header-title">Product Details</span>
          <button className="pem-close" onClick={onClose}><X size={16} /></button>
        </div>

        {/* Product info */}
        <div className="pem-body">
          {/* UPC */}
          {item.upc && (
            <div className="pem-field">
              <div className="pem-field-label"><Barcode size={12} /> UPC</div>
              <div className="pem-upc">{item.upc}</div>
            </div>
          )}

          {/* Name (editable) */}
          <div className="pem-field">
            <div className="pem-field-label"><Tag size={12} /> Product Name</div>
            <input
              className="pem-input"
              value={editName}
              onChange={e => setEditName(e.target.value)}
            />
          </div>

          {/* Price (editable) */}
          <div className="pem-field">
            <div className="pem-field-label"><DollarSign size={12} /> Unit Price</div>
            <div className="pem-price-row">
              <span className="pem-dollar">$</span>
              <input
                className="pem-input pem-input-price"
                type="number"
                step="0.01"
                min="0"
                value={editPrice}
                onChange={e => setEditPrice(e.target.value)}
              />
            </div>
          </div>

          {/* Read-only details */}
          <div className="pem-details-grid">
            <div className="pem-detail">
              <span className="pem-detail-label">Qty in Cart</span>
              <span className="pem-detail-value">{item.qty}</span>
            </div>
            <div className="pem-detail">
              <span className="pem-detail-label">Line Total</span>
              <span className="pem-detail-value pem-detail-value--green">{fmt$(item.lineTotal)}</span>
            </div>
            <div className="pem-detail">
              <span className="pem-detail-label">Tax Class</span>
              <span className="pem-detail-value">{item.taxClass || 'grocery'}</span>
            </div>
            <div className="pem-detail">
              <span className="pem-detail-label">Taxable</span>
              <span className="pem-detail-value">{item.taxable !== false ? 'Yes' : 'No'}</span>
            </div>
            {item.ebtEligible && (
              <div className="pem-detail">
                <span className="pem-detail-label"><Leaf size={10} /> EBT</span>
                <span className="pem-detail-value pem-detail-value--green">Eligible</span>
              </div>
            )}
            {item.depositAmount > 0 && (
              <div className="pem-detail">
                <span className="pem-detail-label">Deposit</span>
                <span className="pem-detail-value">{fmt$(item.depositAmount)} /ea</span>
              </div>
            )}
            {item.brand && (
              <div className="pem-detail">
                <span className="pem-detail-label">Brand</span>
                <span className="pem-detail-value">{item.brand}</span>
              </div>
            )}
            {item.ageRequired && (
              <div className="pem-detail">
                <span className="pem-detail-label">Age Required</span>
                <span className="pem-detail-value">{item.ageRequired}+</span>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="pem-footer">
          <button className="pem-cancel-btn" onClick={onClose}>Cancel</button>
          {hasLabelPrinter && onPrintLabel && (
            <button
              className="pem-cancel-btn"
              onClick={handlePrintLabel}
              disabled={printing}
              title="Print shelf label"
              style={{ display: 'flex', alignItems: 'center', gap: 4 }}
            >
              {printing ? <Loader size={13} className="pem-spin" /> : <Printer size={13} />}
              {printing ? 'Printing…' : 'Print Label'}
            </button>
          )}
          <button
            className={`pem-save-btn ${saved ? 'pem-save-btn--saved' : ''}`}
            disabled={!hasChanges || saving}
            onClick={handleSave}
          >
            {saving ? <Loader size={13} className="pem-spin" />
              : saved ? 'Saved ✓'
              : <><Save size={13} /> Save Changes</>
            }
          </button>
        </div>
      </div>
    </div>
  );
}
