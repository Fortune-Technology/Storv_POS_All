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
// Distinguish between:
//   - Invalid STATION token  → station record gone, needs re-registration
//   - Invalid CASHIER token   → session expired, needs PIN re-entry
// Debounced: only triggers once even if multiple API calls fail simultaneously.
let _401pending = false;

// Endpoints that return 401 as part of their normal flow — don't trigger logout
const IGNORE_401_PATHS = [
  '/pos-terminal/pin-login',  // wrong PIN is a 401 but user should see error, not logout
];

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status !== 401) return Promise.reject(error);

    const url = error.config?.url || '';
    const errorMsg = error.response?.data?.error || '';

    // Skip if this endpoint handles its own 401 (e.g. PIN login wrong PIN)
    if (IGNORE_401_PATHS.some(p => url.includes(p))) {
      // Exception: if the error is specifically "Invalid station token",
      // the station record is gone — need to re-register
      if (errorMsg.toLowerCase().includes('station token')) {
        if (!_401pending) {
          _401pending = true;
          console.warn('[API] Station token invalid — clearing station config');
          setTimeout(() => {
            localStorage.removeItem('pos_station');
            window.dispatchEvent(new Event('pos-station-invalid'));
            _401pending = false;
          }, 300);
        }
      }
      return Promise.reject(error);
    }

    // Normal 401 handling — cashier token expired
    if (!_401pending) {
      _401pending = true;
      console.warn('[API] 401 received — session expired');

      setTimeout(() => {
        const hasSession = !!localStorage.getItem('pos_user');
        if (hasSession) {
          localStorage.removeItem('pos_user');
          window.dispatchEvent(new Event('pos-session-expired'));
        }
        _401pending = false;
      }, 500);
    }
    return Promise.reject(error);
  }
);

export default api;
