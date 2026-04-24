import { useState, useEffect } from 'react';
import { Plus, Edit3, Trash2, Eye, EyeOff, Loader, X, FileText } from 'lucide-react';
import { toast } from 'react-toastify';

import RichTextEditor from '../components/RichTextEditor';
import { getAdminCmsPages, createAdminCmsPage, updateAdminCmsPage, deleteAdminCmsPage } from '../services/api';
import '../styles/admin.css';
import './AdminCmsPages.css';

const toSlug = (str: string): string => str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

interface CmsPage {
  id: string | number;
  title: string;
  slug: string;
  content: string;
  metaTitle?: string;
  metaDesc?: string;
  published?: boolean;
  sortOrder?: number;
  updatedAt?: string;
}

type ModalState = { mode: 'create' | 'edit'; data: CmsPage } | null;

const AdminCmsPages = () => {
  const [pages, setPages] = useState<CmsPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<ModalState>(null);

  const fetchPages = async () => {
    setLoading(true);
    try {
      const res = await getAdminCmsPages();
      setPages(res.data);
    } catch { toast.error('Failed to load CMS pages'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchPages(); }, []);

  const handleSave = async (formData: CmsPage) => {
    if (!modal) return;
    try {
      if (modal.mode === 'create') {
        await createAdminCmsPage(formData);
        toast.success('Page created');
      } else {
        await updateAdminCmsPage(modal.data.id, formData);
        toast.success('Page updated');
      }
      setModal(null);
      fetchPages();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Save failed');
    }
  };

  const handleDelete = async (id: string | number) => {
    if (!window.confirm('Delete this page?')) return;
    try {
      await deleteAdminCmsPage(id);
      toast.success('Page deleted');
      fetchPages();
    } catch { toast.error('Delete failed'); }
  };

  const emptyPage: CmsPage = { id: '', title: '', slug: '', content: '', metaTitle: '', metaDesc: '', published: false, sortOrder: 0 };

  return (
    <>
        <div className="admin-header">
          <div className="admin-header-left">
            <div className="admin-header-icon"><FileText size={22} /></div>
            <div>
              <h1>CMS Pages</h1>
              <p>Manage marketing site content</p>
            </div>
          </div>
          <button onClick={() => setModal({ mode: 'create', data: emptyPage })}
            className="admin-btn-primary">
            <Plus size={14} /> New Page
          </button>
        </div>

        {loading ? (
          <div className="admin-loading"><Loader className="animate-spin" size={20} /></div>
        ) : pages.length === 0 ? (
          <div className="admin-empty">
            <FileText size={40} className="admin-empty-icon" />
            <p className="admin-empty-text">No CMS pages yet</p>
            <button onClick={() => setModal({ mode: 'create', data: emptyPage })}
              className="admin-btn-primary admin-btn-primary-lg">
              <Plus size={16} /> Create First Page
            </button>
          </div>
        ) : (
          <div className="admin-card-list">
            {pages.map(p => (
              <div key={p.id} className="admin-card">
                <div>
                  <div className="admin-card-header-row">
                    <span className="admin-card-title">{p.title}</span>
                    <span className="mono acms-slug">/{p.slug}</span>
                    {p.published ? (
                      <span className="admin-badge sm active"><Eye size={10} /> Published</span>
                    ) : (
                      <span className="admin-badge sm pending"><EyeOff size={10} /> Draft</span>
                    )}
                  </div>
                  <div className="admin-card-meta">
                    Updated {p.updatedAt ? new Date(p.updatedAt).toLocaleDateString() : '-'}
                  </div>
                </div>
                <div className="admin-card-actions">
                  <button onClick={() => setModal({ mode: 'edit', data: p })} className="admin-btn-icon">
                    <Edit3 size={13} />
                  </button>
                  <button onClick={() => handleDelete(p.id)} className="admin-btn-icon danger">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Modal */}
        {modal && <CmsModal mode={modal.mode} data={modal.data} onSave={handleSave} onClose={() => setModal(null)} />}
    </>
  );
};

interface CmsModalProps {
  mode: 'create' | 'edit';
  data: CmsPage;
  onSave: (form: CmsPage) => void;
  onClose: () => void;
}

const CmsModal = ({ mode, data, onSave, onClose }: CmsModalProps) => {
  const [form, setForm] = useState<CmsPage>({ ...data });
  const [slugEdited, setSlugEdited] = useState(mode === 'edit');

  const handleTitleChange = (val: string) => {
    if (!slugEdited) {
      setForm(f => ({ ...f, title: val, slug: toSlug(val) }));
    } else {
      setForm(f => ({ ...f, title: val }));
    }
  };

  return (
    <div className="admin-modal-overlay" onClick={onClose}>
      <div className="admin-modal" onClick={e => e.stopPropagation()}>
        <div className="admin-modal-header">
          <h2 className="admin-modal-title">{mode === 'create' ? 'New Page' : 'Edit Page'}</h2>
          <button onClick={onClose} className="admin-modal-close"><X size={18} /></button>
        </div>
        <div className="admin-modal-form">
          <div className="admin-modal-field">
            <label>Title</label>
            <input value={form.title} onChange={e => handleTitleChange(e.target.value)} />
          </div>
          <div className="admin-modal-field">
            <label>Slug</label>
            <input className="mono" value={form.slug} onChange={e => { setSlugEdited(true); setForm(f => ({ ...f, slug: e.target.value })); }} />
          </div>
          <div className="admin-modal-field">
            <label>Content</label>
            <RichTextEditor value={form.content} onChange={(val: string) => setForm(f => ({ ...f, content: val }))} placeholder="Write page content..." />
          </div>
          <div className="admin-modal-row">
            <div className="admin-modal-field">
              <label>Meta Title</label>
              <input value={form.metaTitle || ''} onChange={e => setForm(f => ({ ...f, metaTitle: e.target.value }))} />
            </div>
            <div className="admin-modal-field">
              <label>Sort Order</label>
              <input type="number" value={form.sortOrder || 0} onChange={e => setForm(f => ({ ...f, sortOrder: parseInt(e.target.value) || 0 }))} />
            </div>
          </div>
          <div className="admin-modal-field">
            <label>Meta Description</label>
            <input value={form.metaDesc || ''} onChange={e => setForm(f => ({ ...f, metaDesc: e.target.value }))} />
          </div>
          <label className="admin-checkbox-label">
            <input type="checkbox" checked={form.published || false} onChange={e => setForm(f => ({ ...f, published: e.target.checked }))} />
            <span>Published</span>
          </label>
        </div>
        <div className="admin-modal-footer">
          <button onClick={onClose} className="admin-modal-cancel">Cancel</button>
          <button onClick={() => onSave(form)} className="admin-modal-save">Save</button>
        </div>
      </div>
    </div>
  );
};

export default AdminCmsPages;
