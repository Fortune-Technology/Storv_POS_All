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

export interface SmsResult {
  sent: boolean;
  reason?: string;
}

/**
 * Minimal shape of the Twilio client we use. Loaded lazily via dynamic
 * import; we don't pull in `@types/twilio` so the type is hand-rolled here.
 */
interface TwilioClient {
  messages: {
    create: (opts: { to: string; from?: string; body: string }) => Promise<unknown>;
  };
}

// ─── Lazy transporter ────────────────────────────────────────────────────────
let _client: TwilioClient | null = null;
let _loadAttempted = false;

async function getClient(): Promise<TwilioClient | null> {
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
    // @ts-expect-error — `twilio` is intentionally not in package.json; install
    //   it when SMS is activated. Catch handles the missing-module case.
    const mod = await import('twilio');
    const twilio = (mod as { default?: unknown }).default || mod;
    _client = (twilio as (sid: string, token: string) => TwilioClient)(sid, token);
    console.log('[SMS] Twilio client initialised.');
    return _client;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[SMS] twilio package not installed:', message);
    return null;
  }
}

/**
 * Core send. Returns `{ sent, reason }`. Never throws.
 */
export async function sendSms(to: string | null | undefined, body: string): Promise<SmsResult> {
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
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[SMS] Failed to ${to}:`, message);
    return { sent: false, reason: message };
  }
}

// ─── Template functions ──────────────────────────────────────────────────────

export async function sendInvitationSms(
  to: string,
  inviterName: string,
  orgName: string,
  url: string,
): Promise<SmsResult> {
  const body = `${inviterName} invited you to join ${orgName} on Storeveu. Accept: ${url}`;
  return sendSms(to, body);
}

export async function sendTransferSms(
  to: string,
  inviterName: string,
  orgName: string,
  url: string,
): Promise<SmsResult> {
  const body = `${inviterName} is transferring ownership of ${orgName} to you on Storeveu. Accept to take over: ${url}`;
  return sendSms(to, body);
}

export default { sendSms, sendInvitationSms, sendTransferSms };
