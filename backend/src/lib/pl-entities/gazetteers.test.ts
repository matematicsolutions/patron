// Testy loaderow gazetteerow PL.
//
// Cele:
// 1. Spojnosc danych - wszystkie id w sady-pl.json sa unikalne,
//    wszystkie prefix w sygnatury-prefix.json sa unikalne.
// 2. Lookupy po id/alias/sigPrefix.
// 3. Parser parseSignaturePrefix() dla typowych formatow sygnatur.

import { describe, expect, it } from "vitest";
import {
    COURTS,
    SIGNATURE_PREFIXES,
    findCourtById,
    findCourtByAlias,
    findWsaBySigPrefix,
    findSignaturePrefix,
    parseSignaturePrefix,
} from "./gazetteers";

describe("COURTS - spojnosc danych", () => {
    it("ma zaladowane sady", () => {
        expect(COURTS.length).toBeGreaterThan(20);
    });

    it("wszystkie id sa unikalne", () => {
        const ids = COURTS.map((c) => c.id);
        const unique = new Set(ids);
        expect(unique.size).toBe(ids.length);
    });

    it("zawiera trybunaly i kluczowe sady centralne", () => {
        for (const id of ["sn", "tk", "nsa", "kio"]) {
            expect(findCourtById(id)).toBeDefined();
        }
    });

    it("zawiera wszystkie 16 wojewodztw + WSA Warszawa", () => {
        const wsa = COURTS.filter((c) => c.type === "wsa");
        // 16 wojewodztw + WSA dla Gorzowa (lubuskie ma siedzibe w Gorzowie)
        expect(wsa.length).toBeGreaterThanOrEqual(16);
    });

    it("wszystkie WSA maja sigPrefix unikalny", () => {
        const prefixes = COURTS.filter((c) => c.type === "wsa").map((c) => c.sigPrefix);
        expect(prefixes.every((p) => p !== undefined)).toBe(true);
        const unique = new Set(prefixes);
        expect(unique.size).toBe(prefixes.length);
    });
});

describe("SIGNATURE_PREFIXES - spojnosc danych", () => {
    it("ma zaladowane prefixy", () => {
        expect(SIGNATURE_PREFIXES.length).toBeGreaterThan(20);
    });

    it("wszystkie prefix sa unikalne", () => {
        const ids = SIGNATURE_PREFIXES.map((p) => p.prefix);
        const unique = new Set(ids);
        expect(unique.size).toBe(ids.length);
    });

    it("zawiera kluczowe izby SN/NSA/TK/KIO", () => {
        const required = ["III CZP", "I CSK", "II FSK", "I OSK", "K", "P", "SK", "KIO"];
        for (const p of required) {
            expect(findSignaturePrefix(p)).toBeDefined();
        }
    });
});

describe("findCourtByAlias", () => {
    it("rozpoznaje pelna nazwe urzedowa", () => {
        expect(findCourtByAlias("Sad Najwyzszy")?.id).toBe("sn");
        expect(findCourtByAlias("Naczelny Sad Administracyjny")?.id).toBe("nsa");
    });

    it("rozpoznaje aliases polskie z diakrytykami", () => {
        expect(findCourtByAlias("Sąd Najwyższy")?.id).toBe("sn");
        expect(findCourtByAlias("Trybunał Konstytucyjny")?.id).toBe("tk");
    });

    it("rozpoznaje skrocone formy z miastem (WSA, SA, SO)", () => {
        expect(findCourtByAlias("WSA Warszawa")?.id).toBe("wsa-warszawa");
        expect(findCourtByAlias("SA Krakow")?.id).toBe("sa-krakow");
        expect(findCourtByAlias("SO w Lodzi")?.id).toBe("so-lodz");
    });

    it("zwraca undefined dla nieznanego aliasu", () => {
        expect(findCourtByAlias("Sad Nieznany")).toBeUndefined();
        expect(findCourtByAlias("")).toBeUndefined();
    });
});

describe("findWsaBySigPrefix", () => {
    it("mapuje prefix miasta na konkretny WSA", () => {
        expect(findWsaBySigPrefix("Wa")?.id).toBe("wsa-warszawa");
        expect(findWsaBySigPrefix("Kr")?.id).toBe("wsa-krakow");
        expect(findWsaBySigPrefix("Gd")?.id).toBe("wsa-gdansk");
        expect(findWsaBySigPrefix("Wr")?.id).toBe("wsa-wroclaw");
    });

    it("zwraca undefined dla nieznanego prefix-u", () => {
        expect(findWsaBySigPrefix("Xx")).toBeUndefined();
    });
});

describe("parseSignaturePrefix", () => {
    it.each([
        ["III CZP 11/13", "III CZP"],
        ["I CSK 789/23", "I CSK"],
        ["II PK 123/22", "II PK"],
        ["I KK 456/24", "I KK"],
        ["I CSKP 100/24", "I CSKP"],
    ])("SN: %s -> %s", (sig, expected) => {
        expect(parseSignaturePrefix(sig)).toBe(expected);
    });

    it.each([
        ["II FSK 1234/22", "II FSK"],
        ["I OSK 567/23", "I OSK"],
        ["II OPS 7/20", "II OPS"],
        ["I GSK 1/24", "I GSK"],
    ])("NSA: %s -> %s", (sig, expected) => {
        expect(parseSignaturePrefix(sig)).toBe(expected);
    });

    it.each([
        ["II SA/Wa 1234/24", "II SA/Wa"],
        ["III SA/Kr 567/23", "III SA/Kr"],
        ["IV SA/Po 89/24", "IV SA/Po"],
    ])("WSA: %s -> %s", (sig, expected) => {
        expect(parseSignaturePrefix(sig)).toBe(expected);
    });

    it("KIO standard i UZP", () => {
        expect(parseSignaturePrefix("KIO 1234/24")).toBe("KIO");
        expect(parseSignaturePrefix("KIO/UZP 56/23")).toBe("KIO/UZP");
    });

    it.each([
        ["K 12/19", "K"],
        ["P 7/20", "P"],
        ["SK 5/22", "SK"],
        ["U 3/21", "U"],
        ["Kpt 1/19", "Kpt"],
    ])("TK: %s -> %s", (sig, expected) => {
        expect(parseSignaturePrefix(sig)).toBe(expected);
    });

    it("zwraca null dla bzdurnych wejsc", () => {
        expect(parseSignaturePrefix("XYZ 123/24")).toBeNull();
        expect(parseSignaturePrefix("")).toBeNull();
        expect(parseSignaturePrefix("nie sygnatura")).toBeNull();
    });
});

describe("integracja gazetteer x signature prefix", () => {
    it("kazdy SignaturePrefix.court (poza wzorcem sa-*) wskazuje na istniejacy Court", () => {
        for (const p of SIGNATURE_PREFIXES) {
            if (p.court === "sa-*") continue; // wzorzec - apelacyjne sa rozne
            expect(findCourtById(p.court)).toBeDefined();
        }
    });
});
