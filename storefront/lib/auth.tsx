/**
 * Customer auth context — JWT + localStorage persistence.
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from 'react';
import axios from 'axios';
import type { Customer, AuthResponse, Order } from './types';

interface AuthState {
  token: string | null;
  customer: Customer | null;
}

interface AuthContextValue extends AuthState {
  isLoggedIn: boolean;
  storeSlug: string;
  signup: (name: string, email: string, phone: string, password: string) => Promise<AuthResponse>;
  login: (email: string, password: string) => Promise<AuthResponse>;
  logout: () => void;
  getOrders: () => Promise<Order[]>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<unknown>;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const STORAGE_KEY = 'storv-customer';
const ECOM_API = process.env.NEXT_PUBLIC_ECOM_API_URL || 'http://localhost:5005/api';

function loadAuth(): AuthState {
  if (typeof window === 'undefined') return { token: null, customer: null };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AuthState) : { token: null, customer: null };
  } catch {
    return { token: null, customer: null };
  }
}

function saveAuth(token: string | null, customer: Customer | null): void {
  if (typeof window === 'undefined') return;
  if (token) localStorage.setItem(STORAGE_KEY, JSON.stringify({ token, customer }));
  else localStorage.removeItem(STORAGE_KEY);
}

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [token, setToken] = useState<string | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);

  useEffect(() => {
    const saved = loadAuth();
    setToken(saved.token);
    setCustomer(saved.customer);
  }, []);

  const storeSlug: string =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('store') || 'demo'
      : 'demo';

  const apiAuth = useCallback(
    (t?: string | null) => ({
      headers: { Authorization: `Bearer ${t || token}` },
    }),
    [token]
  );

  const signup = useCallback(
    async (
      name: string,
      email: string,
      phone: string,
      password: string
    ): Promise<AuthResponse> => {
      const { data } = await axios.post<AuthResponse>(
        `${ECOM_API}/store/${storeSlug}/auth/signup`,
        { name, email, phone, password }
      );
      setToken(data.token);
      setCustomer(data.customer);
      saveAuth(data.token, data.customer);
      return data;
    },
    [storeSlug]
  );

  const login = useCallback(
    async (email: string, password: string): Promise<AuthResponse> => {
      const { data } = await axios.post<AuthResponse>(
        `${ECOM_API}/store/${storeSlug}/auth/login`,
        { email, password }
      );
      setToken(data.token);
      setCustomer(data.customer);
      saveAuth(data.token, data.customer);
      return data;
    },
    [storeSlug]
  );

  const logout = useCallback((): void => {
    setToken(null);
    setCustomer(null);
    saveAuth(null, null);
  }, []);

  const getOrders = useCallback(async (): Promise<Order[]> => {
    const { data } = await axios.get(`${ECOM_API}/store/${storeSlug}/auth/orders`, apiAuth());
    return data.data || [];
  }, [storeSlug, apiAuth]);

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      const { data } = await axios.put(
        `${ECOM_API}/store/${storeSlug}/auth/password`,
        { currentPassword, newPassword },
        apiAuth()
      );
      return data;
    },
    [storeSlug, apiAuth]
  );

  const isLoggedIn = !!token && !!customer;

  return (
    <AuthContext.Provider
      value={{
        token,
        customer,
        isLoggedIn,
        signup,
        login,
        logout,
        getOrders,
        changePassword,
        storeSlug,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
