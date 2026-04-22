// Massachusetts State Lottery adapter.
//
// Observed formats (from 2025/2026 instant ticket samples):
//   Ticket human-readable:  GGG-BBBBBB-TTT   e.g. "498-027632-128"
//     GGG    = 3-digit game number
//     BBBBBB = 6-digit book number
//     TTT    = 3-digit ticket number within the book
//   Ticket 2D code:         Data Matrix encoding of the same GGG-BBBBBB-TTT
//                           (scanners typically return the string unchanged)
//   Book-level barcode:     GGG-BBBBBB (same first two segments, no ticket)
//
//   Ticket QR code (new in late 2025 ticket stock, seen on 2026 packs):
//     29 digits total — GGG 0 BBBBBB TTT + 16 digits of QR metadata
//     (internal store/date/checksum; we ignore the trailing block).
//     Examples:
//       52900384500001010070000000064 → game 529, book 038450, ticket 000
//       51300481550671010070000000073 → game 513, book 048155, ticket 067
//       49800276321280515060000000088 → game 498, book 027632, ticket 128

import { normalize, makeAdapter } from './_base.js';

const TICKET_RE = /^(\d{3})-(\d{6})-(\d{3})$/;
const BOOK_RE = /^(\d{3})-(\d{6})$/;
// Data Matrix scanners sometimes strip the dashes; tolerate that too.
const TICKET_RE_NODASH = /^(\d{3})(\d{6})(\d{3})$/;
const BOOK_RE_NODASH = /^(\d{3})(\d{6})$/;
// 29-digit QR payload — GGG 0 BBBBBB TTT + 16 QR metadata digits.
// The leading '0' between game and book is a fixed separator in the payload.
const TICKET_RE_QR = /^(\d{3})0(\d{6})(\d{3})\d{16}$/;

function parseAny(raw) {
  const s = normalize(raw);
  if (!s) return null;

  // 29-digit QR scans come from the newer Mass Lottery ticket stock.
  // Check this first so the shorter dashless/BOOK regexes can't
  // accidentally consume a prefix of a QR string (they wouldn't anyway
  // because of ^...$ anchors, but ordering matches what the operator sees).
  let m = s.match(TICKET_RE_QR);
  if (m) {
    return {
      type: 'ticket',
      gameNumber: m[1],
      bookNumber: m[2],
      ticketNumber: parseInt(m[3], 10),
      state: 'MA',
      source: 'qr',
    };
  }

  m = s.match(TICKET_RE) || s.match(TICKET_RE_NODASH);
  if (m) {
    return {
      type: 'ticket',
      gameNumber: m[1],
      bookNumber: m[2],
      ticketNumber: parseInt(m[3], 10),
      state: 'MA',
    };
  }

  m = s.match(BOOK_RE) || s.match(BOOK_RE_NODASH);
  if (m) {
    return {
      type: 'book',
      gameNumber: m[1],
      bookNumber: m[2],
      state: 'MA',
    };
  }

  return null;
}

export default makeAdapter({
  code: 'MA',
  name: 'Massachusetts',
  parseAny,
  weekStartDay: 0, // Sunday; MA Lottery week is Sun → Sat
  settlementRules: {
    pctThreshold: 80, // typical — confirm with store admin during rollout
    maxDaysActive: 180,
  },
});
