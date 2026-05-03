/**
 * Notifications — outbound communication channels.
 *
 *   email.ts  — branded HTML emails (auth, invitations, contact form,
 *               scan-data ack rejections, etc.). Uses nodemailer.
 *   sms.ts    — Twilio-ready stub (dynamic import; activates when
 *               TWILIO_* env vars are filled in and `npm i twilio` runs).
 *
 * Both keep the `service`/`Service`-suffixed legacy import paths alive via
 * top-level shims at `services/emailService.ts` + `services/smsService.ts`.
 */

export * from './email.js';
export * from './sms.js';
export * from './notify.js';
