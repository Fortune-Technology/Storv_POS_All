/**
 * Shared API response types for admin-app.
 *
 * Phase 3a of the TS migration: replaces the `Promise<any>` pattern in
 * services/api.ts with narrower envelope + entity types. These are hand-
 * maintained to match actual backend responses — they do NOT auto-generate
 * from Prisma. When the response-shape contract changes on the backend,
 * update here too.
 *
 * Phase 4 (future) will lift these into a `@storv/types` workspace package
 * shared across portal + admin + cashier + ecom once the shapes stabilise.
 *
 * Design rules:
 *   - Fields the backend always returns are required; everything else is optional.
 *   - `id` is `string | number` because some tables use cuid strings and others use ints.
 *   - Numeric Decimal columns come back as `number | string` from Prisma/axios.
 *   - Dates come back as ISO strings over the wire.
 *   - Use `Partial<T>` / `Pick<T, K>` in pages when they only need a subset.
 */

// ─── Generic envelope patterns ────────────────────────────────────────────────

/** `{ data: T[], total: N }` — used by paginated list endpoints with simple totals. */
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
}

/** `{ data: T[], meta: { total } }` — used by billing/invoices where more meta exists. */
export interface MetaPaginatedResponse<T> {
  data: T[];
  meta?: { total?: number; page?: number; limit?: number };
}

/** `{ success: true, ... }` — generic mutation/action ack. */
export interface SuccessResponse {
  success: boolean;
  message?: string;
}

// ─── Core entities (shared across multiple admin pages) ──────────────────────

export type UserRole = 'staff' | 'cashier' | 'manager' | 'owner' | 'admin' | 'superadmin';
export type UserStatus = 'pending' | 'active' | 'suspended';

/** Core user record returned by /admin/users. */
export interface AdminUser {
  id: string | number;
  name: string;
  email: string;
  phone?: string;
  role: UserRole;
  status: UserStatus;
  orgId?: string;
  organization?: { id?: string | number; name?: string } | null;
  createdAt?: string;
  updatedAt?: string;
}

/** Core organization record returned by /admin/organizations. */
export interface Organization {
  id: string | number;
  name: string;
  slug: string;
  plan?: string;
  billingEmail?: string;
  maxStores?: number;
  maxUsers?: number;
  isActive?: boolean;
  createdAt?: string;
  _count?: { users?: number; stores?: number };
}

/** Store record (admin-app shape — includes the organization it belongs to). */
export interface AdminStore {
  id: string | number;
  name: string;
  orgId?: string;
  address?: string;
  stationCount?: number;
  isActive?: boolean;
  createdAt?: string;
  organization?: { name?: string };
  _count?: { stations?: number };
}

// ─── Login response ──────────────────────────────────────────────────────────

export interface LoginResponse {
  id: string | number;
  email: string;
  name: string;
  role: UserRole;
  token: string;
  orgId?: string;
  status?: UserStatus;
}

// ─── Impersonation response ──────────────────────────────────────────────────

export interface ImpersonateResponse {
  token: string;
  user: {
    id: string | number;
    name: string;
    email: string;
    role: UserRole;
    orgId?: string;
    storeIds?: (string | number)[];
  };
}

// ─── Payment Merchant (Dejavoo) ───────────────────────────────────────────────

export type MerchantStatus = 'active' | 'pending' | 'disabled';
export type MerchantEnvironment = 'uat' | 'prod';

export interface PaymentMerchant {
  id: string | number;
  orgId: string;
  storeId: string;
  orgName?: string;
  storeName?: string;
  provider: string;
  environment: MerchantEnvironment;
  spinTpn?: string;
  spinBaseUrl?: string;
  hppMerchantId?: string;
  hppBaseUrl?: string;
  transactBaseUrl?: string;
  ebtEnabled?: boolean;
  debitEnabled?: boolean;
  tokenizeEnabled?: boolean;
  status?: MerchantStatus;
  notes?: string;
  lastTestedAt?: string;
  lastTestResult?: 'ok' | 'fail';
  spinAuthKeySet?: boolean;
  spinAuthKeyPreview?: string;
  hppAuthKeySet?: boolean;
  hppAuthKeyPreview?: string;
  transactApiKeySet?: boolean;
  transactApiKeyPreview?: string;
}

export interface PaymentTerminal {
  id: string | number;
  merchantId: string;
  stationId?: string;
  stationName?: string;
  nickname?: string;
  deviceSerialNumber?: string;
  deviceModel?: string;
  overrideTpn?: string;
  effectiveTpn?: string;
  notes?: string;
  status?: string;
  lastPingedAt?: string;
}

/** Entry in the payment-merchant audit log (every create/update/test/activate/disable). */
export interface PaymentMerchantAuditEntry {
  id: string | number;
  action: string;
  changedByName?: string;
  createdAt?: string;
  note?: string;
  changes?: Record<string, unknown>;
}

// ─── Tickets & Career ─────────────────────────────────────────────────────────

export type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface TicketResponse {
  by: string;
  byType: 'admin' | 'store';
  message: string;
  date: string;
}

export interface SupportTicket {
  id: string | number;
  email: string;
  name?: string;
  subject: string;
  body: string;
  status: TicketStatus;
  priority: TicketPriority;
  createdAt: string;
  adminNotes?: string;
  responses?: TicketResponse[];
}

// ─── CMS & Careers ────────────────────────────────────────────────────────────

export interface CmsPage {
  id: string | number;
  title: string;
  slug: string;
  content: string;
  metaTitle?: string;
  metaDesc?: string;
  published?: boolean;
  sortOrder?: number;
  updatedAt?: string;
}

export interface CareerPosting {
  id: string | number;
  title: string;
  department?: string;
  location?: string;
  type?: string;
  description?: string;
  published?: boolean;
}

export interface CareerApplication {
  id: string | number;
  name: string;
  email: string;
  phone?: string;
  status: string;
  coverLetter?: string;
  resumeUrl?: string;
  adminNotes?: string;
  createdAt?: string;
}

// ─── RBAC ─────────────────────────────────────────────────────────────────────

export type RoleStatus = 'active' | 'inactive';
export type RoleSurface = 'back-office' | 'cashier-app' | 'both';

export interface Permission {
  key: string;
  action: string;
  label: string;
  surface?: RoleSurface;
  moduleLabel?: string;
}

export interface Role {
  id: string | number;
  key: string;
  name: string;
  description?: string;
  status: RoleStatus;
  permissions: string[];
  isSystem?: boolean;
  isCustomized?: boolean;
  userCount: number;
}

// ─── State catalog ────────────────────────────────────────────────────────────

export interface UsStateRecord {
  code: string;
  name: string;
  country?: string;
  defaultTaxRate?: number | null;
  defaultLotteryCommission?: number | null;
  instantSalesCommRate?: number | null;
  instantCashingCommRate?: number | null;
  machineSalesCommRate?: number | null;
  machineCashingCommRate?: number | null;
  alcoholAgeLimit?: number;
  tobaccoAgeLimit?: number;
  bottleDepositRules?: unknown[];
  lotteryGameStubs?: unknown[];
  lotteryPackSizeRules?: unknown[];
  notes?: string;
  active?: boolean;
}

// ─── Lottery (admin catalog + ticket requests) ────────────────────────────────

export type LotteryCategory = 'instant' | 'draw' | 'daily' | 'other';

export interface LotteryCatalogRow {
  id: string | number;
  name: string;
  gameNumber?: string;
  ticketPrice: number;
  ticketsPerBook: number;
  state?: string;
  category?: string;
  active?: boolean;
}

export interface LotteryRequest {
  id: string | number;
  storeName?: string;
  storeId?: string | number;
  name: string;
  gameNumber?: string;
  ticketPrice?: number;
  ticketsPerBook?: number;
  state?: string;
  status?: 'pending' | 'approved' | 'rejected';
  createdAt?: string;
  notes?: string;
}

// ─── AI Assistant: KB / Reviews / Tours / Conversations ──────────────────────

export interface KbArticle {
  id: string | number;
  title: string;
  content: string;
  category: string;
  source?: string;
  orgId?: string | null;
  tags?: string[];
  helpfulCount?: number;
  unhelpfulCount?: number;
  active: boolean;
}

export interface AiReview {
  id: string | number;
  question: string;
  aiResponse: string;
  userSuggestion?: string;
  status: 'pending' | 'promoted' | 'dismissed';
  createdAt: string;
  articleTitle?: string;
}

export interface AiTourStep {
  title: string;
  body: string;
  url?: string;
  selector?: string;
}

export interface AiTour {
  id: string | number;
  slug: string;
  name: string;
  description?: string;
  category: string;
  triggers?: string[];
  steps?: AiTourStep[];
  active: boolean;
  orgId?: string | null;
}

// ─── Billing: plans, add-ons, subscriptions, invoices, equipment ─────────────

export interface BillingPlan {
  id: string | number;
  name: string;
  slug: string;
  description?: string;
  basePrice: number | string;
  pricePerStore?: number | string;
  pricePerRegister?: number | string;
  includedStores?: number;
  includedRegisters?: number;
  trialDays: number;
  isPublic: boolean;
  isActive: boolean;
  includedAddons?: string[];
  sortOrder: number;
}

export interface BillingAddon {
  id: string | number;
  key: string;
  name: string;
  description?: string;
  monthlyPrice: number | string;
  sortOrder: number;
  isActive?: boolean;
}

export type SubscriptionStatus = 'trial' | 'active' | 'past_due' | 'suspended' | 'cancelled';

export interface Subscription {
  id: string | number;
  orgId: string;
  planId: string | number;
  org?: { name?: string };
  plan?: { name?: string; basePrice?: number | string };
  status: SubscriptionStatus;
  overrideMaxStores?: number | null;
  overrideMaxRegisters?: number | null;
  extraAddons?: string[];
  discountType?: string | null;
  discountValue?: number | string | null;
  discountNote?: string | null;
  discountExpiry?: string | null;
  trialEndsAt?: string | null;
  nextBillingDate?: string;
  paymentMethodType?: string | null;
  paymentLast4?: string | null;
}

export type InvoiceStatus = 'pending' | 'paid' | 'failed' | 'written_off';

export interface BillingInvoice {
  id: string | number;
  invoiceNumber: string;
  orgId: string;
  subscription?: { org?: { name?: string } };
  periodStart?: string;
  periodEnd?: string;
  baseAmount: number | string;
  discountAmount: number | string;
  totalAmount: number | string;
  status: InvoiceStatus;
  attemptCount: number;
  paidAt?: string;
}

export interface EquipmentOrderItem {
  product?: { name?: string };
  qty: number;
}

export type EquipmentOrderStatus = 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled';

export interface EquipmentOrder {
  id: string | number;
  orderNumber: string;
  name?: string;
  email?: string;
  items?: EquipmentOrderItem[];
  total: number | string;
  paymentStatus: string;
  status: EquipmentOrderStatus;
  trackingNumber?: string;
  trackingCarrier?: string;
  notes?: string;
}

export interface EquipmentProduct {
  id: string | number;
  name: string;
  slug: string;
  description?: string;
  price: number | string;
  comparePrice?: number | string | null;
  category?: string;
  stock: number;
  trackStock: boolean;
  isActive: boolean;
  sortOrder: number;
  specs?: unknown;
  images?: string[];
}

// ─── Chat ────────────────────────────────────────────────────────────────────

export interface ChatUser {
  id?: string | number;
  _id?: string | number;
  name?: string;
  email?: string;
  role?: UserRole;
}

export interface ChatChannel {
  id?: string | number;
  _id?: string | number;
  type?: string;
  name?: string;
  label?: string;
  memberId?: string | number;
  member_id?: string | number;
  unreadCount?: number;
  lastMessage?: string | { message?: string; text?: string };
}

export interface ChatMessage {
  id?: string | number;
  _id?: string | number;
  senderId?: string | number;
  sender_id?: string | number;
  userId?: string | number;
  senderName?: string;
  sender_name?: string;
  senderRole?: string;
  sender_role?: string;
  createdAt?: string;
  created_at?: string;
  timestamp?: string;
  message?: string;
  text?: string;
  body?: string;
}

// ─── Vendor Import Templates ──────────────────────────────────────────────────

export interface VendorTemplateMapping {
  vendorColumn: string;
  targetField?: string | null;
  transform?: string | null;
  transformArgs?: unknown;
  constantValue?: string | null;
  skip?: boolean;
  sortOrder: number;
}

export interface VendorImportTemplate {
  id: string | number;
  name: string;
  slug?: string;
  description?: string;
  target?: string;
  vendorHint?: string;
  active?: boolean;
  mappings?: VendorTemplateMapping[];
  _count?: { mappings?: number };
}

export interface VendorTemplateTransform {
  name: string;
}

// ─── Price scenarios (interchange-plus calculator) ───────────────────────────

export interface PriceScenario {
  id: string | number;
  storeName: string;
  location?: string;
  mcc?: string;
  notes?: string;
  inputs?: Record<string, unknown>;
  results?: { eff_rate?: number; saves_mo?: number; [k: string]: unknown };
}

// ─── System config ────────────────────────────────────────────────────────────

export interface SystemConfig {
  id: string | number;
  key: string;
  value: string;
  description?: string | null;
}

export interface ImageRehostStatus {
  total: number;
  rehosted: number;
  pending: number;
  diskSizeMB: number;
}

export interface ImageRehostResult {
  succeeded: number;
  failed: number;
  remaining: number;
}
