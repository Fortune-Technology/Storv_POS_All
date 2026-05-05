// ─────────────────────────────────────────────────
// Vendor Contract Signing Page — S77 Phase 2
//
// Production-grade signing flow.
//
// Reachable when:
//   1. Admin generates + sends a contract → user.contractSigned still false
//   2. /vendor-awaiting auto-routes the user here when status='contract_sent'
//
// UX layered to match DocuSign / Dropbox Sign convention:
//   • REVIEW the rendered agreement (locked content — pricing, legal terms)
//   • EDIT vendor-side fields (contact info, owner contact, bank info)
//     — keys come from template MERGE_FIELDS where collectedAtSigning: true
//   • SAVE DRAFT (optional) — vendor can update fields and come back later
//     via the same email link. Status stays 'viewed', edits persist.
//   • SIGN — typed signer info + signature canvas + ESIGN/UETA consent
//     checkbox (federal 15 U.S.C. § 7001 requires affirmative consent).
//
// On success, navigates back to /vendor-awaiting.
// ─────────────────────────────────────────────────
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import {
  Loader, FileText, Pen, Trash2, CheckCircle2, AlertCircle, Download,
  ChevronDown, Save, Edit3, Lock, Clock,
} from 'lucide-react';
import { toast } from 'react-toastify';
import StoreveuLogo from '../components/StoreveuLogo';
import {
  getMyContract,
  saveMyContractDraft,
  signMyContract,
  downloadMyContractPdf,
} from '../services/api';
import './VendorContract.css';

// Walk a dotted path on a nested object (mergeValues['merchant.phone'] etc.)
function getDotted(obj, path) {
  if (!obj) return undefined;
  return path.split('.').reduce((acc, k) => (acc == null ? undefined : acc[k]), obj);
}

// Render label per field type — only used for the editable form's input element.
// Read-only locked fields are rendered as plain text in the contract body.
function FieldInput({ field, value, onChange, disabled }) {
  const common = {
    className: 'vc-input',
    value: value ?? '',
    onChange: e => onChange(e.target.value),
    disabled,
    placeholder: field.label,
  };
  if (field.type === 'choice' && Array.isArray(field.choices)) {
    return (
      <select {...common}>
        <option value="">— select —</option>
        {field.choices.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
    );
  }
  if (field.type === 'date') {
    return <input type="date" {...common} />;
  }
  if (field.type === 'number') {
    return <input type="number" min="0" {...common} />;
  }
  if (field.type === 'email') {
    return <input type="email" {...common} />;
  }
  return <input type="text" {...common} />;
}

export default function VendorContract() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token') || undefined;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [errorCode, setErrorCode] = useState(null);
  const [data, setData] = useState(null);

  // ── Vendor-editable mergeValues (driven by template's collectedAtSigning fields) ──
  const [editableValues, setEditableValues] = useState({}); // { 'merchant.phone': '...', ... }
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftDirty, setDraftDirty] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState(null);

  // ── Sign-time form state ──
  const [signerName, setSignerName] = useState('');
  const [signerTitle, setSignerTitle] = useState('');
  const [signerEmail, setSignerEmail] = useState('');
  const [bankName, setBankName] = useState('');
  const [bankRoutingLast4, setBankRoutingLast4] = useState('');
  const [bankAccountLast4, setBankAccountLast4] = useState('');
  const [esignConsent, setEsignConsent] = useState(false);
  const [scrolledBottom, setScrolledBottom] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  // Canvas
  const canvasRef = useRef(null);
  const [drawing, setDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);
  const lastPos = useRef({ x: 0, y: 0 });

  // Body scroll-tracking
  const bodyRef = useRef(null);

  // ── Initial load ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await getMyContract(id, token);
        if (cancelled) return;
        setData(res);

        // Pre-fill signer info from existing user account.
        const u = JSON.parse(localStorage.getItem('user') || '{}');
        setSignerName(u.name || '');
        setSignerEmail(u.email || '');

        // Pre-fill the editable form from the contract's mergeValues for
        // every field flagged collectedAtSigning:true. Vendor sees what
        // admin already filled and can edit before signing.
        const fields = res.mergeFields?.fields ?? [];
        const editableKeys = fields.filter(f => f.collectedAtSigning).map(f => f.key);
        const initial = {};
        for (const key of editableKeys) {
          const v = getDotted(res.contract.mergeValues, key);
          if (v != null) initial[key] = String(v);
        }
        setEditableValues(initial);

        // Bank fields drive their own sign-time inputs (kept separate so
        // they sit visually next to the ACH authorization section).
        setBankName(getDotted(res.contract.mergeValues, 'bank.name') || '');
        setBankRoutingLast4(getDotted(res.contract.mergeValues, 'bank.routingLast4') || '');
        setBankAccountLast4(getDotted(res.contract.mergeValues, 'bank.accountLast4') || '');
      } catch (err) {
        if (cancelled) return;
        const msg  = err.response?.data?.error || 'Failed to load contract.';
        const code = err.response?.data?.code || null;
        setError(msg);
        setErrorCode(code);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id, token]);

  // ── Editable-field sections grouped by `group` from MERGE_FIELDS ──
  const editableSections = useMemo(() => {
    if (!data?.mergeFields?.fields) return [];
    const fields = data.mergeFields.fields.filter(f => f.collectedAtSigning);
    const byGroup = {};
    for (const f of fields) {
      const g = f.group || 'Details';
      if (!byGroup[g]) byGroup[g] = [];
      byGroup[g].push(f);
    }
    return Object.entries(byGroup).map(([group, items]) => ({ group, items }));
  }, [data]);

  // ── Canvas setup ──
  const setupCanvas = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ratio = window.devicePixelRatio || 1;
    const rect = c.getBoundingClientRect();
    c.width = rect.width * ratio;
    c.height = rect.height * ratio;
    const ctx = c.getContext('2d');
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#1f2937';
  }, []);
  useEffect(() => {
    setupCanvas();
    window.addEventListener('resize', setupCanvas);
    return () => window.removeEventListener('resize', setupCanvas);
  }, [setupCanvas, data]);

  const getPos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    if (e.touches && e.touches[0]) {
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const startDraw = (e) => { e.preventDefault(); setDrawing(true); lastPos.current = getPos(e); };
  const moveDraw = (e) => {
    if (!drawing) return;
    e.preventDefault();
    const ctx = canvasRef.current.getContext('2d');
    const p = getPos(e);
    ctx.beginPath();
    ctx.moveTo(lastPos.current.x, lastPos.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    lastPos.current = p;
    setHasSignature(true);
  };
  const endDraw = () => setDrawing(false);

  const clearSignature = () => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    setHasSignature(false);
  };

  // Body scroll detection
  const handleBodyScroll = (e) => {
    const el = e.target;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 40) setScrolledBottom(true);
  };
  useEffect(() => {
    if (!data || !bodyRef.current) return;
    const el = bodyRef.current;
    if (el.scrollHeight - el.clientHeight < 40) setScrolledBottom(true);
  }, [data]);

  const scrollToSign = () => {
    document.getElementById('vc-sign-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const scrollToEdit = () => {
    document.getElementById('vc-edit-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // ── Editable field handlers ──
  const setEditable = (key, value) => {
    setEditableValues(prev => ({ ...prev, [key]: value }));
    setDraftDirty(true);
  };

  const handleSaveDraft = async () => {
    if (!draftDirty || savingDraft) return;
    setSavingDraft(true);
    try {
      await saveMyContractDraft(id, editableValues);
      setDraftDirty(false);
      setLastSavedAt(new Date());
      toast.success('Draft saved. You can come back to finish signing later.');
      // Refresh the rendered HTML so the contract body reflects the new values.
      const res = await getMyContract(id, token);
      setData(res);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save draft.');
    } finally {
      setSavingDraft(false);
    }
  };

  // ── Submit (sign) ──
  const handleSubmit = async () => {
    if (!signerName.trim() || signerName.trim().length < 2) {
      toast.error('Please enter your full legal name.'); return;
    }
    if (!hasSignature) {
      toast.error('Please draw your signature in the box.'); return;
    }
    if (!esignConsent) {
      toast.error('Please tick the electronic-signature consent box to proceed.'); return;
    }
    setSubmitting(true);
    try {
      const dataUrl = canvasRef.current.toDataURL('image/png');
      await signMyContract(id, {
        signerName: signerName.trim(),
        signerTitle: signerTitle.trim(),
        signerEmail: signerEmail.trim(),
        signatureDataUrl: dataUrl,
        bankName: bankName.trim(),
        bankRoutingLast4: bankRoutingLast4.trim(),
        bankAccountLast4: bankAccountLast4.trim(),
        esignConsent: true,
        // Final-pass edits — same whitelist as Save Draft. Anything not in
        // collectedAtSigning is silently ignored server-side.
        values: editableValues,
      });
      const u = JSON.parse(localStorage.getItem('user') || '{}');
      u.contractSigned = true;
      localStorage.setItem('user', JSON.stringify(u));
      window.dispatchEvent(new Event('storv:auth-change'));
      toast.success('Contract signed! Your account is now awaiting administrator activation.');
      navigate('/vendor-awaiting', { replace: true });
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to submit signature.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render ──
  if (loading) {
    return (
      <div className="vc-page">
        <div className="vc-card vc-loading"><Loader size={28} className="vc-spin" /></div>
      </div>
    );
  }

  // Expired link state — backend returns code: 'CONTRACT_EXPIRED' on GET
  // when expiresAt < now. Show a clean "ask admin to resend" page rather
  // than a generic error.
  if (error && errorCode === 'CONTRACT_EXPIRED') {
    return (
      <div className="vc-page">
        <div className="vc-card vc-error">
          <Clock size={36} />
          <h2>This contract link has expired</h2>
          <p>For security, contract links expire 30 days after they're sent.</p>
          <p>Please contact your StoreVeu representative or email <strong>support@storeveu.com</strong> for a fresh link.</p>
          <button className="vc-btn" onClick={() => navigate('/vendor-awaiting')}>Back to status</button>
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="vc-page">
        <div className="vc-card vc-error">
          <AlertCircle size={36} />
          <h2>Couldn't load the contract</h2>
          <p>{error}</p>
          <button className="vc-btn" onClick={() => navigate('/vendor-awaiting')}>Back</button>
        </div>
      </div>
    );
  }

  const { contract, renderedHtml } = data;
  const isSignable = ['sent', 'viewed'].includes(contract.status);
  const isSigned = ['signed', 'countersigned'].includes(contract.status);

  return (
    <div className="vc-page">
      <header className="vc-header">
        <div className="vc-header-inner">
          <StoreveuLogo height={32} darkMode={false} />
          <div className="vc-header-meta">
            <strong>{contract.template?.name || 'Contract'}</strong>
            <span className="vc-meta-sep">·</span>
            <span>v{contract.templateVersion?.versionNumber || 1}</span>
            <span className="vc-meta-sep">·</span>
            <span className={`vc-status vc-status--${contract.status}`}>{contract.status.replace(/_/g, ' ')}</span>
          </div>
        </div>
      </header>

      <main className="vc-main">
        {isSigned && (
          <div className="vc-signed-banner">
            <CheckCircle2 size={22} />
            <div>
              <strong>This contract has already been signed.</strong>
              <p>{contract.signedAt && `Signed on ${new Date(contract.signedAt).toLocaleString()}.`}</p>
            </div>
            {contract.signedPdfPath && (
              <button
                className="vc-btn vc-btn--primary"
                disabled={downloadingPdf}
                onClick={async () => {
                  setDownloadingPdf(true);
                  try {
                    const merchant = data?.contract?.mergeValues?.merchant?.businessLegalName;
                    const safe = (merchant || 'contract').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
                    await downloadMyContractPdf(id, `${safe}-signed.pdf`);
                  } catch (err) {
                    toast.error(err.response?.data?.error || err.message || 'Failed to download PDF.');
                  } finally {
                    setDownloadingPdf(false);
                  }
                }}
              >
                {downloadingPdf
                  ? <><Loader size={14} className="vc-spin" /> Downloading…</>
                  : <><Download size={14} /> Download signed PDF</>}
              </button>
            )}
          </div>
        )}

        {/* ── Editable fields section ── */}
        {isSignable && editableSections.length > 0 && (
          <section id="vc-edit-section" className="vc-card vc-edit-section">
            <div className="vc-card-header">
              <Edit3 size={18} />
              <h2>Verify your business details</h2>
              <span className="vc-section-hint">Update anything that's changed since you submitted your application.</span>
            </div>
            <p className="vc-edit-intro">
              <Lock size={12} /> Pricing, legal terms, and your legal entity name can't be changed here —
              contact your StoreVeu representative if any of those need a correction.
            </p>

            {editableSections.map(({ group, items }) => (
              <div key={group} className="vc-edit-group">
                <h3>{group}</h3>
                <div className="vc-form-grid">
                  {items.map(field => (
                    <div className="vc-field" key={field.key}>
                      <label>
                        {field.label}
                        {field.required && <span className="vc-req">*</span>}
                      </label>
                      <FieldInput
                        field={field}
                        value={editableValues[field.key]}
                        onChange={v => setEditable(field.key, v)}
                        disabled={savingDraft}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}

            <div className="vc-edit-actions">
              <span className="vc-edit-status">
                {savingDraft
                  ? <><Loader size={12} className="vc-spin" /> Saving…</>
                  : draftDirty
                    ? <>Unsaved changes</>
                    : lastSavedAt
                      ? <><CheckCircle2 size={12} /> Saved {lastSavedAt.toLocaleTimeString()}</>
                      : <>All fields up to date</>}
              </span>
              <button
                type="button"
                className="vc-btn vc-btn--secondary"
                onClick={handleSaveDraft}
                disabled={!draftDirty || savingDraft}
              >
                <Save size={14} /> Save Draft
              </button>
            </div>
          </section>
        )}

        <section className="vc-card">
          <div className="vc-card-header">
            <FileText size={18} />
            <h2>Review the agreement</h2>
            {!scrolledBottom && (
              <button className="vc-jump-btn" onClick={scrollToSign}>
                Skip to bottom <ChevronDown size={12} />
              </button>
            )}
          </div>
          <div
            ref={bodyRef}
            className="vc-doc-body"
            onScroll={handleBodyScroll}
            dangerouslySetInnerHTML={{ __html: renderedHtml }}
          />
        </section>

        {isSignable && (
          <section id="vc-sign-section" className="vc-card vc-sign-section">
            <h2><Pen size={18} /> Sign and submit</h2>

            {!scrolledBottom && (
              <div className="vc-warn">
                <AlertCircle size={14} /> Please scroll through the entire agreement above before signing.
              </div>
            )}

            <div className="vc-form-grid">
              <div className="vc-field">
                <label>Full legal name <span className="vc-req">*</span></label>
                <input className="vc-input" value={signerName} onChange={e => setSignerName(e.target.value)} placeholder="Jane M. Doe" />
              </div>
              <div className="vc-field">
                <label>Title <span className="vc-hint">(optional)</span></label>
                <input className="vc-input" value={signerTitle} onChange={e => setSignerTitle(e.target.value)} placeholder="Owner" />
              </div>
              <div className="vc-field">
                <label>Email <span className="vc-hint">(optional)</span></label>
                <input className="vc-input" type="email" value={signerEmail} onChange={e => setSignerEmail(e.target.value)} />
              </div>
            </div>

            <div className="vc-bank-block">
              <h3>ACH Authorization (optional, can be added later)</h3>
              <p className="vc-bank-hint">Required before first ACH debit. You can leave this blank now and our team will collect it before billing starts.</p>
              <div className="vc-form-grid">
                <div className="vc-field">
                  <label>Bank Name</label>
                  <input className="vc-input" value={bankName} onChange={e => setBankName(e.target.value)} placeholder="First National Bank" />
                </div>
                <div className="vc-field">
                  <label>Routing # (last 4)</label>
                  <input className="vc-input" maxLength={4} value={bankRoutingLast4} onChange={e => setBankRoutingLast4(e.target.value.replace(/\D/g, ''))} />
                </div>
                <div className="vc-field">
                  <label>Account # (last 4)</label>
                  <input className="vc-input" maxLength={4} value={bankAccountLast4} onChange={e => setBankAccountLast4(e.target.value.replace(/\D/g, ''))} />
                </div>
              </div>
            </div>

            <div className="vc-signature-block">
              <label>Draw your signature <span className="vc-req">*</span></label>
              <div className="vc-canvas-wrap">
                <canvas
                  ref={canvasRef}
                  className="vc-canvas"
                  onMouseDown={startDraw}
                  onMouseMove={moveDraw}
                  onMouseUp={endDraw}
                  onMouseLeave={endDraw}
                  onTouchStart={startDraw}
                  onTouchMove={moveDraw}
                  onTouchEnd={endDraw}
                />
                <button type="button" className="vc-clear-btn" onClick={clearSignature} disabled={!hasSignature}>
                  <Trash2 size={12} /> Clear
                </button>
              </div>
            </div>

            {/* ESIGN/UETA affirmative consent — federally required. */}
            <label className="vc-esign-consent">
              <input
                type="checkbox"
                checked={esignConsent}
                onChange={e => setEsignConsent(e.target.checked)}
              />
              <span>
                <strong>I have read and agree to the Merchant Services Agreement,</strong> including
                all schedules and acknowledgments above. I consent to the use of electronic records
                and electronic signatures for this transaction (in compliance with the federal ESIGN
                Act and applicable state UETA laws). I understand that my typed name, drawn
                signature, IP address, and timestamp will be retained as legal evidence of execution.
              </span>
            </label>

            <button
              type="button"
              className="vc-btn vc-btn--submit"
              onClick={handleSubmit}
              disabled={
                submitting ||
                !scrolledBottom ||
                !hasSignature ||
                !signerName.trim() ||
                !esignConsent ||
                draftDirty
              }
            >
              {submitting
                ? <Loader size={16} className="vc-spin" />
                : <><CheckCircle2 size={16} /> Sign &amp; Submit</>}
            </button>
            {draftDirty && (
              <div className="vc-warn">
                <AlertCircle size={14} /> Save your draft first, or your edits won't be included in the signed contract.
                <button type="button" className="vc-jump-btn" onClick={scrollToEdit}>Go to edits</button>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
