/**
 * CategoryPanel — Left pane content below the search bar.
 * Shows category pills → product grid for selected category.
 * Shows quick-add tiles (top scanned products) when no category selected.
 *
 * config prop:
 *   showDepartments {boolean}  show department pill strip (default true)
 *   showQuickAdd    {boolean}  show quick-add product grid (default true)
 *
 * If both are false, shows a minimal scan-to-add empty state.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { X, ShoppingBag } from 'lucide-react';
import { getDepartments, getProductsByDepartment, getFrequentProducts } from '../../db/dexie.js';
import { fmt$ } from '../../utils/formatters.js';

// ── Single product tile ────────────────────────────────────────────────────
function ProductTile({ product, onAdd, size = 'md' }) {
  const [pressed, setPressed] = useState(false);
  const h = size === 'lg' ? 90 : 76;

  return (
    <button
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onMouseLeave={() => setPressed(false)}
      onTouchStart={() => setPressed(true)}
      onTouchEnd={() => { setPressed(false); onAdd(product); }}
      onClick={() => onAdd(product)}
      style={{
        height: h, borderRadius: 10, padding: '8px 10px',
        background: pressed ? 'rgba(122,193,67,.15)' : 'var(--bg-card)',
        border: `1px solid ${pressed ? 'rgba(122,193,67,.4)' : 'var(--border)'}`,
        cursor: 'pointer', textAlign: 'left',
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        transition: 'background .08s, border-color .08s, transform .08s',
        transform: pressed ? 'scale(0.96)' : 'scale(1)',
        overflow: 'hidden',
      }}
    >
      <div style={{
        fontSize: '0.75rem', fontWeight: 700,
        color: 'var(--text-primary)', lineHeight: 1.25,
        overflow: 'hidden', display: '-webkit-box',
        WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
      }}>
        {product.name}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
        <span style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--green)' }}>
          {fmt$(product.retailPrice)}
        </span>
        <div style={{ display: 'flex', gap: 4 }}>
          {product.ebtEligible && (
            <span style={{
              fontSize: '0.55rem', fontWeight: 800, padding: '1px 5px', borderRadius: 3,
              background: 'rgba(122,193,67,.2)', color: 'var(--green)',
            }}>EBT</span>
          )}
          {product.ageRequired && (
            <span style={{
              fontSize: '0.55rem', fontWeight: 800, padding: '1px 5px', borderRadius: 3,
              background: 'rgba(245,158,11,.2)', color: 'var(--amber)',
            }}>{product.ageRequired}+</span>
          )}
        </div>
      </div>
    </button>
  );
}

// ── Empty state (used when both showDepartments and showQuickAdd are false) ──
function EmptyState() {
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      textAlign: 'center', padding: '3rem',
      color: 'var(--text-muted)', opacity: 0.4,
    }}>
      <ShoppingBag size={48} />
      <div style={{ marginTop: 12, fontSize: '0.82rem' }}>
        Scan or search to add items
      </div>
    </div>
  );
}

// ── Main CategoryPanel ─────────────────────────────────────────────────────
export default function CategoryPanel({ onAddProduct, config = {} }) {
  const showDepts = config.showDepartments !== false;
  const showQuick = config.showQuickAdd    !== false;

  const [departments,   setDepartments]   = useState([]);
  const [activeDeptId,  setActiveDeptId]  = useState(null);
  const [categoryItems, setCategoryItems] = useState([]);
  const [quickItems,    setQuickItems]    = useState([]);
  const [loadingCat,    setLoadingCat]    = useState(false);

  // Load departments + quick items on mount
  useEffect(() => {
    if (showDepts) getDepartments().then(setDepartments);
    if (showQuick) getFrequentProducts(12).then(setQuickItems);
  }, [showDepts, showQuick]);

  const selectDept = useCallback(async (deptId) => {
    if (deptId === activeDeptId) { setActiveDeptId(null); setCategoryItems([]); return; }
    setActiveDeptId(deptId);
    setLoadingCat(true);
    const items = await getProductsByDepartment(deptId, 60);
    setCategoryItems(items);
    setLoadingCat(false);
  }, [activeDeptId]);

  // Both disabled → minimal empty state
  if (!showDepts && !showQuick) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <EmptyState />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* ── Category pills ── */}
      {showDepts && departments.length > 0 && (
        <div style={{
          display: 'flex', gap: 6, padding: '8px 12px',
          overflowX: 'auto', flexShrink: 0,
          borderBottom: '1px solid var(--border)',
        }}>
          {departments.map(d => {
            const active = activeDeptId === d.id;
            return (
              <button key={d.id} onClick={() => selectDept(d.id)} style={{
                padding: '5px 14px', borderRadius: 20, whiteSpace: 'nowrap',
                background: active ? 'var(--green)' : 'var(--bg-input)',
                color:      active ? '#0f1117'       : 'var(--text-secondary)',
                border: `1px solid ${active ? 'var(--green)' : 'var(--border)'}`,
                fontWeight: 700, fontSize: '0.72rem', cursor: 'pointer',
                transition: 'background .12s, color .12s',
                flexShrink: 0,
              }}>
                {d.name}
              </button>
            );
          })}
          {activeDeptId && (
            <button onClick={() => { setActiveDeptId(null); setCategoryItems([]); }} style={{
              padding: '5px 10px', borderRadius: 20, background: 'var(--red-dim)',
              border: '1px solid rgba(224,63,63,.3)', color: 'var(--red)',
              cursor: 'pointer', flexShrink: 0,
            }}>
              <X size={12} />
            </button>
          )}
        </div>
      )}

      {/* ── Content area ── */}
      <div className="scroll" style={{ flex: 1, padding: '10px 12px', overflowY: 'auto' }}>

        {/* Category product grid — shown when a department is active */}
        {showDepts && activeDeptId && (
          <>
            {loadingCat ? (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem', fontSize: '0.85rem' }}>
                Loading…
              </div>
            ) : categoryItems.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem', fontSize: '0.85rem' }}>
                No products in this category yet.
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 8 }}>
                {categoryItems.map(p => (
                  <ProductTile key={p.id} product={p} onAdd={onAddProduct} />
                ))}
              </div>
            )}
          </>
        )}

        {/* Quick-add grid — shown when no department is active */}
        {(!showDepts || !activeDeptId) && showQuick && (
          <>
            {quickItems.length > 0 ? (
              <>
                <div style={{
                  fontSize: '0.62rem', fontWeight: 800, color: 'var(--text-muted)',
                  letterSpacing: '0.08em', marginBottom: 8,
                }}>
                  QUICK ADD
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 8 }}>
                  {quickItems.map(p => (
                    <ProductTile key={p.id} product={p} onAdd={onAddProduct} size="lg" />
                  ))}
                </div>
              </>
            ) : (
              <div style={{
                flex: 1, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                color: 'var(--text-muted)', opacity: 0.25,
                padding: '3rem',
              }}>
                <ShoppingBag size={56} />
                <div style={{ marginTop: 12, fontSize: '0.82rem' }}>
                  Scan or search to add items
                </div>
              </div>
            )}
          </>
        )}

        {/* No departments loaded yet and showDepts is on and no activeDept → fallthrough to quick-add,
            which is already handled above. If showQuick is also off we'd have returned early. */}
      </div>
    </div>
  );
}
