import { describe, expect, it } from "vitest";
import type { GroundingResult } from "./citation/grounding";
import type { AuditPackEvent } from "./audit-pack";
import {
    AUDIT_BUNDLE_KIND,
    AUDIT_BUNDLE_SCHEMA_VERSION,
    annotateExcerptLinks,
    buildAuditBundle,
    buildAuditBundleFilename,
    verifyAuditBundle,
    verifyAuditBundleIntegrity,
    verifyAuditExcerpt,
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

// --- audyt 2026-09, D-01: wyciag nieciagly ---------------------------------

describe("annotateExcerptLinks + verifyAuditExcerpt (D-01)", () => {
    const h = (c: string) => c.repeat(64);
    const wpis = (id: number, prev: string, hash: string): AuditPackEvent => ({
        id,
        event_type: "chat.message.user",
        ts: CREATED_AT,
        actor_user_id: "u1",
        chat_id: "chat-abc",
        document_id: null,
        hash,
        prev_hash: prev,
        payload_masked: {},
    });

    it("oznacza poprzednika w wyciagu i nie zmienia wejscia", () => {
        const wej = [wpis(10, h("1"), h("a")), wpis(11, h("a"), h("b")), wpis(15, h("9"), h("c"))];
        const wyj = annotateExcerptLinks(wej);
        expect(wyj.map((e) => e.parent_in_excerpt)).toEqual([false, true, false]);
        expect(wej[0].parent_in_excerpt).toBeUndefined();
    });

    it("luki nie sa naruszeniem: liczone jawnie", () => {
        const v = verifyAuditExcerpt(
            annotateExcerptLinks([wpis(10, h("1"), h("a")), wpis(11, h("a"), h("b")), wpis(15, h("9"), h("c"))]),
        );
        expect(v).toMatchObject({ ok: true, entries: 3, links: 1, gaps: 1, recomputed: 0, masked: 3 });
    });

    it("kolejne numery bez ogniwa = zerwanie, nawet bez deklaracji", () => {
        const v = verifyAuditExcerpt([wpis(10, h("1"), h("a")), wpis(11, h("7"), h("b"))]);
        expect(v.ok).toBe(false);
        expect(v.problems[0]).toContain("przerwane");
    });

    it("zadeklarowany poprzednik nieobecny w pliku = wpis usuniety", () => {
        const w = annotateExcerptLinks([wpis(10, h("1"), h("a")), wpis(12, h("a"), h("b"))]);
        expect(verifyAuditExcerpt(w).ok).toBe(true);
        const bez = [{ ...w[1] }];
        expect(verifyAuditExcerpt(bez).problems[0]).toContain("usunieto");
    });

    it("stary format (bez deklaracji): przeskok numerow to luka, nie werdykt", () => {
        const v = verifyAuditExcerpt([wpis(10, h("1"), h("a")), wpis(12, h("b"), h("c"))]);
        expect(v).toMatchObject({ ok: true, gaps: 1 });
    });

    it("numery malejace albo zdublowane = kolejnosc zmieniona", () => {
        expect(verifyAuditExcerpt([wpis(11, h("1"), h("a")), wpis(10, h("2"), h("b"))]).ok).toBe(false);
        expect(verifyAuditExcerpt([wpis(10, h("1"), h("a")), wpis(10, h("2"), h("b"))]).ok).toBe(false);
    });

    it("pusty wyciag jest poprawny, nie-lista nie jest", () => {
        expect(verifyAuditExcerpt([]).ok).toBe(true);
        expect(verifyAuditExcerpt({}).ok).toBe(false);
    });

    it("verifyAuditBundle laczy integrity i wyciag", () => {
        const b = buildAuditBundle({
            chatId: "chat-abc",
            deliverableMd: "x",
            citations: [],
            auditLogExcerpt: [wpis(10, h("1"), h("a")), wpis(11, h("7"), h("b"))],
            modelVersions: { model: null },
            costLog: { available: false },
            createdAt: CREATED_AT,
        });
        const v = verifyAuditBundle(b);
        expect(v.integrity.ok).toBe(true);
        expect(v.excerpt.ok).toBe(false);
        expect(v.ok).toBe(false);
    });
});
