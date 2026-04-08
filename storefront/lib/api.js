/**
 * API client for the ecom-backend.
 * Used in both getStaticProps (server-side) and client-side fetches.
 */

import axios from 'axios';

const ECOM_API_URL = process.env.ECOM_API_URL || 'http://localhost:5005/api';

const api = axios.create({
  baseURL: ECOM_API_URL,
  timeout: 10000,
});

/* ── Store ───────────────────────────────────────────────────────────────── */

export async function getStoreInfo(slug) {
  const { data } = await api.get(`/store/${slug}`);
  return data.data;
}

/* ── Products ───────────────────────────────────────────────────────────── */

export async function getProducts(slug, params = {}) {
  const { data } = await api.get(`/store/${slug}/products`, { params });
  return data;
}

export async function getProduct(slug, productSlug) {
  const { data } = await api.get(`/store/${slug}/products/${productSlug}`);
  return data.data;
}

/* ── Departments ────────────────────────────────────────────────────────── */

export async function getDepartments(slug) {
  const { data } = await api.get(`/store/${slug}/departments`);
  return data.data;
}

/* ── Pages ──────────────────────────────────────────────────────────────── */

export async function getPages(slug) {
  const { data } = await api.get(`/store/${slug}/pages`);
  return data.data;
}

export async function getPage(slug, pageSlug) {
  const { data } = await api.get(`/store/${slug}/pages/${pageSlug}`);
  return data.data;
}

/* ── Cart ────────────────────────────────────────────────────────────────── */

export async function getCart(slug, sessionId) {
  const { data } = await api.get(`/store/${slug}/cart/${sessionId}`);
  return data.data;
}

export async function updateCart(slug, sessionId, items) {
  const { data } = await api.put(`/store/${slug}/cart`, { sessionId, items });
  return data.data;
}

/* ── Checkout ───────────────────────────────────────────────────────────── */

export async function submitCheckout(slug, orderData) {
  const { data } = await api.post(`/store/${slug}/checkout`, orderData);
  return data.data;
}
