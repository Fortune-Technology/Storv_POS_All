// ─────────────────────────────────────────────────
// <Gate> — declarative module-entitlement wrapper (S80 Phase 2)
//
// Renders children only when the active store has access to the named
// module(s). Hides cleanly otherwise. Optional `fallback` prop renders
// in place of the children when gated out (use for upgrade CTAs).
//
// Examples:
//   <Gate module="lottery"><LotterySection /></Gate>
//   <Gate moduleAny={['ecom_setup','ecom_orders']}><EcomLink /></Gate>
//   <Gate module="predictions" fallback={<UpgradeNudge />}>...</Gate>
// ─────────────────────────────────────────────────
import usePlanModules from '../hooks/usePlanModules';

export default function Gate({ module, moduleAny, moduleAll, fallback = null, children }) {
  const { has } = usePlanModules();

  let allowed;
  if (module) {
    allowed = has(module);
  } else if (Array.isArray(moduleAny) && moduleAny.length) {
    allowed = moduleAny.some(k => has(k));
  } else if (Array.isArray(moduleAll) && moduleAll.length) {
    allowed = moduleAll.every(k => has(k));
  } else {
    // No spec → permissive (so a typo doesn't accidentally hide content)
    allowed = true;
  }

  if (!allowed) return fallback;
  return children;
}
