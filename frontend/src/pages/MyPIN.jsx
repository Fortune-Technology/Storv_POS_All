/**
 * MyPIN — Self-service per-store register PIN management
 *
 * Any logged-in user can set/change/remove their own 4-6 digit PIN for each
 * store they have access to. Owners/admins can set a PIN at any store in
 * their org even without a prior UserStore membership (backend auto-creates
 * the row on first save).
 *
 * Embedded form: renders inside AccountHub's "My PIN" tab. When used as a
 * standalone page (future), the `embedded` prop would be false.
 */
import React, { useEffect, useState } from 'react';
import { KeyRound, Check, AlertCircle, Trash2, Eye, EyeOff, Loader } from 'lucide-react';
import { toast } from 'react-toastify';
import { listMyPins, setMyPin, removeMyPin } from '../services/api';
import { useConfirm } from '../hooks/useConfirmDialog.jsx';
import './MyPIN.css';

export default function MyPIN() {
  const confirm = useConfirm();
  const [stores,  setStores]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  // Per-store editing state, keyed by storeId
  const [drafts, setDrafts] = useState({});   // { [storeId]: { pin, confirm, show } }
  const [busy,   setBusy]   = useState({});   // { [storeId]: 'save' | 'remove' }

  const loadStores = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listMyPins();
      setStores(res.stores || []);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load stores');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadStores(); }, []);

  const updateDraft = (storeId, patch) => {
    setDrafts(prev => ({
      ...prev,
      [storeId]: { pin: '', confirm: '', show: false, ...prev[storeId], ...patch },
    }));
  };

  const digitsOnly = (v) => v.replace(/\D/g, '').slice(0, 6);

  const handleSave = async (store) => {
    const draft = drafts[store.storeId] || {};
    const { pin, confirm } = draft;

    if (!pin || pin.length < 4) {
      toast.error('PIN must be at least 4 digits');
      return;
    }
    if (pin.length > 6) {
      toast.error('PIN can be at most 6 digits');
      return;
    }
    if (pin !== confirm) {
      toast.error('PINs do not match');
      return;
    }

    setBusy(b => ({ ...b, [store.storeId]: 'save' }));
    try {
      await setMyPin(store.storeId, pin);
      toast.success(`PIN saved for ${store.storeName}`);
      setDrafts(d => ({ ...d, [store.storeId]: { pin: '', confirm: '', show: false } }));
      loadStores();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save PIN');
    } finally {
      setBusy(b => ({ ...b, [store.storeId]: null }));
    }
  };

  const handleRemove = async (store) => {
    if (!await confirm({
      title: `Remove PIN for ${store.storeName}?`,
      message: 'You will need to enter a new PIN before logging in at that register again.',
      confirmLabel: 'Remove PIN',
      danger: true,
    })) return;
    setBusy(b => ({ ...b, [store.storeId]: 'remove' }));
    try {
      await removeMyPin(store.storeId);
      toast.success(`PIN removed for ${store.storeName}`);
      loadStores();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to remove PIN');
    } finally {
      setBusy(b => ({ ...b, [store.storeId]: null }));
    }
  };

  if (loading) {
    return (
      <div className="mypin-loading">
        <Loader size={18} className="mypin-spin" /> Loading stores…
      </div>
    );
  }

  if (error) {
    return (
      <div className="mypin-error">
        <AlertCircle size={16} /> {error}
        <button className="mypin-retry" onClick={loadStores}>Retry</button>
      </div>
    );
  }

  if (stores.length === 0) {
    return (
      <div className="mypin-empty">
        <KeyRound size={28} className="mypin-empty-icon" />
        <p className="mypin-empty-title">No stores available</p>
        <p className="mypin-empty-sub">Ask an owner or admin to add you to a store before setting a register PIN.</p>
      </div>
    );
  }

  return (
    <div className="mypin-wrap">
      <div className="mypin-intro">
        <div className="mypin-intro-icon"><KeyRound size={18} /></div>
        <div>
          <h2 className="mypin-intro-title">Your Register PIN</h2>
          <p className="mypin-intro-sub">
            Set a 4–6 digit PIN for each store to sign in at that store's register without typing your email.
            Owners can set a different PIN at each store — perfect when you manage multiple locations.
          </p>
        </div>
      </div>

      <div className="mypin-list">
        {stores.map(store => {
          const draft = drafts[store.storeId] || { pin: '', confirm: '', show: false };
          const isSaving   = busy[store.storeId] === 'save';
          const isRemoving = busy[store.storeId] === 'remove';
          const canSave = draft.pin.length >= 4 && draft.pin === draft.confirm && !isSaving;

          return (
            <div key={store.storeId} className="mypin-card">
              <div className="mypin-card-head">
                <div>
                  <div className="mypin-store-name">{store.storeName}</div>
                  <div className={`mypin-status ${store.hasPin ? 'mypin-status--set' : 'mypin-status--unset'}`}>
                    {store.hasPin ? (
                      <><Check size={12} /> PIN is set</>
                    ) : (
                      <><AlertCircle size={12} /> No PIN set</>
                    )}
                  </div>
                </div>
                {store.hasPin && (
                  <button
                    className="mypin-remove"
                    onClick={() => handleRemove(store)}
                    disabled={isRemoving}
                    title="Remove PIN"
                  >
                    <Trash2 size={14} /> {isRemoving ? 'Removing…' : 'Remove'}
                  </button>
                )}
              </div>

              <div className="mypin-form">
                <label className="mypin-label">
                  {store.hasPin ? 'New PIN' : 'Set PIN'} (4–6 digits)
                </label>
                <div className="mypin-input-row">
                  <input
                    type={draft.show ? 'text' : 'password'}
                    inputMode="numeric"
                    autoComplete="new-password"
                    value={draft.pin}
                    onChange={e => updateDraft(store.storeId, { pin: digitsOnly(e.target.value) })}
                    placeholder="••••"
                    className="mypin-input"
                  />
                  <button
                    type="button"
                    className="mypin-eye"
                    onClick={() => updateDraft(store.storeId, { show: !draft.show })}
                    title={draft.show ? 'Hide PIN' : 'Show PIN'}
                  >
                    {draft.show ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>

                <label className="mypin-label">Confirm PIN</label>
                <input
                  type={draft.show ? 'text' : 'password'}
                  inputMode="numeric"
                  autoComplete="new-password"
                  value={draft.confirm}
                  onChange={e => updateDraft(store.storeId, { confirm: digitsOnly(e.target.value) })}
                  placeholder="••••"
                  className="mypin-input"
                />

                {draft.pin && draft.confirm && draft.pin !== draft.confirm && (
                  <div className="mypin-mismatch"><AlertCircle size={12} /> PINs do not match</div>
                )}

                <button
                  className="mypin-save"
                  onClick={() => handleSave(store)}
                  disabled={!canSave}
                >
                  {isSaving ? (
                    <><Loader size={14} className="mypin-spin" /> Saving…</>
                  ) : (
                    <><Check size={14} /> {store.hasPin ? 'Update PIN' : 'Save PIN'}</>
                  )}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mypin-hint">
        <strong>Tip:</strong> your PIN is what you enter on the cashier app at that store's register.
        A different PIN per store lets you separate your activity across locations in reports.
      </div>
    </div>
  );
}
