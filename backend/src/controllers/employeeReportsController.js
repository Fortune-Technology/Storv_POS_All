/**
 * Employee Reports Controller
 * Provides clock-in/out history, hours worked, and sales per employee.
 * Also provides CRUD for manual clock event management (back-office).
 * Used by the back-office portal.
 */

import prisma from '../config/postgres.js';

// ── Date helpers ──────────────────────────────────────────────────────────
// Parse a YYYY-MM-DD string as start/end of the UTC day.
// Using explicit 'T00:00:00.000Z' / 'T23:59:59.999Z' ensures that regardless
// of server timezone, the range covers the full calendar day.
function parseFromDate(str) {
  return str ? new Date(str + 'T00:00:00.000Z') : (() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 7);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  })();
}
function parseToDate(str) {
  return str ? new Date(str + 'T23:59:59.999Z') : (() => {
    const d = new Date();
    d.setUTCHours(23, 59, 59, 999);
    return d;
  })();
}

// ── GET /api/reports/employees ────────────────────────────────────────────
// Query params: storeId, from (YYYY-MM-DD), to (YYYY-MM-DD)
export const getEmployeeReport = async (req, res) => {
  try {
    const orgId   = req.orgId || req.user?.orgId;
    const { storeId, from, to } = req.query;

    const fromDate   = parseFromDate(from);
    const toDate     = parseToDate(to);
    const where      = { orgId, ...(storeId && { storeId }) };
    const dateFilter = { gte: fromDate, lte: toDate };

    const [clockEvents, transactions, users] = await Promise.all([
      prisma.clockEvent.findMany({
        where: { ...where, createdAt: dateFilter },
        orderBy: { createdAt: 'asc' },
        select: { userId: true, type: true, createdAt: true, storeId: true },
      }),
      prisma.transaction.findMany({
        where: { ...where, createdAt: dateFilter, status: { not: 'voided' } },
        select: { cashierId: true, grandTotal: true, status: true, createdAt: true },
      }),
      prisma.user.findMany({
        where: { orgId },
        select: { id: true, name: true, email: true, role: true },
      }),
    ]);

    const userMap = Object.fromEntries(users.map(u => [u.id, u]));

    // Build per-employee stats
    const employees = {};

    // Clock events → pair in/out → calculate hours
    const eventsByUser = {};
    clockEvents.forEach(e => {
      if (!eventsByUser[e.userId]) eventsByUser[e.userId] = [];
      eventsByUser[e.userId].push(e);
    });

    Object.entries(eventsByUser).forEach(([userId, events]) => {
      if (!employees[userId]) {
        const u = userMap[userId] || { name: 'Unknown', email: '', role: 'cashier' };
        employees[userId] = { userId, name: u.name, email: u.email, role: u.role, totalMinutes: 0, sessions: [], transactions: 0, totalSales: 0, clockEvents: [] };
      }

      employees[userId].clockEvents = events.map(e => ({ type: e.type, createdAt: e.createdAt }));

      let lastIn = null;
      events.forEach(e => {
        if (e.type === 'in') {
          lastIn = e.createdAt;
        } else if (e.type === 'out' && lastIn) {
          const minutes = Math.round((new Date(e.createdAt) - new Date(lastIn)) / 60000);
          employees[userId].totalMinutes += minutes;
          employees[userId].sessions.push({ in: lastIn, out: e.createdAt, minutes });
          lastIn = null;
        }
      });
      // Still clocked in (active session)
      if (lastIn) {
        const minutes = Math.round((Date.now() - new Date(lastIn)) / 60000);
        employees[userId].totalMinutes += minutes;
        employees[userId].sessions.push({ in: lastIn, out: null, minutes, active: true });
      }
    });

    // Transaction stats per cashier
    transactions.forEach(tx => {
      const cid = tx.cashierId;
      if (!employees[cid]) {
        const u = userMap[cid] || { name: 'Unknown', email: '', role: 'cashier' };
        employees[cid] = { userId: cid, name: u.name, email: u.email, role: u.role, totalMinutes: 0, sessions: [], transactions: 0, totalSales: 0, clockEvents: [] };
      }
      if (tx.status !== 'refund') {
        employees[cid].transactions++;
        employees[cid].totalSales += Number(tx.grandTotal);
      }
    });

    const result = Object.values(employees).map(emp => ({
      ...emp,
      totalSales:  Math.round(emp.totalSales * 100) / 100,
      hoursWorked: Math.round(emp.totalMinutes / 6) / 10,
    })).sort((a, b) => b.totalSales - a.totalSales);

    res.json({ from: fromDate.toISOString(), to: toDate.toISOString(), employees: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── GET /api/reports/clock-events ─────────────────────────────────────────
// Returns raw clock events (with IDs) for back-office management.
// Query params: storeId, userId, from, to
export const listClockEvents = async (req, res) => {
  try {
    const orgId = req.orgId || req.user?.orgId;
    const { storeId, userId, from, to } = req.query;

    const fromDate = parseFromDate(from);
    const toDate   = parseToDate(to);

    const events = await prisma.clockEvent.findMany({
      where: {
        orgId,
        ...(storeId && { storeId }),
        ...(userId  && { userId }),
        createdAt: { gte: fromDate, lte: toDate },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Attach user info
    const userIds = [...new Set(events.map(e => e.userId))];
    const users = userIds.length
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true, role: true },
        })
      : [];
    const userMap = Object.fromEntries(users.map(u => [u.id, u]));

    const result = events.map(e => ({
      ...e,
      userName:  userMap[e.userId]?.name  || 'Unknown',
      userEmail: userMap[e.userId]?.email || '',
      userRole:  userMap[e.userId]?.role  || '',
    }));

    res.json({ events: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── GET /api/reports/employees/list ──────────────────────────────────────
// Returns all employees (users) for the org — used for dropdowns.
export const listStoreEmployees = async (req, res) => {
  try {
    const orgId = req.orgId || req.user?.orgId;
    const users = await prisma.user.findMany({
      where: { orgId, posPin: { not: null } }, // only PIN-enabled users (cashier-app users)
      select: { id: true, name: true, email: true, role: true },
      orderBy: { name: 'asc' },
    });
    res.json({ employees: users });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── POST /api/reports/clock-events ───────────────────────────────────────
// Manually create a clock event. Pass inTime + optional outTime to create a full session.
// Body: { userId, storeId, inTime, outTime? }
export const createClockSession = async (req, res) => {
  try {
    const orgId = req.orgId || req.user?.orgId;
    const { userId, storeId, inTime, outTime, note } = req.body;

    if (!userId)  return res.status(400).json({ error: 'userId is required' });
    if (!inTime)  return res.status(400).json({ error: 'inTime is required' });

    const effectiveStoreId = storeId || req.storeId;

    // Create clock-in event
    const inEvent = await prisma.clockEvent.create({
      data: {
        orgId,
        storeId: effectiveStoreId,
        userId,
        type:      'in',
        createdAt: new Date(inTime),
        note:      note || null,
      },
    });

    let outEvent = null;
    if (outTime) {
      outEvent = await prisma.clockEvent.create({
        data: {
          orgId,
          storeId: effectiveStoreId,
          userId,
          type:      'out',
          createdAt: new Date(outTime),
          note:      note || null,
        },
      });
    }

    res.status(201).json({ inEvent, outEvent });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── PUT /api/reports/clock-events/:id ────────────────────────────────────
// Update the timestamp (and optionally type/note) of a single clock event.
// Body: { timestamp, type?, note? }
export const updateClockEvent = async (req, res) => {
  try {
    const orgId = req.orgId || req.user?.orgId;
    const { id } = req.params;
    const { timestamp, type, note } = req.body;

    const existing = await prisma.clockEvent.findFirst({ where: { id, orgId } });
    if (!existing) return res.status(404).json({ error: 'Clock event not found' });

    const updated = await prisma.clockEvent.update({
      where: { id },
      data: {
        ...(timestamp !== undefined && { createdAt: new Date(timestamp) }),
        ...(type      !== undefined && { type }),
        ...(note      !== undefined && { note }),
      },
    });

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── DELETE /api/reports/clock-events/:id ─────────────────────────────────
// Delete a single clock event by ID.
export const deleteClockEvent = async (req, res) => {
  try {
    const orgId = req.orgId || req.user?.orgId;
    const { id } = req.params;

    const existing = await prisma.clockEvent.findFirst({ where: { id, orgId } });
    if (!existing) return res.status(404).json({ error: 'Clock event not found' });

    await prisma.clockEvent.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
