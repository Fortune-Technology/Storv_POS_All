/**
 * AdminAiReviews — curation queue for the AI Support Assistant.
 *
 * Lists 👎 feedback items from users. Admin can:
 *   - Promote to KB: write a canonical answer → creates an AiKnowledgeArticle
 *   - Dismiss: mark as noise
 *   - View conversation: see the full original exchange
 *
 * Gated by `ai_assistant.manage` permission (server-enforced).
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Sparkles, ThumbsDown, Check, X, Eye, MessageCircle, Loader2 } from 'lucide-react';
import { toast } from 'react-toastify';
import {
  listAiReviews,
  getAiReviewConversation,
  promoteAiReview,
  dismissAiReview,
} from '../services/api';
import './AdminAiReviews.css';

const STATUS_TABS = [
  { key: 'pending',   label: 'Pending' },
  { key: 'promoted',  label: 'Promoted' },
  { key: 'dismissed', label: 'Dismissed' },
];

const CATEGORIES = [
  { value: 'how-to',       label: 'How-to' },
  { value: 'troubleshoot', label: 'Troubleshoot' },
  { value: 'faq',          label: 'FAQ' },
  { value: 'feature',      label: 'Feature overview' },
];

export default function AdminAiReviews() {
  const [status, setStatus]       = useState('pending');
  const [reviews, setReviews]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [selected, setSelected]   = useState(null);
  const [conversation, setConv]   = useState(null);
  const [convLoading, setConvLoading] = useState(false);

  // Promote-form state
  const [promoteFor, setPromoteFor] = useState(null);
  const [form, setForm] = useState({ title: '', content: '', category: 'how-to', tags: '' });
  const [saving, setSaving] = useState(false);

  const loadReviews = async () => {
    setLoading(true);
    try {
      const res = await listAiReviews(status);
      setReviews(res.reviews || []);
    } catch (err) {
      toast.error('Failed to load reviews');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadReviews(); /* eslint-disable-next-line */ }, [status]);

  const counts = useMemo(() => {
    const c = { pending: 0, promoted: 0, dismissed: 0 };
    if (status === 'pending') c.pending = reviews.length;
    return c;
  }, [reviews, status]);

  const openConversation = async (review) => {
    setSelected(review);
    setConv(null);
    setConvLoading(true);
    try {
      const res = await getAiReviewConversation(review.id);
      setConv(res);
    } catch (err) {
      toast.error('Failed to load conversation context');
    } finally {
      setConvLoading(false);
    }
  };

  const startPromote = (review) => {
    setPromoteFor(review);
    // Prefill the form with a sensible starting point from the user's suggestion.
    setForm({
      title: `${review.question.slice(0, 60)}${review.question.length > 60 ? '…' : ''}`,
      content: review.userSuggestion || '',
      category: 'how-to',
      tags: '',
    });
  };

  const submitPromote = async () => {
    if (!form.title.trim() || !form.content.trim()) {
      toast.error('Title and content are required');
      return;
    }
    setSaving(true);
    try {
      await promoteAiReview(promoteFor.id, {
        title: form.title.trim(),
        content: form.content.trim(),
        category: form.category,
        tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
      });
      toast.success('Article created and added to the KB');
      setPromoteFor(null);
      setForm({ title: '', content: '', category: 'how-to', tags: '' });
      loadReviews();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to promote');
    } finally {
      setSaving(false);
    }
  };

  const handleDismiss = async (review) => {
    if (!window.confirm('Dismiss this feedback? This cannot be undone.')) return;
    try {
      await dismissAiReview(review.id);
      toast.success('Dismissed');
      if (selected?.id === review.id) setSelected(null);
      loadReviews();
    } catch (err) {
      toast.error('Failed to dismiss');
    }
  };

  return (
    <div className="ar-page">
      <header className="admin-header">
        <div className="admin-header-title">
          <span className="admin-header-icon"><Sparkles size={22} /></span>
          <div>
            <h1 className="admin-page-title">AI Assistant — Review Queue</h1>
            <p className="admin-page-subtitle">Curate 👎 feedback into knowledge base articles that help future users.</p>
          </div>
        </div>
      </header>

      <div className="ar-tabs">
        {STATUS_TABS.map(t => (
          <button
            key={t.key}
            className={`ar-tab ${status === t.key ? 'ar-tab--active' : ''}`}
            onClick={() => setStatus(t.key)}
          >
            {t.label}
            {status === t.key && counts[t.key] != null && counts[t.key] > 0 ? ` (${counts[t.key]})` : ''}
          </button>
        ))}
      </div>

      <div className="ar-layout">
        {/* List */}
        <div className="ar-list">
          {loading ? (
            <div className="ar-loading"><Loader2 className="ar-spin" size={18} /> Loading…</div>
          ) : reviews.length === 0 ? (
            <div className="ar-empty">
              <ThumbsDown size={36} />
              <div className="ar-empty-title">No {status} reviews</div>
              <div className="ar-empty-body">
                {status === 'pending'
                  ? 'When users leave a 👎 with a suggestion, they show up here.'
                  : `No reviews have been ${status} yet.`}
              </div>
            </div>
          ) : reviews.map(r => (
            <div
              key={r.id}
              className={`ar-item ${selected?.id === r.id ? 'ar-item--selected' : ''}`}
              onClick={() => openConversation(r)}
            >
              <div className="ar-item-q">{r.question}</div>
              <div className="ar-item-meta">
                <span className="ar-badge ar-badge--neg">
                  <ThumbsDown size={11} /> unhelpful
                </span>
                {r.status !== 'pending' && (
                  <span className={`ar-badge ar-badge--${r.status}`}>{r.status}</span>
                )}
                <span className="ar-item-date">{new Date(r.createdAt).toLocaleDateString()}</span>
              </div>
              {r.userSuggestion && (
                <div className="ar-item-suggestion">
                  <strong>User suggestion:</strong> {r.userSuggestion}
                </div>
              )}
              {r.articleTitle && (
                <div className="ar-item-article">
                  ✓ Promoted to: <strong>{r.articleTitle}</strong>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Detail panel */}
        <div className="ar-detail">
          {!selected ? (
            <div className="ar-detail-empty">
              <MessageCircle size={48} />
              <p>Select a review to see the conversation and take action.</p>
            </div>
          ) : (
            <div className="ar-detail-inner">
              <div className="ar-detail-head">
                <div>
                  <div className="ar-detail-label">QUESTION</div>
                  <div className="ar-detail-q">{selected.question}</div>
                </div>
                {selected.status === 'pending' && (
                  <div className="ar-detail-actions">
                    <button className="ar-btn ar-btn--primary" onClick={() => startPromote(selected)}>
                      <Check size={14} /> Promote to KB
                    </button>
                    <button className="ar-btn ar-btn--danger" onClick={() => handleDismiss(selected)}>
                      <X size={14} /> Dismiss
                    </button>
                  </div>
                )}
              </div>

              <div className="ar-section">
                <div className="ar-detail-label">AI RESPONSE</div>
                <div className="ar-detail-response">{selected.aiResponse}</div>
              </div>

              {selected.userSuggestion && (
                <div className="ar-section">
                  <div className="ar-detail-label">USER'S SUGGESTION</div>
                  <div className="ar-detail-suggestion">{selected.userSuggestion}</div>
                </div>
              )}

              <div className="ar-section">
                <div className="ar-detail-label">
                  <Eye size={12} /> FULL CONVERSATION
                </div>
                {convLoading ? (
                  <div className="ar-loading"><Loader2 className="ar-spin" size={16} /> Loading…</div>
                ) : conversation?.messages?.length ? (
                  <div className="ar-transcript">
                    {conversation.messages.map(m => (
                      <div key={m.id} className={`ar-tx-msg ar-tx-msg--${m.role}`}>
                        <div className="ar-tx-role">{m.role.toUpperCase()}</div>
                        <div className="ar-tx-body">{m.content}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="ar-empty-small">No conversation context available.</div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Promote modal */}
      {promoteFor && (
        <div className="ar-modal-overlay" onClick={() => !saving && setPromoteFor(null)}>
          <div className="ar-modal" onClick={e => e.stopPropagation()}>
            <header className="ar-modal-head">
              <h2>Write a KB Article</h2>
              <button className="ar-modal-close" onClick={() => !saving && setPromoteFor(null)}><X size={18} /></button>
            </header>
            <div className="ar-modal-body">
              <div className="ar-modal-hint">
                Write the canonical answer the AI should give next time someone asks this. Future questions with similar wording will retrieve this article automatically.
              </div>

              <div className="ar-field">
                <label className="ar-label">Title</label>
                <input
                  className="ar-input"
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="Short, clear title of the how-to"
                  maxLength={200}
                />
              </div>

              <div className="ar-field">
                <label className="ar-label">Category</label>
                <select
                  className="ar-input"
                  value={form.category}
                  onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                >
                  {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>

              <div className="ar-field">
                <label className="ar-label">Content <span className="ar-hint">(markdown — bold, lists, code all supported)</span></label>
                <textarea
                  className="ar-textarea"
                  rows={14}
                  value={form.content}
                  onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
                  placeholder="Step-by-step answer. Cite UI paths like **Catalog → Products**."
                />
              </div>

              <div className="ar-field">
                <label className="ar-label">Tags <span className="ar-hint">(comma-separated)</span></label>
                <input
                  className="ar-input"
                  value={form.tags}
                  onChange={e => setForm(f => ({ ...f, tags: e.target.value }))}
                  placeholder="products, inventory, setup"
                />
              </div>
            </div>
            <footer className="ar-modal-foot">
              <button className="ar-btn ar-btn--ghost" onClick={() => setPromoteFor(null)} disabled={saving}>Cancel</button>
              <button className="ar-btn ar-btn--primary" onClick={submitPromote} disabled={saving || !form.title.trim() || !form.content.trim()}>
                {saving ? <><Loader2 className="ar-spin" size={14} /> Saving…</> : <><Check size={14} /> Create Article</>}
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
