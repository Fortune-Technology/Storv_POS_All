/**
 * ackParsers/index.ts — Dispatch table from manufacturer code to parser.
 *
 * Each parser exports `parseAck(content, fileName, mfrCode) → AckResult`.
 * The Altria + RJR parsers share their core implementation across sub-feeds
 * (the 3 Altria feeds use the same pipe format; the 3 RJR programs use the
 * same fixed-width body) — only the mfrCode tag differs in the result.
 */

import * as itgParser from './itg.js';
import * as altriaParser from './altria.js';
import * as rjrParser from './rjr.js';
import type { AckResult } from './common.js';

export type AckParser = (content: unknown, fileName: string | null) => AckResult;

const PARSERS: Record<string, AckParser> = {
  'itg':              (c, f) => itgParser.parseAck(c, f),
  'altria_pmusa':     (c, f) => altriaParser.parseAck(c, f, 'altria_pmusa'),
  'altria_usstc':     (c, f) => altriaParser.parseAck(c, f, 'altria_usstc'),
  'altria_middleton': (c, f) => altriaParser.parseAck(c, f, 'altria_middleton'),
  'rjr_edlp':         (c, f) => rjrParser.parseAck(c, f, 'rjr_edlp'),
  'rjr_scandata':     (c, f) => rjrParser.parseAck(c, f, 'rjr_scandata'),
  'rjr_vap':          (c, f) => rjrParser.parseAck(c, f, 'rjr_vap'),
};

export function getParser(mfrCode: string | null | undefined): AckParser | null {
  if (!mfrCode) return null;
  return PARSERS[mfrCode] || null;
}

export function parseAck(
  { mfrCode, content, fileName }: { mfrCode: string; content: unknown; fileName: string | null },
): AckResult {
  const parser = getParser(mfrCode);
  if (!parser) {
    throw new Error(`No ack parser registered for manufacturer code: ${mfrCode}`);
  }
  return parser(content, fileName);
}
