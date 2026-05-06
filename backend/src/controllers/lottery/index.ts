/**
 * Barrel — re-exports every public handler from the lottery controller
 * sub-modules so route files can keep importing from the original
 * `controllers/lotteryController.ts` shim path. Maintains backward
 * compatibility for every existing import. (S81 — refactor pass D, S53 pattern.)
 *
 * Module layout:
 *   helpers.ts         — getOrgId/getStore + parseDate + num + permissive row types
 *   games.ts           — Game catalog (4 handlers)
 *   boxes.ts           — Boxes + Ticket adjustment (6)
 *   transactions.ts    — Per-shift sale/payout (3)
 *   shiftReports.ts    — Shift reconciliation + history (5)
 *   reports.ts         — Dashboard + range report + commission (3)
 *   settings.ts        — LotterySettings (2)
 *   catalog.ts         — Ticket catalog + ticket requests + receive + state-sync (11)
 *   scanLocation.ts    — Scan + location moves + pending-sweep (8)
 *   dailyOnline.ts     — Online totals + daily inventory + counter snapshot + historical (6)
 *   settlement.ts      — Weekly settlement (5)
 */

export {
  getLotteryGames,
  createLotteryGame,
  updateLotteryGame,
  deleteLotteryGame,
} from './games.js';

export {
  getLotteryBoxes,
  receiveBoxOrder,
  activateBox,
  updateBox,
  deleteBox,
  adjustBoxTickets,
} from './boxes.js';

export {
  getLotteryTransactions,
  createLotteryTransaction,
  bulkCreateLotteryTransactions,
} from './transactions.js';

export {
  getLotteryShiftReport,
  saveLotteryShiftReport,
  getShiftReports,
  getPreviousShiftReadings,
  getShiftAudit,
} from './shiftReports.js';

export {
  getLotteryDashboard,
  getLotteryReport,
  getLotteryCommissionReport,
} from './reports.js';

export {
  getLotterySettings,
  updateLotterySettings,
} from './settings.js';

export {
  getCatalogTickets,
  getAllCatalogTickets,
  createCatalogTicket,
  updateCatalogTicket,
  deleteCatalogTicket,
  getTicketRequests,
  createTicketRequest,
  reviewTicketRequest,
  getPendingRequestCount,
  receiveFromCatalog,
  syncLotteryCatalog,
} from './catalog.js';

export {
  parseLotteryScan,
  scanLotteryBarcode,
  moveBoxToSafe,
  markBoxSoldout,
  restoreBoxToCounter,
  returnBoxToLotto,
  cancelPendingMove,
  runPendingMovesNow,
} from './scanLocation.js';

export {
  getLotteryOnlineTotal,
  upsertLotteryOnlineTotal,
  getDailyLotteryInventory,
  getYesterdayCloses,
  getCounterSnapshot,
  upsertHistoricalClose,
} from './dailyOnline.js';

export {
  listLotterySettlements,
  getLotterySettlement,
  upsertLotterySettlement,
  finalizeLotterySettlement,
  markLotterySettlementPaid,
} from './settlement.js';
