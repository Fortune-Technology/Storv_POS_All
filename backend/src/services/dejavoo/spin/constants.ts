/**
 * Dejavoo SPIn — static lookup tables.
 *
 * `PAYMENT_TYPE_MAP` translates StoreVeu's tender method enum into Dejavoo's
 * `PaymentType` field. Used by callers that have a StoreVeu-side enum and
 * need to convert before sending to SPIn.
 *
 * `STATUS_MESSAGES` is a human-readable lookup for the most common Dejavoo
 * StatusCodes — useful for surfacing nicer error toasts when a transaction
 * fails. Not exhaustive (Dejavoo has hundreds of codes); just the ones we
 * see in practice.
 */

/** Map StoreVeu tender methods to Dejavoo PaymentType enum. */
export const PAYMENT_TYPE_MAP: Record<string, string> = {
  card:     'Card',     // terminal decides credit vs debit based on card
  credit:   'Credit',
  debit:    'Debit',
  ebt_food: 'EBT_Food',
  ebt_cash: 'EBT_Cash',
  gift:     'Gift',
};

/** Map common Dejavoo StatusCodes to short human-readable explanations. */
export const STATUS_MESSAGES: Record<string, string> = {
  '0000': 'Approved',
  '1000': 'Terminal busy — try again',
  '1001': 'Terminal not found',
  '1011': 'Duplicate transaction reference',
  '1012': 'Transaction canceled by customer',
  '1015': 'Declined',
  '2001': 'Terminal not connected',
  '2007': 'Transaction timed out',
  '2008': 'Terminal in use — wait and retry',
};
