import { ReactNode } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

// Layout
import AdminLayout from './components/AdminLayout';

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
import AdminMerchants       from './pages/AdminMerchants';
import AdminBilling         from './pages/AdminBilling';
import AdminChat            from './pages/AdminChat';
import AdminRoles           from './pages/AdminRoles';
import AdminPriceCalculator from './pages/AdminPriceCalculator';
import AdminStates          from './pages/AdminStates';
import AdminVendorTemplates from './pages/AdminVendorTemplates';
import AdminAiReviews       from './pages/AdminAiReviews';
import AdminAiKb            from './pages/AdminAiKb';
import AdminAiTours         from './pages/AdminAiTours';
import AdminLottery         from './pages/AdminLottery';
import AdminPaymentModels   from './pages/AdminPaymentModels';
import AdminPricingTiers    from './pages/AdminPricingTiers';

import PermissionRoute from './components/PermissionRoute';

interface ProtectedRouteProps {
  children: ReactNode;
}

const ProtectedRoute = ({ children }: ProtectedRouteProps) => {
  // Route-level permission checks happen in <PermissionRoute>. This wrapper
  // just ensures an admin session exists; non-superadmins are redirected.
  return <PermissionRoute>{children}</PermissionRoute>;
};

function App() {
  return (
    <>
      <ToastContainer theme="dark" position="top-right" />
      <Routes>
        {/* Public */}
        <Route path="/login" element={<Login />} />

        {/* Protected admin routes */}
        <Route path="/dashboard" element={<ProtectedRoute><AdminLayout><AdminDashboard /></AdminLayout></ProtectedRoute>} />
        <Route path="/analytics" element={<ProtectedRoute><AdminLayout><AdminAnalytics /></AdminLayout></ProtectedRoute>} />
        <Route path="/analytics/organizations" element={<ProtectedRoute><AdminLayout><AdminOrgAnalytics /></AdminLayout></ProtectedRoute>} />
        <Route path="/analytics/stores" element={<ProtectedRoute><AdminLayout><AdminStorePerformance /></AdminLayout></ProtectedRoute>} />
        <Route path="/analytics/users" element={<ProtectedRoute><AdminLayout><AdminUserActivity /></AdminLayout></ProtectedRoute>} />
        <Route path="/users" element={<ProtectedRoute><AdminLayout><AdminUsers /></AdminLayout></ProtectedRoute>} />
        <Route path="/organizations" element={<ProtectedRoute><AdminLayout><AdminOrganizations /></AdminLayout></ProtectedRoute>} />
        <Route path="/stores" element={<ProtectedRoute><AdminLayout><AdminStores /></AdminLayout></ProtectedRoute>} />
        <Route path="/cms" element={<ProtectedRoute><AdminLayout><AdminCmsPages /></AdminLayout></ProtectedRoute>} />
        <Route path="/careers" element={<ProtectedRoute><AdminLayout><AdminCareers /></AdminLayout></ProtectedRoute>} />
        <Route path="/careers/:careerPostingId/applications" element={<ProtectedRoute><AdminLayout><AdminCareerApplications /></AdminLayout></ProtectedRoute>} />
        <Route path="/tickets" element={<ProtectedRoute><AdminLayout><AdminTickets /></AdminLayout></ProtectedRoute>} />
        <Route path="/config" element={<ProtectedRoute><AdminLayout><AdminSystemConfig /></AdminLayout></ProtectedRoute>} />
        <Route path="/merchants" element={<ProtectedRoute><AdminLayout><AdminMerchants /></AdminLayout></ProtectedRoute>} />
        <Route path="/billing" element={<ProtectedRoute><AdminLayout><AdminBilling /></AdminLayout></ProtectedRoute>} />
        <Route path="/chat" element={<ProtectedRoute><AdminLayout><AdminChat /></AdminLayout></ProtectedRoute>} />
        <Route path="/roles" element={<ProtectedRoute><AdminLayout><AdminRoles /></AdminLayout></ProtectedRoute>} />
        <Route path="/price-calculator" element={<ProtectedRoute><AdminLayout><AdminPriceCalculator /></AdminLayout></ProtectedRoute>} />
        <Route path="/states" element={<ProtectedRoute><AdminLayout><AdminStates /></AdminLayout></ProtectedRoute>} />
        <Route path="/vendor-templates" element={<ProtectedRoute><AdminLayout><AdminVendorTemplates /></AdminLayout></ProtectedRoute>} />
        <Route path="/ai-reviews" element={<ProtectedRoute><AdminLayout><AdminAiReviews /></AdminLayout></ProtectedRoute>} />
        <Route path="/ai-kb"      element={<ProtectedRoute><AdminLayout><AdminAiKb /></AdminLayout></ProtectedRoute>} />
        <Route path="/ai-tours"   element={<ProtectedRoute><AdminLayout><AdminAiTours /></AdminLayout></ProtectedRoute>} />
        <Route path="/lottery"    element={<ProtectedRoute><AdminLayout><AdminLottery /></AdminLayout></ProtectedRoute>} />
        <Route path="/payment-models" element={<ProtectedRoute><AdminLayout><AdminPaymentModels /></AdminLayout></ProtectedRoute>} />
        <Route path="/pricing-tiers"  element={<ProtectedRoute><AdminLayout><AdminPricingTiers /></AdminLayout></ProtectedRoute>} />

        {/* Redirects */}
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </>
  );
}

export default App;
