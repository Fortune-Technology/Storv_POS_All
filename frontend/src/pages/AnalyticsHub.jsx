/**
 * AnalyticsHub — Tabbed hub for all analytics pages
 * Tabs: Sales, Departments, Products, Predictions
 */
import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BarChart2, PieChart, ShoppingCart, TrendingUp } from 'lucide-react';
import SalesAnalytics from './SalesAnalytics';
import DepartmentAnalytics from './DepartmentAnalytics';
import ProductAnalytics from './ProductAnalytics';
import SalesPredictions from './SalesPredictions';
import '../styles/portal.css';

const TABS = [
  { key: 'sales',       label: 'Sales',       icon: <BarChart2 size={14} /> },
  { key: 'departments', label: 'Departments', icon: <PieChart size={14} /> },
  { key: 'products',    label: 'Products',    icon: <ShoppingCart size={14} /> },
  { key: 'predictions', label: 'Predictions', icon: <TrendingUp size={14} /> },
];

export default function AnalyticsHub() {
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') || 'sales';
  const [tab, setTab] = useState(initialTab);

  return (
    <div className="p-page">
      <div className="p-header">
        <div className="p-header-left">
          <div className="p-header-icon"><BarChart2 size={22} /></div>
          <div>
            <h1 className="p-title">Analytics</h1>
            <p className="p-subtitle">Sales performance, department breakdown, product insights, and demand forecasting</p>
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

      {tab === 'sales'       && <SalesAnalytics embedded />}
      {tab === 'departments' && <DepartmentAnalytics embedded />}
      {tab === 'products'    && <ProductAnalytics embedded />}
      {tab === 'predictions' && <SalesPredictions embedded />}
    </div>
  );
}
