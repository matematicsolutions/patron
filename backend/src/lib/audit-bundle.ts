// ADR-0066: Audit bundle per-deliverable (realizacja rdzenia blueprintu ADR-0006).
//
// Samowystarczalny pakiet JSON dla JEDNEGO deliverable wysokiej stawki (opinia,
// pozew, draft umowy): tresc + wynik mechanicznej weryfikacji cytatow (ADR-0005
// grounding) + fragment hash-chain audit_log (ADR-0001) + wersje modelu + log
// kosztu + manifest SHA-256 per czesc. Dowod dla AI Act art. 12 (record-keeping)
// oraz na wypadek reklamacji klienta / pytania regulatora "jak powstala ta analiza".
//
// Wszystkie funkcje pure: deterministyczne, zero IO, testowalne bez mockow. Caller
// (route/CLI) wstrzykuje dane (tresc, grounding, eventy audit) i `createdAt`.
//
// Integralnosc: SHA-256 manifest per czesc + canonical_sha256 calosci - spojnie z
// audit-pack (ADR-0047). Podpis kryptograficzny Ed25519 + RFC 3161 = rezerwacja
// ADR-0049 (wspolna z audit-pack). NIE wprowadzamy klucza prywatnego serwera tu.
//
// Wzorzec architektoniczny: AnttiHero/lavern (Apache 2.0, bundle alongside
// deliverable) + 4-fazy walidacji wideo MateMatic. Implementacja PL od zera.

import { createHash } from "node:crypto";
import { GENESIS_HASH } from "./audit";
import { canonicalSha256, checkLegalBreakMarker, recomputePackEventHash } from "./audit-pack";
import type { AuditArtifactVerdict, AuditPackEvent } from "./audit-pack";
import type { GroundingResult } from "./citation/grounding";

export const AUDIT_BUNDLE_SCHEMA_VERSION = "1.0";
export const AUDIT_BUNDLE_KIND = "deliverable_audit_bundle";

export interface AuditBundleDeliverable {
    chat_id: string | null;
    /** Finalna tresc deliverable (markdown odpowiedzi Patrona). */
    content_md: string;
    chars: number;
    /** SHA-256 surowej tresci content_md (intuicyjny "hash dokumentu"). */
    sha256: string;
}

export interface AuditBundleCitationVerification {
    summary: {
        total: number;
        verified: number;
        unverified: number;
        blocked: number;
    };
    items: GroundingResult[];
}

export interface AuditBundleModelVersions {
    model: string | null;
    /**
     * Skad wziety `model` (audyt 2026-09, D-02): "chat.message.assistant" -
     * zdarzenie zapisane dla TEJ odpowiedzi; "llm_route" - decyzja routingu w
     * czacie; null - nie ustalono (wtedy `model` tez jest null, bez zgadywania).
     */
    model_source?: "chat.message.assistant" | "llm_route" | null;
    /** Wersja powloki Patrona, jezeli znana w czasie generowania. */
    patron?: string | null;
    /** Snapshot wersji konektorow MCP (np. {"mcp-saos":"0.3.1"}). */
    connectors?: Record<string, string>;
}

export interface AuditBundleCostLog {
    /** false gdy Patron nie sledzi tokenow/kosztu w tej iteracji. */
    available: boolean;
    full_text_len?: number;
    event_count?: number;
    note?: string;
}

export interface AuditBundleManifestPart {
    name: string;
    sha256: string;
}

export interface AuditBundleIntegrity {
    algorithm: "SHA-256";
    canonical_sha256: string;
}

export interface DeliverableAuditBundle {
    schema_version: typeof AUDIT_BUNDLE_SCHEMA_VERSION;
    bundle_kind: typeof AUDIT_BUNDLE_KIND;
    created_at: string;
    deliverable: AuditBundleDeliverable;
    citation_verification: AuditBundleCitationVerification;
    /** Fragment hash-chain audit_log dla tego czatu (ADR-0001). */
    audit_log_excerpt: AuditPackEvent[];
    /**
     * Wiersze deklaracji `audit.chain.legal_break` dla wpisow wyciagu ze
     * znacznikiem `legal_break` (ADR-0164, decyzja 2026-10-06). Pole i czesc
     * manifestu o tej nazwie istnieja tylko, gdy wyciag ma zerwanie z mocy prawa.
     */
    legal_break_declarations?: AuditPackEvent[];
    model_versions: AuditBundleModelVersions;
    cost_log: AuditBundleCostLog;
    manifest: { parts: AuditBundleManifestPart[] };
    verifier_instructions: { browser: string; offline_cli: string; description: string };
    integrity: AuditBundleIntegrity;
}

// ADR-0142: narzedzia jada razem z bundlem w archiwum ZIP - odbiorca nie
// potrzebuje repozytorium Patrona ani zadnej instalacji.
const VERIFIER_INSTRUCTIONS = {
    browser:
        "Otworz SPRAWDZ-TEN-PLIK.html z tego archiwum i wskaz mu ten plik JSON. Nie wymaga instalacji ani polaczenia z siecia.",
    offline_cli:
        "python verify.py <plik.json> - weryfikator z tego archiwum, wylacznie biblioteka standardowa Pythona 3.8+. Kod wyjscia: 0 nienaruszony, 1 naruszony, 2 blad odczytu.",
    description:
        "Weryfikator trzystopniowy offline: (1) manifest - SHA256 kazdej czesci (deliverable, citation_verification, audit_log_excerpt, model_versions, cost_log) wykrywa, KTORA czesc zmieniono; (2) wyciag z dziennika: audit_log_excerpt to WYCIAG wpisow tej sprawy, nie pelny lancuch - wpisy innych spraw i zdarzenia systemowe sa pominiete, a luki raportowane jawnie; ogniwa prev_hash->hash sa sprawdzane miedzy wpisami wyciagu (kolejne numery albo poprzednik zadeklarowany jako obecny w wyciagu), numery musza rosnac, a hash wpisu z payloadem nie maskowanym (hash_inputs_complete) jest przeliczany z tresci; (3) integrity.canonical_sha256 - hash calosci wykrywa dowolna modyfikacje. Wpis zanonimizowany na podstawie RODO art. 17 niesie znacznik legal_break (hash pozostaje oryginalny, tresc daje hash_after z deklaracji), a deklaracje jada w legal_break_declarations - weryfikator sprawdza je i daje osobny stan: zerwanie z mocy prawa, ani naruszony, ani czyste OK. Przed wydaniem pakietu serwer przelicza hash kazdego wpisu wyciagu z jego pelnej tresci i sprawdza, ze poprzednik spoza wyciagu istnieje w dzienniku - przy niezgodnosci pakiet nie wychodzi (409). Ogniw przez luki odbiorca nie sprawdzi z tego pliku. Bundle nie wymaga dostepu do bazy kancelarii. Sprawdzenie NIE dowodzi autorstwa - do tego sluzy podpis kwalifikowany (rezerwacja ADR-0049).",
};

function sha256Raw(text: string): string {
    return createHash("sha256").update(text, "utf8").digest("hex");
}

function summarize(items: GroundingResult[]): AuditBundleCitationVerification["summary"] {
    return {
        total: items.length,
        verified: items.filter((r) => r.decision === "verified").length,
        unverified: items.filter((r) => r.decision === "unverified").length,
        blocked: items.filter((r) => r.decision === "blocked").length,
    };
}

/**
 * Buduje kompletny audit bundle z manifestem i integrity. Pure - caller podaje
 * wszystkie dane oraz `createdAt` (ISO-8601 UTC) zamiast Date.now() wewnetrznie.
 */
export function buildAuditBundle(args: {
    chatId: string | null;
    deliverableMd: string;
    citations: GroundingResult[];
    auditLogExcerpt: AuditPackEvent[];
    modelVersions: AuditBundleModelVersions;
    costLog: AuditBundleCostLog;
    createdAt: string;
    /** Deklaracje zerwania z mocy prawa dla wpisow wyciagu ze znacznikiem. */
    legalBreakDeclarations?: AuditPackEvent[];
}): DeliverableAuditBundle {
    const deliverable: AuditBundleDeliverable = {
        chat_id: args.chatId,
        content_md: args.deliverableMd,
        chars: args.deliverableMd.length,
        sha256: sha256Raw(args.deliverableMd),
    };
    const citation_verification: AuditBundleCitationVerification = {
        summary: summarize(args.citations),
        items: args.citations,
    };

    // Manifest: SHA256 per logiczna czesc (mostek do multi-plikowego designu
    // ADR-0006 przy single-JSON artefakcie - wskazuje, ktora czesc zmieniono).
    const parts: AuditBundleManifestPart[] = [
        { name: "deliverable", sha256: canonicalSha256(deliverable) },
        { name: "citation_verification", sha256: canonicalSha256(citation_verification) },
        { name: "audit_log_excerpt", sha256: canonicalSha256(args.auditLogExcerpt) },
        { name: "model_versions", sha256: canonicalSha256(args.modelVersions) },
        { name: "cost_log", sha256: canonicalSha256(args.costLog) },
    ];
    const deklaracje =
        args.legalBreakDeclarations && args.legalBreakDeclarations.length > 0
            ? args.legalBreakDeclarations
            : null;
    if (deklaracje) {
        parts.push({ name: "legal_break_declarations", sha256: canonicalSha256(deklaracje) });
    }

    const body: Omit<DeliverableAuditBundle, "integrity"> = {
        schema_version: AUDIT_BUNDLE_SCHEMA_VERSION,
        bundle_kind: AUDIT_BUNDLE_KIND,
        created_at: args.createdAt,
        deliverable,
        citation_verification,
        audit_log_excerpt: args.auditLogExcerpt,
        ...(deklaracje ? { legal_break_declarations: deklaracje } : {}),
        model_versions: args.modelVersions,
        cost_log: args.costLog,
        manifest: { parts },
        verifier_instructions: VERIFIER_INSTRUCTIONS,
    };

    return {
        ...body,
        integrity: {
            algorithm: "SHA-256",
            canonical_sha256: canonicalSha256(body),
        },
    };
}

export interface BundleIntegrityResult {
    ok: boolean;
    /** Nazwy czesci, ktorych SHA256 nie zgadza sie z manifestem. */
    tamperedParts: string[];
    expected?: string;
    actual?: string;
    error?: string;
}

/**
 * Weryfikuje integralnosc bundla offline. Pure. Sprawdza (1) czy SHA256 kazdej
 * czesci zgadza sie z manifestem, (2) czy canonical_sha256 calosci sie zgadza.
 */
export function verifyAuditBundleIntegrity(
    bundle: DeliverableAuditBundle,
): BundleIntegrityResult {
    if (!bundle || typeof bundle !== "object") {
        return { ok: false, tamperedParts: [], error: "bundle nie jest obiektem" };
    }
    if (bundle.schema_version !== AUDIT_BUNDLE_SCHEMA_VERSION) {
        return {
            ok: false,
            tamperedParts: [],
            error: `schema_version ${bundle.schema_version} nieobslugiwana, oczekiwano ${AUDIT_BUNDLE_SCHEMA_VERSION}`,
        };
    }
    if (
        !bundle.integrity ||
        bundle.integrity.algorithm !== "SHA-256" ||
        typeof bundle.integrity.canonical_sha256 !== "string"
    ) {
        return { ok: false, tamperedParts: [], error: "brak/zly integrity.canonical_sha256" };
    }

    // 1) per-czesc manifest
    const partValue: Record<string, unknown> = {
        deliverable: bundle.deliverable,
        citation_verification: bundle.citation_verification,
        audit_log_excerpt: bundle.audit_log_excerpt,
        legal_break_declarations: bundle.legal_break_declarations,
        model_versions: bundle.model_versions,
        cost_log: bundle.cost_log,
    };
    const tamperedParts: string[] = [];
    for (const part of bundle.manifest?.parts ?? []) {
        const expected = part.sha256;
        const actual = canonicalSha256(partValue[part.name]);
        if (expected !== actual) tamperedParts.push(part.name);
    }

    // 2) integrity calosci
    const { integrity: _integrity, ...rest } = bundle;
    void _integrity;
    const actual = canonicalSha256(rest);
    const expected = bundle.integrity.canonical_sha256;
    const integrityOk = actual === expected;

    if (tamperedParts.length > 0 || !integrityOk) {
        return {
            ok: false,
            tamperedParts,
            expected,
            actual,
            error: integrityOk
                ? `czesci zmodyfikowane: ${tamperedParts.join(", ")}`
                : "canonical_sha256 mismatch - bundle zmodyfikowany po wygenerowaniu",
        };
    }
    return { ok: true, tamperedParts: [], expected, actual };
}

// ---------------------------------------------------------------------------
// Wyciag z dziennika (audyt 2026-09, D-01)
// ---------------------------------------------------------------------------
//
// Wyciag jest filtrowany po chat_id, wiec jego wpisy NIE sa kolejnymi ogniwami
// globalnego lancucha: miedzy nimi leza zdarzenia innych spraw, uploadow,
// routingu. Weryfikator, ktory wymagal prev_hash == hash poprzedniego wpisu W
// PLIKU, raportowal kazdy autentyczny pakiet jako sfalszowany. Teraz:
//   - ogniwo jest sprawdzane, gdy poprzednik jest w wyciagu (po hashu), a
//     wymagane, gdy numery sa kolejne albo wydawca zadeklarowal poprzednika
//     jako obecny (`parent_in_excerpt`);
//   - kolejne numery bez ogniwa to zerwanie - chyba ze oba wpisy wskazuja tego
//     samego poprzednika (rozwidlenie z wyscigu zapisow sprzed straznika,
//     ADR-0161);
//   - pozostale przejscia to LUKI wyciagu, raportowane jawnie, bez werdyktu;
//   - numery musza rosnac scisle (przestawienie, duplikat);
//   - hash wpisu z kompletem pol (`hash_inputs_complete`) jest przeliczany.
// Ten sam algorytm: verify_excerpt (verify.py) i sprawdzWyciag (HTML);
// zgodnosc pilnuje audit-verifier-assets.test.ts.

/**
 * Ustawia `parent_in_excerpt` na kazdym wpisie: czy wiersz o hashu `prev_hash`
 * tez jest w wyciagu. Pure - nie zmienia wejscia.
 */
export function annotateExcerptLinks(events: ReadonlyArray<AuditPackEvent>): AuditPackEvent[] {
    const hashe = new Set(events.map((e) => e.hash));
    return events.map((e) => ({ ...e, parent_in_excerpt: hashe.has(e.prev_hash) }));
}

export interface ExcerptVerification {
    ok: boolean;
    entries: number;
    /** Ogniwa sprawdzone w obrebie wyciagu. */
    links: number;
    /** Przejscia przez wpisy spoza wyciagu - nie do sprawdzenia z pliku. */
    gaps: number;
    /** Wpisy, ktorych hash przeliczono z tresci. */
    recomputed: number;
    /** Wpisy z payloadem zamaskowanym - hash nie do przeliczenia z pliku. */
    masked: number;
    /** Wpisy zerwane z mocy prawa, ze znacznikiem potwierdzonym deklaracja. */
    legal_breaks: number;
    /** id deklaracji, ktore potwierdzily zerwania (rosnaco, bez powtorzen). */
    legal_break_declaration_ids: number[];
    problems: string[];
}

function jestId(x: unknown): x is number {
    return typeof x === "number" && Number.isInteger(x);
}

/**
 * Weryfikuje wyciag audit_log z pakietu deliverable. Pure. Lustro
 * `verify_excerpt` (verify.py) i `sprawdzWyciag` (HTML) - ten sam werdykt.
 * Wpis ze znacznikiem `legal_break` sprawdza checkLegalBreakMarker wobec
 * `declarations` (legal_break_declarations pakietu) zamiast porownania tresci
 * z oryginalnym hashem; ogniwa lancucha ida po oryginalnych hashach.
 */
export function verifyAuditExcerpt(excerpt: unknown, declarations: unknown = []): ExcerptVerification {
    const wynik: ExcerptVerification = {
        ok: true,
        entries: 0,
        links: 0,
        gaps: 0,
        recomputed: 0,
        masked: 0,
        legal_breaks: 0,
        legal_break_declaration_ids: [],
        problems: [],
    };
    const deklaracje: unknown[] = Array.isArray(declarations) ? declarations : [];
    const potwierdzone = new Set<number>();
    if (!Array.isArray(excerpt)) {
        wynik.ok = false;
        wynik.problems.push("wyciag z dziennika nie jest lista");
        return wynik;
    }
    wynik.entries = excerpt.length;
    const znane = new Map<string, number>();
    let poprzedni: Record<string, unknown> | null = null;
    for (const surowy of excerpt as unknown[]) {
        if (!surowy || typeof surowy !== "object" || Array.isArray(surowy)) {
            wynik.problems.push("wpis wyciagu nie jest obiektem");
            continue;
        }
        const e = surowy as Record<string, unknown>;
        const id = e.id;
        if (!jestId(id)) {
            wynik.problems.push("wpis bez poprawnego numeru");
            continue;
        }
        if (poprzedni && !(id > (poprzedni.id as number))) {
            wynik.problems.push(`numery nie rosna (wpis ${id} po ${String(poprzedni.id)}) - kolejnosc zmieniona`);
        }
        if (e.legal_break !== undefined && e.legal_break !== null) {
            const zerwanie = checkLegalBreakMarker(e, deklaracje);
            if (zerwanie.length > 0) wynik.problems.push(...zerwanie);
            else {
                wynik.legal_breaks++;
                potwierdzone.add((e.legal_break as { declaration_event_id: number }).declaration_event_id);
            }
        } else if (e.hash_inputs_complete === true) {
            const h = recomputePackEventHash(e);
            if (h === null) wynik.problems.push(`wpis ${id}: niepelny - brak pol potrzebnych do przeliczenia hasha`);
            else if (h !== e.hash) wynik.problems.push(`wpis ${id}: tresc nie zgadza sie z hashem`);
            else wynik.recomputed++;
        } else {
            wynik.masked++;
        }
        const ph = e.prev_hash;
        if (typeof ph === "string" && znane.has(ph)) {
            wynik.links++;
        } else if (ph === GENESIS_HASH) {
            // poczatek lancucha - nie ma czego laczyc
        } else if (e.parent_in_excerpt === true) {
            wynik.problems.push(`wpis ${id}: poprzednika zadeklarowanego w wyciagu nie ma w pliku - wpis usunieto`);
        } else if (poprzedni && id === (poprzedni.id as number) + 1) {
            if (ph === poprzedni.prev_hash) {
                wynik.links++;
            } else {
                wynik.problems.push(`ogniwo miedzy kolejnymi wpisami ${String(poprzedni.id)} i ${id} przerwane`);
            }
        } else if (poprzedni) {
            wynik.gaps++;
        }
        if (typeof e.hash === "string") znane.set(e.hash, id);
        poprzedni = e;
    }
    wynik.legal_break_declaration_ids = [...potwierdzone].sort((a, b) => a - b);
    wynik.ok = wynik.problems.length === 0;
    return wynik;
}

export interface BundleVerification {
    /** true dla werdyktu "ok" i "legal_break" - zadnej manipulacji nie wykryto. */
    ok: boolean;
    /** Lustro kodow verify.py: ok = 0, legal_break = 3, tampered = 1. */
    verdict: AuditArtifactVerdict;
    integrity: BundleIntegrityResult;
    excerpt: ExcerptVerification;
}

/** Pelna weryfikacja bundla: manifest + integrity + wyciag. Lustro verify.py. */
export function verifyAuditBundle(bundle: DeliverableAuditBundle): BundleVerification {
    const integrity = verifyAuditBundleIntegrity(bundle);
    const excerpt = verifyAuditExcerpt(bundle?.audit_log_excerpt, bundle?.legal_break_declarations);
    const ok = integrity.ok && excerpt.ok;
    const verdict: AuditArtifactVerdict = !ok ? "tampered" : excerpt.legal_breaks > 0 ? "legal_break" : "ok";
    return { ok, verdict, integrity, excerpt };
}

/** Buduje filename `audit-bundle-{chatId|nochat}-{YYYYMMDD}.json`. Pure. */
export function buildAuditBundleFilename(
    chatId: string | null,
    createdAt: string,
): string {
    const slug = chatId ? chatId.slice(0, 8) : "nochat";
    const d = new Date(createdAt);
    if (Number.isNaN(d.getTime())) return `audit-bundle-${slug}.json`;
    const pad = (n: number) => String(n).padStart(2, "0");
    const dateStr = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
    return `audit-bundle-${slug}-${dateStr}.json`;
}
