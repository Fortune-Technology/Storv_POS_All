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
