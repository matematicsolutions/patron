// Testy pure helperow audit pack (ADR-0047).

import { describe, expect, it } from "vitest";

import {
    AUDIT_PACK_KIND,
    AUDIT_PACK_SCHEMA_VERSION,
    buildAuditPack,
    buildAuditPackFilename,
    canonicalJsonStringify,
    canonicalSha256,
    verifyAuditPackIntegrity,
    type AuditPack,
    type AuditPackEvent,
    type AuditPackExporter,
} from "./audit-pack";
import type { ProofBundle } from "./audit-merkle-roots";

const FIXED_EXPORTED_AT = "2026-05-27T18:00:00.000Z";

const FIX_EVENT: AuditPackEvent = {
    id: 12345,
    event_type: "chat.message.user",
    ts: "2026-05-27T17:45:00.000Z",
    actor_user_id: "11111111-2222-3333-4444-555555555555",
    chat_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    document_id: null,
    hash: "a".repeat(64),
    prev_hash: "b".repeat(64),
    payload_masked: { question: "1234***8901", answer_excerpt: "Zgodnie z [...] adwokata" },
};

const FIX_BUNDLE: ProofBundle = {
    event_id: 12345,
    event_hash: "a".repeat(64),
    proof: [
        { hash: "c".repeat(64), position: "left" },
        { hash: "d".repeat(64), position: "right" },
    ],
    merkle_root_id: 7,
    merkle_root: "f".repeat(64),
    chain_block_start: 12001,
    chain_block_end: 13000,
};

const FIX_EXPORTER: AuditPackExporter = {
    user_id: "99999999-8888-7777-6666-555555555555",
    email: "audytor@kancelaria.pl",
};

describe("canonicalJsonStringify", () => {
    it("sortuje klucze obiektu alfabetycznie", () => {
        const out = canonicalJsonStringify({ b: 2, a: 1, c: 3 });
        expect(out).toBe('{"a":1,"b":2,"c":3}');
    });

    it("rekurencyjnie sortuje zagniezdzone obiekty", () => {
        const out = canonicalJsonStringify({ outer: { z: 1, a: 2 } });
        expect(out).toBe('{"outer":{"a":2,"z":1}}');
    });

    it("zachowuje kolejnosc tablic (order semantyczny)", () => {
        const out = canonicalJsonStringify([3, 1, 2]);
        expect(out).toBe("[3,1,2]");
    });

    it("dwa rozne wstawienia kluczy daja identyczny output", () => {
        const a = { foo: 1, bar: 2 };
        const b = { bar: 2, foo: 1 };
        expect(canonicalJsonStringify(a)).toBe(canonicalJsonStringify(b));
    });

    it("null i undefined zwracane jako null", () => {
        expect(canonicalJsonStringify(null)).toBe("null");
        expect(canonicalJsonStringify(undefined)).toBe(undefined);
    });

    it("string escape standardowy", () => {
        expect(canonicalJsonStringify('he"y')).toBe('"he\\"y"');
    });
});

describe("canonicalSha256", () => {
    it("zwraca 64-znakowy hex lowercase", () => {
        const hash = canonicalSha256({ x: 1 });
        expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("deterministyczne - 2x ten sam obiekt = ten sam hash", () => {
        const a = canonicalSha256(FIX_EVENT);
        const b = canonicalSha256(FIX_EVENT);
        expect(a).toBe(b);
    });

    it("kolejnosc kluczy nie wplywa na hash", () => {
        const a = canonicalSha256({ foo: 1, bar: 2 });
        const b = canonicalSha256({ bar: 2, foo: 1 });
        expect(a).toBe(b);
    });

    it("zmiana wartosci zmienia hash", () => {
        const a = canonicalSha256({ x: 1 });
        const b = canonicalSha256({ x: 2 });
        expect(a).not.toBe(b);
    });
});

describe("buildAuditPack", () => {
    it("buduje pack z wszystkimi wymaganymi polami", () => {
        const pack = buildAuditPack({
            exporter: FIX_EXPORTER,
            event: FIX_EVENT,
            bundle: FIX_BUNDLE,
            exportedAt: FIXED_EXPORTED_AT,
        });

        expect(pack.schema_version).toBe(AUDIT_PACK_SCHEMA_VERSION);
        expect(pack.pack_kind).toBe(AUDIT_PACK_KIND);
        expect(pack.exported_at).toBe(FIXED_EXPORTED_AT);
        expect(pack.exporter).toEqual(FIX_EXPORTER);
        expect(pack.event).toEqual(FIX_EVENT);
        expect(pack.merkle_proof_bundle).toEqual(FIX_BUNDLE);
        expect(pack.verifier_instructions).toBeDefined();
        expect(pack.verifier_instructions.offline_cli).toContain("verify-audit-pack.ts");
        expect(pack.integrity.algorithm).toBe("SHA-256");
        expect(pack.integrity.canonical_sha256).toMatch(/^[0-9a-f]{64}$/);
    });

    it("dwa wywolania z tymi samymi argumentami zwracaja identyczny pack", () => {
        const a = buildAuditPack({
            exporter: FIX_EXPORTER,
            event: FIX_EVENT,
            bundle: FIX_BUNDLE,
            exportedAt: FIXED_EXPORTED_AT,
        });
        const b = buildAuditPack({
            exporter: FIX_EXPORTER,
            event: FIX_EVENT,
            bundle: FIX_BUNDLE,
            exportedAt: FIXED_EXPORTED_AT,
        });
        expect(a.integrity.canonical_sha256).toBe(b.integrity.canonical_sha256);
        expect(a).toEqual(b);
    });

    it("rozny exportedAt = rozny hash integrity", () => {
        const a = buildAuditPack({
            exporter: FIX_EXPORTER,
            event: FIX_EVENT,
            bundle: FIX_BUNDLE,
            exportedAt: "2026-05-27T18:00:00.000Z",
        });
        const b = buildAuditPack({
            exporter: FIX_EXPORTER,
            event: FIX_EVENT,
            bundle: FIX_BUNDLE,
            exportedAt: "2026-05-27T19:00:00.000Z",
        });
        expect(a.integrity.canonical_sha256).not.toBe(b.integrity.canonical_sha256);
    });
});

describe("verifyAuditPackIntegrity", () => {
    it("ok dla nietkniietego pack-u", () => {
        const pack = buildAuditPack({
            exporter: FIX_EXPORTER,
            event: FIX_EVENT,
            bundle: FIX_BUNDLE,
            exportedAt: FIXED_EXPORTED_AT,
        });
        const result = verifyAuditPackIntegrity(pack);
        expect(result.ok).toBe(true);
        expect(result.expected).toBe(result.actual);
    });

    it("wykrywa modyfikacje event.payload_masked", () => {
        const pack = buildAuditPack({
            exporter: FIX_EXPORTER,
            event: FIX_EVENT,
            bundle: FIX_BUNDLE,
            exportedAt: FIXED_EXPORTED_AT,
        });
        const tampered: AuditPack = {
            ...pack,
            event: { ...pack.event, payload_masked: { question: "PODMIANA" } },
        };
        const result = verifyAuditPackIntegrity(tampered);
        expect(result.ok).toBe(false);
        expect(result.error).toContain("mismatch");
    });

    it("wykrywa modyfikacje hash event-u", () => {
        const pack = buildAuditPack({
            exporter: FIX_EXPORTER,
            event: FIX_EVENT,
            bundle: FIX_BUNDLE,
            exportedAt: FIXED_EXPORTED_AT,
        });
        const tampered: AuditPack = {
            ...pack,
            event: { ...pack.event, hash: "0".repeat(64) },
        };
        const result = verifyAuditPackIntegrity(tampered);
        expect(result.ok).toBe(false);
    });

    it("wykrywa modyfikacje merkle_proof_bundle", () => {
        const pack = buildAuditPack({
            exporter: FIX_EXPORTER,
            event: FIX_EVENT,
            bundle: FIX_BUNDLE,
            exportedAt: FIXED_EXPORTED_AT,
        });
        const tampered: AuditPack = {
            ...pack,
            merkle_proof_bundle: { ...pack.merkle_proof_bundle, merkle_root: "0".repeat(64) },
        };
        const result = verifyAuditPackIntegrity(tampered);
        expect(result.ok).toBe(false);
    });

    it("blad gdy brak integrity", () => {
        const broken = { schema_version: AUDIT_PACK_SCHEMA_VERSION } as unknown as AuditPack;
        const result = verifyAuditPackIntegrity(broken);
        expect(result.ok).toBe(false);
        expect(result.error).toContain("integrity");
    });

    it("blad gdy nieznany algorytm", () => {
        const pack = buildAuditPack({
            exporter: FIX_EXPORTER,
            event: FIX_EVENT,
            bundle: FIX_BUNDLE,
            exportedAt: FIXED_EXPORTED_AT,
        });
        const tampered: AuditPack = {
            ...pack,
            integrity: { ...pack.integrity, algorithm: "MD5" as "SHA-256" },
        };
        const result = verifyAuditPackIntegrity(tampered);
        expect(result.ok).toBe(false);
        expect(result.error).toContain("algorytm");
    });

    it("blad gdy schema_version nieobslugiwana", () => {
        const pack = buildAuditPack({
            exporter: FIX_EXPORTER,
            event: FIX_EVENT,
            bundle: FIX_BUNDLE,
            exportedAt: FIXED_EXPORTED_AT,
        });
        const tampered = {
            ...pack,
            schema_version: "2.0",
        } as unknown as AuditPack;
        const result = verifyAuditPackIntegrity(tampered);
        expect(result.ok).toBe(false);
        expect(result.error).toContain("schema_version");
    });

    it("blad gdy pack nie jest obiektem", () => {
        const result = verifyAuditPackIntegrity(null as unknown as AuditPack);
        expect(result.ok).toBe(false);
    });
});

describe("buildAuditPackFilename", () => {
    it("standardowy format z data UTC", () => {
        const name = buildAuditPackFilename(12345, "2026-05-27T18:00:00.000Z");
        expect(name).toBe("audit-pack-event-12345-20260527.json");
    });

    it("zero-pad dla miesiaca i dnia jednocyfrowych", () => {
        const name = buildAuditPackFilename(7, "2026-01-05T00:00:00.000Z");
        expect(name).toBe("audit-pack-event-7-20260105.json");
    });

    it("fallback bez daty gdy exportedAt nieprawidlowy", () => {
        const name = buildAuditPackFilename(99, "nie-data");
        expect(name).toBe("audit-pack-event-99.json");
    });
});
