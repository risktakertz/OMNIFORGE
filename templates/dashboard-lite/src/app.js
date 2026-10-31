import { applyFilters, kpis, revenueByDate, visibleSections, canExportCsv, toCsv } from "./dashboard-logic.js";

const cfg = JSON.parse(document.getElementById("dashboard-config").textContent);
const $ = (id) => document.getElementById(id);
const state = { role: cfg.defaultRole ?? "viewer", region: "all", channel: "all" };

function svgChart(points) {
  if (points.length === 0) return "<p class='muted'>No data for this filter.</p>";
  const w = 560, h = 180, pad = 28;
  const max = Math.max(...points.map((p) => p.revenue)) || 1;
  const step = points.length > 1 ? (w - pad * 2) / (points.length - 1) : 0;
  const coords = points.map((p, i) => [pad + i * step, h - pad - (p.revenue / max) * (h - pad * 2)]);
  const path = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const dots = coords.map(([x, y], i) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="currentColor"><title>${points[i].date}: ${points[i].revenue}</title></circle>`).join("");
  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Revenue trend chart">
    <line x1="${pad}" y1="${h - pad}" x2="${w - pad}" y2="${h - pad}" stroke="#d6d3d1"/>
    <line x1="${pad}" y1="${pad}" x2="${pad}" y2="${h - pad}" stroke="#d6d3d1"/>
    <path d="${path}" fill="none" stroke="currentColor" stroke-width="2.5"/>${dots}</svg>`;
}

function render() {
  const rows = applyFilters(cfg.metrics, { region: state.region, channel: state.channel });
  const k = kpis(rows);
  $("kpis").innerHTML = [
    ["Revenue", k.revenue.toLocaleString()],
    ["Orders", String(k.orders)],
    ["Avg order", k.avgOrderValue.toLocaleString()],
    ["Days", String(k.days)],
  ]
    .map(([label, value]) => `<div class="kpi"><p class="muted">${label}</p><p class="kpi-value">${value}</p></div>`)
    .join("");
  $("chart").innerHTML = svgChart(revenueByDate(rows));
  $("table-body").innerHTML = rows
    .map((r) => `<tr><td>${r.date}</td><td>${r.region}</td><td>${r.channel}</td><td>${r.revenue}</td><td>${r.orders}</td></tr>`)
    .join("");
  const sections = visibleSections(cfg.roles, state.role);
  $("admin-panel").hidden = !sections.includes("admin-panel");
  $("export-btn").hidden = !canExportCsv(cfg.roles, state.role);
  $("role-note").textContent = `Viewing as: ${state.role}${sections.includes("admin-panel") ? " (full access)" : " (restricted: admin panel and CSV export hidden — enforced in logic, not just CSS)"}`;
}

["role", "region", "channel"].forEach((id) => {
  $(id).addEventListener("change", (ev) => {
    state[id] = ev.target.value;
    render();
  });
});
$("export-btn").addEventListener("click", () => {
  if (!canExportCsv(cfg.roles, state.role)) return;
  const csv = toCsv(applyFilters(cfg.metrics, { region: state.region, channel: state.channel }));
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "metrics.csv";
  a.click();
  URL.revokeObjectURL(url);
});

render();
