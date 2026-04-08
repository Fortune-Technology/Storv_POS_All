/**
 * Resolve the store slug from the incoming request context.
 *
 * Each organization/store has its own unique slug. The storefront
 * dynamically serves the correct store's data based on:
 *   1. ?store= query param (dev / testing)
 *   2. x-store-slug header (from middleware — subdomain detection)
 *   3. x-custom-domain header (from middleware — custom domain)
 *   4. DEFAULT_STORE_SLUG env var (fallback)
 */

import axios from 'axios';

const ECOM_API = process.env.ECOM_API_URL || 'http://localhost:5005/api';

export function getStoreSlug(ctx) {
  // 1. Query param (?store=joes-market)
  if (ctx.query?.store) return ctx.query.store;

  // 2. Middleware-injected slug header (from subdomain)
  const slugHeader = ctx.req?.headers?.['x-store-slug'];
  if (slugHeader) return slugHeader;

  // 3. Subdomain from Host header (fallback if middleware didn't catch it)
  const host = ctx.req?.headers?.host || '';
  if (host.includes('.shop.')) {
    return host.split('.')[0];
  }

  // 4. Custom domain — resolved via API (returns slug or null)
  const customDomain = ctx.req?.headers?.['x-custom-domain'];
  if (customDomain) return `__domain__:${customDomain}`;

  // 5. Fallback
  return process.env.DEFAULT_STORE_SLUG || null;
}

/**
 * Shared getServerSideProps helper.
 * Loads store info + any additional data fetcher.
 */
export async function withStore(ctx, fetcher) {
  const { getStoreInfo } = await import('./api.js');

  let slug = getStoreSlug(ctx);
  if (!slug) {
    return { props: { store: null, storeSlug: null } };
  }

  try {
    // Custom domain resolution: query ecom-backend to get the slug
    if (slug.startsWith('__domain__:')) {
      const domain = slug.replace('__domain__:', '');
      try {
        const { data } = await axios.get(`${ECOM_API}/store-by-domain`, { params: { domain } });
        if (data?.data?.slug) {
          slug = data.data.slug;
        } else {
          return { props: { store: null, storeSlug: null } };
        }
      } catch {
        return { props: { store: null, storeSlug: null } };
      }
    }

    const store = await getStoreInfo(slug);
    const extra = fetcher ? await fetcher(slug, ctx) : {};
    return {
      props: { store, storeSlug: slug, ...extra },
    };
  } catch {
    return { props: { store: null, storeSlug: slug } };
  }
}
