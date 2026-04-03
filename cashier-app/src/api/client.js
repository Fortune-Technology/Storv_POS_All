import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 8000,
});

// Attach auth token from localStorage on every request
api.interceptors.request.use(cfg => {
  const raw = localStorage.getItem('pos_user');
  if (raw) {
    try {
      const { token } = JSON.parse(raw);
      if (token) cfg.headers.Authorization = `Bearer ${token}`;
    } catch {}
  }
  return cfg;
});

export default api;
