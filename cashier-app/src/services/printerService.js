/**
 * printerService.js
 * ESC/POS receipt building and printing.
 * Supports QZ Tray (USB/Serial) and Network TCP (via backend proxy).
 */

import { connectQZ, printRaw, isQZConnected } from './qzService.js';
import api from '../api/client.js';

// ── ESC/POS command constants ─────────────────────────────────────────────
const ESC = '\x1B';
const GS  = '\x1D';
const LF  = '\x0A';
const NUL = '\x00';

export const ESCPOS = {
  INIT:           ESC + '\x40',
  CUT_FULL:       GS  + '\x56' + NUL,
  CUT_PARTIAL:    GS  + '\x56' + '\x01',
  ALIGN_LEFT:     ESC + '\x61\x00',
  ALIGN_CENTER:   ESC + '\x61\x01',
  ALIGN_RIGHT:    ESC + '\x61\x02',
  BOLD_ON:        ESC + '\x45\x01',
  BOLD_OFF:       ESC + '\x45\x00',
  DOUBLE_SIZE:    ESC + '\x21\x30',
  NORMAL_SIZE:    ESC + '\x21\x00',
  UNDERLINE_ON:   ESC + '\x2D\x01',
  UNDERLINE_OFF:  ESC + '\x2D\x00',
  DRAWER_KICK:    ESC + '\x70\x00\x19\xFA',
  FEED_3:         ESC + '\x64\x03',
};

const pad  = (str, len) => String(str || '').substring(0, len).padEnd(len);
const rpad = (str, len) => String(str || '').substring(0, len).padStart(len);
const line = (left, right, width = 42) => {
  const r = String(right || '');
  const l = String(left  || '').substring(0, width - r.length).padEnd(width - r.length);
  return l + r + LF;
};

// ── Build full receipt string ────────────────────────────────────────────
export const buildReceiptString = (receipt) => {
  const W = 42; // characters wide (58mm paper = 32 chars, 80mm = 42 chars)
  let r = '';

  r += ESCPOS.INIT;
  r += ESCPOS.ALIGN_CENTER;

  // Store name
  r += ESCPOS.DOUBLE_SIZE + ESCPOS.BOLD_ON;
  r += (receipt.storeName || 'STORE') + LF;
  r += ESCPOS.NORMAL_SIZE + ESCPOS.BOLD_OFF;

  if (receipt.storeAddress) r += receipt.storeAddress + LF;
  if (receipt.storePhone)   r += receipt.storePhone   + LF;
  if (receipt.storeTaxId)   r += 'GST/HST #: ' + receipt.storeTaxId + LF;

  r += LF;
  r += ESCPOS.ALIGN_LEFT;
  r += '-'.repeat(W) + LF;

  // Cashier + date
  r += 'Cashier: ' + (receipt.cashierName || 'Cashier') + LF;
  r += 'Date: ' + new Date(receipt.date || Date.now()).toLocaleString() + LF;
  if (receipt.invoiceNumber) r += 'Ref: ' + receipt.invoiceNumber + LF;
  r += '-'.repeat(W) + LF;

  // Line items
  (receipt.items || []).forEach(item => {
    const isLottery = item.isLottery;
    const prefix    = isLottery ? (item.lotteryType === 'payout' ? '💰 ' : '🎟️ ') : '';
    const name      = prefix + (item.name || 'Item');
    const price     = (item.lineTotal < 0 ? '-' : '') + '$' + Math.abs(item.lineTotal || 0).toFixed(2);

    if (item.qty && item.qty !== 1 && !isLottery) {
      r += name.substring(0, W) + LF;
      r += line('  ' + item.qty + ' × $' + Number(item.unitPrice || 0).toFixed(2), price, W);
    } else {
      r += line(name.substring(0, W - 10), price, W);
    }

    if (item.discountAmount) {
      r += line('  Discount', '-$' + Math.abs(item.discountAmount).toFixed(2), W);
    }
  });

  r += '-'.repeat(W) + LF;

  // Subtotal, tax, deposits, total
  if (receipt.subtotal  != null) r += line('Subtotal',    '$' + Number(receipt.subtotal).toFixed(2),    W);
  if (receipt.totalTax  != null) r += line('Tax',         '$' + Number(receipt.totalTax).toFixed(2),    W);
  if (receipt.totalDeposit > 0)  r += line('Deposit/CRV', '$' + Number(receipt.totalDeposit).toFixed(2), W);
  if (receipt.discount  > 0)     r += line('Savings',     '-$' + Number(receipt.discount).toFixed(2),   W);

  r += ESCPOS.BOLD_ON;
  r += line('TOTAL', '$' + Number(receipt.total || 0).toFixed(2), W);
  r += ESCPOS.BOLD_OFF;
  r += '-'.repeat(W) + LF;

  // Tender
  if (receipt.tenderMethod) {
    const methodLabel = receipt.tenderMethod.toUpperCase();
    r += line(methodLabel, '$' + Number(receipt.amountTendered || receipt.total || 0).toFixed(2), W);
    if (receipt.changeDue > 0) r += line('CHANGE', '$' + Number(receipt.changeDue).toFixed(2), W);
    if (receipt.authCode) r += line('Auth Code', receipt.authCode, W);
    if (receipt.cardType) r += line('Card', (receipt.cardType) + ' ****' + (receipt.lastFour || ''), W);
  }

  r += '-'.repeat(W) + LF;

  // Footer
  r += ESCPOS.ALIGN_CENTER;
  r += (receipt.footerMessage || 'Thank you! Please come again.') + LF;

  if (receipt.loyaltyPoints != null) {
    r += ESCPOS.BOLD_ON;
    r += '★ Points Earned: ' + receipt.loyaltyPoints + LF;
    r += 'Total Points: ' + (receipt.totalPoints || 0) + LF;
    r += ESCPOS.BOLD_OFF;
  }

  r += ESCPOS.FEED_3;
  r += ESCPOS.CUT_PARTIAL;

  return r;
};

// ── Kick cash drawer ────────────────────────────────────────────────────
export const kickCashDrawer = async (printerName, method = 'qz') => {
  if (method === 'qz' && printerName) {
    await printRaw(printerName, [ESCPOS.DRAWER_KICK]);
  }
};

// ── Print receipt via QZ Tray ────────────────────────────────────────────
export const printReceiptQZ = async (printerName, receipt) => {
  if (!isQZConnected()) await connectQZ();
  const data = buildReceiptString(receipt);
  await printRaw(printerName, [data]);
};

// ── Print receipt via network (backend proxy) ────────────────────────────
export const printReceiptNetwork = async (ip, port, receipt) => {
  const data = buildReceiptString(receipt);
  // Send as base64 to backend which forwards to printer TCP socket
  await api.post('/pos-terminal/print-network', {
    ip, port,
    data: btoa(unescape(encodeURIComponent(data))),
  });
};

// ── Build ZPL shelf label ────────────────────────────────────────────────
export const buildShelfLabelZPL = ({ productName = '', price = '0.00', upc = '', size = '' }) => `
^XA
^CF0,30
^FO20,15^FD${productName.substring(0, 22)}^FS
^CF0,22
^FO20,55^FD${size}^FS
^CF0,50
^FO20,80^FD$${price}^FS
^BY2,3,60
^FO20,150^BCN,,Y,N,N^FD${upc}^FS
^XZ
`.trim();

// ── Print ZPL label via QZ ────────────────────────────────────────────────
export const printLabelQZ = async (printerName, zplString) => {
  const { printZPL } = await import('./qzService.js');
  if (!isQZConnected()) await connectQZ();
  await printZPL(printerName, zplString);
};

// ── Test print receipt ────────────────────────────────────────────────────
export const printTestReceipt = async (printerName, method = 'qz', ip, port) => {
  const testReceipt = {
    storeName:    'TEST PRINT',
    storeAddress: '123 Main St',
    cashierName:  'Setup Wizard',
    date:         Date.now(),
    items: [
      { name: 'Test Item 1', qty: 2, unitPrice: 5.00, lineTotal: 10.00 },
      { name: 'Test Item 2', qty: 1, unitPrice: 3.50, lineTotal: 3.50 },
    ],
    subtotal: 13.50, totalTax: 1.76, total: 15.26,
    tenderMethod: 'CASH', amountTendered: 20.00, changeDue: 4.74,
    footerMessage: '✓ Receipt printer is working correctly!',
  };
  if (method === 'network') {
    await printReceiptNetwork(ip, port, testReceipt);
  } else {
    await printReceiptQZ(printerName, testReceipt);
  }
};
