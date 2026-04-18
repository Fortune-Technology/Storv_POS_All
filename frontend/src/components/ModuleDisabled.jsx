/**
 * ModuleDisabled — friendly empty state for pages whose feature flag is off.
 *
 * Rendered by pages like Lottery / Fuel when the active store has the module
 * disabled in Store Settings. Also covers the paste-the-URL path (users who
 * bookmarked the page before the module was turned off).
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { Settings2 } from 'lucide-react';
import './ModuleDisabled.css';

export default function ModuleDisabled({ icon: Icon, title, description }) {
  return (
    <div className="md-wrap">
      <div className="md-card">
        {Icon && <Icon size={36} className="md-icon" />}
        <h2 className="md-title">{title}</h2>
        <p className="md-desc">{description}</p>
        <Link to="/portal/account?tab=settings" className="md-cta">
          <Settings2 size={14} /> Enable in Store Settings
        </Link>
      </div>
    </div>
  );
}
