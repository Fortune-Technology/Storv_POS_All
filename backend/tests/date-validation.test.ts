// @ts-nocheck — Phase 4 (April 2026): renamed from .mjs/.js to .ts as part of
//   the tsconfig coverage expansion. Test files are not strict-typed yet —
//   most errors are implicit-any on Prisma fixture rows + describe/it
//   parameters. Strict typing of the test suite is deferred to Phase 5
//   alongside the strict-Prisma typing rollout. Remove this directive when
//   this file gets touched and the errors get cleaned up — they are all
//   mechanical (param annotations, fixture row types).

/**
 * Date validation tests — verifies that out-of-range dates return 400
 * (not 500) across all date-accepting endpoints, and that valid dates
 * still succeed.
 *
 * Run: node --test tests/date-validation.test.mjs
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const API   = process.env.TEST_API_URL || 'http://localhost:5000';
const ORG   = 'default';
const STORE = 'default-store';
const prisma = new PrismaClient();

let TOKEN = null;
const H = () => ({
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${TOKEN}`,
  'X-Store-Id':    STORE,
});

async function post(path, body) {
  const r = await fetch(API + path, { method: 'POST', headers: H(), body: JSON.stringify(body) });
  const text = await r.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: r.status, body: json };
}

before(async () => {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    await fetch(API + '/').catch(() => {});
    clearTimeout(t);
  } catch { process.exit(1); }
  const user = await prisma.user.findFirst({ where: { email: 'owner@storeveu.com' } });
  TOKEN = jwt.sign({ id: user.id, orgId: user.orgId, role: user.role }, process.env.JWT_SECRET, { expiresIn: '1h' });
});
after(async () => { await prisma.$disconnect(); });

const BAD_YEAR_ISO = '+020001-08-31T18:30:00.000Z';
const BAD_WRAPPER  = { $type: 'DateTime', value: BAD_YEAR_ISO };

describe('Date validation — rejects out-of-range years with 400 (not 500)', () => {

  test('ProductGroup.saleStart = year 20001 → 400', async () => {
    const r = await post('/api/catalog/groups', {
      name: `DateTest ${Date.now()}`,
      saleStart: BAD_YEAR_ISO,
    });
    assert.equal(r.status, 400, JSON.stringify(r.body));
    assert.equal(r.body.field, 'saleStart');
  });

  test('ProductGroup.saleEnd = Prisma wrapper with bad year → 400', async () => {
    const r = await post('/api/catalog/groups', {
      name: `DateTest ${Date.now()}`,
      saleEnd: BAD_WRAPPER,
    });
    assert.equal(r.status, 400, JSON.stringify(r.body));
    assert.equal(r.body.field, 'saleEnd');
  });

  test('ProductGroup with valid dates → 201', async () => {
    const r = await post('/api/catalog/groups', {
      name: `DateTest Valid ${Date.now()}`,
      saleStart: '2026-09-01',
      saleEnd:   '2026-12-31',
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    // Cleanup
    await prisma.productGroup.delete({ where: { id: r.body.data.id } }).catch(() => {});
  });

  test('Promotion.startDate = year 20001 → 400', async () => {
    const r = await post('/api/catalog/promotions', {
      name: `DateTest Promo ${Date.now()}`,
      promoType: 'sale',
      productIds: [],
      departmentIds: [1],
      startDate: BAD_YEAR_ISO,
    });
    assert.equal(r.status, 400);
    assert.equal(r.body.field, 'startDate');
  });

  test('Task.dueDate = year 20001 → 400', async () => {
    const r = await post('/api/tasks', {
      title: `DateTest Task ${Date.now()}`,
      dueDate: BAD_YEAR_ISO,
    });
    assert.equal(r.status, 400);
    assert.equal(r.body.field, 'dueDate');
  });

  test('Customer.birthDate = year 20001 → 400', async () => {
    const r = await post('/api/customers', {
      firstName: 'DateTest',
      lastName:  String(Date.now()),
      birthDate: BAD_YEAR_ISO,
    });
    assert.equal(r.status, 400);
    assert.equal(r.body.field, 'birthDate');
  });

  test('Customer with valid birthDate → 201', async () => {
    const r = await post('/api/customers', {
      firstName: 'DateTest',
      lastName:  `Valid ${Date.now()}`,
      birthDate: '1990-05-15',
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    // Hard-delete cleanup so we don't pollute the customers list
    await prisma.customer.delete({ where: { id: r.body.id } }).catch(() => {});
  });

  test('Invalid date string "not a date" → 400', async () => {
    const r = await post('/api/catalog/groups', {
      name: `DateTest ${Date.now()}`,
      saleStart: 'not a date',
    });
    assert.equal(r.status, 400);
    assert.equal(r.body.field, 'saleStart');
  });

  test('Empty string date → treated as null (201 for group, no error)', async () => {
    const r = await post('/api/catalog/groups', {
      name: `DateTest Empty ${Date.now()}`,
      saleStart: '',
      saleEnd:   '',
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.data.saleStart, null);
    await prisma.productGroup.delete({ where: { id: r.body.data.id } }).catch(() => {});
  });

});
