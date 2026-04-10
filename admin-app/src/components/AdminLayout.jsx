import React from 'react';
import AdminSidebar from './AdminSidebar';

const AdminLayout = ({ children }) => (
  <div className="layout-container">
    <AdminSidebar />
    <main className="main-content admin-page">
      {children}
    </main>
  </div>
);

export default AdminLayout;
