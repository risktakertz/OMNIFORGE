// Pure MOCK checkout — explicitly not a real payment processor.
// No network calls, no card data, no external endpoints.
export function validateCart(cart, products) {
  if (!Array.isArray(cart) || cart.length === 0) {
    return { ok: false, reason: "cart is empty" };
  }
  for (const line of cart) {
    const p = products.find((x) => x.id === line.productId);
    if (!p) return { ok: false, reason: `unknown product ${line.productId}` };
    if (!Number.isFinite(line.qty) || line.qty < 1) return { ok: false, reason: `invalid quantity for ${p.name}` };
  }
  return { ok: true };
}

/**
 * Mock checkout: creates a local order record. `mode` is always "mock" —
 * wiring a real payment provider requires an explicitly approved adapter
 * (docs/DEPLOYMENT_AND_ROLLBACK.md, docs/SECURITY_AND_PERMISSIONS.md).
 */
export function mockCheckout(cart, products, opts = {}) {
  const check = validateCart(cart, products);
  if (!check.ok) return { ok: false, reason: check.reason };
  const total = cart.reduce((sum, line) => {
    const p = products.find((x) => x.id === line.productId);
    return sum + (p ? p.price * line.qty : 0);
  }, 0);
  const order = {
    id: opts.idGenerator ? opts.idGenerator() : `ord_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    mode: "mock",
    status: "mock-paid",
    items: cart.map((line) => {
      const p = products.find((x) => x.id === line.productId);
      return { id: p.id, name: p.name, qty: line.qty, unitPrice: p.price };
    }),
    total: Math.round(total * 100) / 100,
    currency: opts.currency ?? "USD",
    placedAt: new Date().toISOString(),
  };
  return { ok: true, order };
}
