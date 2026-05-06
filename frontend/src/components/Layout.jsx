import React from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import PortalNavbar from './PortalNavbar';
import BillingBanner from './BillingBanner';
import AIAssistantWidget from './AIAssistantWidget';
import TourRunner from './TourRunner';
import OnboardingTour from './OnboardingTour';
import Gate from './Gate';

const Layout = ({ children }) => {
  return (
    <div className="layout-container">
      <Sidebar />
      <div className="layout-main-pane">
        <PortalNavbar />
        <main className="main-content">
          <BillingBanner />
          {children || <Outlet />}
        </main>
      </div>
      {/* S80 — AI Assistant gated by `ai_assistant` module subscription */}
      <Gate module="ai_assistant"><AIAssistantWidget /></Gate>
      <TourRunner />
      <OnboardingTour />
    </div>
  );
};

export default Layout;
