// Field-level encryption pojedynczej wartosci (ADR-0138). AES-256-GCM, per-wartosc
// losowy iv + auth_tag (wykrywa manipulacje). Czyste funkcje - klucz (DEK) podaje
// wolajacy (warstwa dek.ts owija DEK kluczem glownym KEK). Wzorzec z userApiKeys.ts.
//
// Format ciphertextu (wersjonowany, samoopisujacy):
//   fc1:<base64(iv)>:<base64(ciphertext)>:<base64(auth_tag)>
// Prefiks `fc1` pozwala (a) wykryc czy wartosc jest juz zaszyfrowana (migracja
// legacy-plaintext vs ciphertext), (b) ewoluowac format bez zgadywania.
// base64 nie zawiera ':' -> split bezpieczny.

import crypto from "crypto";

const FORMAT = "fc1";
const ALG = "aes-256-gcm";
const IV_LEN = 12; // 96-bit nonce - rekomendacja GCM
const DEK_LEN = 32; // AES-256

function assertDek(dek: Buffer): void {
    if (!Buffer.isBuffer(dek) || dek.length !== DEK_LEN) {
        throw new Error(
            `field-crypto: DEK musi byc Buffer 32B (AES-256), otrzymano ${
                Buffer.isBuffer(dek) ? `${dek.length}B` : typeof dek
            }.`,
        );
    }
}

/** Szyfruje string -> wersjonowany ciphertext `fc1:iv:ct:tag`. */
export function encryptField(plaintext: string, dek: Buffer): string {
    assertDek(dek);
    const iv = crypto.randomBytes(IV_LEN);
    const cipher = crypto.createCipheriv(ALG, dek, iv);
    const ct = Buffer.concat([
        cipher.update(plaintext, "utf8"),
        cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return [
        FORMAT,
        iv.toString("base64"),
        ct.toString("base64"),
        tag.toString("base64"),
    ].join(":");
}

/**
 * Odszyfrowuje `fc1:iv:ct:tag` -> plaintext. Rzuca przy zlym formacie, zlym
 * kluczu lub naruszeniu auth_tag (manipulacja ciphertextem) - fail-loud, bez
 * cichego zwracania smieci.
 */
export function decryptField(cipher: string, dek: Buffer): string {
    assertDek(dek);
    if (!isEncryptedField(cipher)) {
        throw new Error(
            "field-crypto: nieprawidlowy format ciphertextu (oczekiwano fc1:iv:ct:tag).",
        );
    }
    const parts = cipher.split(":");
    if (parts.length !== 4) {
        throw new Error("field-crypto: uszkodzony ciphertext (zla liczba segmentow).");
    }
    const iv = Buffer.from(parts[1], "base64");
    const ct = Buffer.from(parts[2], "base64");
    const tag = Buffer.from(parts[3], "base64");
    const decipher = crypto.createDecipheriv(ALG, dek, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

/** Czy wartosc jest juz zaszyfrowana (prefiks fc1). Marker migracji. */
export function isEncryptedField(value: unknown): value is string {
    return typeof value === "string" && value.startsWith(`${FORMAT}:`);
}
