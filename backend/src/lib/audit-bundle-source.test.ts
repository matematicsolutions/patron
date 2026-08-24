// Testy zrodel danych audit bundle (ADR-0152).
//
// Najwazniejszy test to ten o -1: gdyby brakujacy pomiar odtwarzac jako 0,
// bundle twierdzilby, ze cytat dopasowal sie IDEALNIE. Falszywe twierdzenie
// o jakosci dowodu jest gorsze niz brak twierdzenia.

import { describe, it, expect } from "vitest";
import {
    citationsFromAnnotations,
    modelFromAuditRows,
    buildAuditBundleFilename,
    toPackEvent,
    NIE_PERSYSTOWANE,
} from "./audit-bundle-source";

describe("citationsFromAnnotations", () => {
    it("bierze tylko adnotacje citation_data z zapisanym werdyktem", () => {
        const out = citationsFromAnnotations([
            { type: "citation_data", ref: 2, doc_id: "d2", grounding: "verified", grounding_status: "verbatim" },
            { type: "citation_data", ref: 1, doc_id: "d1", grounding: "unverified", grounding_status: "paraphrase" },
            // bez werdyktu - cytat NIEZWERYFIKOWANY, nie wolno go liczyc w zadna strone
            { type: "citation_data", ref: 3, doc_id: "d3" },
            // inna adnotacja
            { type: "edit_data", ref: 9 },
        ]);
        expect(out.map((c) => c.ref)).toEqual([1, 2]);
        expect(out.map((c) => c.decision)).toEqual(["unverified", "verified"]);
    });

    it("brakujacy pomiar to -1, NIGDY 0 (0 = dopasowanie idealne)", () => {
        const [c] = citationsFromAnnotations([
            { type: "citation_data", ref: 1, doc_id: "d", grounding: "verified", grounding_status: "verbatim" },
        ]);
        expect(c.worstRatio).toBe(NIE_PERSYSTOWANE);
        expect(c.offset).toBe(NIE_PERSYSTOWANE);
        expect(c.worstRatio).not.toBe(0);
        expect(c.note).toContain("nie pomiar rowny zeru");
    });

    it("odrzuca werdykt spoza slownika decyzji", () => {
        expect(
            citationsFromAnnotations([
                { type: "citation_data", ref: 1, doc_id: "d", grounding: "wymyslony" },
            ]),
        ).toEqual([]);
    });

    it("wejscie nie-tablicowe daje pusta liste, nie wyjatek", () => {
        expect(citationsFromAnnotations(null)).toEqual([]);
        expect(citationsFromAnnotations("[]")).toEqual([]);
        expect(citationsFromAnnotations(undefined)).toEqual([]);
    });
});

describe("modelFromAuditRows", () => {
    const row = (ts: string, model?: string) => ({
        event_type: "llm_route",
        ts,
        payload: model ? { model } : {},
    });

    it("bierze model z NAJNOWSZEGO zdarzenia llm_route", () => {
        expect(
            modelFromAuditRows([
                row("2026-08-24T10:00:00.000Z", "stary-model"),
                row("2026-08-24T12:00:00.000Z", "nowy-model"),
                { event_type: "chat.message.user", ts: "2026-08-24T13:00:00.000Z", payload: { model: "nie-ten" } },
            ]),
        ).toBe("nowy-model");
    });

    it("pomija zdarzenia routingu bez modelu i schodzi do starszego", () => {
        expect(
            modelFromAuditRows([
                row("2026-08-24T10:00:00.000Z", "ma-model"),
                row("2026-08-24T12:00:00.000Z"),
            ]),
        ).toBe("ma-model");
    });

    it("brak zdarzenia routingu = null, nie zgadywanie", () => {
        expect(modelFromAuditRows([])).toBeNull();
        expect(
            modelFromAuditRows([{ event_type: "chat.message.user", ts: "2026-08-24T10:00:00.000Z", payload: {} }]),
        ).toBeNull();
    });
});

describe("buildAuditBundleFilename", () => {
    it("sklada nazwe z identyfikatorem i data UTC", () => {
        expect(buildAuditBundleFilename("msg-123", "2026-08-24T09:15:00.000Z")).toBe(
            "audit-bundle-msg-123-20260824.json",
        );
    });

    it("czysci znaki spoza bezpiecznego zbioru", () => {
        expect(buildAuditBundleFilename("../../etc/passwd", "2026-08-24T09:15:00.000Z")).toBe(
            "audit-bundle-etcpasswd-20260824.json",
        );
    });

    it("niepoprawna data - nazwa bez sufiksu, nie wyjatek", () => {
        expect(buildAuditBundleFilename("msg-1", "nie-data")).toBe("audit-bundle-msg-1.json");
    });
});

describe("toPackEvent", () => {
    it("przenosi ogniwa hash-chain i podstawia ZAMASKOWANY payload", () => {
        const ev = toPackEvent(
            {
                id: 7,
                event_type: "llm_route",
                ts: "2026-08-24T09:00:00.000Z",
                actor_user_id: "u1",
                chat_id: "c1",
                document_id: null,
                hash: "h7",
                prev_hash: "h6",
            },
            { pesel: "***" },
        );
        expect(ev.hash).toBe("h7");
        expect(ev.prev_hash).toBe("h6");
        expect(ev.payload_masked).toEqual({ pesel: "***" });
    });
});

describe("citationsFromAnnotations - zrodla MCP (ADR-0146)", () => {
    const mcp = (verdict: string, url = "https://saos/1") => ({
        type: "mcp_citation",
        server: "saos",
        tool: "search",
        url,
        grounding: { verdict },
    });

    it("wlacza cytaty MCP - bez nich pismo na orzecznictwie ma ZERO cytatow", () => {
        const out = citationsFromAnnotations([mcp("green"), mcp("red", "https://saos/2")]);
        expect(out).toHaveLength(2);
        expect(out.map((c) => c.decision).sort()).toEqual(["blocked", "verified"]);
    });

    it("mapuje green/yellow/red na verified/unverified/blocked", () => {
        const d = (v: string) => citationsFromAnnotations([mcp(v)])[0]?.decision;
        expect(d("green")).toBe("verified");
        expect(d("yellow")).toBe("unverified");
        // czerwony to MOCNIEJSZE twierdzenie niz "nie sprawdzono"
        expect(d("red")).toBe("blocked");
    });

    it("ref cytatu MCP jest UJEMNY - nie udaje przypisu [N] w prozie", () => {
        const out = citationsFromAnnotations([
            { type: "citation_data", ref: 1, doc_id: "d", grounding: "verified", grounding_status: "verbatim" },
            mcp("green"),
            mcp("yellow", "https://saos/3"),
        ]);
        const mcpRefs = out.filter((c) => c.note?.includes("MCP")).map((c) => c.ref);
        expect(mcpRefs.every((r) => r < 0)).toBe(true);
        expect(out.filter((c) => c.note?.includes("MCP"))).toHaveLength(2);
        // przypis z prozy zachowuje swoj dodatni numer
        expect(out.find((c) => c.doc_id === "d")?.ref).toBe(1);
    });

    it("doc_id skleja server|tool|url - lustro mcpCitationKey", () => {
        expect(citationsFromAnnotations([mcp("green")])[0].doc_id).toBe("saos|search|https://saos/1");
    });

    it("werdykt nierozpoznany albo brak - cytat MCP NIE wchodzi do podsumowania", () => {
        expect(citationsFromAnnotations([mcp("fioletowy")])).toEqual([]);
        expect(
            citationsFromAnnotations([{ type: "mcp_citation", server: "s", tool: "t", url: "u" }]),
        ).toEqual([]);
    });
});
