import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });
const prisma = new PrismaClient();

const d = new Date();
const dateStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
const prefix = `SYN-${dateStr}-`;

const r = await prisma.transaction.deleteMany({
  where: { txNumber: { startsWith: prefix } },
});
console.log(`Deleted ${r.count} synthetic txs with prefix ${prefix}`);
process.exit(0);
