import { PrismaClient } from '@prisma/client';
import 'dotenv/config';
const p = new PrismaClient();
const orgs = await p.organization.findMany({ select: { id: true, name: true, slug: true } });
console.table(orgs);
const u = await p.user.findUnique({ where: { email: 'jaiviktemp1@gmail.com' }, select: { email: true, role: true, status: true, orgId: true, contractSigned: true, vendorApproved: true } });
console.log('Vendor:', u);
await p.$disconnect();
