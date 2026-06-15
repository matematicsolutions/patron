// Testy pure functions maskowania PII (ADR-0040 faza 1).

import { describe, expect, it } from "vitest";

import {
    maskEmail,
    maskFixedNumber,
    maskNip,
    maskPayload,
    maskPesel,
    maskRegon,
    maskTextWindow,
} from "./audit-pii-mask";

describe("maskFixedNumber", () => {
    it("zachowuje head i tail, srodek na gwiazdki, dlugosc bez zmiany", () => {
        expect(maskFixedNumber("12345678", 2, 2)).toBe("12****78");
        expect("12****78".length).toBe(8);
    });

    it("zwraca input bez zmiany dla pustego stringa", () => {
        expect(maskFixedNumber("", 1, 1)).toBe("");
    });

    it("zwraca input bez zmiany gdy zawiera nie-cyfry", () => {
        expect(maskFixedNumber("123abc", 1, 1)).toBe("123abc");
    });

    it("zwraca input bez zmiany gdy head + tail >= length", () => {
        expect(maskFixedNumber("12345", 3, 3)).toBe("12345");
        expect(maskFixedNumber("12345", 5, 0)).toBe("12345");
    });
});

describe("maskPesel", () => {
    it("zachowuje 4 pierwsze + 4 ostatnie, 3 gwiazdki w srodku, 11 znakow razem", () => {
        const masked = maskPesel("12345678901");
        expect(masked).toBe("1234***8901");
        expect(masked.length).toBe(11);
    });

    it("zwraca input bez zmiany gdy nie 11 znakow", () => {
        expect(maskPesel("123456789")).toBe("123456789");
        expect(maskPesel("123456789012")).toBe("123456789012");
    });

    it("zwraca input bez zmiany dla pustego stringa", () => {
        expect(maskPesel("")).toBe("");
    });
});

describe("maskNip", () => {
    it("zachowuje 3 pierwsze + 3 ostatnie, 4 gwiazdki w srodku, 10 znakow razem", () => {
        const masked = maskNip("1234567890");
        expect(masked).toBe("123****890");
        expect(masked.length).toBe(10);
    });

    it("zwraca input bez zmiany gdy nie 10 znakow", () => {
        expect(maskNip("123456789")).toBe("123456789");
    });
});

describe("maskRegon", () => {
    it("REGON 9 cyfr: 3+3 (3 gwiazdki srodek)", () => {
        const masked = maskRegon("123456789");
        expect(masked).toBe("123***789");
        expect(masked.length).toBe(9);
    });

    it("REGON 14 cyfr: 3+3 (8 gwiazdek srodek)", () => {
        const masked = maskRegon("12345678901234");
        expect(masked).toBe("123********234");
        expect(masked.length).toBe(14);
    });

    it("zwraca input bez zmiany dla nieprawidlowej dlugosci (np. 11 cyfr - to nie REGON)", () => {
        expect(maskRegon("12345678901")).toBe("12345678901");
    });
});

describe("maskEmail", () => {
    it("3 pierwsze znaki + *** + @ + domena", () => {
        expect(maskEmail("abcdef@example.pl")).toBe("abc***@example.pl");
    });

    it("zwraca input bez zmiany gdy brak @", () => {
        expect(maskEmail("bezat-znaku")).toBe("bezat-znaku");
    });

    it("zwraca input bez zmiany gdy local part <= 3 znaki (nic do maskowania)", () => {
        expect(maskEmail("ab@x.pl")).toBe("ab@x.pl");
    });

    it("zwraca input bez zmiany dla pustego", () => {
        expect(maskEmail("")).toBe("");
    });
});

describe("maskTextWindow", () => {
    it("krotki tekst zwracany bez zmiany", () => {
        const short = "x".repeat(50);
        expect(maskTextWindow(short, 100, 100)).toBe(short);
    });

    it("dlugi tekst maskowany: head + [...] + tail", () => {
        const long = "A".repeat(100) + "MIDDLE".repeat(50) + "Z".repeat(100);
        const masked = maskTextWindow(long, 100, 100);
        expect(masked.startsWith("A".repeat(100))).toBe(true);
        expect(masked.endsWith("Z".repeat(100))).toBe(true);
        expect(masked.includes("[...]")).toBe(true);
        expect(masked.includes("MIDDLE")).toBe(false);
    });

    it("default head=100 tail=100", () => {
        const long = "x".repeat(500);
        const masked = maskTextWindow(long);
        expect(masked.length).toBeLessThan(500);
        expect(masked.includes("[...]")).toBe(true);
    });
});

describe("maskPayload", () => {
    it("null/undefined bez zmiany", () => {
        expect(maskPayload(null)).toBe(null);
        expect(maskPayload(undefined)).toBe(undefined);
    });

    it("number/boolean bez zmiany", () => {
        expect(maskPayload(42)).toBe(42);
        expect(maskPayload(true)).toBe(true);
    });

    it("string PESEL maskowany przez heurystyke", () => {
        expect(maskPayload("12345678901")).toBe("1234***8901");
    });

    it("string NIP maskowany przez heurystyke", () => {
        expect(maskPayload("1234567890")).toBe("123****890");
    });

    it("string email maskowany przez heurystyke", () => {
        expect(maskPayload("abcdef@kancelaria.pl")).toBe("abc***@kancelaria.pl");
    });

    it("rekurencyjnie wchodzi w obiekty zagniezdzone", () => {
        const input = {
            actor: {
                email: "abcdef@example.pl",
                pesel: "12345678901",
            },
            metadata: {
                count: 5,
                active: true,
            },
        };
        const result = maskPayload(input) as typeof input;
        expect(result.actor.email).toBe("abc***@example.pl");
        expect(result.actor.pesel).toBe("1234***8901");
        expect(result.metadata.count).toBe(5);
        expect(result.metadata.active).toBe(true);
    });

    it("rekurencyjnie wchodzi w tablice", () => {
        const input = ["12345678901", "1234567890", "krotki tekst"];
        const result = maskPayload(input) as string[];
        expect(result[0]).toBe("1234***8901");
        expect(result[1]).toBe("123****890");
        expect(result[2]).toBe("krotki tekst");
    });

    it("krotkie stringi (ponizej threshold) bez zmiany", () => {
        expect(maskPayload("Jan Kowalski")).toBe("Jan Kowalski");
    });
});
