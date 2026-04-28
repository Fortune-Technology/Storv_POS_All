import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Edit3, Trash2, Eye, EyeOff, Loader, X, Users, Briefcase } from 'lucide-react';
import { toast } from 'react-toastify';

import RichTextEditor from '../components/RichTextEditor';
import { getAdminCareers, createAdminCareer, updateAdminCareer, deleteAdminCareer } from '../services/api';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { useConfirm } from '../hooks/useConfirmDialog.jsx';
import '../styles/admin.css';
import './AdminCareers.css';

const JOB_TYPES = ['full-time', 'part-time', 'contract', 'internship'];

interface Career {
  id: string | number;
  title: string;
  department?: string;
  location?: string;
  type?: string;
  description?: string;
  published?: boolean;
}

type ModalState = { mode: 'create' | 'edit'; data: Career } | null;

const AdminCareers = () => {
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [careers, setCareers] = useState<Career[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<ModalState>(null);

  const fetchCareers = async () => {
    setLoading(true);
    try { const res = await getAdminCareers(); setCareers(res.data); }
    catch { toast.error('Failed to load careers'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchCareers(); }, []);

  const handleSave = async (formData: Career) => {
    if (!modal) return;
    try {
      if (modal.mode === 'create') { await createAdminCareer(formData); toast.success('Career posted'); }
      else { await updateAdminCareer(modal.data.id, formData); toast.success('Career updated'); }
      setModal(null); fetchCareers();
    } catch (err: any) { toast.error(err?.response?.data?.error || 'Save failed'); }
  };

  const handleDelete = async (id: string | number) => {
    if (!await confirm({
      title: 'Delete posting?',
      message: 'Delete this posting?',
      confirmLabel: 'Delete',
      danger: true,
    })) return;
    try { await deleteAdminCareer(id); toast.success('Deleted'); fetchCareers(); }
    catch { toast.error('Delete failed'); }
  };

  const emptyCareer: Career = { id: '', title: '', department: '', location: '', type: 'full-time', description: '', published: false };

  return (
    <>
        <div className="admin-header">
          <div className="admin-header-left">
            <div className="admin-header-icon"><Briefcase size={22} /></div>
            <div>
              <h1>Career Postings</h1>
              <p>Manage job listings</p>
            </div>
          </div>
          <button onClick={() => setModal({ mode: 'create', data: emptyCareer })}
            className="admin-btn-primary">
            <Plus size={14} /> New Posting
          </button>
        </div>

        {loading ? (
          <div className="admin-loading"><Loader className="animate-spin" size={20} /></div>
        ) : careers.length === 0 ? (
          <div className="admin-empty">
            <Briefcase size={40} className="admin-empty-icon" />
            <p className="admin-empty-text">No career postings yet</p>
            <button onClick={() => setModal({ mode: 'create', data: emptyCareer })}
              className="admin-btn-primary admin-btn-primary-lg">
              <Plus size={16} /> Create First Posting
            </button>
          </div>
        ) : (
          <div className="admin-card-list">
            {careers.map(c => (
              <div key={c.id} className="admin-card">
                <div>
                  <div className="admin-card-header-row">
                    <span className="admin-card-title">{c.title}</span>
                    {c.department && <span className="admin-badge sm staff">{c.department}</span>}
                    {c.type && <span className="admin-badge sm manager">{c.type}</span>}
                    {c.published ? (
                      <span className="admin-badge sm active"><Eye size={10} /> Published</span>
                    ) : (
                      <span className="admin-badge sm pending"><EyeOff size={10} /> Draft</span>
                    )}
                  </div>
                  {c.location && <div className="admin-card-meta">{c.location}</div>}
                </div>
                <div className="admin-card-actions">
                  <button onClick={() => navigate(`/careers/${c.id}/applications`)} className="admin-btn-secondary acr-app-btn">
                    <Users size={12} /> Applications
                  </button>
                  <button onClick={() => setModal({ mode: 'edit', data: c })} className="admin-btn-icon"><Edit3 size={13} /></button>
                  <button onClick={() => handleDelete(c.id)} className="admin-btn-icon danger"><Trash2 size={13} /></button>
                </div>
              </div>
            ))}
          </div>
        )}

        {modal && (
          <div className="admin-modal-overlay" onClick={() => setModal(null)}>
            <div className="admin-modal acr-modal-size" onClick={e => e.stopPropagation()}>
              <div className="admin-modal-header">
                <h2 className="admin-modal-title">{modal.mode === 'create' ? 'New Posting' : 'Edit Posting'}</h2>
                <button onClick={() => setModal(null)} className="admin-modal-close"><X size={18} /></button>
              </div>
              <CareerForm data={modal.data} onSave={handleSave} onCancel={() => setModal(null)} />
            </div>
          </div>
        )}
    </>
  );
};

interface CareerFormProps {
  data: Career;
  onSave: (form: Career) => void;
  onCancel: () => void;
}

const CareerForm = ({ data, onSave, onCancel }: CareerFormProps) => {
  const [form, setForm] = useState<Career>({ ...data });
  return (
    <div className="admin-modal-form">
      <div className="admin-modal-field">
        <label>Title</label>
        <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
      </div>
      <div className="admin-modal-row">
        <div className="admin-modal-field">
          <label>Department</label>
          <input value={form.department || ''} onChange={e => setForm(f => ({ ...f, department: e.target.value }))} placeholder="e.g. Engineering" />
        </div>
        <div className="admin-modal-field">
          <label>Location</label>
          <input value={form.location || ''} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} placeholder="e.g. Remote" />
        </div>
      </div>
      <div className="admin-modal-field">
        <label>Type</label>
        <select value={form.type || 'full-time'} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
          {JOB_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div className="admin-modal-field">
        <label>Description</label>
        <RichTextEditor value={form.description || ''} onChange={(val: string) => setForm(f => ({ ...f, description: val }))} placeholder="Write job description..." />
      </div>
      <label className="admin-checkbox-label">
        <input type="checkbox" checked={form.published || false} onChange={e => setForm(f => ({ ...f, published: e.target.checked }))} />
        <span>Published</span>
      </label>
      <div className="admin-modal-footer">
        <button onClick={onCancel} className="admin-modal-cancel">Cancel</button>
        <button onClick={() => onSave(form)} className="admin-modal-save">Save</button>
      </div>
    </div>
  );
};

export default AdminCareers;
