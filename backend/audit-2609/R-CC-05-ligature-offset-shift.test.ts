// R-CC-05 (ADR-0157 pkt 3 "podswietlenie nie zgaduje"): ekstraktor szuka sygnatur w
// `t.toUpperCase()` przy zalozeniu "wersaliki nie zmieniaja dlugosci" (cytaty_pl.ts,
// sekcja 1). Ligatury z ekstrakcji PDF (U+FB01 "ﬁ" -> "FI", U+FB02 "ﬂ" -> "FL") i "ß"
// wydluzaja tekst, wiec offset kazdej sygnatury za nimi jest przesuniety: podswietlenie
// i `excerpt` (raport) wskazuja inny fragment pisma.
import { describe, expect, it } from "vitest";
import { extractLocalCitations } from "../src/lib/citation-check";

describe("R-CC-05 ligatury PDF przesuwaja offset sygnatury", () => {
    it("excerpt sygnatury == sygnatura w tekscie", () => {
        const txt =
            "Zgodnie z deﬁnicją oraz ﬁrmą i ﬂotą, ﬁnalnie: wyrok SN z dnia 12 marca 2024 r., II CSKP 1/24, potwierdza to.";
        const [c] = extractLocalCitations(txt).citations;
        expect(c.signature).toBe("II CSKP 1/24"); // identyfikator jest dobry
        expect(c.excerpt).toBe("II CSKP 1/24");
        expect(c.offset).toBe(txt.indexOf("II CSKP 1/24"));
    });
});
