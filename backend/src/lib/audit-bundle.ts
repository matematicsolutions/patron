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
import { canonicalSha256 } from "./audit-pack";
import type { AuditPackEvent } from "./audit-pack";
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
    model_versions: AuditBundleModelVersions;
    cost_log: AuditBundleCostLog;
    manifest: { parts: AuditBundleManifestPart[] };
    verifier_instructions: { offline_cli: string; description: string };
    integrity: AuditBundleIntegrity;
}

const VERIFIER_INSTRUCTIONS = {
    offline_cli:
        "Uruchom z katalogu backend/: npx tsx scripts/verify-audit-bundle.ts <plik.json>",
    description:
        "Weryfikator dwustopniowy offline: (1) manifest - SHA256 kazdej czesci (deliverable, citation_verification, audit_log_excerpt, model_versions, cost_log) wykrywa, KTORA czesc zmieniono; (2) integrity.canonical_sha256 - hash calosci wykrywa dowolna modyfikacje. Dla weryfikacji ze eventy audit nie zostaly zmienione w bazie uzyj osobno Merkle proof (audit-pack ADR-0047). Bundle nie wymaga dostepu do bazy kancelarii.",
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

    const body: Omit<DeliverableAuditBundle, "integrity"> = {
        schema_version: AUDIT_BUNDLE_SCHEMA_VERSION,
        bundle_kind: AUDIT_BUNDLE_KIND,
        created_at: args.createdAt,
        deliverable,
        citation_verification,
        audit_log_excerpt: args.auditLogExcerpt,
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
