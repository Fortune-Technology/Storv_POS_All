/**
 * On-demand ISR revalidation endpoint.
 * Called by the ecom-backend when product/page data changes.
 *
 * Usage: POST /api/revalidate?secret=TOKEN  body: { path: "/products/beer" }
 */

import type { NextApiRequest, NextApiResponse } from 'next';

interface RevalidateBody {
  path?: string;
}

interface RevalidateResponse {
  revalidated?: boolean;
  path?: string;
  error?: string;
  details?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<RevalidateResponse>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = req.query.secret;
  if (secret !== process.env.REVALIDATE_SECRET) {
    return res.status(401).json({ error: 'Invalid revalidation secret' });
  }

  const { path } = (req.body || {}) as RevalidateBody;
  if (!path) {
    return res.status(400).json({ error: 'path is required' });
  }

  try {
    await res.revalidate(path);
    return res.json({ revalidated: true, path });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: 'Failed to revalidate', details: message });
  }
}
