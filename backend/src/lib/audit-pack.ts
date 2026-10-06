// Pure functions skladajace audit pack JSON dla audytora (ADR-0047).
//
// Audit pack to samowystarczalny pakiet, ktory audytor zewnetrzny (UODO,
// rewident kancelarii, bieggly w postepowaniu) wynosi z UI viewera (ADR-0046)
// i weryfikuje offline przez `backend/scripts/verify-audit-pack.ts` bez
// dalszego dostepu do bazy kancelarii.
//
// Zawartosc pack: event z audit_log (zamaskowany payload per ADR-0040),
// Merkle proof bundle (ADR-0026, ADR-0036), instrukcje weryfikacji,
// integrity SHA256 dla wykrycia modyfikacji pliku po wyniesieniu.
//
// Wszystkie funkcje pure: deterministyczne, zero IO, testowalne bez mockow.
// Endpoint REST (`backend/src/routes/audit.ts`) tylko orchestruje wywolania.

import { createHash } from "node:crypto";
import { computeAuditHash } from "./audit";
import {
    LEGAL_BREAK_EVENT,
    collectLegalBreakDeclarations,
    isLegalBreakField,
} from "./audit-chain-verify";
import type { ProofBundle } from "./audit-merkle-roots";
import { verifyProofBundle, type VerificationResult } from "./audit-merkle-verifier";

export const AUDIT_PACK_SCHEMA_VERSION = "1.0";
export const AUDIT_PACK_KIND = "audit_event_export";

export interface AuditPackExporter {
    user_id: string | null;
    email: string | null;
}

export interface AuditPackEvent {
    id: number;
    event_type: string;
    ts: string;
    actor_user_id: string | null;
    chat_id: string | null;
    document_id: string | null;
    hash: string;
    prev_hash: string;
    payload_masked: unknown;
    /**
     * true: wszystkie pola, z ktorych liczono `hash` (ts, event_type,
     * actor_user_id, chat_id, document_id, payload), sa w tym wpisie BEZ ZMIAN -
     * maskowanie niczego nie ruszylo, wiec odbiorca przelicza hash z tresci
     * (audyt 2026-09, C-04 / D-01). Brak pola albo false: payload zamaskowany,
     * hash nie do przeliczenia z pliku; zgodnosc tresci z hashem sprawdzil
     * wydawca w chwili eksportu (inaczej eksport by nie wyszedl).
     */
    hash_inputs_complete?: boolean;
    /**
     * Tylko w wyciagu pakietu deliverable (D-01): true, gdy poprzednik wpisu
     * (wiersz o hashu `prev_hash`) tez jest w wyciagu. Weryfikator wymaga go
     * wtedy w pliku - brak to wpis usuniety z wyciagu. false: poprzednik lezy
     * poza wyciagiem (zdarzenie innej sprawy albo systemowe) - luka jawna, nie
     * zerwanie. To deklaracja wydawcy, chroniona tylko manifestem i suma
     * calosci - nie zastepuje podpisu (ADR-0049).
     */
    parent_in_excerpt?: boolean;
    /**
     * Zerwanie z mocy prawa (ADR-0164, decyzja wlasciciela produktu 2026-10-06):
     * wpis zanonimizowany na podstawie RODO art. 17. `hash` pozostaje
     * ORYGINALNY (lisc Merkle, ogniwo lancucha), a tresc wpisu jest juz po
     * anonimizacji - jej hash to `hash_after`, zadeklarowany zdarzeniem
     * `declaration_event_id`, ktorego wiersz jedzie w tym samym artefakcie.
     * Weryfikator daje wtedy osobny stan: nie "naruszony", nie czyste "OK".
     */
    legal_break?: AuditPackLegalBreak;
}

export interface AuditPackLegalBreak {
    declaration_event_id: number;
    reason: string;
    /** Pole wyzerowane z mocy prawa (actor_user_id / chat_id / document_id). */
    field: string;
    /** Hash tresci wpisu PO zerwaniu - ten z `affected_hashes_after` deklaracji. */
    hash_after: string;
}

export interface AuditPackVerifierInstructions {
    /** Weryfikacja bez instalacji czegokolwiek - plik HTML z archiwum. */
    browser: string;
    offline_cli: string;
    library: string;
    description: string;
}

export interface AuditPackIntegrity {
    algorithm: "SHA-256";
    canonical_sha256: string;
}

export interface AuditPack {
    schema_version: typeof AUDIT_PACK_SCHEMA_VERSION;
    pack_kind: typeof AUDIT_PACK_KIND;
    exported_at: string;
    exporter: AuditPackExporter;
    event: AuditPackEvent;
    merkle_proof_bundle: ProofBundle;
    /**
     * Wiersz deklaracji `audit.chain.legal_break`, gdy `event.legal_break` jest
     * ustawione - odbiorca sprawdza ja sam (hash z tresci, wymienione id i hash
     * po zerwaniu). Brak pola, gdy wpis nie jest zerwany.
     */
    legal_break_declaration?: AuditPackEvent;
    verifier_instructions: AuditPackVerifierInstructions;
    integrity: AuditPackIntegrity;
}

// ADR-0142: instrukcja opisuje narzedzia, ktore JADA RAZEM Z ARTEFAKTEM w
// archiwum ZIP. Wczesniejsza wersja odsylala odbiorce do katalogu `backend/`,
// czyli do repozytorium, ktorego sad ani regulator nie posiada - instrukcja
// byla wykonalna wylacznie dla kancelarii i dla nas.
const VERIFIER_INSTRUCTIONS: AuditPackVerifierInstructions = {
    browser:
        "Otworz SPRAWDZ-TEN-PLIK.html z tego archiwum i wskaz mu ten plik JSON. Nie wymaga instalacji ani polaczenia z siecia.",
    offline_cli:
        "python verify.py <plik.json> - weryfikator z tego archiwum, wylacznie biblioteka standardowa Pythona 3.8+. Kod wyjscia: 0 nienaruszony, 1 naruszony, 2 blad odczytu.",
    library:
        "Wydawca: backend/src/lib/audit-pack.ts -> verifyAuditPackIntegrity(pack) + backend/src/lib/audit-merkle-verifier.ts -> verifyProofBundle(pack.merkle_proof_bundle). Odbiorca NIE potrzebuje tego kodu - wystarcza mu weryfikatory z archiwum.",
    description:
        "Weryfikator trzystopniowy: (1) integrity SHA256 wykrywa modyfikacje pliku po wyniesieniu z kancelarii, (2) zgodnosc zdarzenia z dowodem: numer i hash zdarzenia musza byc tymi z dowodu Merkle, a gdy payload nie byl maskowany (hash_inputs_complete) hash jest przeliczany z tresci zdarzenia, (3) Merkle proof bundle wiaze hash zdarzenia z korzeniem zapieczetowanym w dzienniku. Przed wydaniem paczki serwer przelicza hash wpisu z jego tresci, sprawdza poprzednika i dowod wobec kazdego korzenia obejmujacego wpis - przy niezgodnosci eksport jest odmowiony (409). Przy payloadzie zamaskowanym odbiorca nie przeliczy hasha sam: polega na tej kontroli wydawcy. Wpis zanonimizowany na podstawie RODO art. 17 wychodzi ze znacznikiem event.legal_break i z wierszem deklaracji (legal_break_declaration): dowod Merkle dotyczy oryginalnego hasha, tresc wpisu musi dawac hash_after z deklaracji, a deklaracja musi byc nienaruszona i wymieniac ten wpis - werdykt to osobny stan: zerwanie z mocy prawa - ani naruszony, ani czyste OK. Audytor nie potrzebuje dostepu do bazy kancelarii ani innych eventow. Sprawdzenie NIE dowodzi autorstwa - do tego sluzy podpis kwalifikowany (rezerwacja ADR-0049).",
};

/**
 * Buduje pack bez pola `integrity`. Pure - deterministyczna struktura dla
 * danego (exporter, event, bundle, exportedAt). Uzywane wewnetrznie przez
 * `buildAuditPack` - integrity liczone na wyniku tej funkcji.
 */
function buildPackBody(args: {
    exporter: AuditPackExporter;
    event: AuditPackEvent;
    bundle: ProofBundle;
    exportedAt: string;
    legalBreakDeclaration?: AuditPackEvent;
}): Omit<AuditPack, "integrity"> {
    return {
        schema_version: AUDIT_PACK_SCHEMA_VERSION,
        pack_kind: AUDIT_PACK_KIND,
        exported_at: args.exportedAt,
        exporter: args.exporter,
        event: args.event,
        merkle_proof_bundle: args.bundle,
        ...(args.legalBreakDeclaration ? { legal_break_declaration: args.legalBreakDeclaration } : {}),
        verifier_instructions: VERIFIER_INSTRUCTIONS,
    };
}

/**
 * Kanoniczna serializacja JSON z deterministycznym porzadkiem kluczy
 * (rekurencyjnie, alfabetycznie). Niezalezna od kolejnosci wstawiania kluczy
 * w runtime - dwa pack-i z tym samym contentem maja identyczny SHA256.
 *
 * NIE uzywa JSON.stringify(obj, replacer) z replacerem bo replacer
 * Node.js obsluguje tylko object keys, nie array order. Tu sortowanie
 * dotyczy tylko obiektow - tablice (np. proof) zachowuja kolejnosc.
 */
export function canonicalJsonStringify(value: unknown): string {
    if (value === null || value === undefined) return JSON.stringify(value);
    if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        const items = value.map((v) => canonicalJsonStringify(v));
        return `[${items.join(",")}]`;
    }
    if (typeof value === "object") {
        const obj = value as Record<string, unknown>;
        // Pomijamy klucze o wartosci undefined - tak samo robi JSON.stringify, wiec
        // hash z pamieci zgadza sie z hashem po round-tripie przez plik JSON
        // (inaczej falszywy "tampered" dla pol opcjonalnych w audit-bundle).
        const keys = Object.keys(obj)
            .filter((k) => obj[k] !== undefined)
            .sort();
        const parts = keys.map(
            (k) => `${JSON.stringify(k)}:${canonicalJsonStringify(obj[k])}`,
        );
        return `{${parts.join(",")}}`;
    }
    // Fallback dla bigint/symbol/function - nieobslugiwane w audit pack.
    return JSON.stringify(null);
}

/**
 * Liczy SHA-256 z kanonicznej serializacji JSON dowolnej wartosci. Hex
 * lowercase, 64 znaki.
 */
export function canonicalSha256(value: unknown): string {
    const canonical = canonicalJsonStringify(value);
    return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * Buduje kompletny audit pack z integrity. Pure - testowalne bez Supabase,
 * caller wstrzykuje wszystkie dane wejsciowe.
 *
 * `exportedAt` - ISO-8601 UTC moment eksportu. Caller podaje wprost zamiast
 * Date.now() wewnetrznie aby zachowac purity (test moze zmienic czas).
 */
export function buildAuditPack(args: {
    exporter: AuditPackExporter;
    event: AuditPackEvent;
    bundle: ProofBundle;
    exportedAt: string;
    /** Wiersz deklaracji zerwania z mocy prawa - wymagany, gdy event.legal_break. */
    legalBreakDeclaration?: AuditPackEvent;
}): AuditPack {
    const body = buildPackBody(args);
    const canonical_sha256 = canonicalSha256(body);
    return {
        ...body,
        integrity: {
            algorithm: "SHA-256",
            canonical_sha256,
        },
    };
}

export interface PackIntegrityResult {
    ok: boolean;
    expected?: string;
    actual?: string;
    error?: string;
}

/**
 * Weryfikuje integrity SHA256 pack-u. Pure - audytor uzywa offline na
 * pliku JSON pobranym z UI. Wykrywa modyfikacje contentu po wyniesieniu.
 *
 * Workflow:
 *   1. Wyciagnij `integrity` z pack-u.
 *   2. Policz canonicalSha256 na pack-u bez pola `integrity`.
 *   3. Porownaj z `integrity.canonical_sha256`.
 *
 * Nie weryfikuje Merkle proof - to robi `verifyProofBundle` z
 * `audit-merkle-verifier.ts`. Audytor wywoluje obie funkcje.
 */
export function verifyAuditPackIntegrity(pack: AuditPack): PackIntegrityResult {
    if (!pack || typeof pack !== "object") {
        return { ok: false, error: "audit-pack: pack nie jest obiektem" };
    }
    if (!pack.integrity || typeof pack.integrity.canonical_sha256 !== "string") {
        return {
            ok: false,
            error: "audit-pack: brak pola integrity.canonical_sha256",
        };
    }
    if (pack.integrity.algorithm !== "SHA-256") {
        return {
            ok: false,
            error: `audit-pack: nieobslugiwany algorytm integrity ${pack.integrity.algorithm}`,
        };
    }
    if (pack.schema_version !== AUDIT_PACK_SCHEMA_VERSION) {
        return {
            ok: false,
            error: `audit-pack: schema_version ${pack.schema_version} nieobslugiwana, oczekiwano ${AUDIT_PACK_SCHEMA_VERSION}`,
        };
    }

    // Zbuduj body bez integrity i policz hash.
    const { integrity: _integrity, ...rest } = pack;
    void _integrity;
    const actual = canonicalSha256(rest);
    const expected = pack.integrity.canonical_sha256;

    if (actual !== expected) {
        return {
            ok: false,
            expected,
            actual,
            error: "audit-pack: canonical_sha256 mismatch - pack zostal zmodyfikowany po eksporcie",
        };
    }
    return { ok: true, expected, actual };
}

// ---------------------------------------------------------------------------
// Tresc wpisu a jego hash (audyt 2026-09, C-04 / D-01)
// ---------------------------------------------------------------------------

/** Wiersz audit_log z SUROWYM (niezamaskowanym) payloadem - tak jak w bazie. */
export interface StoredAuditRow {
    id: number;
    ts: string;
    event_type: string;
    actor_user_id: string | null;
    chat_id: string | null;
    document_id: string | null;
    payload: unknown;
    prev_hash: string;
    hash: string;
}

export interface StoredRowHashCheck {
    ok: boolean;
    /**
     * `ts` w postaci, z ktorej liczono hash. Postgres (timestamptz) oddaje
     * "2026-10-02T10:00:00.123+00:00", a hash powstal z toISOString() - ta sama
     * chwila w innym zapisie. Do paczki idzie postac hashowana, zeby odbiorca
     * mogl przeliczyc hash.
     */
    ts: string;
    recomputed: string;
}

/**
 * Przelicza hash wiersza z jego tresci (computeAuditHash) i porownuje z kolumna
 * `hash`. Jedyna tolerancja: zapis tej samej chwili `ts` (patrz StoredRowHashCheck)
 * - zmiana chwili, typu, aktora, czatu, dokumentu albo payloadu daje ok:false.
 */
export function checkStoredRowHash(row: StoredAuditRow): StoredRowHashCheck {
    return matchStoredRowHash(row, row.hash);
}

/**
 * Przelicza hash wiersza z jego tresci i porownuje z `expected` - z ta sama
 * tolerancja zapisu `ts` co checkStoredRowHash. Uzywane tez dla hasha PO
 * zerwaniu z mocy prawa (`affected_hashes_after` deklaracji).
 */
export function matchStoredRowHash(row: StoredAuditRow, expected: string): StoredRowHashCheck {
    const payload =
        row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
            ? (row.payload as Record<string, unknown>)
            : // payload, ktory nie jest obiektem, nie wyszedl z appendAuditEvent -
              // liczymy z nim mimo to, hash sie nie zgodzi i wiersz zostanie odrzucony.
              ({ nieczytelny_payload: row.payload } as Record<string, unknown>);
    const policz = (ts: string) =>
        computeAuditHash({
            prev_hash: row.prev_hash,
            ts,
            event_type: row.event_type,
            actor_user_id: row.actor_user_id,
            chat_id: row.chat_id,
            document_id: row.document_id,
            payload,
        });
    const surowy = policz(row.ts);
    if (surowy === expected) return { ok: true, ts: row.ts, recomputed: surowy };
    const chwila = Date.parse(row.ts);
    if (Number.isFinite(chwila)) {
        const iso = new Date(chwila).toISOString();
        if (iso !== row.ts) {
            const zIso = policz(iso);
            if (zIso === expected) return { ok: true, ts: iso, recomputed: zIso };
        }
    }
    return { ok: false, ts: row.ts, recomputed: surowy };
}

// ---------------------------------------------------------------------------
// Zerwanie z mocy prawa przy eksporcie (ADR-0164, decyzja 2026-10-06)
// ---------------------------------------------------------------------------

/**
 * Co serwer ustalil o wierszu, ktorego tresc nie zgadza sie z hashem:
 *   - verified: wazna deklaracja audit.chain.legal_break (wlasny hash zgodny,
 *     pozniejsza od wiersza, pole z deklaracji wyzerowane, aktualna tresc daje
 *     dokladnie zadeklarowany hash po zerwaniu) - eksport idzie ze znacznikiem;
 *   - none: zadna wazna deklaracja nie wymienia wiersza - odmowa;
 *   - field_not_null: deklaracja wymienia wiersz, ale nazwanego pola nie
 *     wyzerowano - niezgodnosci nie tlumaczy anonimizacja - odmowa;
 *   - old_format: deklaracja bez `affected_hashes_after` - odmowa (patrz nizej);
 *   - content_differs: tresc rozni sie od zadeklarowanej po zerwaniu - zmiana
 *     PO anonimizacji - odmowa.
 *
 * Dlaczego ODMOWA dla starego formatu, a nie eksport ze znacznikiem
 * "legal_break_unverified": deklaracja bez hasha po zerwaniu nie pozwala nikomu
 * - ani serwerowi, ani odbiorcy - odroznic samej anonimizacji od pozniejszej
 * zmiany payloadu, ts czy typu zdarzenia w tym samym wierszu (R-AC-01). Paczka
 * jest dowodem wydawanym NA ZEWNATRZ; znacznik "niezweryfikowane" przenioslby
 * na odbiorce rozstrzygniecie, ktorego on z pliku nie podejmie, a w praktyce
 * bylby czytany jak "OK". Lancuch (GET /api/audit/chain) nadal pokazuje taki
 * wiersz jako UWAGI z jawnym zastrzezeniem - to narzedzie administratora, nie
 * dowod dla sadu. Starej deklaracji nie da sie uzupelnic po fakcie: hash po
 * zerwaniu policzony dzis z biezacej tresci potwierdzalby dokladnie te zmiane,
 * ktorej nie umiemy wykluczyc.
 */
export type LegalBreakResolution =
    | {
          status: "verified";
          marker: AuditPackLegalBreak;
          /** `ts` wiersza w postaci, z ktorej liczono hash po zerwaniu. */
          ts: string;
          declaration: StoredAuditRow;
          /** `ts` deklaracji w postaci hashowanej. */
          declarationTs: string;
      }
    | {
          status: "none" | "field_not_null" | "old_format" | "content_differs";
          declarationEventId?: number;
      };

/**
 * Pure. Rozstrzyga zerwanie wiersza wobec deklaracji z dziennika. `declarations`
 * to wiersze audit_log (dowolne - funkcja sama wybiera `audit.chain.legal_break`
 * z poprawnym wlasnym hashem). Ta sama semantyka wyboru deklaracji co
 * weryfikator lancucha (collectLegalBreakDeclarations: pierwsza deklaracja
 * pozniejsza od wiersza), ale bez tolerancji dla starego formatu.
 */
export function resolveLegalBreak(
    row: StoredAuditRow,
    declarations: ReadonlyArray<StoredAuditRow>,
): LegalBreakResolution {
    const valid = new Map<number, { row: StoredAuditRow; ts: string }>();
    for (const d of declarations) {
        if (d.event_type !== LEGAL_BREAK_EVENT) continue;
        if (!d.payload || typeof d.payload !== "object" || Array.isArray(d.payload)) continue;
        const c = checkStoredRowHash(d);
        if (c.ok) valid.set(d.id, { row: d, ts: c.ts });
    }
    const declared = collectLegalBreakDeclarations(
        [...valid.values()].map((v) => ({
            id: v.row.id,
            event_type: v.row.event_type,
            payload: v.row.payload as Record<string, unknown>,
        })),
        new Set(),
    );
    const d = declared.get(row.id);
    if (!d) return { status: "none" };
    if (!isLegalBreakField(d.field) || row[d.field] !== null) {
        return { status: "field_not_null", declarationEventId: d.eventId };
    }
    if (d.hashAfter === null) return { status: "old_format", declarationEventId: d.eventId };
    const m = matchStoredRowHash(row, d.hashAfter);
    if (!m.ok || d.hashAfter === row.hash) {
        return { status: "content_differs", declarationEventId: d.eventId };
    }
    const decl = valid.get(d.eventId)!;
    return {
        status: "verified",
        marker: {
            declaration_event_id: d.eventId,
            reason: d.reason,
            field: d.field,
            hash_after: d.hashAfter,
        },
        ts: m.ts,
        declaration: decl.row,
        declarationTs: decl.ts,
    };
}

/**
 * Wiersz -> AuditPackEvent z flaga `hash_inputs_complete`. Caller podaje payload
 * juz zamaskowany; flaga jest true tylko wtedy, gdy maskowanie niczego nie
 * zmienilo (porownanie kanoniczne), a `ts` jest w postaci hashowanej.
 */
export function toVerifiablePackEvent(
    row: StoredAuditRow,
    payloadMasked: unknown,
    hashedTs: string,
): AuditPackEvent {
    const complete =
        canonicalJsonStringify(payloadMasked) === canonicalJsonStringify(row.payload) &&
        payloadMasked !== null &&
        typeof payloadMasked === "object" &&
        !Array.isArray(payloadMasked);
    return {
        id: row.id,
        event_type: row.event_type,
        ts: hashedTs,
        actor_user_id: row.actor_user_id,
        chat_id: row.chat_id,
        document_id: row.document_id,
        hash: row.hash,
        prev_hash: row.prev_hash,
        payload_masked: payloadMasked,
        hash_inputs_complete: complete,
    };
}

/**
 * Hash wpisu przeliczony z pliku - lustro `przeliczHash` (HTML) i
 * `recompute_event_hash` (verify.py). null, gdy wpis nie ma kompletu pol
 * tekstowych potrzebnych do przeliczenia.
 */
export function recomputePackEventHash(e: unknown): string | null {
    if (!e || typeof e !== "object" || Array.isArray(e)) return null;
    const w = e as Record<string, unknown>;
    if (typeof w.prev_hash !== "string" || typeof w.ts !== "string" || typeof w.event_type !== "string") {
        return null;
    }
    const p = w.payload_masked;
    return computeAuditHash({
        prev_hash: w.prev_hash,
        ts: w.ts,
        event_type: w.event_type,
        actor_user_id: (w.actor_user_id ?? null) as string | null,
        chat_id: (w.chat_id ?? null) as string | null,
        document_id: (w.document_id ?? null) as string | null,
        payload: (p === null || p === undefined ? {} : p) as Record<string, unknown>,
    });
}

export interface PackEventBindingResult {
    ok: boolean;
    /** true gdy hash przeliczono z tresci (hash_inputs_complete). */
    recomputed: boolean;
    problems: string[];
    /**
     * Znacznik zerwania z mocy prawa, gdy wpis go niesie i przeszedl kontrole
     * (checkLegalBreakMarker). null: wpis bez znacznika albo znacznik odrzucony
     * (wtedy problem jest w `problems`).
     */
    legalBreak: AuditPackLegalBreak | null;
}

/** Pola hasha, ktore znacznik zerwania moze nazwac (lustro HTML i verify.py). */
const LEGAL_BREAK_FIELDS = ["actor_user_id", "chat_id", "document_id"];
const HEX64 = /^[0-9a-f]{64}$/;

function jestIdWpisu(x: unknown): x is number {
    return typeof x === "number" && Number.isInteger(x);
}

/**
 * Kontrola ODBIORCY dla wpisu ze znacznikiem `legal_break` - lustro
 * `check_legal_break` (verify.py) i `sprawdzZerwanie` (HTML); ten sam werdykt
 * pilnuje audit-verifier-assets.test.ts. Zwraca liste problemow (pusta = znacznik
 * potwierdzony). Sprawdza:
 *   - ksztalt znacznika; pole z deklaracji jest wyzerowane we wpisie; hash po
 *     zerwaniu rozni sie od oryginalnego;
 *   - gdy tresc nie byla maskowana: hash przeliczony z tresci == hash_after;
 *   - deklaracja jest w pliku, jest zdarzeniem audit.chain.legal_break,
 *     pozniejszym od wpisu; gdy jej payload nie byl maskowany - jej hash
 *     przeliczony z tresci zgadza sie z jej hashem;
 *   - deklaracja nazywa ten sam powod i pole, wymienia wpis i podaje dla niego
 *     dokladnie ten hash po zerwaniu (deklaracja bez affected_hashes_after =
 *     stary format = problem: zmiany po anonimizacji nie da sie wykluczyc).
 * Dowod Merkle dotyczy ORYGINALNEGO hasha (kolumna hash) - sprawdza go osobny krok.
 */
export function checkLegalBreakMarker(entry: unknown, declarations: ReadonlyArray<unknown>): string[] {
    const e = (entry ?? {}) as Record<string, unknown>;
    const nr = String(e.id);
    const L = e.legal_break as Record<string, unknown> | null | undefined;
    if (!L || typeof L !== "object" || Array.isArray(L)) {
        return [`wpis ${nr}: znacznik zerwania z mocy prawa ma zly format`];
    }
    if (
        !jestIdWpisu(L.declaration_event_id) ||
        typeof L.reason !== "string" ||
        typeof L.field !== "string" ||
        !LEGAL_BREAK_FIELDS.includes(L.field) ||
        typeof L.hash_after !== "string" ||
        !HEX64.test(L.hash_after)
    ) {
        return [`wpis ${nr}: znacznik zerwania z mocy prawa ma zly format`];
    }
    const problems: string[] = [];
    const deklId = L.declaration_event_id;
    const wartoscPola = e[L.field];
    if (wartoscPola !== null && wartoscPola !== undefined) {
        problems.push(`wpis ${nr}: pole ${L.field} nie jest wyzerowane, choc znacznik tak twierdzi`);
    }
    if (L.hash_after === e.hash) {
        problems.push(`wpis ${nr}: hash po zerwaniu rowny oryginalnemu - znacznik bez pokrycia`);
    }
    if (e.hash_inputs_complete === true) {
        const h = recomputePackEventHash(e);
        if (h === null) problems.push(`wpis ${nr}: niepelny - brak pol potrzebnych do przeliczenia hasha`);
        else if (h !== L.hash_after) {
            problems.push(`wpis ${nr}: tresc rozni sie od zadeklarowanej po zerwaniu - zmiana po anonimizacji`);
        }
    }
    const D = declarations.find(
        (x) => !!x && typeof x === "object" && !Array.isArray(x) && (x as Record<string, unknown>).id === deklId,
    ) as Record<string, unknown> | undefined;
    if (!D) {
        problems.push(`wpis ${nr}: deklaracji #${deklId} nie ma w pliku`);
        return problems;
    }
    if (D.event_type !== LEGAL_BREAK_EVENT) {
        problems.push(`deklaracja #${deklId} nie jest zdarzeniem ${LEGAL_BREAK_EVENT}`);
    }
    if (!jestIdWpisu(e.id) || !(deklId > e.id)) {
        problems.push(`deklaracja #${deklId} nie jest pozniejsza od wpisu ${nr}`);
    }
    if (D.hash_inputs_complete === true) {
        const h = recomputePackEventHash(D);
        if (h === null) problems.push(`deklaracja #${deklId}: niepelna - brak pol potrzebnych do przeliczenia hasha`);
        else if (h !== D.hash) {
            problems.push(`deklaracja #${deklId}: tresc nie zgadza sie z jej hashem - deklaracje zmieniono`);
        }
    }
    const p = D.payload_masked as Record<string, unknown> | null | undefined;
    if (!p || typeof p !== "object" || Array.isArray(p)) {
        problems.push(`deklaracja #${deklId}: nieczytelna tresc`);
        return problems;
    }
    const powod = typeof p.reason === "string" ? p.reason : "nieznany powod";
    const pole = typeof p.field === "string" ? p.field : "actor_user_id";
    if (powod !== L.reason || pole !== L.field) {
        problems.push(`deklaracja #${deklId} nazywa inny powod albo inne pole niz znacznik wpisu ${nr}`);
    }
    const ids = p.affected_ids;
    const po = p.affected_hashes_after;
    if (!Array.isArray(ids) || !Array.isArray(po) || po.length !== ids.length) {
        problems.push(
            `deklaracja #${deklId} bez hashy po zerwaniu (stary format) - zmiany tresci po anonimizacji nie da sie wykluczyc`,
        );
        return problems;
    }
    const i = ids.findIndex((x) => jestIdWpisu(x) && x === e.id);
    if (i < 0) problems.push(`deklaracja #${deklId} nie wymienia wpisu ${nr}`);
    else if (po[i] !== L.hash_after) problems.push(`deklaracja #${deklId} podaje inny hash po zerwaniu dla wpisu ${nr}`);
    return problems;
}

/**
 * Wiazanie zdarzenia z dowodem Merkle i z wlasna trescia - lustro kroku [2/3]
 * verify.py i "Zgodność zdarzenia z dowodem" w HTML. Bez tego paczka z
 * podmienionym `event` (albo dowodem dla innego wpisu) przechodzila, bo dowod
 * Merkle dotyczyl `merkle_proof_bundle.event_hash`, a nie zdarzenia w pliku.
 * Wpis ze znacznikiem `legal_break`: hash (oryginalny) nadal musi byc tym z
 * dowodu, a tresc sprawdza checkLegalBreakMarker wobec `legal_break_declaration`.
 */
export function verifyPackEventBinding(pack: unknown): PackEventBindingResult {
    const problems: string[] = [];
    const d = (pack ?? {}) as Record<string, unknown>;
    const e = d.event as Record<string, unknown> | undefined;
    const b = d.merkle_proof_bundle as Record<string, unknown> | undefined;
    if (!e || typeof e !== "object" || !b || typeof b !== "object") {
        return {
            ok: false,
            recomputed: false,
            problems: ["brak sekcji event albo merkle_proof_bundle"],
            legalBreak: null,
        };
    }
    if (e.id !== b.event_id) problems.push("numer zdarzenia rozni sie od numeru w dowodzie Merkle");
    if (e.hash !== b.event_hash) problems.push("hash zdarzenia rozni sie od hasha w dowodzie Merkle");
    let recomputed = false;
    let legalBreak: AuditPackLegalBreak | null = null;
    if (e.legal_break !== undefined && e.legal_break !== null) {
        const decl = d.legal_break_declaration;
        const zerwanie = checkLegalBreakMarker(e, decl === undefined || decl === null ? [] : [decl]);
        problems.push(...zerwanie);
        if (zerwanie.length === 0) {
            legalBreak = e.legal_break as AuditPackLegalBreak;
            recomputed = e.hash_inputs_complete === true;
        }
    } else if (e.hash_inputs_complete === true) {
        const h = recomputePackEventHash(e);
        if (h === null) problems.push("niepelny wpis - brak pol potrzebnych do przeliczenia hasha");
        else if (h !== e.hash) problems.push("tresc zdarzenia nie zgadza sie z jego hashem");
        else recomputed = true;
    }
    const ok = problems.length === 0;
    return { ok, recomputed, problems, legalBreak: ok ? legalBreak : null };
}

/**
 * Werdykt artefaktu - wspolny dla paczki zdarzenia i pakietu deliverable:
 *   ok          - nienaruszony, bez zerwan;
 *   legal_break - nienaruszony, ale zawiera wpis zerwany z mocy prawa,
 *                 zadeklarowany i potwierdzony (osobny stan: NIE "naruszony",
 *                 NIE czyste "OK"; verify.py konczy sie kodem 3);
 *   tampered    - naruszony.
 */
export type AuditArtifactVerdict = "ok" | "legal_break" | "tampered";

export interface AuditPackVerification {
    verdict: AuditArtifactVerdict;
    /** true dla "ok" i "legal_break" - zadnej manipulacji nie wykryto. */
    ok: boolean;
    integrity: PackIntegrityResult;
    binding: PackEventBindingResult;
    merkle: VerificationResult;
}

/**
 * Pelna weryfikacja paczki zdarzenia: integrity + wiazanie zdarzenia z dowodem
 * (z kontrola zerwania z mocy prawa) + dowod Merkle dla ORYGINALNEGO hasha.
 * Lustro verify.py (kody 0 / 3 / 1) i HTML.
 */
export function verifyAuditPack(pack: AuditPack): AuditPackVerification {
    const integrity = verifyAuditPackIntegrity(pack);
    const binding = verifyPackEventBinding(pack);
    let merkle: VerificationResult;
    try {
        merkle = verifyProofBundle(pack?.merkle_proof_bundle);
    } catch (e) {
        merkle = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    const ok = integrity.ok && binding.ok && merkle.ok;
    const verdict: AuditArtifactVerdict = !ok ? "tampered" : binding.legalBreak ? "legal_break" : "ok";
    return { verdict, ok, integrity, binding, merkle };
}

/** Etykieta powodu dla czlowieka - lustro HTML i verify.py. */
export function legalBreakReasonLabel(reason: string): string {
    return reason === "rodo_art_17_anonymization" ? "RODO art. 17" : reason;
}

/**
 * Buduje filename `audit-pack-event-{id}-{YYYYMMDD}.json` dla
 * Content-Disposition. Pure - daty bierzemy z exportedAt zeby filename byl
 * zgodny z pack.exported_at.
 */
export function buildAuditPackFilename(eventId: number, exportedAt: string): string {
    const d = new Date(exportedAt);
    if (Number.isNaN(d.getTime())) {
        // Fallback dla nieprawidlowej daty - filename bez sufiksu daty.
        return `audit-pack-event-${eventId}.json`;
    }
    const pad = (n: number) => String(n).padStart(2, "0");
    const dateStr = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
    return `audit-pack-event-${eventId}-${dateStr}.json`;
}
