import React from 'react';
import Sidebar from './Sidebar';
import BillingBanner from './BillingBanner';

const Layout = ({ children }) => {
  return (
    <div className="layout-container">
      <Sidebar />
      <main className="main-content">
        <BillingBanner />
        {children}
      </main>
    </div>
  );
};

export default Layout;
