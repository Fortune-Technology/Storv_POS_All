// Smoke test for the S77 by-user endpoint added for the eye button.
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import 'dotenv/config';

const p = new PrismaClient();

// Find a superadmin
const sa = await p.user.findFirst({ where: { role: 'superadmin' } });
if (!sa) { console.log('No superadmin found'); process.exit(1); }
console.log(`Superadmin: ${sa.email}`);

// Find a user with onboarding submitted
const o = await p.vendorOnboarding.findFirst({
  where: { status: 'submitted' },
  include: { user: true },
});
if (!o) { console.log('No onboarding submission found'); process.exit(1); }
console.log(`Onboarding for: ${o.user.email} (userId=${o.userId})`);

// Generate a token for the superadmin
const token = jwt.sign(
  { id: sa.id, name: sa.name, email: sa.email, role: sa.role, orgId: sa.orgId },
  process.env.JWT_SECRET,
  { expiresIn: '1h' }
);

// Hit the new endpoint
const res = await fetch(`http://localhost:5000/api/admin/vendor-onboardings/by-user/${o.userId}`, {
  headers: { Authorization: `Bearer ${token}` },
});
console.log(`\nGET /by-user/${o.userId}: ${res.status}`);
const data = await res.json();
console.log('Response keys:', Object.keys(data));
if (data.onboarding) {
  console.log('businessLegalName:', data.onboarding.businessLegalName);
  console.log('industry:', data.onboarding.industry);
  console.log('requestedModules:', data.onboarding.requestedModules);
  console.log('status:', data.onboarding.status);
}

// 404 case
const res404 = await fetch('http://localhost:5000/api/admin/vendor-onboardings/by-user/fake_user_id_xyz', {
  headers: { Authorization: `Bearer ${token}` },
});
console.log(`\nGET /by-user/fake_user_id_xyz: ${res404.status}`);
console.log('Response:', JSON.stringify(await res404.json()));

await p.$disconnect();
