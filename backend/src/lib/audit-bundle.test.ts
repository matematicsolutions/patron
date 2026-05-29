import { describe, expect, it } from "vitest";
import type { GroundingResult } from "./citation/grounding";
import type { AuditPackEvent } from "./audit-pack";
import {
    AUDIT_BUNDLE_KIND,
    AUDIT_BUNDLE_SCHEMA_VERSION,
    buildAuditBundle,
    buildAuditBundleFilename,
    verifyAuditBundleIntegrity,
} from "./audit-bundle";

const CREATED_AT = "2026-05-29T10:00:00.000Z";

const citations: GroundingResult[] = [
    { ref: 1, doc_id: "doc-0", status: "ZWERYFIKOWANY", decision: "verified", worstRatio: 0, offset: 12 },
    { ref: 2, doc_id: "doc-0", status: "ZMODYFIKOWANY", decision: "unverified", worstRatio: 0.05, offset: 40 },
    { ref: 3, doc_id: "doc-1", status: "NIEZWERYFIKOWANY", decision: "blocked", worstRatio: 0.8, offset: -1 },
];

const auditExcerpt: AuditPackEvent[] = [
    {
        id: 101,
        event_type: "chat.message.assistant",
        ts: CREATED_AT,
        actor_user_id: "u1",
        chat_id: "chat-abc",
        document_id: null,
        hash: "h2",
        prev_hash: "h1",
        payload_masked: { model: "claude", grounding: { total: 3 } },
    },
];

function build() {
    return buildAuditBundle({
        chatId: "chat-abcdef12",
        deliverableMd: "# Opinia\n\nSad orzekl [1], a takze [2]. Klient twierdzi [3].",
        citations,
        auditLogExcerpt: auditExcerpt,
        modelVersions: { model: "claude-opus-4-8", patron: "0.x", connectors: { "mcp-saos": "0.3.1" } },
        costLog: { available: false, full_text_len: 52, event_count: 1, note: "brak token trackingu" },
        createdAt: CREATED_AT,
    });
}

describe("buildAuditBundle", () => {
    it("sklada bundle z poprawna struktura i podsumowaniem cytatow", () => {
        const b = build();
        expect(b.schema_version).toBe(AUDIT_BUNDLE_SCHEMA_VERSION);
        expect(b.bundle_kind).toBe(AUDIT_BUNDLE_KIND);
        expect(b.deliverable.chars).toBe(b.deliverable.content_md.length);
        expect(b.deliverable.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(b.citation_verification.summary).toEqual({
            total: 3,
            verified: 1,
            unverified: 1,
            blocked: 1,
        });
        expect(b.manifest.parts.map((p) => p.name)).toEqual([
            "deliverable",
            "citation_verification",
            "audit_log_excerpt",
            "model_versions",
            "cost_log",
        ]);
        expect(b.integrity.canonical_sha256).toMatch(/^[0-9a-f]{64}$/);
    });

    it("jest deterministyczny - te same wejscia daja ten sam hash", () => {
        expect(build().integrity.canonical_sha256).toBe(
            build().integrity.canonical_sha256,
        );
    });
});

describe("verifyAuditBundleIntegrity", () => {
    it("swiezy bundle przechodzi weryfikacje", () => {
        const res = verifyAuditBundleIntegrity(build());
        expect(res.ok).toBe(true);
        expect(res.tamperedParts).toEqual([]);
    });

    it("wykrywa modyfikacje tresci deliverable (part + integrity)", () => {
        const b = build();
        b.deliverable.content_md = "ZMIENIONA TRESC po wygenerowaniu";
        const res = verifyAuditBundleIntegrity(b);
        expect(res.ok).toBe(false);
        expect(res.tamperedParts).toContain("deliverable");
    });

    it("wykrywa podmiane werdyktu cytatu (blocked -> verified)", () => {
        const b = build();
        b.citation_verification.items[2].decision = "verified";
        const res = verifyAuditBundleIntegrity(b);
        expect(res.ok).toBe(false);
        expect(res.tamperedParts).toContain("citation_verification");
    });

    it("wykrywa modyfikacje eventu audit w excerpt", () => {
        const b = build();
        b.audit_log_excerpt[0].hash = "podmieniony";
        const res = verifyAuditBundleIntegrity(b);
        expect(res.ok).toBe(false);
        expect(res.tamperedParts).toContain("audit_log_excerpt");
    });

    it("odrzuca nieobslugiwana schema_version", () => {
        const b = build();
        (b as { schema_version: string }).schema_version = "9.9";
        const res = verifyAuditBundleIntegrity(b);
        expect(res.ok).toBe(false);
        expect(res.error).toContain("schema_version");
    });
});

describe("buildAuditBundleFilename", () => {
    it("uzywa skroconego chatId + daty UTC", () => {
        expect(buildAuditBundleFilename("chat-abcdef12", CREATED_AT)).toBe(
            "audit-bundle-chat-abc-20260529.json",
        );
    });
    it("fallback nochat gdy brak chatId", () => {
        expect(buildAuditBundleFilename(null, CREATED_AT)).toBe(
            "audit-bundle-nochat-20260529.json",
        );
    });
});
