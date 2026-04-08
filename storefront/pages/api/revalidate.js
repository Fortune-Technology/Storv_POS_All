/**
 * On-demand ISR revalidation endpoint.
 * Called by the ecom-backend when product/page data changes.
 *
 * Usage: POST /api/revalidate?secret=TOKEN  body: { path: "/products/beer" }
 */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = req.query.secret;
  if (secret !== process.env.REVALIDATE_SECRET) {
    return res.status(401).json({ error: 'Invalid revalidation secret' });
  }

  const { path } = req.body;
  if (!path) {
    return res.status(400).json({ error: 'path is required' });
  }

  try {
    await res.revalidate(path);
    return res.json({ revalidated: true, path });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to revalidate', details: err.message });
  }
}
