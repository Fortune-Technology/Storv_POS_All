/**
 * Barrel — re-exports every public handler from the scanData controller
 * sub-modules so route files can keep importing from the original
 * `controllers/scanDataController.ts` shim path. Maintains backward
 * compatibility for every existing import. (S80 — refactor pass D, S53 pattern.)
 *
 * Domain layout:
 *   manufacturers.ts → mfr catalog read
 *   enrollments.ts   → per-store × mfr-feed configuration
 *   mappings.ts      → tobacco product → mfr feed mapping
 *   submissions.ts   → daily file submission log + manual replay + ack reconciliation
 *   cert.ts          → certification harness + checklist + playbook + scenarios
 */

export { listManufacturers } from './manufacturers.js';

export {
  listEnrollments,
  getEnrollment,
  upsertEnrollment,
  updateEnrollmentStatus,
  deleteEnrollment,
  testEnrollmentConnection,
} from './enrollments.js';

export {
  listProductMappings,
  upsertProductMapping,
  bulkUpsertProductMappings,
  deleteProductMapping,
  listTobaccoProducts,
} from './mappings.js';

export {
  listSubmissions,
  regenerateSubmission,
  downloadSubmission,
  processSubmissionAck,
  getSubmissionAckLines,
  getSubmissionStats,
} from './submissions.js';

export {
  generateCertSampleFile,
  getEnrollmentCertChecklist,
  getCertPlaybook,
  getCertScenarios,
} from './cert.js';
