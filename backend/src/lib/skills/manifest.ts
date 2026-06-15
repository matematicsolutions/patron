// Kontrakt paczki skilla (ADR-0094). Czyste funkcje: walidacja manifestu i
// deskryptory skilli WBUDOWANYCH. Brak I/O - testowalne bez bazy i bez FS.
//
// Skill = paczka DANYCH (manifest + prompt), nie kod. Loader skanuje lokalny
// katalog, waliduje tym modulem, utrwala stan w bazie (store.ts). Market /
// podpis / entitlement = rezerwacja (pola obecne w v1, logika pozniej).

export const MANIFEST_VERSION = 1 as const;

/** Gdzie skill sie wpina. Rozszerzalny - na start tylko etap pipeline obrony. */
export type SkillSurface = "draft-stage";
export const VALID_SURFACES: ReadonlySet<SkillSurface> = new Set<SkillSurface>([
  "draft-stage",
]);

/** Plaszczyzna egress skilla (ROZLACZNA od egressu danych klienta). */
export type SkillEgress = "no-egress" | "cloud-allowed";
export const VALID_EGRESS: ReadonlySet<SkillEgress> = new Set<SkillEgress>([
  "no-egress",
  "cloud-allowed",
]);

/** Zrodlo paczki. `marketplace` = rezerwacja (klient marketu jako dostawca). */
export type SkillSource = "local-file" | "builtin" | "marketplace";
export const VALID_SOURCES: ReadonlySet<SkillSource> = new Set<SkillSource>([
  "local-file",
  "builtin",
  "marketplace",
]);

export interface SkillPrompt {
  system: string;
  user: string;
}

export interface SkillManifest {
  manifest_version: typeof MANIFEST_VERSION;
  id: string;
  name: string;
  description: string;
  version: string;
  surface: SkillSurface;
  prompt: SkillPrompt;
  egress: SkillEgress;
  source: SkillSource;
  publisher: string | null;
  /** Rezerwacja: podpis Ed25519 paczki. null = niepodpisana / lokalna. */
  signature: string | null;
}

/** Skill widziany przez UI: manifest + stan + czy wbudowany (read-only). */
export interface SkillEntry {
  id: string;
  name: string;
  description: string;
  version: string;
  surface: SkillSurface;
  source: SkillSource;
  egress: SkillEgress;
  publisher: string | null;
  signed: boolean;
  builtin: boolean;
  enabled: boolean;
}

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/; // kebab-case
const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const MAX_PROMPT_CHARS = 20_000; // H: limit rozmiaru promptu skilla (DoS)

export type ValidateResult =
  | { ok: true; manifest: SkillManifest }
  | { ok: false; error: string };

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Waliduje surowy manifest (np. z importowanego pliku). Pure. Normalizuje
 * brakujace pola opcjonalne do bezpiecznych domyslnych (egress=no-egress).
 * NIE wykonuje skilla i nie dotyka bazy - sprawdza wylacznie ksztalt kontraktu.
 */
export function validateManifest(input: unknown): ValidateResult {
  if (!isObj(input)) return { ok: false, error: "Manifest nie jest obiektem JSON." };

  if (input.manifest_version !== MANIFEST_VERSION) {
    return {
      ok: false,
      error: `Nieobslugiwana wersja manifestu (oczekiwano ${MANIFEST_VERSION}).`,
    };
  }

  const id = input.id;
  if (typeof id !== "string" || !ID_RE.test(id)) {
    return { ok: false, error: "Pole 'id' musi byc w formacie kebab-case." };
  }

  const name = input.name;
  if (typeof name !== "string" || !name.trim()) {
    return { ok: false, error: "Pole 'name' jest wymagane." };
  }

  const description = typeof input.description === "string" ? input.description : "";

  const version = input.version;
  if (typeof version !== "string" || !SEMVER_RE.test(version)) {
    return { ok: false, error: "Pole 'version' musi byc semver (np. 1.0.0)." };
  }

  const surface = input.surface;
  if (typeof surface !== "string" || !VALID_SURFACES.has(surface as SkillSurface)) {
    return {
      ok: false,
      error: `Pole 'surface' poza dozwolonymi: ${[...VALID_SURFACES].join(", ")}.`,
    };
  }

  if (!isObj(input.prompt)) {
    return { ok: false, error: "Pole 'prompt' musi zawierac { system, user }." };
  }
  const system = input.prompt.system;
  const user = input.prompt.user;
  if (typeof system !== "string" || typeof user !== "string") {
    return { ok: false, error: "Prompt: 'system' i 'user' musza byc tekstem." };
  }
  if (system.length + user.length > MAX_PROMPT_CHARS) {
    return { ok: false, error: `Prompt przekracza limit ${MAX_PROMPT_CHARS} znakow.` };
  }

  // egress: domyslnie no-egress (privacy by default).
  const egressRaw = input.egress ?? "no-egress";
  if (typeof egressRaw !== "string" || !VALID_EGRESS.has(egressRaw as SkillEgress)) {
    return { ok: false, error: "Pole 'egress' poza dozwolonymi (no-egress|cloud-allowed)." };
  }

  // source: importowane z pliku domyslnie local-file.
  const sourceRaw = input.source ?? "local-file";
  if (typeof sourceRaw !== "string" || !VALID_SOURCES.has(sourceRaw as SkillSource)) {
    return { ok: false, error: "Pole 'source' poza dozwolonymi." };
  }

  const publisher =
    typeof input.publisher === "string" && input.publisher.trim()
      ? input.publisher.trim()
      : null;
  const signature = typeof input.signature === "string" ? input.signature : null;

  return {
    ok: true,
    manifest: {
      manifest_version: MANIFEST_VERSION,
      id,
      name: name.trim(),
      description,
      version,
      surface: surface as SkillSurface,
      prompt: { system, user },
      egress: egressRaw as SkillEgress,
      source: sourceRaw as SkillSource,
      publisher,
      signature,
    },
  };
}

/**
 * Skille WBUDOWANE - etapy pipeline obrony (ADR-0058) zaprezentowane jako
 * read-only umiejetnosci. Do czasu wyniesienia ich z defense.ts do paczek
 * (krok 2) sa zrodlem prawdy listy. Nie da sie ich usunac ani wylaczyc.
 */
export const BUILTIN_SKILLS: ReadonlyArray<SkillEntry> = [
  {
    id: "recenzent",
    name: "Recenzent",
    description:
      "Konstruktywny senior recenzent pisma: wzmacnia slabe argumenty, poprawia " +
      "strukture i powolania, eliminuje marketingowy belkot (fidelity marko-pl-content).",
    version: "1.0.0",
    surface: "draft-stage",
    source: "builtin",
    egress: "no-egress",
    publisher: "MateMatic",
    signed: true,
    builtin: true,
    enabled: true,
  },
  {
    id: "adwokat",
    name: "Adwokat diabla",
    description:
      "Uodparnia pismo na atak - przewiduje i zbija kontrargumenty. Trzy tryby: " +
      "strona przeciwna, sklad orzekajacy, prokurator.",
    version: "1.0.0",
    surface: "draft-stage",
    source: "builtin",
    egress: "no-egress",
    publisher: "MateMatic",
    signed: true,
    builtin: true,
    enabled: true,
  },
  {
    id: "pisz-po-ludzku",
    name: "Pisz po ludzku",
    description:
      "Usuwa znamiona tekstu generowanego przez AI, zachowujac precyzje prawnicza " +
      "i tresc merytoryczna (fidelity humanizer-pl).",
    version: "1.0.0",
    surface: "draft-stage",
    source: "builtin",
    egress: "no-egress",
    publisher: "MateMatic",
    signed: true,
    builtin: true,
    enabled: true,
  },
];

export const BUILTIN_IDS: ReadonlySet<string> = new Set(
  BUILTIN_SKILLS.map((s) => s.id),
);

/** Manifest -> wpis listy (skill zainstalowany). */
export function manifestToEntry(m: SkillManifest, enabled: boolean): SkillEntry {
  return {
    id: m.id,
    name: m.name,
    description: m.description,
    version: m.version,
    surface: m.surface,
    source: m.source,
    egress: m.egress,
    publisher: m.publisher,
    signed: m.signature !== null,
    builtin: false,
    enabled,
  };
}
