import React from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import BillingBanner from './BillingBanner';
import AIAssistantWidget from './AIAssistantWidget';
import TourRunner from './TourRunner';

const Layout = ({ children }) => {
  return (
    <div className="layout-container">
      <Sidebar />
      <main className="main-content">
        <BillingBanner />
        {children || <Outlet />}
      </main>
      <AIAssistantWidget />
      <TourRunner />
    </div>
  );
};

export default Layout;
