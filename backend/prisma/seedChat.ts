// @ts-nocheck — Phase 4 (April 2026): renamed from .js to .ts as part of the
//   tsconfig coverage expansion. Strict typing of seed scripts deferred to
//   Phase 5 (alongside the strict-Prisma-typing rollout). Remove this
//   directive when this file gets audited; expect ~3-15 implicit-any errors
//   on helper function params + map index access — all mechanical to fix.

/**
 * Seed Chat — seed store-wide channel messages so the Chat page is populated.
 * Channel IDs follow the convention used by chatController:
 *   store:{storeId}           — store-wide channel
 *   direct:{uidA}:{uidB}      — DM (sorted)
 *
 * Run via: node prisma/seedChat.js [orgId] [storeId]
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

function directChannelId(a, b) {
  const [x, y] = [a, b].sort();
  return `direct:${x}:${y}`;
}

const storeThread = [
  { roleFrom: 'owner',   text: "Good morning team — let's have a great day!" },
  { roleFrom: 'manager', text: 'Beer cooler #3 temperature looks high. Checking thermostat.' },
  { roleFrom: 'cashier', text: 'Got a customer asking about the loyalty rewards — where do I look up balance?' },
  { roleFrom: 'manager', text: 'Ring up under Customer Lookup — it shows points + available rewards.' },
  { roleFrom: 'cashier', text: 'Thanks! New till is running smoothly this morning.' },
  { roleFrom: 'owner',   text: 'Reminder: quarterly inventory count scheduled for Sunday evening.' },
  { roleFrom: 'manager', text: 'Vendor delivery from ABACUS arrived — checking invoice now.' },
  { roleFrom: 'staff',   text: 'Bathrooms stocked, shelves fronted. Heading out for break.' },
];

const dmThread = [
  { fromRole: 'owner',   toRole: 'manager', text: 'Can you pull the weekly sales summary before Friday?' },
  { fromRole: 'manager', toRole: 'owner',   text: 'Yep — running EoD report now. Will email it over.' },
  { fromRole: 'owner',   toRole: 'manager', text: 'Also — lottery commission looked low last week. Worth a glance.' },
];

export async function seedChat(orgId = ORG_ID, storeId = STORE_ID) {
  console.log(`\n  💬 Seeding chat for org=${orgId} store=${storeId}...`);

  const existing = await prisma.chatMessage.count({ where: { orgId, storeId } });
  if (existing > 0) {
    console.log(`  ✓ Chat messages already exist (${existing}) — skipping`);
    return;
  }

  // Resolve user roles → ids (direct users + multi-org UserOrg members)
  const directUsers = await prisma.user.findMany({
    where: { orgId },
    select: { id: true, name: true, role: true },
  });
  const orgMembers = await prisma.userOrg.findMany({
    where: { orgId },
    select: { role: true, user: { select: { id: true, name: true, role: true } } },
  });
  const users = [
    ...directUsers,
    ...orgMembers.map(m => ({ id: m.user.id, name: m.user.name, role: m.role || m.user.role })),
  ];
  // Dedup by id
  const seenIds = new Set();
  const dedup = users.filter(u => (seenIds.has(u.id) ? false : seenIds.add(u.id)));
  const byRole = Object.fromEntries(dedup.map(u => [u.role, u]));

  if (dedup.length === 0) {
    console.log(`  ⚠ No users for org=${orgId} — skipping chat seed`);
    return;
  }

  // Fall back to any available user when a specific role isn't seeded
  const anyUser = dedup[0];
  const pick = (role) => byRole[role] || anyUser;

  const channelId = `store:${storeId}`;
  let created = 0;

  // Store-wide thread (chronological over the last 8 hours)
  const base = Date.now() - 8 * 3600_000;
  for (let i = 0; i < storeThread.length; i++) {
    const m = storeThread[i];
    const sender = pick(m.roleFrom);
    if (!sender) continue;
    await prisma.chatMessage.create({
      data: {
        orgId, storeId, channelId,
        senderId:   sender.id,
        senderName: sender.name,
        senderRole: sender.role,
        message:    m.text,
        messageType:'text',
        readBy:     [sender.id],
        createdAt:  new Date(base + i * 15 * 60_000),
      },
    });
    created++;
  }

  // DM between owner and manager (or any two distinct users if roles absent)
  const owner   = byRole.owner   || dedup[0];
  const manager = byRole.manager || dedup.find(u => u.id !== owner.id);
  if (owner && manager && owner.id !== manager.id) {
    const dmCh = directChannelId(owner.id, manager.id);
    const dmBase = Date.now() - 3 * 3600_000;
    for (let i = 0; i < dmThread.length; i++) {
      const m = dmThread[i];
      const sender = m.fromRole === 'owner' ? owner : manager;
      await prisma.chatMessage.create({
        data: {
          orgId, storeId, channelId: dmCh,
          senderId:   sender.id,
          senderName: sender.name,
          senderRole: sender.role,
          message:    m.text,
          messageType:'text',
          readBy:     [sender.id],
          createdAt:  new Date(dmBase + i * 5 * 60_000),
        },
      });
      created++;
    }
  }

  console.log(`  ✓ ${created} chat messages seeded`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  seedChat()
    .catch((e) => { console.error('✗ seedChat failed:', e); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
