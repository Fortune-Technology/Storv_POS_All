import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  timeout: 8000,
});

// Attach auth tokens on every request:
//   Authorization: Bearer <cashier JWT>   (from pos_user)
//   x-station-token: <station token>      (from pos_station)
api.interceptors.request.use(cfg => {
  // Cashier JWT
  try {
    const raw = localStorage.getItem('pos_user');
    if (raw) {
      const { token } = JSON.parse(raw);
      if (token) cfg.headers.Authorization = `Bearer ${token}`;
    }
  } catch {}

  // Station token — required by all /pos-terminal/* routes
  try {
    const raw = localStorage.getItem('pos_station');
    if (raw) {
      const parsed = JSON.parse(raw);
      // Zustand persist wraps state in { state: { station: ... } }
      const station = parsed?.state?.station ?? parsed?.station ?? parsed;
      const stationToken = station?.stationToken;
      if (stationToken) cfg.headers['x-station-token'] = stationToken;
    }
  } catch {}

  return cfg;
});

// ── Auto-logout on 401 (expired/invalid token) ──────────────────────────────
// If any API call returns 401, the token is expired — clear the cashier
// session so the app falls back to the PIN login screen.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      console.warn('[API] 401 received — clearing cashier session (token expired)');
      localStorage.removeItem('pos_user');
      // Force re-render by reloading (Zustand won't react to direct localStorage changes)
      window.location.reload();
    }
    return Promise.reject(error);
  }
);

export default api;
