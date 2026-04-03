/**
 * Employee Reports Controller
 * Provides clock-in/out history, hours worked, and sales per employee.
 * Used by the back-office portal.
 */

import prisma from '../config/postgres.js';

// ── GET /api/reports/employees ────────────────────────────────────────────
// Query params: storeId, from (ISO date), to (ISO date)
export const getEmployeeReport = async (req, res) => {
  try {
    const orgId   = req.orgId || req.user?.orgId;
    const { storeId, from, to } = req.query;

    const fromDate = from ? new Date(from) : (() => { const d = new Date(); d.setDate(d.getDate() - 7); d.setHours(0,0,0,0); return d; })();
    const toDate   = to   ? new Date(to)   : (() => { const d = new Date(); d.setHours(23,59,59,999); return d; })();

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

    // Clock events → calculate hours
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

      // Pair clock-in / clock-out events to calculate duration
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
      // Still clocked in
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
      totalSales: Math.round(emp.totalSales * 100) / 100,
      hoursWorked: Math.round(emp.totalMinutes / 6) / 10, // one decimal
    })).sort((a, b) => b.totalSales - a.totalSales);

    res.json({ from: fromDate.toISOString(), to: toDate.toISOString(), employees: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
