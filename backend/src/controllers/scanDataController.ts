/**
 * scanDataController — split into `controllers/scanData/` folder (S80, refactor
 * pass D, S53 pattern). This file is now a 1-line shim so every existing
 * `import { ... } from '../controllers/scanDataController.js'` keeps working.
 *
 * Original 837-line file is split across:
 *   - scanData/helpers.ts
 *   - scanData/manufacturers.ts
 *   - scanData/enrollments.ts   (incl. testEnrollmentConnection)
 *   - scanData/mappings.ts      (incl. listTobaccoProducts)
 *   - scanData/submissions.ts   (incl. processSubmissionAck + getSubmissionStats)
 *   - scanData/cert.ts
 *   - scanData/index.ts         (barrel)
 */

export * from './scanData/index.js';
