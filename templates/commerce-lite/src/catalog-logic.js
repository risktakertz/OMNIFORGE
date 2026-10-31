// Pure catalog logic — no DOM, fully unit-testable.
export function searchProducts(products, query) {
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) return [...products];
  return products.filter((p) =>
    [p.name, p.category, p.description].some((f) => String(f).toLowerCase().includes(q))
  );
}

export function filterByCategory(products, category) {
  if (!category || category === "All") return [...products];
  return products.filter((p) => p.category === category);
}

export function categoriesOf(products) {
  return ["All", ...[...new Set(products.map((p) => p.category))]];
}

export function productById(products, id) {
  return products.find((p) => p.id === id) ?? null;
}
