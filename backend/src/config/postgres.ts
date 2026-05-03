/**
 * PostgreSQL connection via Prisma Client
 *
 * Single shared instance — safe for Node.js process.
 * During development, avoids creating a new client on every hot reload
 * by caching the instance on the global object.
 *
 * Type note (Round 5 of the JS→TS migration): the default export is typed
 * as `any` rather than `PrismaClient`. Every controller and service that
 * imports `prisma` already runs against the `any`-shaped client (because
 * the original .js export inferred to `any` via the `globalForPrisma.prisma`
 * fallback). Converting to the strict `PrismaClient` here would surface
 * ~280 pre-existing-but-masked type mismatches across 24 already-finished
 * files — outside the scope of this migration. Tightening the public
 * surface is queued as a standalone follow-up; for now we preserve
 * runtime + compile-time semantics so every prior slice keeps compiling.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { PrismaClient } from '@prisma/client';

type GlobalWithPrisma = typeof globalThis & { prisma?: any };
const globalForPrisma = globalThis as GlobalWithPrisma;

const prisma: any =
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
export const connectPostgres = async (): Promise<boolean> => {
  if (!process.env.DATABASE_URL) {
    console.log('⚠ DATABASE_URL not set — PostgreSQL disabled');
    return false;
  }

  try {
    await prisma.$connect();
    console.log('✓ PostgreSQL connected successfully');
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('✗ PostgreSQL connection error:', msg);
    console.log('⚠ Running without PostgreSQL — catalog features disabled');
    return false;
  }
};

/**
 * Graceful disconnect — call on process exit.
 */
export const disconnectPostgres = async (): Promise<void> => {
  await prisma.$disconnect();
};

export default prisma;
