import React from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import PortalNavbar from './PortalNavbar';
import BillingBanner from './BillingBanner';
import AIAssistantWidget from './AIAssistantWidget';
import TourRunner from './TourRunner';
import OnboardingTour from './OnboardingTour';

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
      <AIAssistantWidget />
      <TourRunner />
      <OnboardingTour />
    </div>
  );
};

export default Layout;
