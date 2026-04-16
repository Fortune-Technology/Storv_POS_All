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
import { buildReceiptString, printReceiptNetwork, kickCashDrawer, buildShelfLabelZPL, printLabelQZ } from '../services/printerService.js';
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

    if (hw.scale.connection === 'tcp' && hw.scale.ip) {
      // TCP mode: connect via Electron IPC
      scale.connectTCP(hw.scale.ip, hw.scale.port || 4001).catch(() => {});
    } else if (hw.scale.connection === 'serial-native' && hw.scale.comPort) {
      // Native COM port: connect via Electron serialport
      scale.connectSerial(hw.scale.comPort, hw.scale.baud || 9600).catch(() => {});
    } else {
      // USB Serial mode: auto-connect to first granted port
      scale.getGrantedPorts().then(ports => {
        if (ports.length > 0) {
          scale.connectToPort(ports[0].port, hw.scale.baud || 9600, ports[0].label);
        }
      });
    }
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
        // printerType ('epson' | 'star') determines the drawer kick command.
        // Configured in Station Setup → Hardware → Printer Type.
        const pType = hw.receiptPrinter?.printerType || 'epson';
        if (hw.receiptPrinter?.type === 'network') {
          await window.electronAPI.openDrawerNetwork(
            hw.receiptPrinter.ip,
            hw.receiptPrinter.port || 9100,
            pType,
          );
        } else if (hw.receiptPrinter?.name) {
          await window.electronAPI.openDrawerUSB(hw.receiptPrinter.name, pType);
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

  // ── Print shelf label ────────────────────────────────────────────────────
  // Takes a product-like object and prints a shelf label via the configured label printer.
  const printShelfLabel = useCallback(async (product) => {
    const lp = hw?.labelPrinter;
    if (!lp || lp.type === 'none') {
      throw new Error('No label printer configured');
    }

    const zpl = buildShelfLabelZPL({
      productName: product.name || product.description || '',
      price:       product.defaultRetailPrice != null ? Number(product.defaultRetailPrice).toFixed(2) : (product.price != null ? Number(product.price).toFixed(2) : '0.00'),
      upc:         product.upc || '',
      size:        [product.size, product.sizeUnit].filter(Boolean).join(' '),
    });

    try {
      // Path 1: Electron direct (network printer)
      if (isElectron() && lp.type === 'zebra_network' && lp.ip) {
        await window.electronAPI.printNetwork(lp.ip, lp.port || 9100, zpl);
        return { success: true };
      }
      // Path 2: QZ Tray (USB Zebra)
      if (lp.type === 'zebra_usb' && lp.name) {
        await printLabelQZ(lp.name, zpl);
        return { success: true };
      }
      // Path 3: Electron USB (fallback)
      if (isElectron() && lp.name) {
        await window.electronAPI.printUSB(lp.name, zpl);
        return { success: true };
      }
      throw new Error('Label printer configuration is incomplete');
    } catch (err) {
      console.warn('[printShelfLabel]', err.message);
      throw err;
    }
  }, [hw]);

  // ── CardPointe terminal payment ───────────────────────────────────────────
  //
  // Full flow:
  //   1. cpCharge  → terminal prompts customer (tap/swipe/insert)
  //   2. If amount > signatureThreshold → cpSignature (terminal signature pad)
  //   3. Returns { approved, retref, lastFour, acctType, entryMode, authCode,
  //                signatureCaptured, paymentTransactionId }
  //
  // The backend handles connect/disconnect/terminal-api calls — the cashier app
  // just initiates with a single HTTP POST and waits (up to 90 s).

  const processCardPayment = useCallback(async ({
    amount,
    invoiceNumber,
    terminalId,         // PaymentTerminal.id (required for CardPointe)
    storeId,
    signatureThreshold, // dollar amount above which to request signature
  }) => {
    // ── CardPointe path ────────────────────────────────────────────────────
    if (terminalId) {
      setPayStatus('waiting');
      setPayResult(null);
      try {
        const needsSig = signatureThreshold != null && Number(amount) >= Number(signatureThreshold);
        const result = await posApi.cpCharge({
          terminalId,
          amount,
          invoiceNumber: invoiceNumber || undefined,
          captureSignature: needsSig,
        });

        if (result.approved) {
          setPayStatus('approved');
          setPayResult(result);
        } else {
          setPayStatus('declined');
          setPayResult(result);
        }
        return result;
      } catch (err) {
        setPayStatus('error');
        setPayResult({ message: err.message });
        throw err;
      }
    }

    // ── Legacy PAX fallback ────────────────────────────────────────────────
    if (!hw?.paxTerminal?.enabled) {
      throw new Error('No payment terminal configured for this station.');
    }
    setPayStatus('waiting');
    setPayResult(null);
    try {
      const result = await posApi.paxSale({
        amount, invoiceNumber,
        edcType:   '02', // debit default
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

  const cancelPayment = useCallback(async (terminalId) => {
    setPayStatus(null);
    setPayResult(null);
    // Cancel the pending terminal operation if we have a terminalId
    if (terminalId) {
      posApi.cpCancel({ terminalId }).catch(() => {});
    }
  }, []);

  const hasPAX            = !!(hw?.paxTerminal?.enabled && hw?.paxTerminal?.ip);
  const hasReceiptPrinter = !!(hw?.receiptPrinter?.type && hw.receiptPrinter.type !== 'none');
  const hasCashDrawer     = !!(hw?.cashDrawer?.type && hw.cashDrawer.type !== 'none');
  const hasScale          = !!(hw?.scale?.type && hw.scale.type !== 'none');
  const hasLabelPrinter   = !!(hw?.labelPrinter?.type && hw.labelPrinter.type !== 'none');

  return {
    hw,
    printing, payStatus, payResult,
    printReceipt, openDrawer, printShelfLabel,
    listSystemPrinters,
    processCardPayment, cancelPayment,
    hasPAX, hasReceiptPrinter, hasCashDrawer, hasScale, hasLabelPrinter,
    scale,
    isElectron: isElectron(),
  };
}
