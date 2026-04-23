/**
 * Shared domain types for the storefront.
 *
 * These are the minimal shapes the storefront actually touches — they mirror
 * the ecom-backend's API responses but are NOT auto-generated from Prisma.
 * Phase 3 of the TS migration plan is to introduce a shared @storv/types
 * package that generates these from Prisma; until then, keep these
 * in sync manually by widening (never narrowing) as new fields are consumed.
 */

export interface StoreBranding {
  logoText?: string;
  logoUrl?: string;
  primaryColor?: string;
  font?: string;
  [key: string]: unknown;
}

export interface Store {
  id: string;
  slug: string;
  name: string;
  /** Alias the ecom-backend exposes on /store/:slug responses. Same value as `name`. */
  storeName?: string;
  description?: string | null;
  branding?: StoreBranding | null;
  fulfillment?: Record<string, unknown> | null;
  seo?: Record<string, unknown> | null;
  pages?: EcomPage[];
  [key: string]: unknown;
}

export interface Department {
  id: string;
  name: string;
  slug?: string;
  [key: string]: unknown;
}

export interface EcomPage {
  id: string;
  slug: string;
  title: string;
  type?: string;
  sections?: unknown[];
  [key: string]: unknown;
}

export interface Product {
  id: string;
  posProductId?: string;
  name: string;
  slug: string;
  brand?: string | null;
  retailPrice: number | string;
  salePrice?: number | string | null;
  saleStart?: string | null;
  saleEnd?: string | null;
  imageUrl?: string | null;
  inStock?: boolean;
  departmentSlug?: string | null;
  [key: string]: unknown;
}

export interface ProductListResponse {
  data: Product[];
  total?: number;
  page?: number;
  pageSize?: number;
  [key: string]: unknown;
}

export interface CartItem {
  productId: string;
  posProductId: string;
  name: string;
  price: number;
  imageUrl: string | null;
  slug: string;
  qty: number;
}

export interface Customer {
  id: string;
  email: string;
  /** Convenience alias the ecom-backend returns (typically "firstName lastName"). */
  name?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  [key: string]: unknown;
}

export interface AuthResponse {
  token: string;
  customer: Customer;
  status?: 'active' | 'pending';
  [key: string]: unknown;
}

export interface Order {
  id: string;
  orderNumber?: string;
  status: string;
  total: number | string;
  items?: unknown[];
  createdAt: string;
  [key: string]: unknown;
}

/**
 * Shape of the context object passed to Next.js's getServerSideProps.
 * We only touch req.headers and query — not exhaustive.
 */
export interface ServerContext {
  req?: {
    headers?: Record<string, string | string[] | undefined>;
  };
  query?: Record<string, string | string[] | undefined>;
  [key: string]: unknown;
}

/**
 * A single section of a page template's `content.sections` JSON.
 * These shapes are dynamic / user-authored in the admin CMS, so every field
 * is optional. Templates access them via `s.hero?.heading` etc. with fallbacks.
 */
export interface TemplateSection {
  heading?: string;
  subheading?: string;
  text?: string;
  body?: string;
  image?: string;
  badge?: string;
  ctaText?: string;
  ctaLink?: string;
  secondaryCta?: string;
  secondaryCtaLink?: string;
  /** Stats template specific fields */
  years?: string;
  yearsLabel?: string;
  products?: string;
  productsLabel?: string;
  customers?: string;
  customersLabel?: string;
  /** Contact info */
  phone?: string;
  email?: string;
  address?: string;
  hours?: string;
  [key: string]: unknown;
}

/**
 * The `content` prop passed to every template — typically
 * `{ sections: { hero: {...}, products: {...}, info: {...} } }`.
 * Keys are user-defined; values conform to TemplateSection.
 */
export interface TemplateContent {
  sections?: Record<string, TemplateSection>;
  [key: string]: unknown;
}

/**
 * Shared prop contract for every template component (Home/About/Contact × 5).
 * The dispatcher TemplateRenderer passes all of these verbatim; each template
 * picks the subset it needs.
 */
export interface TemplateProps {
  content?: TemplateContent | null;
  store?: Store | null;
  products?: Product[];
  departments?: Department[];
  storeSlug: string;
}
