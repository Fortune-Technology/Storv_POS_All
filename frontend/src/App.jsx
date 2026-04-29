import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useSearchParams, useNavigate } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import EcomOrderNotifier from './components/EcomOrderNotifier';
import ExchangeNotifier from './components/ExchangeNotifier';
import InactivityLock from './components/InactivityLock';
import { ConfirmDialogProvider } from './hooks/useConfirmDialog.jsx';

// Marketing Pages
import Home from './pages/marketing/Home';
import Features from './pages/marketing/Features';
import Pricing from './pages/marketing/Pricing';
import Contact from './pages/marketing/Contact';
import About from './pages/marketing/About';
import Download from './pages/marketing/Download';
import PaymentSimulator from './pages/marketing/PaymentSimulator';

// Auth / Onboarding Pages
import Login from './pages/Login';
import Signup from './pages/Signup';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import AcceptInvitation from './pages/AcceptInvitation';
import Invitations from './pages/Invitations';
import PhoneLookup from './pages/PhoneLookup';
import Onboarding from './pages/Onboarding';

// Portal Pages
import Dashboard from './pages/Dashboard';
import Customers from './pages/Customers';
import InvoiceImport from './pages/InvoiceImport';
import InventoryCount from './pages/InventoryCount';
import PriceUpdate from './pages/PriceUpdate';
import FeesMappings from './pages/FeesMappings';
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
import EmployeeManagement from './pages/EmployeeManagement';
import PayoutsReport   from './pages/PayoutsReport.jsx';
import VendorPayouts  from './pages/VendorPayouts.jsx';
import StoreSettings  from './pages/StoreSettings';
import QuickButtonBuilder from './pages/QuickButtonBuilder.jsx';
import DepositRules    from './pages/DepositRules.jsx';
import TaxRules        from './pages/TaxRules.jsx';
import PaymentSettings from './pages/PaymentSettings.jsx';

// Catalog Pages
import ProductCatalog from './pages/ProductCatalog';
import ProductForm    from './pages/ProductForm';
import ProductGroups  from './pages/ProductGroups';
import Departments    from './pages/Departments';
import Vendors        from './pages/Vendors';
import VendorDetail   from './pages/VendorDetail';
import Promotions        from './pages/Promotions';
import BulkImport from './pages/BulkImport';
import LabelQueue from './pages/LabelQueue';
import EcommIntegration  from './pages/EcommIntegration';
import IntegrationHub    from './pages/IntegrationHub';
import EcomSetup         from './pages/EcomSetup';
// EcomPages functionality moved into EcomSetup > Pages tab
import EcomOrders        from './pages/EcomOrders';
import EcomDomain        from './pages/EcomDomain';
import EcomAnalytics     from './pages/EcomAnalytics';
import EcomCustomers     from './pages/EcomCustomers';
import LotteryRouter from './pages/LotteryRouter';
import Fuel from './pages/Fuel';
import ScanData from './pages/ScanData';
import Exchange from './pages/Exchange';
import ExchangeOrderDetail from './pages/ExchangeOrderDetail';
import ReportsHub from './pages/ReportsHub';
import LoyaltyProgram from './pages/LoyaltyProgram';
import SupportTickets from './pages/SupportTickets';
import ChatPage from './pages/ChatPage';
import TasksPage from './pages/TasksPage';
import AuditLogPage from './pages/AuditLogPage';


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
import POSConfig         from './pages/POSConfig';
import POSReports        from './pages/POSReports';
import RulesAndFees      from './pages/RulesAndFees';
import AnalyticsHub      from './pages/AnalyticsHub';
import AccountHub        from './pages/AccountHub';
import MyProfile         from './pages/MyProfile';
import CustomersHub      from './pages/CustomersHub';
import EndOfDayReport    from './pages/EndOfDayReport';
import DualPricingReport from './pages/DualPricingReport';
import DailySale         from './pages/DailySale';
import Roles             from './pages/Roles';

// Components
import Layout from './components/Layout';
import ScrollToTop from './components/ScrollToTop';
import PermissionRoute from './components/PermissionRoute';
import Unauthorized from './pages/Unauthorized';
import { StoreProvider } from './contexts/StoreContext';

// Shorthand: wrap an element in PermissionRoute so it auto-looks-up the
// required permission via the current pathname (see rbac/routePermissions.js).
const gated = (el) => <PermissionRoute>{el}</PermissionRoute>;

// Placeholder pages
const Placeholder = ({ name }) => (
  <div className="p-page">
    <h1>{name} Page</h1><p>This module is coming soon.</p>
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
        // Wipe any leftover InactivityLock state from a previous browser
        // session BEFORE writing the new user. SSO is establishing a fresh
        // impersonated session; it must never inherit the previous user's
        // lock — that would demand the impersonated user's password despite
        // them having just landed via authenticated SSO.
        localStorage.removeItem('storv:il:locked');
        localStorage.removeItem('storv:il:lastActive');
        localStorage.removeItem('storv:il:lockedFor');
        localStorage.setItem('user', JSON.stringify(user));
        // Re-anchor the active store to one belonging to the impersonated
        // user. Otherwise the previously-cached `activeStoreId` (from the
        // admin's browser session) would still be sent as `X-Store-Id` and
        // resolve to a store outside the impersonated user's org — the
        // ecom-backend then 401s and the page bounces to /login. Pick the
        // user's first store; if they have none, clear the value so the
        // store-switcher prompts.
        const firstStoreId = Array.isArray(user.storeIds) ? user.storeIds[0] : null;
        if (firstStoreId) {
          localStorage.setItem('activeStoreId', firstStoreId);
        } else {
          localStorage.removeItem('activeStoreId');
        }
        navigate('/portal/realtime', { replace: true });
      } catch { navigate('/login', { replace: true }); }
    } else {
      navigate('/login', { replace: true });
    }
  }, [searchParams, navigate]);
  return <div className="app-impersonate-loading">Loading...</div>;
};


function App() {
  return (
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ScrollToTop />
      <StoreProvider>
      <ConfirmDialogProvider>
      <ToastContainer theme="dark" position="top-right" />
      <EcomOrderNotifier />
      <ExchangeNotifier />
      <InactivityLock />
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
        <Route path="/download" element={<Download />} />
        <Route path="/payment-simulator" element={<PaymentSimulator />} />
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
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/invite/:token"  element={<AcceptInvitation />} />
        <Route path="/phone-lookup"   element={<PhoneLookup />} />

        {/* ── Admin Impersonation Landing ────────────────────────────── */}
        <Route path="/impersonate" element={<ImpersonateLanding />} />

        {/* ── Onboarding (auth required, no sidebar) ─────────────────── */}
        <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />

        {/* ── Default redirect for legacy / dashboard ─────────────────── */}
        <Route path="/dashboard" element={<Navigate to="/portal/realtime" replace />} />

        {/* ── Portal routes with shared Layout (sidebar persists) ────── */}
        <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          {/* Unauthorized placeholder (used by PermissionRoute fallbacks) */}
          <Route path="/portal/unauthorized"   element={<Unauthorized />} />

          {/* ── Customers & Loyalty Hub (tabbed) ──────────────────────── */}
          <Route path="/portal/customers-hub"  element={gated(<CustomersHub />)} />

          {/* ── Operations ────────────────────────────────────────────── */}
          <Route path="/portal/invoice-import"  element={gated(<InvoiceImport />)} />
          <Route path="/portal/inventory-count" element={gated(<InventoryCount />)} />
          <Route path="/portal/price-update"    element={gated(<PriceUpdate />)} />
          <Route path="/portal/fees-mappings"   element={gated(<FeesMappings />)} />
          <Route path="/portal/realtime"        element={gated(<RealTimeDashboard />)} />
          <Route path="/portal/chat"            element={<ChatPage />} />
          <Route path="/portal/tasks"           element={gated(<TasksPage />)} />
          <Route path="/portal/audit"           element={gated(<AuditLogPage />)} />

          {/* ── Analytics Hub (tabbed) ─────────────────────────────── */}
          <Route path="/portal/analytics"       element={gated(<AnalyticsHub />)} />
          <Route path="/portal/vendor-orders"   element={gated(<VendorOrderSheet />)} />

          {/* ── Account Hub (tabbed) ──────────────────────────────────── */}
          <Route path="/portal/account"         element={gated(<AccountHub />)} />
          {/* My Profile — available to every authenticated user regardless
              of organization.view / users.view permissions. Staff/cashiers
              need this to update their own name/phone/password without
              needing admin access. */}
          <Route path="/portal/my-profile"      element={gated(<MyProfile />)} />
          <Route path="/portal/roles"           element={gated(<Roles />)} />
          <Route path="/portal/invitations"     element={gated(<Invitations />)} />
          <Route path="/portal/branding"        element={gated(<StoreBranding />)} />

          {/* ── POS Configuration Hub (tabbed) ────────────────────────── */}
          <Route path="/portal/pos-config"      element={gated(<POSConfig />)} />
          <Route path="/portal/quick-buttons"   element={gated(<QuickButtonBuilder />)} />

          {/* ── POS Reports Hub (tabbed) ──────────────────────────────── */}
          <Route path="/portal/pos-reports"     element={gated(<POSReports />)} />
          <Route path="/portal/end-of-day"      element={gated(<EndOfDayReport />)} />
          <Route path="/portal/dual-pricing-report" element={gated(<DualPricingReport />)} />
          <Route path="/portal/daily-sale"      element={gated(<DailySale />)} />

          {/* ── Rules & Fees Hub (tabbed) ─────────────────────────────── */}
          <Route path="/portal/rules"           element={gated(<RulesAndFees />)} />

          {/* ── Employees ────────────────────────────────────────────── */}
          <Route path="/portal/employees"       element={gated(<EmployeeManagement />)} />

          {/* ── Remaining POS items ───────────────────────────────────── */}
          <Route path="/portal/vendor-payouts"  element={gated(<VendorPayouts />)} />

          {/* ── Catalog ───────────────────────────────────────────────── */}
          <Route path="/portal/catalog"          element={gated(<ProductCatalog />)} />
          <Route path="/portal/catalog/new"      element={gated(<ProductForm />)} />
          <Route path="/portal/catalog/edit/:id" element={gated(<ProductForm />)} />
          <Route path="/portal/product-groups"   element={gated(<ProductGroups />)} />
          <Route path="/portal/departments"      element={gated(<Departments />)} />
          <Route path="/portal/vendors"          element={gated(<Vendors />)} />
          <Route path="/portal/vendors/:id"      element={gated(<VendorDetail />)} />
          <Route path="/portal/promotions"       element={gated(<Promotions />)} />
          <Route path="/portal/import"           element={gated(<BulkImport />)} />
          <Route path="/portal/label-queue"      element={gated(<LabelQueue />)} />

          {/* ── Billing ───────────────────────────────────────────────── */}
          <Route path="/portal/billing"          element={gated(<BillingPortal />)} />

          {/* ── Lottery — single route, tabs via ?tab= URL param ─────────
               LotteryRouter delegates to LotteryBackOffice (tab=daily) or
               the legacy tabbed Lottery (any other tab). Every sub-view is
               a deep-linkable URL; refresh preserves the selected tab. */}
          <Route path="/portal/lottery"           element={gated(<LotteryRouter />)} />

          {/* ── Fuel ──────────────────────────────────────────────────── */}
          <Route path="/portal/fuel"             element={gated(<Fuel />)} />

          {/* ── Scan Data / Tobacco Compliance (Session 45) ──────────── */}
          <Route path="/portal/scan-data"        element={gated(<ScanData />)} />

          {/* ── StoreVeu Exchange (B2B wholesale) ────────────────────────── */}
          <Route path="/portal/exchange"              element={gated(<Exchange />)} />
          <Route path="/portal/exchange/new"          element={gated(<ExchangeOrderDetail />)} />
          <Route path="/portal/exchange/orders/:id"   element={gated(<ExchangeOrderDetail />)} />

          <Route path="/portal/reports"          element={gated(<ReportsHub />)} />
          <Route path="/portal/support-tickets"  element={gated(<SupportTickets />)} />

          {/* ── Online Store (E-commerce) ──────────────────────────── */}
          <Route path="/portal/ecom/setup"       element={gated(<EcomSetup />)} />
          <Route path="/portal/ecom/orders"      element={gated(<EcomOrders />)} />
          <Route path="/portal/ecom/analytics"   element={gated(<EcomAnalytics />)} />

          {/* ── Delivery Platform Integrations ───────────────────────── */}
          <Route path="/portal/integrations"     element={gated(<IntegrationHub />)} />

          {/* ── Placeholders ──────────────────────────────────────────── */}
          <Route path="/portal/products"         element={<Placeholder name="Products" />} />

          {/* ── Legacy CSV Transformer ────────────────────────────────── */}
          <Route path="/csv/upload"              element={<UploadPage />} />
          <Route path="/preview/:uploadId"       element={<PreviewPage />} />
          <Route path="/transform/:transformId"  element={<TransformPage />} />
          <Route path="/csv/deposit-map"         element={<DepositMapPage />} />
          <Route path="/csv/history"             element={<HistoryPage />} />

          {/* ── Legacy OCR ────────────────────────────────────────────── */}
          <Route path="/ocr/tool"                element={<OCRPage />} />
        </Route>

        {/* ── Backwards-compat redirects ──────────────────────────────── */}
        <Route path="/portal/customers"      element={<Navigate to="/portal/customers-hub?tab=customers" replace />} />
        <Route path="/portal/loyalty"        element={<Navigate to="/portal/customers-hub?tab=loyalty" replace />} />
        <Route path="/portal/sales"                  element={<Navigate to="/portal/analytics?tab=sales" replace />} />
        <Route path="/portal/departments-analytics"  element={<Navigate to="/portal/analytics?tab=departments" replace />} />
        <Route path="/portal/products-analytics"     element={<Navigate to="/portal/analytics?tab=products" replace />} />
        <Route path="/portal/predictions"            element={<Navigate to="/portal/analytics?tab=predictions" replace />} />
        <Route path="/portal/organisation"   element={<Navigate to="/portal/account?tab=organisation" replace />} />
        <Route path="/portal/users"          element={<Navigate to="/portal/account?tab=users" replace />} />
        <Route path="/portal/stores"         element={<Navigate to="/portal/account?tab=stores" replace />} />
        <Route path="/portal/store-settings" element={<Navigate to="/portal/account?tab=settings" replace />} />
        <Route path="/portal/pos-settings"       element={<Navigate to="/portal/pos-config?tab=layout" replace />} />
        <Route path="/portal/receipt-settings"   element={<Navigate to="/portal/pos-config?tab=receipts" replace />} />
        <Route path="/portal/transactions"       element={<Navigate to="/portal/pos-reports?tab=transactions" replace />} />
        <Route path="/portal/pos-event-log"      element={<Navigate to="/portal/pos-reports?tab=events" replace />} />
        <Route path="/portal/employee-reports"   element={<Navigate to="/portal/pos-reports?tab=employee" replace />} />
        <Route path="/portal/payouts"            element={<Navigate to="/portal/pos-reports?tab=payouts" replace />} />
        <Route path="/portal/deposit-rules"      element={<Navigate to="/portal/rules?tab=deposits" replace />} />
        <Route path="/portal/tax-rules"          element={<Navigate to="/portal/rules?tab=tax" replace />} />
        <Route path="/portal/quick-access"       element={<Navigate to="/portal/quick-buttons" replace />} />
        <Route path="/portal/ecomm"            element={<Navigate to="/portal/integrations" replace />} />
        <Route path="/portal/ecom/domain"     element={<Navigate to="/portal/ecom/setup?tab=domain" replace />} />
        <Route path="/portal/ecom/customers"  element={<Navigate to="/portal/customers-hub?tab=customers" replace />} />

        {/* ── Fallback ────────────────────────────────────────────────── */}
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
      </ConfirmDialogProvider>
      </StoreProvider>
    </Router>
  );
}

export default App;
