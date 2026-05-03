/**
 * marktPOSService.ts — DEPRECATED
 * IT Retail / MarktPOS integration has been removed.
 * This file is kept as a stub to prevent import errors during transition.
 */

export async function marktPOSRequest(): Promise<never> {
  throw new Error('IT Retail / MarktPOS integration has been removed.');
}

export async function syncProductsFromPOS(): Promise<never> {
  throw new Error('IT Retail / MarktPOS integration has been removed.');
}

export async function syncCustomersFromPOS(): Promise<never> {
  throw new Error('IT Retail / MarktPOS integration has been removed.');
}

export default { marktPOSRequest, syncProductsFromPOS, syncCustomersFromPOS };
