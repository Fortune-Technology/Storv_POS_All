/**
 * InheritedPromosBanner — S69 (C11a)
 *
 * Surfaces dept-level OR group-level promotions that affect a product.
 * The cashier-side promo engine already does lowest-wins across all 3
 * scope dimensions (product / department / group); this banner just makes
 * those non-product-level promos visible to admins on the product detail
 * page so they understand why a product might be discounted at the
 * register without an explicit per-product deal.
 *
 * Renders nothing when there are no inherited promotions (banner is
 * silent in the common case).
 */

import React, { useEffect, useState } from 'react';
import { Sparkles, Building2, Users, X } from 'lucide-react';
import { getCatalogPromotions } from '../services/api';

function fmtDeal(promo) {
  const cfg = promo.dealConfig || {};
  switch (promo.promoType) {
    case 'sale':
      if (cfg.discountType === 'percent') return `${cfg.discountValue || 0}% off`;
      if (cfg.discountType === 'amount')  return `$${Number(cfg.discountValue || 0).toFixed(2)} off`;
      if (cfg.discountType === 'fixed')   return `$${Number(cfg.discountValue || 0).toFixed(2)} sale price`;
      return 'sale';
    case 'bogo':
      return `Buy ${cfg.buyQty || 1} get ${cfg.getQty || 1}`;
    case 'volume':
      return `Volume tiers (${(cfg.tiers || []).length})`;
    case 'mix_match':
      return `${cfg.groupSize || cfg.mixQty || '?'} for $${Number(cfg.bundlePrice || cfg.mixPrice || 0).toFixed(2)}`;
    case 'combo':
      return 'Combo deal';
    default:
      return promo.promoType;
  }
}

export default function InheritedPromosBanner({ productId, productGroupId, departmentId }) {
  const [loading, setLoading]     = useState(false);
  const [inherited, setInherited] = useState([]);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getCatalogPromotions({ active: 'true' })
      .then((res) => {
        if (cancelled) return;
        const all = Array.isArray(res) ? res : (res?.data || []);
        const matches = all.filter(p => {
          const matchesGroup = productGroupId != null
            && Array.isArray(p.productGroupIds)
            && p.productGroupIds.includes(Number(productGroupId));
          const matchesDept  = departmentId != null
            && Array.isArray(p.departmentIds)
            && p.departmentIds.includes(Number(departmentId));
          // Skip promos that ALREADY explicitly target this exact product
          // (those show up in the Store Deals section below — no need to
          // double-list them here).
          const explicitProduct = productId != null
            && Array.isArray(p.productIds)
            && p.productIds.includes(Number(productId));
          if (explicitProduct) return false;
          return matchesGroup || matchesDept;
        });
        setInherited(matches);
      })
      .catch(() => setInherited([]))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [productId, productGroupId, departmentId]);

  if (loading) return null;
  if (dismissed) return null;
  if (!inherited.length) return null;

  return (
    <div className="ipb-card">
      <div className="ipb-head">
        <div className="ipb-title">
          <Sparkles size={14} />
          <span>Inherited promotions affecting this product</span>
          <span className="ipb-count">{inherited.length}</span>
        </div>
        <button
          type="button"
          className="ipb-close"
          onClick={() => setDismissed(true)}
          title="Hide for this session"
        >
          <X size={13} />
        </button>
      </div>
      <div className="ipb-hint">
        These promos apply at the register because of this product's
        department or group. Lowest-wins still applies — a product-level
        deal below would override these if it's cheaper.
      </div>
      <ul className="ipb-list">
        {inherited.map(p => {
          const fromGroup = productGroupId != null
            && Array.isArray(p.productGroupIds)
            && p.productGroupIds.includes(Number(productGroupId));
          const fromDept  = departmentId != null
            && Array.isArray(p.departmentIds)
            && p.departmentIds.includes(Number(departmentId));
          return (
            <li key={p.id} className="ipb-row">
              <div className="ipb-row-name">
                <strong>{p.name}</strong>
                <span className="ipb-deal">{fmtDeal(p)}</span>
              </div>
              <div className="ipb-row-tags">
                {fromGroup && (
                  <span className="ipb-tag ipb-tag-group">
                    <Users size={10} /> via group
                  </span>
                )}
                {fromDept && (
                  <span className="ipb-tag ipb-tag-dept">
                    <Building2 size={10} /> via department
                  </span>
                )}
                {p.dealConfig?.minPurchaseAmount > 0 && (
                  <span className="ipb-tag ipb-tag-min">
                    min ${Number(p.dealConfig.minPurchaseAmount).toFixed(2)}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
