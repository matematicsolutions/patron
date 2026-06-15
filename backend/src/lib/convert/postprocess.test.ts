import { describe, it, expect } from "vitest";
import {
    flagSuspectDates,
    assessOcrQuality,
    postProcessOcr,
} from "./postprocess";

describe("flagSuspectDates", () => {
    const NOW = 2026;

    it("flaguje rok poza zakresem (OCR 'rok 3013')", () => {
        const flags = flagSuspectDates("Postanowienie z dnia 12.03.3013 r.", NOW);
        expect(flags).toHaveLength(1);
        expect(flags[0].kind).toBe("suspect-date");
        expect(flags[0].detail).toBe("12.03.3013");
    });

    it("przepuszcza daty wiarygodne (DD.MM.YYYY i ISO)", () => {
        expect(flagSuspectDates("Wyrok z 05.11.2024 r.", NOW)).toHaveLength(0);
        expect(flagSuspectDates("data 2023-07-01", NOW)).toHaveLength(0);
    });

    it("dopuszcza rok przyszly +1 (terminy), flaguje dalej", () => {
        expect(flagSuspectDates("termin 01.02.2027", NOW)).toHaveLength(0); // +1 OK
        expect(flagSuspectDates("01.02.2099", NOW)).toHaveLength(1);
    });

    it("flaguje rok zbyt wczesny (OCR zgubil cyfre)", () => {
        const flags = flagSuspectDates("1899-01-01", NOW);
        expect(flags).toHaveLength(1);
    });

    it("deduplikuje powtorzona podejrzana date", () => {
        const flags = flagSuspectDates("3013 i znowu 12.03.3013 oraz 12.03.3013", NOW);
        expect(flags).toHaveLength(1);
    });
});

describe("assessOcrQuality", () => {
    it("dobry tekst prawniczy -> wysoki score, nie low-quality", () => {
        const q = assessOcrQuality(
            "Sad Okregowy w Warszawie po rozpoznaniu sprawy z powodztwa o zaplate orzeka co nastepuje",
        );
        expect(q.lowQuality).toBe(false);
        expect(q.score).toBeGreaterThan(0.7);
    });

    it("krzaki/smieci OCR -> low-quality", () => {
        const q = assessOcrQuality("@#$%^&*()_+~~|||\\///<><><>{}[]@#$%^&*()_+~~|||");
        expect(q.lowQuality).toBe(true);
    });

    it("za malo tekstu -> low-quality", () => {
        expect(assessOcrQuality("abc").lowQuality).toBe(true);
    });
});

describe("postProcessOcr", () => {
    it("tekst niezmieniony (NIE poprawiamy tresci, tylko flagujemy)", () => {
        const md = "Wyrok z 12.03.3013 r. tresc pisma...";
        const r = postProcessOcr(md, 2026);
        expect(r.markdown).toBe(md);
        expect(r.flags.some((f) => f.kind === "suspect-date")).toBe(true);
    });

    it("czysty dobry skan -> zero flag", () => {
        const r = postProcessOcr(
            "Sad Rejonowy w Krakowie postanowieniem z dnia 05.11.2024 r. ustalil co nastepuje w sprawie",
            2026,
        );
        expect(r.flags).toHaveLength(0);
    });
});
