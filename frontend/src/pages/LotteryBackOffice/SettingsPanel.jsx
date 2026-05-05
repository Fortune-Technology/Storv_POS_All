// ════════════════════════════════════════════════════════════════════
// SETTINGS PANEL — store-level lottery configuration (Phase E, Apr 2026)
// Inline panel so the owner can tune lottery behavior without leaving
// the back-office Daily view (was previously buried under Lottery →
// Settings tab and easy to miss).
// Extracted from LotteryBackOffice (May 2026 split).
// ════════════════════════════════════════════════════════════════════
import React, { useEffect, useMemo, useState } from 'react';
import { Settings, X } from 'lucide-react';
import { updateLotterySettings } from '../../services/api';

export default function SettingsPanel({ settings, onClose, onSaved }) {
  const initial = useMemo(() => ({
    enabled:                    settings?.enabled                    ?? true,
    cashOnly:                   settings?.cashOnly                   ?? false,
    state:                      settings?.state                      ?? '',
    commissionRate:             settings?.commissionRate != null
                                  ? Number(settings.commissionRate) * 100  // store rate is 0.054 → display 5.4
                                  : '',
    scanRequiredAtShiftEnd:     settings?.scanRequiredAtShiftEnd     ?? false,
    sellDirection:              settings?.sellDirection              ?? 'desc',
    allowMultipleActivePerGame: settings?.allowMultipleActivePerGame ?? false,
    shiftVarianceDisplay:       settings?.shiftVarianceDisplay       ?? 'always',
    shiftVarianceThreshold:     settings?.shiftVarianceThreshold != null
                                  ? Number(settings.shiftVarianceThreshold)
                                  : 0,
  }), [settings]);

  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  // Re-init when settings change (e.g. after first load)
  useEffect(() => { setForm(initial); }, [initial]);

  const isDirty = useMemo(() => {
    return Object.keys(initial).some(k => initial[k] !== form[k]);
  }, [initial, form]);

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const submit = async () => {
    setSaving(true); setErr('');
    try {
      const storeId = localStorage.getItem('activeStoreId');
      const payload = {
        enabled:                    Boolean(form.enabled),
        cashOnly:                   Boolean(form.cashOnly),
        state:                      form.state || null,
        commissionRate:             form.commissionRate === '' ? null : Number(form.commissionRate) / 100,
        scanRequiredAtShiftEnd:     Boolean(form.scanRequiredAtShiftEnd),
        sellDirection:              form.sellDirection || 'desc',
        allowMultipleActivePerGame: Boolean(form.allowMultipleActivePerGame),
        shiftVarianceDisplay:       form.shiftVarianceDisplay || 'always',
        shiftVarianceThreshold:     Number(form.shiftVarianceThreshold || 0),
      };
      const saved = await updateLotterySettings(storeId, payload);
      onSaved?.(saved);
    } catch (e) {
      setErr(e?.response?.data?.error || e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="lbo-right-tabs lbo-right-tabs--single">
        <span className="active"><Settings size={13} /> Lottery Settings</span>
        <button className="lbo-right-close" onClick={onClose} title="Close settings"><X size={14} /></button>
      </div>
      <div className="lbo-settings-panel">
      {err && <div className="lbo-settings-err">{err}</div>}

      <div className="lbo-settings-body">
        {/* General */}
        <div className="lbo-settings-section">
          <div className="lbo-settings-section-title">GENERAL</div>
          <SettingsToggle
            label="Lottery module enabled"
            hint="Turn off to hide all lottery UI in the cashier app"
            value={form.enabled}
            onChange={v => set('enabled', v)}
          />
          <SettingsToggle
            label="Cash only at register"
            hint="Restrict lottery transactions to cash tender"
            value={form.cashOnly}
            onChange={v => set('cashOnly', v)}
          />
          <SettingsRow label="State / Province" hint="Determines which catalog tickets appear">
            <select className="lbo-settings-input" value={form.state || ''} onChange={e => set('state', e.target.value)}>
              <option value="">— Select —</option>
              {['MA','ME','NH','VT','CT','RI','NY','NJ','PA','DE','MD','VA','NC','SC','GA','FL','ON','QC'].map(s =>
                <option key={s} value={s}>{s}</option>
              )}
            </select>
          </SettingsRow>
          <SettingsRow label="Commission rate (%)" hint="Store-level rate applied to all lottery sales (e.g. 5.4)">
            <input
              className="lbo-settings-input"
              type="number"
              min="0"
              max="100"
              step="0.01"
              placeholder="e.g. 5.4"
              value={form.commissionRate}
              onChange={e => set('commissionRate', e.target.value)}
            />
          </SettingsRow>
        </div>

        {/* Counter behavior */}
        <div className="lbo-settings-section">
          <div className="lbo-settings-section-title">COUNTER BEHAVIOR</div>
          <SettingsRow label="Sell direction" hint="How tickets are loaded in the dispenser">
            <select className="lbo-settings-input" value={form.sellDirection} onChange={e => set('sellDirection', e.target.value)}>
              <option value="desc">Descending (149 → 0 — top of pack first)</option>
              <option value="asc">Ascending (0 → 149 — bottom of pack first)</option>
            </select>
          </SettingsRow>
          <SettingsToggle
            label="Allow multiple active books per game"
            hint="When OFF, scanning a new book of an active game auto-soldouts the old one"
            value={form.allowMultipleActivePerGame}
            onChange={v => set('allowMultipleActivePerGame', v)}
          />
          <SettingsToggle
            label="Require ticket scan at shift end"
            hint="Cashier must scan every active book before closing their shift"
            value={form.scanRequiredAtShiftEnd}
            onChange={v => set('scanRequiredAtShiftEnd', v)}
          />
        </div>

        {/* Audit / variance display */}
        <div className="lbo-settings-section">
          <div className="lbo-settings-section-title">SHIFT VARIANCE DISPLAY</div>
          <div className="lbo-settings-section-hint">
            How the per-shift Audit view shows cash variance for each shift.
            Day-level rollup is always shown.
          </div>
          <SettingsRow label="Display mode">
            <select className="lbo-settings-input" value={form.shiftVarianceDisplay} onChange={e => set('shiftVarianceDisplay', e.target.value)}>
              <option value="always">Always show variance per shift</option>
              <option value="threshold">Only flag when variance exceeds threshold</option>
              <option value="hidden">Hide per-shift variance (day rollup only)</option>
            </select>
          </SettingsRow>
          {form.shiftVarianceDisplay === 'threshold' && (
            <SettingsRow label="Threshold ($)" hint="Per-shift variance below this is hidden">
              <input
                className="lbo-settings-input"
                type="number"
                min="0"
                step="0.01"
                placeholder="e.g. 5.00"
                value={form.shiftVarianceThreshold}
                onChange={e => set('shiftVarianceThreshold', e.target.value)}
              />
            </SettingsRow>
          )}
        </div>
      </div>

      <div className="lbo-pane-foot">
        <div className="lbo-pane-actions">
          <button className="lbo-btn lbo-btn-outline" onClick={onClose}>Close</button>
          <button
            className="lbo-btn lbo-btn-primary"
            disabled={!isDirty || saving}
            onClick={submit}
          >
            {saving ? 'Saving…' : isDirty ? 'Save Changes' : 'Saved'}
          </button>
        </div>
      </div>
      </div>
    </>
  );
}

function SettingsRow({ label, hint, children }) {
  return (
    <label className="lbo-settings-row">
      <div className="lbo-settings-row-head">
        <span className="lbo-settings-row-label">{label}</span>
        {hint && <span className="lbo-settings-row-hint">{hint}</span>}
      </div>
      <div className="lbo-settings-row-control">{children}</div>
    </label>
  );
}

function SettingsToggle({ label, hint, value, onChange }) {
  return (
    <div className="lbo-settings-toggle-row">
      <div className="lbo-settings-row-head">
        <span className="lbo-settings-row-label">{label}</span>
        {hint && <span className="lbo-settings-row-hint">{hint}</span>}
      </div>
      <button
        type="button"
        className={`lbo-settings-toggle ${value ? 'on' : ''}`}
        onClick={() => onChange(!value)}
        aria-pressed={value}
      >
        <span className="lbo-settings-toggle-knob" />
      </button>
    </div>
  );
}
