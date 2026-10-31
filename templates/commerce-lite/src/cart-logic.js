// Pure cart logic — no DOM, fully unit-testable.
export function addToCart(cart, productId, qty = 1) {
  const existing = cart.find((l) => l.productId === productId);
  if (existing) {
    return cart.map((l) => (l.productId === productId ? { ...l, qty: l.qty + qty } : l));
  }
  return [...cart, { productId, qty }];
}

export function removeFromCart(cart, productId) {
  return cart.filter((l) => l.productId !== productId);
}

export function setQty(cart, productId, qty) {
  if (qty <= 0) return removeFromCart(cart, productId);
  return cart.map((l) => (l.productId === productId ? { ...l, qty } : l));
}

export function cartTotal(cart, products) {
  return cart.reduce((sum, line) => {
    const p = products.find((x) => x.id === line.productId);
    return sum + (p ? p.price * line.qty : 0);
  }, 0);
}

export function cartCount(cart) {
  return cart.reduce((n, l) => n + l.qty, 0);
}
