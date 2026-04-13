/**
 * Customer auth context — JWT + localStorage persistence.
 */

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const AuthContext = createContext(null);
const STORAGE_KEY = 'storv-customer';
const ECOM_API = process.env.NEXT_PUBLIC_ECOM_API_URL || 'http://localhost:5005/api';

function loadAuth() {
  if (typeof window === 'undefined') return { token: null, customer: null };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : { token: null, customer: null };
  } catch { return { token: null, customer: null }; }
}

function saveAuth(token, customer) {
  if (typeof window === 'undefined') return;
  if (token) localStorage.setItem(STORAGE_KEY, JSON.stringify({ token, customer }));
  else localStorage.removeItem(STORAGE_KEY);
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(null);
  const [customer, setCustomer] = useState(null);

  useEffect(() => {
    const saved = loadAuth();
    setToken(saved.token);
    setCustomer(saved.customer);
  }, []);

  const storeSlug = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('store') || 'demo' : 'demo';

  const apiAuth = useCallback((t) => ({
    headers: { Authorization: `Bearer ${t || token}` },
  }), [token]);

  const signup = useCallback(async (name, email, phone, password) => {
    const { data } = await axios.post(`${ECOM_API}/store/${storeSlug}/auth/signup`, { name, email, phone, password });
    setToken(data.token);
    setCustomer(data.customer);
    saveAuth(data.token, data.customer);
    return data;
  }, [storeSlug]);

  const login = useCallback(async (email, password) => {
    const { data } = await axios.post(`${ECOM_API}/store/${storeSlug}/auth/login`, { email, password });
    setToken(data.token);
    setCustomer(data.customer);
    saveAuth(data.token, data.customer);
    return data;
  }, [storeSlug]);

  const logout = useCallback(() => {
    setToken(null);
    setCustomer(null);
    saveAuth(null, null);
  }, []);

  const getOrders = useCallback(async () => {
    const { data } = await axios.get(`${ECOM_API}/store/${storeSlug}/auth/orders`, apiAuth());
    return data.data || [];
  }, [storeSlug, apiAuth]);

  const changePassword = useCallback(async (currentPassword, newPassword) => {
    const { data } = await axios.put(`${ECOM_API}/store/${storeSlug}/auth/password`, { currentPassword, newPassword }, apiAuth());
    return data;
  }, [storeSlug, apiAuth]);

  const isLoggedIn = !!token && !!customer;

  return (
    <AuthContext.Provider value={{ token, customer, isLoggedIn, signup, login, logout, getOrders, changePassword, storeSlug }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
