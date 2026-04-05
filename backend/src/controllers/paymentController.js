/**
 * paymentController.js
 * Proxies PAX POSLINK requests from the cashier app to the PAX terminal.
 * The PAX terminal sits on the store LAN. The backend acts as the proxy
 * so the cashier app doesn't need direct access to the terminal IP.
 */

import axios from 'axios';
import prisma from '../config/postgres.js';

const getOrgId  = (req) => req.orgId  || req.user?.orgId;
const getStore  = (req) => req.headers['x-store-id'] || req.storeId || req.query.storeId;

// Convert dollar amount to cents string, zero-padded to 12 chars
const toCents = (amount) => Math.round(Number(amount) * 100).toString().padStart(12, '0');

// Build POSLINK query string
const buildPOSLINK = (params) =>
  Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

// Parse PAX pipe-delimited response
const parsePAXResponse = (raw) => {
  if (!raw) return { status: 'Error', message: 'No response from terminal' };
  const parts = String(raw).split('|');
  return {
    status:      parts[0] || 'Error',      // 'OK' or 'Error'
    resultCode:  parts[1] || '',            // '000000' = approved
    message:     parts[2] || '',            // 'APPROVED' / 'DECLINED'
    authCode:    parts[3] || '',
    refNum:      parts[4] || '',
    cardType:    parts[5] || '',            // VISA / MC / AMEX / DEBIT
    lastFour:    parts[6] || '',
    entryMode:   parts[7] || '',            // CHIP / SWIPE / CONTACTLESS
    hostCode:    parts[8] || '',
  };
};

// Get PAX terminal URL from station config
const getPAXUrl = async (stationId, storeId) => {
  const station = await prisma.station.findFirst({
    where: { id: stationId, storeId },
  });
  if (!station?.hardwareConfig) return null;
  const hw = typeof station.hardwareConfig === 'string'
    ? JSON.parse(station.hardwareConfig)
    : station.hardwareConfig;
  const pax = hw?.paxTerminal;
  if (!pax?.enabled || !pax?.ip) return null;
  return `http://${pax.ip}:${pax.port || 10009}`;
};

// ── SALE ───────────────────────────────────────────────────────────────────
export const paxSale = async (req, res) => {
  try {
    const { amount, invoiceNumber, stationId, edcType = '02' } = req.body;
    const storeId = getStore(req);
    if (!amount || !stationId) return res.status(400).json({ success: false, error: 'amount and stationId required' });

    const paxUrl = await getPAXUrl(stationId, storeId);
    if (!paxUrl) return res.status(400).json({ success: false, error: 'PAX terminal not configured for this station' });

    const qs = buildPOSLINK({
      EDCType:       edcType,   // 01=Credit, 02=Debit, 07=EBT Food, 08=EBT Cash
      TransType:     '01',      // Sale
      Amount:        toCents(amount),
      InvoiceNumber: invoiceNumber || Date.now().toString(),
      ECRRefNum:     stationId,
      Timeout:       '90',
    });

    const response = await axios.post(`${paxUrl}/api/pos`, qs, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 120000,
    });

    const parsed = parsePAXResponse(response.data);
    const approved = parsed.resultCode === '000000' || parsed.status === 'OK';

    res.json({ success: approved, approved, data: parsed });
  } catch (err) {
    if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
      return res.status(503).json({ success: false, error: 'Cannot reach PAX terminal. Check IP and network connection.' });
    }
    res.status(500).json({ success: false, error: err.message });
  }
};

// ── VOID ──────────────────────────────────────────────────────────────────
export const paxVoid = async (req, res) => {
  try {
    const { origRefNum, invoiceNumber, stationId } = req.body;
    const storeId = getStore(req);

    const paxUrl = await getPAXUrl(stationId, storeId);
    if (!paxUrl) return res.status(400).json({ success: false, error: 'PAX terminal not configured' });

    const qs = buildPOSLINK({
      EDCType:       '01',
      TransType:     '04',      // Void
      OrigRefNum:    origRefNum || '',
      InvoiceNumber: invoiceNumber || '',
      ECRRefNum:     stationId,
      Timeout:       '60',
    });

    const response = await axios.post(`${paxUrl}/api/pos`, qs, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 90000,
    });

    const parsed = parsePAXResponse(response.data);
    res.json({ success: parsed.resultCode === '000000', data: parsed });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ── REFUND ────────────────────────────────────────────────────────────────
export const paxRefund = async (req, res) => {
  try {
    const { amount, invoiceNumber, stationId } = req.body;
    const storeId = getStore(req);

    const paxUrl = await getPAXUrl(stationId, storeId);
    if (!paxUrl) return res.status(400).json({ success: false, error: 'PAX terminal not configured' });

    const qs = buildPOSLINK({
      EDCType:       '01',
      TransType:     '02',      // Return/Refund
      Amount:        toCents(amount),
      InvoiceNumber: invoiceNumber || '',
      ECRRefNum:     stationId,
      Timeout:       '90',
    });

    const response = await axios.post(`${paxUrl}/api/pos`, qs, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 120000,
    });

    const parsed = parsePAXResponse(response.data);
    res.json({ success: parsed.resultCode === '000000', data: parsed });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ── TEST CONNECTION ────────────────────────────────────────────────────────
export const paxTest = async (req, res) => {
  try {
    const { ip, port = 10009 } = req.body;
    if (!ip) return res.status(400).json({ success: false, error: 'IP required' });

    const qs = buildPOSLINK({ EDCType: '01', TransType: '00', Timeout: '10' }); // batch inquiry / status
    const response = await axios.post(`http://${ip}:${port}/api/pos`, qs, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15000,
    });

    res.json({ success: true, message: 'PAX terminal reachable', raw: response.data });
  } catch (err) {
    if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT' || err.code === 'ENOTFOUND') {
      return res.json({ success: false, error: `Cannot reach PAX at ${req.body.ip}:${req.body.port || 10009}. Check IP address and ensure terminal is on the same network.` });
    }
    res.json({ success: false, error: err.message });
  }
};

// ── SAVE HARDWARE CONFIG ──────────────────────────────────────────────────
export const saveHardwareConfig = async (req, res) => {
  try {
    const storeId = getStore(req);
    const { stationId, hardwareConfig } = req.body;
    if (!stationId || !hardwareConfig) return res.status(400).json({ success: false, error: 'stationId and hardwareConfig required' });

    const station = await prisma.station.updateMany({
      where: { id: stationId, storeId },
      data:  { hardwareConfig: hardwareConfig },
    });
    res.json({ success: true, data: station });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ── GET HARDWARE CONFIG ──────────────────────────────────────────────────
export const getHardwareConfig = async (req, res) => {
  try {
    const storeId   = getStore(req);
    const stationId = req.params.stationId || req.query.stationId;
    const station   = await prisma.station.findFirst({ where: { id: stationId, storeId } });
    if (!station) return res.status(404).json({ success: false, error: 'Station not found' });

    const hw = station.hardwareConfig
      ? (typeof station.hardwareConfig === 'string' ? JSON.parse(station.hardwareConfig) : station.hardwareConfig)
      : null;

    res.json({ success: true, data: hw });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};
