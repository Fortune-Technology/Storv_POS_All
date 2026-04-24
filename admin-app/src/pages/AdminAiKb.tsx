/**
 * AdminAiKb — Knowledge Base article management page.
 *
 * List, filter, create, edit, deactivate articles used by the AI assistant's
 * RAG retrieval. Embeddings regenerate automatically on content changes.
 *
 * Gated by `ai_assistant.manage`.
 */

import { useEffect, useMemo, useState } from 'react';
import { BookOpen, Plus, Edit2, Trash2, Loader2, X, Check, Eye, EyeOff, Search } from 'lucide-react';
import { toast } from 'react-toastify';
import {
  listKbArticles,
  getKbArticle,
  createKbArticle,
  updateKbArticle,
  deleteKbArticle,
} from '../services/api';
import './AdminAiKb.css';

const CATEGORIES = [
  { value: 'how-to',       label: 'How-to' },
  { value: 'troubleshoot', label: 'Troubleshoot' },
  { value: 'faq',          label: 'FAQ' },
  { value: 'feature',      label: 'Feature' },
] as const;

const SOURCE_LABELS: Record<string, string> = {
  seed:     'Seeded',
  curated:  'Curated',
  admin:    'Admin-authored',
};

interface KbArticle {
  id: string | number;
  title: string;
  content: string;
  category: string;
  source?: string;
  orgId?: string | null;
  tags?: string[];
  helpfulCount?: number;
  unhelpfulCount?: number;
  active: boolean;
}

interface Filters {
  search: string;
  category: string;
  active: string;
}

interface FormState {
  title: string;
  content: string;
  category: string;
  tags: string;
  active: boolean;
}

type EditingState = null | 'new' | KbArticle;

const BLANK_FORM: FormState = { title: '', content: '', category: 'how-to', tags: '', active: true };

export default function AdminAiKb() {
  const [articles, setArticles] = useState<KbArticle[]>([]);
  const [loading, setLoading]   = useState(true);
  const [filters, setFilters]   = useState<Filters>({ search: '', category: '', active: '' });

  const [editing, setEditing]   = useState<EditingState>(null);
  const [form, setForm]         = useState<FormState>(BLANK_FORM);
  const [saving, setSaving]     = useState(false);

  const loadArticles = async () => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = {};
      if (filters.search)   params.search   = filters.search;
      if (filters.category) params.category = filters.category;
      if (filters.active !== '') params.active = filters.active;
      const res = await listKbArticles(params);
      setArticles(res.articles || []);
    } catch {
      toast.error('Failed to load articles');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const t = setTimeout(loadArticles, 180);
    return () => clearTimeout(t);
    /* eslint-disable-next-line */
  }, [filters.search, filters.category, filters.active]);

  const stats = useMemo(() => {
    const total = articles.length;
    const active = articles.filter(a => a.active).length;
    const inactive = total - active;
    const seeded = articles.filter(a => a.source === 'seed').length;
    const admin  = articles.filter(a => a.source === 'admin').length;
    return { total, active, inactive, seeded, admin };
  }, [articles]);

  const openNew = () => {
    setEditing('new');
    setForm(BLANK_FORM);
  };

  const openEdit = async (article: KbArticle) => {
    // Fetch full content (list omits some fields for bandwidth).
    try {
      const res = await getKbArticle(article.id);
      setEditing(res.article);
      setForm({
        title: res.article.title,
        content: res.article.content,
        category: res.article.category,
        tags: (res.article.tags || []).join(', '),
        active: res.article.active,
      });
    } catch {
      toast.error('Failed to load article');
    }
  };

  const submitForm = async () => {
    if (!form.title.trim() || !form.content.trim()) {
      toast.error('Title and content are required');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        content: form.content.trim(),
        category: form.category,
        tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
        active: form.active,
      };
      if (editing === 'new') {
        await createKbArticle(payload);
        toast.success('Article created');
      } else if (editing) {
        await updateKbArticle(editing.id, payload);
        toast.success('Article updated');
      }
      setEditing(null);
      setForm(BLANK_FORM);
      loadArticles();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (article: KbArticle) => {
    try {
      await updateKbArticle(article.id, { active: !article.active });
      toast.success(article.active ? 'Deactivated' : 'Reactivated');
      loadArticles();
    } catch {
      toast.error('Update failed');
    }
  };

  const handleDelete = async (article: KbArticle) => {
    if (!window.confirm(`Deactivate "${article.title}"? It will stop appearing in search results.`)) return;
    try {
      await deleteKbArticle(article.id);
      toast.success('Article deactivated');
      loadArticles();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Delete failed');
    }
  };

  return (
    <div className="kb-page">
      <header className="admin-header">
        <div className="admin-header-title">
          <span className="admin-header-icon"><BookOpen size={22} /></span>
          <div>
            <h1 className="admin-page-title">AI Knowledge Base</h1>
            <p className="admin-page-subtitle">Curate the articles the AI assistant retrieves from. Embeddings regenerate automatically on content changes.</p>
          </div>
        </div>
        <div className="admin-header-actions">
          <button className="kb-btn kb-btn--primary" onClick={openNew}>
            <Plus size={14} /> New Article
          </button>
        </div>
      </header>

      <div className="kb-stats">
        <div className="kb-stat"><div className="kb-stat-value">{stats.total}</div><div className="kb-stat-label">Total</div></div>
        <div className="kb-stat"><div className="kb-stat-value">{stats.active}</div><div className="kb-stat-label">Active</div></div>
        <div className="kb-stat"><div className="kb-stat-value">{stats.inactive}</div><div className="kb-stat-label">Inactive</div></div>
        <div className="kb-stat"><div className="kb-stat-value">{stats.seeded}</div><div className="kb-stat-label">Seeded</div></div>
        <div className="kb-stat"><div className="kb-stat-value">{stats.admin}</div><div className="kb-stat-label">Admin-authored</div></div>
      </div>

      <div className="kb-filters">
        <div className="kb-search">
          <Search size={14} />
          <input
            type="text"
            placeholder="Search title or content…"
            value={filters.search}
            onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
          />
        </div>
        <select value={filters.category} onChange={e => setFilters(f => ({ ...f, category: e.target.value }))}>
          <option value="">All categories</option>
          {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <select value={filters.active} onChange={e => setFilters(f => ({ ...f, active: e.target.value }))}>
          <option value="">All statuses</option>
          <option value="true">Active only</option>
          <option value="false">Inactive only</option>
        </select>
      </div>

      <div className="kb-list">
        {loading ? (
          <div className="kb-loading"><Loader2 className="kb-spin" size={18} /> Loading articles…</div>
        ) : articles.length === 0 ? (
          <div className="kb-empty">
            <BookOpen size={40} />
            <div className="kb-empty-title">No articles match your filters</div>
            <div className="kb-empty-body">Adjust filters above or add a new article.</div>
          </div>
        ) : articles.map(a => (
          <div key={a.id} className={`kb-item ${!a.active ? 'kb-item--inactive' : ''}`}>
            <div className="kb-item-main">
              <div className="kb-item-title">
                {a.title}
                {!a.active && <span className="kb-badge kb-badge--inactive">Inactive</span>}
              </div>
              <div className="kb-item-meta">
                <span className={`kb-badge kb-badge--${a.category}`}>{CATEGORIES.find(c => c.value === a.category)?.label || a.category}</span>
                <span className="kb-badge kb-badge--source">{SOURCE_LABELS[a.source || ''] || a.source}</span>
                {a.orgId == null && <span className="kb-badge kb-badge--platform">Platform-wide</span>}
                <span className="kb-item-ratings">
                  {(a.helpfulCount ?? 0) > 0 && <span className="kb-pos">+{a.helpfulCount}</span>}
                  {(a.unhelpfulCount ?? 0) > 0 && <span className="kb-neg">−{a.unhelpfulCount}</span>}
                </span>
                {a.tags && a.tags.length > 0 && <span className="kb-item-tags">{a.tags.slice(0, 3).join(' · ')}</span>}
              </div>
              <div className="kb-item-preview">{a.content.slice(0, 160)}{a.content.length > 160 ? '…' : ''}</div>
            </div>
            <div className="kb-item-actions">
              <button className="kb-icon-btn" onClick={() => openEdit(a)} title="Edit"><Edit2 size={14} /></button>
              <button className="kb-icon-btn" onClick={() => toggleActive(a)} title={a.active ? 'Deactivate' : 'Reactivate'}>
                {a.active ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
              <button className="kb-icon-btn kb-icon-btn--danger" onClick={() => handleDelete(a)} title="Delete (soft)">
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <div className="kb-modal-overlay" onClick={() => !saving && setEditing(null)}>
          <div className="kb-modal" onClick={e => e.stopPropagation()}>
            <header className="kb-modal-head">
              <h2>{editing === 'new' ? 'New Article' : 'Edit Article'}</h2>
              <button className="kb-modal-close" onClick={() => !saving && setEditing(null)}><X size={18} /></button>
            </header>
            <div className="kb-modal-body">
              <div className="kb-field">
                <label>Title</label>
                <input
                  className="kb-input"
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="How to…"
                  maxLength={200}
                />
              </div>
              <div className="kb-field">
                <label>Category</label>
                <select
                  className="kb-input"
                  value={form.category}
                  onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                >
                  {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              <div className="kb-field">
                <label>Content <span className="kb-hint">(markdown — **bold**, `code`, lists)</span></label>
                <textarea
                  className="kb-textarea"
                  rows={14}
                  value={form.content}
                  onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
                  placeholder="Step-by-step answer. Cite UI paths like **Catalog → Products**."
                />
              </div>
              <div className="kb-field">
                <label>Tags <span className="kb-hint">(comma-separated)</span></label>
                <input
                  className="kb-input"
                  value={form.tags}
                  onChange={e => setForm(f => ({ ...f, tags: e.target.value }))}
                  placeholder="products, inventory, setup"
                />
              </div>
              <div className="kb-field kb-field--row">
                <input
                  type="checkbox"
                  id="kb-active"
                  checked={form.active}
                  onChange={e => setForm(f => ({ ...f, active: e.target.checked }))}
                />
                <label htmlFor="kb-active">Active — visible to the AI retrieval search</label>
              </div>
            </div>
            <footer className="kb-modal-foot">
              <button className="kb-btn kb-btn--ghost" onClick={() => setEditing(null)} disabled={saving}>Cancel</button>
              <button
                className="kb-btn kb-btn--primary"
                onClick={submitForm}
                disabled={saving || !form.title.trim() || !form.content.trim()}
              >
                {saving ? <><Loader2 className="kb-spin" size={14} /> Saving…</> : <><Check size={14} /> {editing === 'new' ? 'Create' : 'Save'}</>}
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
