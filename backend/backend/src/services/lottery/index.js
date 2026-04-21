// Public surface of the lottery services module.
// Keeps controller imports clean: `import * as lottery from '../services/lottery/index.js';`

export { getAdapter, allAdapters, supportedStates } from './adapters/_registry.js';
export { parseScan } from './engine/scanParser.js';
export { processScan, findBox, nextFreeSlot } from './engine/autoActivator.js';
export {
  runPendingMoveSweep,
  startPendingMoveScheduler,
  stopPendingMoveScheduler,
} from './engine/pendingMover.js';
