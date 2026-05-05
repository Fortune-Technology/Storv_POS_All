/**
 * Admin Vendor Pipeline — tabbed hub merging /vendor-onboardings + /contracts.
 *
 * Both pages share the same workflow (vendor signs up → submits onboarding
 * questionnaire → admin reviews → admin generates contract → vendor signs →
 * admin activates → org goes live), the same RBAC permission, and the same
 * Management sidebar group. Two separate sidebar entries for the same
 * pipeline was confusing for admins, so they're consolidated here.
 *
 * Old URLs (`/vendor-onboardings`, `/contracts`) redirect to the right tab
 * inside this hub so existing bookmarks keep working.
 */

import { useState, useEffect, ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ClipboardList, FileSignature, Workflow } from 'lucide-react';
import AdminVendorOnboardings from './AdminVendorOnboardings';
import AdminContracts        from './AdminContracts';

type TabKey = 'onboardings' | 'contracts';

interface TabDef {
  id:    TabKey;
  label: string;
  icon:  ReactNode;
  desc:  string;
}

const TABS: TabDef[] = [
  { id: 'onboardings', label: 'Onboardings', icon: <ClipboardList size={14} />, desc: 'Business questionnaires awaiting review.' },
  { id: 'contracts',   label: 'Contracts',   icon: <FileSignature size={14} />, desc: 'Merchant agreements: draft → sent → signed → activated.' },
];

export default function AdminVendorPipeline() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();

  // ?tab=… deep links + survives query-string preservation when child
  // pages internally read their own ?status= filter.
  const initialTab = (params.get('tab') as TabKey) || 'onboardings';
  const [tab, setTab] = useState<TabKey>(
    TABS.some(t => t.id === initialTab) ? initialTab : 'onboardings',
  );

  // Keep the URL in sync so admins can bookmark a specific tab and come
  // back to it. Use replace so the back button doesn't fill up with tab clicks.
  useEffect(() => {
    if (params.get('tab') !== tab) {
      const next = new URLSearchParams(params);
      next.set('tab', tab);
      setParams(next, { replace: true });
    }
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const active = TABS.find(t => t.id === tab) || TABS[0];

  return (
    <>
      <div className="admin-header">
        <div className="admin-header-left">
          <div className="admin-header-icon"><Workflow size={22} /></div>
          <div>
            <h1>Vendor Pipeline</h1>
            <p>{active.desc}</p>
          </div>
        </div>
      </div>

      <div className="admin-tabs" role="tablist">
        {TABS.map(t => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`admin-tab${tab === t.id ? ' active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.icon}
            <span style={{ marginLeft: 6 }}>{t.label}</span>
          </button>
        ))}
        {/* Quick-jump from Onboardings → Contracts when reviewing pipeline. */}
        <button
          type="button"
          className="admin-tab"
          style={{ marginLeft: 'auto', background: 'transparent', border: '0', color: 'var(--text-muted, #94a3b8)', cursor: 'pointer' }}
          onClick={() => navigate('/dashboard')}
        >
          ← Back to Dashboard
        </button>
      </div>

      <div style={{ paddingTop: 8 }}>
        {tab === 'onboardings' && <AdminVendorOnboardings embedded />}
        {tab === 'contracts'   && <AdminContracts        embedded />}
      </div>
    </>
  );
}
