/**
 * Employee Reports Controller
 * Provides clock-in/out history, hours worked, and sales per employee.
 * Also provides CRUD for manual clock event management (back-office).
 * Used by the back-office portal.
 */

import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../config/postgres.js';

// ── Date helpers ──────────────────────────────────────────────────────────
function parseFromDate(str: unknown): Date {
  return str ? new Date(String(str) + 'T00:00:00.000Z') : (() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 7);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  })();
}
function parseToDate(str: unknown): Date {
  return str ? new Date(String(str) + 'T23:59:59.999Z') : (() => {
    const d = new Date();
    d.setUTCHours(23, 59, 59, 999);
    return d;
  })();
}

interface SessionEntry {
  in: Date | string;
  out: Date | string | null;
  minutes: number;
  active?: boolean;
}

interface ClockEventLite {
  type: string;
  createdAt: Date | string;
}

interface EmployeeStats {
  userId: string;
  name: string;
  email: string;
  role: string;
  totalMinutes: number;
  sessions: SessionEntry[];
  transactions: number;
  totalSales: number;
  refunds?: number;
  refundsAmount?: number;
  clockEvents: ClockEventLite[];
}

// ── GET /api/reports/employees ────────────────────────────────────────────
// Query params: storeId, from (YYYY-MM-DD), to (YYYY-MM-DD)
export const getEmployeeReport = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId   = (req.orgId || req.user?.orgId) as string;
    const { storeId, from, to } = req.query as { storeId?: string; from?: string; to?: string };

    const fromDate   = parseFromDate(from);
    const toDate     = parseToDate(to);
    const where: Prisma.ClockEventWhereInput = { orgId, ...(storeId && { storeId }) };
    const dateFilter = { gte: fromDate, lte: toDate };

    const [clockEvents, transactions, users] = await Promise.all([
      prisma.clockEvent.findMany({
        where: { ...where, createdAt: dateFilter },
        orderBy: { createdAt: 'asc' },
        select: { userId: true, type: true, createdAt: true, storeId: true },
      }),
      prisma.transaction.findMany({
        where: { orgId, ...(storeId && { storeId }), createdAt: dateFilter, status: { not: 'voided' } },
        select: { cashierId: true, grandTotal: true, status: true, createdAt: true },
      }),
      prisma.user.findMany({
        where: { orgId },
        select: { id: true, name: true, email: true, role: true },
      }),
    ]);

    type UserLite = { id: string; name: string; email: string; role: string };
    const userMap: Record<string, UserLite> = Object.fromEntries(
      users.map((u: UserLite) => [u.id, u]),
    );

    // Build per-employee stats
    const employees: Record<string, EmployeeStats> = {};

    // Clock events → pair in/out → calculate hours
    type ClockEventRow = (typeof clockEvents)[number];
    const eventsByUser: Record<string, ClockEventRow[]> = {};
    clockEvents.forEach((e: ClockEventRow) => {
      if (!eventsByUser[e.userId]) eventsByUser[e.userId] = [];
      eventsByUser[e.userId].push(e);
    });

    Object.entries(eventsByUser).forEach(([userId, events]: [string, ClockEventRow[]]) => {
      if (!employees[userId]) {
        const u = userMap[userId] || { id: userId, name: 'Unknown', email: '', role: 'cashier' };
        employees[userId] = {
          userId, name: u.name, email: u.email, role: u.role,
          totalMinutes: 0, sessions: [], transactions: 0, totalSales: 0, clockEvents: [],
        };
      }

      employees[userId].clockEvents = events.map((e: ClockEventRow) => ({ type: e.type, createdAt: e.createdAt }));

      let lastIn: Date | string | null = null;
      events.forEach((e: ClockEventRow) => {
        if (e.type === 'in') {
          lastIn = e.createdAt;
        } else if (e.type === 'out' && lastIn) {
          const minutes = Math.round((new Date(e.createdAt).getTime() - new Date(lastIn).getTime()) / 60000);
          employees[userId].totalMinutes += minutes;
          employees[userId].sessions.push({ in: lastIn, out: e.createdAt, minutes });
          lastIn = null;
        }
      });
      // Still clocked in (active session)
      if (lastIn) {
        const minutes = Math.round((Date.now() - new Date(lastIn).getTime()) / 60000);
        employees[userId].totalMinutes += minutes;
        employees[userId].sessions.push({ in: lastIn, out: null, minutes, active: true });
      }
    });

    // Transaction stats per cashier.
    type TxRow = (typeof transactions)[number];
    transactions.forEach((tx: TxRow) => {
      const cid = tx.cashierId;
      if (!cid) return;
      if (!employees[cid]) {
        const u = userMap[cid] || { id: cid, name: 'Unknown', email: '', role: 'cashier' };
        employees[cid] = {
          userId: cid, name: u.name, email: u.email, role: u.role,
          totalMinutes: 0, sessions: [],
          transactions: 0, totalSales: 0,
          refunds: 0, refundsAmount: 0,
          clockEvents: [],
        };
      }
      if (tx.status === 'refund') {
        employees[cid].refunds = (employees[cid].refunds || 0) + 1;
        employees[cid].refundsAmount = (employees[cid].refundsAmount || 0) + Math.abs(Number(tx.grandTotal));
      } else {
        employees[cid].transactions++;
        employees[cid].totalSales += Number(tx.grandTotal);
      }
    });

    const result = Object.values(employees).map((emp: EmployeeStats) => ({
      ...emp,
      totalSales:    Math.round(emp.totalSales    * 100) / 100,
      refundsAmount: Math.round((emp.refundsAmount || 0) * 100) / 100,
      hoursWorked:   Math.round(emp.totalMinutes / 6) / 10,
      avgSalesPerHour: emp.totalMinutes > 0
        ? Math.round((emp.totalSales / (emp.totalMinutes / 60)) * 100) / 100
        : null,
    })).sort((a, b) => b.totalSales - a.totalSales);

    res.json({ from: fromDate.toISOString(), to: toDate.toISOString(), employees: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
};

// ── GET /api/reports/clock-events ─────────────────────────────────────────
// Returns raw clock events (with IDs) for back-office management.
// Query params: storeId, userId, from, to
export const listClockEvents = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = (req.orgId || req.user?.orgId) as string;
    const { storeId, userId, from, to } = req.query as { storeId?: string; userId?: string; from?: string; to?: string };

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
    type ClockEventRow = (typeof events)[number];
    const userIds = Array.from(new Set(events.map((e: ClockEventRow) => e.userId)));
    type UserLite = { id: string; name: string; email: string; role: string };
    const users = userIds.length
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true, role: true },
        })
      : [];
    const userMap: Record<string, UserLite> = Object.fromEntries(
      users.map((u: UserLite) => [u.id, u]),
    );

    const result = events.map((e: ClockEventRow) => ({
      ...e,
      userName:  userMap[e.userId]?.name  || 'Unknown',
      userEmail: userMap[e.userId]?.email || '',
      userRole:  userMap[e.userId]?.role  || '',
    }));

    res.json({ events: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
};

// ── GET /api/reports/employees/list ──────────────────────────────────────
// Returns all employees (users) for the org — used for dropdowns.
export const listStoreEmployees = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = (req.orgId || req.user?.orgId) as string;
    const users = await prisma.user.findMany({
      where: { orgId, posPin: { not: null } }, // only PIN-enabled users (cashier-app users)
      select: { id: true, name: true, email: true, role: true },
      orderBy: { name: 'asc' },
    });
    res.json({ employees: users });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
};

interface CreateClockSessionBody {
  userId?: string;
  storeId?: string;
  inTime?: string | Date;
  outTime?: string | Date;
  note?: string | null;
}

// ── POST /api/reports/clock-events ───────────────────────────────────────
// Manually create a clock event. Pass inTime + optional outTime to create a full session.
// Body: { userId, storeId, inTime, outTime? }
export const createClockSession = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = (req.orgId || req.user?.orgId) as string;
    const { userId, storeId, inTime, outTime, note } = req.body as CreateClockSessionBody;

    if (!userId)  { res.status(400).json({ error: 'userId is required' }); return; }
    if (!inTime)  { res.status(400).json({ error: 'inTime is required' }); return; }

    const effectiveStoreId = (storeId || req.storeId) as string;

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
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
};

interface UpdateClockEventBody {
  timestamp?: string | Date;
  type?: string;
  note?: string | null;
}

// ── PUT /api/reports/clock-events/:id ────────────────────────────────────
// Update the timestamp (and optionally type/note) of a single clock event.
// Body: { timestamp, type?, note? }
export const updateClockEvent = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = (req.orgId || req.user?.orgId) as string;
    const { id } = req.params;
    const { timestamp, type, note } = req.body as UpdateClockEventBody;

    const existing = await prisma.clockEvent.findFirst({ where: { id, orgId } });
    if (!existing) { res.status(404).json({ error: 'Clock event not found' }); return; }

    const data: Prisma.ClockEventUpdateInput = {};
    if (timestamp !== undefined) data.createdAt = new Date(timestamp);
    if (type      !== undefined) data.type = type;
    if (note      !== undefined) data.note = note;

    const updated = await prisma.clockEvent.update({
      where: { id },
      data,
    });

    res.json(updated);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
};

// ── DELETE /api/reports/clock-events/:id ─────────────────────────────────
// Delete a single clock event by ID.
export const deleteClockEvent = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = (req.orgId || req.user?.orgId) as string;
    const { id } = req.params;

    const existing = await prisma.clockEvent.findFirst({ where: { id, orgId } });
    if (!existing) { res.status(404).json({ error: 'Clock event not found' }); return; }

    await prisma.clockEvent.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
};
