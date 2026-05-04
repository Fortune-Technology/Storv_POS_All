/**
 * MembersTab — bulk add/remove products from a ProductGroup.
 *
 * S69 (C12): admin previously had to assign products one-at-a-time via
 * ProductForm. Backend has had `/groups/:id/add-products` and
 * `/groups/:id/remove-products` ready since the original group module;
 * this tab finally drives them from the portal.
 *
 * UX:
 *   • Top section "Current Members (N)" — checkbox list + "Remove Selected"
 *   • Bottom section "Add Members" — debounced search → results filtered to
 *     non-members → checkbox + optional "apply template on add" toggle +
 *     "Add Selected" button
 *
 * Members come from the parent's `group.products` (already loaded). Search
 * uses /catalog/products/search via `searchCatalogProducts(q)`.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Search, Trash2, Plus, Loader, X, Check } from 'lucide-react';
import { toast } from 'react-toastify';
import {
  searchCatalogProducts,
  addProductsToGroup,
  removeProductsFromGroup,
} from '../../services/api';
import { useConfirm } from '../../hooks/useConfirmDialog.jsx';

export default function MembersTab({ group, onChanged }) {
  const confirm = useConfirm();

  // ── Members section ──────────────────────────────────────────────────
  const members = group.products || [];
  const [memberSel, setMemberSel] = useState(new Set());
  const [removing, setRemoving] = useState(false);

  const toggleMember = (id) => {
    setMemberSel(s => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const selectAllMembers = () => {
    setMemberSel(new Set(members.map(m => m.id)));
  };
  const clearMemberSel = () => setMemberSel(new Set());

  const handleRemove = async () => {
    const ids = [...memberSel];
    if (ids.length === 0) return;
    if (!await confirm({
      title: `Remove ${ids.length} product${ids.length !== 1 ? 's' : ''} from group?`,
      message: 'Their existing classification + pricing fields will be kept; only the group link is cleared. They will no longer match group-scoped promotions.',
      confirmLabel: `Remove ${ids.length}`,
      danger: true,
    })) return;

    setRemoving(true);
    try {
      const res = await removeProductsFromGroup(group.id, ids);
      toast.success(`Removed ${res?.removed ?? ids.length} product${(res?.removed ?? ids.length) !== 1 ? 's' : ''}`);
      clearMemberSel();
      onChanged?.();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Remove failed');
    } finally {
      setRemoving(false);
    }
  };

  // ── Add section ──────────────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState([]);
  const [searchErr, setSearchErr] = useState(null);
  const [addSel, setAddSel] = useState(new Set());
  const [applyTemplate, setApplyTemplate] = useState(true);
  const [adding, setAdding] = useState(false);

  // Debounced search — fires 280ms after the user stops typing.
  useEffect(() => {
    if (!search || search.trim().length < 2) {
      setResults([]);
      setSearchErr(null);
      return;
    }
    const handle = setTimeout(async () => {
      setSearching(true);
      setSearchErr(null);
      try {
        const res = await searchCatalogProducts(search.trim());
        const list = Array.isArray(res) ? res : (res?.data || []);
        setResults(list);
      } catch (e) {
        setSearchErr(e.response?.data?.error || 'Search failed');
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 280);
    return () => clearTimeout(handle);
  }, [search]);

  const memberIds = useMemo(() => new Set(members.map(m => m.id)), [members]);

  // Filter: exclude products already in the group
  const candidates = useMemo(
    () => results.filter(p => !memberIds.has(p.id)),
    [results, memberIds],
  );

  const toggleAdd = (id) => {
    setAddSel(s => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const handleAdd = async () => {
    const ids = [...addSel];
    if (ids.length === 0) return;
    setAdding(true);
    try {
      const res = await addProductsToGroup(group.id, ids, applyTemplate);
      const n = res?.added ?? ids.length;
      toast.success(
        applyTemplate
          ? `Added ${n} product${n !== 1 ? 's' : ''} — group template applied`
          : `Added ${n} product${n !== 1 ? 's' : ''}`,
      );
      setAddSel(new Set());
      setSearch('');
      setResults([]);
      onChanged?.();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Add failed');
    } finally {
      setAdding(false);
    }
  };

  const fmtPrice = (n) => (n != null ? `$${Number(n).toFixed(2)}` : '—');

  return (
    <>
      {/* ── Current members ─────────────────────────────────────────────── */}
      <div className="pg-section-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>Current Members ({members.length})</span>
        {memberSel.size > 0 && (
          <button onClick={handleRemove} disabled={removing} className="pg-btn pg-btn-danger pg-btn-sm">
            {removing ? <Loader size={12} className="p-spin" /> : <Trash2 size={12} />}
            Remove {memberSel.size}
          </button>
        )}
      </div>

      {members.length === 0 ? (
        <div className="pg-mt-empty">
          No products in this group yet. Use the search below to add some.
        </div>
      ) : (
        <>
          <div className="pg-mt-toolbar">
            <button className="pg-mt-link" onClick={selectAllMembers}>
              Select all ({members.length})
            </button>
            {memberSel.size > 0 && (
              <button className="pg-mt-link" onClick={clearMemberSel}>
                Clear selection
              </button>
            )}
          </div>
          <div className="pg-mt-list">
            {members.map(m => {
              const sel = memberSel.has(m.id);
              return (
                <label key={m.id} className={`pg-mt-row ${sel ? 'pg-mt-row--sel' : ''}`}>
                  <input type="checkbox" checked={sel} onChange={() => toggleMember(m.id)} />
                  <div className="pg-mt-row-name">
                    <strong>{m.name}</strong>
                    {m.upc && <span className="pg-mt-upc">{m.upc}</span>}
                  </div>
                  <div className="pg-mt-row-meta">
                    <span className="pg-td-mono">{fmtPrice(m.defaultRetailPrice)}</span>
                    {!m.active && <span className="pg-badge">Inactive</span>}
                  </div>
                </label>
              );
            })}
          </div>
        </>
      )}

      {/* ── Add members ─────────────────────────────────────────────────── */}
      <div className="pg-section-label" style={{ marginTop: '1.25rem' }}>
        Add Members
      </div>

      <div className="pg-mt-search-row">
        <div className="pg-mt-search-wrap">
          <Search size={13} className="pg-mt-search-icon" />
          <input
            className="pg-input pg-mt-search-input"
            placeholder="Search by name, UPC, or barcode…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            autoFocus
          />
          {search && (
            <button type="button" className="pg-mt-search-clear" onClick={() => { setSearch(''); setResults([]); }}>
              <X size={13} />
            </button>
          )}
        </div>
        <label className="pg-toggle pg-mt-template-toggle" title="When ON, copy the group's classification + pricing fields onto the product on add.">
          <input
            type="checkbox"
            checked={applyTemplate}
            onChange={e => setApplyTemplate(e.target.checked)}
          />
          Apply template on add
        </label>
      </div>

      {searching && (
        <div className="pg-mt-empty"><Loader size={14} className="p-spin" /> Searching…</div>
      )}

      {!searching && searchErr && (
        <div className="pg-mt-error">{searchErr}</div>
      )}

      {!searching && !searchErr && search.trim().length >= 2 && candidates.length === 0 && (
        <div className="pg-mt-empty">
          No products match — or all matches are already members.
        </div>
      )}

      {!searching && search.trim().length < 2 && (
        <div className="pg-mt-hint">
          Type at least 2 characters to search the catalog.
        </div>
      )}

      {candidates.length > 0 && (
        <>
          <div className="pg-mt-toolbar">
            <span className="pg-mt-count">
              {candidates.length} match{candidates.length !== 1 ? 'es' : ''}
              {results.length > candidates.length && ` (${results.length - candidates.length} already in group)`}
            </span>
            {addSel.size > 0 && (
              <button className="pg-mt-link" onClick={() => setAddSel(new Set())}>
                Clear selection
              </button>
            )}
          </div>
          <div className="pg-mt-list">
            {candidates.map(p => {
              const sel = addSel.has(p.id);
              return (
                <label key={p.id} className={`pg-mt-row ${sel ? 'pg-mt-row--sel' : ''}`}>
                  <input type="checkbox" checked={sel} onChange={() => toggleAdd(p.id)} />
                  <div className="pg-mt-row-name">
                    <strong>{p.name}</strong>
                    {p.upc && <span className="pg-mt-upc">{p.upc}</span>}
                  </div>
                  <div className="pg-mt-row-meta">
                    <span className="pg-td-mono">{fmtPrice(p.defaultRetailPrice)}</span>
                    {p.productGroupId && p.productGroupId !== group.id && (
                      <span className="pg-badge pg-badge-warn" title="Currently in another group — will be moved to this group on add">
                        in another group
                      </span>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
          {addSel.size > 0 && (
            <div className="pg-mt-add-bar">
              <button onClick={handleAdd} disabled={adding} className="pg-btn pg-btn-primary">
                {adding ? <Loader size={13} className="p-spin" /> : <Check size={13} />}
                Add {addSel.size} to group
                {applyTemplate ? ' (apply template)' : ''}
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}
