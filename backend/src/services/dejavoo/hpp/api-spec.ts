/**
 * Dejavoo HPP — iPOSpays-specific magic strings.
 *
 * Centralised here so when iPOSpays changes their endpoint or field names,
 * we update ONE place. Verified against:
 *   https://docs.ipospays.com/hosted-payment-page/apidocs
 *   https://uatdocs.ipospays.tech/
 *
 * Env-var defaults below match iPOSpays' published UAT / Prod hosts; per-
 * merchant override via `PaymentMerchant.hppBaseUrl` wins over these.
 */

export const HPP_API_SPEC = {
  // Base URLs by environment.
  envBaseUrls: {
    uat:  process.env.DEJAVOO_HPP_BASE_UAT  || 'https://payment.ipospays.tech',
    prod: process.env.DEJAVOO_HPP_BASE_PROD || 'https://payment.ipospays.com',
  },

  // Query-status API has its own host (split from the main payment API).
  queryStatusBaseUrls: {
    uat:  process.env.DEJAVOO_HPP_QUERY_BASE_UAT  || 'https://api.ipospays.tech',
    prod: process.env.DEJAVOO_HPP_QUERY_BASE_PROD || 'https://api.ipospays.com',
  },

  // Endpoint paths (relative to base URLs above).
  // The HPP create-session endpoint per
  //   https://docs.ipospays.com/hosted-payment-page/apidocs
  // is the bare path — no `/getHostedPaymentPage` suffix. The earlier
  // suffix variant returned HTTP 401 with an empty body because iPOSpays'
  // auth filter routed it to a different / non-existent handler.
  paths: {
    createSession: '/api/v1/external-payment-transaction',
    queryStatus:   '/v1/queryPaymentStatus',
  },

  // Transaction type codes per the iPOSpays doc.
  txType: {
    SALE:            1,
    CARD_VALIDATION: 2,    // $0 preauth — used for card-on-file capture
  },

  // Response code → status enum, per the iPOSpays doc.
  responseCodes: {
    200: 'approved',
    400: 'declined',
    401: 'cancelled',
    402: 'rejected',
  },
};
