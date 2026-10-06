// D-08: Pakiet dowodowy (ADR-0152) pomija werdykty cytatow MCP na poziomie CYTATU.
// lib/audit-bundle-source.ts:47-95 (citationsFromAnnotations) czyta wylacznie adnotacje
// `citation_data` i karty `mcp_citation`, a ignoruje adnotacje `mcp_grounding`
// (quotes[] z werdyktami green/yellow/red), ktora persystuje
// lib/chat/persistence.ts:98-104. Gdy konektor nie zwraca kart (structuredContent bez
// citations - wtedy summary.cards = 0), a model podal "doslowny" cytat, ktorego NIE ma
// w zrodle (werdykt red), pakiet pokazuje citation_verification.total = 0, blocked = 0.
// Dowod "milczy" o sfabrykowanym cytacie z orzeczenia - dokladnie to, przed czym
// ostrzega komentarz w audit-bundle-source.ts:66-69.
// Oczekiwane: werdykt red cytatu MCP trafia do pakietu jako blocked.
import { describe, it, expect } from "vitest";
import { groundMcpCitations } from "../src/lib/citation/mcp-grounding";
import { extractAnnotations } from "../src/lib/chat/persistence";
import { citationsFromAnnotations } from "../src/lib/audit-bundle-source";

describe("D-08 pakiet dowodowy vs werdykty cytatow MCP", () => {
    it("sfabrykowany cytat MCP (red) jest widoczny w pakiecie jako blocked", () => {
        const answer =
            "Sad Najwyzszy wskazal:\n\n> Roszczenie o zachowek nie przedawnia sie nigdy, niezaleznie od daty ogloszenia testamentu.\n\nZatem roszczenie jest aktualne.";
        const report = groundMcpCitations({
            answerText: answer,
            sources: [
                {
                    server: "saos",
                    tool: "search_judgments",
                    text: "Wyrok SN III CZP 1/20: roszczenie o zachowek przedawnia sie z uplywem pieciu lat od ogloszenia testamentu.",
                    citationKeys: [],
                },
            ],
            citations: [],
            excludeTexts: [],
        });
        // sanity: grounding (ADR-0146) dziala i wykrywa cytat spoza zrodla
        expect(report.summary.red).toBe(1);
        const annotations = extractAnnotations(answer, {}, [], [], {}, report);
        const items = citationsFromAnnotations(annotations);
        expect(items.filter((i) => i.decision === "blocked").length, JSON.stringify(annotations)).toBe(1);
    });
});
