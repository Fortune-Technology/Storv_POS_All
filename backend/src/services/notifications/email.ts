/**
 * Centralized Email Service
 * All email sending flows go through this service.
 */
import nodemailer, { type Transporter } from 'nodemailer';

// ─── Transporter (lazy singleton) ────────────────────────────────────────────
let _transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (_transporter) return _transporter;
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) return null;

  _transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return _transporter;
}

// ─── Core send (non-blocking, never throws) ──────────────────────────────────
async function sendMail(to: string, subject: string, html: string): Promise<boolean> {
  const transporter = getTransporter();
  if (!transporter) {
    console.warn('[Email] SMTP not configured skipping:', subject);
    return false;
  }
  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject,
      html,
    });
    console.log(`[Email] Sent "${subject}" → ${to}`);
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[Email] Failed "${subject}" → ${to}:`, message);
    return false;
  }
}

// ─── Branded wrapper ─────────────────────────────────────────────────────────
function wrap(title: string, body: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body { margin:0; padding:0; background:#f8fafc; font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif; }
  .container { max-width:560px; margin:24px auto; background:#fff; border-radius:12px; border:1px solid #e2e8f0; overflow:hidden; }
  .header { background:linear-gradient(135deg,#3d56b5,#7b95e0); padding:28px 32px; text-align:center; }
  .header h1 { margin:0; color:#fff; font-size:22px; font-weight:600; letter-spacing:0.3px; }
  .body { padding:32px; color:#334155; font-size:15px; line-height:1.7; }
  .body h2 { margin:0 0 16px; color:#0f172a; font-size:18px; }
  .btn { display:inline-block; padding:12px 28px; background:#3d56b5; color:#fff !important; text-decoration:none; border-radius:8px; font-weight:600; font-size:14px; margin:16px 0; }
  .footer { padding:20px 32px; text-align:center; font-size:12px; color:#94a3b8; border-top:1px solid #f1f5f9; }
  .muted { color:#94a3b8; font-size:13px; }
</style>
</head><body>
<div class="container">
  <div class="header"><h1>${title}</h1></div>
  <div class="body">${body}</div>
  <div class="footer">&copy; ${new Date().getFullYear()} Storeveu &middot; Point of Sale</div>
</div>
</body></html>`;
}

// ─── Template functions ──────────────────────────────────────────────────────

export async function sendForgotPassword(to: string, name: string | null | undefined, resetUrl: string): Promise<boolean> {
  const html = wrap('Reset Your Password', `
    <h2>Hi ${name || 'there'},</h2>
    <p>We received a request to reset your password. Click the button below to set a new one:</p>
    <p style="text-align:center"><a class="btn" href="${resetUrl}">Reset Password</a></p>
    <p class="muted">This link expires in 30 minutes. If you didn't request this, you can safely ignore this email.</p>
    <p class="muted" style="word-break:break-all;">Or copy this link: ${resetUrl}</p>
  `);
  return sendMail(to, 'Reset Your Password Storeveu', html);
}

export async function sendContactConfirmation(to: string, name: string | null | undefined): Promise<boolean> {
  const html = wrap('We Got Your Message', `
    <h2>Hi ${name || 'there'},</h2>
    <p>Thank you for reaching out! We've received your message and our team will get back to you within 1–2 business days.</p>
    <p>If your matter is urgent, feel free to reply directly to this email.</p>
  `);
  return sendMail(to, 'We received your message Storeveu', html);
}

export async function sendContactNotifyAdmin(
  name: string | null | undefined,
  email: string,
  subject: string,
  body: string,
): Promise<boolean> {
  const adminEmail = process.env.SUPPORT_EMAIL || process.env.SMTP_USER;
  if (!adminEmail) return false;
  const html = wrap('New Contact / Support Ticket', `
    <h2>New ticket received</h2>
    <table style="width:100%;font-size:14px;border-collapse:collapse;">
      <tr><td style="padding:6px 0;color:#94a3b8;width:80px">From</td><td style="padding:6px 0">${name || 'Anonymous'} &lt;${email}&gt;</td></tr>
      <tr><td style="padding:6px 0;color:#94a3b8">Subject</td><td style="padding:6px 0">${subject}</td></tr>
    </table>
    <div style="margin-top:16px;padding:16px;background:#f8fafc;border-radius:8px;font-size:14px;white-space:pre-wrap;">${body}</div>
  `);
  return sendMail(adminEmail, `[Support Ticket] ${subject}`, html);
}

export async function sendNewSignupNotifyAdmin(name: string, email: string): Promise<boolean> {
  const adminEmail = process.env.SUPPORT_EMAIL || process.env.SMTP_USER;
  if (!adminEmail) return false;
  const adminUrl = process.env.ADMIN_URL || 'http://localhost:5175';
  const html = wrap('New User Signup', `
    <h2>New registration pending review</h2>
    <p><strong>${name}</strong> (${email}) has signed up and is waiting for approval.</p>
    <p style="text-align:center"><a class="btn" href="${adminUrl}/users?status=pending">Review in Admin Panel</a></p>
  `);
  return sendMail(adminEmail, `[New Signup] ${name} is waiting for approval`, html);
}

export async function sendUserApproved(to: string, name: string | null | undefined): Promise<boolean> {
  const loginUrl = (process.env.FRONTEND_URL || 'http://localhost:5173') + '/login';
  const html = wrap('Account Approved!', `
    <h2>Welcome aboard, ${name || 'there'}!</h2>
    <p>Great news your Storeveu account has been approved. You can now log in and start managing your store.</p>
    <p style="text-align:center"><a class="btn" href="${loginUrl}">Log In to Storeveu</a></p>
  `);
  return sendMail(to, 'Your Storeveu account is approved!', html);
}

export async function sendUserRejected(to: string, name: string | null | undefined): Promise<boolean> {
  const html = wrap('Application Update', `
    <h2>Hi ${name || 'there'},</h2>
    <p>Thank you for your interest in Storeveu. After reviewing your application, we're unable to approve your account at this time.</p>
    <p>If you believe this was a mistake, please contact our support team.</p>
  `);
  return sendMail(to, 'Your Storeveu application update', html);
}

export async function sendUserSuspended(to: string, name: string | null | undefined): Promise<boolean> {
  const html = wrap('Account Suspended', `
    <h2>Hi ${name || 'there'},</h2>
    <p>Your Storeveu account has been suspended by an administrator. If you have questions, please contact support.</p>
  `);
  return sendMail(to, 'Your Storeveu account has been suspended', html);
}

export async function sendPasswordChanged(to: string, name: string | null | undefined): Promise<boolean> {
  const html = wrap('Password Changed', `
    <h2>Hi ${name || 'there'},</h2>
    <p>Your password was successfully changed. If you didn't make this change, please contact support immediately.</p>
  `);
  return sendMail(to, 'Your password was changed Storeveu', html);
}

// ─── S78: Implementation Engineer PIN templates ──────────────────────────────

export type ImplementationPinReason = 'granted' | 'rotated' | 'manual_rotate';

/**
 * Send the Implementation Engineer PIN. Fires at 3 lifecycle points:
 *   - granted        → admin just flipped canConfigureHardware true
 *   - rotated        → weekly scheduler rotated the PIN
 *   - manual_rotate  → user (or admin) clicked "Rotate Now" in the panel
 *
 * The PIN is shown in the email body. The user can also view the current
 * PIN at any time in the admin panel under "My Implementation PIN".
 */
export async function sendImplementationPinEmail(
  to: string,
  name: string | null | undefined,
  pin: string,
  reason: ImplementationPinReason,
): Promise<boolean> {
  const headline = reason === 'granted'
    ? 'Hardware Configuration Access Granted'
    : reason === 'manual_rotate'
      ? 'Your Implementation PIN was rotated'
      : 'Your weekly Implementation PIN has rotated';

  const intro = reason === 'granted'
    ? `<p>You've been granted hardware-configuration access on Storeveu. Use this PIN at the cashier register to unlock the Hardware Settings flow.</p>`
    : reason === 'manual_rotate'
      ? `<p>Your Implementation PIN has been rotated at your request. The previous PIN is no longer valid.</p>`
      : `<p>Your weekly Implementation PIN rotation has fired. The previous PIN is no longer valid.</p>`;

  const html = wrap(headline, `
    <h2>Hi ${escapeHtml(name || 'there')},</h2>
    ${intro}
    <p style="text-align:center;">
      <span style="display:inline-block; padding:18px 28px; font-size:2rem; letter-spacing:0.4em; font-weight:800; background:#0f172a; color:#fff; border-radius:10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;">${escapeHtml(pin)}</span>
    </p>
    <p class="muted">This PIN auto-rotates every Monday at 00:00 UTC. You'll receive a fresh email each week. You can also view your current PIN at any time on your Storeveu account page.</p>
    <p class="muted">Keep this PIN private. Don't share it with store staff — it's intended for internal implementation engineers only.</p>
  `);
  return sendMail(to, `[Storeveu] ${headline}`, html);
}

// ─── Invitation templates ────────────────────────────────────────────────────

export interface InvitationPayload {
  inviterName?: string | null;
  orgName: string;
  role: string;
  acceptUrl: string;
  existingAccount?: boolean;
}

/**
 * Invitation to join an organisation (new user OR existing user).
 * `role` is shown as the human-readable role the invitee will get on accept.
 */
export async function sendInvitation(
  to: string,
  { inviterName, orgName, role, acceptUrl, existingAccount }: InvitationPayload,
): Promise<boolean> {
  const html = wrap(`You're invited to ${orgName}`, `
    <h2>Hi there,</h2>
    <p><strong>${escapeHtml(inviterName || 'Someone')}</strong> has invited you to join <strong>${escapeHtml(orgName)}</strong> on Storeveu as <strong>${escapeHtml(role)}</strong>.</p>
    <p style="text-align:center"><a class="btn" href="${acceptUrl}">Accept Invitation</a></p>
    ${existingAccount
      ? `<p class="muted">You already have a Storeveu account with this email. Just sign in and the new organisation will appear in your store switcher.</p>`
      : `<p class="muted">Create your account in under a minute and you'll be signed in automatically.</p>`}
    <p class="muted">This invitation expires in 7 days. If you didn't expect this email, you can safely ignore it.</p>
    <p class="muted" style="word-break:break-all;">Or copy this link: ${acceptUrl}</p>
  `);
  return sendMail(to, `You're invited to ${orgName} on Storeveu`, html);
}

export interface TransferInvitationPayload {
  inviterName?: string | null;
  orgName: string;
  acceptUrl: string;
}

/**
 * Store transfer (org ownership handover). Makes the destructive nature
 * of the action clear.
 */
export async function sendTransferInvitation(
  to: string,
  { inviterName, orgName, acceptUrl }: TransferInvitationPayload,
): Promise<boolean> {
  const html = wrap(`Ownership transfer: ${orgName}`, `
    <h2>Hi there,</h2>
    <p><strong>${escapeHtml(inviterName || 'The current owner')}</strong> is transferring ownership of <strong>${escapeHtml(orgName)}</strong> to you on Storeveu.</p>
    <p>Accepting this invitation will make you the new owner. The current owner will lose access to this organisation.</p>
    <p style="text-align:center"><a class="btn" href="${acceptUrl}">Review &amp; Accept Transfer</a></p>
    <p class="muted">This invitation expires in 7 days. Only accept if you've agreed to take over this business account.</p>
    <p class="muted" style="word-break:break-all;">Or copy this link: ${acceptUrl}</p>
  `);
  return sendMail(to, `Ownership transfer pending: ${orgName}`, html);
}

export interface InvitationAcceptedPayload {
  inviterName?: string | null;
  inviteeName: string;
  orgName: string;
  role: string;
}

/**
 * Notify the inviter that their invitation was accepted.
 */
export async function sendInvitationAccepted(
  to: string,
  { inviterName, inviteeName, orgName, role }: InvitationAcceptedPayload,
): Promise<boolean> {
  const html = wrap('Invitation accepted', `
    <h2>Hi ${escapeHtml(inviterName || 'there')},</h2>
    <p><strong>${escapeHtml(inviteeName)}</strong> has accepted your invitation to join <strong>${escapeHtml(orgName)}</strong> as <strong>${escapeHtml(role)}</strong>.</p>
    <p class="muted">They now have access to the organisation and will appear in your user list.</p>
  `);
  return sendMail(to, `${inviteeName} joined ${orgName}`, html);
}

export interface TransferCompletedPayload {
  formerOwnerName?: string | null;
  newOwnerName: string;
  orgName: string;
}

/**
 * Notify the outgoing owner that their store transfer completed.
 */
export async function sendTransferCompleted(
  to: string,
  { formerOwnerName, newOwnerName, orgName }: TransferCompletedPayload,
): Promise<boolean> {
  const html = wrap(`Transfer complete: ${orgName}`, `
    <h2>Hi ${escapeHtml(formerOwnerName || 'there')},</h2>
    <p><strong>${escapeHtml(newOwnerName)}</strong> has accepted the ownership transfer of <strong>${escapeHtml(orgName)}</strong>.</p>
    <p>Your access to this organisation has been revoked as part of the transfer. If you believe this is a mistake, please contact support right away.</p>
  `);
  return sendMail(to, `Ownership transfer complete: ${orgName}`, html);
}

// ─── StoreVeu Exchange templates ────────────────────────────────────────────────

const PORTAL_URL = (): string => process.env.FRONTEND_URL || 'http://localhost:5173';
const money = (n: number | string | null | undefined): string => `$${(Number(n) || 0).toFixed(2)}`;

export interface PartnerHandshakeRequestPayload {
  requesterName: string;
  requesterCode?: string | null;
  partnerName: string;
  requestNote?: string | null;
}

export async function sendPartnerHandshakeRequest(
  to: string,
  { requesterName, requesterCode, partnerName, requestNote }: PartnerHandshakeRequestPayload,
): Promise<boolean> {
  const url = `${PORTAL_URL()}/portal/exchange?tab=partners`;
  const html = wrap('New trading partner request', `
    <h2>Hi there,</h2>
    <p><strong>${escapeHtml(requesterName)}</strong> (${escapeHtml(requesterCode || '')}) has requested to trade with <strong>${escapeHtml(partnerName)}</strong> on StoreVeu Exchange.</p>
    ${requestNote ? `<p style="padding:12px;background:#f8fafc;border-radius:8px;font-style:italic">"${escapeHtml(requestNote)}"</p>` : ''}
    <p>Once you accept, either store can send wholesale purchase orders to the other.</p>
    <p style="text-align:center"><a class="btn" href="${url}">Review Request</a></p>
    <p class="muted">Each merchant is solely responsible for their own licensing and compliance (liquor, tobacco, etc).</p>
  `);
  return sendMail(to, `New trading partner request from ${requesterName}`, html);
}

export interface PartnerHandshakeAcceptedPayload {
  requesterName: string;
  partnerName: string;
  partnerCode?: string | null;
}

export async function sendPartnerHandshakeAccepted(
  to: string,
  { requesterName, partnerName, partnerCode }: PartnerHandshakeAcceptedPayload,
): Promise<boolean> {
  const url = `${PORTAL_URL()}/portal/exchange?tab=orders`;
  const html = wrap('Partnership accepted!', `
    <h2>Good news, ${escapeHtml(requesterName)}!</h2>
    <p><strong>${escapeHtml(partnerName)}</strong> (${escapeHtml(partnerCode || '')}) has accepted your trading partner request.</p>
    <p>You can now send wholesale purchase orders to each other.</p>
    <p style="text-align:center"><a class="btn" href="${url}">Create a Wholesale Order</a></p>
  `);
  return sendMail(to, `${partnerName} accepted your trading request`, html);
}

export interface WholesaleOrderReceivedPayload {
  orderNumber: string;
  senderName: string;
  senderCode?: string | null;
  grandTotal: number | string;
  expiresAt?: Date | string | null;
}

export async function sendWholesaleOrderReceived(
  to: string,
  { orderNumber, senderName, senderCode, grandTotal, expiresAt }: WholesaleOrderReceivedPayload,
): Promise<boolean> {
  const url = `${PORTAL_URL()}/portal/exchange?tab=orders&direction=incoming`;
  const expires = expiresAt ? new Date(expiresAt).toLocaleDateString() : null;
  const html = wrap('New wholesale order received', `
    <h2>Action required</h2>
    <p>You've received a new wholesale purchase order from <strong>${escapeHtml(senderName)}</strong> (${escapeHtml(senderCode || '')}).</p>
    <table style="width:100%;font-size:14px;margin:16px 0;border-collapse:collapse;">
      <tr><td style="padding:8px 0;color:#94a3b8">Order #</td><td style="padding:8px 0"><strong>${escapeHtml(orderNumber)}</strong></td></tr>
      <tr><td style="padding:8px 0;color:#94a3b8">Total</td><td style="padding:8px 0"><strong>${money(grandTotal)}</strong></td></tr>
      ${expires ? `<tr><td style="padding:8px 0;color:#94a3b8">Expires</td><td style="padding:8px 0">${expires}</td></tr>` : ''}
    </table>
    <p>Review the order, adjust received quantities if needed, and confirm to move the inventory into your store.</p>
    <p style="text-align:center"><a class="btn" href="${url}">Review Order</a></p>
  `);
  return sendMail(to, `[Exchange] New order ${orderNumber} from ${senderName}`, html);
}

export interface WholesaleOrderConfirmedPayload {
  orderNumber: string;
  receiverName: string;
  grandTotal: number | string;
  status?: string | null;
}

export async function sendWholesaleOrderConfirmed(
  to: string,
  { orderNumber, receiverName, grandTotal, status }: WholesaleOrderConfirmedPayload,
): Promise<boolean> {
  const label = status === 'partially_confirmed' ? 'Partially confirmed' : 'Confirmed';
  const url = `${PORTAL_URL()}/portal/exchange?tab=balances`;
  const html = wrap(`Order ${label}`, `
    <h2>Order ${escapeHtml(orderNumber)} — ${label}</h2>
    <p><strong>${escapeHtml(receiverName)}</strong> has ${label.toLowerCase()} your wholesale order.</p>
    <p style="font-size:20px;margin:16px 0"><strong>${money(grandTotal)}</strong> added to your partner ledger as a credit.</p>
    <p style="text-align:center"><a class="btn" href="${url}">View Partner Balances</a></p>
  `);
  return sendMail(to, `[Exchange] Order ${orderNumber} ${label.toLowerCase()}`, html);
}

export interface WholesaleOrderRejectedPayload {
  orderNumber: string;
  receiverName: string;
  reason?: string | null;
}

export async function sendWholesaleOrderRejected(
  to: string,
  { orderNumber, receiverName, reason }: WholesaleOrderRejectedPayload,
): Promise<boolean> {
  const html = wrap('Order rejected', `
    <h2>Order ${escapeHtml(orderNumber)} — rejected</h2>
    <p><strong>${escapeHtml(receiverName)}</strong> has declined your wholesale order.</p>
    ${reason ? `<p style="padding:12px;background:#fef2f2;border-left:3px solid #ef4444;border-radius:4px">Reason: ${escapeHtml(reason)}</p>` : ''}
    <p class="muted">No inventory moved. No ledger entry was created.</p>
  `);
  return sendMail(to, `[Exchange] Order ${orderNumber} rejected`, html);
}

export interface WholesaleOrderCancelledPayload {
  orderNumber: string;
  senderName: string;
  reason?: string | null;
}

export async function sendWholesaleOrderCancelled(
  to: string,
  { orderNumber, senderName, reason }: WholesaleOrderCancelledPayload,
): Promise<boolean> {
  const html = wrap('Order cancelled', `
    <h2>Order ${escapeHtml(orderNumber)} — cancelled</h2>
    <p><strong>${escapeHtml(senderName)}</strong> has cancelled the wholesale order they sent you.</p>
    ${reason ? `<p style="padding:12px;background:#fff7ed;border-left:3px solid #f59e0b;border-radius:4px">Reason: ${escapeHtml(reason)}</p>` : ''}
    <p class="muted">No action required.</p>
  `);
  return sendMail(to, `[Exchange] Order ${orderNumber} cancelled`, html);
}

export interface WholesaleOrderEditedPayload {
  orderNumber: string;
  senderName: string;
  grandTotal: number | string;
}

export async function sendWholesaleOrderEdited(
  to: string,
  { orderNumber, senderName, grandTotal }: WholesaleOrderEditedPayload,
): Promise<boolean> {
  const url = `${PORTAL_URL()}/portal/exchange?tab=orders&direction=incoming`;
  const html = wrap('Order updated — please re-review', `
    <h2>Order ${escapeHtml(orderNumber)} was updated</h2>
    <p><strong>${escapeHtml(senderName)}</strong> has updated the wholesale order they sent you.</p>
    <p>New total: <strong>${money(grandTotal)}</strong></p>
    <p>Please re-review the updated items and confirm or reject.</p>
    <p style="text-align:center"><a class="btn" href="${url}">Re-review Order</a></p>
  `);
  return sendMail(to, `[Exchange] Order ${orderNumber} was updated`, html);
}

export interface SettlementRecordedPayload {
  method: string;
  amount: number | string;
  methodRef?: string | null;
  note?: string | null;
  paidByMe: boolean;
  /** Reserved — current branding always assumes confirmation is needed. */
  needsConfirmation?: boolean;
}

export async function sendSettlementRecorded(
  to: string,
  { method, amount, methodRef, note, paidByMe }: SettlementRecordedPayload,
): Promise<boolean> {
  const url = `${PORTAL_URL()}/portal/exchange?tab=balances`;
  // From the recipient's POV: paidByMe=true means THEY paid (I received),
  // paidByMe=false means THEY received (I paid)
  const heading = paidByMe
    ? 'Your partner says you paid them — please confirm'
    : 'Your partner says they received your payment — please confirm';
  const html = wrap('Action required: confirm settlement', `
    <h2>${escapeHtml(heading)}</h2>
    <table style="width:100%;font-size:14px;margin:16px 0;border-collapse:collapse;">
      <tr><td style="padding:8px 0;color:#94a3b8">Amount</td><td style="padding:8px 0"><strong>${money(amount)}</strong></td></tr>
      <tr><td style="padding:8px 0;color:#94a3b8">Method</td><td style="padding:8px 0">${escapeHtml(method)}${methodRef ? ' #' + escapeHtml(methodRef) : ''}</td></tr>
      ${note ? `<tr><td style="padding:8px 0;color:#94a3b8">Note</td><td style="padding:8px 0">${escapeHtml(note)}</td></tr>` : ''}
    </table>
    <p><strong>The ledger won't update until you confirm.</strong> Click the link below to review and either confirm receipt or dispute.</p>
    <p style="text-align:center"><a class="btn" href="${url}">Review &amp; Confirm</a></p>
  `);
  return sendMail(to, `[Exchange] Confirm settlement ${money(amount)}`, html);
}

export interface SettlementConfirmedPayload {
  amount: number | string;
  method: string;
  methodRef?: string | null;
}

export async function sendSettlementConfirmed(
  to: string,
  { amount, method, methodRef }: SettlementConfirmedPayload,
): Promise<boolean> {
  const url = `${PORTAL_URL()}/portal/exchange?tab=balances`;
  const html = wrap('Settlement confirmed', `
    <h2>Your partner confirmed the settlement</h2>
    <p>They've acknowledged the ${money(amount)} payment via ${escapeHtml(method)}${methodRef ? ' #' + escapeHtml(methodRef) : ''}. Both ledgers are now up to date.</p>
    <p style="text-align:center"><a class="btn" href="${url}">View Ledger</a></p>
  `);
  return sendMail(to, `[Exchange] Settlement ${money(amount)} confirmed`, html);
}

export interface SettlementDisputedPayload {
  amount: number | string;
  method: string;
  reason?: string | null;
}

export async function sendSettlementDisputed(
  to: string,
  { amount, method, reason }: SettlementDisputedPayload,
): Promise<boolean> {
  const url = `${PORTAL_URL()}/portal/exchange?tab=balances`;
  const html = wrap('Settlement disputed', `
    <h2>A settlement was disputed</h2>
    <p>A ${money(amount)} settlement you recorded via <strong>${escapeHtml(method)}</strong> has been disputed by your trading partner.</p>
    ${reason ? `<p style="padding:12px;background:#fef2f2;border-left:3px solid #ef4444;border-radius:4px">Reason: ${escapeHtml(reason)}</p>` : ''}
    <p>Please contact your partner to reconcile, then one party can mark the settlement resolved.</p>
    <p style="text-align:center"><a class="btn" href="${url}">View Settlement</a></p>
  `);
  return sendMail(to, `[Exchange] Settlement disputed (${money(amount)})`, html);
}

// ─── Scan Data ack rejection (Session 48) ──────────────────────────────────
export interface ScanDataRejectedSample {
  txNumber: string | number | null | undefined;
  upc: string | null | undefined;
  code?: string | null;
  reason?: string | null;
}

export interface ScanDataAckRejectionPayload {
  manufacturerName?: string | null;
  fileName?: string | null;
  periodStart: Date | string;
  periodEnd: Date | string;
  acceptedCount: number;
  rejectedCount: number;
  sampleRejected?: ScanDataRejectedSample[];
}

export async function sendScanDataAckRejection(to: string, {
  manufacturerName, fileName, periodStart, periodEnd,
  acceptedCount, rejectedCount, sampleRejected = [],
}: ScanDataAckRejectionPayload): Promise<boolean> {
  const url = `${PORTAL_URL()}/portal/scan-data?tab=submissions`;
  const sampleHtml = sampleRejected.length === 0 ? '' : `
    <p style="margin-top:16px"><strong>First rejected lines:</strong></p>
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:8px">
      <thead>
        <tr style="background:#f8fafc">
          <th style="text-align:left;padding:8px;border-bottom:1px solid #e2e8f0">Tx #</th>
          <th style="text-align:left;padding:8px;border-bottom:1px solid #e2e8f0">UPC</th>
          <th style="text-align:left;padding:8px;border-bottom:1px solid #e2e8f0">Reason</th>
        </tr>
      </thead>
      <tbody>
        ${sampleRejected.map(l => `
          <tr>
            <td style="padding:8px;border-bottom:1px solid #f1f5f9">${escapeHtml(l.txNumber)}</td>
            <td style="padding:8px;border-bottom:1px solid #f1f5f9">${escapeHtml(l.upc)}</td>
            <td style="padding:8px;border-bottom:1px solid #f1f5f9;color:#991b1b">
              ${escapeHtml(l.code ? `[${l.code}] ` : '')}${escapeHtml(l.reason || 'No reason given')}
            </td>
          </tr>`).join('')}
      </tbody>
    </table>`;
  const periodStr = `${new Date(periodStart).toLocaleDateString()} – ${new Date(periodEnd).toLocaleDateString()}`;
  const html = wrap('Scan-data submission rejected lines', `
    <h2>${escapeHtml(manufacturerName || 'Manufacturer')} flagged ${rejectedCount} rejected line${rejectedCount === 1 ? '' : 's'}</h2>
    <p>Your scan-data submission for ${escapeHtml(periodStr)} came back from <strong>${escapeHtml(manufacturerName || 'the manufacturer')}</strong> with rejected lines.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">
      <tr><td style="padding:6px 0;color:#64748b">File</td><td style="padding:6px 0;font-family:monospace">${escapeHtml(fileName || '—')}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b">Accepted</td><td style="padding:6px 0;color:#16a34a"><strong>${acceptedCount}</strong></td></tr>
      <tr><td style="padding:6px 0;color:#64748b">Rejected</td><td style="padding:6px 0;color:#dc2626"><strong>${rejectedCount}</strong></td></tr>
    </table>
    ${sampleHtml}
    <p style="text-align:center;margin-top:24px"><a class="btn" href="${url}">Review submission</a></p>
    <p class="muted">Rejected lines won't be reimbursed. Fix the underlying data and resubmit through the back-office.</p>
  `);
  return sendMail(to, `[Storeveu] ${rejectedCount} scan-data line${rejectedCount === 1 ? '' : 's'} rejected — ${manufacturerName || 'mfr'}`, html);
}

// ─── Ticket assignment templates ─────────────────────────────────────────────

export interface TicketSummary {
  id: string;
  subject: string;
  status: string;
  priority: string;
  email?: string | null;
  name?: string | null;
}

function ticketLink(id: string): string {
  const base = (process.env.ADMIN_URL || 'http://localhost:5175').replace(/\/$/, '');
  return `${base}/tickets?id=${encodeURIComponent(id)}`;
}

function statusBadgeColor(status: string): string {
  switch (status) {
    case 'open':        return '#3d56b5';
    case 'in_progress': return '#d97706';
    case 'resolved':    return '#16a34a';
    case 'closed':      return '#64748b';
    default:            return '#3d56b5';
  }
}

function ticketMetaBlock(ticket: TicketSummary): string {
  const url = ticketLink(ticket.id);
  return `
    <table cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 16px;width:100%;border-collapse:collapse">
      <tr><td style="padding:6px 0;color:#64748b;width:90px">Subject</td><td style="padding:6px 0;color:#0f172a;font-weight:600">${escapeHtml(ticket.subject)}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b">Status</td><td style="padding:6px 0"><span style="display:inline-block;padding:3px 10px;border-radius:6px;font-size:12px;font-weight:600;color:#fff;background:${statusBadgeColor(ticket.status)}">${escapeHtml(ticket.status.replace('_',' ').toUpperCase())}</span></td></tr>
      <tr><td style="padding:6px 0;color:#64748b">Priority</td><td style="padding:6px 0;color:#0f172a">${escapeHtml(ticket.priority)}</td></tr>
      ${ticket.email ? `<tr><td style="padding:6px 0;color:#64748b">From</td><td style="padding:6px 0;color:#0f172a">${escapeHtml(ticket.name || '')} ${ticket.email ? `&lt;${escapeHtml(ticket.email)}&gt;` : ''}</td></tr>` : ''}
    </table>
    <p style="text-align:center"><a class="btn" href="${url}">Open Ticket</a></p>
  `;
}

export async function sendTicketAssigned(
  to: string,
  payload: { ticket: TicketSummary; assigneeName: string; assignedByName: string },
): Promise<boolean> {
  const { ticket, assigneeName, assignedByName } = payload;
  const html = wrap('Support Ticket Assigned to You', `
    <h2>Hi ${escapeHtml(assigneeName)},</h2>
    <p><strong>${escapeHtml(assignedByName)}</strong> assigned a support ticket to you. You're now responsible for following up.</p>
    ${ticketMetaBlock(ticket)}
    <p class="muted">Status changes and replies you make will notify the requester automatically.</p>
  `);
  return sendMail(to, `[Storeveu] Ticket assigned — ${ticket.subject}`, html);
}

export async function sendTicketUnassigned(
  to: string,
  payload: { ticket: TicketSummary; assigneeName: string; reassignedToName: string | null; changedByName: string },
): Promise<boolean> {
  const { ticket, assigneeName, reassignedToName, changedByName } = payload;
  const reassignNote = reassignedToName
    ? `<p>The ticket has been reassigned to <strong>${escapeHtml(reassignedToName)}</strong>.</p>`
    : `<p>The ticket is now unassigned.</p>`;
  const html = wrap('Removed from Support Ticket', `
    <h2>Hi ${escapeHtml(assigneeName)},</h2>
    <p><strong>${escapeHtml(changedByName)}</strong> removed you as the assignee for this ticket.</p>
    ${reassignNote}
    ${ticketMetaBlock(ticket)}
    <p class="muted">No further action is needed from you.</p>
  `);
  return sendMail(to, `[Storeveu] Removed from ticket — ${ticket.subject}`, html);
}

export async function sendTicketStatusChangedToAssignee(
  to: string,
  payload: { ticket: TicketSummary; assigneeName: string; oldStatus: string; newStatus: string; changedByName: string },
): Promise<boolean> {
  const { ticket, assigneeName, oldStatus, newStatus, changedByName } = payload;
  const html = wrap('Ticket Status Updated', `
    <h2>Hi ${escapeHtml(assigneeName)},</h2>
    <p><strong>${escapeHtml(changedByName)}</strong> changed the status of a ticket assigned to you.</p>
    <p style="margin:16px 0">
      <span style="display:inline-block;padding:4px 10px;border-radius:6px;background:#f1f5f9;color:#64748b;font-size:13px">${escapeHtml(oldStatus.replace('_',' '))}</span>
      <span style="margin:0 8px;color:#94a3b8">→</span>
      <span style="display:inline-block;padding:4px 10px;border-radius:6px;color:#fff;font-size:13px;background:${statusBadgeColor(newStatus)}">${escapeHtml(newStatus.replace('_',' '))}</span>
    </p>
    ${ticketMetaBlock(ticket)}
  `);
  return sendMail(to, `[Storeveu] Ticket status: ${newStatus.replace('_',' ')} — ${ticket.subject}`, html);
}

export async function sendTicketReplyToAssignee(
  to: string,
  payload: { ticket: TicketSummary; assigneeName: string; replyFromName: string; replyText: string },
): Promise<boolean> {
  const { ticket, assigneeName, replyFromName, replyText } = payload;
  const trimmed = replyText.length > 800 ? replyText.slice(0, 800) + '…' : replyText;
  const html = wrap('New Reply on Your Ticket', `
    <h2>Hi ${escapeHtml(assigneeName)},</h2>
    <p><strong>${escapeHtml(replyFromName)}</strong> replied to a ticket assigned to you:</p>
    <blockquote style="margin:16px 0;padding:14px 18px;background:#f8fafc;border-left:3px solid #3d56b5;border-radius:6px;color:#334155;font-size:14px;white-space:pre-wrap">${escapeHtml(trimmed)}</blockquote>
    ${ticketMetaBlock(ticket)}
  `);
  return sendMail(to, `[Storeveu] New reply — ${ticket.subject}`, html);
}

// ─── S77 Phase 2 — Contract emails ───────────────────────────────────────
export interface ContractReadyPayload {
  signerName: string;
  templateName: string;
  contractId: string;
  signingToken: string;
  generatedByName?: string | null;
}

export async function sendContractReady(
  to: string,
  { signerName, templateName, contractId, signingToken, generatedByName }: ContractReadyPayload,
): Promise<boolean> {
  const url = `${PORTAL_URL()}/vendor-contract/${contractId}?token=${encodeURIComponent(signingToken)}`;
  const inviter = generatedByName ? `<strong>${escapeHtml(generatedByName)}</strong> from the StoreVeu team` : 'Our team';
  const html = wrap('Your contract is ready to sign', `
    <h2>Hi ${escapeHtml(signerName || 'there')},</h2>
    <p>${inviter} has prepared your <strong>${escapeHtml(templateName)}</strong> for review and signature.</p>
    <p>Once signed, your application moves to the final activation step. You'll be notified the moment your account is live.</p>
    <p style="text-align:center"><a class="btn" href="${url}">Review &amp; Sign Contract</a></p>
    <p class="muted">This link is unique to your account. Don't share it.</p>
    <p class="muted" style="word-break:break-all;">Or copy this link: ${url}</p>
  `);
  return sendMail(to, `[StoreVeu] Sign your ${templateName}`, html);
}

export interface ContractActivatedPayload {
  signerName: string;
  pricingTierName?: string | null;
}

export async function sendContractActivated(
  to: string,
  { signerName, pricingTierName }: ContractActivatedPayload,
): Promise<boolean> {
  const url = `${PORTAL_URL()}/login`;
  const tierLine = pricingTierName ? `<p>You've been assigned the <strong>${escapeHtml(pricingTierName)}</strong> plan.</p>` : '';
  const html = wrap('Your account is activated', `
    <h2>Welcome aboard, ${escapeHtml(signerName || 'merchant')}!</h2>
    <p>Your contract has been counter-signed by our team and your StoreVeu account is now <strong>active</strong>.</p>
    ${tierLine}
    <p>Sign in to start setting up your organisation, stores, and registers:</p>
    <p style="text-align:center"><a class="btn" href="${url}">Sign In</a></p>
  `);
  return sendMail(to, '[StoreVeu] Your account is activated', html);
}

// Minimal HTML escape for template interpolation
function escapeHtml(s: unknown): string {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
