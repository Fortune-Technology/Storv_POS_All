/**
 * Public-storefront API shapes — produced by the `ecom-backend` and consumed
 * by the Next.js `storefront/` app.
 *
 * Source-of-truth header rule: when ecom-backend's response shape changes,
 * update here in the same PR. Never narrow an existing field; widen instead.
 */

import type { DecimalString, IsoDate } from './common.js';

// ─── Store ───────────────────────────────────────────────────────────────────

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

// ─── CMS pages + templates ───────────────────────────────────────────────────

export interface EcomPage {
  id: string;
  slug: string;
  title: string;
  type?: string;
  sections?: unknown[];
  [key: string]: unknown;
}

/**
 * A single section of a page template's `content.sections` JSON.
 * Shapes are dynamic / user-authored in the admin CMS, so every field
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
  // Single-product templates (Product Detail Page) — populated only when
  // rendering /products/[slug]. Other templates ignore it.
  product?: Product | null;
}

// ─── Product catalog ─────────────────────────────────────────────────────────

export interface Department {
  id: string;
  name: string;
  slug?: string;
  [key: string]: unknown;
}

export interface Product {
  id: string;
  posProductId?: string;
  name: string;
  slug: string;
  brand?: string | null;
  retailPrice: DecimalString;
  salePrice?: DecimalString | null;
  saleStart?: IsoDate | null;
  saleEnd?: IsoDate | null;
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

// ─── Cart ────────────────────────────────────────────────────────────────────

export interface CartItem {
  productId: string;
  posProductId: string;
  name: string;
  price: number;
  imageUrl: string | null;
  slug: string;
  qty: number;
}

// ─── Customer auth ───────────────────────────────────────────────────────────

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

// ─── Orders (storefront-side) ────────────────────────────────────────────────

/**
 * Public order shape. Note: this is the minimal shape used on the
 * storefront's order confirmation + history pages. Admin/billing surfaces
 * use a richer shape — see `admin.ts`.
 */
export interface Order {
  id: string;
  orderNumber?: string;
  status: string;
  total: DecimalString;
  items?: unknown[];
  createdAt: IsoDate;
  [key: string]: unknown;
}

// ─── SSR helpers ─────────────────────────────────────────────────────────────

/**
 * Shape of the context object passed to Next.js's `getServerSideProps`.
 * We only touch req.headers and query — not exhaustive.
 */
export interface ServerContext {
  req?: {
    headers?: Record<string, string | string[] | undefined>;
  };
  query?: Record<string, string | string[] | undefined>;
  [key: string]: unknown;
}
