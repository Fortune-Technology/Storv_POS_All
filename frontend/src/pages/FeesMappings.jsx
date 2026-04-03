import React, { useState, useEffect } from 'react';
import { Search, Plus, Edit, Trash2, Save, X, Settings2, Info } from 'lucide-react';
import Sidebar from '../components/Sidebar';
import { getFeeMappings, upsertFeeMapping, deleteFeeMapping } from '../services/api';
import { toast } from 'react-toastify';

const FeesMappings = () => {
  const [mappings, setMappings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editingMapping, setEditingMapping] = useState(null); // { feeType: '', mappedValue: '', description: '' }

  useEffect(() => {
    fetchMappings();
  }, []);

  const fetchMappings = async () => {
    try {
      const { data } = await getFeeMappings();
      setMappings(data);
    } catch (error) {
      toast.error('Error fetching fee mappings');
    }
  };

  const handleUpsert = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await upsertFeeMapping(editingMapping);
      toast.success('Fee mapping saved');
      setEditingMapping(null);
      fetchMappings();
    } catch (error) {
      toast.error('Error saving mapping');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this mapping?')) return;
    try {
      await deleteFeeMapping(id);
      toast.success('Fee mapping deleted');
      fetchMappings();
    } catch (error) {
      toast.error('Error deleting mapping');
    }
  };

  return (
    <div className="layout-container">
      <Sidebar />
      <main className="main-content animate-fade-in">
        <header style={{ marginBottom: '2.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Fees Mappings Module</h1>
            <p style={{ color: 'var(--text-secondary)' }}>Manage fee types and their mapped values in MongoDB.</p>
          </div>
          <button 
            onClick={() => setEditingMapping({ feeType: '', mappedValue: '', description: '' })} 
            className="btn btn-primary" 
            style={{ padding: '0.875rem 2rem' }}
          >
            <Plus size={18} style={{ marginRight: '0.5rem' }} /> Add Fee Mapping
          </button>
        </header>

        <div className="glass-card" style={{ padding: '1.5rem' }}>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th style={{ width: '250px' }}>Fee Type</th>
                  <th style={{ width: '250px' }}>Mapped Value</th>
                  <th>Description</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {mappings.map((mapping) => (
                  <tr key={mapping._id}>
                    <td style={{ fontWeight: 600 }}>{mapping.feeType}</td>
                    <td><code style={{ background: 'rgba(255,221,100,0.1)', color: '#ffd700', padding: '0.2rem 0.5rem', borderRadius: '4px' }}>{mapping.mappedValue}</code></td>
                    <td><span style={{ color: 'var(--text-secondary)' }}>{mapping.description || 'N/A'}</span></td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                        <button 
                          onClick={() => setEditingMapping(mapping)}
                          className="btn btn-secondary" 
                          style={{ padding: '0.5rem', color: 'var(--accent-primary)' }}
                        >
                          <Edit size={16} />
                        </button>
                        <button 
                          onClick={() => handleDelete(mapping._id)}
                          className="btn btn-secondary" 
                          style={{ padding: '0.5rem', color: 'var(--error)' }}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {mappings.length === 0 && (
                    <tr>
                        <td colSpan="4" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                            No fee mappings found.
                        </td>
                    </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Upsert Modal */}
        {editingMapping && (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div className="glass-card animate-fade-in" style={{ width: '90%', maxWidth: '500px', padding: '2.5rem', position: 'relative' }}>
               <button 
                onClick={() => setEditingMapping(null)}
                style={{ position: 'absolute', top: '1.5rem', right: '1.5rem', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <X size={24} />
              </button>

              <h2 style={{ fontSize: '1.75rem', marginBottom: '1.5rem' }}>{editingMapping._id ? 'Edit' : 'Add'} Fee Mapping</h2>
              
              <form onSubmit={handleUpsert}>
                <div className="form-group">
                  <label className="form-label">Fee Type</label>
                  <input 
                    type="text" 
                    className="form-input" 
                    placeholder="e.g. Credit Card Fee"
                    value={editingMapping.feeType}
                    onChange={(e) => setEditingMapping({ ...editingMapping, feeType: e.target.value })}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Mapped Value</label>
                  <input 
                    type="text" 
                    className="form-input" 
                    placeholder="e.g. CC_FEE_01"
                    value={editingMapping.mappedValue}
                    onChange={(e) => setEditingMapping({ ...editingMapping, mappedValue: e.target.value })}
                    required
                  />
                </div>

                <div className="form-group">
                    <label className="form-label">Description (Optional)</label>
                    <textarea 
                        className="form-input" 
                        style={{ height: '100px', resize: 'none' }}
                        placeholder="Internal notes about this mapping..."
                        value={editingMapping.description || ''}
                        onChange={(e) => setEditingMapping({ ...editingMapping, description: e.target.value })}
                    ></textarea>
                </div>

                <div style={{ display: 'flex', gap: '1rem', marginTop: '2rem' }}>
                    <button type="button" onClick={() => setEditingMapping(null)} className="btn btn-secondary" style={{ flex: 1 }}>Cancel</button>
                    <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={loading}>
                        {loading ? 'Saving...' : <>Save Mapping <Save size={18} style={{ marginLeft: '0.5rem' }} /></>}
                    </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default FeesMappings;
