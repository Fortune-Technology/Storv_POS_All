import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useSearchParams, useNavigate } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import EcomOrderNotifier from './components/EcomOrderNotifier';

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
import POSSettings     from './pages/POSSettings.jsx';
import ReceiptSettings from './pages/ReceiptSettings.jsx';
import EmployeeReports from './pages/EmployeeReports';
import PayoutsReport   from './pages/PayoutsReport.jsx';
import VendorPayouts  from './pages/VendorPayouts.jsx';
import StoreSettings  from './pages/StoreSettings';
import QuickAccess    from './pages/QuickAccess.jsx';
import DepositRules    from './pages/DepositRules.jsx';
import TaxRules        from './pages/TaxRules.jsx';
import PaymentSettings from './pages/PaymentSettings.jsx';

// Catalog Pages
import ProductCatalog from './pages/ProductCatalog';
import ProductForm    from './pages/ProductForm';
import Departments    from './pages/Departments';
import Vendors        from './pages/Vendors';
import VendorDetail   from './pages/VendorDetail';
import Promotions        from './pages/Promotions';
import BulkImport from './pages/BulkImport';
import EcommIntegration  from './pages/EcommIntegration';
import EcomSetup         from './pages/EcomSetup';
// EcomPages functionality moved into EcomSetup > Pages tab
import EcomOrders        from './pages/EcomOrders';
import EcomDomain        from './pages/EcomDomain';
import EcomAnalytics     from './pages/EcomAnalytics';
import EcomCustomers     from './pages/EcomCustomers';
import Lottery from './pages/Lottery';
import LoyaltyProgram from './pages/LoyaltyProgram';
import SupportTickets from './pages/SupportTickets';


// Billing Portal
import BillingPortal from './pages/BillingPortal';

// Equipment Shop (public)
import ShopPage     from './pages/marketing/ShopPage';
import ProductPage  from './pages/marketing/ProductPage';
import CartPage     from './pages/marketing/CartPage';
import ShopCheckout from './pages/marketing/ShopCheckout';

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
import PosEventLog  from './pages/PosEventLog';

// Tab hub pages
import POSConfig     from './pages/POSConfig';
import POSReports    from './pages/POSReports';
import RulesAndFees  from './pages/RulesAndFees';
import AnalyticsHub  from './pages/AnalyticsHub';
import AccountHub    from './pages/AccountHub';
import CustomersHub  from './pages/CustomersHub';

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

// Admin impersonation landing — reads token from URL and sets up the session
const ImpersonateLanding = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  React.useEffect(() => {
    const token = searchParams.get('token');
    const userData = searchParams.get('user');
    if (token && userData) {
      try {
        const user = JSON.parse(decodeURIComponent(userData));
        user.token = token;
        localStorage.setItem('user', JSON.stringify(user));
        navigate('/portal/pos-api', { replace: true });
      } catch { navigate('/login', { replace: true }); }
    } else {
      navigate('/login', { replace: true });
    }
  }, [searchParams, navigate]);
  return <div style={{ display:'flex', alignItems:'center', justifyContent:'center', minHeight:'100vh' }}>Loading...</div>;
};


function App() {
  return (
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ScrollToTop />
      <StoreProvider>
      <ToastContainer theme="dark" position="top-right" />
      <EcomOrderNotifier />
      <Routes>
        {/* ── Equipment Shop (Public) ─────────────────────────────────── */}
        <Route path="/shop"          element={<ShopPage />} />
        <Route path="/shop/cart"     element={<CartPage />} />
        <Route path="/shop/checkout" element={<ShopCheckout />} />
        <Route path="/shop/:slug"    element={<ProductPage />} />

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

        {/* ── Admin Impersonation Landing ────────────────────────────── */}
        <Route path="/impersonate" element={<ImpersonateLanding />} />

        {/* ── Onboarding (auth required, no sidebar) ─────────────────── */}
        <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />

        {/* ── Default redirect for legacy / dashboard ─────────────────── */}
        <Route path="/dashboard" element={<Navigate to="/portal/realtime" replace />} />

        {/* ── Customers & Loyalty Hub (tabbed) ────────────────────────── */}
        <Route path="/portal/customers-hub"  element={<ProtectedRoute><CustomersHub /></ProtectedRoute>} />
        {/* Backwards-compat redirects */}
        <Route path="/portal/customers"      element={<Navigate to="/portal/customers-hub?tab=customers" replace />} />
        <Route path="/portal/loyalty"        element={<Navigate to="/portal/customers-hub?tab=loyalty" replace />} />

        {/* ── Operations ──────────────────────────────────────────────── */}
        <Route path="/portal/invoice-import" element={<ProtectedRoute><InvoiceImport /></ProtectedRoute>} />
        <Route path="/portal/inventory-count" element={<ProtectedRoute><InventoryCount /></ProtectedRoute>} />
        <Route path="/portal/price-update"  element={<ProtectedRoute><PriceUpdate /></ProtectedRoute>} />
        <Route path="/portal/fees-mappings" element={<ProtectedRoute><FeesMappings /></ProtectedRoute>} />
        <Route path="/portal/pos-api"       element={<ProtectedRoute><POSAPI /></ProtectedRoute>} />
        <Route path="/portal/realtime"      element={<ProtectedRoute><RealTimeDashboard /></ProtectedRoute>} />

        {/* ── Analytics Hub (tabbed) ───────────────────────────────── */}
        <Route path="/portal/analytics"              element={<ProtectedRoute><AnalyticsHub /></ProtectedRoute>} />
        {/* Backwards-compat redirects for old analytics routes */}
        <Route path="/portal/sales"                  element={<Navigate to="/portal/analytics?tab=sales" replace />} />
        <Route path="/portal/departments-analytics"  element={<Navigate to="/portal/analytics?tab=departments" replace />} />
        <Route path="/portal/products-analytics"     element={<Navigate to="/portal/analytics?tab=products" replace />} />
        <Route path="/portal/predictions"            element={<Navigate to="/portal/analytics?tab=predictions" replace />} />

        <Route path="/portal/vendor-orders"      element={<ProtectedRoute><VendorOrderSheet /></ProtectedRoute>} />

        {/* ── Account Hub (tabbed) ────────────────────────────────────── */}
        <Route path="/portal/account"        element={<ProtectedRoute><AccountHub /></ProtectedRoute>} />
        {/* Backwards-compat redirects for old account routes */}
        <Route path="/portal/organisation"   element={<Navigate to="/portal/account?tab=organisation" replace />} />
        <Route path="/portal/users"          element={<Navigate to="/portal/account?tab=users" replace />} />
        <Route path="/portal/stores"         element={<Navigate to="/portal/account?tab=stores" replace />} />
        <Route path="/portal/store-settings" element={<Navigate to="/portal/account?tab=settings" replace />} />
        <Route path="/portal/branding"       element={<ProtectedRoute><StoreBranding /></ProtectedRoute>} />

        {/* ── POS Configuration Hub (tabbed) ──────────────────────────── */}
        <Route path="/portal/pos-config"         element={<ProtectedRoute><POSConfig /></ProtectedRoute>} />
        {/* Backwards-compat redirects */}
        <Route path="/portal/pos-settings"       element={<Navigate to="/portal/pos-config?tab=layout" replace />} />
        <Route path="/portal/receipt-settings"   element={<Navigate to="/portal/pos-config?tab=receipts" replace />} />

        {/* ── POS Reports Hub (tabbed) ────────────────────────────────── */}
        <Route path="/portal/pos-reports"        element={<ProtectedRoute><POSReports /></ProtectedRoute>} />
        {/* Backwards-compat redirects */}
        <Route path="/portal/transactions"       element={<Navigate to="/portal/pos-reports?tab=transactions" replace />} />
        <Route path="/portal/pos-event-log"      element={<Navigate to="/portal/pos-reports?tab=events" replace />} />
        <Route path="/portal/employee-reports"   element={<Navigate to="/portal/pos-reports?tab=employee" replace />} />
        <Route path="/portal/payouts"            element={<Navigate to="/portal/pos-reports?tab=payouts" replace />} />

        {/* ── Rules & Fees Hub (tabbed) ───────────────────────────────── */}
        <Route path="/portal/rules"              element={<ProtectedRoute><RulesAndFees /></ProtectedRoute>} />
        {/* Backwards-compat redirects */}
        <Route path="/portal/deposit-rules"      element={<Navigate to="/portal/rules?tab=deposits" replace />} />
        <Route path="/portal/tax-rules"          element={<Navigate to="/portal/rules?tab=tax" replace />} />

        {/* ── Remaining POS items ─────────────────────────────────────── */}
        <Route path="/portal/vendor-payouts"     element={<ProtectedRoute><VendorPayouts /></ProtectedRoute>} />
        {/* Backwards-compat redirect for Quick Access (now a tab in POS Config) */}
        <Route path="/portal/quick-access"       element={<Navigate to="/portal/pos-config?tab=quick-keys" replace />} />

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

        {/* ── Billing ─────────────────────────────────────────────────── */}
        <Route path="/portal/billing" element={<ProtectedRoute><BillingPortal /></ProtectedRoute>} />

        {/* ── Lottery ─────────────────────────────────────────────────── */}
        <Route path="/portal/lottery"          element={<ProtectedRoute><Lottery /></ProtectedRoute>} />
        <Route path="/portal/support-tickets"  element={<ProtectedRoute><SupportTickets /></ProtectedRoute>} />

        {/* ── Online Store (E-commerce) ────────────────────────────── */}
        <Route path="/portal/ecom/setup"      element={<ProtectedRoute><EcomSetup /></ProtectedRoute>} />
        <Route path="/portal/ecom/orders"     element={<ProtectedRoute><EcomOrders /></ProtectedRoute>} />
        <Route path="/portal/ecom/analytics"  element={<ProtectedRoute><EcomAnalytics /></ProtectedRoute>} />
        {/* Backwards-compat: Custom Domain is now a tab in Store Setup */}
        <Route path="/portal/ecom/domain"     element={<Navigate to="/portal/ecom/setup?tab=domain" replace />} />
        {/* Removed: ecom/customers — use shared Customers & Loyalty hub */}
        <Route path="/portal/ecom/customers"  element={<Navigate to="/portal/customers-hub?tab=customers" replace />} />

        {/* ── Placeholders ────────────────────────────────────────────── */}
        <Route path="/portal/ecomm"    element={<ProtectedRoute><EcommIntegration /></ProtectedRoute>} />
        <Route path="/portal/products" element={<ProtectedRoute><Placeholder name="Products" /></ProtectedRoute>} />

        {/* ── Fallback ────────────────────────────────────────────────── */}
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
      </StoreProvider>
    </Router>
  );
}

export default App;
