// Maine State Lottery adapter.
//
// Observed formats (from 2025/2026 instant ticket samples):
//   Ticket human-readable:  GGG-BBBBBB-C-TTT   e.g. "710-015744-8-074"
//     GGG    = 3-digit game number
//     BBBBBB = 6-digit book number
//     C      = 1-digit check digit
//     TTT    = 3-digit ticket number within the book
//   Ticket 1D code:         Interleaved 2-of-5 or Code-128 linear barcode
//                           encoding the same GGG-BBBBBB-C-TTT string
//   Book-level barcode:     EAN-13 "6 53491 XXXXX C"
//                           - Leading "6" is an industry flag
//                           - "53491" is the lottery vendor prefix (NASPL/Scientific Games)
//                           - "XXXXX" is the pack code (often relates to game)
//                           - Trailing digit is the EAN-13 check digit
//
// The book EAN-13 alone doesn't always carry the full game+book ids — when a
// book is received we look up the pack code against the catalog. For
// per-ticket scans the GGG-BBBBBB-C-TTT form is authoritative.

import { normalize, makeAdapter } from './_base.js';

const TICKET_RE = /^(\d{3})-(\d{6})-(\d)-(\d{3})$/;
const BOOK_RE = /^(\d{3})-(\d{6})-(\d)$/;
// Scanners sometimes strip the dashes.
const TICKET_RE_NODASH = /^(\d{3})(\d{6})(\d)(\d{3})$/;
// EAN-13 with Maine lottery vendor prefix.
const EAN13_RE = /^6?53491(\d{5})(\d)$/;

function parseAny(raw) {
  const s = normalize(raw);
  if (!s) return null;

  let m = s.match(TICKET_RE) || s.match(TICKET_RE_NODASH);
  if (m) {
    return {
      type: 'ticket',
      gameNumber: m[1],
      bookNumber: m[2],
      checkDigit: m[3],
      ticketNumber: parseInt(m[4], 10),
      state: 'ME',
    };
  }

  m = s.match(BOOK_RE);
  if (m) {
    return {
      type: 'book',
      gameNumber: m[1],
      bookNumber: m[2],
      checkDigit: m[3],
      state: 'ME',
    };
  }

  m = s.match(EAN13_RE);
  if (m) {
    return {
      type: 'book',
      // EAN-13 doesn't cleanly split into gameNumber/bookNumber the way the
      // printed human-readable does; callers must resolve against inventory
      // using the bookCode field.
      bookCode: m[1],
      checkDigit: m[2],
      state: 'ME',
    };
  }

  return null;
}

export default makeAdapter({
  code: 'ME',
  name: 'Maine',
  parseAny,
  weekStartDay: 0, // Sunday; confirm during rollout
  settlementRules: {
    pctThreshold: null, // to be confirmed with ME Lottery retailer contract
    maxDaysActive: null,
  },
});
