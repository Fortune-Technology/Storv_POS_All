/**
 * Global type declarations for the backend.
 *
 * Currently a placeholder — the backend doesn't import CSS, image, or other
 * non-JS asset types. As the migration progresses, augment Express's `Request`
 * type here for things like `req.user`, `req.orgId`, `req.storeId`, etc. that
 * middleware attaches.
 *
 * Example (don't enable until middleware/auth.ts is converted):
 *
 * declare global {
 *   namespace Express {
 *     interface Request {
 *       user?: import('@prisma/client').User;
 *       orgId?: string;
 *       storeId?: string;
 *       role?: string;
 *     }
 *   }
 * }
 *
 * export {};
 */

// Empty for now — concrete augmentations land in slice 4c (middleware).
export {};
