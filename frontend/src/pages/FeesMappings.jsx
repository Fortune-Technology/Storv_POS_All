import React, { useState, useEffect } from 'react';
import { Search, Plus, Edit, Trash2, Save, X, Settings2, Info, DollarSign } from 'lucide-react';
import { getFeeMappings, upsertFeeMapping, deleteFeeMapping } from '../services/api';
import { toast } from 'react-toastify';
import './FeesMappings.css';

const FeesMappings = () => {
  const [mappings, setMappings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editingMapping, setEditingMapping] = useState(null);

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
      <div className="p-page animate-fade-in">
        <div className="p-header">
          <div className="p-header-left">
            <div className="p-header-icon">
              <DollarSign size={22} />
            </div>
            <div>
              <h1 className="p-title">Fees Mappings Module</h1>
              <p className="p-subtitle">Manage fee types and their mapped values in MongoDB.</p>
            </div>
          </div>
          <div className="p-header-actions">
            <button
              onClick={() => setEditingMapping({ feeType: '', mappedValue: '', description: '' })}
              className="btn btn-primary fm-add-btn"
            >
              <Plus size={18} className="fm-add-icon" /> Add Fee Mapping
            </button>
          </div>
        </div>

        <div className="glass-card fm-card">
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th className="fm-th-type">Fee Type</th>
                  <th className="fm-th-value">Mapped Value</th>
                  <th>Description</th>
                  <th className="fm-th-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {mappings.map((mapping) => (
                  <tr key={mapping.id}>
                    <td className="fm-td-bold">{mapping.feeType}</td>
                    <td><code className="fm-code">{mapping.mappedValue}</code></td>
                    <td><span className="fm-desc">{mapping.description || 'N/A'}</span></td>
                    <td className="fm-td-actions">
                      <div className="fm-actions-row">
                        <button
                          onClick={() => setEditingMapping(mapping)}
                          className="btn btn-secondary fm-btn-edit"
                        >
                          <Edit size={16} />
                        </button>
                        <button
                          onClick={() => handleDelete(mapping.id)}
                          className="btn btn-secondary fm-btn-delete"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {mappings.length === 0 && (
                    <tr>
                        <td colSpan="4" className="fm-empty">
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
          <div className="fm-modal-overlay">
            <div className="glass-card animate-fade-in fm-modal-card">
               <button
                onClick={() => setEditingMapping(null)}
                className="fm-modal-close"
              >
                <X size={24} />
              </button>

              <h2 className="fm-modal-title">{editingMapping.id ? 'Edit' : 'Add'} Fee Mapping</h2>

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
                        className="form-input fm-textarea"
                        placeholder="Internal notes about this mapping..."
                        value={editingMapping.description || ''}
                        onChange={(e) => setEditingMapping({ ...editingMapping, description: e.target.value })}
                    ></textarea>
                </div>

                <div className="fm-modal-actions">
                    <button type="button" onClick={() => setEditingMapping(null)} className="btn btn-secondary fm-modal-btn">Cancel</button>
                    <button type="submit" className="btn btn-primary fm-modal-btn" disabled={loading}>
                        {loading ? 'Saving...' : <>Save Mapping <Save size={18} className="fm-save-icon" /></>}
                    </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
  );
};

export default FeesMappings;
