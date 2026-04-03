import { useEffect } from 'react';
import { useSyncStore } from '../stores/useSyncStore.js';

export function useOnlineStatus() {
  const { setOnline, drainQueue } = useSyncStore();

  useEffect(() => {
    const handleOnline  = () => { setOnline(true);  drainQueue(); };
    const handleOffline = () => setOnline(false);

    window.addEventListener('online',  handleOnline);
    window.addEventListener('offline', handleOffline);

    // Interval ping to /health to catch captive portals / half-connected states
    const interval = setInterval(async () => {
      try {
        const r = await fetch('/api/../health', { method: 'HEAD', cache: 'no-store' });
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
