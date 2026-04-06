/**
 * Seed a superadmin user for the Admin Panel.
 *
 * Usage:
 *   cd backend
 *   node prisma/seedAdmin.js
 *
 * Default credentials (change after first login):
 *   Email:    admin@storeveu.com
 *   Password: Admin@123
 */

import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const email = 'admin@storeveu.com';
  const password = 'Admin@123';

  // Check if superadmin already exists
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`\n  Superadmin already exists: ${email} (id: ${existing.id})`);
    console.log(`  Role: ${existing.role}, Status: ${existing.status}\n`);
    return;
  }

  // Ensure a default org exists for system-level users
  let defaultOrg = await prisma.organization.findFirst({ where: { slug: 'system' } });
  if (!defaultOrg) {
    defaultOrg = await prisma.organization.create({
      data: {
        name: 'System Administration',
        slug: 'system',
        plan: 'enterprise',
        maxStores: 999,
        maxUsers: 999,
        isActive: true,
      },
    });
    console.log(`  Created system org: ${defaultOrg.id}`);
  }

  const hashed = await bcrypt.hash(password, 12);

  const user = await prisma.user.create({
    data: {
      name:     'System Admin',
      email,
      password: hashed,
      role:     'superadmin',
      status:   'active',
      orgId:    defaultOrg.id,
    },
  });

  console.log(`\n  Superadmin created successfully!`);
  console.log(`  Email:    ${email}`);
  console.log(`  Password: ${password}`);
  console.log(`  ID:       ${user.id}`);
  console.log(`  Org:      ${defaultOrg.name} (${defaultOrg.id})\n`);
  console.log(`  *** Change the password after first login! ***\n`);
}

main()
  .catch((e) => {
    console.error('Error seeding superadmin:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
