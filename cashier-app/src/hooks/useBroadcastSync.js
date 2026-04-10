/**
 * BroadcastChannel hooks for real-time POS → Customer Display sync.
 * Same-origin, zero-latency, no server overhead.
 */

import { useEffect, useRef, useCallback } from 'react';

const CHANNEL_NAME = 'storv-customer-display';

/**
 * Publisher — used by POSScreen to broadcast cart state to customer display.
 * Returns a stable `publish(data)` function.
 */
export function useCustomerDisplayPublisher() {
  const channelRef = useRef(null);

  useEffect(() => {
    channelRef.current = new BroadcastChannel(CHANNEL_NAME);
    return () => {
      channelRef.current?.close();
      channelRef.current = null;
    };
  }, []);

  const publish = useCallback((data) => {
    try {
      channelRef.current?.postMessage(data);
    } catch {
      // Channel closed or structured clone failed — silently ignore
    }
  }, []);

  return { publish };
}

/**
 * Subscriber — used by CustomerDisplayScreen to receive cart state.
 * Calls `onMessage(data)` whenever the POS publishes.
 */
export function useCustomerDisplaySubscriber(onMessage) {
  const cbRef = useRef(onMessage);
  cbRef.current = onMessage;

  useEffect(() => {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = (e) => cbRef.current?.(e.data);
    return () => channel.close();
  }, []);
}
