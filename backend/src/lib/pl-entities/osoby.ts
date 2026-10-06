// Osoby bez kotwicy roli: imie ze slownika (takze w odmianie) + nazwisko,
// oraz dalsze wystapienia nazwiska juz wykrytej osoby.
//
// Po co: detektor egress (pseudonim/plDetector.ts) lapal osobe tylko po
// markerze ("Pan", "adw.", "swiadek", ...). "Jan Kowalski" w srodku zdania,
// "powodki Anny Zielinskiej" i kazde dalsze "Zielinska wniosla" wychodzily do
// modelu chmurowego otwartym tekstem. Nad-maskowanie jest tam odwracane na
// strumieniu odpowiedzi, wiec recall kosztuje malo, a wyciek jest grozny.
//
// Wzorzec przeniesiony z matematic-anonimizacja-pl v0.3.0 (ten sam autor).
// Pomiar tam, na slepym zestawie 80 fragmentow: recall OSOBA 0,307 -> 0,729,
// kontrola negatywna 0/21 bez zmian.

/** Male litery bez ogonkow - "l" z kreska nie rozklada sie w NFD, stad osobna zamiana. */
export function zloz(slowo: string): string {
    return slowo
        .toLowerCase()
        .replace(/ł/g, "l")
        .normalize("NFD")
        .replace(/\p{M}/gu, "");
}

/** Mianowniki imion (zlozone, bez ogonkow). ~200 najczestszych. */
const IMIONA: readonly string[] = [
    "Adam", "Adrian", "Aleksander", "Andrzej", "Antoni", "Arkadiusz", "Artur",
    "Bartlomiej", "Bartosz", "Bogdan", "Cezary", "Damian", "Daniel", "Dariusz",
    "Dawid", "Dominik", "Emil", "Eryk", "Filip", "Franciszek", "Grzegorz", "Gustaw",
    "Henryk", "Hubert", "Igor", "Ireneusz", "Jacek", "Jakub", "Jan", "Janusz",
    "Jaroslaw", "Jerzy", "Jozef", "Kacper", "Kamil", "Karol", "Kazimierz", "Konrad",
    "Krzysztof", "Lech", "Leszek", "Lukasz", "Maciej", "Marcin", "Marek", "Mariusz",
    "Mateusz", "Michal", "Mikolaj", "Miroslaw", "Norbert", "Oskar", "Pawel", "Piotr",
    "Przemyslaw", "Rafal", "Robert", "Roman", "Ryszard", "Sebastian", "Slawomir",
    "Stanislaw", "Stefan", "Szymon", "Tadeusz", "Tomasz", "Waldemar", "Wiktor",
    "Wlodzimierz", "Wojciech", "Zbigniew", "Zdzislaw", "Zygmunt", "Agata", "Agnieszka",
    "Aleksandra", "Alicja", "Aneta", "Anna", "Barbara", "Beata", "Bozena", "Danuta",
    "Dorota", "Edyta", "Elzbieta", "Emilia", "Ewa", "Gabriela", "Grazyna", "Halina",
    "Hanna", "Helena", "Iga", "Ilona", "Irena", "Iwona", "Izabela", "Jadwiga",
    "Joanna", "Jolanta", "Julia", "Justyna", "Karolina", "Katarzyna", "Kinga",
    "Klaudia", "Krystyna", "Lena", "Lidia", "Magdalena", "Malgorzata", "Maria",
    "Marta", "Martyna", "Marzena", "Monika", "Natalia", "Oliwia", "Patrycja",
    "Paulina", "Renata", "Sandra", "Sylwia", "Teresa", "Urszula", "Weronika",
    "Wiktoria", "Wioletta", "Zofia", "Zuzanna", "Albert", "Aleksy", "Alfred",
    "Boguslaw", "Boleslaw", "Borys", "Bronislaw", "Czeslaw", "Edmund", "Edward",
    "Ernest", "Eugeniusz", "Feliks", "Gerard", "Hieronim", "Ignacy", "Julian",
    "Kajetan", "Kornel", "Leon", "Leonard", "Lucjan", "Ludwik", "Maksymilian",
    "Marian", "Mieczyslaw", "Milosz", "Olaf", "Oliwer", "Patryk", "Radoslaw",
    "Remigiusz", "Sylwester", "Tymon", "Tymoteusz", "Waclaw", "Wieslaw", "Witold",
    "Wladyslaw", "Zenon", "Aldona", "Celina", "Czeslawa", "Dagmara", "Daria", "Diana",
    "Dominika", "Ewelina", "Honorata", "Jagoda", "Janina", "Kamila", "Karina",
    "Kornelia", "Laura", "Lucja", "Lucyna", "Maja", "Marianna", "Marlena", "Milena",
    "Nikola", "Olga", "Regina", "Roksana", "Sabina", "Stanislawa", "Stefania",
    "Tamara", "Wanda", "Zaneta", "Genowefa", "Wieslawa", "Bogumila",
];

/** Mianowniki imion (do kolejnosci "Nazwisko Imie" z tabel). */
const MIANOWNIKI: ReadonlySet<string> = new Set(IMIONA.map((n) => n.toLowerCase()));

/** Wszystkie formy odmiany imion z IMIONA, malymi literami i bez ogonkow. */
export const FORMY_IMION: ReadonlySet<string> = (() => {
    const out = new Set<string>();
    const dodaj = (rdzen: string, koncowki: string[]) => {
        for (const k of koncowki) out.add(rdzen + k);
    };
    for (const imie of IMIONA) {
        const n = imie.toLowerCase();
        out.add(n);
        if (n.endsWith("a")) dodaj(n.slice(0, -1), ["a", "y", "i", "ie", "e", "o"]);
        else if (n.endsWith("y")) dodaj(n.slice(0, -1), ["ego", "emu", "ym"]);
        else if (n.endsWith("i")) dodaj(n, ["ego", "emu", "m"]);
        else {
            const meskie = ["a", "owi", "em", "ie", "u", "e"];
            dodaj(n, meskie);
            // e ruchome: Marek -> Marka, Pawel -> Pawla.
            const ruchome = n.match(/^(.*)e([klc])$/);
            if (ruchome) dodaj(ruchome[1]! + ruchome[2]!, meskie);
        }
    }
    return out;
})();

const jestImieniem = (slowo: string) => FORMY_IMION.has(zloz(slowo));

// Reguly jak w matematic-anonimizacja-pl v0.4.0 (pomiar na slepych zestawach 2 i 3).
const PARA_RE = /(?<![\p{L}\p{N}])\p{Lu}\p{Ll}+\s+\p{Lu}\p{Ll}+(?:-\p{Lu}\p{Ll}+)?(?![\p{L}\p{N}])/gu;
// "Anna Maria Nowak" - bez tej reguly nazwisko po dwoch imionach przeciekalo.
const TROJKA_RE = /(?<![\p{L}\p{N}])\p{Lu}\p{Ll}+\s+\p{Lu}\p{Ll}+\s+\p{Lu}\p{Ll}+(?:-\p{Lu}\p{Ll}+)?(?![\p{L}\p{N}])/gu;
// "Kowalczyk Jan" tylko przed separatorem tabeli/listy - w zdaniu "Pozwany Jan
// zeznal" para z wielkich liter to rola + imie.
const ODWROCONA_RE = /(?<![\p{L}\p{N}])\p{Lu}\p{Ll}+\s+\p{Lu}\p{Ll}+(?![\p{L}\p{N}])(?=[ \t]*(?:[|,;\t]|\r?$))/gmu;
// "JAN KOWALCZYK" / "KOWALCZYK JAN" z komparycji.
const WERSALIKI_RE = /(?<![\p{L}\p{N}])\p{Lu}{2,}(?:\s+\p{Lu}{2,}){1,2}(?:-\p{Lu}{2,})?(?![\p{L}\p{N}])/gu;

function zbierz(re: RegExp, text: string, waliduj: (czlony: string[]) => boolean, out: string[]) {
    const r = new RegExp(re.source, re.flags);
    let m: RegExpExecArray | null;
    while ((m = r.exec(text)) !== null) {
        const czlony = m[0].split(/\s+/);
        if (waliduj(czlony)) out.push(czlony.join(" "));
        // Odrzucona para ("Pozwany Jan") nie zjada imienia nastepnej osoby.
        else r.lastIndex = m.index + 1;
    }
}

/**
 * Osoby rozpoznane po imieniu ze slownika (w dowolnym przypadku): "Imie
 * Nazwisko", "Imie Imie Nazwisko", "Nazwisko Imie" w tabeli, wersaliki.
 */
export function osobyZImieniem(text: string): string[] {
    const out: string[] = [];
    zbierz(TROJKA_RE, text, ([a, b]) => jestImieniem(a!) && jestImieniem(b!), out);
    zbierz(PARA_RE, text, ([a]) => jestImieniem(a!), out);
    zbierz(ODWROCONA_RE, text, ([a, b]) => !jestImieniem(a!) && MIANOWNIKI.has(zloz(b!)), out);
    zbierz(WERSALIKI_RE, text, (c) =>
        jestImieniem(c[0]!) ? c.slice(1).some((x) => !jestImieniem(x)) : c.length === 2 && MIANOWNIKI.has(zloz(c[1]!)),
    out);
    return out;
}

const MIN_RDZEN = 4;
const PRZYMIOTNIKOWE = ["i", "iego", "iemu", "im", "a", "iej", "ich", "imi", "y", "ego", "emu", "ym", "ej", "ych", "ymi"];
const RZECZOWNIKOWE = ["", "a", "owi", "iem", "em", "u", "ie", "owie", "ow", "om", "y", "e", "o", "ami", "ach"];

interface Rdzen {
    rdzen: string;
    koncowki: readonly string[];
}

/** Rdzenie nazwiska (dowolny przypadek na wejsciu) z dopuszczalnymi koncowkami liczby pojedynczej. */
export function rdzenie(nazwisko: string): Rdzen[] {
    const s = zloz(nazwisko);
    const przym = s.match(/^(.*(?:sk|ck|dzk))(?:i|a|iego|iemu|im|iej|ich|imi)$/);
    if (przym) return przym[1]!.length >= MIN_RDZEN ? [{ rdzen: przym[1]!, koncowki: PRZYMIOTNIKOWE }] : [];
    const out: Rdzen[] = [];
    if (s.endsWith("a")) out.push({ rdzen: s.slice(0, -1), koncowki: ["a", "y", "i", "e", "ie", "o"] });
    const kandydaci = new Set([s]);
    for (const k of RZECZOWNIKOWE) if (k && s.endsWith(k)) kandydaci.add(s.slice(0, -k.length));
    for (const r of kandydaci) {
        out.push({ rdzen: r, koncowki: RZECZOWNIKOWE });
        const ruchome = r.match(/^(.*)e([lkc])$/);
        if (ruchome) out.push({ rdzen: ruchome[1]! + ruchome[2]!, koncowki: RZECZOWNIKOWE.filter((k) => k !== "") });
    }
    return out.filter((r) => r.rdzen.length >= MIN_RDZEN);
}

const SLOWO_RE = /(?<![\p{L}\p{N}])\p{Lu}\p{L}*(?:-\p{Lu}\p{L}*)?(?![\p{L}\p{N}])/gu;

/**
 * Dalsze wystapienia nazwisk osob z `osoby` ("Anna Zielinska" -> "Zielinskiej",
 * "ZIELINSKA", "Zielinska" po OCR bez ogonkow). Zwraca unikalne slowa z tekstu.
 * Liczba mnoga ("Kowalscy") nie jest obslugiwana.
 */
export function propagujNazwiska(text: string, osoby: readonly string[]): string[] {
    const lista: Rdzen[] = [];
    for (const o of osoby) {
        // Nazwiskiem jest kazdy czlon, ktory nie jest imieniem - dziala przy kazdej kolejnosci.
        for (const czlon of o.trim().split(/\s+/).filter((c) => !jestImieniem(c))) {
            for (const czesc of czlon.split("-")) if (czesc) lista.push(...rdzenie(czesc));
        }
    }
    if (lista.length === 0) return [];
    const pasuje = (slowo: string) => {
        const z = zloz(slowo);
        return lista.some(({ rdzen, koncowki }) => z.startsWith(rdzen) && koncowki.includes(z.slice(rdzen.length)));
    };
    const out = new Set<string>();
    for (const m of text.matchAll(SLOWO_RE)) {
        if (m[0].split("-").some((c) => c && pasuje(c))) out.add(m[0]);
    }
    return [...out];
}
