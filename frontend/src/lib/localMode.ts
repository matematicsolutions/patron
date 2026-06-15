// Tryb local (single-user desktop, ADR-0062). Wlaczany flaga
// NEXT_PUBLIC_PATRON_LOCAL_MODE=true. W tym trybie frontend NIE uzywa Supabase
// auth: jest jeden lokalny mecenas, brak ekranu logowania, a backend (tryb
// sqlite) i tak bypassuje weryfikacje tokenu. Token "local" jest wysylany tylko
// po to, by przejsc przez naglowek Authorization.

export const IS_LOCAL_MODE =
  process.env.NEXT_PUBLIC_PATRON_LOCAL_MODE === "true";

// Tozsamosc musi byc spojna z backendem (PATRON_LOCAL_USER_ID / _EMAIL,
// lib/db/sqlite-connection.ts). Domyslny lokalny user.
export const LOCAL_USER = {
  id:
    process.env.NEXT_PUBLIC_PATRON_LOCAL_USER_ID ||
    "00000000-0000-0000-0000-000000000001",
  email: process.env.NEXT_PUBLIC_PATRON_LOCAL_EMAIL || "local@patron",
};

/** Statyczny token dla trybu local (backend sqlite go ignoruje, ale naglowek musi byc). */
export const LOCAL_TOKEN = "local";
