/**
 * GroupDetailModal — view-only details + bulk member management.
 *
 * S69 (C12): added Members tab with searchable add + multi-select remove.
 * Backend endpoints already exist (/groups/:id/add-products,
 * /groups/:id/remove-products); admins previously had to assign products
 * one-at-a-time via ProductForm.
 */

import React, { useState } from 'react';
import { Users as UsersIcon, X, Edit2, Info, ListChecks } from 'lucide-react';
import MembersTab from './MembersTab.jsx';

function DetailField({ label, value, mono }) {
  return (
    <div>
      <div className="pg-label">{label}</div>
      <div className={mono ? 'pg-td-mono' : ''} style={{ fontSize: '0.88rem', fontWeight: 600 }}>
        {value}
      </div>
    </div>
  );
}

function DetailsTab({ group, departments, vendors }) {
  const dept   = departments.find(d => String(d.id) === String(group.departmentId));
  const vendor = vendors.find(v => String(v.id) === String(group.vendorId));
  const fmt$   = (n) => (n != null ? `$${Number(n).toFixed(2)}` : '—');
  const fmtBool = (b) => b == null ? '—' : (b ? 'Yes' : 'No');
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString() : '—';

  return (
    <>
      {group.description && (
        <div className="pg-desc" style={{ marginBottom: '0.75rem' }}>{group.description}</div>
      )}

      <div className="pg-section-label">Members</div>
      <div className="pg-grid-3">
        <DetailField label="Member products" value={String(group._count?.products ?? group.products?.length ?? 0)} />
        <DetailField label="Auto-sync" value={group.autoSync ? 'Yes — cascades on save' : 'Manual'} />
        <DetailField label="Status" value={group.active ? 'Active' : 'Inactive'} />
      </div>

      <div className="pg-section-label">Classification</div>
      <div className="pg-grid-2">
        <DetailField label="Department" value={dept?.name || '—'} />
        <DetailField label="Default Vendor" value={vendor?.name || '—'} />
      </div>
      <div className="pg-grid-2">
        <DetailField label="Tax Class" value={group.taxClass || '—'} />
        <DetailField label="Age Required" value={group.ageRequired ? `${group.ageRequired}+` : '—'} />
      </div>
      <div className="pg-grid-3">
        <DetailField label="EBT Eligible" value={fmtBool(group.ebtEligible)} />
        <DetailField label="Taxable" value={fmtBool(group.taxable)} />
        <DetailField label="Discount Eligible" value={fmtBool(group.discountEligible)} />
      </div>

      <div className="pg-section-label">Size & Pack</div>
      <div className="pg-grid-3">
        <DetailField label="Size" value={group.size ? `${group.size} ${group.sizeUnit || ''}`.trim() : '—'} />
        <DetailField label="Pack" value={group.pack != null ? String(group.pack) : '—'} />
        <DetailField label="Case Packs" value={group.casePacks != null ? String(group.casePacks) : '—'} />
      </div>

      <div className="pg-section-label">Default Pricing</div>
      <div className="pg-grid-3">
        <DetailField label="Retail Price" value={fmt$(group.defaultRetailPrice)} mono />
        <DetailField label="Cost Price" value={fmt$(group.defaultCostPrice)} mono />
        <DetailField label="Case Cost" value={fmt$(group.defaultCasePrice)} mono />
      </div>

      <div className="pg-section-label">Sale Price</div>
      <div className="pg-grid-3">
        <DetailField label="Sale Price" value={fmt$(group.salePrice)} mono />
        <DetailField label="Start" value={fmtDate(group.saleStart)} />
        <DetailField label="End" value={fmtDate(group.saleEnd)} />
      </div>

      <div className="pg-section-label">Promotion Eligibility</div>
      <div className="pg-grid-2">
        <DetailField
          label="Mix-and-Match Allowed"
          value={group.allowMixMatch === false ? 'NO — blocks mix_match promos' : 'Yes'}
        />
      </div>
    </>
  );
}

export default function GroupDetailModal({ group, departments, vendors, onClose, onEdit, onMembersChanged }) {
  const [tab, setTab] = useState('details');
  if (!group) return null;

  return (
    <div className="pg-modal-overlay" onClick={onClose}>
      <div className="pg-modal" onClick={(e) => e.stopPropagation()}>
        <div className="pg-modal-header">
          <div className="pg-modal-title">
            {group.color && <span className="pg-color-chip" style={{ background: group.color }} />}
            <UsersIcon size={18} />
            {group.name}
            {!group.active && <span className="pg-badge" style={{ marginLeft: 8 }}>Inactive</span>}
          </div>
          <button onClick={onClose} className="pg-close-btn">
            <X size={18} />
          </button>
        </div>

        {/* Tab bar */}
        <div className="pg-tab-bar">
          <button
            className={`pg-tab ${tab === 'details' ? 'pg-tab--active' : ''}`}
            onClick={() => setTab('details')}
          >
            <Info size={13} /> Details
          </button>
          <button
            className={`pg-tab ${tab === 'members' ? 'pg-tab--active' : ''}`}
            onClick={() => setTab('members')}
          >
            <ListChecks size={13} /> Members ({group._count?.products ?? group.products?.length ?? 0})
          </button>
        </div>

        <div className="pg-modal-body">
          {tab === 'details' && (
            <DetailsTab group={group} departments={departments} vendors={vendors} />
          )}
          {tab === 'members' && (
            <MembersTab group={group} onChanged={onMembersChanged} />
          )}
        </div>

        <div className="pg-modal-footer">
          <button onClick={onClose} className="pg-btn pg-btn-secondary">Close</button>
          <button onClick={() => { onEdit(group); onClose(); }} className="pg-btn pg-btn-primary">
            <Edit2 size={13} /> Edit
          </button>
        </div>
      </div>
    </div>
  );
}
