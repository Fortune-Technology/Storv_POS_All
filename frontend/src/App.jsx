import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

// Marketing Pages
import Home from './pages/marketing/Home';
import Features from './pages/marketing/Features';
import Pricing from './pages/marketing/Pricing';
import Contact from './pages/marketing/Contact';
import About from './pages/marketing/About';

// Auth / Onboarding Pages
import Login from './pages/Login';
import Signup from './pages/Signup';
import ForgotPassword from './pages/ForgotPassword';
import PhoneLookup from './pages/PhoneLookup';
import Onboarding from './pages/Onboarding';

// Portal Pages
import Dashboard from './pages/Dashboard';
import Customers from './pages/Customers';
import InvoiceImport from './pages/InvoiceImport';
import InventoryCount from './pages/InventoryCount';
import PriceUpdate from './pages/PriceUpdate';
import FeesMappings from './pages/FeesMappings';
import POSAPI from './pages/POSAPI';
import SalesAnalytics from './pages/SalesAnalytics';
import DepartmentAnalytics from './pages/DepartmentAnalytics';
import ProductAnalytics from './pages/ProductAnalytics';
import SalesPredictions from './pages/SalesPredictions';
import VendorOrderSheet from './pages/VendorOrderSheet';
import RealTimeDashboard from './pages/RealTimeDashboard';

// Account / Org Pages
import Organisation from './pages/Organisation';
import UserManagement from './pages/UserManagement';
import StoreManagement from './pages/StoreManagement';
import StoreBranding from './pages/StoreBranding';

// POS Pages
import POSSettings from './pages/POSSettings.jsx';
import ReceiptSettings from './pages/ReceiptSettings.jsx';
import EmployeeReports from './pages/EmployeeReports';

// Catalog Pages
import ProductCatalog from './pages/ProductCatalog';
import ProductForm    from './pages/ProductForm';
import Departments    from './pages/Departments';
import Vendors        from './pages/Vendors';
import VendorDetail   from './pages/VendorDetail';
import Promotions        from './pages/Promotions';
import BulkImport from './pages/BulkImport';
import EcommIntegration  from './pages/EcommIntegration';
import Lottery from './pages/Lottery';

// Admin Pages
import AdminDashboard        from './pages/admin/AdminDashboard';
import AdminUsers            from './pages/admin/AdminUsers';
import AdminOrganizations    from './pages/admin/AdminOrganizations';
import AdminCmsPages         from './pages/admin/AdminCmsPages';
import AdminCareers          from './pages/admin/AdminCareers';
import AdminTickets          from './pages/admin/AdminTickets';
import AdminSystemConfig     from './pages/admin/AdminSystemConfig';
import AdminAnalytics        from './pages/admin/AdminAnalytics';
import AdminOrgAnalytics     from './pages/admin/AdminOrgAnalytics';
import AdminStorePerformance from './pages/admin/AdminStorePerformance';
import AdminUserActivity     from './pages/admin/AdminUserActivity';
import AdminCareerApplications from './pages/admin/AdminCareerApplications';

// Public Marketing Pages (dynamic)
import CmsPage  from './pages/marketing/CmsPage';
import Careers      from './pages/marketing/Careers';
import CareerDetail from './pages/marketing/CareerDetail';
import Support      from './pages/marketing/Support';

// Legacy Pages
import UploadPage from './pages/UploadPage';
import PreviewPage from './pages/PreviewPage';
import TransformPage from './pages/TransformPage';
import DepositMapPage from './pages/DepositMapPage';
import HistoryPage from './pages/HistoryPage';
import OCRPage from './pages/OCRPage';
import Transactions from './pages/Transactions';

// Components
import Layout from './components/Layout';
import ScrollToTop from './components/ScrollToTop';
import { StoreProvider } from './contexts/StoreContext';

// Placeholder pages
const Placeholder = ({ name }) => (
  <div className="layout-container">
    <div className="sidebar" style={{ width: '260px' }}></div>
    <div className="main-content"><h1>{name} Page</h1><p>This module is coming soon.</p></div>
  </div>
);

// Standard protected route — requires auth token
const ProtectedRoute = ({ children }) => {
  const user = JSON.parse(localStorage.getItem('user'));
  if (!user || !user.token) return <Navigate to="/login" replace />;
  return children;
};

// Admin route — requires auth + superadmin role
const AdminRoute = ({ children }) => {
  const user = JSON.parse(localStorage.getItem('user'));
  if (!user || !user.token) return <Navigate to="/login" replace />;
  if (user.role !== 'superadmin') return <Navigate to="/portal/pos-api" replace />;
  return children;
};

function App() {
  return (
    <Router>
      <ScrollToTop />
      <StoreProvider>
      <ToastContainer theme="dark" position="top-right" />
      <Routes>
        {/* ── Marketing (Public) ────────────────────────────────────────── */}
        <Route path="/"         element={<Home />} />
        <Route path="/features" element={<Features />} />
        <Route path="/pricing"  element={<Pricing />} />
        <Route path="/contact"  element={<Contact />} />
        <Route path="/about"    element={<About />} />
        <Route path="/careers"      element={<Careers />} />
        <Route path="/careers/:id"  element={<CareerDetail />} />
        <Route path="/support"      element={<Support />} />
        <Route path="/privacy"  element={<CmsPage />} />
        <Route path="/terms"    element={<CmsPage />} />
        <Route path="/cookies"  element={<CmsPage />} />
        <Route path="/page/:slug" element={<CmsPage />} />

        {/* ── Public Auth ─────────────────────────────────────────────── */}
        <Route path="/login"          element={<Login />} />
        <Route path="/signup"         element={<Signup />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/phone-lookup"   element={<PhoneLookup />} />

        {/* ── Onboarding (auth required, no sidebar) ─────────────────── */}
        <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />

        {/* ── Default redirect for legacy / dashboard ─────────────────── */}
        <Route path="/dashboard" element={<Navigate to="/portal/realtime" replace />} />

        {/* ── Operations ──────────────────────────────────────────────── */}
        <Route path="/portal/customers"     element={<ProtectedRoute><Customers /></ProtectedRoute>} />
        <Route path="/portal/invoice-import" element={<ProtectedRoute><InvoiceImport /></ProtectedRoute>} />
        <Route path="/portal/inventory-count" element={<ProtectedRoute><InventoryCount /></ProtectedRoute>} />
        <Route path="/portal/price-update"  element={<ProtectedRoute><PriceUpdate /></ProtectedRoute>} />
        <Route path="/portal/fees-mappings" element={<ProtectedRoute><FeesMappings /></ProtectedRoute>} />
        <Route path="/portal/pos-api"       element={<ProtectedRoute><POSAPI /></ProtectedRoute>} />
        <Route path="/portal/realtime"      element={<ProtectedRoute><RealTimeDashboard /></ProtectedRoute>} />

        {/* ── Analytics ───────────────────────────────────────────────── */}
        <Route path="/portal/sales"                   element={<ProtectedRoute><SalesAnalytics /></ProtectedRoute>} />
        <Route path="/portal/departments-analytics"   element={<ProtectedRoute><DepartmentAnalytics /></ProtectedRoute>} />
        <Route path="/portal/products-analytics"      element={<ProtectedRoute><ProductAnalytics /></ProtectedRoute>} />
        <Route path="/portal/predictions"        element={<ProtectedRoute><SalesPredictions /></ProtectedRoute>} />
        <Route path="/portal/vendor-orders"      element={<ProtectedRoute><VendorOrderSheet /></ProtectedRoute>} />

        {/* ── Account / Organisation ──────────────────────────────────── */}
        <Route path="/portal/organisation" element={<ProtectedRoute><Organisation /></ProtectedRoute>} />
        <Route path="/portal/users"        element={<ProtectedRoute><UserManagement /></ProtectedRoute>} />
        <Route path="/portal/stores"       element={<ProtectedRoute><StoreManagement /></ProtectedRoute>} />
        <Route path="/portal/branding"     element={<ProtectedRoute><StoreBranding /></ProtectedRoute>} />
        <Route path="/portal/pos-settings"      element={<ProtectedRoute><POSSettings /></ProtectedRoute>} />
        <Route path="/portal/receipt-settings"  element={<ProtectedRoute><ReceiptSettings /></ProtectedRoute>} />
        <Route path="/portal/employee-reports"  element={<ProtectedRoute><EmployeeReports /></ProtectedRoute>} />
        <Route path="/portal/transactions"      element={<ProtectedRoute><Transactions /></ProtectedRoute>} />

        {/* ── Legacy CSV Transformer ──────────────────────────────────── */}
        <Route path="/csv/upload"            element={<ProtectedRoute><Layout><UploadPage /></Layout></ProtectedRoute>} />
        <Route path="/preview/:uploadId"     element={<ProtectedRoute><Layout><PreviewPage /></Layout></ProtectedRoute>} />
        <Route path="/transform/:transformId" element={<ProtectedRoute><Layout><TransformPage /></Layout></ProtectedRoute>} />
        <Route path="/csv/deposit-map"       element={<ProtectedRoute><Layout><DepositMapPage /></Layout></ProtectedRoute>} />
        <Route path="/csv/history"           element={<ProtectedRoute><Layout><HistoryPage /></Layout></ProtectedRoute>} />

        {/* ── Legacy OCR ──────────────────────────────────────────────── */}
        <Route path="/ocr/tool" element={<ProtectedRoute><Layout><OCRPage /></Layout></ProtectedRoute>} />

        {/* ── Catalog ─────────────────────────────────────────────────── */}
        <Route path="/portal/catalog"          element={<ProtectedRoute><ProductCatalog /></ProtectedRoute>} />
        <Route path="/portal/catalog/new"      element={<ProtectedRoute><ProductForm /></ProtectedRoute>} />
        <Route path="/portal/catalog/edit/:id" element={<ProtectedRoute><ProductForm /></ProtectedRoute>} />
        <Route path="/portal/departments"      element={<ProtectedRoute><Departments /></ProtectedRoute>} />
        <Route path="/portal/vendors"          element={<ProtectedRoute><Vendors /></ProtectedRoute>} />
        <Route path="/portal/vendors/:id"      element={<ProtectedRoute><VendorDetail /></ProtectedRoute>} />
        <Route path="/portal/promotions"       element={<ProtectedRoute><Promotions /></ProtectedRoute>} />
        <Route path="/portal/import" element={<ProtectedRoute><BulkImport /></ProtectedRoute>} />

        {/* ── Lottery ─────────────────────────────────────────────────── */}
        <Route path="/portal/lottery" element={<ProtectedRoute><Lottery /></ProtectedRoute>} />

        {/* ── Placeholders ────────────────────────────────────────────── */}
        <Route path="/portal/ecomm"    element={<ProtectedRoute><EcommIntegration /></ProtectedRoute>} />
        <Route path="/portal/products" element={<ProtectedRoute><Placeholder name="Products" /></ProtectedRoute>} />

        {/* ── Admin Panel (superadmin only) ──────────────────────────── */}
        <Route path="/admin"                          element={<AdminRoute><AdminDashboard /></AdminRoute>} />
        <Route path="/admin/analytics"                element={<AdminRoute><AdminAnalytics /></AdminRoute>} />
        <Route path="/admin/analytics/organizations"  element={<AdminRoute><AdminOrgAnalytics /></AdminRoute>} />
        <Route path="/admin/analytics/stores"         element={<AdminRoute><AdminStorePerformance /></AdminRoute>} />
        <Route path="/admin/analytics/users"          element={<AdminRoute><AdminUserActivity /></AdminRoute>} />
        <Route path="/admin/users"                    element={<AdminRoute><AdminUsers /></AdminRoute>} />
        <Route path="/admin/organizations"            element={<AdminRoute><AdminOrganizations /></AdminRoute>} />
        <Route path="/admin/cms"                      element={<AdminRoute><AdminCmsPages /></AdminRoute>} />
        <Route path="/admin/careers"                  element={<AdminRoute><AdminCareers /></AdminRoute>} />
        <Route path="/admin/careers/:careerPostingId/applications" element={<AdminRoute><AdminCareerApplications /></AdminRoute>} />
        <Route path="/admin/tickets"                  element={<AdminRoute><AdminTickets /></AdminRoute>} />
        <Route path="/admin/config"                   element={<AdminRoute><AdminSystemConfig /></AdminRoute>} />

        {/* ── Fallback ────────────────────────────────────────────────── */}
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
      </StoreProvider>
    </Router>
  );
}

export default App;
