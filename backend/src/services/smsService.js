/**
 * SMS Service — Twilio-ready stub
 *
 * Until TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER are set
 * in .env, every call is a safe no-op that logs what it *would* have sent.
 * Drop in the credentials later and SMS lights up automatically — the call
 * sites don't need to change.
 *
 * The `twilio` npm package is loaded lazily via dynamic import so the stub
 * works even if the dependency isn't installed yet.
 */

// ─── Lazy transporter ────────────────────────────────────────────────────────
let _client = null;
let _loadAttempted = false;

async function getClient() {
  if (_client) return _client;
  if (_loadAttempted) return null;
  _loadAttempted = true;

  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from  = process.env.TWILIO_FROM_NUMBER;

  if (!sid || !token || !from) return null;

  try {
    // Dynamic import so the stub works pre-install. To activate SMS:
    //   npm i twilio
    //   set TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER in .env
    const mod = await import('twilio');
    const twilio = mod.default || mod;
    _client = twilio(sid, token);
    console.log('[SMS] Twilio client initialised.');
    return _client;
  } catch (err) {
    console.warn('[SMS] twilio package not installed:', err.message);
    return null;
  }
}

/**
 * Core send. Returns `{ sent, reason }`. Never throws.
 */
export async function sendSms(to, body) {
  if (!to) return { sent: false, reason: 'no recipient' };

  const client = await getClient();
  if (!client) {
    console.warn(`[SMS stub] Would send to ${to}: ${body.slice(0, 140)}${body.length > 140 ? '…' : ''}`);
    return { sent: false, reason: 'sms not configured' };
  }

  try {
    await client.messages.create({
      to,
      from: process.env.TWILIO_FROM_NUMBER,
      body,
    });
    console.log(`[SMS] Sent to ${to}`);
    return { sent: true };
  } catch (err) {
    console.warn(`[SMS] Failed to ${to}:`, err.message);
    return { sent: false, reason: err.message };
  }
}

// ─── Template functions ──────────────────────────────────────────────────────

export async function sendInvitationSms(to, inviterName, orgName, url) {
  const body = `${inviterName} invited you to join ${orgName} on Storeveu. Accept: ${url}`;
  return sendSms(to, body);
}

export async function sendTransferSms(to, inviterName, orgName, url) {
  const body = `${inviterName} is transferring ownership of ${orgName} to you on Storeveu. Accept to take over: ${url}`;
  return sendSms(to, body);
}

export default { sendSms, sendInvitationSms, sendTransferSms };
