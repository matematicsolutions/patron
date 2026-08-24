// Oczekiwany zestaw konektorow MCP per edycja instalatora (ADR-0139).
//
// TO JEST NIEZALEZNY DOM FAKTU - swiadomie NIE importuje niczego z
// prepare-resources.cjs. Gdyby bramka liczyla oczekiwanie ta sama funkcja
// (defaultEnabled / stagedPythonConnectors), ktora produkuje manifest, to
// zgodzilaby sie z kazdym bledem tamtej funkcji i zdawalaby wlasny egzamin.
// Ta lista jest przepisana RECZNIE i zmieniana SWIADOMIE.
//
// Zmierzone 2026-08-24 na DZIEWIECIU wydanych instalatorach 1.2.0 (wyciagniete
// z NSIS: $PLUGINSDIR/app-64.7z -> resources/backend/mcp-servers.json), nie
// wyliczone z kodu. Zgadza sie z tabela w notatce wydania.
//
// Awaria, ktora ta lista lapie (zmierzona 2026-08-17 na konektorze eureka):
// nowy konektor dodany do MCP_SERVERS, ale nie dopisany do lustra JURISDICTION
// w prepare-resources.cjs, jedzie w instalatorze jako enabled=false. Build
// konczy sie exit 0, paczka jest kompletna, a mecenas nie ma zrodla w czacie.
// Nazwa niezsynchronizowana w druga strone (literowka) blokuje wlasny konektor
// bramka typosquat/ring-policy (ADR-0027/0028).
//
// Kiedy ta tabela ma sie zmienic: dodanie/usuniecie konektora z edycji albo
// zmiana domyslnego stanu ON. Wtedy ZMIEN JA W TYM SAMYM COMMICIE co zmiane w
// prepare-resources.cjs i dopisz, na czym zmierzone.

// Pelny zestaw PL/EN: 7 konektorow Node + 13 konektorow Python ELI.
const WSZYSTKIE_20 = Object.freeze([
    // Node (orzecznictwo + legislacja PL/UE)
    "saos", "nsa", "isap", "krs", "eu-sparql", "eu-compliance", "eureka",
    // Python ELI (prawo krajowe)
    "de-eli", "fr-eli", "it-eli", "es-eli", "nl-eli", "se-eli", "at-eli",
    "fi-eli", "ie-eli", "lu-eli", "br-eli", "gb-eli", "us-eli",
]);

const OCZEKIWANE = Object.freeze({
    // Edycja flagowa: caly zestaw w paczce, ON = PL + UE-zbiorcze. Krajowe UE
    // sa w paczce, ale OFF - mecenas wlacza je pickerem, bez pobierania.
    pl: {
        konektory: WSZYSTKIE_20,
        wlaczone: ["saos", "nsa", "isap", "krs", "eureka", "eu-sparql", "eu-compliance"],
        opis: "edycja flagowa PL - komplet w paczce, ON: PL + UE-zbiorcze",
    },
    // Edycja miedzynarodowa: caly zestaw, ON = wszystko poza PL. fr-eli jest
    // OFF, bo Legifrance/PISTE wymaga klucza OAuth (wlacza sie po wpisaniu).
    en: {
        konektory: WSZYSTKIE_20,
        wlaczone: [
            "de-eli", "it-eli", "es-eli", "nl-eli", "se-eli", "at-eli", "fi-eli",
            "ie-eli", "lu-eli", "br-eli", "gb-eli", "us-eli",
            "eu-sparql", "eu-compliance",
        ],
        opis: "edycja miedzynarodowa EN - komplet w paczce, ON: wszystko poza PL i poza fr-eli (klucz PISTE)",
    },
    // Edycje rynkowe sa LEAN CELOWO (decyzja WM, ADR-0139): jeden konektor
    // macierzysty. Reszte zrodel mecenas dobiera z Boutique - i dokladnie tak
    // mowi strona /patron/co-potrafie. Wiecej niz jeden wpis tutaj = albo
    // regresja w stagedPythonConnectors, albo cicha zmiana obietnicy ze strony.
    it: { konektory: ["it-eli"], wlaczone: ["it-eli"], opis: "rynek IT - konektor macierzysty, reszta z Boutique" },
    de: { konektory: ["de-eli"], wlaczone: ["de-eli"], opis: "rynek DE - konektor macierzysty, reszta z Boutique" },
    es: { konektory: ["es-eli"], wlaczone: ["es-eli"], opis: "rynek ES - konektor macierzysty, reszta z Boutique" },
    // fr-eli jest ON mimo wymogu klucza: definiuje edycje, a listTools dziala
    // bez klucza (klucz wpisuje sie przy pierwszym zapytaniu).
    fr: { konektory: ["fr-eli"], wlaczone: ["fr-eli"], opis: "rynek FR - konektor macierzysty ON mimo wymogu klucza PISTE" },
    // Artefakt nazywa sie -BR, ale patron-locale.json niesie "pt".
    pt: { konektory: ["br-eli"], wlaczone: ["br-eli"], opis: "rynek BR (locale pt) - konektor macierzysty, reszta z Boutique" },
    gb: { konektory: ["gb-eli"], wlaczone: ["gb-eli"], opis: "rynek GB - konektor macierzysty, reszta z Boutique" },
    us: { konektory: ["us-eli"], wlaczone: ["us-eli"], opis: "jurysdykcja US - konektor macierzysty, reszta z Boutique" },
});

/** Oczekiwanie dla edycji albo null, gdy edycji NIE MA w tabeli (= blokada). */
function oczekiwanieDla(locale) {
    return Object.prototype.hasOwnProperty.call(OCZEKIWANE, locale)
        ? OCZEKIWANE[locale]
        : null;
}

module.exports = { OCZEKIWANE, WSZYSTKIE_20, oczekiwanieDla };
