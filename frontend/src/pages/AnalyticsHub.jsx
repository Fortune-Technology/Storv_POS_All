/**
 * AnalyticsHub — Tabbed hub for all analytics pages
 * Tabs: Sales, Departments, Products, Predictions, Compare
 *
 * Compare tab (Session 64) — extracted from the legacy ReportsHub Compare tab.
 * Mounts <PeriodCompare embedded /> for side-by-side metric comparison
 * across two arbitrary date ranges.
 */
import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BarChart2, PieChart, ShoppingCart, TrendingUp, GitCompare } from 'lucide-react';
import SalesAnalytics from './SalesAnalytics';
import DepartmentAnalytics from './DepartmentAnalytics';
import ProductAnalytics from './ProductAnalytics';
import SalesPredictions from './SalesPredictions';
import PeriodCompare from './reports/PeriodCompare';
import usePlanModules from '../hooks/usePlanModules';
import '../styles/portal.css';

// S80 — `module` field gates the tab by subscription. null = always shown.
const TABS = [
  { key: 'sales',       label: 'Sales',       icon: <BarChart2 size={14} />,    module: null },
  { key: 'departments', label: 'Departments', icon: <PieChart size={14} />,     module: null },
  { key: 'products',    label: 'Products',    icon: <ShoppingCart size={14} />, module: null },
  { key: 'predictions', label: 'Predictions', icon: <TrendingUp size={14} />,   module: 'predictions' },
  { key: 'compare',     label: 'Compare',     icon: <GitCompare size={14} />,   module: null },
];

export default function AnalyticsHub() {
  const [searchParams] = useSearchParams();
  const { has } = usePlanModules();
  const visibleTabs = TABS.filter(t => !t.module || has(t.module));
  const initialTab = searchParams.get('tab') || visibleTabs[0]?.key || 'sales';
  const [tab, setTab] = useState(initialTab);

  // If the URL points at a tab the user can't access, fall back to first visible.
  const activeTab = visibleTabs.find(t => t.key === tab) ? tab : (visibleTabs[0]?.key || 'sales');

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
        {visibleTabs.map(t => (
          <button key={t.key} className={`p-tab ${activeTab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'sales'       && <SalesAnalytics embedded />}
      {activeTab === 'departments' && <DepartmentAnalytics embedded />}
      {activeTab === 'products'    && <ProductAnalytics embedded />}
      {activeTab === 'predictions' && has('predictions') && <SalesPredictions embedded />}
      {activeTab === 'compare'     && <PeriodCompare embedded />}
    </div>
  );
}
