import { useEffect } from 'react';
import { useSyncStore } from '../stores/useSyncStore.js';

// Derive the health-check URL from the configured API base URL.
// Using a relative path like '/api/../health' fails silently in Electron's
// file:// context — fetch resolves it as file:///health → always throws.
const API_BASE   = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
const HEALTH_URL = API_BASE.replace(/\/api\/?$/, '') + '/health';

export function useOnlineStatus() {
  const { setOnline, drainQueue } = useSyncStore();

  useEffect(() => {
    const handleOnline  = () => { setOnline(true);  drainQueue(); };
    const handleOffline = () => setOnline(false);

    window.addEventListener('online',  handleOnline);
    window.addEventListener('offline', handleOffline);

    // Ping the backend /health endpoint every 10 s to detect captive-portal
    // or half-connected states. Uses an absolute URL so Electron file:// works.
    const interval = setInterval(async () => {
      try {
        const r = await fetch(HEALTH_URL, { method: 'HEAD', cache: 'no-store' });
        setOnline(r.ok);
        if (r.ok) drainQueue();
      } catch {
        setOnline(false);
      }
    }, 10_000);

    return () => {
      window.removeEventListener('online',  handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
    };
  }, [setOnline, drainQueue]);
}
