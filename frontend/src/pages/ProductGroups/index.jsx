/**
 * ProductGroups — manage template groups for shared classification and pricing.
 *
 * A group holds template fields (dept, tax, age, EBT, deposit, pricing). When
 * autoSync is on, editing the group cascades the changes to all member products.
 *
 * Components in this folder:
 *   • index.jsx           — main page (this file)
 *   • GroupForm.jsx       — create/edit modal
 *   • GroupDetailModal.jsx — view/edit/manage members modal
 *   • MembersTab.jsx      — bulk add/remove members (S69 / C12)
 *   • ProductGroups.css   — shared styles (pg- prefix)
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Users as UsersIcon, Plus, Edit2, Trash2, RefreshCw,
  Loader, Check, DollarSign, Eye,
} from 'lucide-react';
import { toast } from 'react-toastify';
import {
  listProductGroups, createProductGroup, updateProductGroup, deleteProductGroup,
  applyGroupTemplate, getCatalogDepartments, getCatalogVendors, getProductGroup,
} from '../../services/api';
import { useConfirm } from '../../hooks/useConfirmDialog.jsx';
import GroupForm from './GroupForm.jsx';
import GroupDetailModal from './GroupDetailModal.jsx';
import '../../styles/portal.css';
import './ProductGroups.css';

export default function ProductGroups() {
  const confirm = useConfirm();
  const [groups,      setGroups]      = useState([]);
  const [departments, setDepartments] = useState([]);
  const [vendors,     setVendors]     = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [saving,      setSaving]      = useState(false);
  const [showForm,    setShowForm]    = useState(false);
  const [editing,     setEditing]     = useState(null);
  const [viewing,     setViewing]     = useState(null);
  const [applying,    setApplying]    = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [g, d, v] = await Promise.all([
        listProductGroups(),
        getCatalogDepartments(),
        getCatalogVendors(),
      ]);
      setGroups(g?.data || g || []);
      setDepartments(d?.data || d || []);
      setVendors(v?.data || v || []);
    } catch {
      toast.error('Failed to load groups');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = () => { setEditing(null); setShowForm(true); };
  const handleEdit = (g) => { setEditing(g); setShowForm(true); };

  const handleSave = async (payload) => {
    setSaving(true);
    try {
      if (editing) {
        const res = await updateProductGroup(editing.id, payload);
        if (res.cascaded > 0) {
          toast.success(`Group saved — cascaded to ${res.cascaded} product(s)`);
        } else {
          toast.success('Group saved');
        }
      } else {
        await createProductGroup(payload);
        toast.success('Group created');
      }
      setShowForm(false);
      setEditing(null);
      load();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (g) => {
    if (!await confirm({
      title: `Delete group "${g.name}"?`,
      message: 'Member products will be unlinked but NOT deleted. Their existing classification + pricing fields are kept.',
      confirmLabel: 'Delete group',
      danger: true,
    })) return;
    try {
      await deleteProductGroup(g.id);
      toast.success('Group deleted');
      load();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Delete failed');
    }
  };

  const handleApply = async (g) => {
    if (!await confirm({
      title: `Apply template from "${g.name}"?`,
      message: `This will overwrite the current classification and pricing fields on all ${g._count?.products || 0} member products.`,
      confirmLabel: 'Apply template',
      danger: true,
    })) return;
    setApplying(g.id);
    try {
      const res = await applyGroupTemplate(g.id);
      toast.success(`Applied to ${res.updated} product(s)`);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Apply failed');
    } finally {
      setApplying(null);
    }
  };

  // When MembersTab adds/removes products, reload the viewed group so the
  // count + product list refresh; reload the table so list-row counts stay
  // accurate.
  const handleMembersChanged = async () => {
    if (!viewing?.id) return;
    try {
      const r = await getProductGroup(viewing.id);
      const fresh = r?.data || r;
      if (fresh) setViewing(fresh);
    } catch { /* swallow — modal will close anyway */ }
    load();
  };

  // Open detail with a fresh fetch so we get the products array (the list
  // endpoint only returns _count.products to keep the payload small).
  const openDetail = async (g) => {
    try {
      const r = await getProductGroup(g.id);
      setViewing(r?.data || r || g);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to load group');
    }
  };

  return (
    <div className="p-page">
      <div className="p-header">
        <div className="p-header-left">
          <div className="p-header-icon"><UsersIcon size={22} /></div>
          <div>
            <h1 className="p-title">Product Groups</h1>
            <p className="p-subtitle">Template groups with shared classification and pricing</p>
          </div>
        </div>
        <div className="p-header-actions">
          <button onClick={load} className="pc-refresh-btn" disabled={loading}>
            <RefreshCw size={14} />
          </button>
          <button onClick={handleCreate} className="pc-add-btn">
            <Plus size={14} /> New Group
          </button>
        </div>
      </div>

      {loading && (
        <div className="pg-loading"><Loader size={18} className="p-spin" /> Loading groups…</div>
      )}

      {!loading && groups.length === 0 && (
        <div className="pg-empty">
          <UsersIcon size={40} className="pg-empty-icon" />
          <div className="pg-empty-title">No product groups yet</div>
          <div className="pg-empty-desc">
            Create a group to share classification and pricing across multiple products.
            Great for "750ml Red Wine" or "12oz Can Beer" style groupings.
          </div>
          <button onClick={handleCreate} className="pc-empty-add-btn">
            <Plus size={14} /> Create First Group
          </button>
        </div>
      )}

      {!loading && groups.length > 0 && (
        <div className="pg-table-wrap">
          <table className="pg-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Department</th>
                <th>Tax / Age</th>
                <th>Price</th>
                <th>Sale</th>
                <th>Members</th>
                <th>Sync</th>
                <th style={{ textAlign: 'left' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {groups.map(g => (
                <tr key={g.id}>
                  <td>
                    <div className="pg-name-row">
                      {g.color && <span className="pg-color-chip" style={{ background: g.color }} />}
                      <strong>{g.name}</strong>
                      {g.allowMixMatch === false && (
                        <span className="pg-badge pg-badge-warn" title="Mix-and-match promotions are blocked for this group">
                          no mix-match
                        </span>
                      )}
                    </div>
                    {g.description && <div className="pg-desc">{g.description}</div>}
                  </td>
                  <td>{g.department?.name || 'N/A'}</td>
                  <td>
                    {g.taxClass ? <span className="pg-badge">{g.taxClass}</span> : 'N/A'}
                    {g.ageRequired && <span className="pg-badge pg-badge-warn">{g.ageRequired}+</span>}
                  </td>
                  <td className="pg-td-mono">
                    {g.defaultRetailPrice != null ? `$${Number(g.defaultRetailPrice).toFixed(2)}` : 'N/A'}
                  </td>
                  <td className="pg-td-mono">
                    {g.salePrice != null ? (
                      <span className="pg-sale"><DollarSign size={10} />{Number(g.salePrice).toFixed(2)}</span>
                    ) : 'N/A'}
                  </td>
                  <td>
                    <span className="pg-member-count">{g._count?.products || 0}</span>
                  </td>
                  <td>
                    {g.autoSync ? (
                      <span className="pg-sync-on"><Check size={11} /> Auto</span>
                    ) : (
                      <span className="pg-sync-off">Manual</span>
                    )}
                  </td>
                  <td>
                    <div className="pg-actions">
                      <button onClick={() => openDetail(g)} className="pg-btn-icon" title="View details">
                        <Eye size={13} />
                      </button>
                      {!g.autoSync && (
                        <button onClick={() => handleApply(g)} disabled={applying === g.id}
                          className="pg-btn-icon" title="Apply template to all members">
                          {applying === g.id ? <Loader size={13} className="p-spin" /> : <RefreshCw size={13} />}
                        </button>
                      )}
                      <button onClick={() => handleEdit(g)} className="pg-btn-icon" title="Edit">
                        <Edit2 size={13} />
                      </button>
                      <button onClick={() => handleDelete(g)} className="pg-btn-icon pg-btn-icon-danger" title="Delete">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <GroupForm
          group={editing}
          departments={departments}
          vendors={vendors}
          onSave={handleSave}
          onClose={() => { setShowForm(false); setEditing(null); }}
          saving={saving}
        />
      )}

      {viewing && (
        <GroupDetailModal
          group={viewing}
          departments={departments}
          vendors={vendors}
          onClose={() => setViewing(null)}
          onEdit={handleEdit}
          onMembersChanged={handleMembersChanged}
        />
      )}
    </div>
  );
}
