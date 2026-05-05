import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import 'dotenv/config';

const p = new PrismaClient();

const sa = await p.user.findFirst({ where: { role: 'superadmin' } });
const onboarded = await p.user.findFirst({ where: { onboardingSubmitted: true, vendorApproved: false, role: { not: 'superadmin' } } });

if (!sa || !onboarded) {
  console.log('Need superadmin + onboarded user'); process.exit(0);
}

const token = jwt.sign(
  { id: sa.id, name: sa.name, email: sa.email, role: sa.role, orgId: sa.orgId },
  process.env.JWT_SECRET,
  { expiresIn: '1h' }
);

// 1. Verify template seed
const tmpl = await p.contractTemplate.findFirst({ where: { isDefault: true } });
console.log(`Template: ${tmpl?.name || 'NONE'} (${tmpl?.id})`);

// 2. Create contract
const r1 = await fetch('http://localhost:5000/api/admin/contracts', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({
    userId: onboarded.id,
    mergeValues: {
      merchant: { businessLegalName: 'Test Co LLC', email: onboarded.email, address: '1 Main St' },
      pricing: { saas: { baseMonthlyFee: 79 }, hardware: [{ description: 'Dejavoo Z11', qty: 2, unitPrice: 295, total: 590 }] },
      agreementDate: new Date().toISOString().slice(0, 10),
    },
  }),
});
console.log(`POST /admin/contracts: ${r1.status}`);
const d1 = await r1.json();
console.log('Created contract:', d1.contract?.id, 'status:', d1.contract?.status);

if (d1.contract?.id) {
  // 3. Send to vendor
  const r2 = await fetch(`http://localhost:5000/api/admin/contracts/${d1.contract.id}/send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  console.log(`POST /admin/contracts/:id/send: ${r2.status}`);

  // Cleanup
  await p.contractEvent.deleteMany({ where: { contractId: d1.contract.id } });
  await p.contract.delete({ where: { id: d1.contract.id } });
  console.log('Cleanup done.');
}

await p.$disconnect();
