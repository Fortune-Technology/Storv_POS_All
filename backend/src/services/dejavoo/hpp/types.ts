/**
 * Dejavoo HPP — public types shared across the hpp/ sub-modules.
 *
 * `DejavooHppMerchant` is the decrypted merchant snapshot every HPP function
 * expects. Always decrypt SECRET fields before passing in (see decryptForHpp
 * in controllers/payment/hpp/helpers.ts).
 */

export interface DejavooHppMerchant {
  /** iPOSpays internal account UUID — encoded inside the JWT, NOT what
   *  goes into the body's `merchantAuthentication.merchantId` field.
   *  We keep it on the merchant row for audit / debug purposes only. */
  hppMerchantId: string;
  /** TPN (Terminal Profile Number) — the value iPOSpays expects in the
   *  body's `merchantAuthentication.merchantId` field as a number.
   *  Stored as a string to preserve leading zeros, converted at send time. */
  spinTpn: string;
  hppAuthKey: string;          // iPOSpays HPP token (JWT) — DECRYPTED
  hppBaseUrl?: string | null;
  hppWebhookSecret: string;    // per-store opaque token — DECRYPTED
  environment?: 'uat' | 'prod' | string;
}

/**
 * Options for createCheckoutSession. Only `amount`, `transactionReferenceId`,
 * `notifyUrl`, and `returnUrl` are strictly required — the rest customize
 * branding (merchantName/logoUrl/themeColor) or add per-line fee/tax
 * breakdown shown on the iPOSpays hosted page.
 */
export interface CreateCheckoutOpts {
  amount: number;
  transactionReferenceId: string;
  notifyUrl: string;
  returnUrl: string;
  failureUrl?: string;
  cancelUrl?: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  merchantName?: string;
  logoUrl?: string;
  themeColor?: string;
  description?: string;
  fees?: { feeAmount?: number | string; feeLabel?: string };
  taxes?: {
    lTax?: { amount?: number | string; label?: string };
    gTax?: { amount?: number | string; label?: string };
  };
  expiryMinutes?: number;
  requestCardToken?: boolean;
}

/** What `createCheckoutSession` returns to the controller. */
export interface CreateCheckoutResult {
  approved: boolean;
  paymentUrl: string | null;
  transactionReferenceId: string;
  message: string | null;
  _raw: unknown;
}
