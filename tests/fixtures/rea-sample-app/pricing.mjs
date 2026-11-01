/**
 * Authorized local sample app (REA toy fixture, universal-upgrade §9.7).
 * A deliberately small, CONTINUOUS piecewise-linear pricing module owned by
 * the test suite (breakpoints at 10 and 50 — both visible on the probe grid).
 * Used to prove: authorized analysis -> behavior spec -> ORIGINAL
 * implementation -> equivalence test. NOT production code.
 */
export function price(qty) {
  if (typeof qty !== "number" || !Number.isFinite(qty) || qty < 0) {
    throw new Error("qty must be a finite non-negative number");
  }
  if (qty <= 10) return qty * 2;
  if (qty <= 50) return 20 + (qty - 10) * 1.5;
  return 80 + (qty - 50) * 1;
}

// Deliberate archetype mismatch for the analyzer's numeric-output guard.
export function stringTransform(value) { return String(value) + "!"; }
