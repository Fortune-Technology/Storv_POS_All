/**
 * SetupGuide — contextual banner shown to retailers during their setup phase.
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Store, Package, CheckCircle, ArrowRight,
  Info, AlertTriangle, ChevronDown, ChevronUp, X,
} from 'lucide-react';
import './SetupGuide.css';

export function SetupGuide({ stage, storeCount, productCount, onDismiss }) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(true);

  if (stage < 0 || stage > 2) return null;

  const steps = [
    { num: 1, icon: Store, title: 'Add your first store', desc: "Create at least one physical location. This is where inventory and POS connect.", action: 'Go to Stores', path: '/portal/stores', done: storeCount > 0 },
    { num: 2, icon: Package, title: 'Build your product catalog', desc: "Add products at the org level. They're shared across all your stores.", action: 'Add Products', path: '/portal/catalog', done: productCount > 0 },
    { num: 3, icon: CheckCircle, title: 'Set store-specific prices', desc: 'Products are available at all stores automatically. Use Store Inventory to set custom prices per location.', action: 'Store Inventory', path: '/portal/store-inventory', done: false },
  ];

  const currentStep = steps.find(s => !s.done) || steps[2];

  const variants = {
    0: { color: '#f59e0b', bgColor: '#f59e0b0d', border: '#f59e0b30', Icon: AlertTriangle, heading: 'Build your catalog now — products sync to stores automatically', sub: "Products you add are saved at the organization level. When you add a store, every product you've built will be ready there automatically. Start building your catalog first!" },
    1: { color: 'var(--accent-primary)', bgColor: 'var(--brand-05)', border: 'var(--brand-30)', Icon: Package, heading: 'Your store is ready — now build your product catalog', sub: 'Start adding products. Every product you add will be automatically available at your store — no extra steps needed.' },
    2: { color: '#10b981', bgColor: '#10b9810d', border: '#10b98130', Icon: CheckCircle, heading: 'Looking good! Products are live at your store', sub: 'Your catalog products are available at your store. Use Store Inventory to set custom prices per location or track stock levels.' },
  };

  const v = variants[stage] || variants[0];
  const VIcon = v.Icon;

  return (
    <div className="sg-wrapper" style={{ border: `1px solid ${v.border}`, background: v.bgColor }}>
      {/* Header */}
      <div className="sg-header" onClick={() => setExpanded(e => !e)}>
        <VIcon size={16} color={v.color} className="sg-header-icon" />
        <div className="sg-header-body">
          <div className="sg-heading" style={{ color: v.color }}>{v.heading}</div>
          {!expanded && <div className="sg-collapsed-hint">Click to see setup steps</div>}
        </div>
        <div className="sg-header-actions">
          {expanded ? <ChevronUp size={14} color="var(--text-muted)" /> : <ChevronDown size={14} color="var(--text-muted)" />}
          {onDismiss && (
            <button onClick={e => { e.stopPropagation(); onDismiss(); }} className="sg-dismiss-btn">
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      {expanded && (
        <div className="sg-body">
          <p className="sg-sub-text">{v.sub}</p>

          {/* 3-step progress */}
          <div className="sg-steps-row">
            <div className="sg-connector" />
            {steps.map((step) => {
              const StepIcon = step.icon;
              const isActive = step.num === currentStep.num;
              const isDone   = step.done;
              return (
                <div key={step.num} className="sg-step">
                  <div className="sg-circle" style={{
                    background: isDone ? '#10b981' : isActive ? v.color : 'var(--bg-secondary)',
                    borderColor: isDone ? '#10b981' : isActive ? v.color : 'var(--border-color)',
                  }}>
                    {isDone
                      ? <CheckCircle size={16} color="#fff" />
                      : <StepIcon size={14} color={isActive ? '#fff' : 'var(--text-muted)'} />
                    }
                  </div>
                  <div className="sg-step-text">
                    <div className="sg-step-title" style={{ color: isDone ? '#10b981' : isActive ? v.color : 'var(--text-muted)' }}>
                      {isDone ? '✓ ' : ''}{step.title}
                    </div>
                    <div className="sg-step-desc">{step.desc}</div>
                  </div>
                  {isActive && !isDone && (
                    <button onClick={() => navigate(step.path)} className="sg-step-action" style={{ background: v.color }}>
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
 */
export function NoStoreBanner({ onGoToStores }) {
  const [visible, setVisible] = useState(true);
  if (!visible) return null;
  return (
    <div className="sg-banner">
      <Info size={15} color="#f59e0b" className="sg-banner-icon" />
      <span className="sg-banner-text">
        <strong className="sg-banner-highlight">No store yet</strong> — this product is saved in your catalog.
        Add a store and it will be available there automatically.
      </span>
      <button onClick={onGoToStores} className="sg-banner-action">Add Store →</button>
      <button onClick={() => setVisible(false)} className="sg-banner-dismiss"><X size={13} /></button>
    </div>
  );
}
