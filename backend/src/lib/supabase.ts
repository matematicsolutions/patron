import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  createSqliteClient,
  LOCAL_USER_ID,
} from "./db/supabase-shim";

/**
 * Backend bazy danych. Domyslnie "sqlite" (single-user, zero-cloud desktop).
 * "supabase" przywraca oryginalna sciezke Postgres+GoTrue (multi-tenant SaaS).
 * Sterowane env PATRON_DB_BACKEND. Vendor-neutral (AGENTS.md, ADR SQLite).
 */
export function isSqliteBackend(): boolean {
  return (process.env.PATRON_DB_BACKEND ?? "sqlite").toLowerCase() !== "supabase";
}

/**
 * Klient bazy. W trybie sqlite zwraca adapter (db/supabase-shim) rzutowany na
 * SupabaseClient - implementuje podzbior API uzywany przez backend, dzieki
 * czemu ~30 plikow call-site pozostaje bez zmian. W trybie supabase zwraca
 * prawdziwego klienta z service role key (bypassuje RLS - uzywac tylko w
 * route'ach po weryfikacji usera).
 */
export function createServerSupabase(): SupabaseClient {
  if (isSqliteBackend()) {
    return createSqliteClient() as unknown as SupabaseClient;
  }
  const url = process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SECRET_KEY || "";
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY must be set");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * Wyciaga i weryfikuje usera z requesta. W trybie sqlite (single-user) zwraca
 * staly lokalny UUID bez weryfikacji JWT (auth bypass). W trybie supabase
 * weryfikuje token przez GoTrue.
 */
export async function getUserIdFromRequest(req: Request): Promise<string> {
  if (isSqliteBackend()) {
    return LOCAL_USER_ID;
  }

  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) {
    throw new Response("Missing or invalid Authorization header", {
      status: 401,
    });
  }
  const token = auth.slice(7).trim();

  const supabaseUrl = process.env.SUPABASE_URL || "";
  const serviceKey = process.env.SUPABASE_SECRET_KEY || "";

  if (!supabaseUrl || !serviceKey) {
    throw new Response("Server auth is not configured", { status: 500 });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });
  const { data } = await admin.auth.getUser(token);
  if (!data.user) {
    throw new Response("Invalid or expired token", { status: 401 });
  }
  return data.user.id;
}
