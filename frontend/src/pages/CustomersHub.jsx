/**
 * CustomersHub — Tabbed hub for customer management + loyalty program
 * Tabs: Customers, Loyalty Program
 */
import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Users, Star } from 'lucide-react';
import Customers from './Customers';
import LoyaltyProgram from './LoyaltyProgram';
import '../styles/portal.css';

const TABS = [
  { key: 'customers', label: 'Customers',       icon: <Users size={14} /> },
  { key: 'loyalty',   label: 'Loyalty Program',  icon: <Star size={14} /> },
];

export default function CustomersHub() {
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') || 'customers';
  const [tab, setTab] = useState(initialTab);

  return (
    <div className="p-page">
      <div className="p-header">
        <div className="p-header-left">
          <div className="p-header-icon"><Users size={22} /></div>
          <div>
            <h1 className="p-title">Customers & Loyalty</h1>
            <p className="p-subtitle">Manage your customer database and loyalty rewards program</p>
          </div>
        </div>
      </div>

      <div className="p-tabs">
        {TABS.map(t => (
          <button key={t.key} className={`p-tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab === 'customers' && <Customers embedded />}
      {tab === 'loyalty'   && <LoyaltyProgram embedded />}
    </div>
  );
}
