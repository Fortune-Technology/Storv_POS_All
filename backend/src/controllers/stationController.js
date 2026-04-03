/**
 * Station Controller
 * Handles POS terminal registration, PIN-based cashier login, and PIN management.
 */

import jwt     from 'jsonwebtoken';
import bcrypt  from 'bcryptjs';
import prisma  from '../config/postgres.js';
import { nanoid } from 'nanoid';

const generateCashierToken = (id, extra = {}) =>
  jwt.sign({ id, ...extra }, process.env.JWT_SECRET, { expiresIn: '12h' });

// ── POST /api/pos-terminal/station-register ───────────────────────────────
// Requires: Bearer token (manager / owner / admin)
// Creates a new station record and returns a long-lived station token.
export const registerStation = async (req, res) => {
  try {
    const { storeId, name } = req.body;
    if (!storeId || !name) {
      return res.status(400).json({ error: 'storeId and name are required' });
    }

    const orgId = req.orgId || req.user?.orgId;

    // Verify store belongs to this org
    const store = await prisma.store.findFirst({ where: { id: storeId, orgId } });
    if (!store) return res.status(404).json({ error: 'Store not found' });

    // Generate a unique, opaque station token
    const token = `stn_${nanoid(40)}`;

    const station = await prisma.station.create({
      data: { orgId, storeId, name: name.trim(), token, lastSeenAt: new Date() },
    });

    res.status(201).json({
      stationId:    station.id,
      stationToken: station.token,
      stationName:  station.name,
      storeId:      store.id,
      storeName:    store.name,
      orgId,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── GET /api/pos-terminal/station-verify ─────────────────────────────────
// Requires: X-Station-Token header
// Used by POS on boot to confirm its token is still valid and get store info.
export const verifyStation = async (req, res) => {
  try {
    const stationToken = req.headers['x-station-token'];
    if (!stationToken) return res.status(401).json({ error: 'Station token required' });

    const station = await prisma.station.findUnique({
      where: { token: stationToken },
    });
    if (!station) return res.status(401).json({ error: 'Invalid station token' });

    const store = await prisma.store.findFirst({
      where:  { id: station.storeId, orgId: station.orgId },
      select: { name: true, branding: true },
    });

    await prisma.station.update({
      where: { id: station.id },
      data:  { lastSeenAt: new Date() },
    });

    res.json({
      stationId:    station.id,
      stationName:  station.name,
      storeId:      station.storeId,
      storeName:    store?.name,
      orgId:        station.orgId,
      branding:     store?.branding || {},
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── POST /api/pos-terminal/pin-login ─────────────────────────────────────
// Requires: X-Station-Token header   Body: { pin }
// Finds the cashier whose hashed PIN matches within this org, returns JWT.
export const pinLogin = async (req, res) => {
  try {
    const stationToken = req.headers['x-station-token'];
    const { pin } = req.body;

    if (!stationToken) return res.status(401).json({ error: 'Station token required' });
    if (!pin)          return res.status(400).json({ error: 'PIN required' });
    if (!/^\d{4,6}$/.test(pin)) return res.status(400).json({ error: 'PIN must be 4–6 digits' });

    const station = await prisma.station.findUnique({ where: { token: stationToken } });
    if (!station) return res.status(401).json({ error: 'Invalid station token' });

    await prisma.station.update({
      where: { id: station.id },
      data:  { lastSeenAt: new Date() },
    });

    // Load all org users that have a PIN set
    const candidates = await prisma.user.findMany({
      where:  { orgId: station.orgId, posPin: { not: null } },
      select: { id: true, name: true, email: true, role: true, orgId: true, posPin: true },
    });

    // Find the one whose hash matches (bcrypt.compare is sync-safe for ~30 users)
    const matched = candidates.find(u => u.posPin && bcrypt.compareSync(pin, u.posPin));
    if (!matched) {
      return res.status(401).json({ error: 'Invalid PIN' });
    }

    const token = generateCashierToken(matched.id, {
      name:  matched.name,
      email: matched.email,
      role:  matched.role,
      orgId: matched.orgId,
    });

    res.json({
      id:          matched.id,
      name:        matched.name,
      email:       matched.email,
      role:        matched.role,
      orgId:       matched.orgId,
      storeId:     station.storeId,
      stationId:   station.id,
      stationName: station.name,
      token,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── PUT /api/users/:id/pin ────────────────────────────────────────────────
// Set or update a cashier's POS PIN. Manager / owner / admin only.
export const setCashierPin = async (req, res) => {
  try {
    const { pin } = req.body;
    const userId  = req.params.id;
    const orgId   = req.orgId || req.user?.orgId;

    if (!pin) return res.status(400).json({ error: 'PIN required' });
    if (!/^\d{4,6}$/.test(pin)) return res.status(400).json({ error: 'PIN must be 4–6 digits' });

    const target = await prisma.user.findFirst({ where: { id: userId, orgId } });
    if (!target) return res.status(404).json({ error: 'User not found' });

    const hashed = await bcrypt.hash(pin, 10);
    await prisma.user.update({ where: { id: userId }, data: { posPin: hashed } });

    res.json({ message: 'PIN updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── DELETE /api/users/:id/pin ─────────────────────────────────────────────
// Remove a cashier's POS PIN.
export const removeCashierPin = async (req, res) => {
  try {
    const userId = req.params.id;
    const orgId  = req.orgId || req.user?.orgId;

    const target = await prisma.user.findFirst({ where: { id: userId, orgId } });
    if (!target) return res.status(404).json({ error: 'User not found' });

    await prisma.user.update({ where: { id: userId }, data: { posPin: null } });
    res.json({ message: 'PIN removed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
