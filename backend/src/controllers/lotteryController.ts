/**
 * lotteryController — split into `controllers/lottery/` folder (S81, refactor
 * pass D, S53 pattern). This file is now a 1-line shim so every existing
 * `import { ... } from '../controllers/lotteryController.js'` keeps working.
 *
 * Original 4422-line file is split across:
 *   - lottery/helpers.ts        (types + getOrgId/getStore + parseDate + num)
 *   - lottery/games.ts          (Games — 4 handlers)
 *   - lottery/boxes.ts          (Boxes + ticket adjustment — 6)
 *   - lottery/transactions.ts   (Per-shift sale/payout — 3)
 *   - lottery/shiftReports.ts   (Shift reconciliation + history — 5)
 *   - lottery/reports.ts        (Dashboard + report + commission — 3)
 *   - lottery/settings.ts       (Per-store LotterySettings — 2)
 *   - lottery/catalog.ts        (Ticket catalog + requests + receive + sync — 11)
 *   - lottery/scanLocation.ts   (Scan + location moves + sweep — 8)
 *   - lottery/dailyOnline.ts    (Online totals + daily inventory + yesterday — 6)
 *   - lottery/settlement.ts     (Weekly settlement — 5)
 *   - lottery/index.ts          (barrel)
 */

export * from './lottery/index.js';
