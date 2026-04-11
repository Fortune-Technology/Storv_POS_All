/**
 * Task Controller — Task assignment + management.
 * Back-office creates tasks → assigned to cashiers/staff → tracked to completion.
 */

import prisma from '../config/postgres.js';
import { logAudit } from '../services/auditService.js';

// ── Recurring schedule helpers ───────────────────────────────────────────────

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function calcNextRun(recurType, recurDays = [], recurTime = '09:00') {
  const now = new Date();
  const [hours, minutes] = (recurTime || '09:00').split(':').map(Number);

  if (recurType === 'daily') {
    const next = new Date(now);
    next.setDate(next.getDate() + 1);
    next.setHours(hours, minutes, 0, 0);
    return next;
  }

  if (recurType === 'weekly' && recurDays.length > 0) {
    // Find next matching day
    for (let i = 1; i <= 7; i++) {
      const candidate = new Date(now);
      candidate.setDate(candidate.getDate() + i);
      candidate.setHours(hours, minutes, 0, 0);
      const dayName = DAY_NAMES[candidate.getDay()];
      if (recurDays.includes(dayName)) return candidate;
    }
  }

  if (recurType === 'biweekly') {
    const next = new Date(now);
    next.setDate(next.getDate() + 14);
    next.setHours(hours, minutes, 0, 0);
    return next;
  }

  if (recurType === 'monthly') {
    const next = new Date(now);
    next.setMonth(next.getMonth() + 1);
    // If recurDays contains a day-of-month number, use it
    const dayOfMonth = recurDays.find(d => !isNaN(parseInt(d)));
    if (dayOfMonth) next.setDate(Math.min(parseInt(dayOfMonth), 28));
    next.setHours(hours, minutes, 0, 0);
    return next;
  }

  // Default: tomorrow
  const next = new Date(now);
  next.setDate(next.getDate() + 1);
  next.setHours(hours, minutes, 0, 0);
  return next;
}

/**
 * Spawn recurring task instances. Call this from a cron/scheduler.
 * Finds all recurring templates where nextRunAt <= now, creates new task instances,
 * and updates nextRunAt.
 */
export async function spawnRecurringTasks() {
  const now = new Date();
  const templates = await prisma.task.findMany({
    where: { isRecurring: true, nextRunAt: { lte: now }, status: { not: 'cancelled' } },
  });

  for (const tpl of templates) {
    try {
      // Create new instance with fresh checklist (all items unchecked)
      const freshChecklist = Array.isArray(tpl.checklist)
        ? tpl.checklist.map(item => ({ ...item, done: false, completedAt: null, completedBy: null }))
        : [];

      await prisma.task.create({
        data: {
          orgId:        tpl.orgId,
          storeId:      tpl.storeId,
          title:        tpl.title,
          description:  tpl.description,
          priority:     tpl.priority,
          category:     tpl.category,
          assignedTo:   tpl.assignedTo,
          assigneeName: tpl.assigneeName,
          assignedBy:   tpl.assignedBy,
          assignerName: tpl.assignerName,
          checklist:    freshChecklist,
          templateId:   tpl.id,
          dueDate:      tpl.recurType === 'daily' ? new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59) : null,
        },
      });

      // Update template's nextRunAt
      const nextRun = calcNextRun(tpl.recurType, tpl.recurDays, tpl.recurTime);
      await prisma.task.update({
        where: { id: tpl.id },
        data: { lastRunAt: now, nextRunAt: nextRun },
      });
    } catch (err) {
      console.warn(`[Tasks] Failed to spawn recurring task ${tpl.id}:`, err.message);
    }
  }

  return templates.length;
}

// ── GET /api/tasks — List tasks ──────────────────────────────────────────
export const listTasks = async (req, res, next) => {
  try {
    const { status, assignedTo, priority, category, limit = 50 } = req.query;
    const where = { orgId: req.orgId };
    if (req.storeId) where.storeId = req.storeId;
    if (status) where.status = status;
    if (assignedTo) where.assignedTo = assignedTo;
    if (priority) where.priority = priority;
    if (category) where.category = category;

    const [tasks, total] = await Promise.all([
      prisma.task.findMany({
        where,
        orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
        take: Math.min(parseInt(limit), 200),
      }),
      prisma.task.count({ where }),
    ]);

    // Priority sort: urgent first
    const PRIORITY_ORDER = { urgent: 0, high: 1, normal: 2, low: 3 };
    tasks.sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9));

    res.json({ tasks, total });
  } catch (err) { next(err); }
};

// ── POST /api/tasks — Create task ────────────────────────────────────────
export const createTask = async (req, res, next) => {
  try {
    const { title, description, priority, category, assignedTo, storeId, dueDate, checklist, isRecurring, recurType, recurDays, recurDayOfMonth, recurTime, stationId } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'Title required' });

    // Resolve assignee name
    let assigneeName = null;
    if (assignedTo) {
      const user = await prisma.user.findUnique({ where: { id: assignedTo }, select: { name: true } });
      assigneeName = user?.name || null;
    }

    // Resolve station name
    let stationName = null;
    if (stationId) {
      const station = await prisma.station.findUnique({ where: { id: stationId }, select: { name: true } });
      stationName = station?.name || null;
    }

    // Calculate nextRunAt for recurring tasks
    const allRecurDays = recurType === 'monthly' && recurDayOfMonth ? [String(recurDayOfMonth)] : (Array.isArray(recurDays) ? recurDays : []);
    let nextRunAt = null;
    if (isRecurring && recurType) {
      nextRunAt = calcNextRun(recurType, allRecurDays, recurTime);
    }

    const task = await prisma.task.create({
      data: {
        orgId:          req.orgId,
        storeId:        storeId || req.storeId || null,
        title:          title.trim(),
        description:    description?.trim() || null,
        priority:       priority || 'normal',
        category:       category || null,
        assignedTo:     assignedTo || null,
        assigneeName,
        assignedBy:     req.user.id,
        assignerName:   req.user.name || req.user.email,
        stationId:      stationId || null,
        stationName,
        dueDate:        dueDate ? new Date(dueDate) : null,
        checklist:      Array.isArray(checklist) ? checklist : [],
        isRecurring:    !!isRecurring,
        recurType:      recurType || null,
        recurDays:      Array.isArray(recurDays) ? recurDays : [],
        recurDayOfMonth: recurDayOfMonth ? parseInt(recurDayOfMonth) : null,
        recurTime:      recurTime || null,
        nextRunAt,
      },
    });

    await logAudit(req, 'create', 'task', task.id, { title, assignedTo: assigneeName || assignedTo });
    res.status(201).json(task);
  } catch (err) { next(err); }
};

// ── PUT /api/tasks/:id — Update task ─────────────────────────────────────
export const updateTask = async (req, res, next) => {
  try {
    const { title, description, priority, category, assignedTo, status, dueDate, checklist, isRecurring, recurType, recurDays, recurTime } = req.body;
    const data = {};

    if (title !== undefined) data.title = title.trim();
    if (description !== undefined) data.description = description?.trim() || null;
    if (priority) data.priority = priority;
    if (category !== undefined) data.category = category;
    if (dueDate !== undefined) data.dueDate = dueDate ? new Date(dueDate) : null;
    if (checklist !== undefined) data.checklist = Array.isArray(checklist) ? checklist : [];
    if (isRecurring !== undefined) {
      data.isRecurring = !!isRecurring;
      data.recurType = recurType || null;
      data.recurDays = Array.isArray(recurDays) ? recurDays : [];
      data.recurTime = recurTime || null;
      if (isRecurring && recurType) data.nextRunAt = calcNextRun(recurType, recurDays, recurTime);
    }

    if (assignedTo !== undefined) {
      data.assignedTo = assignedTo || null;
      if (assignedTo) {
        const user = await prisma.user.findUnique({ where: { id: assignedTo }, select: { name: true } });
        data.assigneeName = user?.name || null;
      } else {
        data.assigneeName = null;
      }
    }

    if (status) {
      data.status = status;
      if (status === 'completed') {
        data.completedAt = new Date();
        data.completedBy = req.user.id;
      }
    }

    const task = await prisma.task.update({ where: { id: req.params.id }, data });
    await logAudit(req, 'update', 'task', task.id, { status, title: task.title });
    res.json(task);
  } catch (err) { next(err); }
};

// ── DELETE /api/tasks/:id — Delete task ──────────────────────────────────
export const deleteTask = async (req, res, next) => {
  try {
    const task = await prisma.task.findUnique({ where: { id: req.params.id } });
    if (!task) return res.status(404).json({ error: 'Task not found' });

    await prisma.task.delete({ where: { id: req.params.id } });
    await logAudit(req, 'delete', 'task', req.params.id, { title: task.title });
    res.json({ success: true });
  } catch (err) { next(err); }
};

// ── GET /api/tasks/my — Tasks assigned to current user ───────────────────
export const myTasks = async (req, res, next) => {
  try {
    const tasks = await prisma.task.findMany({
      where: { orgId: req.orgId, assignedTo: req.user.id, status: { not: 'cancelled' } },
      orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
    });
    res.json({ tasks, total: tasks.length });
  } catch (err) { next(err); }
};

// ── GET /api/tasks/counts — Summary counts for badges ────────────────────
export const taskCounts = async (req, res, next) => {
  try {
    const where = { orgId: req.orgId };
    if (req.storeId) where.storeId = req.storeId;

    const [open, inProgress, urgent, myOpen] = await Promise.all([
      prisma.task.count({ where: { ...where, status: 'open' } }),
      prisma.task.count({ where: { ...where, status: 'in_progress' } }),
      prisma.task.count({ where: { ...where, priority: 'urgent', status: { in: ['open', 'in_progress'] } } }),
      prisma.task.count({ where: { ...where, assignedTo: req.user.id, status: { in: ['open', 'in_progress'] } } }),
    ]);

    res.json({ open, inProgress, urgent, myOpen, total: open + inProgress });
  } catch (err) { next(err); }
};
