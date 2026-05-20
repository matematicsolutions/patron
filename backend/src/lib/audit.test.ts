import { describe, expect, it } from "vitest";
import crypto from "crypto";
import {
    GENESIS_HASH,
    canonicalJsonStringify,
    computeAuditHash,
} from "./audit";

describe("GENESIS_HASH", () => {
    it("64 zera (lower-case hex)", () => {
        expect(GENESIS_HASH).toBe("0".repeat(64));
        expect(GENESIS_HASH).toMatch(/^[0-9a-f]{64}$/);
    });
});

describe("canonicalJsonStringify", () => {
    it("scalary serializuje jak JSON.stringify", () => {
        expect(canonicalJsonStringify(null)).toBe("null");
        expect(canonicalJsonStringify(42)).toBe("42");
        expect(canonicalJsonStringify("ab")).toBe('"ab"');
        expect(canonicalJsonStringify(true)).toBe("true");
    });

    it("sortuje klucze obiektu alfabetycznie", () => {
        const a = canonicalJsonStringify({ b: 1, a: 2 });
        const b = canonicalJsonStringify({ a: 2, b: 1 });
        expect(a).toBe('{"a":2,"b":1}');
        expect(a).toBe(b);
    });

    it("sortuje rekurencyjnie zagniezdzone obiekty", () => {
        const out = canonicalJsonStringify({
            z: { y: 1, x: 2 },
            a: { c: 3, b: 4 },
        });
        expect(out).toBe('{"a":{"b":4,"c":3},"z":{"x":2,"y":1}}');
    });

    it("zachowuje kolejnosc elementow tablicy", () => {
        const out = canonicalJsonStringify([3, 1, 2]);
        expect(out).toBe("[3,1,2]");
    });

    it("daje deterministyczny string niezaleznie od kolejnosci kluczy w argumencie", () => {
        const x = canonicalJsonStringify({
            payload: { b: 1, a: { d: 4, c: 3 } },
            ts: "2026-05-20T00:00:00.000Z",
        });
        const y = canonicalJsonStringify({
            ts: "2026-05-20T00:00:00.000Z",
            payload: { a: { c: 3, d: 4 }, b: 1 },
        });
        expect(x).toBe(y);
    });
});

describe("computeAuditHash", () => {
    const baseEvent = {
        prev_hash: GENESIS_HASH,
        ts: "2026-05-20T10:00:00.000Z",
        event_type: "chat.message.user",
        actor_user_id: "user-1",
        chat_id: "chat-1",
        document_id: null,
        payload: { content_len: 42 },
    };

    it("zwraca 64-znakowy hex lower-case", () => {
        const h = computeAuditHash(baseEvent);
        expect(h).toMatch(/^[0-9a-f]{64}$/);
    });

    it("dwukrotne wywolanie z tym samym inputem -> ten sam hash", () => {
        expect(computeAuditHash(baseEvent)).toBe(computeAuditHash(baseEvent));
    });

    it("zmiana prev_hash zmienia hash (linkowanie lancucha)", () => {
        const h1 = computeAuditHash(baseEvent);
        const h2 = computeAuditHash({
            ...baseEvent,
            prev_hash: "f".repeat(64),
        });
        expect(h1).not.toBe(h2);
    });

    it("zmiana payload zmienia hash (integralnosc tresci)", () => {
        const h1 = computeAuditHash(baseEvent);
        const h2 = computeAuditHash({
            ...baseEvent,
            payload: { content_len: 43 },
        });
        expect(h1).not.toBe(h2);
    });

    it("zmiana event_type zmienia hash", () => {
        const h1 = computeAuditHash(baseEvent);
        const h2 = computeAuditHash({
            ...baseEvent,
            event_type: "chat.message.assistant",
        });
        expect(h1).not.toBe(h2);
    });

    it("hash jest deterministyczny wzgledem kolejnosci pol payloadu", () => {
        const h1 = computeAuditHash({
            ...baseEvent,
            payload: { z: 1, a: 2 },
        });
        const h2 = computeAuditHash({
            ...baseEvent,
            payload: { a: 2, z: 1 },
        });
        expect(h1).toBe(h2);
    });

    it("hash = sha256(prev_hash + canonical_json(...))", () => {
        const canon = canonicalJsonStringify({
            ts: baseEvent.ts,
            event_type: baseEvent.event_type,
            actor_user_id: baseEvent.actor_user_id,
            chat_id: baseEvent.chat_id,
            document_id: baseEvent.document_id,
            payload: baseEvent.payload,
        });
        const expected = crypto
            .createHash("sha256")
            .update(baseEvent.prev_hash + canon, "utf8")
            .digest("hex");
        expect(computeAuditHash(baseEvent)).toBe(expected);
    });
});

describe("hash-chain integralnosci - scenariusze ataku", () => {
    function buildChain(
        events: Array<{
            event_type: string;
            ts: string;
            payload: Record<string, unknown>;
        }>,
    ) {
        let prev = GENESIS_HASH;
        const chain: Array<{ prev_hash: string; hash: string } & typeof events[0]> = [];
        for (const ev of events) {
            const hash = computeAuditHash({
                prev_hash: prev,
                ts: ev.ts,
                event_type: ev.event_type,
                payload: ev.payload,
            });
            chain.push({ ...ev, prev_hash: prev, hash });
            prev = hash;
        }
        return chain;
    }

    function verifyChain(
        chain: Array<{
            prev_hash: string;
            hash: string;
            ts: string;
            event_type: string;
            payload: Record<string, unknown>;
        }>,
    ): { ok: boolean; brokenAt?: number } {
        let prev = GENESIS_HASH;
        for (let i = 0; i < chain.length; i++) {
            const row = chain[i];
            if (row.prev_hash !== prev) {
                return { ok: false, brokenAt: i };
            }
            const recomputed = computeAuditHash({
                prev_hash: row.prev_hash,
                ts: row.ts,
                event_type: row.event_type,
                payload: row.payload,
            });
            if (recomputed !== row.hash) {
                return { ok: false, brokenAt: i };
            }
            prev = row.hash;
        }
        return { ok: true };
    }

    const sampleEvents = [
        { event_type: "chat.created", ts: "2026-05-20T10:00:00Z", payload: { id: "a" } },
        { event_type: "chat.message.user", ts: "2026-05-20T10:01:00Z", payload: { len: 30 } },
        { event_type: "tool.call", ts: "2026-05-20T10:01:05Z", payload: { tool: "saos__search" } },
        { event_type: "chat.message.assistant", ts: "2026-05-20T10:01:30Z", payload: { len: 800 } },
    ];

    it("nietkniety lancuch weryfikuje sie OK", () => {
        const chain = buildChain(sampleEvents);
        expect(verifyChain(chain)).toEqual({ ok: true });
    });

    it("modyfikacja srodkowego payloadu - lancuch zerwany na tym wpisie", () => {
        const chain = buildChain(sampleEvents);
        // Atak: zmiana payloadu w rekordzie 2 BEZ przeliczenia hasha
        chain[2] = {
            ...chain[2],
            payload: { tool: "evil_tool" },
        };
        const result = verifyChain(chain);
        expect(result.ok).toBe(false);
        expect(result.brokenAt).toBe(2);
    });

    it("usuniecie srodkowego wpisu - lancuch zerwany na nastepnym", () => {
        const chain = buildChain(sampleEvents);
        chain.splice(2, 1);
        const result = verifyChain(chain);
        expect(result.ok).toBe(false);
        // Po usunieciu wpisu indeks 2 (dawne 3) ma prev_hash z dawnego 1, ktory
        // juz nie pasuje do hash wpisu na pozycji 1.
        expect(result.brokenAt).toBe(2);
    });

    it("modyfikacja hash bez przeliczenia - lancuch zerwany na nastepnym", () => {
        const chain = buildChain(sampleEvents);
        // Atak: zmiana wlasciwego hasha rekordu 1 (bez zmiany payloadu)
        chain[1] = { ...chain[1], hash: "f".repeat(64) };
        const result = verifyChain(chain);
        expect(result.ok).toBe(false);
        // verifyChain najpierw sprawdza recomputed === hash na pozycji 1,
        // i tam wykrywa zerwanie.
        expect(result.brokenAt).toBe(1);
    });

    it("podmiana kolejnosci wpisow - lancuch zerwany", () => {
        const chain = buildChain(sampleEvents);
        // Atak: zamiana wpisow 1 i 2 miejscami
        [chain[1], chain[2]] = [chain[2], chain[1]];
        const result = verifyChain(chain);
        expect(result.ok).toBe(false);
    });
});
