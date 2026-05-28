// Brain store - file-based pamiec PATRON (Bibliotekarz, ADR-0057).
//
// Mirror wzorca auto-memory (MEMORY.md + topic files), ale dla kancelarii:
// per-sprawa (scope = projectId) lub osobista (scope = "personal"). Pamiec to
// zwykle pliki .md z frontmatter - czytelne dla czlowieka, wersjonowalne,
// przenosne, RODO-friendly (lokalny dysk, "zapomnij sprawe X" = usun katalog).
//
// Deterministyczny: zero LLM. To czesc, ktora ZAPISUJE. Decyzja "co zapisac"
// nalezy do modelu w czacie (narzedzie remember) lub do warstwy auto-background
// (rezerwacja). Sciezka: PATRON_BRAIN_DIR lub %APPDATA%/PATRON/brain.

import fs from "fs";
import os from "os";
import path from "path";

export type MemoryType =
  | "fakt-sprawy" // ustalony fakt dotyczacy sprawy
  | "preferencja" // styl/preferencja mecenasa (np. forma pism)
  | "decyzja" // decyzja procesowa/strategiczna
  | "kontakt" // osoba/strona/pelnomocnik
  | "termin" // termin procesowy/zadanie
  | "notatka"; // ogolna notatka

export interface MemoryEntry {
  scope: string;
  slug: string;
  type: MemoryType | string;
  title: string;
  description: string;
  body: string;
  created_at: string;
  updated_at: string;
}

export interface SaveResult {
  scope: string;
  slug: string;
  path: string;
  action: "created" | "updated";
}

function brainRoot(): string {
  if (process.env.PATRON_BRAIN_DIR) return process.env.PATRON_BRAIN_DIR;
  const base =
    process.platform === "win32"
      ? process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming")
      : path.join(os.homedir(), ".patron");
  return path.join(base, "PATRON", "brain");
}

/** Sanityzuje segment sciezki (scope/slug) - kebab, bez traversal. */
export function sanitizeSegment(value: string, fallback: string): string {
  const cleaned = (value ?? "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return cleaned || fallback;
}

function scopeDir(scope: string): string {
  const safe = sanitizeSegment(scope, "personal");
  const root = path.resolve(brainRoot());
  const dir = path.resolve(root, safe);
  if (dir !== path.join(root, safe)) {
    throw new Error(`[brain] niedozwolony scope: ${scope}`);
  }
  return dir;
}

function nowIso(): string {
  return new Date().toISOString();
}

function frontmatter(e: MemoryEntry): string {
  return [
    "---",
    `name: ${e.slug}`,
    `type: ${e.type}`,
    `title: ${e.title.replace(/\n/g, " ")}`,
    `description: ${e.description.replace(/\n/g, " ")}`,
    `created_at: ${e.created_at}`,
    `updated_at: ${e.updated_at}`,
    "---",
    "",
  ].join("\n");
}

function parseFrontmatter(raw: string): Record<string, string> {
  const m = raw.match(/^---\n([\s\S]*?)\n---/);
  const out: Record<string, string> = {};
  if (!m) return out;
  for (const line of m[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return out;
}

function memoryBody(raw: string): string {
  const m = raw.match(/^---\n[\s\S]*?\n---\n?([\s\S]*)$/);
  return (m ? m[1] : raw).trim();
}

/**
 * Zapisuje (upsert po slug) wpis pamieci do brain/<scope>/<slug>.md i
 * aktualizuje INDEX.md scope. Pierwszy zapis = created (zachowuje created_at),
 * kolejny = updated. Zwraca sciezke i akcje (transparency dla mecenasa).
 */
export function saveMemory(input: {
  scope: string;
  slug: string;
  type: MemoryType | string;
  title: string;
  description?: string;
  body: string;
}): SaveResult {
  const dir = scopeDir(input.scope);
  fs.mkdirSync(dir, { recursive: true });
  const slug = sanitizeSegment(input.slug, "notatka");
  const file = path.join(dir, `${slug}.md`);
  const ts = nowIso();

  let created_at = ts;
  let action: "created" | "updated" = "created";
  if (fs.existsSync(file)) {
    action = "updated";
    const fm = parseFrontmatter(fs.readFileSync(file, "utf8"));
    if (fm.created_at) created_at = fm.created_at;
  }

  const entry: MemoryEntry = {
    scope: sanitizeSegment(input.scope, "personal"),
    slug,
    type: input.type,
    title: input.title.trim() || slug,
    description: (input.description ?? input.title).trim(),
    body: input.body.trim(),
    created_at,
    updated_at: ts,
  };
  fs.writeFileSync(file, frontmatter(entry) + entry.body + "\n", "utf8");
  updateIndex(dir);
  return { scope: entry.scope, slug, path: file, action };
}

/** Przebudowuje INDEX.md scope z frontmatterow plikow .md (poza INDEX.md). */
function updateIndex(dir: string): void {
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f !== "INDEX.md")
    .sort();
  const lines = ["# Pamiec - indeks", ""];
  for (const f of files) {
    const fm = parseFrontmatter(fs.readFileSync(path.join(dir, f), "utf8"));
    const title = fm.title || f.replace(/\.md$/, "");
    const desc = fm.description || "";
    const type = fm.type ? `[${fm.type}] ` : "";
    lines.push(`- ${type}[${title}](${f})${desc ? ` - ${desc}` : ""}`);
  }
  fs.writeFileSync(path.join(dir, "INDEX.md"), lines.join("\n") + "\n", "utf8");
}

export interface MemorySummary {
  slug: string;
  type: string;
  title: string;
  description: string;
  updated_at: string;
}

/** Lista wpisow pamieci dla scope (metadane z frontmatter). */
export function listMemories(scope: string): MemorySummary[] {
  const dir = scopeDir(scope);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f !== "INDEX.md")
    .map((f) => {
      const fm = parseFrontmatter(fs.readFileSync(path.join(dir, f), "utf8"));
      return {
        slug: f.replace(/\.md$/, ""),
        type: fm.type ?? "notatka",
        title: fm.title ?? f,
        description: fm.description ?? "",
        updated_at: fm.updated_at ?? "",
      };
    })
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

/** Czyta pelna tresc wpisu (frontmatter + body) lub null. */
export function readMemory(
  scope: string,
  slug: string,
): { meta: Record<string, string>; body: string } | null {
  const dir = scopeDir(scope);
  const file = path.join(dir, `${sanitizeSegment(slug, "notatka")}.md`);
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, "utf8");
  return { meta: parseFrontmatter(raw), body: memoryBody(raw) };
}

/** Usuwa caly brain scope (RODO art. 17 - "zapomnij sprawe X"). */
export function forgetScope(scope: string): boolean {
  const dir = scopeDir(scope);
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}
