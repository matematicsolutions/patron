// Loader gazetteerow PL: sady-pl.json + sygnatury-prefix.json.
//
// Sluzy:
// - extractor T2 ADR-0008: po dopasowaniu sygnatury regex podnosi
//   confidence jezeli kod izby + sad sa znane w gazetteerze
// - UI Patrona: pokazuje pelna nazwe sadu przy cytowaniu (np. "II FSK
//   1234/22 (NSA, izba finansowa)")
// - audit bundle (ADR-0006): zapisuje rozszyfrowanie sygnatury
//
// Zrodlo gazetteerow: lista trzonowa skompilowana w T1 ADR-0008 (commit
// po a5f03c2). Update planowany w T2 (pelny indeks Ministerstwa
// Sprawiedliwosci + KIO + TK). Wersjonowane w JSON-ie polem `version`.

import sadyPlData from "./gazetteers/sady-pl.json";
import sygnaturyPrefixData from "./gazetteers/sygnatury-prefix.json";

export type CourtType = "trybunal" | "sad-administracyjny" | "wsa" | "sa" | "so" | "sr" | "organ-odwolawczy";

/**
 * Sad albo organ odwolawczy z rejestru. Pola opcjonalne sa zalezne od
 * typu sadu (`sigPrefix` tylko dla WSA, `jurisdiction` luzny opis dla
 * sadow administracyjnych i apelacyjnych).
 */
export interface Court {
    /** Identyfikator stable - kebab-case, used jako klucz w grafie. */
    id: string;
    /** Pelna nazwa urzedowa. */
    name: string;
    /** Typ sadu - decyduje o tym jakie sygnatury sa wlasciwe. */
    type: CourtType;
    /** Miasto siedziby. */
    city: string;
    /** Alternatywne formy nazwy widywane w opiniach (SN, "Sąd Najwyższy", "SO Warszawa"). */
    aliases: string[];
    /** Krotki skrot miasta uzywany w sygnaturach WSA (Wa, Kr, Po, Gd, ...). */
    sigPrefix?: string;
    /** Luzny opis zasiegu - tekstowy, NIE strukturalny (do uzupelnienia w T2). */
    jurisdiction?: string;
    /** Identyfikator nadrzednego organu (np. KIO -> UZP). */
    parent?: string;
}

/**
 * Mapowanie prefiksu sygnatury (np. "III CZP", "II FSK", "K") na sad +
 * opis sprawy. Sygnatury sadow apelacyjnych maja `court: "sa-*"` (wzorzec
 * - faktyczny sad apelacyjny zalezy od miejsca wniesienia sprawy, nie da
 * sie odczytac z samej sygnatury).
 */
export interface SignaturePrefix {
    /** Forma prefiksu - "III CZP", "II FSK", "K", "KIO" itp. Porownanie case-sensitive. */
    prefix: string;
    /** ID sadu z `sady-pl.json` albo wzorzec "sa-*" dla sadow apelacyjnych. */
    court: string;
    /** Opis izby/wydzialu wedlug regulaminu wewnetrznego sadu. */
    department: string;
    /** Typ sprawy (kasacja, apelacja, postanowienie skladu 7, pytanie prawne). */
    caseType: string;
}

/** Trzonowa lista sadow z rejestru PL. */
export const COURTS: ReadonlyArray<Court> = (sadyPlData as { courts: Court[] }).courts;

/** Mapowanie prefiksow sygnatury na sad + opis. */
export const SIGNATURE_PREFIXES: ReadonlyArray<SignaturePrefix> = (
    sygnaturyPrefixData as { prefixes: SignaturePrefix[] }
).prefixes;

// === Lookupy ===

/**
 * Znajdz sad po id. Stable klucz - nie zmienia sie miedzy wersjami JSON-a.
 */
export function findCourtById(id: string): Court | undefined {
    return COURTS.find((c) => c.id === id);
}

/**
 * Znajdz sad po krotkim prefiksie miasta z sygnatury WSA (Wa, Kr, Po, Gd, ...).
 * Zwraca pierwszy WSA z pasujacym `sigPrefix` - sigPrefix-y sa unikalne
 * w rejestrze WSA.
 */
export function findWsaBySigPrefix(sigPrefix: string): Court | undefined {
    return COURTS.find((c) => c.type === "wsa" && c.sigPrefix === sigPrefix);
}

/**
 * Znajdz sad po dowolnym aliasie - dopasowanie dokladne (case-insensitive
 * po trim). Dla "Sąd Najwyższy" zwraca SN.
 */
export function findCourtByAlias(alias: string): Court | undefined {
    const needle = alias.trim().toLowerCase();
    if (!needle) return undefined;
    for (const c of COURTS) {
        if (c.name.toLowerCase() === needle) return c;
        if (c.aliases.some((a) => a.toLowerCase() === needle)) return c;
    }
    return undefined;
}

/**
 * Znajdz opis prefiksu sygnatury. Porownanie case-sensitive (kody izb sa
 * pisane wielkimi literami; "K" vs "k" to inne kody w TK).
 *
 * Zwraca pierwsze dopasowanie (prefiksy w JSON-ie powinny byc unikalne -
 * walidacja w testach).
 */
export function findSignaturePrefix(prefix: string): SignaturePrefix | undefined {
    return SIGNATURE_PREFIXES.find((p) => p.prefix === prefix);
}

/**
 * Rozpoznaj prefix sygnatury z pelnego stringa sygnatury orzeczenia.
 *
 * "III CZP 11/13" -> "III CZP"
 * "II FSK 1234/22" -> "II FSK"
 * "II SA/Wa 1234/24" -> "II SA/Wa" (specjalna obsluga WSA przez sigPrefix)
 * "KIO 1234/24" -> "KIO"
 * "KIO/UZP 56/23" -> "KIO/UZP"
 * "K 12/19" -> "K"
 * "I C 100/26" -> "I C" (sad powszechny - kod jednoliterowy)
 * "I ACa 1234/23" -> "I ACa" (sad apelacyjny - kod mieszany)
 *
 * Zwraca null jezeli nie da sie rozpoznac. Wywolujacy moze wtedy
 * fallowac na `findSignaturePrefix(firstToken)` jezeli to wystarcza.
 */
export function parseSignaturePrefix(signature: string): string | null {
    const trimmed = signature.trim();
    // WSA: "II SA/Wa 1234/24" - prefix to "II SA/Wa"
    const wsaMatch = trimmed.match(/^(I{1,3}|IV)\s+SA\/[A-Z][a-z]{1,2}\b/);
    if (wsaMatch) return wsaMatch[0];
    // KIO/UZP - przed KIO bo dluzsza forma
    if (/^KIO\/UZP\b/.test(trimmed)) return "KIO/UZP";
    if (/^KIO\b/.test(trimmed)) return "KIO";
    // SN/NSA: "III CZP", "II FSK", "I CSKP" - rzymska + 2-4 litery wielkie
    const snNsaMatch = trimmed.match(/^(I{1,3}|IV|V|VI|VII)\s+([A-Z]{2,4})\b/);
    if (snNsaMatch) return `${snNsaMatch[1]} ${snNsaMatch[2]}`;
    // TK: "K 12/19", "SK 5/22", "Kpt 1/19"
    const tkMatch = trimmed.match(/^(K|P|U|SK|Kp|Kpt|Pp|Tw)\b/);
    if (tkMatch) return tkMatch[1]!;
    // Sady powszechne / apelacyjne: "I C 100/26" -> "I C", "I ACa 1234/23"
    // -> "I ACa". Po SN/NSA, bo te wymagaja kodu 2-4 wielkich liter; tu kod
    // jednoliterowy lub mieszany. Negatywny lookahead `(?![A-Z]{2,4}\s)`
    // wyklucza kody SN/NSA (spojny z SAD_POWSZECHNY_SIGNATURE_RE w regex.ts).
    // Rzymska I-XXXIX spojna z ROMAN_1_39 w regex.ts.
    const spMatch = trimmed.match(
        /^(X{1,3}(?:IX|IV|VI{0,3}|I{1,3})?|IX|IV|VI{0,3}|I{1,3})\s+(?![A-Z]{2,4}\s)([A-Z][A-Za-z]{0,3})\b/,
    );
    if (spMatch) return `${spMatch[1]} ${spMatch[2]}`;
    return null;
}
