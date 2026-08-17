import { describe, it, expect } from "vitest";
import {
    deriveProvenance,
    detectPinpoint,
    provenanceLabel,
    type SourceKind,
} from "./provenance";

describe("deriveProvenance - tag z rodzaju zrodla (deterministyczny)", () => {
    const cases: Array<[SourceKind, string]> = [
        ["saos", "saos"],
        ["isap", "isap"],
        ["eurlex", "eurlex"],
        ["client-doc", "uzytkownik"],
        ["none", "model"],
    ];
    for (const [kind, tag] of cases) {
        it(`${kind} -> ${tag}`, () => {
            expect(deriveProvenance(kind).tag).toBe(tag);
        });
    }

    it("DEFAULT: brak zrodla (none) -> model, niezaleznie od tekstu", () => {
        expect(deriveProvenance("none", "art. 415 KC").tag).toBe("model");
    });
});

describe("detectPinpoint - numer jednostki redakcyjnej (regex, bez LLM)", () => {
    it("wykrywa art./ust./par./pkt/CELEX", () => {
        expect(detectPinpoint("zgodnie z art. 415 KC")).toBe(true);
        expect(detectPinpoint("art.415")).toBe(true);
        expect(detectPinpoint("ust. 2")).toBe(true);
        expect(detectPinpoint("§ 3 rozporzadzenia")).toBe(true);
        expect(detectPinpoint("pkt 4 umowy")).toBe(true);
        expect(detectPinpoint("CELEX:32016R0679")).toBe(true);
    });

    it("nie wykrywa zwyklej prozy bez numeru jednostki", () => {
        expect(detectPinpoint("sad oddalil powodztwo w calosci")).toBe(false);
        expect(detectPinpoint("artykul prasowy o sprawie")).toBe(false); // 'artykul' bez kropki+cyfry
        expect(detectPinpoint("")).toBe(false);
        expect(detectPinpoint(null)).toBe(false);
        expect(detectPinpoint(undefined)).toBe(false);
    });
});

describe("deriveProvenance - pinpoint flaga", () => {
    it("zrodlo pobrane + pinpoint -> pinpoint=true (zawsze weryfikuj)", () => {
        const p = deriveProvenance("saos", "art. 5 ust. 1 lit. e RODO");
        expect(p.tag).toBe("saos");
        expect(p.pinpoint).toBe(true);
    });

    it("zrodlo pobrane bez pinpoint -> pinpoint=false", () => {
        const p = deriveProvenance("client-doc", "strony zawarly umowe najmu");
        expect(p.tag).toBe("uzytkownik");
        expect(p.pinpoint).toBe(false);
    });
});

describe("provenanceLabel - etykieta log/debug (zero PII)", () => {
    it("model zawsze niesie 'zweryfikuj'", () => {
        expect(provenanceLabel({ tag: "model", pinpoint: false })).toBe(
            "model - zweryfikuj",
        );
    });

    it("pobrany tag bez pinpoint -> sama nazwa zrodla", () => {
        expect(provenanceLabel({ tag: "saos", pinpoint: false })).toBe("SAOS");
    });

    it("pobrany tag + pinpoint -> przyrostek 'zweryfikuj'", () => {
        expect(provenanceLabel({ tag: "isap", pinpoint: true })).toBe(
            "ISAP/ELI - zweryfikuj",
        );
    });
});
