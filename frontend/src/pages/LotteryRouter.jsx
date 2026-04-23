/**
 * LotteryRouter — picks the right lottery view based on the ?tab= URL
 * param, and owns the shared tab bar at the top.
 *
 *   /portal/lottery                  → ?tab=daily (default) → LotteryBackOffice
 *   /portal/lottery?tab=daily        → LotteryBackOffice (3-column daily view)
 *   /portal/lottery?tab=shift-reports→ legacy Lottery.jsx, Shift Reports tab
 *   /portal/lottery?tab=reports      → legacy Lottery.jsx, Reports tab
 *   …
 *
 * All sub-views render BELOW the shared LotteryTabBar, and every tab click
 * is a URL update — so refresh preserves the selected tab and users can
 * share deep links.
 */

import React from 'react';
import { useSearchParams } from 'react-router-dom';
import LotteryBackOffice from './LotteryBackOffice';
import Lottery from './Lottery';
import LotteryTabBar from '../components/LotteryTabBar';

export default function LotteryRouter() {
  const [searchParams] = useSearchParams();
  const tab = searchParams.get('tab') || 'daily';
  return (
    <div className="lottery-router">
      <LotteryTabBar active={tab} />
      {tab === 'daily' ? <LotteryBackOffice /> : <Lottery urlTab={tab} />}
    </div>
  );
}
