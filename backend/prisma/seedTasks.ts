// @ts-nocheck — Phase 4 (April 2026): renamed from .js to .ts as part of the
//   tsconfig coverage expansion. Strict typing of seed scripts deferred to
//   Phase 5 (alongside the strict-Prisma-typing rollout). Remove this
//   directive when this file gets audited; expect ~3-15 implicit-any errors
//   on helper function params + map index access — all mechanical to fix.

/**
 * Seed Tasks — realistic open/in-progress/completed tasks with checklists.
 * Run via: node prisma/seedTasks.js [orgId] [storeId]
 */
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });
const prisma = new PrismaClient();

const ORG_ID   = process.argv[2] || 'default';
const STORE_ID = process.argv[3] || 'default-store';

const daysFromNow = (n) => new Date(Date.now() + n * 86400000);

const nanoid = () => Math.random().toString(36).slice(2, 10);

const TASKS = [
  {
    title: 'Restock beer cooler (Aisle 4)',
    description: 'Refrigerator #3 is below par levels. Pull from backroom pallet.',
    priority: 'high', status: 'open', category: 'stocking',
    assigneeRole: 'cashier',
    dueInDays: 0,
    checklist: [
      { text: 'Bud Light 12pk — 4 cases', done: false },
      { text: 'Coors Light 12pk — 3 cases', done: false },
      { text: 'White Claw Variety — 2 cases', done: false },
    ],
  },
  {
    title: 'Clean restrooms & mop floor',
    description: 'Morning shift cleaning checklist.',
    priority: 'normal', status: 'in_progress', category: 'cleaning',
    assigneeRole: 'staff',
    dueInDays: 0,
    checklist: [
      { text: 'Empty trash bins', done: true },
      { text: 'Refill soap + paper towels', done: true },
      { text: 'Mop floor', done: false },
      { text: 'Wipe mirrors', done: false },
    ],
  },
  {
    title: 'Lottery EOD reconciliation',
    description: 'Scan end tickets for all active lottery boxes and submit shift report.',
    priority: 'urgent', status: 'open', category: 'inventory',
    assigneeRole: 'manager',
    dueInDays: 0,
    checklist: [
      { text: 'Scan all active box tickets', done: false },
      { text: 'Verify variance under $5', done: false },
      { text: 'Submit shift report', done: false },
    ],
  },
  {
    title: 'Update snack aisle endcap',
    description: 'Swap Halloween display for Thanksgiving promo.',
    priority: 'normal', status: 'open', category: 'display',
    assigneeRole: 'staff',
    dueInDays: 2,
    checklist: [
      { text: 'Remove Halloween signage', done: false },
      { text: 'Build Thanksgiving endcap', done: false },
      { text: 'Price and tag items', done: false },
    ],
  },
  {
    title: 'Review weekly sales report',
    description: 'Pull EoD report for week, identify top 5 SKUs and prepare order list.',
    priority: 'high', status: 'in_progress', category: 'other',
    assigneeRole: 'owner',
    dueInDays: 1,
    checklist: [
      { text: 'Download report', done: true },
      { text: 'Flag low-stock items', done: false },
      { text: 'Generate PO for vendor', done: false },
    ],
  },
  {
    title: 'Count cigarette inventory',
    description: 'Weekly tobacco count — reconcile with POS.',
    priority: 'normal', status: 'completed', category: 'inventory',
    assigneeRole: 'manager',
    dueInDays: -1,
    completed: true,
    checklist: [
      { text: 'Count Marlboro cartons', done: true },
      { text: 'Count Newport cartons', done: true },
      { text: 'Update POS quantities', done: true },
    ],
  },
  {
    title: 'Check walk-in freezer temp',
    description: 'Daily equipment check.',
    priority: 'normal', status: 'completed', category: 'cleaning',
    assigneeRole: 'staff',
    dueInDays: -1,
    completed: true,
    checklist: [
      { text: 'Temp logged', done: true },
    ],
  },
  {
    title: 'Replace price tags for wine section',
    description: 'New vendor pricing effective this week.',
    priority: 'low', status: 'open', category: 'stocking',
    assigneeRole: 'cashier',
    dueInDays: 3,
    checklist: [
      { text: 'Print updated tags', done: false },
      { text: 'Install tags on shelf', done: false },
    ],
  },
];

export async function seedTasks(orgId = ORG_ID, storeId = STORE_ID) {
  console.log(`\n  ✅ Seeding tasks for org=${orgId} store=${storeId}...`);

  const existing = await prisma.task.count({ where: { orgId, storeId } });
  if (existing > 0) {
    console.log(`  ✓ Tasks already exist (${existing}) — skipping`);
    return;
  }

  const directUsers = await prisma.user.findMany({
    where: { orgId },
    select: { id: true, name: true, role: true },
  });
  const orgMembers = await prisma.userOrg.findMany({
    where: { orgId },
    select: { role: true, user: { select: { id: true, name: true, role: true } } },
  });
  const all = [
    ...directUsers,
    ...orgMembers.map(m => ({ id: m.user.id, name: m.user.name, role: m.role || m.user.role })),
  ];
  const seen = new Set();
  const users = all.filter(u => (seen.has(u.id) ? false : seen.add(u.id)));
  const byRole = Object.fromEntries(users.map(u => [u.role, u]));
  const assigner = byRole.owner || byRole.manager || users[0];
  if (!assigner) {
    console.log('  ⚠ No users found — skipping task seed');
    return;
  }
  // When a specific role is missing, fall back to any user (or null for assignedTo)
  const resolve = (role) => byRole[role] || users[0];

  let created = 0;
  for (const t of TASKS) {
    const assignee = resolve(t.assigneeRole);
    const checklist = (t.checklist || []).map(item => ({
      id:          nanoid(),
      text:        item.text,
      done:        !!item.done,
      completedAt: item.done ? new Date().toISOString() : null,
      completedBy: item.done ? assignee?.id || null : null,
    }));

    await prisma.task.create({
      data: {
        orgId, storeId,
        title:        t.title,
        description:  t.description,
        priority:     t.priority,
        status:       t.status,
        category:     t.category,
        assignedTo:   assignee?.id || null,
        assignedBy:   assigner.id,
        assigneeName: assignee?.name || null,
        assignerName: assigner.name,
        checklist,
        dueDate:      daysFromNow(t.dueInDays),
        completedAt:  t.completed ? daysFromNow(t.dueInDays) : null,
        completedBy:  t.completed ? assignee?.id || null : null,
      },
    });
    created++;
  }
  console.log(`  ✓ ${created} tasks seeded`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  seedTasks()
    .catch((e) => { console.error('✗ seedTasks failed:', e); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
