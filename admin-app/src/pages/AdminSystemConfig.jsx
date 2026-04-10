import React, { useState, useEffect } from 'react';
import { Plus, Save, Trash2, Loader, Settings } from 'lucide-react';
import { toast } from 'react-toastify';

import { getAdminSystemConfig, updateAdminSystemConfig } from '../services/api';
import '../styles/admin.css';
import './AdminSystemConfig.css';

const AdminSystemConfig = () => {
  const [configs, setConfigs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [newDesc, setNewDesc] = useState('');

  const fetchConfig = async () => {
    setLoading(true);
    try { const res = await getAdminSystemConfig(); setConfigs(res.data); }
    catch { toast.error('Failed to load config'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchConfig(); }, []);

  const handleSave = async (key, value, description) => {
    try {
      await updateAdminSystemConfig({ key, value, description });
      toast.success(`Config "${key}" saved`);
      fetchConfig();
    } catch (err) { toast.error(err.response?.data?.error || 'Save failed'); }
  };

  const handleAdd = async () => {
    if (!newKey.trim() || !newValue.trim()) { toast.error('Key and value are required'); return; }
    await handleSave(newKey.trim(), newValue.trim(), newDesc.trim() || null);
    setNewKey(''); setNewValue(''); setNewDesc('');
  };

  return (
    <>
        <div className="admin-header">
          <div className="admin-header-left">
            <div className="admin-header-icon"><Settings size={22} /></div>
            <div>
              <h1>System Configuration</h1>
              <p>Global key-value settings</p>
            </div>
          </div>
        </div>

        {/* Add new config */}
        <div className="admin-add-form">
          <div className="admin-add-form-title">Add New Setting</div>
          <div className="admin-add-form-grid">
            <div>
              <label className="admin-add-form-label">Key</label>
              <input value={newKey} onChange={e => setNewKey(e.target.value)} placeholder="e.g. maintenance_mode" className="admin-config-input" />
            </div>
            <div>
              <label className="admin-add-form-label">Value</label>
              <input value={newValue} onChange={e => setNewValue(e.target.value)} placeholder="e.g. false" className="admin-config-input" />
            </div>
            <div>
              <label className="admin-add-form-label">Description</label>
              <input value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="Optional description" className="admin-config-input" />
            </div>
            <button onClick={handleAdd} className="admin-btn-primary">
              <Plus size={13} /> Add
            </button>
          </div>
        </div>

        {/* Existing configs */}
        {loading ? (
          <div className="admin-loading"><Loader className="animate-spin" size={20} /></div>
        ) : configs.length === 0 ? (
          <div className="admin-empty">No system settings configured</div>
        ) : (
          <div className="admin-card-list">
            {configs.map(c => (
              <ConfigRow key={c.id} config={c} onSave={handleSave} />
            ))}
          </div>
        )}
    </>
  );
};

const ConfigRow = ({ config, onSave }) => {
  const [value, setValue] = useState(config.value);
  const [desc, setDesc] = useState(config.description || '');
  const changed = value !== config.value || desc !== (config.description || '');

  return (
    <div className="admin-config-row">
      <div className="admin-config-key">{config.key}</div>
      <input value={value} onChange={e => setValue(e.target.value)} className="admin-config-input" />
      <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="Description" className="admin-config-desc" />
      <button onClick={() => onSave(config.key, value, desc || null)} disabled={!changed}
        className={`admin-btn-primary ${changed ? 'asc-save-enabled' : 'asc-save-disabled'}`}>
        <Save size={12} /> Save
      </button>
    </div>
  );
};

export default AdminSystemConfig;
