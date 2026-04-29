/**
 * PackSizePickerModal — light-theme, info-rich cashier picker.
 *
 * Appears when a scanned product has 2+ pack sizes configured (a synthetic
 * "primary" entry from MasterProduct + zero or more ProductPackSize rows).
 * The cashier taps a row to add it to the cart.
 *
 * Session F redesign:
 *   • Light theme matching the back-office portal (was dark + brand-green
 *     button accents).
 *   • Richer per-row info: unit count + packs-per-case math, deposit per
 *     pack (when configured), inferred per-base savings vs the primary,
 *     deposit-included total at the bottom of each card. All decision-
 *     supporting context the cashier needs without scrolling or doing math.
 *   • Primary row is visually distinguished (★ badge) but acts as a normal
 *     selectable button — same tap target, same flow.
 *
 * Props:
 *   product   — the master product (with .packSizes array including primary)
 *   onSelect  — (sizeObj) => void  — called with the chosen pack size
 *   onCancel  — () => void         — called when dismissed without choosing
 */

import React, { useMemo } from 'react';
import { X, Star, Recycle } from 'lucide-react';
import './PackSizePickerModal.css';

const fmt$ = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? '$' + n.toFixed(2) : '—';
};
const fmt$3 = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? '$' + n.toFixed(3) : '—';
};

export default function PackSizePickerModal({ product, onSelect, onCancel }) {
  if (!product) return null;

  const sizes = Array.isArray(product.packSizes) ? product.packSizes : [];

  // Per-base-unit deposit, used to compute deposit per pack at row level.
  // Falls back to product.depositAmount divided by master unitPack when the
  // canonical per-base field isn't set (older snapshot).
  const depositPerBaseUnit = useMemo(() => {
    if (product.depositPerBaseUnit != null) return Number(product.depositPerBaseUnit);
    if (product.depositAmount != null) {
      const masterUnit = Number(product.unitPack || 1);
      return masterUnit > 0 ? Number(product.depositAmount) / masterUnit : null;
    }
    return null;
  }, [product]);

  // The primary row's per-base-unit price — used to compute "savings" badges
  // showing how much a multi-pack discounts vs buying singles.
  const primarySize = sizes.find((s) => s.isPrimary) || sizes[0];
  const primaryPerBase = primarySize?.unitCount > 0
    ? Number(primarySize.retailPrice) / Number(primarySize.unitCount)
    : null;

  return (
    <div className="pspm-overlay" onClick={onCancel}>
      <div className="pspm-modal" onClick={(e) => e.stopPropagation()}>

        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="pspm-header">
          <div className="pspm-header-text">
            <p className="pspm-product-name" title={product.name}>{product.name}</p>
            {product.brand && <p className="pspm-brand">{product.brand}</p>}
            <p className="pspm-subtitle">
              {sizes.length} pack option{sizes.length === 1 ? '' : 's'} — tap to add
            </p>
          </div>
          <button
            className="pspm-close-btn"
            onClick={onCancel}
            aria-label="Cancel"
            type="button"
          >
            <X size={18} />
          </button>
        </div>

        {/* ── Body: pack-size cards ──────────────────────────────────── */}
        <div className="pspm-body">
          <div className="pspm-grid">
            {sizes.map((size) => {
              const units      = Number(size.unitCount) || 1;
              const retail     = Number(size.retailPrice) || 0;
              const ppc        = size.packsPerCase != null ? Number(size.packsPerCase) : null;
              const perBase    = units > 0 ? retail / units : null;
              const deposit    = depositPerBaseUnit != null
                ? Math.round(depositPerBaseUnit * units * 1000) / 1000
                : null;
              const totalWithDeposit = deposit != null
                ? Math.round((retail + deposit) * 100) / 100
                : null;
              // Savings vs primary (only meaningful for non-primary rows).
              const savings = !size.isPrimary && primaryPerBase != null && perBase != null
                ? primaryPerBase - perBase
                : null;
              const savingsPct = savings != null && primaryPerBase > 0
                ? (savings / primaryPerBase) * 100
                : null;

              // Display label — synthetic primary has label=null; render the
              // single-unit derived label so the cashier sees "Single" instead
              // of the empty primary.
              const displayLabel = size.label || (size.isPrimary ? 'Single' : `${units}-Pack`);

              return (
                <button
                  key={size.id}
                  className={[
                    'pspm-size-btn',
                    size.isPrimary ? 'pspm-size-btn--primary' : '',
                    size.isDefault ? 'pspm-size-btn--default' : '',
                  ].filter(Boolean).join(' ')}
                  onClick={() => onSelect(size)}
                  autoFocus={size.isDefault}
                  type="button"
                >
                  {/* Top strip: label + primary/default badges */}
                  <div className="pspm-row-top">
                    <span className="pspm-size-label">{displayLabel}</span>
                    <div className="pspm-row-badges">
                      {size.isPrimary && (
                        <span className="pspm-badge pspm-badge--primary">
                          <Star size={9} fill="currentColor" /> Primary
                        </span>
                      )}
                      {size.isDefault && !size.isPrimary && (
                        <span className="pspm-badge pspm-badge--default">Default</span>
                      )}
                    </div>
                  </div>

                  {/* Pack math: 1 × 24 / case */}
                  <div className="pspm-pack-math">
                    {units > 1 ? `${units} units` : '1 unit'}
                    {ppc ? <span className="pspm-pack-math-dim"> · {ppc}/case</span> : null}
                  </div>

                  {/* Big retail price */}
                  <div className="pspm-size-price">{fmt$(retail)}</div>

                  {/* Per-unit + savings vs primary */}
                  {(perBase != null || savings != null) && (
                    <div className="pspm-row-meta">
                      {perBase != null && units > 1 && (
                        <span className="pspm-per-unit">
                          {fmt$3(perBase)}/unit
                        </span>
                      )}
                      {savings != null && savings > 0.001 && (
                        <span className="pspm-savings">
                          save {fmt$3(savings)}/unit
                          {savingsPct != null && savingsPct > 0.5
                            ? ` (${savingsPct.toFixed(0)}%)`
                            : ''}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Deposit row — shown only when configured */}
                  {deposit != null && deposit > 0 && (
                    <div className="pspm-deposit-row">
                      <Recycle size={10} />
                      <span>+ {fmt$3(deposit)} deposit</span>
                      {totalWithDeposit != null && (
                        <span className="pspm-deposit-total">= {fmt$(totalWithDeposit)}</span>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
