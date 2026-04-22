/**
 * StoreVeu Exchange — polymorphic order detail page.
 *
 *   URL: /portal/exchange/orders/:id  (or /portal/exchange/new for new draft)
 *
 * Renders one of three modes based on order state + user perspective:
 *
 *   BUILDER MODE   — sender editing a draft (or new)
 *                    · pick receiver partner (new only)
 *                    · search/add products → lines with qty/cost/taxable
 *                    · save draft, edit, send, cancel, delete
 *
 *   SENDER VIEW    — sender reviewing a sent+ order
 *                    · read-only snapshot
 *                    · cancel (if still 'sent')
 *                    · event timeline
 *
 *   RECEIVER CONFIRM — receiver reviewing an incoming 'sent' order
 *                    · invoice-import-style line table
 *                    · qtyReceived adjustable per line (dispute logged)
 *                    · new products get "Create in my catalog" shortcut
 *                    · UPC cascade: auto-match, manual pick, or create new
 *                    · confirm / reject
 *
 *   READ-ONLY      — anything else (rejected/cancelled/expired/confirmed)
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import {
  ArrowLeft, Save, Send, Trash2, X, Check, AlertTriangle, Search,
  Plus, Minus, DollarSign, Edit2, Package, Clock, FileText,
  ShieldAlert, MessageSquare,
} from 'lucide-react';
import {
  createWholesaleOrder, updateWholesaleOrder, getWholesaleOrder,
  deleteWholesaleDraft, sendWholesaleOrder, cancelWholesaleOrder,
  rejectWholesaleOrder, confirmWholesaleOrder,
  listAcceptedPartners, searchCatalogProducts,
} from '../services/api';
import './Exchange.css';
import './ExchangeOrderDetail.css';

const AUTOSAVE_MS = 2500;

const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;
const STATUS_COLORS = {
  draft: '#64748b', sent: '#0ea5e9', confirmed: '#16a34a',
  partially_confirmed: '#f59e0b', rejected: '#ef4444',
  cancelled: '#94a3b8', expired: '#a16207',
};

export default function ExchangeOrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = !id || id === 'new';

  const [order, setOrder]   = useState(null);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving]   = useState(false);

  // Builder state (for new or editable drafts)
  const [partnerId, setPartnerId] = useState(null);
  const [lines, setLines]         = useState([]);
  const [taxEnabled, setTaxEnabled] = useState(false);
  const [senderNotes, setSenderNotes] = useState('');
  const [partners, setPartners]   = useState([]);

  const myStoreId = (() => {
    try { return localStorage.getItem('activeStoreId'); } catch { return null; }
  })();

  // ── Load existing order ──
  useEffect(() => {
    if (isNew) {
      (async () => {
        try {
          const p = await listAcceptedPartners();
          setPartners(p || []);
        } catch (err) { toast.error(err.message); }
      })();
      return;
    }
    (async () => {
      setLoading(true);
      try {
        const o = await getWholesaleOrder(id);
        setOrder(o);
        if (o.status === 'draft') {
          setPartnerId(o.receiverStoreId);
          setLines(o.items.map(i => ({
            senderProductId: i.senderProductId,
            productSnapshot: i.productSnapshot,
            qtySent: i.qtySent,
            unitCost: Number(i.unitCost),
            depositPerUnit: i.depositPerUnit != null ? Number(i.depositPerUnit) : null,
            taxable: i.taxable,
            taxRate: i.taxRate != null ? Number(i.taxRate) : null,
          })));
          setTaxEnabled(o.taxEnabled);
          setSenderNotes(o.senderNotes || '');
        }
      } catch (err) {
        toast.error(err.response?.data?.error || err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [id, isNew]);

  // Determine mode
  const direction = order?.direction || (isNew ? 'outgoing' : null);
  const mode = (() => {
    if (isNew || (order?.status === 'draft' && direction === 'outgoing')) return 'builder';
    if (order?.status === 'sent' && direction === 'incoming') return 'receiver';
    if (order?.status === 'sent' && direction === 'outgoing') return 'sender-view';
    return 'read-only';
  })();

  // ── Autosave draft (builder mode) ──
  const autosaveRef = useRef(null);
  const autosave = useCallback(async () => {
    if (!order || mode !== 'builder' || isNew) return;
    if (!lines.length) return;
    setSaving(true);
    try {
      await updateWholesaleOrder(order.id, { items: lines, taxEnabled, senderNotes });
    } catch (err) { /* silent; toast on manual */ }
    finally { setSaving(false); }
  }, [order, mode, isNew, lines, taxEnabled, senderNotes]);

  useEffect(() => {
    if (mode !== 'builder' || isNew) return;
    clearTimeout(autosaveRef.current);
    autosaveRef.current = setTimeout(autosave, AUTOSAVE_MS);
    return () => clearTimeout(autosaveRef.current);
  }, [autosave, mode, isNew]);

  // ── Builder actions ──
  const addLine = (product) => {
    if (lines.find(l => l.senderProductId === product.id)) {
      toast.info(`${product.name} is already on this order.`);
      return;
    }
    setLines(prev => [...prev, {
      senderProductId: product.id,
      productSnapshot: {
        name: product.name,
        upc: product.upc,
        brand: product.brand,
        taxClass: product.taxClass,
        departmentName: product.department?.name,
        packUnits: product.sellUnitSize || 1,
        packInCase: product.casePacks || null,
        depositPerUnit: null,
        imageUrl: product.imageUrl,
      },
      qtySent: 1,
      unitCost: Number(product.defaultCostPrice || product.defaultRetailPrice || 0),
      depositPerUnit: null,
      taxable: false,
      taxRate: null,
    }]);
  };

  const updateLine = (idx, patch) => {
    setLines(prev => prev.map((l, i) => i === idx ? { ...l, ...patch } : l));
  };
  const removeLine = (idx) => setLines(prev => prev.filter((_, i) => i !== idx));

  // ── Save draft (create or update) ──
  const saveDraft = async (alsoSend = false) => {
    if (!partnerId) return toast.error('Pick a trading partner first.');
    if (!lines.length) return toast.error('Add at least one item.');

    setSaving(true);
    try {
      let savedId = order?.id;
      if (!savedId) {
        const created = await createWholesaleOrder({
          receiverStoreId: partnerId,
          items: lines,
          taxEnabled,
          senderNotes,
        });
        savedId = created.id;
        setOrder(created);
      } else {
        await updateWholesaleOrder(savedId, { items: lines, taxEnabled, senderNotes });
      }
      toast.success(alsoSend ? 'Draft saved. Sending…' : 'Draft saved.');
      if (alsoSend) {
        await sendWholesaleOrder(savedId);
        toast.success('Order sent! Partner has been notified.');
        navigate(`/portal/exchange/orders/${savedId}`);
      } else {
        navigate(`/portal/exchange/orders/${savedId}`);
      }
    } catch (err) {
      toast.error(err.response?.data?.error || err.message);
    } finally { setSaving(false); }
  };

  const deleteDraft = async () => {
    if (!window.confirm('Delete this draft?')) return;
    try {
      await deleteWholesaleDraft(order.id);
      navigate('/portal/exchange');
    } catch (err) { toast.error(err.response?.data?.error || err.message); }
  };

  const cancelSent = async () => {
    const reason = prompt('Optional reason for cancellation?') || '';
    try {
      await cancelWholesaleOrder(order.id, reason);
      toast.info('Order cancelled.');
      navigate('/portal/exchange');
    } catch (err) { toast.error(err.response?.data?.error || err.message); }
  };

  if (loading) return <div className="p-page"><div className="p-loading">Loading order…</div></div>;

  // ── Render branch ─────────────────────────────────────────
  return (
    <div className="p-page eod-page">
      <header className="eod-header">
        <button className="p-btn p-btn-ghost" onClick={() => navigate('/portal/exchange')}>
          <ArrowLeft size={15} /> Back to Exchange
        </button>
        <div className="eod-head-title">
          <h1>
            {isNew ? 'New Wholesale Order' : order?.orderNumber}
            {order?.status && (
              <span className="eod-status" style={{
                background: `${STATUS_COLORS[order.status]}22`,
                color: STATUS_COLORS[order.status],
              }}>
                {order.status.replace('_', ' ')}
              </span>
            )}
            {order?.isInternalTransfer && (
              <span className="eod-internal">Internal Transfer</span>
            )}
            {order?.hasRestrictedItems && (
              <span className="eod-restricted" title="Contains alcohol or tobacco items">
                <ShieldAlert size={13} /> Restricted items
              </span>
            )}
          </h1>
          {order && (
            <p className="ex-muted ex-muted--small">
              {order.direction === 'outgoing'
                ? <>To: <strong>{order.receiverStore?.name}</strong> ({order.receiverStore?.storeCode})</>
                : <>From: <strong>{order.senderStore?.name}</strong> ({order.senderStore?.storeCode})</>
              }
              {order.sentAt && <> · Sent {new Date(order.sentAt).toLocaleString()}</>}
              {order.expiresAt && order.status === 'sent' && (
                <> · Expires {new Date(order.expiresAt).toLocaleDateString()}</>
              )}
            </p>
          )}
        </div>
      </header>

      {mode === 'builder' && (
        <BuilderMode
          isNew={isNew}
          partnerId={partnerId}
          setPartnerId={setPartnerId}
          partners={partners}
          lines={lines}
          taxEnabled={taxEnabled}
          setTaxEnabled={setTaxEnabled}
          senderNotes={senderNotes}
          setSenderNotes={setSenderNotes}
          addLine={addLine}
          updateLine={updateLine}
          removeLine={removeLine}
          saving={saving}
          onSaveDraft={() => saveDraft(false)}
          onSend={() => saveDraft(true)}
          onDelete={!isNew ? deleteDraft : null}
        />
      )}

      {mode === 'sender-view' && (
        <SenderView order={order} onCancel={cancelSent} />
      )}

      {mode === 'receiver' && (
        <ReceiverConfirmMode
          order={order}
          onRefresh={async () => {
            const o = await getWholesaleOrder(id);
            setOrder(o);
          }}
        />
      )}

      {mode === 'read-only' && (
        <ReadOnlyView order={order} />
      )}

      {order?.events?.length > 0 && (
        <div className="p-card eod-timeline-card">
          <h3><Clock size={14} /> Activity</h3>
          <div className="eod-timeline">
            {order.events.map(e => (
              <div key={e.id} className="eod-timeline-row">
                <div className="eod-timeline-dot" />
                <div>
                  <div className="eod-timeline-title">{e.description || e.eventType.replace(/_/g, ' ')}</div>
                  <div className="ex-muted ex-muted--small">
                    {new Date(e.createdAt).toLocaleString()} · {e.actorName || 'system'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// BUILDER MODE — sender creates/edits a draft
// ═══════════════════════════════════════════════════════════════

function BuilderMode({
  isNew, partnerId, setPartnerId, partners,
  lines, taxEnabled, setTaxEnabled, senderNotes, setSenderNotes,
  addLine, updateLine, removeLine,
  saving, onSaveDraft, onSend, onDelete,
}) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const searchRef = useRef(null);
  const searchInputRef = useRef(null);

  // Keep latest props in a ref so the debounced callback doesn't capture stale values
  const addLineRef = useRef(addLine);
  const linesRef   = useRef(lines);
  useEffect(() => { addLineRef.current = addLine; linesRef.current = lines; }, [addLine, lines]);

  // Heuristic: a "barcode-like" query is all digits (6-14) after stripping spaces/dashes/dots
  const isUpcLike = (q) => {
    const digits = q.replace(/[\s\-\.]/g, '');
    return /^\d{6,14}$/.test(digits);
  };

  const runSearch = useCallback(async (q) => {
    if (!q || q.length < 2) { setResults([]); return; }
    setSearchBusy(true);
    try {
      const r = await searchCatalogProducts(q, { limit: 20 });
      const data = r.data || r || [];

      // Barcode auto-add: exact UPC match → add and clear, no dropdown
      if (isUpcLike(q) && data.length === 1) {
        const hit = data[0];
        const qDigits = q.replace(/\D/g, '');
        const hitUpc  = (hit.upc || '').replace(/\D/g, '');
        if (hitUpc && (hitUpc === qDigits || hitUpc.endsWith(qDigits) || qDigits.endsWith(hitUpc))) {
          const already = linesRef.current.find(l => l.senderProductId === hit.id);
          if (already) {
            toast.info(`${hit.name} is already on this order.`);
          } else {
            addLineRef.current(hit);
            toast.success(`Added ${hit.name}`);
          }
          setResults([]);
          setSearch('');
          searchInputRef.current?.focus();
          return;
        }
      }

      setResults(data);
    } catch { setResults([]); }
    finally { setSearchBusy(false); }
  }, []);

  useEffect(() => {
    clearTimeout(searchRef.current);
    searchRef.current = setTimeout(() => runSearch(search), 250);
    return () => clearTimeout(searchRef.current);
  }, [search, runSearch]);

  // Totals
  const totals = useMemo(() => {
    let subtotal = 0, deposit = 0, tax = 0;
    for (const l of lines) {
      const lineCost = Number(l.qtySent || 0) * Number(l.unitCost || 0);
      const lineDeposit = Number(l.qtySent || 0) * Number(l.depositPerUnit || 0);
      const lineTax = (taxEnabled && l.taxable) ? lineCost * Number(l.taxRate || 0) : 0;
      subtotal += lineCost; deposit += lineDeposit; tax += lineTax;
    }
    return { subtotal, deposit, tax, grand: subtotal + deposit + tax };
  }, [lines, taxEnabled]);

  const canSend = partnerId && lines.length > 0;

  return (
    <div className="eod-grid">
      <div className="eod-main">
        {/* Partner picker — only if new or creating draft */}
        {isNew && (
          <div className="p-card">
            <div className="p-card-head"><h3>Send to</h3></div>
            {partners.length === 0 ? (
              <div className="p-empty">
                You have no active trading partners yet. <a href="/portal/exchange?tab=partners">Invite one →</a>
              </div>
            ) : (
              <select
                className="eod-partner-select"
                value={partnerId || ''}
                onChange={e => setPartnerId(e.target.value || null)}
              >
                <option value="">— choose a trading partner —</option>
                {partners.map(p => (
                  <option key={p.storeId} value={p.storeId}>
                    {p.name} ({p.storeCode}) — {p.orgName}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        {/* Product search */}
        <div className="p-card">
          <div className="p-card-head">
            <h3><Plus size={14} /> Add Products</h3>
            <span className="ex-muted ex-muted--small">Type to search your catalog</span>
          </div>
          <div className="ex-search ex-search--lg">
            <Search size={14} />
            <input
              ref={searchInputRef}
              placeholder="Scan or type name / UPC / SKU / brand…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => {
                // Barcode scanners typically end with Enter. If there's exactly 1
                // result visible, adding it on Enter gives the cashier-app feel.
                if (e.key === 'Enter' && results.length === 1) {
                  const hit = results[0];
                  const already = lines.find(l => l.senderProductId === hit.id);
                  if (!already) addLine(hit);
                  setResults([]); setSearch('');
                }
              }}
              autoFocus
            />
            {searchBusy && <span className="ex-muted ex-muted--small">searching…</span>}
          </div>
          {search.length > 0 && search.length < 2 && (
            <div className="ex-muted ex-muted--small" style={{ marginTop: 6 }}>Keep typing — at least 2 characters…</div>
          )}
          {search.length >= 2 && !searchBusy && results.length === 0 && (
            <div className="p-empty" style={{ marginTop: 10 }}>
              No products match "<strong>{search}</strong>". Try a different term or UPC.
            </div>
          )}
          {results.length > 0 && search.length >= 2 && (
            <div className="eod-search-results">
              {results.map(p => {
                const added = !!lines.find(l => l.senderProductId === p.id);
                return (
                  <div
                    key={p.id}
                    className={`eod-sr-row ${added ? 'eod-sr-added' : 'eod-sr-clickable'}`}
                    onClick={() => !added && addLine(p)}
                    role="button"
                    tabIndex={added ? -1 : 0}
                    onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && !added && addLine(p)}
                  >
                    <div className="eod-sr-info">
                      <strong>{p.name}</strong>
                      <div className="ex-muted ex-muted--small">
                        {p.upc || 'no UPC'} · {p.department?.name || '—'} · cost {money(p.defaultCostPrice)}
                      </div>
                    </div>
                    <button
                      className="p-btn p-btn-ghost"
                      onClick={(e) => { e.stopPropagation(); addLine(p); }}
                      disabled={added}
                    >
                      {added ? <>Added <Check size={13} /></> : <><Plus size={13} /> Add</>}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Line items */}
        <div className="p-card">
          <div className="p-card-head">
            <h3>Items ({lines.length})</h3>
            <label className="eod-tax-toggle">
              <input type="checkbox" checked={taxEnabled} onChange={e => setTaxEnabled(e.target.checked)} />
              Enable tax
            </label>
          </div>

          {lines.length === 0 ? (
            <div className="p-empty">No items yet. Search above to add products.</div>
          ) : (
            <table className="p-table eod-lines-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th style={{ width: 90 }}>Qty</th>
                  <th style={{ width: 120 }}>Unit Cost</th>
                  <th style={{ width: 110 }}>Deposit/unit</th>
                  {taxEnabled && <th style={{ width: 90 }}>Taxable</th>}
                  {taxEnabled && <th style={{ width: 90 }}>Tax %</th>}
                  <th style={{ width: 110 }} className="right">Line Total</th>
                  <th style={{ width: 40 }}></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, idx) => {
                  const lineCost = Number(l.qtySent || 0) * Number(l.unitCost || 0);
                  const lineDep = Number(l.qtySent || 0) * Number(l.depositPerUnit || 0);
                  const lineTax = (taxEnabled && l.taxable) ? lineCost * Number(l.taxRate || 0) : 0;
                  const lineTotal = lineCost + lineDep + lineTax;
                  return (
                    <tr key={idx}>
                      <td>
                        <div className="eod-line-name">{l.productSnapshot?.name}</div>
                        <div className="ex-muted ex-muted--small">
                          {l.productSnapshot?.upc} · {l.productSnapshot?.departmentName}
                        </div>
                      </td>
                      <td>
                        <input type="number" min="1" step="1"
                          value={l.qtySent}
                          onChange={e => updateLine(idx, { qtySent: Math.max(1, parseInt(e.target.value) || 0) })} />
                      </td>
                      <td>
                        <input type="number" min="0" step="0.01"
                          value={l.unitCost}
                          onChange={e => updateLine(idx, { unitCost: Number(e.target.value) || 0 })} />
                      </td>
                      <td>
                        <input type="number" min="0" step="0.01"
                          value={l.depositPerUnit ?? ''}
                          placeholder="—"
                          onChange={e => updateLine(idx, { depositPerUnit: e.target.value === '' ? null : Number(e.target.value) })} />
                      </td>
                      {taxEnabled && (
                        <td style={{ textAlign: 'center' }}>
                          <input type="checkbox" checked={!!l.taxable}
                            onChange={e => updateLine(idx, { taxable: e.target.checked })} />
                        </td>
                      )}
                      {taxEnabled && (
                        <td>
                          <input type="number" min="0" max="1" step="0.001"
                            value={l.taxRate ?? ''}
                            placeholder="0.055"
                            disabled={!l.taxable}
                            onChange={e => updateLine(idx, { taxRate: e.target.value === '' ? null : Number(e.target.value) })} />
                        </td>
                      )}
                      <td className="right"><strong>{money(lineTotal)}</strong></td>
                      <td>
                        <button className="eod-remove-btn" onClick={() => removeLine(idx)}>
                          <X size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Notes */}
        <div className="p-card">
          <div className="p-card-head"><h3>Order Notes</h3></div>
          <textarea
            className="eod-notes"
            placeholder="Optional message to partner — e.g. 'Close-dated, please move within 2 weeks'"
            value={senderNotes}
            onChange={e => setSenderNotes(e.target.value)}
            rows={3}
          />
        </div>
      </div>

      {/* Right summary */}
      <aside className="eod-summary">
        <div className="p-card eod-summary-card">
          <h3>Order Summary</h3>
          <div className="eod-sum-row">
            <span>Items</span>
            <span>{lines.length} ({lines.reduce((n, l) => n + (Number(l.qtySent) || 0), 0)} units)</span>
          </div>
          <div className="eod-sum-row">
            <span>Subtotal</span>
            <span>{money(totals.subtotal)}</span>
          </div>
          <div className="eod-sum-row">
            <span>Deposits</span>
            <span>{money(totals.deposit)}</span>
          </div>
          {taxEnabled && (
            <div className="eod-sum-row">
              <span>Tax</span>
              <span>{money(totals.tax)}</span>
            </div>
          )}
          <div className="eod-sum-row eod-sum-row--total">
            <span>Grand Total</span>
            <span>{money(totals.grand)}</span>
          </div>

          <div className="eod-actions">
            <button className="p-btn p-btn-primary eod-btn-send" disabled={!canSend || saving} onClick={onSend}>
              <Send size={14} /> {saving ? 'Sending…' : 'Save & Send'}
            </button>
            <button className="p-btn p-btn-ghost" disabled={saving || !partnerId || !lines.length} onClick={onSaveDraft}>
              <Save size={14} /> Save Draft
            </button>
            {onDelete && (
              <button className="p-btn p-btn-ghost eod-btn-delete" onClick={onDelete}>
                <Trash2 size={14} /> Delete Draft
              </button>
            )}
          </div>

          <div className="eod-help">
            <p><strong>How it works</strong></p>
            <ol>
              <li>Partner gets an email with the order details.</li>
              <li>They confirm received qty (can adjust down).</li>
              <li>Inventory moves on both sides automatically.</li>
              <li>Your partner ledger is credited for the confirmed total.</li>
            </ol>
          </div>
        </div>
      </aside>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SENDER VIEW — read-only after send, with cancel button
// ═══════════════════════════════════════════════════════════════

function SenderView({ order, onCancel }) {
  return (
    <div className="eod-grid">
      <div className="eod-main">
        <div className="p-card">
          <div className="p-card-head">
            <h3>Items</h3>
            <span className="ex-muted ex-muted--small">
              Awaiting partner confirmation
            </span>
          </div>
          <OrderItemsTable items={order.items} taxEnabled={order.taxEnabled} mode="sent" />
        </div>
        {order.senderNotes && (
          <div className="p-card">
            <div className="p-card-head"><h3><MessageSquare size={14} /> Notes to Partner</h3></div>
            <div className="eod-notes-display">{order.senderNotes}</div>
          </div>
        )}
      </div>
      <aside className="eod-summary">
        <div className="p-card eod-summary-card">
          <h3>Order Summary</h3>
          <SummaryRows order={order} />
          <div className="eod-actions">
            <button className="p-btn p-btn-ghost eod-btn-delete" onClick={onCancel}>
              <X size={14} /> Cancel This Order
            </button>
          </div>
          <div className="eod-help">
            <p>Cancelling notifies the partner. No inventory or ledger changes occur.</p>
          </div>
        </div>
      </aside>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// RECEIVER CONFIRM MODE — invoice-import-style confirmation
// ═══════════════════════════════════════════════════════════════

function ReceiverConfirmMode({ order, onRefresh }) {
  const navigate = useNavigate();
  // Editable confirmation rows — one per order item
  const [rows, setRows] = useState(() =>
    order.items.map(it => ({
      itemId: it.id,
      qtyReceived: it.qtySent,                         // default accept full qty
      receiverProductId: it.receiverProductId || null, // resolved later
      disputeNote: '',
      // Matching state:
      //   'pending' — not attempted yet
      //   'matched' — UPC or name hit
      //   'unmatched' — need to pick or create
      //   'creating' — user chose to create new
      matchState: 'pending',
      matchCandidate: null,
    }))
  );
  const [matching, setMatching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  // ── Attempt auto-match on mount ──
  useEffect(() => {
    (async () => {
      setMatching(true);
      const next = await Promise.all(rows.map(async (r, idx) => {
        const snap = order.items[idx].productSnapshot || {};
        // Match by UPC first
        if (snap.upc) {
          try {
            const hits = await searchCatalogProducts(snap.upc, { limit: 1 });
            const list = hits.data || hits || [];
            if (list.length && list[0].upc === snap.upc) {
              return { ...r, matchState: 'matched', matchCandidate: list[0], receiverProductId: list[0].id };
            }
          } catch {}
        }
        // Fallback: name search
        if (snap.name) {
          try {
            const hits = await searchCatalogProducts(snap.name.split(' ').slice(0, 3).join(' '), { limit: 3 });
            const list = hits.data || hits || [];
            if (list.length) {
              return { ...r, matchState: 'matched', matchCandidate: list[0], receiverProductId: list[0].id };
            }
          } catch {}
        }
        return { ...r, matchState: 'unmatched' };
      }));
      setRows(next);
      setMatching(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateRow = (idx, patch) => setRows(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r));

  const acceptAll = () => {
    setRows(prev => prev.map((r, i) => ({
      ...r,
      qtyReceived: order.items[i].qtySent,
    })));
    toast.info('Set all lines to full qty received.');
  };

  const confirm = async () => {
    // Validate every line has receiverProductId (matched or newly created)
    const unresolved = rows.findIndex(r => !r.receiverProductId && r.qtyReceived > 0);
    if (unresolved !== -1) {
      toast.error(`Line ${unresolved + 1}: pick or create a product first.`);
      return;
    }
    setSaving(true);
    try {
      await confirmWholesaleOrder(order.id, rows.map(r => ({
        itemId: r.itemId,
        qtyReceived: r.qtyReceived,
        receiverProductId: r.receiverProductId,
        disputeNote: r.disputeNote || undefined,
      })));
      toast.success('Order confirmed! Inventory and ledger updated.');
      navigate('/portal/exchange?tab=orders');
    } catch (err) {
      toast.error(err.response?.data?.error || err.message);
    } finally { setSaving(false); }
  };

  const reject = async () => {
    if (!rejectReason.trim()) return toast.error('Please provide a reason.');
    setSaving(true);
    try {
      await rejectWholesaleOrder(order.id, rejectReason);
      toast.info('Order rejected.');
      navigate('/portal/exchange?tab=orders');
    } catch (err) {
      toast.error(err.response?.data?.error || err.message);
    } finally { setSaving(false); }
  };

  const confTotals = useMemo(() => {
    let sub = 0, dep = 0, tax = 0;
    for (let i = 0; i < rows.length; i++) {
      const it = order.items[i];
      const scale = it.qtySent > 0 ? rows[i].qtyReceived / it.qtySent : 0;
      sub += Number(it.lineCost) * scale;
      dep += Number(it.lineDeposit) * scale;
      tax += Number(it.taxAmount) * scale;
    }
    return { sub, dep, tax, grand: sub + dep + tax };
  }, [rows, order.items]);

  const unmatched = rows.filter(r => r.matchState === 'unmatched').length;
  const hasShort = rows.some((r, i) => r.qtyReceived < order.items[i].qtySent);
  const hasReceived = rows.some(r => r.qtyReceived > 0);

  return (
    <div className="eod-grid">
      <div className="eod-main">
        <div className="p-card eod-callout">
          <div className="eod-callout-icon"><Package size={20} /></div>
          <div>
            <h4>Confirm what you actually received</h4>
            <p>Adjust quantities down if some items are missing or damaged. Unknown products can be created in your catalog.</p>
            <button className="p-btn p-btn-ghost" onClick={acceptAll}>
              <Check size={14} /> Accept all as sent
            </button>
          </div>
        </div>

        <div className="p-card">
          <div className="p-card-head">
            <h3>Items ({order.items.length})</h3>
            {matching && <span className="ex-muted">Matching to your catalog…</span>}
            {!matching && unmatched > 0 && (
              <span className="eod-warn"><AlertTriangle size={13} /> {unmatched} unmatched</span>
            )}
          </div>
          <div className="eod-confirm-list">
            {rows.map((r, idx) => (
              <ConfirmRow
                key={r.itemId}
                row={r}
                item={order.items[idx]}
                update={(patch) => updateRow(idx, patch)}
                taxEnabled={order.taxEnabled}
              />
            ))}
          </div>
        </div>

        {order.senderNotes && (
          <div className="p-card">
            <div className="p-card-head"><h3><MessageSquare size={14} /> Note from {order.senderStore?.name}</h3></div>
            <div className="eod-notes-display">{order.senderNotes}</div>
          </div>
        )}

        {rejectMode && (
          <div className="p-card eod-reject-card">
            <div className="p-card-head"><h3>Reject this order?</h3></div>
            <p className="ex-muted">No inventory will move. No ledger entry. The sender will be notified.</p>
            <textarea
              placeholder="Reason (required)"
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              rows={3}
            />
            <div className="eod-actions">
              <button className="p-btn p-btn-ghost" onClick={() => setRejectMode(false)}>Cancel</button>
              <button className="p-btn p-btn-primary eod-btn-reject" onClick={reject} disabled={saving || !rejectReason.trim()}>
                Reject Order
              </button>
            </div>
          </div>
        )}
      </div>

      <aside className="eod-summary">
        <div className="p-card eod-summary-card">
          <h3>Confirmation Summary</h3>
          <div className="eod-sum-row">
            <span className="ex-muted">Original total</span>
            <span className="ex-muted"><del>{money(order.grandTotal)}</del></span>
          </div>
          <div className="eod-sum-row">
            <span>Subtotal</span><span>{money(confTotals.sub)}</span>
          </div>
          <div className="eod-sum-row">
            <span>Deposits</span><span>{money(confTotals.dep)}</span>
          </div>
          {order.taxEnabled && (
            <div className="eod-sum-row">
              <span>Tax</span><span>{money(confTotals.tax)}</span>
            </div>
          )}
          <div className="eod-sum-row eod-sum-row--total">
            <span>Confirmed Total</span>
            <span>{money(confTotals.grand)}</span>
          </div>
          {hasShort && (
            <div className="eod-warn-block">
              <AlertTriangle size={14} /> Some lines are short — these will be logged as dispute entries.
            </div>
          )}

          <div className="eod-actions">
            <button
              className="p-btn p-btn-primary eod-btn-confirm"
              disabled={saving || !hasReceived || unmatched > 0}
              onClick={confirm}
            >
              <Check size={14} /> {saving ? 'Confirming…' : 'Confirm & Move Inventory'}
            </button>
            {!rejectMode && (
              <button className="p-btn p-btn-ghost eod-btn-delete" onClick={() => setRejectMode(true)}>
                <X size={14} /> Reject Full Order
              </button>
            )}
          </div>

          <div className="eod-help">
            <p><strong>On confirm:</strong></p>
            <ol>
              <li>Sender's QOH is deducted.</li>
              <li>Your QOH increases (or new product is created).</li>
              <li>{money(confTotals.grand)} is added to your ledger as a debit.</li>
            </ol>
          </div>
        </div>
      </aside>
    </div>
  );
}

// Individual confirmation row (invoice-import style)
function ConfirmRow({ row, item, update, taxEnabled }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const snap = item.productSnapshot || {};

  const searchProducts = async (q) => {
    if (!q) { setResults([]); return; }
    try {
      const r = await searchCatalogProducts(q, { limit: 10 });
      setResults(r.data || r || []);
    } catch { setResults([]); }
  };

  useEffect(() => {
    if (!pickerOpen) return;
    const t = setTimeout(() => searchProducts(query), 250);
    return () => clearTimeout(t);
  }, [query, pickerOpen]);

  const isRestricted = ['alcohol', 'tobacco'].includes(snap.taxClass);

  return (
    <div className="eod-confirm-row">
      <div className="eod-cr-top">
        <div className="eod-cr-info">
          <div className="eod-cr-name">
            {snap.name}
            {isRestricted && (
              <span className="eod-restricted-chip" title="Restricted item — verify licensing">
                <ShieldAlert size={11} /> {snap.taxClass}
              </span>
            )}
          </div>
          <div className="ex-muted ex-muted--small">
            UPC {snap.upc || '—'} · {snap.departmentName} · pack {snap.packUnits || 1}
          </div>
        </div>
        <div className="eod-cr-qty">
          <label>Received</label>
          <div className="eod-qty-ctrls">
            <button onClick={() => update({ qtyReceived: Math.max(0, row.qtyReceived - 1) })}>
              <Minus size={13} />
            </button>
            <input type="number" min="0" max={item.qtySent}
              value={row.qtyReceived}
              onChange={e => update({ qtyReceived: Math.min(item.qtySent, Math.max(0, Number(e.target.value) || 0)) })} />
            <button onClick={() => update({ qtyReceived: Math.min(item.qtySent, row.qtyReceived + 1) })}>
              <Plus size={13} />
            </button>
          </div>
          <div className="ex-muted ex-muted--small">of {item.qtySent} sent</div>
        </div>
        <div className="eod-cr-total">
          {money(Number(item.unitCost) * row.qtyReceived)}
        </div>
      </div>

      <div className="eod-cr-match">
        {row.matchState === 'matched' && row.matchCandidate && (
          <div className="eod-match eod-match-good">
            <Check size={13} /> Matched: <strong>{row.matchCandidate.name}</strong>
            <button className="ex-link" onClick={() => {
              update({ matchState: 'unmatched', matchCandidate: null, receiverProductId: null });
              setPickerOpen(true);
            }}>change</button>
          </div>
        )}
        {row.matchState === 'unmatched' && !pickerOpen && (
          <div className="eod-match eod-match-bad">
            <AlertTriangle size={13} /> No match in your catalog.
            <button className="ex-link" onClick={() => setPickerOpen(true)}>Pick from catalog →</button>
            <span className="ex-muted ex-muted--small">or create new in your catalog, then re-sync.</span>
          </div>
        )}
        {pickerOpen && (
          <div className="eod-picker">
            <div className="ex-search">
              <Search size={14} />
              <input
                placeholder="Search your catalog to pick a match…"
                value={query}
                onChange={e => setQuery(e.target.value)}
                autoFocus
              />
              <button className="p-btn p-btn-ghost" onClick={() => setPickerOpen(false)}><X size={13} /></button>
            </div>
            {results.length > 0 && (
              <div className="eod-picker-results">
                {results.map(p => (
                  <button key={p.id} className="eod-picker-row"
                    onClick={() => {
                      update({ matchState: 'matched', matchCandidate: p, receiverProductId: p.id });
                      setPickerOpen(false);
                    }}>
                    <strong>{p.name}</strong>
                    <span className="ex-muted ex-muted--small">{p.upc} · {p.department?.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {row.qtyReceived < item.qtySent && (
        <div className="eod-cr-dispute">
          <label>Dispute note ({item.qtySent - row.qtyReceived} short)</label>
          <input
            placeholder="Optional — damaged, missing, expired, etc."
            value={row.disputeNote}
            onChange={e => update({ disputeNote: e.target.value })}
          />
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// READ-ONLY VIEW — for terminal states
// ═══════════════════════════════════════════════════════════════

function ReadOnlyView({ order }) {
  return (
    <div className="eod-grid">
      <div className="eod-main">
        <div className="p-card">
          <div className="p-card-head"><h3>Items</h3></div>
          <OrderItemsTable items={order.items} taxEnabled={order.taxEnabled} mode="final" />
        </div>
        {(order.rejectReason || order.cancelReason) && (
          <div className="p-card">
            <div className="p-card-head">
              <h3>{order.status === 'rejected' ? 'Rejection Reason' : 'Cancellation Reason'}</h3>
            </div>
            <div className="eod-notes-display">{order.rejectReason || order.cancelReason}</div>
          </div>
        )}
      </div>
      <aside className="eod-summary">
        <div className="p-card eod-summary-card">
          <h3>Order Summary</h3>
          <SummaryRows order={order} />
        </div>
      </aside>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SHARED COMPONENTS
// ═══════════════════════════════════════════════════════════════

function OrderItemsTable({ items, taxEnabled, mode }) {
  return (
    <table className="p-table eod-lines-table">
      <thead>
        <tr>
          <th>Product</th>
          <th style={{ width: 80 }}>Qty</th>
          {mode === 'final' && <th style={{ width: 80 }}>Recv'd</th>}
          <th style={{ width: 100 }} className="right">Unit Cost</th>
          <th style={{ width: 110 }} className="right">Line Total</th>
        </tr>
      </thead>
      <tbody>
        {items.map(i => (
          <tr key={i.id}>
            <td>
              <div className="eod-line-name">{i.productSnapshot?.name}</div>
              <div className="ex-muted ex-muted--small">{i.productSnapshot?.upc}</div>
              {i.disputeNote && (
                <div className="eod-dispute-badge">
                  <AlertTriangle size={11} /> {i.disputeNote}
                </div>
              )}
            </td>
            <td>{i.qtySent}</td>
            {mode === 'final' && <td>{i.qtyReceived ?? '—'}</td>}
            <td className="right">{money(i.unitCost)}</td>
            <td className="right"><strong>{money(i.lineTotal)}</strong></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SummaryRows({ order }) {
  const sub = Number(order.confirmedSubtotal ?? order.subtotal);
  const dep = Number(order.confirmedDeposit ?? order.depositTotal);
  const tax = Number(order.confirmedTax ?? order.taxTotal);
  const grand = Number(order.confirmedGrandTotal ?? order.grandTotal);
  return (
    <>
      <div className="eod-sum-row"><span>Subtotal</span><span>{money(sub)}</span></div>
      <div className="eod-sum-row"><span>Deposits</span><span>{money(dep)}</span></div>
      {order.taxEnabled && <div className="eod-sum-row"><span>Tax</span><span>{money(tax)}</span></div>}
      <div className="eod-sum-row eod-sum-row--total"><span>Total</span><span>{money(grand)}</span></div>
    </>
  );
}
