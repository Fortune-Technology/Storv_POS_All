/**
 * ISR revalidation service — triggers on-demand page regeneration
 * in the Next.js storefront when product/page data changes.
 */

import axios from 'axios';

const STOREFRONT_URL = process.env.STOREFRONT_URL || 'http://localhost:3000';
const REVALIDATE_SECRET = process.env.REVALIDATE_SECRET || '';

/**
 * Trigger ISR revalidation for a specific path.
 * @param {string} path — e.g. "/products/budweiser-12-pack"
 */
export async function revalidatePath(path) {
  if (!REVALIDATE_SECRET) {
    console.warn('[revalidate] REVALIDATE_SECRET not set — skipping');
    return;
  }

  try {
    await axios.post(
      `${STOREFRONT_URL}/api/revalidate`,
      { path },
      {
        params: { secret: REVALIDATE_SECRET },
        timeout: 5000,
      }
    );
  } catch (err) {
    // Non-blocking: page will refresh on next ISR cycle anyway
    console.error('[revalidate] Failed to revalidate', path, ':', err.message);
  }
}

/**
 * Revalidate a product page.
 */
export async function revalidateProduct(storeSlug, productSlug) {
  await revalidatePath(`/products/${productSlug}`);
}

/**
 * Revalidate the product listing page.
 */
export async function revalidateProductListing() {
  await revalidatePath('/products');
}

/**
 * Revalidate a department page.
 */
export async function revalidateDepartment(departmentSlug) {
  await revalidatePath(`/departments/${departmentSlug}`);
}
