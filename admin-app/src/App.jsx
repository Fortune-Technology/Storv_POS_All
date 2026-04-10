import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

// Pages
import Login from './pages/Login';
import AdminDashboard from './pages/AdminDashboard';
import AdminUsers from './pages/AdminUsers';
import AdminOrganizations from './pages/AdminOrganizations';
import AdminCmsPages from './pages/AdminCmsPages';
import AdminCareers from './pages/AdminCareers';
import AdminCareerApplications from './pages/AdminCareerApplications';
import AdminTickets from './pages/AdminTickets';
import AdminSystemConfig from './pages/AdminSystemConfig';
import AdminAnalytics from './pages/AdminAnalytics';
import AdminOrgAnalytics from './pages/AdminOrgAnalytics';
import AdminStorePerformance from './pages/AdminStorePerformance';
import AdminUserActivity from './pages/AdminUserActivity';
import AdminStores from './pages/AdminStores';
import AdminPaymentSettings from './pages/AdminPaymentSettings';
import AdminBilling         from './pages/AdminBilling';

const ProtectedRoute = ({ children }) => {
  const user = JSON.parse(localStorage.getItem('admin_user'));
  if (!user || !user.token || user.role !== 'superadmin') {
    return <Navigate to="/login" replace />;
  }
  return children;
};

function App() {
  return (
    <>
      <ToastContainer theme="dark" position="top-right" />
      <Routes>
        {/* Public */}
        <Route path="/login" element={<Login />} />

        {/* Protected admin routes */}
        <Route path="/dashboard" element={<ProtectedRoute><AdminDashboard /></ProtectedRoute>} />
        <Route path="/analytics" element={<ProtectedRoute><AdminAnalytics /></ProtectedRoute>} />
        <Route path="/analytics/organizations" element={<ProtectedRoute><AdminOrgAnalytics /></ProtectedRoute>} />
        <Route path="/analytics/stores" element={<ProtectedRoute><AdminStorePerformance /></ProtectedRoute>} />
        <Route path="/analytics/users" element={<ProtectedRoute><AdminUserActivity /></ProtectedRoute>} />
        <Route path="/users" element={<ProtectedRoute><AdminUsers /></ProtectedRoute>} />
        <Route path="/organizations" element={<ProtectedRoute><AdminOrganizations /></ProtectedRoute>} />
        <Route path="/stores" element={<ProtectedRoute><AdminStores /></ProtectedRoute>} />
        <Route path="/cms" element={<ProtectedRoute><AdminCmsPages /></ProtectedRoute>} />
        <Route path="/careers" element={<ProtectedRoute><AdminCareers /></ProtectedRoute>} />
        <Route path="/careers/:careerPostingId/applications" element={<ProtectedRoute><AdminCareerApplications /></ProtectedRoute>} />
        <Route path="/tickets" element={<ProtectedRoute><AdminTickets /></ProtectedRoute>} />
        <Route path="/config" element={<ProtectedRoute><AdminSystemConfig /></ProtectedRoute>} />
        <Route path="/payment" element={<ProtectedRoute><AdminPaymentSettings /></ProtectedRoute>} />
        <Route path="/billing" element={<ProtectedRoute><AdminBilling /></ProtectedRoute>} />

        {/* Redirects */}
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </>
  );
}

export default App;
