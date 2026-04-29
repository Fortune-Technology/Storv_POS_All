/**
 * Fuel — pump + tank inventory + FIFO cost tracking.
 *
 *   inventory.ts — full FIFO + topology resolver:
 *     • applySale / applyRefund  — drain or credit FIFO layers per tank
 *     • resolveTankForSale       — independent / manifolded / sequential
 *                                  / blend tank picking (incl. dispenser
 *                                  blending for middle grades like Plus 89)
 *     • recordDelivery           — BOL → FIFO layer creation
 *     • recordStickReading       — variance vs software-expected level
 *     • checkDeliveryCostVariance — flags BOL price > rolling avg threshold
 *
 * One file for now — the math is tightly coupled. If we ever split later,
 * good seams: layers/ (FIFO logic) + topology/ (single/manifold/seq/blend)
 * + reconciliation/ (stick readings + variance).
 */

export * from './inventory.js';
