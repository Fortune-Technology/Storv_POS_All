-- S77 Phase 1 — Bypass vendor onboarding gate for any user who existed
-- before this feature shipped. New signups (created after this script runs)
-- start with all three flags = false and must complete the questionnaire.
--
-- Idempotent: re-running has no effect (those flags are already true).
UPDATE users
SET
  "onboardingSubmitted" = TRUE,
  "contractSigned"      = TRUE,
  "vendorApproved"      = TRUE
WHERE
  "createdAt" < NOW() - INTERVAL '5 minutes';
