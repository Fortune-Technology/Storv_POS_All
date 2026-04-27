/**
 * seedIntegrations.js — Seeds StoreIntegration rows so the Delivery Platforms
 * page shows a realistic mix of active / inactive platforms per store.
 *
 * Credentials are placeholder strings (not real API keys) — each store gets
 * DoorDash + UberEats as ACTIVE, Instacart + GrubHub as INACTIVE (pending).
 *
 * Idempotent per (storeId, platform).
 *
 * Usage: node prisma/seedIntegrations.js [orgId] [storeId]
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

const PLATFORMS = [
  {
    platform: 'doordash',
    status: 'active',
    storeName: 'Main Street Market (DoorDash)',
    credentials: {
      storeId: 'DD-MS-4532', apiKey: 'demo-dd-key-PLACEHOLDER', merchantId: 'DD-MERCH-9021',
    },
    config: {
      acceptOrdersAutomatically: true,
      prepTimeMinutes: 15,
      priceMarkupPct: 10,
      menuSyncEnabled: true,
      notificationEmail: 'orders@store.example.com',
    },
    inventoryConfig: {
      syncFromPOS: true, suspend86Enabled: true, syncFrequencyMinutes: 15,
    },
  },
  {
    platform: 'ubereats',
    status: 'active',
    storeName: 'Main Street Market (Uber Eats)',
    credentials: {
      storeId: 'UE-MS-88712', apiKey: 'demo-ue-key-PLACEHOLDER', merchantId: 'UE-MERCH-4401',
    },
    config: {
      acceptOrdersAutomatically: false,
      prepTimeMinutes: 20,
      priceMarkupPct: 12,
      menuSyncEnabled: true,
      notificationEmail: 'orders@store.example.com',
    },
    inventoryConfig: {
      syncFromPOS: true, suspend86Enabled: true, syncFrequencyMinutes: 30,
    },
  },
  {
    platform: 'instacart',
    status: 'pending',
    storeName: null,
    credentials: {},
    config: { notes: 'Awaiting Instacart onboarding — credentials not yet issued.' },
    inventoryConfig: {},
  },
  {
    platform: 'grubhub',
    status: 'disabled',
    storeName: null,
    credentials: {},
    config: { notes: 'Grubhub disabled by owner — not active in this region.' },
    inventoryConfig: {},
  },
];

export async function seedIntegrations(orgId = ORG_ID, storeId = STORE_ID) {
  console.log(`\n  🔌 Seeding delivery-platform integrations for org=${orgId} store=${storeId}...`);

  let created = 0, skipped = 0;
  for (const p of PLATFORMS) {
    const existing = await prisma.storeIntegration.findFirst({
      where: { orgId, storeId, platform: p.platform },
    });
    if (existing) { skipped++; continue; }
    await prisma.storeIntegration.create({
      data: {
        orgId, storeId,
        platform: p.platform,
        status: p.status,
        storeName: p.storeName,
        credentials: p.credentials,
        config: p.config,
        inventoryConfig: p.inventoryConfig,
        lastSyncAt: p.status === 'active' ? new Date(Date.now() - Math.random() * 2 * 3600000) : null,
      },
    });
    created++;
  }
  console.log(`  ✓ ${created} integrations seeded${skipped ? `, ${skipped} already existed` : ''}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  seedIntegrations()
    .catch((e) => { console.error('✗ seedIntegrations failed:', e); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
