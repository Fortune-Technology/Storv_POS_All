/**
 * useHardware.js
 * Unified hardware state hook. Reads hardware config from localStorage
 * and provides print/drawer/PAX/scale methods.
 *
 * Priority:
 *   1. Electron (window.electronAPI) — desktop app, direct USB/network access
 *   2. Network TCP                   — browser → backend proxy → printer
 *   3. QZ Tray                       — browser → QZ bridge → USB printer
 */

import { useState, useCallback, useEffect } from 'react';
import { useStationStore } from '../stores/useStationStore.js';
import { buildReceiptString, printReceiptNetwork, kickCashDrawer } from '../services/printerService.js';
import { connectQZ, isQZConnected, printRaw } from '../services/qzService.js';
import { useScale } from './useScale.js';
import * as posApi from '../api/pos.js';

const HW_STORAGE_KEY = 'storv_hardware_config';

/** true when running inside the Electron desktop wrapper */
export const isElectron = () => !!(window.electronAPI?.isElectron);

export const loadHardwareConfig = () => {
  try {
    const raw = localStorage.getItem(HW_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
};

export const saveHardwareConfigLocally = (config) => {
  localStorage.setItem(HW_STORAGE_KEY, JSON.stringify(config));
};

export function useHardware({ onBarcode } = {}) {
  const station = useStationStore(s => s.station);
  const hw      = loadHardwareConfig();

  const [printing,  setPrinting]  = useState(false);
  const [payStatus, setPayStatus] = useState(null);
  const [payResult, setPayResult] = useState(null);

  // ── Scale / Magellan ──────────────────────────────────────────────────────
  const scale = useScale({ onBarcode });

  useEffect(() => {
    if (!hw?.scale || hw.scale.type === 'none') return;
    scale.getGrantedPorts().then(ports => {
      if (ports.length > 0) {
        scale.connectToPort(ports[0].port, hw.scale.baud || 9600, ports[0].label);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Print receipt ─────────────────────────────────────────────────────────
  const printReceipt = useCallback(async (receiptData) => {
    if (!hw?.receiptPrinter || hw.receiptPrinter.type === 'none') return;
    setPrinting(true);
    try {
      const escpos = buildReceiptString(receiptData);

      // ── Path 1: Electron desktop app ──────────────────────────────────────
      if (isElectron()) {
        if (hw.receiptPrinter.type === 'network') {
          await window.electronAPI.printNetwork(
            hw.receiptPrinter.ip,
            hw.receiptPrinter.port || 9100,
            escpos,
          );
        } else {
          // USB printer — direct Windows winspool raw print
          await window.electronAPI.printUSB(hw.receiptPrinter.name, escpos);
        }
        return;
      }

      // ── Path 2: Network printer via backend TCP proxy ─────────────────────
      if (hw.receiptPrinter.type === 'network') {
        await printReceiptNetwork(hw.receiptPrinter.ip, hw.receiptPrinter.port, receiptData);
        return;
      }

      // ── Path 3: USB via QZ Tray ───────────────────────────────────────────
      if (!isQZConnected()) await connectQZ();
      await printRaw(hw.receiptPrinter.name, [escpos]);

    } catch (err) {
      console.warn('Print failed:', err.message);
    } finally {
      setPrinting(false);
    }
  }, [hw]);

  // ── Open cash drawer ──────────────────────────────────────────────────────
  const openDrawer = useCallback(async () => {
    if (!hw?.cashDrawer || hw.cashDrawer.type === 'none') return;
    try {
      // ── Electron ──────────────────────────────────────────────────────────
      if (isElectron()) {
        if (hw.receiptPrinter?.type === 'network') {
          await window.electronAPI.openDrawerNetwork(
            hw.receiptPrinter.ip,
            hw.receiptPrinter.port || 9100,
          );
        } else if (hw.receiptPrinter?.name) {
          await window.electronAPI.openDrawerUSB(hw.receiptPrinter.name);
        }
        return;
      }

      // ── QZ Tray ───────────────────────────────────────────────────────────
      if (hw.cashDrawer.type === 'printer' && hw.receiptPrinter?.name) {
        await kickCashDrawer(hw.receiptPrinter.name);
      }
    } catch (err) {
      console.warn('Drawer kick failed:', err.message);
    }
  }, [hw]);

  // ── List system printers (Electron only) ──────────────────────────────────
  const listSystemPrinters = useCallback(async () => {
    if (isElectron()) return window.electronAPI.listPrinters();
    return [];
  }, []);

  // ── PAX card payment ──────────────────────────────────────────────────────
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

  const hasPAX            = !!(hw?.paxTerminal?.enabled && hw?.paxTerminal?.ip);
  const hasReceiptPrinter = !!(hw?.receiptPrinter?.type && hw.receiptPrinter.type !== 'none');
  const hasCashDrawer     = !!(hw?.cashDrawer?.type && hw.cashDrawer.type !== 'none');
  const hasScale          = !!(hw?.scale?.type && hw.scale.type !== 'none');
  const hasLabelPrinter   = !!(hw?.labelPrinter?.type && hw.labelPrinter.type !== 'none');

  return {
    hw,
    printing, payStatus, payResult,
    printReceipt, openDrawer,
    listSystemPrinters,
    processCardPayment, cancelPayment,
    hasPAX, hasReceiptPrinter, hasCashDrawer, hasScale, hasLabelPrinter,
    scale,
    isElectron: isElectron(),
  };
}
