/**
 * App — state-machine router
 *
 * No station config  →  StationSetupScreen  (manager one-time setup)
 * Station but no cashier  →  PinLoginScreen  (cashier PIN entry)
 * Station + cashier  →  POSScreen  (full POS)
 */

import React from 'react';
import { useStationStore } from './stores/useStationStore.js';
import { useAuthStore }    from './stores/useAuthStore.js';
import StationSetupScreen  from './screens/StationSetupScreen.jsx';
import PinLoginScreen      from './screens/PinLoginScreen.jsx';
import POSScreen           from './screens/POSScreen.jsx';

export default function App() {
  const station = useStationStore(s => s.station);
  const cashier = useAuthStore(s => s.cashier);

  if (!station)        return <StationSetupScreen />;
  if (!cashier?.token) return <PinLoginScreen />;
  return <POSScreen />;
}
