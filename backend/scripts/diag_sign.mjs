// Diagnose the sign endpoint failure.
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import 'dotenv/config';

const p = new PrismaClient();
const CONTRACT_ID = 'cmor3pc8p000mvdekfkpzj9g9';

const c = await p.contract.findUnique({
  where: { id: CONTRACT_ID },
  include: { user: true, templateVersion: { select: { mergeFields: true } } },
});
if (!c) { console.log('Contract not found'); process.exit(1); }

console.log(`Contract status: ${c.status}, userId: ${c.userId}`);
console.log(`User: ${c.user.email}`);

// Build a token for that user
const token = jwt.sign(
  { id: c.userId, name: c.user.name, email: c.user.email, role: c.user.role, orgId: c.user.orgId },
  process.env.JWT_SECRET,
  { expiresIn: '1h' }
);

// Tiny 1x1 PNG dataURL
const sigPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=';

const res = await fetch(`http://localhost:5000/api/contracts/me/${CONTRACT_ID}/sign`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({
    signerName: 'Diagnostic Test',
    signerTitle: 'Owner',
    signerEmail: c.user.email,
    signatureDataUrl: sigPng,
    bankName: 'Test Bank',
    bankRoutingLast4: '1234',
    bankAccountLast4: '5678',
  }),
});
console.log(`\nStatus: ${res.status}`);
const text = await res.text();
console.log(`Body: ${text.slice(0, 1000)}`);

await p.$disconnect();
