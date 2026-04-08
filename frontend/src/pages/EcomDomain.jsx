import { useState, useEffect } from 'react';
import Sidebar from '../components/Sidebar';
import { toast } from 'react-toastify';
import './EcomDomain.css';

const API = '/api/ecom';

function getHeaders() {
  const u = JSON.parse(localStorage.getItem('user') || '{}');
  const storeId = localStorage.getItem('activeStoreId') || '';
  return {
    Authorization: `Bearer ${u.token}`,
    'X-Store-Id': storeId,
    'X-Org-Id': u.orgId || u.tenantId || '',
    'Content-Type': 'application/json',
  };
}

async function api(method, path, body) {
  const r = await fetch(`${API}${path}`, { method, headers: getHeaders(), body: body ? JSON.stringify(body) : undefined });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export default function EcomDomain() {
  const [domain, setDomain] = useState(null);
  const [newDomain, setNewDomain] = useState('');
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [message, setMessage] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const d = await api('GET', '/manage/domain/status');
      setDomain(d.data);
    } catch { setDomain(null); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleConnect = async () => {
    if (!newDomain.trim()) { toast.error('Enter a domain'); return; }
    try {
      const d = await api('POST', '/manage/domain', { domain: newDomain.trim() });
      setDomain(d.data);
      setNewDomain('');
      setMessage({ type: 'info', text: d.data.instructions });
      toast.success('Domain saved! Now set up your DNS.');
    } catch (e) { toast.error(e.message); }
  };

  const handleVerify = async () => {
    setVerifying(true);
    setMessage(null);
    try {
      const d = await api('POST', '/manage/domain/verify');
      setDomain(prev => ({ ...prev, ...d.data }));
      setMessage({
        type: d.data.domainVerified ? 'success' : 'warning',
        text: d.data.message,
      });
    } catch (e) { toast.error(e.message); }
    setVerifying(false);
  };

  const handleRemove = async () => {
    if (!window.confirm('Remove custom domain? Your store will only be accessible via the default URL.')) return;
    try {
      await api('DELETE', '/manage/domain');
      setDomain(prev => ({ ...prev, customDomain: null, domainVerified: false, sslStatus: 'pending' }));
      setMessage(null);
      toast.success('Custom domain removed');
    } catch (e) { toast.error(e.message); }
  };

  if (loading) return <div className="layout-container"><Sidebar /><main className="main-content"><p style={{ color: 'var(--text-muted)' }}>Loading...</p></main></div>;

  return (
    <div className="layout-container"><Sidebar /><main className="main-content">
      <div className="edom-header">
        <h1 className="edom-title">Custom Domain</h1>
        <p className="edom-subtitle">Connect your own domain for a fully branded storefront experience.</p>
      </div>

      {/* Default Domain */}
      <div className="edom-section">
        <div className="edom-section-title">Default Store URL</div>
        <div className="edom-domain-row">
          <span className="edom-domain-label">URL</span>
          <span className="edom-domain-value">{domain?.defaultDomain || 'Not set up yet'}</span>
          <span className="edom-domain-badge edom-domain-badge--active">Active</span>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>This is always available, even with a custom domain.</p>
      </div>

      {/* Custom Domain */}
      <div className="edom-section">
        <div className="edom-section-title">Custom Domain</div>

        {domain?.customDomain ? (
          <>
            <div className="edom-domain-row">
              <span className="edom-domain-label">Domain</span>
              <span className="edom-domain-value">{domain.customDomain}</span>
              <span className={`edom-domain-badge edom-domain-badge--${domain.domainVerified ? 'active' : 'pending'}`}>
                {domain.domainVerified ? 'Verified' : 'Pending'}
              </span>
            </div>
            <div className="edom-domain-row">
              <span className="edom-domain-label">SSL</span>
              <span className="edom-domain-value">{domain.sslStatus}</span>
              <span className={`edom-domain-badge edom-domain-badge--${domain.sslStatus === 'active' ? 'active' : 'pending'}`}>
                {domain.sslStatus === 'active' ? 'Active' : 'Pending'}
              </span>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button className="edom-btn edom-btn--secondary" onClick={handleVerify} disabled={verifying}>
                {verifying ? 'Checking...' : 'Verify DNS'}
              </button>
              <button className="edom-btn edom-btn--danger" onClick={handleRemove}>Remove Domain</button>
            </div>

            {message && (
              <div className={`edom-message edom-message--${message.type}`}>{message.text}</div>
            )}

            {!domain.domainVerified && (
              <div className="edom-instructions">
                <div className="edom-instructions-title">DNS Setup Instructions</div>
                <ol>
                  <li>Go to your domain registrar's DNS settings (GoDaddy, Namecheap, Cloudflare, etc.)</li>
                  <li>Create a <strong>CNAME record</strong>:
                    <br />Name/Host: <code>{domain.customDomain.split('.')[0]}</code>
                    <br />Value/Target: <code>{domain.cnameTarget}</code>
                  </li>
                  <li>Save the DNS record and wait 5-30 minutes for propagation</li>
                  <li>Click <strong>"Verify DNS"</strong> above to check if it's working</li>
                </ol>
              </div>
            )}
          </>
        ) : (
          <>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
              Connect a custom domain like <code style={{ color: 'var(--brand-primary)' }}>shop.yourdomain.com</code> to your online store.
            </p>
            <div className="edom-input-row">
              <input
                className="edom-input"
                placeholder="shop.yourdomain.com"
                value={newDomain}
                onChange={e => setNewDomain(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleConnect()}
              />
              <button className="edom-btn edom-btn--primary" onClick={handleConnect}>Connect Domain</button>
            </div>
          </>
        )}
      </div>

      {/* How it works */}
      <div className="edom-section">
        <div className="edom-section-title">How Custom Domains Work</div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
          <p><strong>1. Enter your domain</strong> — Type the subdomain you want to use (e.g. shop.yourdomain.com)</p>
          <p><strong>2. Set up DNS</strong> — Add a CNAME record at your domain registrar pointing to our servers</p>
          <p><strong>3. Verify</strong> — Click "Verify DNS" to confirm the record is set correctly</p>
          <p><strong>4. SSL automatic</strong> — We automatically provision an SSL certificate for your domain</p>
          <p style={{ marginTop: 12, color: 'var(--text-muted)' }}>
            Note: DNS changes can take 5 minutes to 48 hours to propagate globally.
          </p>
        </div>
      </div>
    </main></div>
  );
}
