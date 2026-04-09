/**
 * E-commerce Email Service
 * Handles: contact form notifications, order confirmations, order status updates.
 * Non-blocking — if SMTP is not configured, emails are skipped silently.
 */

import nodemailer from 'nodemailer';

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

async function sendMail(to, subject, html) {
  const transporter = getTransporter();
  if (!transporter) {
    console.log(`[ecom-email] SMTP not configured — skipping: "${subject}" → ${to}`);
    return false;
  }
  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject,
      html,
    });
    console.log(`[ecom-email] Sent "${subject}" → ${to}`);
    return true;
  } catch (err) {
    console.warn(`[ecom-email] Failed "${subject}" → ${to}:`, err.message);
    return false;
  }
}

function wrap(storeName, body) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body { margin:0; padding:0; background:#f8fafc; font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif; }
  .container { max-width:600px; margin:0 auto; padding:20px; }
  .card { background:#fff; border-radius:12px; padding:32px; border:1px solid #e2e8f0; }
  .header { text-align:center; padding-bottom:20px; border-bottom:1px solid #f1f5f9; margin-bottom:20px; }
  .header h1 { margin:0; font-size:20px; color:#0f172a; }
  .header p { margin:4px 0 0; font-size:13px; color:#94a3b8; }
  .label { font-size:12px; text-transform:uppercase; letter-spacing:0.5px; color:#94a3b8; font-weight:600; margin-bottom:4px; }
  .value { font-size:15px; color:#0f172a; margin-bottom:16px; }
  .item-row { display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid #f1f5f9; font-size:14px; }
  .total-row { display:flex; justify-content:space-between; padding:12px 0; font-size:16px; font-weight:700; color:#0f172a; border-top:2px solid #e2e8f0; margin-top:8px; }
  .badge { display:inline-block; padding:3px 12px; border-radius:12px; font-size:12px; font-weight:600; }
  .badge-confirmed { background:#dcfce7; color:#16a34a; }
  .footer { text-align:center; padding:20px 0; font-size:12px; color:#94a3b8; }
  .btn { display:inline-block; padding:12px 28px; background:#3d56b5; color:#fff; text-decoration:none; border-radius:8px; font-weight:600; font-size:14px; }
</style>
</head><body>
<div class="container">
  <div class="card">
    <div class="header">
      <h1>${storeName}</h1>
    </div>
    ${body}
  </div>
  <div class="footer">
    <p>${storeName} — Powered by Storv</p>
  </div>
</div>
</body></html>`;
}

function fmt(n) { return `$${Number(n).toFixed(2)}`; }

/* ── Contact Form Email ──────────────────────────────────────────── */

export async function sendContactFormEmail(storeName, storeEmail, submission) {
  const { name, email, phone, message } = submission;

  // Email to store owner
  const ownerHtml = wrap(storeName, `
    <h2 style="font-size:18px; margin:0 0 16px;">New Contact Form Submission</h2>
    <div class="label">From</div>
    <div class="value">${name} &lt;${email}&gt;${phone ? ` · ${phone}` : ''}</div>
    <div class="label">Message</div>
    <div class="value" style="white-space:pre-wrap; line-height:1.6;">${message}</div>
    <p style="font-size:13px; color:#94a3b8; margin-top:20px;">You can reply directly to this email to respond to the customer.</p>
  `);

  // Email to customer (confirmation)
  const customerHtml = wrap(storeName, `
    <h2 style="font-size:18px; margin:0 0 16px;">We received your message!</h2>
    <p style="font-size:15px; color:#475569; line-height:1.6;">Hi ${name},</p>
    <p style="font-size:15px; color:#475569; line-height:1.6;">Thank you for reaching out to ${storeName}. We've received your message and will get back to you as soon as possible.</p>
    <div style="background:#f8fafc; border-radius:8px; padding:16px; margin:20px 0;">
      <div class="label">Your message</div>
      <div style="font-size:14px; color:#475569; white-space:pre-wrap;">${message}</div>
    </div>
  `);

  // Send both (non-blocking)
  const recipient = storeEmail || process.env.SUPPORT_EMAIL || process.env.SMTP_USER;
  await Promise.all([
    sendMail(recipient, `New contact from ${name} — ${storeName}`, ownerHtml),
    sendMail(email, `We received your message — ${storeName}`, customerHtml),
  ]);
}

/* ── Order Confirmation Email ────────────────────────────────────── */

export async function sendOrderConfirmationEmail(storeName, order) {
  const items = Array.isArray(order.lineItems) ? order.lineItems : [];
  const itemRows = items.map(i =>
    `<div class="item-row"><span>${i.name} × ${i.qty}</span><span>${fmt(i.total || i.price * i.qty)}</span></div>`
  ).join('');

  const html = wrap(storeName, `
    <h2 style="font-size:18px; margin:0 0 4px;">Order Confirmed! 🎉</h2>
    <p style="font-size:14px; color:#475569; margin:0 0 20px;">Thank you for your order, ${order.customerName}.</p>

    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
      <div>
        <div class="label">Order Number</div>
        <div style="font-size:16px; font-weight:700; color:#0f172a;">${order.orderNumber}</div>
      </div>
      <span class="badge badge-confirmed">Confirmed</span>
    </div>

    <div class="label">Fulfillment</div>
    <div class="value">${order.fulfillmentType === 'pickup' ? '🏪 Pickup' : '🚗 Delivery'}</div>

    ${order.shippingAddress ? `
      <div class="label">Delivery Address</div>
      <div class="value">${order.shippingAddress.street || ''}, ${order.shippingAddress.city || ''} ${order.shippingAddress.state || ''} ${order.shippingAddress.zip || ''}</div>
    ` : ''}

    <div class="label" style="margin-bottom:8px;">Items</div>
    ${itemRows}
    <div class="total-row">
      <span>Total</span>
      <span>${fmt(order.grandTotal)}</span>
    </div>

    ${order.notes ? `
      <div style="margin-top:16px;">
        <div class="label">Notes</div>
        <div class="value">${order.notes}</div>
      </div>
    ` : ''}

    <div style="text-align:center; margin-top:24px;">
      <p style="font-size:14px; color:#475569;">We'll notify you when your order status changes.</p>
    </div>
  `);

  await sendMail(order.customerEmail, `Order Confirmed: ${order.orderNumber} — ${storeName}`, html);
}

/* ── Order Status Update Email ───────────────────────────────────── */

export async function sendOrderStatusEmail(storeName, order) {
  const statusLabels = {
    preparing: 'Being Prepared',
    ready: 'Ready for Pickup',
    out_for_delivery: 'Out for Delivery',
    completed: 'Completed',
    cancelled: 'Cancelled',
  };

  const statusMsg = statusLabels[order.status] || order.status;

  const html = wrap(storeName, `
    <h2 style="font-size:18px; margin:0 0 16px;">Order Update</h2>
    <p style="font-size:15px; color:#475569;">Your order <strong>${order.orderNumber}</strong> is now:</p>
    <div style="text-align:center; padding:20px 0;">
      <span style="font-size:24px; font-weight:700; color:${order.status === 'cancelled' ? '#dc2626' : '#16a34a'};">${statusMsg}</span>
    </div>
    ${order.status === 'ready' && order.fulfillmentType === 'pickup' ? '<p style="font-size:15px; color:#475569; text-align:center;">Your order is ready! Come pick it up at your convenience.</p>' : ''}
    ${order.cancelReason ? `<p style="font-size:14px; color:#94a3b8;">Reason: ${order.cancelReason}</p>` : ''}
  `);

  await sendMail(order.customerEmail, `Order ${statusMsg}: ${order.orderNumber} — ${storeName}`, html);
}
