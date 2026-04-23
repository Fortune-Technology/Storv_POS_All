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
//   QR code on newer (2025+) stock — 29 digits total, layout:
//     Positions 0–2   : GGG game number
//     Position  3     : fixed '0' separator
//     Positions 4–9   : BBBBBB book number (6-digit zero-padded)
//     Positions 10–12 : TTT ticket number — OR literal "999" as a
//                       BOOK-LEVEL sentinel (QR scanned off the pack
//                       label, no specific ticket attached)
//     Positions 13–14 : unknown metadata (appears game-specific)
//     Positions 15–17 : PPP pack size (3-digit zero-padded: 050, 100, 150…)
//                       This is the authoritative pack size — the state
//                       lottery's public API doesn't expose pack size,
//                       but it IS baked into every QR.
//     Positions 18–28 : checksum / date / validation (11 digits)
//
//   Samples:
//     52900384500001010070000000064 → game 529, book 038450, ticket 0,   pack 100
//     51300481550671010070000000073 → game 513, book 048155, ticket 67,  pack 100
//     49800276321280515060000000088 → game 498, book 027632, ticket 128, pack 150
//     54200075599993005080000000099 → game 542, book 007559, BOOK SCAN,  pack 50
//     49300260289990115030000000090 → game 493, book 026028, BOOK SCAN,  pack 150

import { normalize, makeAdapter } from './_base.js';

const TICKET_RE = /^(\d{3})-(\d{6})-(\d{3})$/;
const BOOK_RE = /^(\d{3})-(\d{6})$/;
// Data Matrix scanners sometimes strip the dashes; tolerate that too.
const TICKET_RE_NODASH = /^(\d{3})(\d{6})(\d{3})$/;
const BOOK_RE_NODASH = /^(\d{3})(\d{6})$/;
// 29-digit QR payload. Groups 1-4 are:
//   1: GGG (game), 2: BBBBBB (book),
//   3: TTT (ticket or "999" sentinel),
//   4: PPP (pack size at positions 15-17, after 2 unknown digits)
const TICKET_RE_QR = /^(\d{3})0(\d{6})(\d{3})\d{2}(\d{3})\d{11}$/;

const BOOK_LEVEL_SENTINEL = '999';

function parseAny(raw) {
  const s = normalize(raw);
  if (!s) return null;

  // 29-digit QR scans come from the newer Mass Lottery ticket stock.
  // Check this first so the shorter dashless/BOOK regexes can't
  // accidentally consume a prefix of a QR string (they wouldn't anyway
  // because of ^...$ anchors, but ordering matches what the operator sees).
  let m = s.match(TICKET_RE_QR);
  if (m) {
    const gameNumber = m[1];
    const bookNumber = m[2];
    const rawTicket  = m[3];
    const packSize   = parseInt(m[4], 10);
    // Ticket field == "999" → this QR was scanned from the book/pack label
    // rather than a specific ticket. Return a book-level result so the
    // scan engine doesn't try to extract a ticket number (and so the
    // Receive Books UI can use the authoritative pack size straight from
    // the barcode).
    if (rawTicket === BOOK_LEVEL_SENTINEL) {
      return {
        type: 'book',
        gameNumber,
        bookNumber,
        packSize: Number.isFinite(packSize) && packSize > 0 ? packSize : null,
        state: 'MA',
        source: 'qr',
      };
    }
    return {
      type: 'ticket',
      gameNumber,
      bookNumber,
      ticketNumber: parseInt(rawTicket, 10),
      packSize: Number.isFinite(packSize) && packSize > 0 ? packSize : null,
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
