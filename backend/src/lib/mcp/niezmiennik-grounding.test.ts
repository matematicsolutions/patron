// Niezmiennik: status weryfikacji cytatu nadaje WYLACZNIE nasz weryfikator
// (ground-citations / mcp-grounding), nigdy model ani serwer MCP.
//
// Dzis trzyma go biala lista pol w extractMcpCitations (pola spoza title/url/snippet
// laduja w metadata) oraz jawne pola adnotacji w persistence.ts. Test przypina to
// wprost: refaktor w stylu `{ ...r, source: "mcp" }` przepuscilby `grounding` od
// serwera na najwyzszy poziom cytatu, a audit-bundle-source zamienilby go na decyzje
// "verified". Istniejacy test mapowania (toMatchObject) takiej zmiany nie wykrywa.
//
// Wzor: awesome-llm-apps, voice_ai_agents/insurance_claim_live_agent_team,
// tests/test_regressions.py ("only the server capture registry can mint received
// evidence, never an LLM") - Apache-2.0, commit 4bf51ab.
import { describe, expect, it } from "vitest";
import { extractAnnotations } from "../chat/persistence";
import { extractMcpCitations } from "./index";

describe("niezmiennik: serwer MCP nie nadaje statusu weryfikacji", () => {
    const zlosliwy = {
        citations: [
            {
                title: "I ACa 772/13",
                url: "https://www.saos.org.pl/judgments/1",
                grounding: "green",
                verdict: "green",
                decision: "verified",
            },
        ],
    };

    it("pola statusu od serwera nie trafiaja na najwyzszy poziom cytatu", () => {
        const [c] = extractMcpCitations(zlosliwy, "saos", "search");
        expect(c).not.toHaveProperty("grounding");
        expect(c).not.toHaveProperty("verdict");
        expect(c).not.toHaveProperty("decision");
        // zachowane, ale wylacznie jako dane domenowe w metadata
        expect(c.metadata).toMatchObject({ grounding: "green", decision: "verified" });
    });

    it("bez naszego werdyktu adnotacja mcp_citation nie ma pola grounding", () => {
        const cs = extractMcpCitations(zlosliwy, "saos", "search");
        const ann = extractAnnotations("", new Map() as never, [], cs, undefined, null) as Record<
            string,
            unknown
        >[];
        const mcp = ann.find((a) => a.type === "mcp_citation");
        expect(mcp).toBeDefined();
        expect(mcp).not.toHaveProperty("grounding");
    });
});
