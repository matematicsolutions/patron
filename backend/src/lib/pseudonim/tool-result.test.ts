// wrapToolResultInto (audyt 2026-09 A-01): maskowanie wyniku narzedzia do
// wspolnej mapy konwersacji. Dane syntetyczne (PESEL z poprawna suma kontrolna).

import { describe, expect, it } from "vitest";
import { createPseudonimMap } from "./map";
import { unwrap, wrapInto } from "./wrap";
import { plEntityDetector } from "./plDetector";
import { knownOriginalsDetector, wrapToolResultInto } from "./tool-result";

const PESEL = "90010112349";

describe("wrapToolResultInto", () => {
    it("tekst: PESEL, e-mail i osoba po kotwicy zamaskowane; unwrap odtwarza bajt w bajt", async () => {
        const map = createPseudonimMap();
        const src = `Powod: Pan Jan Testowy, PESEL ${PESEL}, e-mail jan.testowy@example.com.`;
        const out = await wrapToolResultInto(map, src);
        expect(out).not.toContain(PESEL);
        expect(out).not.toContain("jan.testowy@example.com");
        expect(out).not.toContain("Jan Testowy");
        expect(unwrap(out, map)).toBe(src);
    });

    it("ta sama mapa co konwersacja: identyfikator z wiadomosci ma ten sam token w wyniku narzedzia", async () => {
        const map = createPseudonimMap();
        const msg = await wrapInto(map, `Czy PESEL ${PESEL} jest w aktach?`, {
            llmDetector: plEntityDetector,
        });
        const tool = await wrapToolResultInto(map, `Strona: PESEL ${PESEL}.`);
        const token = msg.match(/\[PESEL_\d+\]/)![0];
        expect(tool).toContain(token);
        expect(map.tokens.filter((t) => t.category === "PESEL")).toHaveLength(1);
    });

    it("znany oryginal jest maskowany takze bez kotwicy (fragment RAG / snippet)", async () => {
        const map = createPseudonimMap();
        await wrapToolResultInto(map, "Powodem jest Pan Jan Testowy.");
        const out = await wrapToolResultInto(map, "Jan Testowy wnosi o zaplate.");
        expect(out).not.toContain("Jan Testowy");
        expect(out).toMatch(/^\[PERSON_1\] wnosi/);
    });

    it("znany oryginal: tylko jako samodzielne slowo (granice Unicode)", async () => {
        const map = createPseudonimMap();
        await wrapToolResultInto(map, "Pani Anna podpisala.");
        const det = knownOriginalsDetector(map, { detect: async () => [] });
        expect(await det.detect("Annapolis i Hannah")).toEqual([]);
        expect(await det.detect("Anna, Joanna")).toEqual([{ span: "Anna", category: "PERSON" }]);
    });

    it("JSON: wynik pozostaje poprawnym JSON-em, liczby i klucze nietkniete, liscie zamaskowane", async () => {
        const map = createPseudonimMap();
        const src =
            `{"ok":true,"total_matches":1,"big":12345678901234567890,` +
            `"hits":[{"excerpt":"PESEL ${PESEL}","context":"Pan Jan Testowy, \\"cudzyslow\\"\\nnowa linia"}]}`;
        const out = await wrapToolResultInto(map, src);
        expect(() => JSON.parse(out)).not.toThrow();
        expect(out).not.toContain(PESEL);
        expect(out).not.toContain("Jan Testowy");
        // Liczba poza zakresem double przechodzi bajt w bajt (brak parse/stringify calosci).
        expect(out).toContain('"big":12345678901234567890');
        const parsed = JSON.parse(unwrap(out, map)) as { hits: { context: string }[] };
        expect(parsed.hits[0]!.context).toBe('Pan Jan Testowy, "cudzyslow"\nnowa linia');
    });

    it("tekst wygladajacy jak JSON, ale niepoprawny, jest maskowany jako zwykly tekst", async () => {
        const map = createPseudonimMap();
        const out = await wrapToolResultInto(map, `[Citation requirement] PESEL ${PESEL}`);
        expect(out).not.toContain(PESEL);
        expect(out.startsWith("[Citation requirement] PESEL [PESEL_")).toBe(true);
    });

    it("pusty wynik bez zmian", async () => {
        const map = createPseudonimMap();
        expect(await wrapToolResultInto(map, "")).toBe("");
        expect(map.tokens).toHaveLength(0);
    });
});
