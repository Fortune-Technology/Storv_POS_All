/**
 * Task Controller — Task assignment + management.
 * Back-office creates tasks → assigned to cashiers/staff → tracked to completion.
 */

import type { Request, Response, NextFunction } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../config/postgres.js';
import { logAudit } from '../services/auditService.js';
import { tryParseDate } from '../utils/safeDate.js';

// ── Recurring schedule helpers ───────────────────────────────────────────────

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function calcNextRun(
  recurType: string | null | undefined,
  recurDays: string[] = [],
  recurTime: string | null | undefined = '09:00',
): Date {
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
    const dayOfMonth = recurDays.find((d: string) => !isNaN(parseInt(d)));
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

interface ChecklistItem {
  done?: boolean;
  completedAt?: Date | null;
  completedBy?: string | null;
  [extra: string]: unknown;
}

interface RecurringTaskTemplate {
  id: string;
  orgId: string;
  storeId: string | null;
  title: string;
  description: string | null;
  priority: string;
  category: string | null;
  assignedTo: string | null;
  assigneeName: string | null;
  assignedBy: string;
  assignerName: string | null;
  checklist: unknown;
  recurType: string | null;
  recurDays: string[];
  recurTime: string | null;
}

/**
 * Spawn recurring task instances. Call this from a cron/scheduler.
 * Finds all recurring templates where nextRunAt <= now, creates new task instances,
 * and updates nextRunAt.
 */
export async function spawnRecurringTasks(): Promise<number> {
  const now = new Date();
  const templates = await prisma.task.findMany({
    where: { isRecurring: true, nextRunAt: { lte: now }, status: { not: 'cancelled' } },
  }) as unknown as RecurringTaskTemplate[];

  for (const tpl of templates) {
    try {
      // Create new instance with fresh checklist (all items unchecked)
      const freshChecklist = Array.isArray(tpl.checklist)
        ? (tpl.checklist as ChecklistItem[]).map(
            (item: ChecklistItem): ChecklistItem => ({ ...item, done: false, completedAt: null, completedBy: null }),
          )
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
          checklist:    freshChecklist as unknown as Prisma.InputJsonValue,
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
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[Tasks] Failed to spawn recurring task ${tpl.id}:`, message);
    }
  }

  return templates.length;
}

// ── GET /api/tasks — List tasks ──────────────────────────────────────────
export const listTasks = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { status, assignedTo, priority, category, limit = 50 } = req.query as {
      status?: string;
      assignedTo?: string;
      priority?: string;
      category?: string;
      limit?: string | number;
    };
    const where: Prisma.TaskWhereInput = { orgId: req.orgId as string };
    if (req.storeId) where.storeId = req.storeId;
    if (status) where.status = status;
    if (assignedTo) where.assignedTo = assignedTo;
    if (priority) where.priority = priority;
    if (category) where.category = category;

    const [tasks, total] = await Promise.all([
      prisma.task.findMany({
        where,
        orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
        take: Math.min(parseInt(String(limit)), 200),
      }),
      prisma.task.count({ where }),
    ]);

    // Priority sort: urgent first
    const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
    type TaskRow = (typeof tasks)[number];
    tasks.sort((a: TaskRow, b: TaskRow) => (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9));

    res.json({ tasks, total });
  } catch (err) { next(err); }
};

interface CreateTaskBody {
  title?: string;
  description?: string | null;
  priority?: string;
  category?: string | null;
  assignedTo?: string | null;
  storeId?: string | null;
  dueDate?: string | Date | null;
  checklist?: ChecklistItem[];
  isRecurring?: boolean;
  recurType?: string | null;
  recurDays?: string[];
  recurDayOfMonth?: number | string | null;
  recurTime?: string | null;
  stationId?: string | null;
}

// ── POST /api/tasks — Create task ────────────────────────────────────────
export const createTask = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { title, description, priority, category, assignedTo, storeId, dueDate, checklist, isRecurring, recurType, recurDays, recurDayOfMonth, recurTime, stationId } = req.body as CreateTaskBody;
    if (!title?.trim()) { res.status(400).json({ error: 'Title required' }); return; }

    const dd = tryParseDate(res, dueDate, 'dueDate'); if (!dd.ok) return;

    // Resolve assignee name
    let assigneeName: string | null = null;
    if (assignedTo) {
      const user = await prisma.user.findUnique({ where: { id: assignedTo }, select: { name: true } });
      assigneeName = user?.name || null;
    }

    // Resolve station name
    let stationName: string | null = null;
    if (stationId) {
      const station = await prisma.station.findUnique({ where: { id: stationId }, select: { name: true } });
      stationName = station?.name || null;
    }

    // Calculate nextRunAt for recurring tasks
    const allRecurDays = recurType === 'monthly' && recurDayOfMonth
      ? [String(recurDayOfMonth)]
      : (Array.isArray(recurDays) ? recurDays : []);
    let nextRunAt: Date | null = null;
    if (isRecurring && recurType) {
      nextRunAt = calcNextRun(recurType, allRecurDays, recurTime);
    }

    const task = await prisma.task.create({
      data: {
        orgId:          req.orgId as string,
        storeId:        storeId || req.storeId || null,
        title:          title.trim(),
        description:    description?.trim() || null,
        priority:       priority || 'normal',
        category:       category || null,
        assignedTo:     assignedTo || null,
        assigneeName,
        assignedBy:     req.user!.id,
        assignerName:   req.user!.name || req.user!.email,
        stationId:      stationId || null,
        stationName,
        dueDate:        dd.value,
        checklist:      Array.isArray(checklist) ? (checklist as unknown as Prisma.InputJsonValue) : ([] as unknown as Prisma.InputJsonValue),
        isRecurring:    !!isRecurring,
        recurType:      recurType || null,
        recurDays:      Array.isArray(recurDays) ? recurDays : [],
        recurDayOfMonth: recurDayOfMonth ? parseInt(String(recurDayOfMonth)) : null,
        recurTime:      recurTime || null,
        nextRunAt,
      },
    });

    await logAudit(req, 'create', 'task', task.id, { title, assignedTo: assigneeName || assignedTo });
    res.status(201).json(task);
  } catch (err) { next(err); }
};

// ── PUT /api/tasks/:id — Update task ─────────────────────────────────────
export const updateTask = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { title, description, priority, category, assignedTo, status, dueDate, checklist, isRecurring, recurType, recurDays, recurTime } = req.body as Partial<CreateTaskBody> & { status?: string };
    const data: Prisma.TaskUpdateInput = {};

    if (title !== undefined) data.title = title.trim();
    if (description !== undefined) data.description = description?.trim() || null;
    if (priority) data.priority = priority;
    if (category !== undefined) data.category = category;
    if (dueDate !== undefined) {
      const r = tryParseDate(res, dueDate, 'dueDate'); if (!r.ok) return;
      data.dueDate = r.value;
    }
    if (checklist !== undefined) data.checklist = (Array.isArray(checklist) ? checklist : []) as unknown as Prisma.InputJsonValue;
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
        data.completedBy = req.user!.id;
      }
    }

    const task = await prisma.task.update({ where: { id: req.params.id }, data });
    await logAudit(req, 'update', 'task', task.id, { status, title: task.title });
    res.json(task);
  } catch (err) { next(err); }
};

// ── DELETE /api/tasks/:id — Delete task ──────────────────────────────────
export const deleteTask = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const task = await prisma.task.findUnique({ where: { id: req.params.id } });
    if (!task) { res.status(404).json({ error: 'Task not found' }); return; }

    await prisma.task.delete({ where: { id: req.params.id } });
    await logAudit(req, 'delete', 'task', req.params.id, { title: task.title });
    res.json({ success: true });
  } catch (err) { next(err); }
};

// ── GET /api/tasks/my — Tasks assigned to current user ───────────────────
export const myTasks = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tasks = await prisma.task.findMany({
      where: { orgId: req.orgId as string, assignedTo: req.user!.id, status: { not: 'cancelled' } },
      orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
    });
    res.json({ tasks, total: tasks.length });
  } catch (err) { next(err); }
};

// ── GET /api/tasks/counts — Summary counts for badges ────────────────────
export const taskCounts = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const where: Prisma.TaskWhereInput = { orgId: req.orgId as string };
    if (req.storeId) where.storeId = req.storeId;

    const [open, inProgress, urgent, myOpen] = await Promise.all([
      prisma.task.count({ where: { ...where, status: 'open' } }),
      prisma.task.count({ where: { ...where, status: 'in_progress' } }),
      prisma.task.count({ where: { ...where, priority: 'urgent', status: { in: ['open', 'in_progress'] } } }),
      prisma.task.count({ where: { ...where, assignedTo: req.user!.id, status: { in: ['open', 'in_progress'] } } }),
    ]);

    res.json({ open, inProgress, urgent, myOpen, total: open + inProgress });
  } catch (err) { next(err); }
};
