// @ts-nocheck
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __filename = fileURLToPath(import.meta.url);
dotenv.config({ path: join(dirname(__filename), '..', '.env') });

async function main() {
  const p = new PrismaClient();
  const stores = await p.store.findMany({ select: { id: true, name: true, isActive: true } });
  console.log('All stores:');
  for (const s of stores) console.log(`  ${s.id}  ${s.isActive ? '[active]  ' : '[inactive]'}  ${s.name}`);
  await p.$disconnect();
}
main();
