/**
 * kbService.ts — AI Knowledge Base embedding + retrieval.
 *
 * Design notes:
 *   - Embeddings via OpenAI `text-embedding-3-small` (1536-dim, $0.02/1M tokens).
 *     The OPENAI_API_KEY is already set on the server for OCR enrichment.
 *   - Vectors stored in Postgres as `Float[]` (native array).
 *   - Cosine similarity computed in JS at query time. At <500 articles with
 *     1536-dim vectors this takes <20ms — fine without pgvector. Swap to
 *     pgvector if the KB grows beyond that.
 *   - Retrieval scope: org-owned articles (orgId match) + platform-wide
 *     (orgId=null). Articles authored by an admin for a specific org never
 *     leak to other orgs.
 */

import OpenAI from 'openai';
import prisma from '../config/postgres.js';

const EMBED_MODEL = 'text-embedding-3-small';
const EMBED_DIM   = 1536;

// Lazy-init the OpenAI client. Reading OPENAI_API_KEY at module-import time
// would freeze the client to whatever value process.env had at first import —
// which is empty when this file is imported before dotenv.config() runs (e.g.
// from a seed script that doesn't load .env explicitly). Defer the read until
// the first generateEmbedding() call so dotenv has a chance to populate env.
let _openai: OpenAI | null | undefined;   // undefined = not yet attempted
function getOpenAI(): OpenAI | null {
  if (_openai !== undefined) return _openai;
  const key = process.env.OPENAI_API_KEY;
  _openai = key ? new OpenAI({ apiKey: key }) : null;
  return _openai;
}

/**
 * Generate an embedding for a string. Returns null if OpenAI is not configured
 * or the call fails — callers should treat a null embedding as "skip RAG".
 */
export async function generateEmbedding(text: string | null | undefined): Promise<number[] | null> {
  const openai = getOpenAI();
  if (!openai || !text) return null;
  try {
    const clean = String(text).replace(/\s+/g, ' ').trim().slice(0, 8000);
    if (!clean) return null;
    const res = await openai.embeddings.create({ model: EMBED_MODEL, input: clean });
    const vec = res.data?.[0]?.embedding;
    return Array.isArray(vec) && vec.length === EMBED_DIM ? vec : null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[kbService] embedding failed:', message);
    return null;
  }
}

/** Cosine similarity between two equal-length numeric arrays. */
export function cosineSimilarity(
  a: number[] | null | undefined,
  b: number[] | null | undefined,
): number {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] || 0, y = b[i] || 0;
    dot += x * y;
    na  += x * x;
    nb  += y * y;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

export interface SearchKBOptions {
  /** Active org (for org-owned articles); null fetches platform-wide only. */
  orgId?: string | null;
  /** Max results (default 3). */
  limit?: number;
  /** Min cosine similarity (default 0.35). */
  threshold?: number;
}

export interface KBSearchHit {
  id: string;
  title: string;
  content: string;
  category: string;
  tags: string[];
  score: number;
}

/**
 * Find the top-K most relevant KB articles for a query.
 *
 * Returns [] if OpenAI is unavailable or no articles meet the threshold.
 */
export async function searchKB(
  query: string,
  opts: SearchKBOptions = {},
): Promise<KBSearchHit[]> {
  const { orgId = null, limit = 3, threshold = 0.35 } = opts;
  const qVec = await generateEmbedding(query);
  if (!qVec) return [];

  // Pull platform-wide + org-owned articles (small set; fine to load in memory).
  const rows = await prisma.aiKnowledgeArticle.findMany({
    where: {
      active: true,
      OR: [
        { orgId: null },
        ...(orgId ? [{ orgId }] : []),
      ],
    },
    select: {
      id: true, title: true, content: true, category: true,
      embedding: true, tags: true,
    },
  });

  type KBRow = (typeof rows)[number];
  type KBRowWithScore = KBRow & { score: number };
  const scored: KBRowWithScore[] = rows
    .map((r: KBRow): KBRowWithScore => ({ ...r, score: cosineSimilarity(qVec, r.embedding) }))
    .filter((r: KBRowWithScore) => r.score >= threshold)
    .sort((a: KBRowWithScore, b: KBRowWithScore) => b.score - a.score)
    .slice(0, limit);

  return scored.map((r: KBRowWithScore): KBSearchHit => ({
    id: r.id,
    title: r.title,
    content: r.content,
    category: r.category,
    tags: r.tags,
    score: Number(r.score.toFixed(3)),
  }));
}

/** Format retrieved articles for injection into the system prompt. */
export function formatKBForPrompt(articles: KBSearchHit[] | null | undefined): string {
  if (!articles?.length) return '';
  return [
    '',
    'RELEVANT KNOWLEDGE BASE ARTICLES:',
    '(Use these to answer the user\'s question. Cite exact UI paths when relevant.)',
    '',
    ...articles.map((a, i) => `[${i + 1}] ${a.title}\n${a.content}`),
    '',
  ].join('\n');
}

export default { generateEmbedding, cosineSimilarity, searchKB, formatKBForPrompt };
