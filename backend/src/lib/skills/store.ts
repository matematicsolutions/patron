// Warstwa utrwalenia Biblioteki umiejetnosci (ADR-0094). Operacje na tabeli
// installed_skills przez shim supabase (parytet sqlite desktop / Postgres serwer).
// Skille WBUDOWANE nie sa w bazie - dochodza z manifest.ts (BUILTIN_SKILLS).

import { createServerSupabase } from "../supabase";
import type { CustomStageSpec } from "../pipeline/defense";
import {
  BUILTIN_SKILLS,
  manifestToEntry,
  type SkillEntry,
  type SkillManifest,
} from "./manifest";

type Db = ReturnType<typeof createServerSupabase>;

interface SkillRow {
  id: string;
  name: string;
  version: string;
  surface: string;
  source: string;
  egress: string;
  manifest: SkillManifest; // shim parsuje JSON_COLUMNS
  enabled: number | boolean;
  installed_at: string;
  updated_at: string;
}

function rowToEntry(r: SkillRow): SkillEntry {
  const enabled = r.enabled === true || r.enabled === 1;
  return manifestToEntry(r.manifest, enabled);
}

/** Lista: skille wbudowane (read-only) + zainstalowane (z bazy). */
export async function listSkills(
  db: Db,
): Promise<{ builtin: SkillEntry[]; installed: SkillEntry[] }> {
  const { data, error } = await db
    .from("installed_skills")
    .select("*")
    .order("installed_at", { ascending: true });
  if (error) throw new Error(error.message);
  const installed = (data ?? []).map((r) => rowToEntry(r as unknown as SkillRow));
  return { builtin: [...BUILTIN_SKILLS], installed };
}

export async function getSkillRow(db: Db, id: string): Promise<SkillRow | null> {
  const { data } = await db
    .from("installed_skills")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return (data as unknown as SkillRow) ?? null;
}

/**
 * Import (lub re-import) skilla z zwalidowanego manifestu. Upsert po id -
 * ponowny import tej samej umiejetnosci nadpisuje (reinstalacja). Zwraca wpis.
 */
export async function importSkill(
  db: Db,
  manifest: SkillManifest,
): Promise<SkillEntry> {
  const now = new Date().toISOString();
  const { error } = await db.from("installed_skills").upsert(
    {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      surface: manifest.surface,
      source: manifest.source,
      egress: manifest.egress,
      manifest,
      enabled: true,
      installed_at: now,
      updated_at: now,
    },
    { onConflict: "id" },
  );
  if (error) throw new Error(error.message);
  return manifestToEntry(manifest, true);
}

/** Wlacz/wylacz zainstalowany skill. Zwraca wpis albo null gdy nie istnieje. */
export async function setSkillEnabled(
  db: Db,
  id: string,
  enabled: boolean,
): Promise<SkillEntry | null> {
  const existing = await getSkillRow(db, id);
  if (!existing) return null;
  const { error } = await db
    .from("installed_skills")
    .update({ enabled, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
  return rowToEntry({ ...existing, enabled });
}

/**
 * Wlaczone skille o powierzchni draft-stage jako spec custom etapow do
 * pipeline obrony (ADR-0096). Kolejnosc = instalacji. Wbudowane NIE sa tu
 * (maja wlasne buildery w defense.ts).
 */
export async function loadEnabledDraftStageSkills(
  db: Db,
): Promise<CustomStageSpec[]> {
  const { data, error } = await db
    .from("installed_skills")
    .select("*")
    .eq("enabled", true)
    .order("installed_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? [])
    .map((r) => r as unknown as SkillRow)
    .filter((r) => r.manifest.surface === "draft-stage")
    .map((r) => ({
      id: r.id,
      name: r.name,
      system: r.manifest.prompt.system,
      user: r.manifest.prompt.user,
    }));
}

/** Usun zainstalowany skill. Zwraca false gdy nie istnial. */
export async function removeSkill(db: Db, id: string): Promise<boolean> {
  const existing = await getSkillRow(db, id);
  if (!existing) return false;
  const { error } = await db.from("installed_skills").delete().eq("id", id);
  if (error) throw new Error(error.message);
  return true;
}
