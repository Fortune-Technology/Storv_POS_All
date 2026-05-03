/**
 * Dejavoo SPIn StatusCode → human-readable error text + actionable hint.
 *
 * Source: https://app.theneo.io/dejavoo/spin/spin-rest-api-methods
 *   Section: "Error Codes and Messages"
 *
 * StatusCode buckets:
 *   0xxx — successful responses from terminal application
 *   1xxx — error responses from terminal app (the device rejected something)
 *   2xxx — error response from SPIn Proxy server (the cloud rejected something)
 *
 * Each entry returns:
 *   {
 *     headline:  short red-banner title (e.g. "Card Declined")
 *     hint:      what the cashier should do next, in plain language
 *     setup:     true if this is a configuration / merchant-account problem
 *                rather than a card problem (drives whether we show the
 *                "check terminal / re-pair / contact support" checklist)
 *     retry:     true if "Try Again" with the same card can succeed
 *                (e.g. transient network), false otherwise
 *   }
 *
 * The cashier-facing text is intentionally non-technical — the raw Dejavoo
 * Message / DetailedMessage is still surfaced separately for support.
 */

const TABLE = {
  // ── 0xxx — successful ────────────────────────────────────────────────────
  '0000': {
    headline: 'Approved',
    hint:     'Sale was approved.',
    setup:    false,
    retry:    false,
  },
  '0001': {
    headline: 'Partially Approved',
    hint:     'Only part of the amount was approved. Collect the rest with another payment method.',
    setup:    false,
    retry:    false,
  },

  // ── 1xxx — terminal-side errors ──────────────────────────────────────────
  '1000': {
    headline: 'Terminal Busy',
    hint:     'The card terminal is processing another transaction or in bypass mode. Wait for it to return to "Listening" and try again.',
    setup:    false,
    retry:    true,
  },
  '1001': {
    headline: 'Transaction Not Found',
    hint:     'No matching transaction on the terminal. If you were trying to void or adjust a tip, double-check the original sale exists.',
    setup:    false,
    retry:    false,
  },
  '1002': {
    headline: 'Operation Not Supported',
    hint:     'This terminal doesn\'t support the requested action. Check the merchant configuration in admin → Payments.',
    setup:    true,
    retry:    false,
  },
  '1003': {
    headline: 'Payment Type Not Supported',
    hint:     'The terminal doesn\'t have a payment application installed for this card type. Contact your Dejavoo rep to enable Credit / Debit on the merchant profile.',
    setup:    true,
    retry:    false,
  },
  '1004': {
    headline: 'Operation Not Allowed',
    hint:     'The terminal\'s configuration doesn\'t allow this combination (e.g. void of a settled transaction, manual entry of a Debit card on a non-BridgePay processor). Contact your Dejavoo rep.',
    setup:    true,
    retry:    false,
  },
  '1005': {
    headline: 'Terminal Battery Low',
    hint:     'Plug the P17 in to charge before processing more sales.',
    setup:    false,
    retry:    true,
  },
  '1006': {
    headline: 'Terminal Internal Error',
    hint:     'The terminal hit an unexpected error. If this keeps happening, restart the P17 (hold the power button → Restart). Refill the receipt printer if it\'s out of paper.',
    setup:    false,
    retry:    true,
  },
  '1007': {
    headline: 'Bad Request Format',
    hint:     'The request was malformed. This is likely a software bug — please report it to support.',
    setup:    true,
    retry:    false,
  },
  '1008': {
    headline: 'Wrong Payment Type',
    hint:     'The card you presented doesn\'t match the requested payment type (e.g. tried to charge an EBT card as Credit, or a Credit card as EBT).',
    setup:    false,
    retry:    true,
  },
  '1009': {
    headline: 'Authentication Failed',
    hint:     'The terminal\'s auth key doesn\'t match the merchant on file. Re-pull parameters on the P17 (Settings → Update Parameters), or check the Auth Key in admin → Payments.',
    setup:    true,
    retry:    false,
  },
  '1010': {
    headline: 'Missing Reference ID',
    hint:     'Internal error — the request was missing a required field. This is a software bug.',
    setup:    true,
    retry:    false,
  },
  '1011': {
    headline: 'Duplicate Transaction',
    hint:     'A transaction with this reference ID already exists. Wait a moment and try again — the system will use a fresh reference ID.',
    setup:    false,
    retry:    true,
  },
  '1012': {
    headline: 'Transaction Cancelled',
    hint:     'The sale was cancelled — the customer or cashier hit cancel on the terminal, or the prompt timed out.',
    setup:    false,
    retry:    true,
  },
  '1013': {
    headline: 'Bad Request',
    hint:     'The request had invalid amounts, fees, or parameters. Check the cart and try again.',
    setup:    false,
    retry:    false,
  },
  '1014': {
    headline: 'Communication Error',
    hint:     'The terminal couldn\'t reach the payment processor. Check the P17\'s internet connection and try again in a moment.',
    setup:    false,
    retry:    true,
  },
  '1015': {
    headline: 'Card Declined',
    hint:     'The card issuer declined the sale. Try a different card or payment method.',
    setup:    false,
    retry:    false,
  },
  '1016': {
    headline: 'Payment Type Mismatch',
    hint:     'The card type doesn\'t match what was requested. If charging EBT, the customer must present an EBT card.',
    setup:    false,
    retry:    true,
  },
  '1017': {
    headline: 'Wrong Merchant ID',
    hint:     'The merchant number sent in the request doesn\'t match the terminal. Check admin → Payments → Merchant Number.',
    setup:    true,
    retry:    false,
  },
  '1018': {
    headline: 'PIN Pad Error',
    hint:     'The PIN pad isn\'t responding. Check the cable / pairing on the P17 and try again.',
    setup:    false,
    retry:    true,
  },
  '1019': {
    headline: 'No Debit Keys',
    hint:     'The terminal doesn\'t have debit encryption keys loaded. Contact your Dejavoo rep — they need to push debit keys to the device.',
    setup:    true,
    retry:    false,
  },
  '1020': {
    headline: 'No Open Batch',
    hint:     'There\'s no batch open to settle against. This usually fixes itself on the next sale.',
    setup:    false,
    retry:    true,
  },
  '1021': {
    headline: 'Pending Offline Transactions',
    hint:     'The terminal has unsent offline transactions. Wait for the queue to drain, or settle manually before retrying.',
    setup:    false,
    retry:    true,
  },
  '1022': {
    headline: 'Untipped Transactions',
    hint:     'There are sales waiting for tip adjustment. Adjust tips before settlement.',
    setup:    false,
    retry:    true,
  },
  '1023': {
    headline: 'Open Tab',
    hint:     'There\'s an open tab on the terminal. Close it before settling.',
    setup:    false,
    retry:    true,
  },

  // ── 2xxx — SPIn Proxy (cloud) errors ─────────────────────────────────────
  '2001': {
    headline: 'Terminal Offline',
    hint:     'The card terminal isn\'t connected to Dejavoo. Check the P17\'s internet — its WiFi or Ethernet should be plugged in directly to the device — then wait for "Listening for transaction…" before retrying.',
    setup:    true,
    retry:    true,
  },
  '2002': {
    headline: 'Wrong Auth Key',
    hint:     'The auth key in admin → Payments doesn\'t match this terminal. Double-check for typos or extra spaces.',
    setup:    true,
    retry:    false,
  },
  '2003': {
    headline: 'Terminal Not Found',
    hint:     'Dejavoo doesn\'t recognize this TPN. Confirm the TPN matches what\'s burned into the P17. If you\'re testing with UAT credentials, make sure the merchant is configured for the UAT environment.',
    setup:    true,
    retry:    false,
  },
  '2004': {
    headline: 'Terminal Not Provisioned for SPIn',
    hint:     'This TPN doesn\'t have SPIn integration enabled. Contact your Dejavoo rep to provision it.',
    setup:    true,
    retry:    false,
  },
  '2005': {
    headline: 'Terminal Not Active',
    hint:     'The connection was blocked or the device isn\'t active in Dejavoo\'s system. Two cashier-apps using the same TPN can also cause this.',
    setup:    true,
    retry:    false,
  },
  '2006': {
    headline: 'Invalid Request',
    hint:     'Dejavoo couldn\'t parse the request. This is usually a software bug — please report it.',
    setup:    true,
    retry:    false,
  },
  '2007': {
    headline: 'Terminal Timed Out',
    hint:     'The terminal didn\'t respond within the timeout window (default 2 minutes). The customer may not have completed the prompt in time. Try again.',
    setup:    false,
    retry:    true,
  },
  '2008': {
    headline: 'Terminal Busy',
    hint:     'The terminal is processing another request. Wait a few seconds and try again.',
    setup:    false,
    retry:    true,
  },
  '2009': {
    headline: 'Transaction Not Found',
    hint:     'No matching transaction on the cloud. If trying to look up an old sale, check the reference ID.',
    setup:    false,
    retry:    false,
  },
  '2010': {
    headline: 'Communication Error',
    hint:     'A network error occurred between Dejavoo and the terminal. Check connectivity on both ends and retry.',
    setup:    false,
    retry:    true,
  },
  '2011': {
    headline: 'Terminal Not Available',
    hint:     'The terminal isn\'t reachable right now. Confirm the P17 is showing "Listening for transaction…" and retry.',
    setup:    false,
    retry:    true,
  },
  '2101': {
    headline: 'Callback URL Missing',
    hint:     'A callback URL was required but not provided. This is a software bug — please report it.',
    setup:    true,
    retry:    false,
  },
  '2102': {
    headline: 'Invalid Callback Format',
    hint:     'The callback request format was invalid. This is a software bug — please report it.',
    setup:    true,
    retry:    false,
  },
  '2110': {
    headline: 'Internal Cloud Error',
    hint:     'Dejavoo\'s servers hit an unexpected error. Wait a moment and retry; if it keeps happening, contact Dejavoo support.',
    setup:    false,
    retry:    true,
  },

  // ── 22xx — request validation errors (not in the original Theneo doc
  // table but observed in live UAT testing). Dejavoo returns these when
  // a structurally-correct request fails per-field validation (missing
  // required fields, wrong types, etc.). Almost always a code bug on our
  // side rather than an operational issue.
  '2201': {
    headline: 'Request Validation Failed',
    hint:     'Dejavoo rejected the request payload (a required field was missing or had an invalid value). This is a software bug — the cashier-app is sending the wrong shape. Capture the StatusCode and DetailedMessage and report it to support; in the meantime, use a different payment method.',
    setup:    true,
    retry:    false,
  },
};

/**
 * Look up a Dejavoo decline / error response by its StatusCode and produce a
 * cashier-friendly explanation.
 *
 * Falls back gracefully when:
 *   - StatusCode is missing — returns a generic "card not approved" entry
 *   - StatusCode isn't in the table — returns a generic entry that surfaces
 *     the raw code so support can still diagnose
 *
 * @param {Object} payload — the normalized payResult object from chargeTerminal
 *   { statusCode, resultCode, message, detailedMessage, ... }
 * @returns {{
 *   headline: string,
 *   hint:     string,
 *   setup:    boolean,   // true → show setup checklist UI
 *   retry:    boolean,   // true → "Try Again" likely to succeed with same card
 *   statusCode: string,  // raw code for support
 *   resultCode: string,
 *   raw: { message, detailedMessage }
 * }}
 */
export function describeDejavooError(payload) {
  const result = payload || {};
  const statusCode = result.statusCode != null ? String(result.statusCode) : '';
  const resultCode = result.resultCode != null ? String(result.resultCode) : '';
  const message    = result.message || result.resptext || '';
  const detailed   = result.detailedMessage || '';

  // Direct StatusCode hit — best path
  if (statusCode && TABLE[statusCode]) {
    return {
      ...TABLE[statusCode],
      statusCode,
      resultCode,
      raw: { message, detailedMessage: detailed },
    };
  }

  // Heuristic fallback — match on Dejavoo phrasing when StatusCode missing.
  // Keeps support useful even for older Dejavoo responses that don't always
  // include a StatusCode (or for our synthetic NetworkError shape).
  const haystack = `${message} ${detailed}`.toLowerCase();
  if (/connection\s*failed|offline|not\s*reachable|not\s*connected/i.test(haystack)) {
    return {
      ...TABLE['2001'],
      statusCode,
      resultCode,
      raw: { message, detailedMessage: detailed },
    };
  }
  if (/feature\s*is\s*not\s*available|not\s*supported/i.test(haystack)) {
    return {
      ...TABLE['1003'],
      statusCode,
      resultCode,
      raw: { message, detailedMessage: detailed },
    };
  }
  if (/cancelled|canceled|user\s*cancel/i.test(haystack)) {
    return {
      ...TABLE['1012'],
      statusCode,
      resultCode,
      raw: { message, detailedMessage: detailed },
    };
  }
  if (/declined|insufficient|do\s*not\s*honor|not\s*honored/i.test(haystack)) {
    return {
      ...TABLE['1015'],
      statusCode,
      resultCode,
      raw: { message, detailedMessage: detailed },
    };
  }
  if (/auth.*fail|invalid\s*tpn|invalid\s*auth/i.test(haystack)) {
    return {
      ...TABLE['1009'],
      statusCode,
      resultCode,
      raw: { message, detailedMessage: detailed },
    };
  }
  if (/timeout|timed\s*out/i.test(haystack)) {
    return {
      ...TABLE['2007'],
      statusCode,
      resultCode,
      raw: { message, detailedMessage: detailed },
    };
  }

  // Generic fallback — keep raw text visible so support can still diagnose
  return {
    headline: 'Card Not Approved',
    hint:     message
      ? 'Try again or use a different payment method.'
      : 'The terminal returned an unknown error. Try again or use a different payment method.',
    setup:    false,
    retry:    true,
    statusCode,
    resultCode,
    raw: { message, detailedMessage: detailed },
  };
}
