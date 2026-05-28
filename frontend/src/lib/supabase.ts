import { createClient } from "@supabase/supabase-js";

// W trybie local (single-user desktop, ADR-0062) Supabase nie jest uzywany,
// ale ten modul i tak jest importowany (AuthContext). createClient z pustym
// URL rzuca przy imporcie - placeholdery sprawiaja, ze import jest bezpieczny.
// W trybie supabase realne wartosci z env nadpisuja placeholdery.
const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL || "http://localhost:54321";
const supabaseAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||
    "local-mode-placeholder-key";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
