/**
 * @storeveu/queue — stub. Real BullMQ wiring lives in deployed infra; locally
 * and in CI we no-op everything so consumers keep working without Redis.
 *
 * Replace with a real implementation when the ecom sync pipeline is fully
 * activated. Producers (./producers.js) call into here and silently degrade.
 */

export async function getQueue(_name) {
  return null;
}

export const QUEUE_NAMES = {
  ECOM_SYNC: 'ecom-sync',
  ECOM_ORDERS: 'ecom-orders',
  ECOM_REVALIDATE: 'ecom-revalidate',
};
