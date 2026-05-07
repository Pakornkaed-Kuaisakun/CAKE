// src/modules/calendar/index.ts
export { runAuthFlow, getAuthorizedClient } from "./auth.js";
export { listUpcoming, createEvent, deleteEvent } from "./events.js";
export type { CalendarEvent } from "./events.js";
