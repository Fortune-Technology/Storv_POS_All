import { useState, useEffect } from 'react';
import { Plus, Save, Loader, Settings, Database, FileText, FileArchive, Image, Play, CheckCircle } from 'lucide-react';
import { toast } from 'react-toastify';

import { getAdminSystemConfig, updateAdminSystemConfig, downloadDatabaseBackup, getImageRehostStatus, triggerImageRehost } from '../services/api';
import '../styles/admin.css';
import './AdminSystemConfig.css';

interface SystemConfig {
  id: string | number;
  key: string;
  value: string;
  description?: string | null;
}

interface RehostStatus {
  total: number;
  rehosted: number;
  pending: number;
  diskSizeMB: number;
}

interface RehostResult {
  succeeded: number;
  failed: number;
  remaining: number;
}

const AdminSystemConfig = () => {
  const [configs, setConfigs] = useState<SystemConfig[]>([]);
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

  const handleSave = async (key: string, value: string, description: string | null) => {
    try {
      await updateAdminSystemConfig({ key, value, description });
      toast.success(`Config "${key}" saved`);
      fetchConfig();
    } catch (err: any) { toast.error(err?.response?.data?.error || 'Save failed'); }
  };

  const handleAdd = async () => {
    if (!newKey.trim() || !newValue.trim()) { toast.error('Key and value are required'); return; }
    await handleSave(newKey.trim(), newValue.trim(), newDesc.trim() || null);
    setNewKey(''); setNewValue(''); setNewDesc('');
  };

  /* ── Image Re-hosting logic ─────────────────────────────── */
  const [rehostStatus, setRehostStatus] = useState<RehostStatus | null>(null);
  const [rehostRunning, setRehostRunning] = useState(false);
  const [rehostResult, setRehostResult] = useState<RehostResult | null>(null);

  const fetchRehostStatus = async () => {
    try { setRehostStatus(await getImageRehostStatus()); }
    catch { /* ignore — feature may not be deployed yet */ }
  };
  useEffect(() => { fetchRehostStatus(); }, []);

  const handleRehost = async () => {
    setRehostRunning(true);
    setRehostResult(null);
    try {
      const res: RehostResult = await triggerImageRehost(200);
      setRehostResult(res);
      toast.success(`Re-hosted ${res.succeeded} images (${res.failed} failed, ${res.remaining} remaining)`);
      fetchRehostStatus();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Re-hosting failed');
    } finally {
      setRehostRunning(false);
    }
  };

  /* ── Backup logic ──────────────────────────────────────── */
  const [backupLoading, setBackupLoading] = useState<Record<string, boolean>>({});

  const fmtDate = (): string => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
  };

  const handleBackup = async (target: string, format: string) => {
    const key = `${target}_${format}`;
    setBackupLoading((s) => ({ ...s, [key]: true }));
    try {
      const res = await downloadDatabaseBackup(target, format);

      const dbName = target === 'main' ? 'main-backup' : 'ecom-backup';
      const ext = format === 'dump' ? 'dump' : 'sql';
      const filename = `${dbName}-${fmtDate()}.${ext}`;

      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);

      toast.success(`${target === 'main' ? 'Main' : 'E-commerce'} ${ext.toUpperCase()} backup downloaded`);
    } catch (err: any) {
      const msg = err?.response?.data?.error
        || err?.response?.data?.detail
        || 'Backup failed — is pg_dump installed?';
      toast.error(msg);
    } finally {
      setBackupLoading((s) => ({ ...s, [key]: false }));
    }
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

        {/* ── Database Backup ───────────────────────────────── */}
        <div className="asc-backup-section">
          <div className="asc-backup-header">
            <Database size={18} />
            <div>
              <h3 className="asc-backup-title">Database Backup</h3>
              <p className="asc-backup-desc">Download a full SQL dump of the selected database</p>
            </div>
          </div>

          <div className="asc-backup-cards">
            {[
              { key: 'main', label: 'Main Database', tag: 'POS \u00b7 Users \u00b7 Transactions' },
              { key: 'ecom', label: 'E-Commerce Database', tag: 'Storefront \u00b7 Orders \u00b7 Customers' },
            ].map((db) => (
              <div key={db.key} className="asc-backup-card">
                <div className="asc-backup-card-top">
                  <span className="asc-backup-card-label">{db.label}</span>
                  <span className="asc-backup-card-tag">{db.tag}</span>
                </div>
                <div className="asc-backup-btns">
                  <button
                    className="asc-fmt-btn"
                    onClick={() => handleBackup(db.key, 'sql')}
                    disabled={!!backupLoading[`${db.key}_sql`]}
                  >
                    {backupLoading[`${db.key}_sql`]
                      ? <><Loader size={13} className="asc-spin" /> .sql</>
                      : <><FileText size={13} /> .sql</>}
                    <span className="asc-fmt-hint">pgAdmin Query / psql</span>
                  </button>
                  <button
                    className="asc-fmt-btn"
                    onClick={() => handleBackup(db.key, 'dump')}
                    disabled={!!backupLoading[`${db.key}_dump`]}
                  >
                    {backupLoading[`${db.key}_dump`]
                      ? <><Loader size={13} className="asc-spin" /> .dump</>
                      : <><FileArchive size={13} /> .dump</>}
                    <span className="asc-fmt-hint">pgAdmin Restore / pg_restore</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Image Re-hosting ───────────────────────────────── */}
        {rehostStatus && (
          <div className="asc-backup-section">
            <div className="asc-backup-header">
              <Image size={18} />
              <div>
                <h3 className="asc-backup-title">Product Image Re-hosting</h3>
                <p className="asc-backup-desc">Download external product images to local storage for permanent hosting</p>
              </div>
            </div>

            <div className="asc-rehost-stats">
              <div className="asc-rehost-stat">
                <span className="asc-rehost-stat-value">{rehostStatus.total}</span>
                <span className="asc-rehost-stat-label">Total Images</span>
              </div>
              <div className="asc-rehost-stat asc-rehost-stat--success">
                <span className="asc-rehost-stat-value">{rehostStatus.rehosted}</span>
                <span className="asc-rehost-stat-label">Re-hosted</span>
              </div>
              <div className="asc-rehost-stat asc-rehost-stat--pending">
                <span className="asc-rehost-stat-value">{rehostStatus.pending}</span>
                <span className="asc-rehost-stat-label">Pending</span>
              </div>
              <div className="asc-rehost-stat">
                <span className="asc-rehost-stat-value">{rehostStatus.diskSizeMB} MB</span>
                <span className="asc-rehost-stat-label">Disk Used</span>
              </div>
            </div>

            {rehostStatus.pending > 0 && (
              <div className="asc-rehost-actions">
                <button
                  className="admin-btn-primary"
                  onClick={handleRehost}
                  disabled={rehostRunning}
                >
                  {rehostRunning
                    ? <><Loader size={14} className="asc-spin" /> Processing...</>
                    : <><Play size={14} /> Re-host Next 200 Images</>}
                </button>
                {rehostResult && (
                  <span className="asc-rehost-result">
                    <CheckCircle size={14} />
                    {rehostResult.succeeded} downloaded, {rehostResult.remaining} remaining
                  </span>
                )}
              </div>
            )}

            {rehostStatus.pending === 0 && rehostStatus.total > 0 && (
              <div className="asc-rehost-done">
                <CheckCircle size={16} />
                All images re-hosted successfully
              </div>
            )}
          </div>
        )}

        {/* ── Add new config ────────────────────────────────── */}
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

interface ConfigRowProps {
  config: SystemConfig;
  onSave: (key: string, value: string, description: string | null) => void;
}

const ConfigRow = ({ config, onSave }: ConfigRowProps) => {
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
