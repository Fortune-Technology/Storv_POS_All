/**
 * useHardware.js
 * Unified hardware state hook. Reads hardware config from localStorage
 * (saved during station setup) and provides print/drawer/PAX methods.
 */

import { useState, useCallback } from 'react';
import { useStationStore } from '../stores/useStationStore.js';
import { printReceiptQZ, printReceiptNetwork, kickCashDrawer } from '../services/printerService.js';
import { connectQZ, isQZConnected } from '../services/qzService.js';
import * as posApi from '../api/pos.js';

const HW_STORAGE_KEY = 'storv_hardware_config';

export const loadHardwareConfig = () => {
  try {
    const raw = localStorage.getItem(HW_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
};

export const saveHardwareConfigLocally = (config) => {
  localStorage.setItem(HW_STORAGE_KEY, JSON.stringify(config));
};

export function useHardware() {
  const station = useStationStore(s => s.station);
  const hw      = loadHardwareConfig();

  const [printing, setPrinting] = useState(false);
  const [payStatus, setPayStatus] = useState(null); // null|'waiting'|'approved'|'declined'|'error'
  const [payResult, setPayResult] = useState(null);

  // ── Print receipt ────────────────────────────────────────────────────────
  const printReceipt = useCallback(async (receiptData) => {
    if (!hw?.receiptPrinter || hw.receiptPrinter.type === 'none') return;
    setPrinting(true);
    try {
      if (hw.receiptPrinter.type === 'network') {
        await printReceiptNetwork(hw.receiptPrinter.ip, hw.receiptPrinter.port, receiptData);
      } else {
        // QZ or WebSerial
        if (!isQZConnected()) await connectQZ();
        await printReceiptQZ(hw.receiptPrinter.name, receiptData);
      }
    } catch (err) {
      console.warn('Print failed:', err.message);
    } finally {
      setPrinting(false);
    }
  }, [hw]);

  // ── Open cash drawer ─────────────────────────────────────────────────────
  const openDrawer = useCallback(async () => {
    if (!hw?.cashDrawer || hw.cashDrawer.type === 'none') return;
    try {
      if (hw.cashDrawer.type === 'printer' && hw.receiptPrinter?.name) {
        await kickCashDrawer(hw.receiptPrinter.name);
      }
    } catch (err) {
      console.warn('Drawer kick failed:', err.message);
    }
  }, [hw]);

  // ── PAX card payment ─────────────────────────────────────────────────────
  const processCardPayment = useCallback(async ({ amount, invoiceNumber, edcType = '02' }) => {
    if (!hw?.paxTerminal?.enabled) {
      throw new Error('No PAX terminal configured for this station.');
    }
    setPayStatus('waiting');
    setPayResult(null);
    try {
      const result = await posApi.paxSale({
        amount, invoiceNumber, edcType,
        stationId: station?.id,
      });
      if (result.approved) {
        setPayStatus('approved');
        setPayResult(result.data);
      } else {
        setPayStatus('declined');
        setPayResult(result.data);
      }
      return result;
    } catch (err) {
      setPayStatus('error');
      setPayResult({ message: err.message });
      throw err;
    }
  }, [hw, station]);

  const cancelPayment = useCallback(() => {
    setPayStatus(null);
    setPayResult(null);
  }, []);

  const hasPAX           = !!(hw?.paxTerminal?.enabled && hw?.paxTerminal?.ip);
  const hasReceiptPrinter = !!(hw?.receiptPrinter?.type && hw.receiptPrinter.type !== 'none');
  const hasCashDrawer    = !!(hw?.cashDrawer?.type && hw.cashDrawer.type !== 'none');

  return {
    hw,
    printing, payStatus, payResult,
    printReceipt, openDrawer,
    processCardPayment, cancelPayment,
    hasPAX, hasReceiptPrinter, hasCashDrawer,
  };
}
