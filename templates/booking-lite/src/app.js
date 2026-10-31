import { generateSlots, nextOpenDays, availableSlots, summarizeBooking } from "./slots-logic.js";

const cfg = JSON.parse(document.getElementById("booking-config").textContent);
const $ = (id) => document.getElementById(id);
const state = { serviceId: cfg.services[0]?.id, dayIso: null, slotIso: null };
const TAKEN_KEY = "of_bookings";

function takenList() {
  try {
    return JSON.parse(localStorage.getItem(TAKEN_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function renderDays() {
  const days = nextOpenDays(cfg.hours, new Date().toISOString());
  state.dayIso = state.dayIso ?? days[0];
  $("day-select").innerHTML = days
    .map((iso) => {
      const d = new Date(iso);
      const label = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
      return `<option value="${iso}" ${iso === state.dayIso ? "selected" : ""}>${label}</option>`;
    })
    .join("");
}

function renderSlots() {
  const all = generateSlots(cfg.hours, state.dayIso);
  const free = availableSlots(all, takenList());
  $("slot-grid").innerHTML =
    free.length === 0
      ? `<p class="muted">Fully booked this day — try another date.</p>`
      : free
          .map((iso) => {
            const t = new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
            return `<button class="slot ${iso === state.slotIso ? "active" : ""}" data-slot="${iso}">${t}</button>`;
          })
          .join("");
}

function renderServices() {
  $("service-list").innerHTML = cfg.services
    .map(
      (s) =>
        `<label class="service"><input type="radio" name="service" value="${s.id}" ${s.id === state.serviceId ? "checked" : ""}/> ${s.name} — ${s.minutes} min, ${s.price}</label>`
    )
    .join("");
}

function confirmBooking() {
  const service = cfg.services.find((s) => s.id === state.serviceId);
  if (!service || !state.slotIso) {
    $("status").textContent = "Pick a service and a free slot first.";
    return;
  }
  const taken = takenList();
  taken.push(state.slotIso);
  localStorage.setItem(TAKEN_KEY, JSON.stringify(taken));
  const summary = summarizeBooking(service, state.slotIso, cfg.business.name);
  $("status").textContent = `Booked (this browser): ${summary}`;
  const digits = String(cfg.contact.whatsapp ?? "").replace(/[^0-9]/g, "");
  if (digits) {
    window.open(`https://wa.me/${digits}?text=${encodeURIComponent(summary)}`, "_blank", "noopener");
  }
  state.slotIso = null;
  renderSlots();
}

renderServices();
renderDays();
renderSlots();
$("day-select").addEventListener("change", (ev) => {
  state.dayIso = ev.target.value;
  state.slotIso = null;
  renderSlots();
});
$("slot-grid").addEventListener("click", (ev) => {
  const b = ev.target instanceof Element ? ev.target.closest("[data-slot]") : null;
  if (!b) return;
  state.slotIso = b.getAttribute("data-slot");
  renderSlots();
});
$("service-list").addEventListener("change", (ev) => {
  if (ev.target.name === "service") state.serviceId = ev.target.value;
});
$("confirm-btn").addEventListener("click", confirmBooking);
