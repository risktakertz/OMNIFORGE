// Pure dashboard logic — no DOM, fully unit-testable.
export function applyFilters(rows, filters = {}) {
  return rows.filter((r) => {
    if (filters.region && filters.region !== "all" && r.region !== filters.region) return false;
    if (filters.channel && filters.channel !== "all" && r.channel !== filters.channel) return false;
    if (filters.from && r.date < filters.from) return false;
    if (filters.to && r.date > filters.to) return false;
    return true;
  });
}

export function kpis(rows) {
  const revenue = rows.reduce((s, r) => s + r.revenue, 0);
  const orders = rows.reduce((s, r) => s + r.orders, 0);
  return {
    revenue,
    orders,
    avgOrderValue: orders === 0 ? 0 : Math.round((revenue / orders) * 100) / 100,
    days: new Set(rows.map((r) => r.date)).size,
  };
}

export function revenueByDate(rows) {
  const byDate = new Map();
  for (const r of rows) byDate.set(r.date, (byDate.get(r.date) ?? 0) + r.revenue);
  return [...byDate.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, revenue]) => ({ date, revenue }));
}

export function visibleSections(roles, role) {
  return roles[role]?.sections ?? [];
}

export function canExportCsv(roles, role) {
  return roles[role]?.canExportCsv === true;
}

export function toCsv(rows) {
  const head = ["date", "region", "channel", "revenue", "orders"];
  const lines = rows.map((r) => [r.date, r.region, r.channel, r.revenue, r.orders].join(","));
  return [head.join(","), ...lines].join("\n");
}
