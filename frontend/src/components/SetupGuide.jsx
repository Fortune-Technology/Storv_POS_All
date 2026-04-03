/**
 * SetupGuide — contextual banner shown to retailers during their setup phase.
 *
 * Stage 0: No stores yet.
 *   → Build catalog now; products sync to stores automatically when a store is added.
 *
 * Stage 1: Has stores, no catalog products yet.
 *   → Prompt to start adding products.
 *
 * Stage 2: Has stores + products.
 *   → Prompt to use Store Inventory for per-location price/stock overrides.
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Store, Package, CheckCircle, ArrowRight,
  Info, AlertTriangle, ChevronDown, ChevronUp, X,
} from 'lucide-react';

export function SetupGuide({ stage, storeCount, productCount, onDismiss }) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(true);

  if (stage < 0 || stage > 2) return null; // loaded and fully operational

  // ── Step definitions ──────────────────────────────────────────────────────
  const steps = [
    {
      num:   1,
      icon:  Store,
      title: 'Add your first store',
      desc:  'Create at least one physical location. This is where inventory and POS connect.',
      action:'Go to Stores',
      path:  '/portal/stores',
      done:  storeCount > 0,
    },
    {
      num:   2,
      icon:  Package,
      title: 'Build your product catalog',
      desc:  'Add products at the org level. They\'re shared across all your stores.',
      action:'Add Products',
      path:  '/portal/catalog',
      done:  productCount > 0,
    },
    {
      num:   3,
      icon:  CheckCircle,
      title: 'Set store-specific prices',
      desc:  'Products are available at all stores automatically. Use Store Inventory to set custom prices per location.',
      action:'Store Inventory',
      path:  '/portal/store-inventory',
      done:  false,  // will update when StoreInventory page is built
    },
  ];

  const currentStep = steps.find(s => !s.done) || steps[2];

  // ── Variant by stage ──────────────────────────────────────────────────────
  const variants = {
    0: {
      color:   '#f59e0b',
      bgColor: '#f59e0b0d',
      border:  '#f59e0b30',
      Icon:    AlertTriangle,
      heading: 'Build your catalog now — products sync to stores automatically',
      sub:     'Products you add are saved at the organization level. When you add a store, every product you\'ve built will be ready there automatically. Start building your catalog first!',
    },
    1: {
      color:   '#6366f1',
      bgColor: '#6366f10d',
      border:  '#6366f130',
      Icon:    Package,
      heading: 'Your store is ready — now build your product catalog',
      sub:     'Start adding products. Every product you add will be automatically available at your store — no extra steps needed.',
    },
    2: {
      color:   '#10b981',
      bgColor: '#10b9810d',
      border:  '#10b98130',
      Icon:    CheckCircle,
      heading: 'Looking good! Products are live at your store',
      sub:     'Your catalog products are available at your store. Use Store Inventory to set custom prices per location or track stock levels.',
    },
  };

  const v = variants[stage] || variants[0];
  const VIcon = v.Icon;

  return (
    <div style={{
      margin: '0 1.75rem 1rem',
      borderRadius: 10,
      border: `1px solid ${v.border}`,
      background: v.bgColor,
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', gap:10,
        padding:'0.875rem 1.1rem', cursor:'pointer' }}
        onClick={() => setExpanded(e => !e)}>
        <VIcon size={16} color={v.color} style={{ flexShrink:0 }} />
        <div style={{ flex:1 }}>
          <div style={{ fontSize:'0.85rem', fontWeight:700, color:v.color }}>{v.heading}</div>
          {!expanded && (
            <div style={{ fontSize:'0.75rem', color:'var(--text-muted)', marginTop:1 }}>
              Click to see setup steps
            </div>
          )}
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          {expanded ? <ChevronUp size={14} color="var(--text-muted)" /> : <ChevronDown size={14} color="var(--text-muted)" />}
          {onDismiss && (
            <button onClick={e => { e.stopPropagation(); onDismiss(); }}
              style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)',
                padding:'2px', borderRadius:3, display:'flex' }}>
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      {expanded && (
        <div style={{ padding:'0 1.1rem 1.1rem' }}>
          <p style={{ fontSize:'0.78rem', color:'var(--text-secondary)', margin:'0 0 1rem',
            lineHeight:1.5 }}>{v.sub}</p>

          {/* 3-step progress */}
          <div style={{ display:'flex', gap:0, position:'relative' }}>
            {/* connector line */}
            <div style={{ position:'absolute', top:16, left:24, right:24,
              height:2, background:'var(--border-color)', zIndex:0 }} />

            {steps.map((step, i) => {
              const StepIcon = step.icon;
              const isActive = step.num === currentStep.num;
              const isDone   = step.done;
              return (
                <div key={step.num} style={{ flex:1, display:'flex', flexDirection:'column',
                  alignItems:'center', position:'relative', zIndex:1 }}>
                  {/* Circle */}
                  <div style={{
                    width: 32, height: 32, borderRadius:'50%',
                    display:'flex', alignItems:'center', justifyContent:'center',
                    background: isDone ? '#10b981' : isActive ? v.color : 'var(--bg-secondary)',
                    border: `2px solid ${isDone ? '#10b981' : isActive ? v.color : 'var(--border-color)'}`,
                    marginBottom: 8, transition:'all .2s',
                  }}>
                    {isDone
                      ? <CheckCircle size={16} color="#fff" />
                      : <StepIcon size={14} color={isActive ? '#fff' : 'var(--text-muted)'} />
                    }
                  </div>
                  {/* Label */}
                  <div style={{ textAlign:'center', maxWidth:110 }}>
                    <div style={{ fontSize:'0.72rem', fontWeight:700,
                      color: isDone ? '#10b981' : isActive ? v.color : 'var(--text-muted)' }}>
                      {isDone ? '✓ ' : ''}{step.title}
                    </div>
                    <div style={{ fontSize:'0.65rem', color:'var(--text-muted)', marginTop:2, lineHeight:1.3 }}>
                      {step.desc}
                    </div>
                  </div>
                  {/* Action button (only current step) */}
                  {isActive && !isDone && (
                    <button onClick={() => navigate(step.path)}
                      style={{ marginTop:8, display:'flex', alignItems:'center', gap:4,
                        padding:'0.3rem 0.75rem', borderRadius:5, border:'none',
                        background: v.color, color:'#fff', cursor:'pointer',
                        fontSize:'0.72rem', fontWeight:600 }}>
                      {step.action} <ArrowRight size={11} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * SetupBanner — compact single-line version for use inside forms/pages.
 * Shown when no stores exist and a product is saved.
 */
export function NoStoreBanner({ onGoToStores }) {
  const [visible, setVisible] = useState(true);
  if (!visible) return null;
  return (
    <div style={{ display:'flex', alignItems:'center', gap:10,
      padding:'0.65rem 1rem', borderRadius:8, margin:'0 0 1rem',
      background:'#f59e0b0d', border:'1px solid #f59e0b30' }}>
      <Info size={15} color="#f59e0b" style={{ flexShrink:0 }} />
      <span style={{ fontSize:'0.8rem', color:'var(--text-secondary)', flex:1 }}>
        <strong style={{ color:'#f59e0b' }}>No store yet</strong> — this product is saved in your catalog.
        Add a store and it will be available there automatically.
      </span>
      <button onClick={onGoToStores}
        style={{ fontSize:'0.75rem', fontWeight:600, color:'#f59e0b',
          background:'none', border:'1px solid #f59e0b50', borderRadius:5,
          padding:'0.25rem 0.65rem', cursor:'pointer', whiteSpace:'nowrap' }}>
        Add Store →
      </button>
      <button onClick={() => setVisible(false)}
        style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)' }}>
        <X size={13} />
      </button>
    </div>
  );
}
