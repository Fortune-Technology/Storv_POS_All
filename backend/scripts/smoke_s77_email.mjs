// E2E smoke for the sign + email + resend flow.
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import 'dotenv/config';

const p = new PrismaClient();
const BASE = 'http://localhost:5000/api';

const sa = await p.user.findFirst({ where: { role: 'superadmin' } });
// Pick any non-superadmin user; reset their flags for the smoke window.
const vendor = await p.user.findFirst({ where: { role: { not: 'superadmin' } } });
if (!sa || !vendor) {
  console.log('Need superadmin + at least one user.');
  process.exit(0);
}
// Reset the vendor flags + status so we're testing the full pre-activation flow.
await p.user.update({
  where: { id: vendor.id },
  data: { contractSigned: false, vendorApproved: false, status: 'pending' },
});

const adminToken = jwt.sign(
  { id: sa.id, name: sa.name, email: sa.email, role: sa.role, orgId: sa.orgId },
  process.env.JWT_SECRET,
  { expiresIn: '1h' },
);
const vendorToken = jwt.sign(
  { id: vendor.id, name: vendor.name, email: vendor.email, role: vendor.role, orgId: vendor.orgId },
  process.env.JWT_SECRET,
  { expiresIn: '1h' },
);

console.log(`Admin: ${sa.email}\nVendor: ${vendor.email}`);

// 1) Generate contract
console.log('\n--- Generate contract ---');
const r1 = await fetch(`${BASE}/admin/contracts`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
  body: JSON.stringify({
    userId: vendor.id,
    mergeValues: {
      merchant: { businessLegalName: 'Smoke Test LLC', email: vendor.email, address: '1 Smoke St' },
      pricing: { saas: { baseMonthlyFee: 79 }, hardware: [] },
      agreementDate: new Date().toISOString().slice(0, 10),
    },
  }),
});
const d1 = await r1.json();
console.log(`POST /admin/contracts: ${r1.status}`, d1.contract?.id);
const contractId = d1.contract?.id;
if (!contractId) process.exit(1);

// 2) Send (this should email — but if SMTP not configured, returns emailSent=false)
console.log('\n--- Send ---');
const r2 = await fetch(`${BASE}/admin/contracts/${contractId}/send`, {
  method: 'POST', headers: { Authorization: `Bearer ${adminToken}` },
});
const d2 = await r2.json();
console.log(`POST /send: ${r2.status} emailSent=${d2.emailSent}`);

// 3) Resend
console.log('\n--- Resend ---');
const r3 = await fetch(`${BASE}/admin/contracts/${contractId}/resend`, {
  method: 'POST', headers: { Authorization: `Bearer ${adminToken}` },
});
const d3 = await r3.json();
console.log(`POST /resend: ${r3.status} emailSent=${d3.emailSent} to=${d3.recipientEmail}`);

// 4) Vendor signs
console.log('\n--- Sign ---');
const sigPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=';
const r4 = await fetch(`${BASE}/contracts/me/${contractId}/sign`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${vendorToken}` },
  body: JSON.stringify({
    signerName: 'Smoke Vendor',
    signerTitle: 'Owner',
    signerEmail: vendor.email,
    signatureDataUrl: sigPng,
  }),
});
const d4 = await r4.json();
console.log(`POST /sign: ${r4.status} status=${d4.contract?.status} signedAt=${!!d4.contract?.signedAt}`);

// Wait briefly for the background tasks (PDF + flag flip)
console.log('\nWaiting 5s for background PDF gen...');
await new Promise(r => setTimeout(r, 5000));

// 5) Check final state + events
const final = await p.contract.findUnique({
  where: { id: contractId },
  include: { events: { orderBy: { createdAt: 'asc' } } },
});
console.log(`\nFinal status: ${final.status}, signedPdfPath: ${final.signedPdfPath ? 'YES' : 'NO'}`);
console.log(`Events (${final.events.length}):`);
for (const e of final.events) {
  console.log(`  ${e.eventType}  meta=${JSON.stringify(e.meta)}`);
}

// Cleanup
await p.contractEvent.deleteMany({ where: { contractId } });
await p.contract.delete({ where: { id: contractId } });
// Reset vendor flags so they're back to pre-sign state for re-testing
await p.user.update({ where: { id: vendor.id }, data: { contractSigned: false } });
console.log('\nCleanup done.');

await p.$disconnect();
