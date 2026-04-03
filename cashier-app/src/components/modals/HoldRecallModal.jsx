import React, { useState, useEffect } from 'react';
import { PauseCircle, Play, Trash2, X, ShoppingCart } from 'lucide-react';
import { useCartStore } from '../../stores/useCartStore.js';
import { getHeldTransactions, deleteHeldTransaction } from '../../db/dexie.js';
import { fmt$ } from '../../utils/formatters.js';

export default function HoldRecallModal({ onClose }) {
  const items       = useCartStore(s => s.items);
  const holdCart    = useCartStore(s => s.holdCart);
  const recallHeld  = useCartStore(s => s.recallHeld);

  const [held,     setHeld]     = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [confirm,  setConfirm]  = useState(null); // id to confirm recall when cart not empty

  const load = () => getHeldTransactions().then(setHeld).finally(() => setLoading(false));

  useEffect(() => { load(); }, []);

  const doHold = async () => {
    await holdCart();
    onClose();
  };

  const doRecall = async (id) => {
    if (items.length > 0 && confirm !== id) { setConfirm(id); return; }
    await recallHeld(id);
    onClose();
  };

  const doDelete = async (id) => {
    await deleteHeldTransaction(id);
    load();
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 150,
      background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '1rem',
    }}>
      <div style={{
        background: 'var(--bg-panel)', borderRadius: 18,
        border: '1px solid var(--border-light)',
        width: '100%', maxWidth: 480, maxHeight: '80vh',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 24px 60px rgba(0,0,0,.5)',
      }}>
        {/* Header */}
        <div style={{
          padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <PauseCircle size={18} color="var(--blue)" />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, color: 'var(--text-primary)' }}>Hold & Recall</div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              Park transactions and pick them back up
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <X size={16} />
          </button>
        </div>

        {/* Hold current cart button */}
        {items.length > 0 && (
          <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid var(--border)' }}>
            <button onClick={doHold} style={{
              width: '100%', padding: '0.75rem',
              background: 'rgba(59,130,246,.12)',
              border: '1px solid rgba(59,130,246,.3)',
              borderRadius: 10, color: 'var(--blue)',
              fontWeight: 700, cursor: 'pointer', fontSize: '0.9rem',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>
              <PauseCircle size={16} />
              Hold Current Cart ({items.length} item{items.length !== 1 ? 's' : ''})
            </button>
          </div>
        )}

        {/* Held transactions list */}
        <div className="scroll" style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading…</div>
          ) : held.length === 0 ? (
            <div style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--text-muted)', opacity: 0.5 }}>
              <ShoppingCart size={40} style={{ marginBottom: 12 }} />
              <div style={{ fontSize: '0.85rem' }}>No held transactions</div>
            </div>
          ) : (
            held.map(h => {
              const total = (h.items || []).reduce((s, i) => s + i.lineTotal, 0);
              const time  = new Date(h.heldAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              return (
                <div key={h.id} style={{
                  padding: '1rem 1.5rem', borderBottom: '1px solid var(--border)',
                  display: 'flex', alignItems: 'center', gap: 12,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.9rem' }}>
                      {h.label || 'Held Transaction'}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>
                      {(h.items || []).length} items · {time}
                    </div>
                  </div>
                  <div style={{ fontWeight: 800, color: 'var(--green)', fontSize: '0.95rem' }}>
                    {fmt$(total)}
                  </div>
                  {confirm === h.id ? (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => doRecall(h.id)} style={{
                        padding: '0.45rem 10px', borderRadius: 8,
                        background: 'var(--green)', color: '#0f1117',
                        border: 'none', fontWeight: 800, fontSize: '0.75rem', cursor: 'pointer',
                      }}>Recall & clear cart</button>
                      <button onClick={() => setConfirm(null)} style={{
                        padding: '0.45rem 10px', borderRadius: 8,
                        background: 'var(--bg-input)', color: 'var(--text-muted)',
                        border: 'none', cursor: 'pointer', fontSize: '0.75rem',
                      }}>Cancel</button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => doRecall(h.id)} style={{
                        width: 36, height: 36, borderRadius: 8,
                        background: 'rgba(122,193,67,.12)', border: '1px solid rgba(122,193,67,.3)',
                        color: 'var(--green)', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <Play size={14} />
                      </button>
                      <button onClick={() => doDelete(h.id)} style={{
                        width: 36, height: 36, borderRadius: 8,
                        background: 'var(--red-dim)', border: '1px solid rgba(224,63,63,.3)',
                        color: 'var(--red)', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
