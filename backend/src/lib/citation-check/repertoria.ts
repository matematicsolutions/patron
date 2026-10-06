// "Sprawdz powolania" (ADR-0157, poprawka R-CC-01): co z rzeczy wygladajacych
// jak sygnatura MOZE wyjsc do weryfikatora.
//
// Ekstraktor (`cytaty_pl.ts`, kopia z Repertorium, sha przypiety - NIE ruszamy go)
// bierze za sygnature kazdy ciag "LITERY liczba/liczba" po zamianie na wersaliki:
// "ul. Polna 12/24", "FV 123/2024", "Rep. A 5678/2021", "KAN 45/2025". To dobre
// dla wyszukiwarki (lepiej sprawdzic za duzo), ale zle dla wysylki z kancelarii:
// adres klienta albo numer faktury to tresc pisma, nie powolanie.
//
// ZASADA: lepiej NIE wyslac niz wyslac cos, co nie jest sygnatura. Sygnatura
// wychodzi tylko, gdy jej symbol repertorium jest na BIALEJ LISCIE ponizej.
// Pozycja zatrzymana zostaje w wyniku jako `not_sent` z powodem - prawnik ja
// widzi (nigdy zielona), wiec brak na liscie jest widocznym falszywym
// negatywem, a nie cichym wyciekiem.
//
// ZRODLO LISTY: symbole repertoriow z praktyki publikacji orzeczen -
//   * sady powszechne: repertoria z instrukcji sadowej (zarzadzenie Ministra
//     Sprawiedliwosci w sprawie organizacji i zakresu dzialania sekretariatow
//     sadowych oraz innych dzialow administracji sadowej), ksztalt potwierdzony
//     w Portalu Orzeczen Sadow Powszechnych / SAOS ("I ACa 123/20");
//   * Sad Najwyzszy: sygnatury z bazy orzeczen SN (izby: Cywilna, Karna, Pracy
//     i Ubezpieczen Spolecznych, Kontroli Nadzwyczajnej i Spraw Publicznych,
//     dyscyplinarne) wraz z dawnymi repertoriami (CKN, PKN, ...), ktore wciaz
//     pojawiaja sie w powolaniach;
//   * NSA i WSA: Centralna Baza Orzeczen Sadow Administracyjnych ("II OSK 1/20",
//     "III SA/Wa 2809/25");
//   * Trybunal Konstytucyjny: sygnatury z OTK ("K 1/20", "SK 3/21", "P 7/20");
//   * Krajowa Izba Odwolawcza: "KIO 3088/24" (ksztalt w korpusie Repertorium).
// Lista skladana RECZNIE, nie generowana; wpisywalismy tylko symbole, ktorych
// jestesmy pewni. Repertorium rzadkie albo nowe, ktorego tu brak, wychodzi jako
// `not_sent` z powodem "not_court_signature" - dopisanie symbolu to swiadoma
// zmiana tej listy razem z testem (`repertoria.test.ts`).
//
// Dodatkowe zawezenia (kazde tnie konkretna klase falszywych trafien ekstraktora):
//   1. Numer rzymski wydzialu jest WYMAGANY - poza TK, KIO i SNO, ktore go nie maja.
//      Sady powszechne, SN, NSA i WSA zawsze podaja wydzial ("I C", "II CSKP").
//   2. Pisownia z PISMA (nie po wersalikach) musi byc kanoniczna ("ACa") albo cala
//      wersalikami ("ACA", tak pisze korpus) - "po 12/24" ani "Pa 3/20" pisane
//      inaczej nie przejda.
//   3. Symbole TK bez numeru rzymskiego ("K 1/20", "P 7/20", "U 2/20") sa krotkie i
//      latwo o falszywe trafienie, wiec wychodza tylko z "TK"/"Trybunal" w poblizu.
//   4. Literowka w symbolu ("II CKSP" zamiast "II CSKP") wychodzi, bo wykrycie
//      sklejonego albo przekreconego powolania to sedno sprawdzenia - ale tylko
//      jako przestawienie dwoch sasiednich liter symbolu z listy, z numerem
//      rzymskim i pisane wersalikami.

import { normSygnatury, WZOR_SYGNATURY } from "./cytaty_pl";

/** Wydzialy/repertoria z numerem rzymskim przed symbolem (pisownia kanoniczna). */
const Z_NUMEREM_RZYMSKIM: readonly string[] = [
    // --- Sady powszechne: cywilne (SR, SO, SA) ---
    "C", "Ca", "Cz", "Co", "Cps", "Ns", "Nc", "ACa", "ACz", "ACo",
    // gospodarcze, upadlosciowe i restrukturyzacyjne
    "GC", "GNc", "GNs", "GCo", "Ga", "Gz", "AGa", "AGz",
    "GU", "GUp", "GUk", "GUz", "GUo", "GR", "GRp", "GRz", "GRk", "GRo", "GRs",
    // rodzinne i nieletnich
    "RC", "RCa", "RCz", "RCo", "RNs", "RNc", "Nsm", "Nkd",
    // pracy i ubezpieczen spolecznych
    "P", "Pa", "Pz", "Po", "Np", "APa", "APz", "U", "Ua", "Uz", "Uo", "AUa", "AUz",
    // karne, wykroczeniowe, penitencjarne
    "K", "Ka", "Kz", "Kp", "Ko", "Kop", "Kow", "Kzw", "AKa", "AKz", "AKo", "Wa", "Wz", "Wo",
    // --- Sad Najwyzszy: Izba Cywilna (z dawnymi repertoriami) ---
    "CSK", "CSKP", "CNP", "CNPP", "CZ", "CZP", "CO", "CK", "CKN", "CRN", "CR", "CN",
    // Izba Pracy i Ubezpieczen Spolecznych (z dawnymi)
    "PK", "PSK", "PSKP", "PZ", "PZP", "PO", "PNP", "UK", "USK", "USKP", "UZ", "UZP", "UO", "UNP",
    "PKN", "UKN", "PRN", "URN",
    // Izba Karna i dawna Izba Wojskowa
    "KK", "KZP", "KO", "KZ", "KP", "WK", "WZ", "WA",
    // Izba Kontroli Nadzwyczajnej i Spraw Publicznych oraz dawna Izba Pracy, US i SP
    "NSK", "NSNc", "NSNk", "NSNp", "NSNu", "NSW", "NSP", "NO", "NZP",
    "SK", "SZ", "SW", "SO", "SPP", "KRS", "RN",
    // sprawy dyscyplinarne w SN
    "DSI", "DSS", "DI",
    // --- NSA ---
    "OSK", "GSK", "FSK", "OPS", "GPS", "FPS", "OZ", "GZ", "FZ", "OW",
    // --- WSA (i dawne osrodki zamiejscowe NSA): "SA/Wa", "SAB/Kr", "SO/Gd" ---
    // obslugiwane osobno ponizej (symbol + "/" + siedziba).
];

/** Symbole bez numeru rzymskiego. Wartosc: czy wymagany kontekst Trybunalu. */
const BEZ_NUMERU_RZYMSKIEGO: ReadonlyMap<string, boolean> = new Map([
    // Trybunal Konstytucyjny
    ["K", true], ["P", true], ["SK", true], ["U", true], ["Kp", true], ["Kpt", true],
    ["Tw", true], ["Ts", true], ["Pp", true],
    // Krajowa Izba Odwolawcza (i dawny zapis "KIO/UZP")
    ["KIO", false], ["KIO/UZP", false],
    // Sad Najwyzszy jako sad dyscyplinarny (dawny zapis)
    ["SNO", false],
]);

/** WSA: symbol przed ukosnikiem i siedziba sadu po nim. */
const WSA_SYMBOLE = new Set(["SA", "SAB", "SO"]);
const WSA_SIEDZIBY: readonly string[] = [
    "Wa", "Kr", "Gd", "Po", "Wr", "Łd", "Ld", "Lu", "Bk", "Sz", "Ke", "Ol", "Op", "Rz",
    "Go", "Gl", "Bd", "Ka",
];

// Klucz: WERSALIKI (tak oddaje je ekstraktor), wartosc: pisownie kanoniczne -
// jeden klucz moze miec kilka ("Kp" sadu powszechnego i "KP" Izby Karnej SN).
function mapa(lista: Iterable<string>): Map<string, string[]> {
    const m = new Map<string, string[]>();
    for (const s of lista) m.set(s.toUpperCase(), [...(m.get(s.toUpperCase()) ?? []), s]);
    return m;
}
const RZYMSKIE = mapa(Z_NUMEREM_RZYMSKIM);
const BEZ_RZYMSKICH = mapa(BEZ_NUMERU_RZYMSKIEGO.keys());
const SIEDZIBY = mapa(WSA_SIEDZIBY);

/**
 * Pisownia kanoniczna symbolu z pisma albo null. Przechodzi pisownia z listy
 * ("ACa") albo cala wersalikami ("ACA", tak pisze korpus).
 */
function kanon(m: ReadonlyMap<string, string[]>, zPisma: string): string | null {
    const kandydaci = m.get(zPisma.toUpperCase());
    if (!kandydaci) return null;
    if (kandydaci.includes(zPisma)) return zPisma;
    return zPisma === zPisma.toUpperCase() ? kandydaci[0] : null;
}

const KONTEKST_TK = /\bTK\b|Trybuna[lł]/i;

export interface RozbiorSygnatury {
    rzymski: string | null;
    /** Symbol z pisma: bez spacji i kropek, z ukosnikiem WSA ("SA/Wa"). */
    symbol: string;
}

/**
 * Rozbior sygnatury tak, jak stoi w PISMIE (pisownia zachowana). Spacje w
 * symbolu sa usuwane - PDF potrafi rozbic "II CSK P 1644/22", a ekstraktor to
 * skleja.
 */
export function rozbierz(zPisma: string): RozbiorSygnatury | null {
    const n = zPisma
        .replace(/\u00a0/g, " ")
        .replace(/\./g, "")
        .replace(/\s*\/\s*/g, "/")
        .replace(/\s+/g, " ")
        .trim();
    const m = /^(?:([IVXivx]{1,5})\s+)?(\S(?:.*?\S)?)\s+\d{1,6}\/\d{2,4}$/.exec(n);
    if (!m) return null;
    const symbol = m[2].replace(/\s+/g, "");
    if (!/^[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]+(?:\/[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]+)?$/.test(symbol)) return null;
    return { rzymski: m[1] ?? null, symbol };
}

function przestawienia(symbol: string): string[] {
    const out: string[] = [];
    for (let i = 0; i + 1 < symbol.length; i += 1) {
        const a = symbol.split("");
        [a[i], a[i + 1]] = [a[i + 1], a[i]];
        const v = a.join("");
        if (v !== symbol) out.push(v);
    }
    return out;
}

/**
 * Czy ciag z pisma jest sygnatura polskiego sadu (TK, KIO) z bialej listy.
 *
 * @param zPisma    wycinek pisma z sygnatura (pisownia oryginalna)
 * @param kontekst  tekst pisma wokol sygnatury (kontekst TK); opcjonalny -
 *                  bez niego symbole TK bez numeru rzymskiego NIE przechodza
 */
export function jestSygnaturaSadu(zPisma: string, kontekst = ""): boolean {
    const r = rozbierz(zPisma);
    if (!r) return false;
    const { rzymski, symbol } = r;

    if (rzymski === null) {
        const k = kanon(BEZ_RZYMSKICH, symbol);
        if (!k) return false;
        return BEZ_NUMERU_RZYMSKIEGO.get(k) ? KONTEKST_TK.test(kontekst) : true;
    }
    // Numer rzymski z pisma pisany wersalikami ("i C 12/24" to nie wydzial).
    if (rzymski !== rzymski.toUpperCase()) return false;

    const slash = symbol.indexOf("/");
    if (slash >= 0) {
        const baza = symbol.slice(0, slash);
        const siedziba = symbol.slice(slash + 1);
        return WSA_SYMBOLE.has(baza) && kanon(SIEDZIBY, siedziba) !== null;
    }

    if (kanon(RZYMSKIE, symbol)) return true;
    // Literowka: przestawione dwie sasiednie litery symbolu z listy, tylko
    // wersalikami i dla symboli od 3 liter ("CKSP" -> "CSKP").
    if (symbol.length >= 3 && symbol === symbol.toUpperCase())
        return przestawienia(symbol).some((v) => RZYMSKIE.has(v));
    return false;
}

/** Ile znakow od poczatku pisma uznajemy za naglowek (sad, sygnatura, strony). */
export const NAGLOWEK_ZNAKOW = 1500;

const ZNACZNIK_SYGNATURY = /\bsygn(?:atura|\.)?\s*(?:akt)?\s*[:.]?\s*/giu;

/**
 * Sygnatury WLASNEJ sprawy: te, ktore w naglowku pisma stoja zaraz po
 * "Sygn. akt" / "Sygnatura akt" / "sygn.". Zwracane w postaci ekstraktora
 * (normSygnatury, rok czterocyfrowy skrocony do dwoch cyfr), zeby dalo sie je
 * porownac z `LocalCitation.signature`.
 *
 * Sygnatura wlasnej sprawy to dane sprawy klienta, a nie powolanie: domyslnie
 * nie wychodzi. Granica naglowka jest przyblizona - "sygn. akt" cytowanego
 * orzeczenia w pierwszych NAGLOWEK_ZNAKOW znakach krotkiego pisma tez zostanie
 * zatrzymane (widoczny falszywy negatyw, nie wyciek).
 */
export function sygnaturyWlasnejSprawy(tekst: string): Set<string> {
    const naglowek = tekst.slice(0, NAGLOWEK_ZNAKOW);
    const out = new Set<string>();
    for (const m of naglowek.matchAll(ZNACZNIK_SYGNATURY)) {
        const od = (m.index ?? 0) + m[0].length;
        const okno = " " + naglowek.slice(od, od + 40).toUpperCase() + " ";
        const s = new RegExp(WZOR_SYGNATURY.source, "g").exec(okno);
        // Sygnatura ma stac ZARAZ po znaczniku (okno zaczyna sie spacja).
        if (!s || s.index > 1) continue;
        const syg = normSygnatury(s[1]);
        const r4 = /^(.*\/)((?:19|20)\d{2})$/.exec(syg);
        out.add(r4 ? r4[1] + r4[2].slice(2) : syg);
    }
    return out;
}
