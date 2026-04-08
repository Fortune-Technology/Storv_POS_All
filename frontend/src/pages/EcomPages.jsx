import { useState, useEffect } from 'react';
import Sidebar from '../components/Sidebar';
import { toast } from 'react-toastify';
import './EcomPages.css';

const API = '/api/ecom';

function getHeaders() {
  const u = JSON.parse(localStorage.getItem('user') || '{}');
  const storeId = localStorage.getItem('activeStoreId') || '';
  return {
    Authorization: `Bearer ${u.token}`,
    'X-Store-Id': storeId,
    'X-Org-Id': u.orgId || u.tenantId || '',
    'Content-Type': 'application/json',
  };
}

async function api(method, path, body) {
  const r = await fetch(`${API}${path}`, { method, headers: getHeaders(), body: body ? JSON.stringify(body) : undefined });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Request failed');
  return data;
}

const TEMPLATES = {
  home: [
    { id: 'modern-grid', name: 'Modern Grid', icon: '🏗️', desc: 'Hero + dept grid + products' },
    { id: 'classic-store', name: 'Classic Store', icon: '🏪', desc: 'Full hero image + featured' },
    { id: 'minimal', name: 'Minimal', icon: '✨', desc: 'Clean, just products + search' },
    { id: 'bold-banner', name: 'Bold Banner', icon: '🎨', desc: 'Large banner + category tiles' },
    { id: 'split-feature', name: 'Split Feature', icon: '📐', desc: '50/50 hero + product grid' },
  ],
  about: [
    { id: 'story-timeline', name: 'Story Timeline', icon: '📖', desc: 'Our story + milestones' },
    { id: 'team-focused', name: 'Team Focused', icon: '👥', desc: 'About text + team photos' },
    { id: 'simple-text', name: 'Simple Text', icon: '📝', desc: 'Clean heading + paragraphs' },
  ],
  contact: [
    { id: 'map-form', name: 'Map + Form', icon: '🗺️', desc: 'Contact form + map' },
    { id: 'split-layout', name: 'Split Layout', icon: '↔️', desc: 'Info left, form right' },
    { id: 'card-layout', name: 'Card Layout', icon: '🃏', desc: 'Phone, email, address cards' },
  ],
  custom: [
    { id: 'simple-text', name: 'Simple Text', icon: '📝', desc: 'Heading + text blocks' },
  ],
};

const PAGE_TYPES = ['home', 'about', 'contact', 'custom'];

export default function EcomPages() {
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // null | 'create' | page object

  const load = async () => {
    setLoading(true);
    try {
      const d = await api('GET', '/manage/pages');
      setPages(d.data || []);
    } catch (e) { toast.error(e.message); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async (formData) => {
    try {
      await api('POST', '/manage/pages', formData);
      toast.success('Page created');
      setModal(null);
      load();
    } catch (e) { toast.error(e.message); }
  };

  const handleUpdate = async (id, formData) => {
    try {
      await api('PUT', `/manage/pages/${id}`, formData);
      toast.success('Page updated');
      setModal(null);
      load();
    } catch (e) { toast.error(e.message); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this page?')) return;
    try {
      await api('DELETE', `/manage/pages/${id}`);
      toast.success('Page deleted');
      load();
    } catch (e) { toast.error(e.message); }
  };

  const handleTogglePublish = async (page) => {
    try {
      await api('PUT', `/manage/pages/${page.id}`, { published: !page.published });
      toast.success(page.published ? 'Unpublished' : 'Published');
      load();
    } catch (e) { toast.error(e.message); }
  };

  return (
    <div className="layout-container"><Sidebar /><main className="main-content">
      <div className="epg-header">
        <h1 className="epg-title">Website Pages</h1>
        <button className="epg-add-btn" onClick={() => setModal('create')}>+ New Page</button>
      </div>

      {loading ? <p>Loading...</p> : pages.length === 0 ? (
        <div className="epg-empty">
          <p style={{ fontSize: 32, marginBottom: 12 }}>📄</p>
          <p>No pages yet. Create your Home, About, and Contact pages to get started.</p>
        </div>
      ) : (
        <div className="epg-pages">
          {pages.map(p => (
            <div key={p.id} className="epg-card">
              <div className="epg-card-header">
                <div className="epg-card-title">{p.title}</div>
                <span className="epg-card-type">{p.pageType}</span>
              </div>
              <div className="epg-card-slug">/{p.slug}</div>
              <div className={`epg-card-status ${p.published ? 'epg-card-status--pub' : 'epg-card-status--draft'}`}>
                {p.published ? '● Published' : '○ Draft'}
              </div>
              {p.templateId && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Template: {p.templateId}</div>}
              <div className="epg-card-actions">
                <button className="epg-card-btn" onClick={() => setModal(p)}>Edit</button>
                <button className="epg-card-btn" onClick={() => handleTogglePublish(p)}>
                  {p.published ? 'Unpublish' : 'Publish'}
                </button>
                <button className="epg-card-btn epg-card-btn--del" onClick={() => handleDelete(p.id)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <PageModal
          page={modal === 'create' ? null : modal}
          onSave={(data) => modal === 'create' ? handleCreate(data) : handleUpdate(modal.id, data)}
          onClose={() => setModal(null)}
        />
      )}
    </main></div>
  );
}

function PageModal({ page, onSave, onClose }) {
  const [form, setForm] = useState({
    title: page?.title || '',
    pageType: page?.pageType || 'home',
    templateId: page?.templateId || '',
    seoTitle: page?.seoTitle || '',
    seoDescription: page?.seoDescription || '',
    published: page?.published ?? false,
  });

  const templates = TEMPLATES[form.pageType] || [];

  return (
    <div className="epg-modal-overlay" onClick={onClose}>
      <div className="epg-modal" onClick={e => e.stopPropagation()}>
        <div className="epg-modal-title">{page ? 'Edit Page' : 'Create New Page'}</div>

        <div className="epg-modal-field">
          <label className="epg-modal-label">Page Type</label>
          <select className="epg-modal-input" value={form.pageType} onChange={e => setForm(f => ({ ...f, pageType: e.target.value, templateId: '' }))}>
            {PAGE_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
          </select>
        </div>

        <div className="epg-modal-field">
          <label className="epg-modal-label">Title</label>
          <input className="epg-modal-input" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. About Us" />
        </div>

        {templates.length > 0 && (
          <div className="epg-templates">
            <div className="epg-templates-title">Choose a Template</div>
            <div className="epg-template-grid">
              {templates.map(t => (
                <div
                  key={t.id}
                  className={`epg-template-card ${form.templateId === t.id ? 'epg-template-card--active' : ''}`}
                  onClick={() => setForm(f => ({ ...f, templateId: t.id }))}
                >
                  <div className="epg-template-icon">{t.icon}</div>
                  <div className="epg-template-name">{t.name}</div>
                  <div className="epg-template-desc">{t.desc}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="epg-modal-field">
          <label className="epg-modal-label">SEO Title</label>
          <input className="epg-modal-input" value={form.seoTitle} onChange={e => setForm(f => ({ ...f, seoTitle: e.target.value }))} />
        </div>

        <div className="epg-modal-field">
          <label className="epg-modal-label">SEO Description</label>
          <textarea className="epg-modal-input epg-modal-textarea" value={form.seoDescription} onChange={e => setForm(f => ({ ...f, seoDescription: e.target.value }))} />
        </div>

        <div className="epg-modal-actions">
          <button className="epg-modal-cancel" onClick={onClose}>Cancel</button>
          <button className="epg-modal-save" onClick={() => onSave(form)}>
            {page ? 'Save Changes' : 'Create Page'}
          </button>
        </div>
      </div>
    </div>
  );
}
