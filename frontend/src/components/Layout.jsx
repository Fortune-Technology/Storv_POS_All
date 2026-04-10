import React from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import BillingBanner from './BillingBanner';

const Layout = ({ children }) => {
  return (
    <div className="layout-container">
      <Sidebar />
      <main className="main-content">
        <BillingBanner />
        {children || <Outlet />}
      </main>
    </div>
  );
};

export default Layout;
