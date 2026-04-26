// Public surface of the lottery services module.
// Keeps controller imports clean: `import * as lottery from '../services/lottery/index.js';`

export { getAdapter, allAdapters, supportedStates } from './adapters/_registry.js';
export type {
  StateAdapter,
  StateCode,
  ParseResult,
  ParsedTicket,
  ParsedBook,
  SettlementRules,
  AdapterConfig,
} from './adapters/_base.js';

export { parseScan } from './engine/scanParser.js';
export type { ScanParseResult } from './engine/scanParser.js';

export {
  processScan,
  findBox,
  nextFreeSlot,
  detectSequenceGap,
} from './engine/autoActivator.js';
export type {
  ProcessScanInput,
  ProcessScanResult,
  SequenceGapWarning,
  LotteryBoxWithGame,
  DetectSequenceGapInput,
} from './engine/autoActivator.js';

export {
  runPendingMoveSweep,
  startPendingMoveScheduler,
  stopPendingMoveScheduler,
} from './engine/pendingMover.js';
export type {
  RunPendingMoveOpts,
  RunPendingMoveResult,
} from './engine/pendingMover.js';

export {
  weekStartFor,
  weekRangeFor,
  recentWeeks,
  isBookEligible,
  computeSettlement,
} from './engine/settlement.js';
export type {
  WeekRange,
  ComputeSettlementInput,
  CommissionRates,
  SettlementResult,
} from './engine/settlement.js';

export {
  fetchMACatalog,
  syncState,
  syncAllSupported,
  guessPackSize,
  DEFAULT_PACK_SIZE_RULES,
} from './catalogSync.js';
export type {
  PackSizeRule,
  CatalogRow,
  SyncDiff,
} from './catalogSync.js';
