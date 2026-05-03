/**
 * certChecklist.ts — Derives per-enrollment cert state from the DB (Session 49).
 *
 * Walks an enrollment + its dependencies (SFTP creds, product mappings,
 * recent submissions, last ack) and reports a step-by-step cert checklist.
 * The portal CertModal renders this as a green/amber/grey progress list.
 *
 * Steps are mfr-agnostic — the playbook text is per-mfr in certPlaybook.ts.
 */

import prisma from '../../config/postgres.js';

export type StepStatus = 'done' | 'pending' | 'warning';

export interface ChecklistStep {
  key: string;
  label: string;
  status: StepStatus;
  detail?: string;
  action?: { label: string; hint: string } | null;
}

export interface ChecklistEnrollment {
  id: string;
  status: string;
  environment: string;
  mfrRetailerId: string | null;
  mfrChainId: string | null;
  sftpHost: string | null;
  certifiedAt: Date | null;
  enrolledAt: Date | null;
}

export interface ChecklistManufacturer {
  id: string;
  code: string;
  name: string;
  shortName: string | null;
  parentMfrCode: string | null;
  brandFamilies: string[];
}

export interface ChecklistStats {
  mappingCount: number;
  brandFamiliesCovered: number;
  brandFamiliesAvailable: number;
  lastSubmissionAt: Date | null;
  lastAckAt: Date | null;
  recentRejectedCount: number;
}

export interface ChecklistResult {
  enrollment: ChecklistEnrollment;
  manufacturer: ChecklistManufacturer;
  overallProgress: number;
  readyToActivate: boolean;
  steps: ChecklistStep[];
  stats: ChecklistStats;
}

const STEP_LABELS = [
  { key: 'mfr_retailer_id', label: 'Manufacturer retailer ID set' },
  { key: 'sftp_credentials', label: 'SFTP credentials configured' },
  { key: 'environment_uat', label: 'Environment set to UAT' },
  { key: 'product_mappings', label: 'At least 5 product mappings configured' },
  { key: 'brand_coverage',   label: 'Multiple brand families mapped' },
  { key: 'sample_submitted', label: 'Sample submission generated' },
  { key: 'real_submission',  label: 'Real (non-cert) submission uploaded' },
  { key: 'ack_received',     label: 'Manufacturer ack received' },
  { key: 'no_recent_rejects', label: 'No rejected lines in last 7 days' },
  { key: 'ready_for_prod',   label: 'Status flipped to active (production-ready)' },
];

export async function getChecklist(
  { orgId, enrollmentId }: { orgId: string; enrollmentId: string },
): Promise<ChecklistResult> {
  const enrollment = await prisma.scanDataEnrollment.findFirst({
    where: { id: enrollmentId, orgId },
    include: { manufacturer: true },
  });
  if (!enrollment) throw new Error('Enrollment not found');

  // Derive each step's status from the DB
  const steps: ChecklistStep[] = [];

  // 1. mfrRetailerId
  steps.push({
    key: 'mfr_retailer_id',
    label: STEP_LABELS[0].label,
    status: enrollment.mfrRetailerId ? 'done' : 'pending',
    detail: enrollment.mfrRetailerId
      ? `Retailer ID: ${enrollment.mfrRetailerId}`
      : 'Required by every mfr to associate submissions with your account.',
    action: enrollment.mfrRetailerId ? null : { label: 'Edit Enrollment', hint: 'Open the enrollment and add the retailer ID assigned by the mfr.' },
  });

  // 2. SFTP credentials
  const sftpReady = Boolean(enrollment.sftpHost && enrollment.sftpUsername && enrollment.sftpPasswordEnc);
  steps.push({
    key: 'sftp_credentials',
    label: STEP_LABELS[1].label,
    status: sftpReady ? 'done' : 'pending',
    detail: sftpReady
      ? `Host: ${enrollment.sftpHost} (port ${enrollment.sftpPort || 22})`
      : 'Need host, username, and password before automated nightly submissions can run.',
    action: sftpReady ? { label: 'Test Connection', hint: 'Verify host + creds reach the mfr.' } : { label: 'Edit Enrollment', hint: 'Add SFTP host, username, and password.' },
  });

  // 3. Environment = UAT (during cert)
  steps.push({
    key: 'environment_uat',
    label: STEP_LABELS[2].label,
    status: enrollment.environment === 'uat' ? 'done' : 'warning',
    detail: enrollment.environment === 'uat'
      ? 'Cert traffic should target the mfr\'s UAT host.'
      : 'Currently set to PRODUCTION. Mfr will reject cert submissions sent to prod. Switch to UAT until cert passes.',
    action: enrollment.environment === 'uat' ? null : { label: 'Edit Enrollment', hint: 'Change environment to UAT.' },
  });

  // 4. Product mappings
  const mappingCount = await prisma.tobaccoProductMap.count({
    where: { orgId, manufacturerId: enrollment.manufacturerId, active: true },
  });
  steps.push({
    key: 'product_mappings',
    label: STEP_LABELS[3].label,
    status: mappingCount >= 5 ? 'done' : mappingCount > 0 ? 'warning' : 'pending',
    detail: mappingCount >= 5
      ? `${mappingCount} active mapping(s) for this mfr feed.`
      : mappingCount > 0
        ? `Only ${mappingCount} product(s) mapped — recommend at least 5 across different brand families.`
        : 'No tobacco products mapped to this mfr yet. Without mappings, generated files will be empty.',
    action: { label: 'Manage Mappings', hint: 'Open the Tobacco Catalog tab and tag products.' },
  });

  // 5. Brand-family coverage
  const distinctBrands = await prisma.tobaccoProductMap.groupBy({
    where: { orgId, manufacturerId: enrollment.manufacturerId, active: true },
    by: ['brandFamily'],
  });
  const brandsCovered = distinctBrands.length;
  const totalBrands = (enrollment.manufacturer.brandFamilies || []).length;
  steps.push({
    key: 'brand_coverage',
    label: STEP_LABELS[4].label,
    status: brandsCovered >= 3 ? 'done' : brandsCovered > 0 ? 'warning' : 'pending',
    detail: brandsCovered === 0
      ? `0 brand families mapped. Mfr supports ${totalBrands} brand familie(s).`
      : `${brandsCovered}/${totalBrands} brand families mapped.`,
  });

  // 6. Sample submission generated
  const hasAnySubmission = await prisma.scanDataSubmission.findFirst({
    where: { orgId, storeId: enrollment.storeId, manufacturerId: enrollment.manufacturerId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, fileName: true, createdAt: true },
  });
  steps.push({
    key: 'sample_submitted',
    label: STEP_LABELS[5].label,
    status: hasAnySubmission ? 'done' : 'pending',
    detail: hasAnySubmission
      ? `Last file: ${hasAnySubmission.fileName} (${new Date(hasAnySubmission.createdAt).toLocaleDateString()})`
      : 'Generate a synthetic sample file using the cert harness, then submit it to the mfr UAT manually.',
    action: hasAnySubmission ? null : { label: 'Generate Sample File', hint: 'Builds a representative file in-memory without touching real tx data.' },
  });

  // 7. Real (non-cert) submission with successful upload
  const realUploaded = await prisma.scanDataSubmission.findFirst({
    where: {
      orgId, storeId: enrollment.storeId, manufacturerId: enrollment.manufacturerId,
      status: { in: ['uploaded', 'acknowledged'] },
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, uploadedAt: true, fileName: true },
  });
  steps.push({
    key: 'real_submission',
    label: STEP_LABELS[6].label,
    status: realUploaded ? 'done' : 'pending',
    detail: realUploaded
      ? `Uploaded ${realUploaded.uploadedAt ? new Date(realUploaded.uploadedAt).toLocaleString() : 'recently'}.`
      : 'No successful upload yet. Manual upload during cert: download the cert sample file and SFTP-put it yourself.',
  });

  // 8. Ack received
  const ackedSubmission = await prisma.scanDataSubmission.findFirst({
    where: {
      orgId, storeId: enrollment.storeId, manufacturerId: enrollment.manufacturerId,
      ackedAt: { not: null },
    },
    orderBy: { ackedAt: 'desc' },
    select: { id: true, ackedAt: true, acceptedCount: true, rejectedCount: true },
  });
  steps.push({
    key: 'ack_received',
    label: STEP_LABELS[7].label,
    status: ackedSubmission ? 'done' : 'pending',
    detail: ackedSubmission
      ? `Last ack: ${ackedSubmission.ackedAt ? new Date(ackedSubmission.ackedAt).toLocaleString() : 'recently'} — ${ackedSubmission.acceptedCount}✓ / ${ackedSubmission.rejectedCount}✗`
      : 'Mfr hasn\'t responded with an ack file yet. During cert, this can take days. Use the Submission Detail modal to paste an ack manually if the mfr delivers via email.',
  });

  // 9. No rejected lines in last 7 days
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const recentRejected = await prisma.scanDataSubmission.aggregate({
    where: {
      orgId, storeId: enrollment.storeId, manufacturerId: enrollment.manufacturerId,
      ackedAt: { gte: sevenDaysAgo },
    },
    _sum: { rejectedCount: true },
  });
  const recentRejectedCount = recentRejected._sum.rejectedCount || 0;
  steps.push({
    key: 'no_recent_rejects',
    label: STEP_LABELS[8].label,
    status: !ackedSubmission ? 'pending' : recentRejectedCount === 0 ? 'done' : 'warning',
    detail: !ackedSubmission
      ? 'Awaiting first ack to evaluate.'
      : recentRejectedCount === 0
        ? 'Last 7 days of submissions had zero line rejections.'
        : `${recentRejectedCount} line(s) rejected in the last 7 days. Review the Submissions tab and fix the underlying data before activating.`,
  });

  // 10. Status = active
  steps.push({
    key: 'ready_for_prod',
    label: STEP_LABELS[9].label,
    status: enrollment.status === 'active' ? 'done' : 'pending',
    detail: enrollment.status === 'active'
      ? 'Enrollment is live and producing nightly submissions.'
      : `Current status: ${enrollment.status}. Flip to "active" only after all checks above are green.`,
    action: enrollment.status === 'active' ? null : { label: 'Mark Active', hint: 'Only do this once the mfr has confirmed cert pass.' },
  });

  // Aggregate
  const doneCount = steps.filter((s: ChecklistStep) => s.status === 'done').length;
  const overallProgress = Math.round((doneCount / steps.length) * 100);
  const readyToActivate = steps.slice(0, 9).every((s: ChecklistStep) => s.status === 'done');

  return {
    enrollment: {
      id: enrollment.id,
      status: enrollment.status,
      environment: enrollment.environment,
      mfrRetailerId: enrollment.mfrRetailerId,
      mfrChainId: enrollment.mfrChainId,
      sftpHost: enrollment.sftpHost,
      certifiedAt: enrollment.certifiedAt,
      enrolledAt: enrollment.enrolledAt,
    },
    manufacturer: {
      id: enrollment.manufacturer.id,
      code: enrollment.manufacturer.code,
      name: enrollment.manufacturer.name,
      shortName: enrollment.manufacturer.shortName,
      parentMfrCode: enrollment.manufacturer.parentMfrCode,
      brandFamilies: enrollment.manufacturer.brandFamilies,
    },
    overallProgress,
    readyToActivate,
    steps,
    stats: {
      mappingCount,
      brandFamiliesCovered: brandsCovered,
      brandFamiliesAvailable: totalBrands,
      lastSubmissionAt: hasAnySubmission?.createdAt || null,
      lastAckAt: ackedSubmission?.ackedAt || null,
      recentRejectedCount,
    },
  };
}
