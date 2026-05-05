// ─────────────────────────────────────────────────
// Vendor Awaiting screen — S77 Phase 1
// Shown after questionnaire submission and on every login until admin
// has reviewed + sent a contract + the vendor signs + admin approves.
// Reads onboarding status to show the correct stage messaging.
// ─────────────────────────────────────────────────
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, CheckCircle2, AlertCircle, FileText, LogOut, RefreshCw, Pen } from 'lucide-react';
import StoreveuLogo from '../components/StoreveuLogo';
import { getMyVendorOnboarding, listMyContracts } from '../services/api';
import { toast } from 'react-toastify';
import './VendorAwaiting.css';

const STAGES = [
  { key: 'submitted',       label: 'Application submitted', icon: <CheckCircle2 size={18} /> },
  { key: 'reviewed',        label: 'Under review by our team', icon: <Clock size={18} /> },
  { key: 'contract_sent',   label: 'Contract sent for signature', icon: <FileText size={18} /> },
  { key: 'contract_signed', label: 'Contract signed', icon: <CheckCircle2 size={18} /> },
  { key: 'approved',        label: 'Account activated', icon: <CheckCircle2 size={18} /> },
];

function stageIndex(status) {
  switch (status) {
    case 'submitted':       return 0;
    case 'reviewed':        return 1;
    case 'contract_sent':   return 2;
    case 'contract_signed': return 3;
    case 'approved':        return 4;
    default:                return 0;
  }
}

export default function VendorAwaiting() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [pendingContract, setPendingContract] = useState(null); // { id, status }
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    setRefreshing(true);
    try {
      const res = await getMyVendorOnboarding();
      setData(res);

      // If admin has approved + signed off, advance the user to the
      // existing org-creation onboarding (or portal if they already have one).
      if (res.userFlags?.vendorApproved && res.userFlags?.contractSigned) {
        const u = JSON.parse(localStorage.getItem('user') || '{}');
        u.vendorApproved = true;
        u.contractSigned = true;
        localStorage.setItem('user', JSON.stringify(u));
        if (u.tenantId) {
          navigate('/portal/realtime', { replace: true });
        } else {
          navigate('/onboarding', { replace: true });
        }
        return;
      }
      // If they haven't actually submitted yet, kick back to the wizard.
      if (!res.userFlags?.onboardingSubmitted) {
        navigate('/vendor-onboarding', { replace: true });
        return;
      }

      // S77 Phase 2 — check if a contract was sent and is awaiting signature.
      // We don't auto-redirect (the vendor should be able to opt to sign vs. browse status),
      // but we surface a prominent "Sign your contract" CTA.
      try {
        const cRes = await listMyContracts();
        const next = (cRes.contracts || []).find(c => c.status === 'sent' || c.status === 'viewed');
        setPendingContract(next || null);
      } catch { /* contracts endpoint failure is non-blocking */ }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to load status.');
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-line */ }, []);

  const handleLogout = () => {
    localStorage.removeItem('user');
    localStorage.removeItem('activeStoreId');
    window.dispatchEvent(new Event('storv:auth-change'));
    navigate('/login', { replace: true });
  };

  const status = data?.onboarding?.status || 'submitted';
  const isRejected = status === 'rejected';
  const currentIdx = stageIndex(status);

  return (
    <div className="va-page">
      <div className="va-card">
        <div className="va-header">
          <StoreveuLogo height={36} darkMode={false} />
          <div className="va-actions">
            <button className="va-icon-btn" onClick={load} disabled={refreshing} title="Refresh">
              <RefreshCw size={14} className={refreshing ? 'va-spin' : ''} />
              Refresh
            </button>
            <button className="va-icon-btn va-icon-btn--logout" onClick={handleLogout} title="Sign out">
              <LogOut size={14} /> Sign out
            </button>
          </div>
        </div>

        {isRejected ? (
          <div className="va-rejected">
            <div className="va-rejected-icon"><AlertCircle size={42} /></div>
            <h2>Application Not Approved</h2>
            <p className="va-rejected-msg">
              Unfortunately we are unable to onboard your business at this time.
            </p>
            {data?.onboarding?.rejectionReason && (
              <div className="va-rejected-reason">
                <strong>Reason:</strong> {data.onboarding.rejectionReason}
              </div>
            )}
            <p className="va-help">
              If you believe this was in error, please contact <a href="mailto:support@storeveu.com">support@storeveu.com</a>.
            </p>
          </div>
        ) : (
          <>
            {pendingContract ? (
              <div className="va-hero va-hero--action">
                <div className="va-hero-icon va-hero-icon--action"><Pen size={42} /></div>
                <h2>Your contract is ready to sign</h2>
                <p className="va-hero-msg">
                  Our team has reviewed your application and prepared your Merchant Services Agreement.
                  Review and sign it below to complete onboarding.
                </p>
                <button
                  className="va-cta-btn"
                  onClick={() => navigate(`/vendor-contract/${pendingContract.id}`)}
                >
                  <Pen size={16} /> Review &amp; Sign Contract
                </button>
              </div>
            ) : (
              <div className="va-hero">
                <div className="va-hero-icon"><Clock size={42} /></div>
                <h2>Thanks — your application is in review</h2>
                <p className="va-hero-msg">
                  We've received your business details and our team is reviewing your information.
                  You'll receive an email update as your application moves through the next steps below.
                </p>
              </div>
            )}

            <div className="va-stages">
              {STAGES.map((stage, idx) => (
                <div
                  key={stage.key}
                  className={`va-stage ${idx <= currentIdx ? 'is-done' : ''} ${idx === currentIdx ? 'is-current' : ''}`}
                >
                  <div className="va-stage-marker">
                    {idx <= currentIdx ? <CheckCircle2 size={16} /> : <div className="va-stage-empty" />}
                  </div>
                  <div className="va-stage-content">
                    <div className="va-stage-label">{stage.label}</div>
                    {idx === currentIdx && idx < 4 && <div className="va-stage-current">In progress</div>}
                  </div>
                </div>
              ))}
            </div>

            <div className="va-info">
              <div>
                <strong>Submitted:</strong>{' '}
                {data?.onboarding?.submittedAt
                  ? new Date(data.onboarding.submittedAt).toLocaleString()
                  : '—'}
              </div>
              {data?.onboarding?.reviewedAt && (
                <div>
                  <strong>Reviewed:</strong> {new Date(data.onboarding.reviewedAt).toLocaleString()}
                </div>
              )}
            </div>

            <div className="va-help">
              Questions? Reach us at <a href="mailto:support@storeveu.com">support@storeveu.com</a>.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
