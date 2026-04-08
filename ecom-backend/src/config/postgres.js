/**
 * E-commerce PostgreSQL connection via Prisma Client.
 * Connects to the separate storeveu_ecom database.
 * Same singleton pattern as POS backend.
 */

import { PrismaClient } from '@prisma/client';

const globalForPrisma = global;

const prisma =
  globalForPrisma.__ecomPrisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['warn', 'error']
        : ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__ecomPrisma = prisma;
}

export const connectPostgres = async () => {
  if (!process.env.DATABASE_URL) {
    console.log('⚠ DATABASE_URL not set — ecom database disabled');
    return false;
  }
  try {
    await prisma.$connect();
    console.log('✓ E-commerce PostgreSQL connected');
    return true;
  } catch (err) {
    console.error('✗ E-commerce PostgreSQL connection error:', err.message);
    return false;
  }
};

export const disconnectPostgres = async () => {
  await prisma.$disconnect();
};

export default prisma;
