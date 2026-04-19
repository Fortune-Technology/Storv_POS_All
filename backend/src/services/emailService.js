/**
 * Centralized Email Service
 * All email sending flows go through this service.
 */
import nodemailer from 'nodemailer';

// ─── Transporter (lazy singleton) ────────────────────────────────────────────
let _transporter = null;

function getTransporter() {
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
async function sendMail(to, subject, html) {
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
    console.warn(`[Email] Failed "${subject}" → ${to}:`, err.message);
    return false;
  }
}

// ─── Branded wrapper ─────────────────────────────────────────────────────────
function wrap(title, body) {
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

export async function sendForgotPassword(to, name, resetUrl) {
  const html = wrap('Reset Your Password', `
    <h2>Hi ${name || 'there'},</h2>
    <p>We received a request to reset your password. Click the button below to set a new one:</p>
    <p style="text-align:center"><a class="btn" href="${resetUrl}">Reset Password</a></p>
    <p class="muted">This link expires in 30 minutes. If you didn't request this, you can safely ignore this email.</p>
    <p class="muted" style="word-break:break-all;">Or copy this link: ${resetUrl}</p>
  `);
  return sendMail(to, 'Reset Your Password Storeveu', html);
}

export async function sendContactConfirmation(to, name) {
  const html = wrap('We Got Your Message', `
    <h2>Hi ${name || 'there'},</h2>
    <p>Thank you for reaching out! We've received your message and our team will get back to you within 1–2 business days.</p>
    <p>If your matter is urgent, feel free to reply directly to this email.</p>
  `);
  return sendMail(to, 'We received your message Storeveu', html);
}

export async function sendContactNotifyAdmin(name, email, subject, body) {
  const adminEmail = process.env.SUPPORT_EMAIL || process.env.SMTP_USER;
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

export async function sendNewSignupNotifyAdmin(name, email) {
  const adminEmail = process.env.SUPPORT_EMAIL || process.env.SMTP_USER;
  const adminUrl = process.env.ADMIN_URL || 'http://localhost:5175';
  const html = wrap('New User Signup', `
    <h2>New registration pending review</h2>
    <p><strong>${name}</strong> (${email}) has signed up and is waiting for approval.</p>
    <p style="text-align:center"><a class="btn" href="${adminUrl}/users?status=pending">Review in Admin Panel</a></p>
  `);
  return sendMail(adminEmail, `[New Signup] ${name} is waiting for approval`, html);
}

export async function sendUserApproved(to, name) {
  const loginUrl = (process.env.FRONTEND_URL || 'http://localhost:5173') + '/login';
  const html = wrap('Account Approved!', `
    <h2>Welcome aboard, ${name || 'there'}!</h2>
    <p>Great news your Storeveu account has been approved. You can now log in and start managing your store.</p>
    <p style="text-align:center"><a class="btn" href="${loginUrl}">Log In to Storeveu</a></p>
  `);
  return sendMail(to, 'Your Storeveu account is approved!', html);
}

export async function sendUserRejected(to, name) {
  const html = wrap('Application Update', `
    <h2>Hi ${name || 'there'},</h2>
    <p>Thank you for your interest in Storeveu. After reviewing your application, we're unable to approve your account at this time.</p>
    <p>If you believe this was a mistake, please contact our support team.</p>
  `);
  return sendMail(to, 'Your Storeveu application update', html);
}

export async function sendUserSuspended(to, name) {
  const html = wrap('Account Suspended', `
    <h2>Hi ${name || 'there'},</h2>
    <p>Your Storeveu account has been suspended by an administrator. If you have questions, please contact support.</p>
  `);
  return sendMail(to, 'Your Storeveu account has been suspended', html);
}

export async function sendPasswordChanged(to, name) {
  const html = wrap('Password Changed', `
    <h2>Hi ${name || 'there'},</h2>
    <p>Your password was successfully changed. If you didn't make this change, please contact support immediately.</p>
  `);
  return sendMail(to, 'Your password was changed Storeveu', html);
}

// ─── Invitation templates ────────────────────────────────────────────────────

/**
 * Invitation to join an organisation (new user OR existing user).
 * `role` is shown as the human-readable role the invitee will get on accept.
 */
export async function sendInvitation(to, { inviterName, orgName, role, acceptUrl, existingAccount }) {
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

/**
 * Store transfer (org ownership handover). Makes the destructive nature
 * of the action clear.
 */
export async function sendTransferInvitation(to, { inviterName, orgName, acceptUrl }) {
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

/**
 * Notify the inviter that their invitation was accepted.
 */
export async function sendInvitationAccepted(to, { inviterName, inviteeName, orgName, role }) {
  const html = wrap('Invitation accepted', `
    <h2>Hi ${escapeHtml(inviterName || 'there')},</h2>
    <p><strong>${escapeHtml(inviteeName)}</strong> has accepted your invitation to join <strong>${escapeHtml(orgName)}</strong> as <strong>${escapeHtml(role)}</strong>.</p>
    <p class="muted">They now have access to the organisation and will appear in your user list.</p>
  `);
  return sendMail(to, `${inviteeName} joined ${orgName}`, html);
}

/**
 * Notify the outgoing owner that their store transfer completed.
 */
export async function sendTransferCompleted(to, { formerOwnerName, newOwnerName, orgName }) {
  const html = wrap(`Transfer complete: ${orgName}`, `
    <h2>Hi ${escapeHtml(formerOwnerName || 'there')},</h2>
    <p><strong>${escapeHtml(newOwnerName)}</strong> has accepted the ownership transfer of <strong>${escapeHtml(orgName)}</strong>.</p>
    <p>Your access to this organisation has been revoked as part of the transfer. If you believe this is a mistake, please contact support right away.</p>
  `);
  return sendMail(to, `Ownership transfer complete: ${orgName}`, html);
}

// ─── Storv Exchange templates ────────────────────────────────────────────────

const PORTAL_URL = () => process.env.FRONTEND_URL || 'http://localhost:5173';
const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;

export async function sendPartnerHandshakeRequest(to, { requesterName, requesterCode, partnerName, requestNote }) {
  const url = `${PORTAL_URL()}/portal/exchange?tab=partners`;
  const html = wrap('New trading partner request', `
    <h2>Hi there,</h2>
    <p><strong>${escapeHtml(requesterName)}</strong> (${escapeHtml(requesterCode || '')}) has requested to trade with <strong>${escapeHtml(partnerName)}</strong> on Storv Exchange.</p>
    ${requestNote ? `<p style="padding:12px;background:#f8fafc;border-radius:8px;font-style:italic">"${escapeHtml(requestNote)}"</p>` : ''}
    <p>Once you accept, either store can send wholesale purchase orders to the other.</p>
    <p style="text-align:center"><a class="btn" href="${url}">Review Request</a></p>
    <p class="muted">Each merchant is solely responsible for their own licensing and compliance (liquor, tobacco, etc).</p>
  `);
  return sendMail(to, `New trading partner request from ${requesterName}`, html);
}

export async function sendPartnerHandshakeAccepted(to, { requesterName, partnerName, partnerCode }) {
  const url = `${PORTAL_URL()}/portal/exchange?tab=orders`;
  const html = wrap('Partnership accepted!', `
    <h2>Good news, ${escapeHtml(requesterName)}!</h2>
    <p><strong>${escapeHtml(partnerName)}</strong> (${escapeHtml(partnerCode || '')}) has accepted your trading partner request.</p>
    <p>You can now send wholesale purchase orders to each other.</p>
    <p style="text-align:center"><a class="btn" href="${url}">Create a Wholesale Order</a></p>
  `);
  return sendMail(to, `${partnerName} accepted your trading request`, html);
}

export async function sendWholesaleOrderReceived(to, { orderNumber, senderName, senderCode, grandTotal, expiresAt }) {
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

export async function sendWholesaleOrderConfirmed(to, { orderNumber, receiverName, grandTotal, status }) {
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

export async function sendWholesaleOrderRejected(to, { orderNumber, receiverName, reason }) {
  const html = wrap('Order rejected', `
    <h2>Order ${escapeHtml(orderNumber)} — rejected</h2>
    <p><strong>${escapeHtml(receiverName)}</strong> has declined your wholesale order.</p>
    ${reason ? `<p style="padding:12px;background:#fef2f2;border-left:3px solid #ef4444;border-radius:4px">Reason: ${escapeHtml(reason)}</p>` : ''}
    <p class="muted">No inventory moved. No ledger entry was created.</p>
  `);
  return sendMail(to, `[Exchange] Order ${orderNumber} rejected`, html);
}

export async function sendWholesaleOrderCancelled(to, { orderNumber, senderName, reason }) {
  const html = wrap('Order cancelled', `
    <h2>Order ${escapeHtml(orderNumber)} — cancelled</h2>
    <p><strong>${escapeHtml(senderName)}</strong> has cancelled the wholesale order they sent you.</p>
    ${reason ? `<p style="padding:12px;background:#fff7ed;border-left:3px solid #f59e0b;border-radius:4px">Reason: ${escapeHtml(reason)}</p>` : ''}
    <p class="muted">No action required.</p>
  `);
  return sendMail(to, `[Exchange] Order ${orderNumber} cancelled`, html);
}

export async function sendWholesaleOrderEdited(to, { orderNumber, senderName, grandTotal }) {
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

export async function sendSettlementRecorded(to, { method, amount, methodRef, note, paidByMe, needsConfirmation }) {
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

export async function sendSettlementConfirmed(to, { amount, method, methodRef }) {
  const url = `${PORTAL_URL()}/portal/exchange?tab=balances`;
  const html = wrap('Settlement confirmed', `
    <h2>Your partner confirmed the settlement</h2>
    <p>They've acknowledged the ${money(amount)} payment via ${escapeHtml(method)}${methodRef ? ' #' + escapeHtml(methodRef) : ''}. Both ledgers are now up to date.</p>
    <p style="text-align:center"><a class="btn" href="${url}">View Ledger</a></p>
  `);
  return sendMail(to, `[Exchange] Settlement ${money(amount)} confirmed`, html);
}

export async function sendSettlementDisputed(to, { amount, method, reason }) {
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

// Minimal HTML escape for template interpolation
function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
