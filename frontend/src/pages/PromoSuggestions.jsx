/**
 * PromoSuggestions — F28 / S74
 *
 * AI-driven promo recommendation review queue. Lives under Catalog group.
 * Currently uses a stub generator (real Claude tool-use lands in a follow-up).
 *
 * Workflow:
 *   1. Click "Generate Suggestions" — backend pulls dead-stock + expiring
 *      stock, synthesises plausible promos, creates pending PromoSuggestion
 *      rows (de-duped against any from the past 7 days).
 *   2. Manager reviews each card: title, scope, deal preview, AI rationale,
 *      estimated impact.
 *   3. Approve → creates a real Promotion (active immediately) and marks
 *      the suggestion `approved` with `createdPromoId` linkback.
 *   4. Reject (with optional reason) → marks suggestion `rejected`. Reason
 *      will feed into AI quality loop in a follow-up.
 *   5. Dismiss → quick mark as `dismissed` (e.g. "not useful, no reason").
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Sparkles, RefreshCw, Loader, Check, X, Edit2, Trash2,
  Tag, AlertCircle, TrendingDown, Calendar, ChevronDown, ChevronUp,
  DollarSign, Package,
} from 'lucide-react';
import { toast } from 'react-toastify';
import {
  listPromoSuggestions,
  generatePromoSuggestions,
  approvePromoSuggestion,
  rejectPromoSuggestion,
  dismissPromoSuggestion,
} from '../services/api';
import { useConfirm } from '../hooks/useConfirmDialog.jsx';
import './PromoSuggestions.css';

const STATUS_TABS = [
  { key: 'pending',   label: 'Pending Review',  color: '#7c3aed' },
  { key: 'approved',  label: 'Approved',        color: '#10b981' },
  { key: 'rejected',  label: 'Rejected',        color: '#dc2626' },
  { key: 'dismissed', label: 'Dismissed',       color: '#94a3b8' },
];

const SOURCE_META = {
  expiring:    { icon: Calendar,    color: '#f59e0b', label: 'Expiring soon' },
  dead_stock:  { icon: TrendingDown, color: '#dc2626', label: 'Slow-mover'   },
};

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDealPreview(promoType, cfg) {
  const c = cfg || {};
  if (promoType === 'sale') {
    if (c.discountType === 'percent') return `${c.discountValue}% off`;
    if (c.discountType === 'amount')  return `$${Number(c.discountValue || 0).toFixed(2)} off`;
    if (c.discountType === 'fixed')   return `$${Number(c.discountValue || 0).toFixed(2)} sale price`;
    return 'sale';
  }
  if (promoType === 'bogo')      return `Buy ${c.buyQty || 1} get ${c.getQty || 1}`;
  if (promoType === 'volume')    return `Volume tiers (${(c.tiers || []).length})`;
  if (promoType === 'mix_match') return `${c.groupSize || c.mixQty} for $${Number(c.bundlePrice || c.mixPrice || 0).toFixed(2)}`;
  return promoType;
}

function SuggestionCard({ sugg, onApprove, onReject, onDismiss, busy }) {
  const [expanded, setExpanded] = useState(false);
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const rationale = sugg.rationale || {};
  const sourceMeta = SOURCE_META[rationale.source] || { icon: Sparkles, color: '#7c3aed', label: 'AI suggestion' };
  const Icon = sourceMeta.icon;
  const cfg = sugg.proposedConfig || {};
  const scope = sugg.proposedScope || {};
  const impact = sugg.estImpact || {};

  const isPending = sugg.status === 'pending';

  return (
    <div className={`ps-card ps-card--${sugg.status}`}>
      {/* AI badge ribbon */}
      <div className="ps-card-ribbon">
        <Sparkles size={11} />
        <span>AI {sugg.generatedBy === 'stub' ? '(stub)' : 'suggestion'}</span>
      </div>

      {/* Header */}
      <div className="ps-card-head">
        <div className="ps-card-source" style={{ background: sourceMeta.color + '14', color: sourceMeta.color }}>
          <Icon size={14} />
          <span>{sourceMeta.label}</span>
        </div>
        {sugg.status !== 'pending' && (
          <span className={`ps-status-pill ps-status-pill--${sugg.status}`}>
            {sugg.status}
          </span>
        )}
      </div>

      <h3 className="ps-card-title">{sugg.title}</h3>

      {/* Scope + deal preview */}
      <div className="ps-meta-row">
        <div className="ps-meta-item">
          <Tag size={12} />
          <span>{formatDealPreview(sugg.promoType, cfg)}</span>
        </div>
        <div className="ps-meta-item">
          <Package size={12} />
          <span>
            {(scope.productIds?.length || 0) > 0 && `${scope.productIds.length} product${scope.productIds.length !== 1 ? 's' : ''}`}
            {(scope.departmentIds?.length || 0) > 0 && `${scope.departmentIds.length} dept${scope.departmentIds.length !== 1 ? 's' : ''}`}
            {(scope.productGroupIds?.length || 0) > 0 && `${scope.productGroupIds.length} group${scope.productGroupIds.length !== 1 ? 's' : ''}`}
          </span>
        </div>
        {(sugg.proposedStartDate || sugg.proposedEndDate) && (
          <div className="ps-meta-item">
            <Calendar size={12} />
            <span>{formatDate(sugg.proposedStartDate)} → {formatDate(sugg.proposedEndDate)}</span>
          </div>
        )}
      </div>

      {/* Estimated impact */}
      {impact.valueAtRisk != null && (
        <div className="ps-impact">
          <div className="ps-impact-item">
            <span className="ps-impact-label">Value at risk</span>
            <span className="ps-impact-value ps-mono">${Number(impact.valueAtRisk).toFixed(2)}</span>
          </div>
          {impact.expectedSales != null && (
            <div className="ps-impact-item">
              <span className="ps-impact-label">Expected sales</span>
              <span className="ps-impact-value ps-mono" style={{ color: '#10b981' }}>
                ${Number(impact.expectedSales).toFixed(2)}
              </span>
            </div>
          )}
          {impact.unitsCleared != null && (
            <div className="ps-impact-item">
              <span className="ps-impact-label">Est. units cleared</span>
              <span className="ps-impact-value ps-mono">{impact.unitsCleared}</span>
            </div>
          )}
        </div>
      )}

      {/* Rationale (collapsible) */}
      {rationale.reasoning && (
        <button className="ps-rationale-toggle" onClick={() => setExpanded(!expanded)}>
          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          <span>{expanded ? 'Hide' : 'Why?'} AI reasoning</span>
        </button>
      )}
      {expanded && rationale.reasoning && (
        <div className="ps-rationale">
          <p>{rationale.reasoning}</p>
          {Array.isArray(rationale.citations) && rationale.citations.length > 0 && (
            <div className="ps-citations">
              <strong>Data sources:</strong>
              {rationale.citations.map((c, i) => (
                <div key={i} className="ps-citation">
                  <code>{c.kind}</code> — productId={c.productId}
                  {c.daysUntilExpiry != null && ` · ${c.daysUntilExpiry}d to expiry`}
                  {c.daysWithoutSale != null && ` · ${c.daysWithoutSale}d no sale`}
                  {c.onHand != null && ` · ${c.onHand} on hand`}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Reject reason form */}
      {rejectMode && (
        <div className="ps-reject-form">
          <textarea
            placeholder="Why are you rejecting this suggestion? (Helps the AI improve.)"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            maxLength={500}
            rows={2}
          />
          <div className="ps-reject-actions">
            <button className="ps-btn ps-btn-secondary ps-btn-sm" onClick={() => { setRejectMode(false); setRejectReason(''); }}>
              Cancel
            </button>
            <button
              className="ps-btn ps-btn-danger ps-btn-sm"
              onClick={() => { onReject(sugg.id, rejectReason); setRejectMode(false); setRejectReason(''); }}
              disabled={busy}
            >
              {busy ? <Loader size={11} className="p-spin" /> : <X size={11} />}
              Reject
            </button>
          </div>
        </div>
      )}

      {/* Action buttons (only for pending) */}
      {isPending && !rejectMode && (
        <div className="ps-card-actions">
          <button className="ps-btn ps-btn-primary" onClick={() => onApprove(sugg.id)} disabled={busy}>
            {busy ? <Loader size={12} className="p-spin" /> : <Check size={12} />}
            Approve & Publish
          </button>
          <button className="ps-btn ps-btn-secondary" onClick={() => setRejectMode(true)} disabled={busy}>
            <AlertCircle size={12} />
            Reject
          </button>
          <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => onDismiss(sugg.id)} disabled={busy}>
            <Trash2 size={12} />
            Dismiss
          </button>
        </div>
      )}

      {/* Approved badge */}
      {sugg.status === 'approved' && sugg.createdPromoId && (
        <div className="ps-approved-link">
          <Check size={12} /> Promotion #{sugg.createdPromoId} now active
        </div>
      )}

      {/* Rejected reason display */}
      {sugg.status === 'rejected' && sugg.rejectReason && (
        <div className="ps-reject-reason">
          <strong>Reason:</strong> {sugg.rejectReason}
        </div>
      )}

      <div className="ps-card-foot">
        <span>Generated {new Date(sugg.generatedAt).toLocaleString()}</span>
        {sugg.reviewedAt && (
          <span>Reviewed {new Date(sugg.reviewedAt).toLocaleString()}</span>
        )}
      </div>
    </div>
  );
}

export default function PromoSuggestions() {
  const confirm = useConfirm();
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading]         = useState(true);
  const [generating, setGenerating]   = useState(false);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [busyId, setBusyId]           = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await listPromoSuggestions({ status: statusFilter });
      setSuggestions(r?.data || []);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to load suggestions');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const r = await generatePromoSuggestions();
      const created = r?.meta?.created || 0;
      const skipped = r?.meta?.skipped || 0;
      if (created === 0 && skipped > 0) {
        toast.info(`No new suggestions — ${skipped} candidates already had recent suggestions`);
      } else if (created === 0) {
        toast.info('No suggestions generated. No expiring or slow-moving stock found right now.');
      } else {
        toast.success(`Generated ${created} new suggestion${created !== 1 ? 's' : ''}`);
      }
      setStatusFilter('pending');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to generate');
    } finally {
      setGenerating(false);
    }
  };

  const handleApprove = async (id) => {
    if (!await confirm({
      title: 'Publish this promotion?',
      message: 'The promo will be activated immediately at the register. This is the same as creating a new promo manually.',
      confirmLabel: 'Publish',
    })) return;
    setBusyId(id);
    try {
      await approvePromoSuggestion(id);
      toast.success('Promotion published');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Approve failed');
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (id, reason) => {
    setBusyId(id);
    try {
      await rejectPromoSuggestion(id, reason);
      toast.success('Suggestion rejected');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Reject failed');
    } finally {
      setBusyId(null);
    }
  };

  const handleDismiss = async (id) => {
    setBusyId(id);
    try {
      await dismissPromoSuggestion(id);
      toast.success('Dismissed');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Dismiss failed');
    } finally {
      setBusyId(null);
    }
  };

  const counts = STATUS_TABS.reduce((acc, t) => {
    acc[t.key] = suggestions.filter(s => s.status === t.key).length;
    return acc;
  }, {});

  return (
    <div className="p-page">
      <div className="p-header">
        <div className="p-header-left">
          <div className="p-header-icon ps-ai-icon">
            <Sparkles size={22} />
          </div>
          <div>
            <h1 className="p-title">
              <span className="ps-ai-marker"><Sparkles size={11} /> AI</span>
              Promo Suggestions
            </h1>
            <p className="p-subtitle">
              AI-driven promo recommendations for slow-moving + expiring stock · review and publish
            </p>
          </div>
        </div>
        <div className="p-header-actions">
          <button onClick={load} className="pc-refresh-btn" disabled={loading || generating}>
            <RefreshCw size={14} />
          </button>
          <button onClick={handleGenerate} className="ps-generate-btn" disabled={generating}>
            {generating ? <Loader size={14} className="p-spin" /> : <Sparkles size={14} />}
            {generating ? 'Generating…' : 'Generate Suggestions'}
          </button>
        </div>
      </div>

      {/* Status filter tabs */}
      <div className="ps-tabs">
        {STATUS_TABS.map(t => (
          <button
            key={t.key}
            className={`ps-tab ${statusFilter === t.key ? 'ps-tab--active' : ''}`}
            style={statusFilter === t.key ? { borderColor: t.color, color: t.color } : {}}
            onClick={() => setStatusFilter(t.key)}
          >
            {t.label}
            {counts[t.key] > 0 && <span className="ps-tab-count">{counts[t.key]}</span>}
          </button>
        ))}
      </div>

      {/* Loading / Empty / Cards */}
      {loading && (
        <div className="ps-loading"><Loader size={18} className="p-spin" /> Loading…</div>
      )}

      {!loading && suggestions.length === 0 && statusFilter === 'pending' && (
        <div className="ps-empty">
          <Sparkles size={42} className="ps-empty-icon" />
          <div className="ps-empty-title">No pending suggestions</div>
          <div className="ps-empty-desc">
            Click <strong>Generate Suggestions</strong> to have the AI scan your slow-moving + expiring stock
            and propose targeted promos. Suggestions are saved as drafts — they won't go live until you
            review and approve them.
          </div>
          <button onClick={handleGenerate} className="ps-generate-btn ps-empty-btn" disabled={generating}>
            {generating ? <Loader size={14} className="p-spin" /> : <Sparkles size={14} />}
            {generating ? 'Generating…' : 'Generate Now'}
          </button>
        </div>
      )}

      {!loading && suggestions.length === 0 && statusFilter !== 'pending' && (
        <div className="ps-empty">
          <div className="ps-empty-title">No {statusFilter} suggestions</div>
        </div>
      )}

      {!loading && suggestions.length > 0 && (
        <div className="ps-grid">
          {suggestions.map(s => (
            <SuggestionCard
              key={s.id}
              sugg={s}
              onApprove={handleApprove}
              onReject={handleReject}
              onDismiss={handleDismiss}
              busy={busyId === s.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}
