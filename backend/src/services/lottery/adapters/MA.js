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

import { normalize, makeAdapter } from './_base.js';

const TICKET_RE = /^(\d{3})-(\d{6})-(\d{3})$/;
const BOOK_RE = /^(\d{3})-(\d{6})$/;
// Data Matrix scanners sometimes strip the dashes; tolerate that too.
const TICKET_RE_NODASH = /^(\d{3})(\d{6})(\d{3})$/;
const BOOK_RE_NODASH = /^(\d{3})(\d{6})$/;

function parseAny(raw) {
  const s = normalize(raw);
  if (!s) return null;

  let m = s.match(TICKET_RE) || s.match(TICKET_RE_NODASH);
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
