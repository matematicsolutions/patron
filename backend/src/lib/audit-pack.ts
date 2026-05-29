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
import type { ProofBundle } from "./audit-merkle-roots";

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
}

export interface AuditPackVerifierInstructions {
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
    verifier_instructions: AuditPackVerifierInstructions;
    integrity: AuditPackIntegrity;
}

const VERIFIER_INSTRUCTIONS: AuditPackVerifierInstructions = {
    offline_cli:
        "Uruchom z katalogu backend/: npx tsx scripts/verify-audit-pack.ts <plik.json>",
    library:
        "backend/src/lib/audit-pack.ts -> verifyAuditPackIntegrity(pack) + backend/src/lib/audit-merkle-verifier.ts -> verifyProofBundle(pack.merkle_proof_bundle)",
    description:
        "Weryfikator dwustopniowy: (1) integrity SHA256 wykrywa modyfikacje pliku po wyniesieniu z kancelarii, (2) Merkle proof bundle weryfikuje ze event nie zostal zmieniony w audit_log. Audytor nie potrzebuje dostepu do bazy kancelarii ani innych eventow.",
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
}): Omit<AuditPack, "integrity"> {
    return {
        schema_version: AUDIT_PACK_SCHEMA_VERSION,
        pack_kind: AUDIT_PACK_KIND,
        exported_at: args.exportedAt,
        exporter: args.exporter,
        event: args.event,
        merkle_proof_bundle: args.bundle,
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
