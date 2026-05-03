/**
 * certPlaybook.ts — Per-mfr cert guide content (Session 49).
 *
 * Each manufacturer has its own cert process — different contacts, different
 * sample-file requirements, different rejection codes. The portal CertModal
 * shows the relevant playbook alongside the checklist so admins know what to
 * do next without leaving the app.
 *
 * Content is best-effort based on publicly-known documentation. Admins
 * should update these descriptions during cert as they learn the actual
 * mfr-specific quirks.
 */

export interface RejectCodeRef {
  code: string;
  meaning: string;
  fix: string;
}

export interface Playbook {
  code: 'itg' | 'altria' | 'rjr';
  name: string;
  overview: string;
  contactPath: string;
  estimatedDuration: string;
  steps: string[];
  commonRejects: RejectCodeRef[];
  notes: string;
}

export interface PlaybookListing {
  code: string;
  name: string;
  estimatedDuration: string;
}

const PLAYBOOKS: Record<'itg' | 'altria' | 'rjr', Playbook> = {
  // ── ITG Brands ───────────────────────────────────────────────────────────
  itg: {
    code: 'itg',
    name: 'ITG Brands',
    overview:
      'ITG is the most forgiving cert process — most retailers complete it in 2-4 weeks. Line-level errors don\'t reject the whole batch (unlike Altria), so you get clear per-line feedback in their ack files. Recommended as your first cert target.',
    contactPath:
      'Contact your ITG Trade Marketing rep, or email retailer.support@itgbrands.com to start the cert process.',
    estimatedDuration: '2-4 weeks',
    steps: [
      'Email ITG with your retailer name, store count, and POS vendor (Storeveu).',
      'ITG sends back a UAT SFTP credential set + your assigned retailer ID + spec doc (currently v2.x).',
      'Update the enrollment with the SFTP host, username, password, and retailer ID. Set environment to UAT.',
      'Map at least 5 ITG products in the Tobacco Catalog (Winston / Kool / Salem / Maverick / USA Gold).',
      'Generate a sample file via the cert harness. Manually SFTP-put it into the UAT host.',
      'ITG reviews the file, returns an ack within 1-3 business days. Paste the ack into the SubmissionDetailModal to run reconciliation.',
      'Fix any rejected lines, regenerate, resubmit. Repeat until 100% accepted across multiple test days.',
      'When ITG confirms cert pass via email, flip the enrollment from UAT to PRODUCTION and status to ACTIVE.',
    ],
    commonRejects: [
      { code: 'E101', meaning: 'Invalid UPC format', fix: 'Check that all UPCs are 12 digits with leading zeros, not EAN-13 with a leading "0" prefix that didn\'t collapse.' },
      { code: 'E102', meaning: 'Brand not in ITG catalog', fix: 'The product is mapped to ITG but the brandFamily field doesn\'t match an ITG brand. Cross-reference TobaccoManufacturer.brandFamilies.' },
      { code: 'E201', meaning: 'Missing required field', fix: 'Header or trailer is missing a required column. Check the format spec doc against the formatter output.' },
    ],
    notes:
      'ITG sends acks via SFTP /ack/ directory once the SFTP poller is wired up. During cert, they often email you the ack instead — paste the email contents into the SubmissionDetailModal\'s manual ack field.',
  },

  // ── Altria PMUSA / USSTC / Middleton ────────────────────────────────────
  altria: {
    code: 'altria',
    name: 'Altria (PMUSA / USSTC / Middleton)',
    overview:
      'Altria is the most rigorous cert process — typically 4-8 weeks. Their strict-batch rule rejects the entire submission if ANY single record fails validation, so cert work focuses on getting field positions and mandatory fields exactly right. Each sub-feed (PMUSA cigarettes, USSTC smokeless, Middleton cigars) is a separate cert track with its own SFTP host.',
    contactPath:
      'Submit a cert request via the Altria Retail Trade portal at altria-retailtrade.com. Each sub-feed (PMUSA / USSTC / Middleton) requires a separate enrollment.',
    estimatedDuration: '4-8 weeks per sub-feed',
    steps: [
      'Sign in to altria-retailtrade.com and open a cert request for the sub-feed (PMUSA, USSTC, or Middleton).',
      'Altria sends back UAT SFTP credentials (DIFFERENT for each sub-feed) + a 7-digit retailer code + the current spec doc (PMUSA-3.5+).',
      'Create THREE enrollments — one per sub-feed — and configure each separately. They share the retailer code but have different SFTP hosts and product catalogs.',
      'Map at least 10 products per sub-feed for thorough cert coverage. PMUSA = Marlboro family + L&M + Parliament + Virginia Slims + Basic + Chesterfield. USSTC = Copenhagen + Skoal + Husky + Red Seal. Middleton = Black & Mild.',
      'Generate sample files for each sub-feed and submit them via SFTP to the corresponding UAT host.',
      'Altria runs strict validation — if ANY record has a bad field, the WHOLE batch is rejected with batchAccepted=N. The reconciliation engine auto-flips all "accepted" lines to "rejected" with code BATCH_REJECTED in this case.',
      'Fix EVERY rejected line, then resubmit. Each batch must be 100% clean for cert pass.',
      'After 3-5 consecutive clean days, Altria sends a cert-pass email. Flip each enrollment to PRODUCTION + ACTIVE.',
    ],
    commonRejects: [
      { code: 'BATCH_REJECTED', meaning: 'Entire batch rejected', fix: 'Look at the FIRST failing line — that\'s usually the root cause. Common culprits: missing description column (the formatter\'s "S" record needs all 22 fields), wrong date format (must be YYYY-MM-DD), wrong feed-code in header.' },
      { code: 'E202', meaning: 'Missing age verification', fix: 'Tobacco line in a tx without ageVerifications populated. The cashier-app must call AgeVerificationModal before adding tobacco lines, and the resulting age must be in tx.ageVerifications.' },
      { code: 'E303', meaning: 'Quantity exceeds threshold', fix: 'Altria flags single-tx tobacco qty > 50 as suspicious. Real audit trail required — usually a clerical issue at the cashier.' },
      { code: 'E450', meaning: 'Discount field mismatch', fix: 'buydownAmount + multipackAmount + mfrCouponAmount + retailerCouponAmount + loyaltyAmount must equal (retailPrice × qty − netLine). Check the formatter\'s discount split logic.' },
    ],
    notes:
      'Altria is unforgiving — every cert submission MUST be a complete 24-hour day with at least one tx of every required scenario type. The cert harness covers all 9 scenarios; submit it as your first sample to demonstrate format compliance.',
  },

  // ── RJR / RAI ────────────────────────────────────────────────────────────
  rjr: {
    code: 'rjr',
    name: 'RJR / RAI Trade Marketing',
    overview:
      'RJR cert takes 3-6 weeks per program. They run three parallel programs with separate cert tracks: EDLP (funded promos — mandatory if you accept any RJR shelf-price funding), Scan Data (POS reporting only — usually quick), VAP (smokeless / Camel Snus). Each is a fixed-width feed with byte-precise field positions.',
    contactPath:
      'Email scandata@rjrt.com with your retailer info to start cert. Their Jacksonville data center handles all 3 programs but cert tracks are independent.',
    estimatedDuration: '3-6 weeks per program',
    steps: [
      'Email Jacksonville with retailer name, store count, POS vendor (Storeveu), and which programs you want (EDLP / Scan Data / VAP).',
      'RJR returns UAT SFTP credentials + your retailer ID. Each program has its own SFTP path within the same host.',
      'Create one enrollment per program. EDLP and Scan Data share product catalogs; VAP is smokeless-only.',
      'Map RJR products — Camel + Newport + Pall Mall for EDLP/Scan; Grizzly + Camel Snus for VAP.',
      'Generate sample files for each enrolled program. RJR\'s fixed-width format is byte-precise, so always inspect the file via the Download link before uploading — column alignment is the #1 cert failure cause.',
      'Submit via SFTP. RJR responds within 24-48h with a fixed-width ack file.',
      'RJR\'s strict-batch rule applies: if more than 5%% of lines fail, the batch is rejected entirely. The reconciliation engine treats this as batchAccepted=R and flips accepted lines.',
      'Fix rejected fields, resubmit. Once 5+ consecutive clean days, RJR confirms cert pass.',
    ],
    commonRejects: [
      { code: 'COLUMN_OFFSET', meaning: 'Field starts at wrong column', fix: 'The fixed-width formatter has byte positions documented in rjrEdlp.ts header. If RJR\'s spec was updated, edit the rjrEdlp.ts padding widths to match.' },
      { code: 'AMT_FORMAT', meaning: 'Amount field not zero-padded cents', fix: 'All amounts must be cents zero-padded (e.g. $1.99 → 00000199). Check fixedAmt() in formatters/common.ts.' },
      { code: 'QTY_PRECISION', meaning: 'Quantity precision wrong', fix: 'RJR requires 3-decimal qty × 1000 (qty=2 → 00002000, qty=0.5 → 00000500). The formatter does this; check the multiplication wasn\'t skipped.' },
    ],
    notes:
      'RJR\'s ack format is also fixed-width. The rjr.ts parser reads from byte positions documented in its file header. If RJR\'s ack spec is updated, the slicing offsets need to be adjusted.',
  },
};

/**
 * Resolve the playbook for a manufacturer code. Sub-feeds (altria_pmusa,
 * rjr_edlp, etc.) all share their parent's playbook since the cert process
 * is conducted at the parent-mfr level.
 */
export function getPlaybook(mfrCode: string | null | undefined): Playbook | null {
  if (mfrCode?.startsWith('altria_')) return PLAYBOOKS.altria;
  if (mfrCode?.startsWith('rjr_'))    return PLAYBOOKS.rjr;
  if (mfrCode === 'itg')              return PLAYBOOKS.itg;
  return null;
}

export function listAvailablePlaybooks(): PlaybookListing[] {
  return Object.values(PLAYBOOKS).map(
    (p: Playbook): PlaybookListing => ({
      code: p.code,
      name: p.name,
      estimatedDuration: p.estimatedDuration,
    }),
  );
}
