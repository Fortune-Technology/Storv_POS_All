import React from 'react';
import { Minus, Plus, Trash2, Tag, Zap, Edit3 } from 'lucide-react';
import { fmt$ } from '../../utils/formatters.js';
import { useCartStore } from '../../stores/useCartStore.js';
import './CartItem.css';

export default function CartItem({ item, selected, onSelect, onEdit }) {
  const updateQty  = useCartStore(s => s.updateQty);
  const removeItem = useCartStore(s => s.removeItem);

  // ── Fuel items — show gallons + price + amount, no qty controls ───────────
  if (item.isFuel) {
    const isSale = item.fuelType === 'sale';
    const selClass = selected
      ? (isSale ? 'ci-fuel--selected-sale' : 'ci-fuel--selected-refund')
      : '';
    const galAbs   = Math.abs(Number(item.gallons) || 0);
    const ppgAbs   = Number(item.pricePerGallon) || 0;
    return (
      <div onClick={() => onSelect(item.lineId)} className={`ci-fuel ${selClass}`}>
        <div className="ci-fuel-inner">
          <span className="ci-fuel-emoji">⛽</span>
          <div className="ci-fuel-info">
            <div className="ci-fuel-name">{item.name}</div>
            <div className="ci-fuel-sub">
              {galAbs.toFixed(3)} gal &times; ${ppgAbs.toFixed(3)}/gal
              {item.entryMode === 'gallons' ? ' · entered as gallons' : ' · entered as amount'}
            </div>
          </div>
        </div>
        <div className="ci-fuel-right">
          <div className={isSale ? 'ci-fuel-total--sale' : 'ci-fuel-total--refund'}>
            {isSale ? '+' : ''}{fmt$(item.lineTotal)}
          </div>
          {selected && (
            <button
              onClick={e => { e.stopPropagation(); removeItem(item.lineId); }}
              title="Remove"
              className="ci-remove-btn"
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── Lottery items — special render (no qty controls) ──────────────────────
  if (item.isLottery) {
    const isSale = item.lotteryType === 'sale';
    const selClass = selected
      ? (isSale ? 'ci-lottery--selected-sale' : 'ci-lottery--selected-payout')
      : '';

    return (
      <div onClick={() => onSelect(item.lineId)} className={`ci-lottery ${selClass}`}>
        <div className="ci-lottery-inner">
          <span className="ci-lottery-emoji">{isSale ? '\uD83C\uDFAB\uFE0F' : '\uD83D\uDCB0'}</span>
          <div className="ci-lottery-info">
            <div className="ci-lottery-name">{item.name}</div>
            <div className="ci-lottery-sub">
              {isSale ? 'Lottery Sale \u00B7 No Tax' : 'Lottery Payout \u00B7 Cash Out'}
            </div>
          </div>
        </div>
        <div className="ci-lottery-right">
          <div className={isSale ? 'ci-lottery-total--sale' : 'ci-lottery-total--payout'}>
            {isSale ? '+' : ''}{fmt$(item.lineTotal)}
          </div>
          {selected && (
            <button
              onClick={e => { e.stopPropagation(); removeItem(item.lineId); }}
              title="Remove"
              className="ci-remove-btn"
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </div>
    );
  }

  const hasDiscount   = item.discountType && item.discountValue > 0;
  const discountLabel = hasDiscount
    ? item.discountType === 'percent'
      ? `${item.discountValue}% OFF`
      : `-${fmt$(item.discountValue)}`
    : null;

  const hasPromo    = !!item.promoAdjustment;
  const promoLabel  = hasPromo ? (item.promoAdjustment?.badgeLabel || 'PROMO') : null;
  const promoColor  = item.promoAdjustment?.badgeColor || '#10b981';

  return (
    <div
      onClick={() => onSelect(item.lineId)}
      className={`ci-item ${selected ? 'ci-item--selected' : ''}`}
    >
      {/* Main row */}
      <div className="ci-main-row">

        {/* Inline qty controls */}
        <div className="ci-qty-controls">
          <button
            onClick={e => { e.stopPropagation(); updateQty(item.lineId, item.qty - 1); }}
            title="Decrease"
            className="ci-qty-btn ci-qty-btn--dec"
          >
            <Minus size={10} />
          </button>

          <div className={`ci-qty-display ${selected ? 'ci-qty-display--selected' : ''}`}>
            {item.qty}
          </div>

          <button
            onClick={e => { e.stopPropagation(); updateQty(item.lineId, item.qty + 1); }}
            title="Increase"
            className="ci-qty-btn"
          >
            <Plus size={10} />
          </button>
        </div>

        {/* Name + badges */}
        <div className="ci-name-col">
          <div className="ci-name-badges">
            <span className="ci-name">{item.name}</span>

            {hasDiscount && (
              <span className="ci-badge ci-badge--discount">
                <Tag size={8} /> {discountLabel}
              </span>
            )}

            {hasPromo && (
              <span
                className="ci-badge ci-badge--promo"
                style={{ background: promoColor + '22', color: promoColor, borderColor: promoColor + '44' }}
              >
                <Zap size={7} /> {promoLabel}
              </span>
            )}

            {item.ebtEligible && (
              <span className="ci-badge ci-badge--ebt">EBT</span>
            )}

            {item.ageRequired && (
              <span className="ci-badge ci-badge--age">{item.ageRequired}+</span>
            )}

            {item.priceOverridden && (
              <span className="ci-badge ci-badge--ovrd">OVRD</span>
            )}
          </div>

          <div className="ci-price-line">
            {item.upc && <span className="ci-upc">{item.upc}</span>}
            {item.upc && <span className="ci-upc-sep">&middot;</span>}
            {hasDiscount ? (
              <>
                <span className="ci-price-struck">{fmt$(item.unitPrice)}</span>
                <span className="ci-price-effective">{fmt$(item.effectivePrice)}</span>
                <span style={{ opacity: 0.5 }}>each</span>
              </>
            ) : (
              <span>{fmt$(item.unitPrice)} each</span>
            )}
            {!item.taxable && <span>&middot; No Tax</span>}
            {item.quantityOnHand != null && (
              <>
                <span className="ci-upc-sep">&middot;</span>
                <span className={`ci-onhand ${item.quantityOnHand <= 0 ? 'ci-onhand--out' : item.quantityOnHand <= 5 ? 'ci-onhand--low' : ''}`}>
                  On hand: {item.quantityOnHand}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Line total + quick remove */}
        <div className="ci-total-col">
          <div style={{ textAlign: 'right' }}>
            {hasDiscount && (
              <div className="ci-total-struck">
                {fmt$(item.unitPrice * item.qty)}
              </div>
            )}
            <div className="ci-total-value">{fmt$(item.lineTotal)}</div>
          </div>

          {selected && (
            <div className="ci-action-btns">
              {onEdit && (
                <button
                  onClick={e => { e.stopPropagation(); onEdit(item); }}
                  title="Edit product"
                  className="ci-edit-btn"
                >
                  <Edit3 size={11} />
                </button>
              )}
              <button
                onClick={e => { e.stopPropagation(); removeItem(item.lineId); }}
                title="Remove item"
                className="ci-remove-btn"
              >
                <Trash2 size={12} />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Deposit sub-line — the per-deposit "not taxed" footnote was being
          misread as "this PRODUCT has no tax". Removed for clarity. Deposits
          are pass-through by convention across all US states. */}
      {item.depositAmount > 0 && (
        <div className="ci-deposit">
          <span className="ci-deposit-label">
            Bottle Deposit ({item.qty} &times; {fmt$(item.depositAmount)})
          </span>
          <span className="ci-deposit-value">{fmt$(item.depositTotal)}</span>
        </div>
      )}
    </div>
  );
}
