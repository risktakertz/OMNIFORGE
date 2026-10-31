# booking-lite template

Zero-dependency appointment booking page: services, open-day picker, free-slot
grid with double-booking prevention (per browser), local persistence and an
optional WhatsApp confirmation deep-link.

Deliberately **demo-mode**: no external calendar, no SMS, no email sending —
those require approved credentials and are separate milestones
(`docs/SECURITY_AND_PERMISSIONS.md`).

```bash
npm run generate && npm test && npx serve dist
```

Customize via `project.template.json` / workspace `params`: business info,
services (id, name, minutes, price), `hours` (open/close/slotMinutes/daysAhead/
closedWeekends), contact (whatsapp in international digits enables the
confirmation link).
