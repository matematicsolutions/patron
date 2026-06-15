// Testy walidatorow checksum dla polskich identyfikatorow rejestrowych.
//
// Cele testow:
// 1. Pokrycie obu galezi walidacji (valid + invalid) per kazda funkcja.
// 2. Walidacja stylu wprowadzania danych (NIP z dash / spacja).
// 3. Sprawdzenie ze REGON 14 wymaga valid REGON 9 w prefiksie.
// 4. KRS - sprawdzamy wylacznie format, brak publicznej checksumy.

import { describe, expect, it } from "vitest";
import {
    isValidPesel,
    isValidNip,
    isValidRegon,
    isValidRegon9,
    isValidRegon14,
    isValidKrsFormat,
} from "./checksums";

describe("isValidPesel", () => {
    it.each([
        ["44051401458", true],   // klasyczny testowy
        ["02070803628", true],   // dziecko 2002
        ["44051401459", false],  // zla ostatnia cyfra
        ["44051401450", false],  // zla ostatnia cyfra
        ["12345678901", false],  // brak walidnej checksumy
    ])("PESEL %s -> %s", (pesel, expected) => {
        expect(isValidPesel(pesel)).toBe(expected);
    });

    it("odrzuca PESEL o nieprawidlowej dlugosci", () => {
        expect(isValidPesel("1234567890")).toBe(false);   // 10 cyfr
        expect(isValidPesel("123456789012")).toBe(false); // 12 cyfr
        expect(isValidPesel("")).toBe(false);
    });

    it("odrzuca PESEL ze znakami nie-cyfrowymi", () => {
        expect(isValidPesel("4405140145A")).toBe(false);
        expect(isValidPesel("44 051401458")).toBe(false);
        expect(isValidPesel("44-05-14-014-58")).toBe(false);
    });
});

describe("isValidNip", () => {
    it.each([
        ["5252287009", true],
        ["525-228-70-09", true],   // z dash
        ["525 228 70 09", true],   // ze spacjami
        ["5252287000", false],     // zla checksuma
        ["1234567890", false],     // sum % 11 == 10 (niepoprawny zgodnie z algorytmem)
    ])("NIP %s -> %s", (nip, expected) => {
        expect(isValidNip(nip)).toBe(expected);
    });

    it("odrzuca NIP o nieprawidlowej dlugosci", () => {
        expect(isValidNip("525228700")).toBe(false);    // 9 cyfr
        expect(isValidNip("52522870099")).toBe(false);  // 11 cyfr
    });
});

describe("isValidRegon9", () => {
    it("akceptuje walidny REGON 9-cyfrowy", () => {
        expect(isValidRegon9("123456785")).toBe(true);
    });

    it("odrzuca REGON 9 z bledna checksuma", () => {
        expect(isValidRegon9("123456789")).toBe(false);
        expect(isValidRegon9("000000001")).toBe(false);
    });

    it("odrzuca niepoprawny format", () => {
        expect(isValidRegon9("12345678")).toBe(false);    // 8 cyfr
        expect(isValidRegon9("1234567890")).toBe(false);  // 10 cyfr
        expect(isValidRegon9("12345678A")).toBe(false);   // ze znakiem
    });
});

describe("isValidRegon14", () => {
    it("akceptuje walidny REGON 14-cyfrowy", () => {
        // prefix 9-cyfrowy valid + walidne dodatkowe 5 cyfr
        expect(isValidRegon14("12345678500002")).toBe(true);
    });

    it("odrzuca REGON 14 z prefiksem 9-cyfrowym ktory NIE jest valid", () => {
        // prefix "123456789" nie jest walidnym REGON 9
        expect(isValidRegon14("12345678900000")).toBe(false);
    });

    it("odrzuca REGON 14 z bledna 14-ta cyfra", () => {
        expect(isValidRegon14("12345678500001")).toBe(false);
        expect(isValidRegon14("12345678500009")).toBe(false);
    });

    it("odrzuca niepoprawny format", () => {
        expect(isValidRegon14("1234567850000")).toBe(false);    // 13 cyfr
        expect(isValidRegon14("123456785000022")).toBe(false);  // 15 cyfr
    });
});

describe("isValidRegon (router 9 lub 14)", () => {
    it("przelacza na walidator wlasciwej dlugosci", () => {
        expect(isValidRegon("123456785")).toBe(true);
        expect(isValidRegon("12345678500002")).toBe(true);
        expect(isValidRegon("123456789")).toBe(false);
        expect(isValidRegon("12345678500001")).toBe(false);
    });

    it("odrzuca inne dlugosci niz 9 i 14", () => {
        expect(isValidRegon("12345678")).toBe(false);       // 8
        expect(isValidRegon("1234567890")).toBe(false);     // 10
        expect(isValidRegon("1234567890123")).toBe(false);  // 13
    });

    it("akceptuje separatory dash i spacje", () => {
        expect(isValidRegon("123-456-785")).toBe(true);
        expect(isValidRegon("123 456 785")).toBe(true);
    });
});

describe("isValidKrsFormat", () => {
    it("akceptuje 10-cyfrowy KRS z wiodacymi zerami", () => {
        expect(isValidKrsFormat("0000000001")).toBe(true);
        expect(isValidKrsFormat("0001234567")).toBe(true);
        expect(isValidKrsFormat("9999999999")).toBe(true);
    });

    it("odrzuca inna dlugosc lub znaki nie-cyfrowe", () => {
        expect(isValidKrsFormat("123456789")).toBe(false);    // 9 cyfr
        expect(isValidKrsFormat("12345678901")).toBe(false);  // 11 cyfr
        expect(isValidKrsFormat("12345abc12")).toBe(false);
        expect(isValidKrsFormat("KRS1234567")).toBe(false);   // z prefixem
    });
});
