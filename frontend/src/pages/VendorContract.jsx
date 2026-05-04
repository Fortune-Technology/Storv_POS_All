// ─────────────────────────────────────────────────
// Vendor Contract Signing Page — S77 Phase 2
//
// Reachable when:
//   1. Admin generates + sends a contract → user.contractSigned still false
//   2. /vendor-awaiting auto-routes the user here when status='contract_sent'
//
// UX: scroll-to-bottom-required → enter signer info → sign on canvas → submit.
// On success, navigates back to /vendor-awaiting (which will show
// 'contract signed — awaiting activation' state).
// ─────────────────────────────────────────────────
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { Loader, FileText, Pen, Trash2, CheckCircle2, AlertCircle, Download, ChevronDown } from 'lucide-react';
import { toast } from 'react-toastify';
import StoreveuLogo from '../components/StoreveuLogo';
import { getMyContract, signMyContract, downloadMyContract } from '../services/api';
import './VendorContract.css';

export default function VendorContract() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token') || undefined;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);

  // Form state
  const [signerName, setSignerName] = useState('');
  const [signerTitle, setSignerTitle] = useState('');
  const [signerEmail, setSignerEmail] = useState('');
  const [bankName, setBankName] = useState('');
  const [bankRoutingLast4, setBankRoutingLast4] = useState('');
  const [bankAccountLast4, setBankAccountLast4] = useState('');
  const [scrolledBottom, setScrolledBottom] = useState(false);
  const [submitting, setSubmitting] = useState(false);

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
        // Pre-fill signer info from existing user.
        const u = JSON.parse(localStorage.getItem('user') || '{}');
        setSignerName(u.name || '');
        setSignerEmail(u.email || '');
      } catch (err) {
        if (cancelled) return;
        setError(err.response?.data?.error || 'Failed to load contract.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id, token]);

  // ── Canvas setup — only when ready to sign ──
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
  const startDraw = (e) => {
    e.preventDefault();
    setDrawing(true);
    lastPos.current = getPos(e);
  };
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

  // Body scroll detection — enables sign button only after vendor scrolls to bottom.
  const handleBodyScroll = (e) => {
    const el = e.target;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 40) {
      setScrolledBottom(true);
    }
  };
  // If the contract body fits without scrolling, treat as already-scrolled.
  useEffect(() => {
    if (!data || !bodyRef.current) return;
    const el = bodyRef.current;
    if (el.scrollHeight - el.clientHeight < 40) setScrolledBottom(true);
  }, [data]);

  const scrollToSign = () => {
    document.getElementById('vc-sign-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleSubmit = async () => {
    if (!signerName.trim() || signerName.trim().length < 2) {
      toast.error('Please enter your full legal name.'); return;
    }
    if (!hasSignature) {
      toast.error('Please draw your signature in the box.'); return;
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
      });
      // Update local user flag so the awaiting page can advance.
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
              <a className="vc-btn vc-btn--primary" href={downloadMyContract(id)} download>
                <Download size={14} /> Download signed PDF
              </a>
            )}
          </div>
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

            <div className="vc-attest">
              By clicking <strong>Sign &amp; Submit</strong> below, I acknowledge that I have read,
              understood, and agree to be legally bound by all terms of the agreement above.
              I authorize StoreVeu to record my IP address and timestamp as evidence of execution.
            </div>

            <button
              type="button"
              className="vc-btn vc-btn--submit"
              onClick={handleSubmit}
              disabled={submitting || !scrolledBottom || !hasSignature || !signerName.trim()}
            >
              {submitting ? <Loader size={16} className="vc-spin" /> : <><CheckCircle2 size={16} /> Sign &amp; Submit</>}
            </button>
          </section>
        )}
      </main>
    </div>
  );
}
