# booking template (composition guide)

- **Appointment flow (v0.1):** `booking-lite` — services, slot logic, WhatsApp
  deep-link, local persistence, demo-mode by design.
- **Multi-staff calendars, reminders, payments:** composed later with an
  approved calendar provider and notification gateway
  (`integrations/adapters/automation/`); every outbound message requires
  explicit approval and credentials.
