/**
 * API client for the ecom-backend.
 * Used in both getStaticProps (server-side) and client-side fetches.
 */

import axios from 'axios';
import type {
  Store,
  Product,
  ProductListResponse,
  Department,
  EcomPage,
  CartItem,
} from './types';

const ECOM_API_URL = process.env.ECOM_API_URL || 'http://localhost:5005/api';

const api = axios.create({
  baseURL: ECOM_API_URL,
  timeout: 10000,
});

/* ── Store ───────────────────────────────────────────────────────────────── */

export async function getStoreInfo(slug: string): Promise<Store> {
  const { data } = await api.get(`/store/${slug}`);
  return data.data;
}

/* ── Products ───────────────────────────────────────────────────────────── */

export async function getProducts(
  slug: string,
  params: Record<string, unknown> = {}
): Promise<ProductListResponse> {
  const { data } = await api.get(`/store/${slug}/products`, { params });
  return data;
}

export async function getProduct(slug: string, productSlug: string): Promise<Product> {
  const { data } = await api.get(`/store/${slug}/products/${productSlug}`);
  return data.data;
}

/* ── Departments ────────────────────────────────────────────────────────── */

export async function getDepartments(slug: string): Promise<Department[]> {
  const { data } = await api.get(`/store/${slug}/departments`);
  return data.data;
}

/* ── Pages ──────────────────────────────────────────────────────────────── */

export async function getPages(slug: string): Promise<EcomPage[]> {
  const { data } = await api.get(`/store/${slug}/pages`);
  return data.data;
}

export async function getPage(slug: string, pageSlug: string): Promise<EcomPage> {
  const { data } = await api.get(`/store/${slug}/pages/${pageSlug}`);
  return data.data;
}

/* ── Cart ────────────────────────────────────────────────────────────────── */

export interface ServerCart {
  sessionId: string;
  items: CartItem[];
  [key: string]: unknown;
}

export async function getCart(slug: string, sessionId: string): Promise<ServerCart> {
  const { data } = await api.get(`/store/${slug}/cart/${sessionId}`);
  return data.data;
}

export async function updateCart(
  slug: string,
  sessionId: string,
  items: CartItem[]
): Promise<ServerCart> {
  const { data } = await api.put(`/store/${slug}/cart`, { sessionId, items });
  return data.data;
}

/* ── Checkout ───────────────────────────────────────────────────────────── */

export interface CheckoutResponse {
  orderId: string;
  orderNumber?: string;
  status: string;
  [key: string]: unknown;
}

export async function submitCheckout(
  slug: string,
  orderData: Record<string, unknown>
): Promise<CheckoutResponse> {
  const { data } = await api.post(`/store/${slug}/checkout`, orderData);
  return data.data;
}
