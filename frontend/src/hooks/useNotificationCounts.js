/**
 * useNotificationCounts — polls multiple endpoints to get unread / pending
 * counts for the sidebar badges. Silently ignores failures so a down
 * endpoint doesn't break the sidebar. 30s polling cadence (chat uses 15s
 * elsewhere; this hook is for lower-priority badges).
 *
 * Returns: { chat, tasks, tickets, loaded }
 *
 * Note: chat polling stays in Sidebar.jsx via getChatUnread (unchanged)
 * because it already has navigation-aware reset logic. This hook covers
 * the additional badges added in Session 39.
 */

import { useEffect, useState, useCallback } from 'react';
import { getTaskCounts, getOrgTickets } from '../services/api';

const POLL_MS = 30 * 1000;

export function useNotificationCounts() {
  const [counts, setCounts] = useState({
    tasks:   0,    // my-assigned open/in-progress count (most relevant for badge)
    tickets: 0,    // open tickets for this org
    loaded:  false,
  });

  const fetchAll = useCallback(async () => {
    // Fire in parallel — if any fails, treat its count as 0
    const [tasksRes, ticketsRes] = await Promise.allSettled([
      getTaskCounts(),
      getOrgTickets({ status: 'open', limit: 100 }),
    ]);

    const tasks    = tasksRes.status === 'fulfilled' ? (tasksRes.value?.myOpen || 0) : 0;
    // getOrgTickets may return { tickets: [...] } or an array depending on backend shape
    const ticketsPayload = ticketsRes.status === 'fulfilled' ? ticketsRes.value : null;
    const ticketsList = Array.isArray(ticketsPayload) ? ticketsPayload
      : Array.isArray(ticketsPayload?.tickets) ? ticketsPayload.tickets
      : Array.isArray(ticketsPayload?.data) ? ticketsPayload.data
      : [];
    const tickets = ticketsList.filter(t => t.status === 'open' || t.status === 'pending').length;

    setCounts({ tasks, tickets, loaded: true });
  }, []);

  useEffect(() => {
    fetchAll();
    const iv = setInterval(fetchAll, POLL_MS);

    // Refresh when tab regains focus so counts update after a period in background
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') fetchAll();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      clearInterval(iv);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [fetchAll]);

  return counts;
}
