// Pure functions maskowania PII dla audit_log payload (ADR-0040 faza 1).
//
// Maskowanie wykonywane server-side w handlerze GET /api/audit/log PRZED
// serializacja do JSON. Audytor zewnetrzny widzi metadata zdarzenia z
// zamaskowanymi danymi klienta (PESEL/NIP/REGON/imie/email/dluga tresc).
//
// Per Konstytucja Patrona Art. 5 (tajemnica zawodowa) - audytor widzi
// strukture compliance, nie dane sprawy. Pre-render maskowanie (klient nie
// ma dostepu do raw payload).
//
// Wszystkie funkcje sa pure: deterministyczne, zero IO, testowalne bez
// mockow. Inwariant: dlugosc output = dlugosc input dla numerow stalej
// dlugosci (PESEL/NIP/REGON).

const PESEL_LENGTH = 11;
const NIP_LENGTH = 10;
const REGON_9_LENGTH = 9;
const REGON_14_LENGTH = 14;

/**
 * Maskuje numer stalej dlugosci zachowujac `head` pierwszych i `tail`
 * ostatnich cyfr. Srodek zastapiony gwiazdkami. Inwariant: output.length
 * = input.length.
 *
 * Zwraca input bez zmiany jezeli:
 * - input pusty / nie-string
 * - input zawiera nie-cyfry
 * - head + tail >= input.length (nie ma co maskowac)
 */
export function maskFixedNumber(
    s: string,
    head: number,
    tail: number,
): string {
    if (!s || typeof s !== "string") return s;
    if (!/^\d+$/.test(s)) return s;
    if (head < 0 || tail < 0) return s;
    if (head + tail >= s.length) return s;
    const stars = "*".repeat(s.length - head - tail);
    return s.slice(0, head) + stars + s.slice(s.length - tail);
}

/**
 * Maskuje PESEL (11 cyfr): 4 pierwsze + 3 gwiazdki + 4 ostatnie.
 * Przyklad: "12345678901" -> "1234***8901".
 */
export function maskPesel(s: string): string {
    if (!s || s.length !== PESEL_LENGTH) return s;
    return maskFixedNumber(s, 4, 4);
}

/**
 * Maskuje NIP (10 cyfr): 3 pierwsze + 4 gwiazdki + 3 ostatnie.
 * Przyklad: "1234567890" -> "123****890".
 */
export function maskNip(s: string): string {
    if (!s || s.length !== NIP_LENGTH) return s;
    return maskFixedNumber(s, 3, 3);
}

/**
 * Maskuje REGON (9 lub 14 cyfr): 3 pierwsze + N gwiazdek + 3 ostatnie.
 * REGON 9 cyfr: "123456789" -> "123***789".
 * REGON 14 cyfr: "12345678901234" -> "123********234".
 */
export function maskRegon(s: string): string {
    if (!s) return s;
    if (s.length !== REGON_9_LENGTH && s.length !== REGON_14_LENGTH) return s;
    return maskFixedNumber(s, 3, 3);
}

/**
 * Maskuje email: pierwsze 3 znaki local part + "***" + "@" + domena.
 * Przyklad: "abcdef@example.pl" -> "abc***@example.pl".
 * Bez "@" -> input bez zmiany.
 */
export function maskEmail(s: string): string {
    if (!s || typeof s !== "string") return s;
    const atIdx = s.indexOf("@");
    if (atIdx === -1) return s;
    const local = s.slice(0, atIdx);
    const domain = s.slice(atIdx);
    if (local.length <= 3) return s;
    return local.slice(0, 3) + "***" + domain;
}

/**
 * Maskuje dlugi tekst: pierwsze `head` znakow + "[...]" + ostatnie `tail`
 * znakow. Tekst krotszy niz `head + tail + 5` zwracany bez zmiany.
 * Default head=100, tail=100.
 */
export function maskTextWindow(
    s: string,
    head = 100,
    tail = 100,
): string {
    if (!s || typeof s !== "string") return s;
    const threshold = head + tail + 5;
    if (s.length <= threshold) return s;
    return s.slice(0, head) + "[...]" + s.slice(s.length - tail);
}

/**
 * Rekurencyjnie maskuje wartosci w payload audit_log.
 * - Obiekty: kazda wartosc rekurencyjnie
 * - Tablice: kazdy element rekurencyjnie
 * - Stringi: heurystyki (PESEL/NIP/REGON jezeli sam string ma poprawna
 *   dlugosc i sa cyframi; email jezeli zawiera "@"; dlugi tekst jezeli
 *   dluzszy niz prog)
 * - Inne (number/boolean/null): bez zmiany
 *
 * Funkcja jest defensywna - akceptuje `unknown`, zwraca `unknown`. Niech
 * caller wie ze ksztalt sie nie zmienia tylko wartosci.
 */
export function maskPayload(payload: unknown): unknown {
    if (payload === null || payload === undefined) return payload;
    if (typeof payload === "string") return maskString(payload);
    if (typeof payload === "number" || typeof payload === "boolean") return payload;
    if (Array.isArray(payload)) return payload.map(maskPayload);
    if (typeof payload === "object") {
        const out: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
            out[key] = maskPayload(value);
        }
        return out;
    }
    return payload;
}

/**
 * Heurystyka per-string. Probuje w kolejnosci: PESEL, NIP, REGON, email,
 * dlugi tekst. Pierwsza pasujaca aplikuje sie, reszta jest pomijana.
 */
function maskString(s: string): string {
    if (s.length === PESEL_LENGTH && /^\d+$/.test(s)) return maskPesel(s);
    if (s.length === NIP_LENGTH && /^\d+$/.test(s)) return maskNip(s);
    if (
        (s.length === REGON_9_LENGTH || s.length === REGON_14_LENGTH) &&
        /^\d+$/.test(s)
    ) {
        return maskRegon(s);
    }
    if (s.includes("@") && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) {
        return maskEmail(s);
    }
    return maskTextWindow(s);
}
