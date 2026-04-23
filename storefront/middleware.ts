/**
 * Next.js middleware — multi-tenant store resolution.
 *
 * Resolves the store from the hostname:
 *   - Custom domain:  shop.joesmarket.com → pass as x-custom-domain header
 *   - Subdomain:      joes-market.shop.thefortunetech.com → slug = "joes-market"
 *   - Dev:            localhost:3000?store=joes-market → slug from query param
 */

import { NextResponse, type NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const { hostname, searchParams } = request.nextUrl;
  const response = NextResponse.next();

  let storeSlug: string | null = null;

  // 1. Dev mode: ?store=slug query param
  if (searchParams.has('store')) {
    storeSlug = searchParams.get('store');
  }
  // 2. Subdomain: {slug}.shop.{domain}
  else if (hostname.includes('.shop.')) {
    storeSlug = hostname.split('.')[0];
  }
  // 3. Not localhost and not platform domain → custom domain
  else if (
    hostname !== 'localhost' &&
    !hostname.startsWith('127.') &&
    !hostname.includes('thefortunetech.com')
  ) {
    response.headers.set('x-custom-domain', hostname);
    // Custom domains are resolved server-side via the API
  }

  if (storeSlug) {
    response.headers.set('x-store-slug', storeSlug);
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/).*)'],
};
