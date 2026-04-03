/**
 * PostgreSQL connection via Prisma Client
 *
 * Single shared instance — safe for Node.js process.
 * During development, avoids creating a new client on every hot reload
 * by caching the instance on the global object.
 */

import { PrismaClient } from '@prisma/client';

const globalForPrisma = global;

const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'warn', 'error']
        : ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

/**
 * Connect to PostgreSQL. Call once on server startup.
 * Returns true on success, false if DATABASE_URL is not set or connection fails.
 */
export const connectPostgres = async () => {
  if (!process.env.DATABASE_URL) {
    console.log('⚠ DATABASE_URL not set — PostgreSQL disabled');
    return false;
  }

  try {
    await prisma.$connect();
    console.log('✓ PostgreSQL connected successfully');
    return true;
  } catch (err) {
    console.error('✗ PostgreSQL connection error:', err.message);
    console.log('⚠ Running without PostgreSQL — catalog features disabled');
    return false;
  }
};

/**
 * Graceful disconnect — call on process exit.
 */
export const disconnectPostgres = async () => {
  await prisma.$disconnect();
};

export default prisma;
