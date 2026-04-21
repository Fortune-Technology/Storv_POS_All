import React from 'react';
import AdminSidebar from './AdminSidebar';
import AIAssistantWidget from './AIAssistantWidget';

const AdminLayout = ({ children }) => (
  <div className="layout-container">
    <AdminSidebar />
    <main className="main-content admin-page">
      {children}
    </main>
    <AIAssistantWidget />
  </div>
);

export default AdminLayout;
