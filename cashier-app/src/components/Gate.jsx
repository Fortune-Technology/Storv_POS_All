// <Gate> — declarative module-entitlement wrapper for cashier-app (S80 Phase 2)
// See frontend/src/components/Gate.jsx for full docs. Mirror with cashier-app's
// useEntitlements hook.
import useEntitlements from '../hooks/useEntitlements.js';

export default function Gate({ module, moduleAny, moduleAll, fallback = null, children }) {
  const { has } = useEntitlements();

  let allowed;
  if (module) {
    allowed = has(module);
  } else if (Array.isArray(moduleAny) && moduleAny.length) {
    allowed = moduleAny.some(k => has(k));
  } else if (Array.isArray(moduleAll) && moduleAll.length) {
    allowed = moduleAll.every(k => has(k));
  } else {
    allowed = true;
  }

  if (!allowed) return fallback;
  return children;
}
