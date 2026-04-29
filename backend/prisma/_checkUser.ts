import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });
const prisma = new PrismaClient({ log: [] });

const u = await prisma.user.findFirst({
  where: { email: 'jaiviktemp1@gmail.com' },
  select: {
    id: true, name: true, email: true, role: true, orgId: true,
    orgs: { select: { orgId: true, role: true, isPrimary: true } },
  },
});
console.log(JSON.stringify(u, null, 2));
process.exit(0);
