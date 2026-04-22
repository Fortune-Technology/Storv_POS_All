/**
 * useLabelPrintJobPoller
 *
 * When the station is opted-in (`hardware.labelPrinter.acceptRoutedJobs`)
 * and running in Electron, poll the backend for pending ZPL jobs, print
 * them via the local Zebra Browser Print bridge, and report back. This
 * is the cashier-app half of the "route via register" flow that lets
 * storeveu.com print labels despite Chrome's Local Network Access block.
 *
 * Returns `{ status, lastJobAt, error, printedToday }` for UI indicators.
 */

import { useEffect, useRef, useState } from 'react';
import { useStationStore } from '../stores/useStationStore.js';
import { useAuthStore }    from '../stores/useAuthStore.js';
import { claimLabelPrintJobs, completeLabelPrintJob } from '../api/pos.js';

const POLL_INTERVAL_MS = 5000;
const BACKOFF_MAX_MS   = 60_000;
const HW_KEY = 'storv_hardware_config';

// Read the station-level label-printer config from localStorage. This is
// written by HardwareSettingsModal and survives across sessions. Re-reads
// on every tick (cheap) so toggles in settings take effect without reload.
function readLabelConfig() {
  try {
    const raw = localStorage.getItem(HW_KEY);
    if (!raw) return { acceptRoutedJobs: false, zebraName: '' };
    const cfg = JSON.parse(raw);
    const lp = cfg?.labelPrinter || {};
    return {
      acceptRoutedJobs: !!lp.acceptRoutedJobs,
      zebraName:        lp.zebraName || '',
    };
  } catch {
    return { acceptRoutedJobs: false, zebraName: '' };
  }
}

export function useLabelPrintJobPoller() {
  const station = useStationStore(s => s.station);
  const cashier = useAuthStore(s => s.cashier);

  const [labelCfg, setLabelCfg] = useState(readLabelConfig);

  // Refresh the config when another tab/component changes localStorage
  // OR when the user reopens the hardware settings modal and saves.
  useEffect(() => {
    const check = () => setLabelCfg(readLabelConfig());
    const onStorage = (e) => { if (e.key === HW_KEY) check(); };
    window.addEventListener('storage', onStorage);
    // Poll localStorage every 30s as a safety net (same-tab writes don't
    // fire `storage` events in most browsers).
    const id = setInterval(check, 30_000);
    return () => {
      window.removeEventListener('storage', onStorage);
      clearInterval(id);
    };
  }, []);

  const acceptRoutedJobs = labelCfg.acceptRoutedJobs;
  const preferredPrinter = labelCfg.zebraName || null;

  const isElectron = typeof window !== 'undefined' && !!window.electronAPI?.zebraPrintZPL;
  const stationId  = station?.id || station?.stationId || null;
  const authed     = !!(cashier?.token);

  const [status, setStatus] = useState('idle'); // 'idle'|'polling'|'printing'|'error'
  const [error, setError] = useState(null);
  const [lastJobAt, setLastJobAt] = useState(null);
  const [printedToday, setPrintedToday] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('label_printed_today') || 'null');
      if (stored && stored.date === new Date().toDateString()) return stored.count || 0;
    } catch {}
    return 0;
  });

  const pollTimerRef = useRef(null);
  const backoffRef   = useRef(POLL_INTERVAL_MS);
  const runningRef   = useRef(false);

  const incPrinted = (n) => {
    setPrintedToday(prev => {
      const next = prev + n;
      try {
        localStorage.setItem('label_printed_today', JSON.stringify({
          date: new Date().toDateString(),
          count: next,
        }));
      } catch {}
      return next;
    });
  };

  useEffect(() => {
    // Guard: only run when everything needed is in place.
    if (!isElectron || !acceptRoutedJobs || !stationId || !authed) {
      setStatus('idle');
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      return;
    }

    let cancelled = false;

    async function processOneCycle() {
      if (cancelled) return;
      if (runningRef.current) {
        // Reschedule — previous cycle still running
        pollTimerRef.current = setTimeout(processOneCycle, backoffRef.current);
        return;
      }
      runningRef.current = true;
      setStatus('polling');

      try {
        const { jobs = [] } = await claimLabelPrintJobs(stationId, 5);
        if (jobs.length === 0) {
          setError(null);
          backoffRef.current = POLL_INTERVAL_MS; // reset backoff on healthy empty response
        } else {
          setStatus('printing');
          for (const job of jobs) {
            const name = job.printerName || preferredPrinter || undefined;
            let result;
            try {
              result = await window.electronAPI.zebraPrintZPL(job.zpl, name);
            } catch (err) {
              result = { success: false, error: err?.message || String(err) };
            }
            try {
              await completeLabelPrintJob(job.id, {
                success: !!result.success,
                error:   result.success ? null : (result.error || 'unknown error'),
                stationId,
              });
            } catch (err) {
              console.warn('[LabelPrintPoller] Could not report completion for job', job.id, err?.message);
            }
            if (result.success) {
              incPrinted(job.labelCount || 1);
              setLastJobAt(new Date());
            }
          }
          setError(null);
          backoffRef.current = POLL_INTERVAL_MS;
        }
      } catch (err) {
        // Network/auth hiccups: back off exponentially (capped) and surface
        // the error to the UI indicator.
        setError(err?.message || String(err));
        setStatus('error');
        backoffRef.current = Math.min(BACKOFF_MAX_MS, backoffRef.current * 2);
      } finally {
        runningRef.current = false;
        if (!cancelled) {
          pollTimerRef.current = setTimeout(processOneCycle, backoffRef.current);
        }
      }
    }

    // Kick off immediately, then on interval.
    processOneCycle();

    return () => {
      cancelled = true;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
      runningRef.current = false;
    };
  }, [isElectron, acceptRoutedJobs, stationId, authed, preferredPrinter]);

  return {
    enabled: isElectron && acceptRoutedJobs && !!stationId && authed,
    status,
    error,
    lastJobAt,
    printedToday,
  };
}
