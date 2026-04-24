/**
 * AdminAiTours — list + edit AI Product Tours (narrated walkthroughs).
 *
 * Tours are the AI assistant's "walk me through it" deliverable. When a user
 * asks for step-by-step guidance, Claude recommends a matching tour; the
 * portal widget shows a "Start guided tour" button; the TourRunner overlay
 * drives the user page-by-page.
 *
 * This page shows all tours (platform-wide + org-scoped) with inline
 * toggle-active + a JSON editor for steps/triggers. Full click-to-author
 * editor lands in P7.
 *
 * Gated by `ai_assistant.manage`.
 */

import { useEffect, useMemo, useState } from 'react';
import { Compass, Plus, Edit2, Trash2, Loader2, X, Check, Eye, EyeOff, Play } from 'lucide-react';
import { toast } from 'react-toastify';
import {
  listAiTours,
  getAiTour,
  createAiTour,
  updateAiTour,
  deleteAiTour,
} from '../services/api';
import './AdminAiTours.css';

const CATEGORIES = [
  { value: 'onboarding',   label: 'Onboarding' },
  { value: 'feature',      label: 'Feature' },
  { value: 'troubleshoot', label: 'Troubleshoot' },
] as const;

interface TourStep {
  title: string;
  body: string;
  url?: string;
  selector?: string;
}

interface Tour {
  id: string | number;
  slug: string;
  name: string;
  description?: string;
  category: string;
  triggers?: string[];
  steps?: TourStep[];
  active: boolean;
  orgId?: string | null;
}

interface Filters {
  category: string;
  active: string;
}

interface FormState {
  slug: string;
  name: string;
  description: string;
  category: string;
  triggers: string;
  steps: string;
  active: boolean;
}

type EditingState = null | 'new' | Tour;

const BLANK_FORM: FormState = {
  slug: '', name: '', description: '', category: 'onboarding',
  triggers: '', steps: '[\n  {\n    "title": "1. Step title",\n    "body": "Step body text. Supports **bold** and `code`.",\n    "url": "/portal/..."\n  }\n]',
  active: true,
};

export default function AdminAiTours() {
  const [tours, setTours]       = useState<Tour[]>([]);
  const [loading, setLoading]   = useState(true);
  const [filters, setFilters]   = useState<Filters>({ category: '', active: '' });
  const [editing, setEditing]   = useState<EditingState>(null);
  const [form, setForm]         = useState<FormState>(BLANK_FORM);
  const [saving, setSaving]     = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = {};
      if (filters.category) params.category = filters.category;
      if (filters.active !== '') params.active = filters.active;
      const res = await listAiTours(params);
      setTours(res.tours || []);
    } catch {
      toast.error('Failed to load tours');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filters]);

  const stats = useMemo(() => ({
    total:       tours.length,
    active:      tours.filter(t => t.active).length,
    platform:    tours.filter(t => t.orgId == null).length,
    custom:      tours.filter(t => t.orgId != null).length,
  }), [tours]);

  const openNew = () => {
    setEditing('new');
    setForm(BLANK_FORM);
  };

  const openEdit = async (tour: Tour) => {
    try {
      const res = await getAiTour(tour.id);
      const t: Tour = res.tour;
      setEditing(t);
      setForm({
        slug: t.slug,
        name: t.name,
        description: t.description || '',
        category: t.category,
        triggers: (t.triggers || []).join('\n'),
        steps: JSON.stringify(t.steps, null, 2),
        active: t.active,
      });
    } catch {
      toast.error('Failed to load tour');
    }
  };

  const submitForm = async () => {
    if (!form.name.trim()) { toast.error('Name is required'); return; }
    if (editing === 'new' && !form.slug.trim()) { toast.error('Slug is required'); return; }

    let parsedSteps: TourStep[];
    try {
      parsedSteps = JSON.parse(form.steps);
      if (!Array.isArray(parsedSteps) || parsedSteps.length === 0) {
        toast.error('Steps must be a non-empty JSON array');
        return;
      }
    } catch {
      toast.error('Steps must be valid JSON — check for missing commas or quotes');
      return;
    }

    const triggers = form.triggers.split('\n').map(t => t.trim()).filter(Boolean);
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        category: form.category,
        triggers,
        steps: parsedSteps,
        active: form.active,
      };
      if (editing === 'new') {
        payload.slug = form.slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
        await createAiTour(payload);
        toast.success('Tour created');
      } else if (editing) {
        await updateAiTour(editing.id, payload);
        toast.success('Tour updated');
      }
      setEditing(null);
      setForm(BLANK_FORM);
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (tour: Tour) => {
    try {
      await updateAiTour(tour.id, { active: !tour.active });
      toast.success(tour.active ? 'Deactivated' : 'Reactivated');
      load();
    } catch { toast.error('Update failed'); }
  };

  const handleDelete = async (tour: Tour) => {
    if (!window.confirm(`Deactivate "${tour.name}"? Users will no longer be offered this tour.`)) return;
    try {
      await deleteAiTour(tour.id);
      toast.success('Tour deactivated');
      load();
    } catch { toast.error('Delete failed'); }
  };

  const testTour = (slug: string) => {
    // Open the portal and dispatch the tour-start event via URL param.
    const portalBase = import.meta.env.VITE_PORTAL_URL || 'http://localhost:5173';
    window.open(`${portalBase}/portal/realtime?startTour=${encodeURIComponent(slug)}`, '_blank');
  };

  return (
    <div className="tours-page">
      <header className="admin-header">
        <div className="admin-header-title">
          <span className="admin-header-icon"><Compass size={22} /></span>
          <div>
            <h1 className="admin-page-title">AI Product Tours</h1>
            <p className="admin-page-subtitle">Narrated step-by-step walkthroughs the AI recommends when users ask to be "walked through" a task.</p>
          </div>
        </div>
        <div className="admin-header-actions">
          <button className="tours-btn tours-btn--primary" onClick={openNew}>
            <Plus size={14} /> New Tour
          </button>
        </div>
      </header>

      <div className="tours-stats">
        <div className="tours-stat"><div className="tours-stat-value">{stats.total}</div><div className="tours-stat-label">Total</div></div>
        <div className="tours-stat"><div className="tours-stat-value">{stats.active}</div><div className="tours-stat-label">Active</div></div>
        <div className="tours-stat"><div className="tours-stat-value">{stats.platform}</div><div className="tours-stat-label">Platform-wide</div></div>
        <div className="tours-stat"><div className="tours-stat-value">{stats.custom}</div><div className="tours-stat-label">Org-custom</div></div>
      </div>

      <div className="tours-filters">
        <select value={filters.category} onChange={e => setFilters(f => ({ ...f, category: e.target.value }))}>
          <option value="">All categories</option>
          {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <select value={filters.active} onChange={e => setFilters(f => ({ ...f, active: e.target.value }))}>
          <option value="">All statuses</option>
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </select>
      </div>

      <div className="tours-list">
        {loading ? (
          <div className="tours-loading"><Loader2 className="tours-spin" size={18} /> Loading tours…</div>
        ) : tours.length === 0 ? (
          <div className="tours-empty">
            <Compass size={40} />
            <div className="tours-empty-title">No tours yet</div>
            <div className="tours-empty-body">Add a new tour or run <code>node prisma/seedProductTours.js</code> to load the 5 seeded onboarding flows.</div>
          </div>
        ) : tours.map(t => (
          <div key={t.id} className={`tours-item ${!t.active ? 'tours-item--inactive' : ''}`}>
            <div className="tours-item-main">
              <div className="tours-item-title">
                {t.name}
                {!t.active && <span className="tours-badge tours-badge--inactive">Inactive</span>}
              </div>
              <div className="tours-item-meta">
                <span className={`tours-badge tours-badge--${t.category}`}>{CATEGORIES.find(c => c.value === t.category)?.label || t.category}</span>
                <span className="tours-badge tours-badge--slug"><code>{t.slug}</code></span>
                {t.orgId == null && <span className="tours-badge tours-badge--platform">Platform</span>}
                <span className="tours-item-steps">{(t.steps || []).length} steps</span>
                <span className="tours-item-triggers">{(t.triggers || []).length} triggers</span>
              </div>
              {t.description && <div className="tours-item-desc">{t.description}</div>}
            </div>
            <div className="tours-item-actions">
              <button className="tours-icon-btn" onClick={() => testTour(t.slug)} title="Preview in portal">
                <Play size={14} />
              </button>
              <button className="tours-icon-btn" onClick={() => openEdit(t)} title="Edit"><Edit2 size={14} /></button>
              <button className="tours-icon-btn" onClick={() => toggleActive(t)} title={t.active ? 'Deactivate' : 'Reactivate'}>
                {t.active ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
              <button className="tours-icon-btn tours-icon-btn--danger" onClick={() => handleDelete(t)} title="Delete">
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <div className="tours-modal-overlay" onClick={() => !saving && setEditing(null)}>
          <div className="tours-modal" onClick={e => e.stopPropagation()}>
            <header className="tours-modal-head">
              <h2>{editing === 'new' ? 'New Tour' : `Edit: ${editing.name}`}</h2>
              <button className="tours-modal-close" onClick={() => !saving && setEditing(null)}><X size={18} /></button>
            </header>
            <div className="tours-modal-body">
              <div className="tours-modal-hint">
                💡 Steps use a JSON array. Each step: <code>{'{title, body, url?}'}</code>. The TourRunner shows one step at a time with Back/Next controls; <code>url</code> enables a "Go to this screen" button.
              </div>

              <div className="tours-form-row">
                <div className="tours-field">
                  <label>Slug {editing === 'new' && <span className="tours-req">*</span>}</label>
                  <input
                    className="tours-input"
                    value={form.slug}
                    onChange={e => setForm(f => ({ ...f, slug: e.target.value }))}
                    placeholder="add-product"
                    disabled={editing !== 'new'}
                  />
                </div>
                <div className="tours-field">
                  <label>Category</label>
                  <select className="tours-input" value={form.category}
                          onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                    {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
              </div>

              <div className="tours-field">
                <label>Name <span className="tours-req">*</span></label>
                <input
                  className="tours-input"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Add your first product"
                />
              </div>

              <div className="tours-field">
                <label>Description</label>
                <textarea
                  className="tours-textarea"
                  rows={2}
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Short summary shown in the widget CTA"
                />
              </div>

              <div className="tours-field">
                <label>AI triggers <span className="tours-hint">(one phrase per line — the AI matches these to user questions)</span></label>
                <textarea
                  className="tours-textarea"
                  rows={3}
                  value={form.triggers}
                  onChange={e => setForm(f => ({ ...f, triggers: e.target.value }))}
                  placeholder={'how do I add a product\nguide me through adding a product'}
                />
              </div>

              <div className="tours-field">
                <label>Steps JSON <span className="tours-hint">(array of {'{title, body, url?}'})</span></label>
                <textarea
                  className="tours-textarea tours-json"
                  rows={18}
                  value={form.steps}
                  onChange={e => setForm(f => ({ ...f, steps: e.target.value }))}
                  spellCheck={false}
                />
              </div>

              <div className="tours-field tours-field--row">
                <input
                  type="checkbox"
                  id="tours-active"
                  checked={form.active}
                  onChange={e => setForm(f => ({ ...f, active: e.target.checked }))}
                />
                <label htmlFor="tours-active">Active — the AI can recommend this tour</label>
              </div>
            </div>
            <footer className="tours-modal-foot">
              <button className="tours-btn tours-btn--ghost" onClick={() => setEditing(null)} disabled={saving}>Cancel</button>
              <button
                className="tours-btn tours-btn--primary"
                onClick={submitForm}
                disabled={saving || !form.name.trim()}
              >
                {saving ? <><Loader2 className="tours-spin" size={14} /> Saving…</> : <><Check size={14} /> {editing === 'new' ? 'Create' : 'Save'}</>}
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
