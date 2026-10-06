// A-03: Osoba rozpoznana i zamaskowana w jednej wiadomosci konwersacji wychodzi jawnie
// w kolejnej wiadomosci tej samej konwersacji. wrapConversation (lib/pseudonim/egress.ts:43-54)
// uzywa jednej mapy, ale wrapInto (lib/pseudonim/wrap.ts:56-58) maskuje tylko spany wykryte
// w BIEZACYM tekscie - znane juz oryginaly z mapy nie sa szukane w nastepnych wiadomosciach.
// Oczekiwane: oryginal obecny w mapie pseudonimow jest maskowany w calej konwersacji.
import { describe, it, expect } from "vitest";
import { wrapConversation, plEntityDetector } from "../src/lib/pseudonim";

describe("A-03 propagacja pseudonimu miedzy wiadomosciami", () => {
    it("nazwisko zamaskowane w 1. wiadomosci nie wychodzi jawnie w 2. wiadomosci", async () => {
        const w = await wrapConversation(
            "Jestes asystentem kancelarii.",
            [
                { role: "user", content: "Klientem jest Pan Jan Testowy." },
                { role: "assistant", content: "Rozumiem." },
                { role: "user", content: "Czy Jan Testowy moze zlozyc apelacje?" },
            ],
            { llmDetector: plEntityDetector },
        );
        // Sanity: w pierwszej wiadomosci osoba jest zamaskowana (kotwica "Pan").
        expect(w.messages[0]!.content).not.toContain("Jan Testowy");
        expect([...w.map.byToken.values()].some((e) => e.original === "Jan Testowy")).toBe(true);
        // ZADANE: ten sam oryginal nie wychodzi w kolejnej wiadomosci.
        expect(w.messages[2]!.content).not.toContain("Jan Testowy");
    });
});
