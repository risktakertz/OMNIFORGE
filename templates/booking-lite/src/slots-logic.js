// Pure slot logic — no DOM, fully unit-testable.
export function generateSlots(cfg, dayStartIso) {
  const { open, close, slotMinutes } = cfg;
  const start = new Date(dayStartIso);
  const slots = [];
  for (let minutes = open * 60; minutes + slotMinutes <= close * 60; minutes += slotMinutes) {
    const s = new Date(start);
    s.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    slots.push(s.toISOString());
  }
  return slots;
}

export function nextOpenDays(cfg, todayIso, count) {
  const days = [];
  const d = new Date(todayIso);
  while (days.length < (count ?? cfg.daysAhead ?? 14)) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (cfg.closedWeekends && (dow === 0 || dow === 6)) continue;
    const iso = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).toISOString();
    days.push(iso);
  }
  return days;
}

export function availableSlots(allSlots, takenIsoList) {
  const taken = new Set(takenIsoList);
  return allSlots.filter((s) => !taken.has(s));
}

export function isSlotAvailable(slotIso, takenIsoList) {
  return !takenIsoList.includes(slotIso);
}

export function summarizeBooking(service, slotIso, businessName) {
  const when = new Date(slotIso);
  const label = when.toLocaleString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
  return `Booking at ${businessName}: ${service.name} (${service.minutes} min, ${service.price}) on ${label}`;
}
