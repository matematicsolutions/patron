// Testy field-crypto (ADR-0138). Czyste, bez bazy.

import crypto from "crypto";
import { describe, it, expect } from "vitest";
import { encryptField, decryptField, isEncryptedField } from "./field-crypto";

const DEK = crypto.randomBytes(32);

describe("field-crypto: encrypt/decrypt round-trip", () => {
    it("round-trip zachowuje plaintext (w tym UTF-8/PL)", () => {
        for (const pt of ["", "Kowalski", "PESEL 44051401359", "zażółć gęślą jaźń", "{\"a\":1}"]) {
            const c = encryptField(pt, DEK);
            expect(isEncryptedField(c)).toBe(true);
            expect(decryptField(c, DEK)).toBe(pt);
        }
    });

    it("ten sam plaintext daje ROZNE ciphertexty (losowy iv)", () => {
        const a = encryptField("tajne", DEK);
        const b = encryptField("tajne", DEK);
        expect(a).not.toBe(b);
        expect(decryptField(a, DEK)).toBe("tajne");
        expect(decryptField(b, DEK)).toBe("tajne");
    });

    it("ciphertext nie zawiera plaintextu", () => {
        const c = encryptField("Kowalski Jan", DEK);
        expect(c).not.toContain("Kowalski");
        expect(c.startsWith("fc1:")).toBe(true);
    });
});

describe("field-crypto: fail-loud", () => {
    it("zly klucz -> rzuca (auth_tag)", () => {
        const c = encryptField("tajne", DEK);
        expect(() => decryptField(c, crypto.randomBytes(32))).toThrow();
    });

    it("manipulacja ciphertextem -> rzuca (tamper)", () => {
        const c = encryptField("tajne", DEK);
        const parts = c.split(":");
        // odwroc ostatni znak ct (segment 2)
        const ct = parts[2];
        parts[2] = ct.slice(0, -1) + (ct.slice(-1) === "A" ? "B" : "A");
        expect(() => decryptField(parts.join(":"), DEK)).toThrow();
    });

    it("zly format -> rzuca", () => {
        expect(() => decryptField("nie-jest-ciphertextem", DEK)).toThrow();
        expect(() => decryptField("fc1:tylko:trzy", DEK)).toThrow();
    });

    it("DEK zlej dlugosci -> rzuca", () => {
        expect(() => encryptField("x", crypto.randomBytes(16))).toThrow();
        expect(() => decryptField(encryptField("x", DEK), crypto.randomBytes(31))).toThrow();
    });
});

describe("field-crypto: isEncryptedField", () => {
    it("rozpoznaje ciphertext vs plaintext-legacy", () => {
        expect(isEncryptedField(encryptField("x", DEK))).toBe(true);
        expect(isEncryptedField("zwykly tekst")).toBe(false);
        expect(isEncryptedField("")).toBe(false);
        expect(isEncryptedField(null)).toBe(false);
        expect(isEncryptedField(123)).toBe(false);
    });
});
