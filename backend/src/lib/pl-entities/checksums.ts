// Walidatory checksum dla polskich identyfikatorow rejestrowych.
//
// Wszystkie funkcje sa pure (deterministyczne, bez I/O) - audyt
// reprodukowalny (Konstytucja Art. 3). Algorytmy z urzedowych zalacznikow:
// - PESEL: Ustawa z dnia 24 wrzesnia 2010 r. o ewidencji ludnosci,
//   zalacznik nr 1 (wagi 1-3-7-9-1-3-7-9-1-3 mod 10)
// - NIP: Ustawa o zasadach ewidencji i identyfikacji podatnikow i platnikow
//   (wagi 6-5-7-2-3-4-5-6-7 mod 11, czyfra 10 nie istnieje - jezeli mod
//   da 10, numer jest niepoprawny)
// - REGON 9-cyfrowy: rozporzadzenie GUS, wagi 8-9-2-3-4-5-6-7 mod 11
//   (mod 10 -> czyfra 0)
// - REGON 14-cyfrowy: pierwsze 9 walidowane jak wyzej + dodatkowe 5 cyfr
//   z wagami 2-4-8-5-0-9-7-3-6-1-2-4-8 mod 11 (mod 10 -> czyfra 0)
// - KRS: 10-cyfrowy identyfikator bez publicznej checksumy, walidujemy
//   wylacznie format (10 cyfr, mozliwe wiodace zera)

/**
 * Walidacja PESEL - 11 cyfr + checksuma wagowa (1,3,7,9,1,3,7,9,1,3) mod 10.
 *
 * `(10 - sum % 10) % 10` zwraca wartosc w zakresie 0-9 niezaleznie od mod -
 * druga modulo zamyka przypadek sum % 10 == 0 (wtedy chcemy 0, nie 10).
 */
export function isValidPesel(pesel: string): boolean {
    if (!/^\d{11}$/.test(pesel)) return false;
    const weights = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3];
    let sum = 0;
    for (let i = 0; i < 10; i++) {
        sum += parseInt(pesel[i]!, 10) * weights[i]!;
    }
    const checksum = (10 - (sum % 10)) % 10;
    return checksum === parseInt(pesel[10]!, 10);
}

/**
 * Walidacja NIP - 10 cyfr + checksuma wagowa (6,5,7,2,3,4,5,6,7) mod 11.
 * Dopuszczamy separatory `-` i spacje (`123-456-78-90`, `123 456 78 90`).
 *
 * Jezeli mod 11 == 10, numer jest niepoprawny (cyfra 10 nie istnieje).
 */
export function isValidNip(nip: string): boolean {
    const digits = nip.replace(/[\s-]/g, "");
    if (!/^\d{10}$/.test(digits)) return false;
    const weights = [6, 5, 7, 2, 3, 4, 5, 6, 7];
    let sum = 0;
    for (let i = 0; i < 9; i++) {
        sum += parseInt(digits[i]!, 10) * weights[i]!;
    }
    const checksum = sum % 11;
    if (checksum === 10) return false;
    return checksum === parseInt(digits[9]!, 10);
}

/**
 * Walidacja REGON 9-cyfrowy - wagi 8-9-2-3-4-5-6-7 mod 11, jezeli mod
 * da 10 to spodziewana cyfra 0.
 */
export function isValidRegon9(regon: string): boolean {
    if (!/^\d{9}$/.test(regon)) return false;
    const weights = [8, 9, 2, 3, 4, 5, 6, 7];
    let sum = 0;
    for (let i = 0; i < 8; i++) {
        sum += parseInt(regon[i]!, 10) * weights[i]!;
    }
    const mod = sum % 11;
    const checksum = mod === 10 ? 0 : mod;
    return checksum === parseInt(regon[8]!, 10);
}

/**
 * Walidacja REGON 14-cyfrowy - pierwsze 9 musza byc valid REGON 9,
 * a cyfra 14-ta walidowana wagami 2-4-8-5-0-9-7-3-6-1-2-4-8 mod 11
 * (mod 10 -> cyfra 0).
 */
export function isValidRegon14(regon: string): boolean {
    if (!/^\d{14}$/.test(regon)) return false;
    if (!isValidRegon9(regon.substring(0, 9))) return false;
    const weights = [2, 4, 8, 5, 0, 9, 7, 3, 6, 1, 2, 4, 8];
    let sum = 0;
    for (let i = 0; i < 13; i++) {
        sum += parseInt(regon[i]!, 10) * weights[i]!;
    }
    const mod = sum % 11;
    const checksum = mod === 10 ? 0 : mod;
    return checksum === parseInt(regon[13]!, 10);
}

/**
 * Walidacja REGON - akceptuje format 9 lub 14 cyfr.
 */
export function isValidRegon(regon: string): boolean {
    const digits = regon.replace(/[\s-]/g, "");
    if (digits.length === 9) return isValidRegon9(digits);
    if (digits.length === 14) return isValidRegon14(digits);
    return false;
}

/**
 * Walidacja formatu KRS - 10 cyfr (mozliwe wiodace zera, czesto pisane
 * z prefiksem "KRS:" w tekscie). Brak publicznej checksumy KRS, walidujemy
 * wylacznie ksztalt. Decyzja podjeta w ADR-0008 - w razie potrzeby
 * walidacja istnienia podmiotu odbywa sie przez `mcp-krs` lookup
 * (flag `.env KRS_LOOKUP_ENABLED`).
 */
export function isValidKrsFormat(krs: string): boolean {
    return /^\d{10}$/.test(krs);
}
