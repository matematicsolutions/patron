/**
 * CYTATY Z POLSKIEGO TEKSTU PRAWNICZEGO - jeden dom rozpoznawania (26.09).
 *
 * Sygnatury orzeczen, przepisy kodeksow i czesto cytowanych ustaw, adresy w Dzienniku
 * Ustaw i Monitorze Polskim, nazwy ustaw spoza listy oraz data orzeczenia podana przy
 * sygnaturze. Tego samego kodu uzywa wyszukiwanie Repertorium (przez `ranking.ts`) i
 * narzedzie `verify_citations` - zmiana ksztaltu sygnatury albo adresu przepisu ma
 * jedno miejsce.
 *
 * 🔴 PLIK JEST KOPIOWANY 1:1 ("vendored") DO PATRONA - repozytorium PUBLICZNEGO.
 * PATRON wyciaga cytaty LOKALNIE i wysyla do `verify_citations` tylko ich liste, wiec
 * tresc pisma nie opuszcza komputera kancelarii. Z tego wynikaja dwie twarde reguly:
 *   1. ZERO importow i zero zaleznosci - plik ma dzialac w dowolnym runtime JS/TS.
 *   2. Tylko logika rozpoznawania. Zadnych nazw osob, klientow, tokenow, adresow
 *      wewnetrznych ani odnosnikow do notatek - pilnuje tego `narzedzia/sha_cytatow.py`
 *      (bramka jawnosci), ktory liczy tez sha256 do testu dryfu po stronie PATRONA
 *      (`narzedzia/cytaty_pl.sha256`). Zmiana pliku = nowy sha = swiadoma aktualizacja
 *      kopii w PATRONIE.
 */

/**
 * KODEKSY POD SKROTEM - "392 kc" znaczy art. 392 Kodeksu cywilnego.
 *
 * 🔴 KAZDY identyfikator SPRAWDZONY tytulem aktu w korpusie, a nie wpisany z
 * pamieci o numerach Dziennika Ustaw. Mapa jest krotka celowo: kodeksy, ktore
 * prawnik skraca w mowie, i ustawy czesto cytowane. Reszta aktow idzie zwykla
 * droga wyszukiwania.
 *
 * 🔴 WZORCE UZYWAJA `\S*`, NIE `\w*`: `\w` w JS bez flagi `u` nie obejmuje
 * polskich liter, wiec wzorzec z `\w` nie dopasowuje "kodeks
 * postepowania" pisanego z ogonkami.
 */
export const KODEKSY: Array<{ id: string; nazwa: string; skroty: string[]; wzorce: RegExp[] }> = [
  { id: "eli:DU/1964/93", nazwa: "Kodeks cywilny", skroty: ["kc"],
    wzorce: [/kodeks\S*\s+cywiln\S*/] },
  { id: "eli:DU/1964/296", nazwa: "Kodeks postepowania cywilnego", skroty: ["kpc"],
    wzorce: [/kodeks\S*\s+post\S*\s+cywiln\S*/] },
  { id: "eli:DU/1997/557", nazwa: "Kodeks karny wykonawczy", skroty: ["kkw"],
    wzorce: [/kodeks\S*\s+karn\S*\s+wykonawcz\S*/] },
  // 🔴 KOLEJNOSC: KKS i KPSW PRZED Kodeksem karnym i wykroczen - petla bierze
  // PIERWSZE trafienie, a "kodeks karny skarbowy" pasuje takze do wzorca
  // samego Kodeksu karnego. Do 23.09 pytanie o k.k.s. dostawalo k.k. (zla
  // ustawa pod adresem, po cichu); zlapane przy przegladzie powolan.
  { id: "eli:DU/1999/930", nazwa: "Kodeks karny skarbowy", skroty: ["kks"],
    wzorce: [/kodeks\S*\s+karn\S*\s+skarbow\S*/] },
  { id: "eli:DU/2001/1148", nazwa: "Kodeks postepowania w sprawach o wykroczenia",
    skroty: ["kpsw", "kpw"],
    wzorce: [/kodeks\S*\s+post\S*\s+w\s+sprawach\s+o\s+wykrocze\S*/,
             /post\S*\s+w\s+sprawach\s+o\s+wykrocze\S*/] },
  { id: "eli:DU/1997/553", nazwa: "Kodeks karny", skroty: ["kk"],
    wzorce: [/kodeks\S*\s+karn\S*/] },
  { id: "eli:DU/1997/555", nazwa: "Kodeks postepowania karnego", skroty: ["kpk"],
    wzorce: [/kodeks\S*\s+post\S*\s+karn\S*/] },
  { id: "eli:DU/2000/1037", nazwa: "Kodeks spolek handlowych", skroty: ["ksh"],
    wzorce: [/kodeks\S*\s+sp\S*\s+handlow\S*/] },
  { id: "eli:DU/1960/168", nazwa: "Kodeks postepowania administracyjnego", skroty: ["kpa"],
    wzorce: [/kodeks\S*\s+post\S*\s+administracyjn\S*/] },
  { id: "eli:DU/1974/141", nazwa: "Kodeks pracy", skroty: ["kp"],
    wzorce: [/kodeks\S*\s+pracy/] },
  { id: "eli:DU/1964/59", nazwa: "Kodeks rodzinny i opiekunczy", skroty: ["kro"],
    wzorce: [/kodeks\S*\s+rodzinn\S*/] },
  { id: "eli:DU/1971/114", nazwa: "Kodeks wykroczen", skroty: ["kw"],
    wzorce: [/kodeks\S*\s+wykrocze\S*/] },
  { id: "eli:DU/1997/926", nazwa: "Ordynacja podatkowa", skroty: ["op"],
    wzorce: [/ordynacj\S*\s+podatkow\S*/] },
  // ── USTAWY CZESTO CYTOWANE (18.09) ─────────────────────────────────────
  // Wyszukiwanie ustawy PO NAZWIE przez indeks tresci okazalo sie zawodne
  // (rozporzadzenia o podobnych slowach wygrywaly z sama ustawa), a przeszukanie
  // wszystkich tytulow na kazde zapytanie jest za drogie. Stad lista - krotka,
  // kazdy identyfikator SPRAWDZONY tytulem aktu w korpusie.
  //
  // Skrotow ryzykownych NIE dodajemy: "kw" zostaje przy Kodeksie wykroczen,
  // wiec Kodeks wyborczy rozpoznajemy tylko po nazwie; "pb"/"pu"/"pr" sa zbyt
  // krotkie, zeby nie trafiac w zwykle slowa.
  { id: "eli:DU/1994/535", nazwa: "Ustawa o ochronie zdrowia psychicznego", skroty: ["uoozp"],
    wzorce: [/ochron\S*\s+zdrowia\s+psychiczn\S*/] },
  { id: "eli:DU/2004/535", nazwa: "Ustawa o podatku od towarow i uslug", skroty: ["vat", "uptu"],
    wzorce: [/podatk\S*\s+od\s+towar\S*/] },
  { id: "eli:DU/1991/350", nazwa: "Ustawa o PIT", skroty: ["pit", "updof"],
    wzorce: [/podatk\S*\s+dochodow\S*\s+od\s+os\S*\s+fizyczn\S*/] },
  { id: "eli:DU/1992/86", nazwa: "Ustawa o CIT", skroty: ["cit", "updop"],
    wzorce: [/podatk\S*\s+dochodow\S*\s+od\s+os\S*\s+prawn\S*/] },
  { id: "eli:DU/1994/414", nazwa: "Prawo budowlane", skroty: [],
    wzorce: [/prawo\s+budowlan\S*|prawa\s+budowlan\S*/] },
  { id: "eli:DU/1997/602", nazwa: "Prawo o ruchu drogowym", skroty: ["prd", "pord"],
    wzorce: [/ruchu\s+drogow\S*/] },
  { id: "eli:DU/2001/733", nazwa: "Ustawa o ochronie praw lokatorow", skroty: ["uopl"],
    wzorce: [/ochron\S*\s+praw\s+lokator\S*/] },
  { id: "eli:DU/2003/535", nazwa: "Prawo upadlosciowe", skroty: [],
    wzorce: [/praw\S*\s+upad\S*/] },
  { id: "eli:DU/1987/123", nazwa: "Ustawa o Rzeczniku Praw Obywatelskich", skroty: [],
    wzorce: [/rzeczni\S*\s+praw\s+obywatelsk\S*/] },
  { id: "eli:DU/1994/591", nazwa: "Ustawa o rachunkowosci", skroty: ["uor"],
    wzorce: [/rachunkowo\S*/] },
  { id: "eli:DU/2011/112", nazwa: "Kodeks wyborczy", skroty: [],
    wzorce: [/kodeks\S*\s+wyborcz\S*/] },
  { id: "eli:DU/2015/978", nazwa: "Prawo restrukturyzacyjne", skroty: [],
    wzorce: [/praw\S*\s+restrukturyzac\S*/] },
  { id: "eli:DU/1997/769", nazwa: "Ustawa o KRS", skroty: ["ukrs"],
    wzorce: [/krajow\S*\s+rejestr\S*\s+s\S*d\S*/] },
  { id: "eli:DU/2002/1270", nazwa: "Prawo o postepowaniu przed sadami administracyjnymi",
    skroty: ["ppsa"], wzorce: [/post\S*\s+przed\s+s\S*\s+administracyjn\S*/] },
  { id: "eli:DU/1994/83", nazwa: "Ustawa o prawie autorskim", skroty: ["upapp", "pap"],
    wzorce: [/praw\S*\s+autorsk\S*/] },
  { id: "eli:DU/2019/2019", nazwa: "Prawo zamowien publicznych", skroty: ["pzp"],
    wzorce: [/zam\S*\s+publiczn\S*/] },
  { id: "eli:DU/2018/1000", nazwa: "Ustawa o ochronie danych osobowych", skroty: ["uodo"],
    wzorce: [/ochron\S*\s+danych\s+osobow\S*/] },
  { id: "eli:DU/1997/741", nazwa: "Ustawa o gospodarce nieruchomosciami", skroty: ["ugn"],
    wzorce: [/gospodar\S*\s+nieruchomo\S*/] },
  // ── USTAWY NAJCZESCIEJ POWOLYWANE PRZEZ ORZECZENIA (23.09) ──────────────
  //
  // Uzupelnione RAZ, wedlug tego, co realnie cytuja orzeczenia w korpusie:
  // ranking powolan z grafu orzeczenie -> ustawa, sortowany liczba ORZECZEN, nie
  // wystapien - jedno uzasadnienie potrafi powolac k.p.c. kilkanascie razy, a nas
  // interesuje, ilu prawnikow o akt zahaczy. Kazdy identyfikator SPRAWDZONY
  // tytulem aktu, kazdy wzorzec pisany recznie - generator proponowal m.in. rdzen
  // "sądzi" dla "Sadu Najwyzszego", ktory nie trafia w "Sad Najwyzszy".
  { id: "eli:DU/1998/1118", nazwa: "Ustawa o emeryturach i rentach z FUS", skroty: [],
    wzorce: [/emerytur\S*\s+i\s+rent\S*\s+z\s+f/] },
  { id: "eli:DU/1998/887", nazwa: "Ustawa o systemie ubezpieczen spolecznych", skroty: [],
    wzorce: [/system\S*\s+ubezpiecze\S*\s+społecz\S*/] },
  { id: "eli:DU/2005/1398", nazwa: "Ustawa o kosztach sadowych w sprawach cywilnych",
    skroty: ["uksc"], wzorce: [/koszt\S*\s+sądow\S*\s+w\s+sprawach\s+cywiln\S*/] },
  { id: "eli:DU/2003/1152", nazwa: "Ustawa o ubezpieczeniach obowiazkowych, UFG i PBUK",
    skroty: [], wzorce: [/ubezpiecze\S*\s+obowiązkow\S*/,
                         /ubezpieczeniow\S*\s+fundus\S*\s+gwarancyjn\S*/] },
  { id: "eli:DU/1973/152", nazwa: "Ustawa o oplatach w sprawach karnych", skroty: [],
    wzorce: [/opłat\S*\s+w\s+sprawach\s+karn\S*/] },
  // "ksiegach" i "ksiag" roznia sie ogonkiem w rdzeniu - stad "ksi\S*".
  { id: "eli:DU/1982/147", nazwa: "Ustawa o ksiegach wieczystych i hipotece", skroty: ["ukwh"],
    wzorce: [/ksi\S*\s+wieczyst\S*/] },
  { id: "eli:DU/2005/1485", nazwa: "Ustawa o przeciwdzialaniu narkomanii", skroty: [],
    wzorce: [/przeciwdziała\S*\s+narkoma\S*/] },
  { id: "eli:DU/1993/211", nazwa: "Ustawa o zwalczaniu nieuczciwej konkurencji",
    skroty: ["uznk"], wzorce: [/zwalcza\S*\s+nieuczciw\S*\s+konkurencj\S*/] },
  { id: "eli:DU/1999/636",
    nazwa: "Ustawa o swiadczeniach pienieznych z ubezpieczenia spolecznego w razie choroby",
    skroty: [], wzorce: [/świadcze\S*\s+pieniężn\S*\s+z\s+ubezpiecze\S*/] },
  { id: "eli:DU/1991/24", nazwa: "Ustawa o ubezpieczeniu spolecznym rolnikow", skroty: [],
    wzorce: [/ubezpiecze\S*\s+społeczn\S*\s+rolni\S*/] },
  { id: "eli:DU/2008/1656", nazwa: "Ustawa o emeryturach pomostowych", skroty: [],
    wzorce: [/emerytur\S*\s+pomostow\S*/] },
  { id: "eli:DU/2002/1673",
    nazwa: "Ustawa o ubezpieczeniu spolecznym z tytulu wypadkow przy pracy", skroty: [],
    wzorce: [/wypadk\S*\s+przy\s+pracy\s+i\s+chor\S*/,
             /ubezpiecze\S*\s+społeczn\S*\s+z\s+tytułu\s+wypadk\S*/] },
  { id: "eli:DU/2004/2135", nazwa: "Ustawa o swiadczeniach opieki zdrowotnej", skroty: [],
    wzorce: [/świadcze\S*\s+opiek\S*\s+zdrowotn\S*/] },
  { id: "eli:DU/1994/388", nazwa: "Ustawa o wlasnosci lokali", skroty: [],
    wzorce: [/własnoś\S*\s+lokal\S*/] },
  { id: "eli:DU/1994/214", nazwa: "Ustawa o zaopatrzeniu emerytalnym funkcjonariuszy",
    skroty: [], wzorce: [/zaopatrze\S*\s+emerytaln\S*\s+funkcjonariu\S*/] },
  { id: "eli:DU/2004/1843", nazwa: "Ustawa o skardze na przewleklosc postepowania",
    skroty: [], wzorce: [/skard\S*\s+na\s+narusze\S*\s+prawa\s+strony/,
                         /przewlekło\S*\s+postępowa\S*/] },
  { id: "eli:DU/2001/27", nazwa: "Ustawa o spoldzielniach mieszkaniowych", skroty: [],
    wzorce: [/spółdzielni\S*\s+mieszkaniow\S*/] },
  { id: "eli:DU/1990/95", nazwa: "Ustawa o samorzadzie gminnym", skroty: [],
    wzorce: [/samorząd\S*\s+gminn\S*/] },
  { id: "eli:DU/2009/1540", nazwa: "Ustawa o grach hazardowych", skroty: [],
    wzorce: [/gra\S*\s+hazardow\S*|hazardow\S*/] },
  { id: "eli:DU/2011/715", nazwa: "Ustawa o kredycie konsumenckim", skroty: [],
    wzorce: [/kredy\S*\s+konsumenc\S*/] },
  { id: "eli:DU/2007/331", nazwa: "Ustawa o ochronie konkurencji i konsumentow",
    skroty: ["uokik"], wzorce: [/ochron\S*\s+konkurencj\S*/] },
  { id: "eli:DU/2003/844", nazwa: "Ustawa o zwolnieniach grupowych", skroty: [],
    wzorce: [/szczególn\S*\s+zasad\S*\s+rozwiązywa\S*/, /zwolnie\S*\s+grupow\S*/] },
  { id: "eli:DU/1982/19", nazwa: "Karta Nauczyciela", skroty: [],
    wzorce: [/kart\S*\s+nauczycie\S*/] },
  { id: "eli:DU/1982/145", nazwa: "Ustawa o radcach prawnych", skroty: [],
    wzorce: [/radc\S*\s+prawn\S*/] },
  { id: "eli:DU/1994/163", nazwa: "Ustawa o zakladowym funduszu swiadczen socjalnych",
    skroty: ["zfss"], wzorce: [/zakładow\S*\s+fundus\S*\s+świadcze\S*/] },
  { id: "eli:DU/1991/234", nazwa: "Ustawa o zwiazkach zawodowych", skroty: [],
    wzorce: [/związk\S*\s+zawodow\S*/] },
  // 🔴 ODMIANA ZMIENIA RDZEN: "renta" -> "rencie", wiec rdzen "rent" nie trafia
  // w "o rencie socjalnej" (zlapane audytem nazw 23.09). Tniemy do "ren".
  { id: "eli:DU/2003/1268", nazwa: "Ustawa o rencie socjalnej", skroty: [],
    wzorce: [/ren\S*\s+socjaln\S*/] },
  { id: "eli:DU/2001/1070", nazwa: "Prawo o ustroju sadow powszechnych", skroty: ["usp"],
    wzorce: [/ustroj\S*\s+sądów\s+powszechn\S*/] },
  { id: "eli:DU/2004/1252", nazwa: "Ustawa o swiadczeniach przedemerytalnych", skroty: [],
    wzorce: [/świadcze\S*\s+przedemerytaln\S*/] },
  { id: "eli:DU/1991/425", nazwa: "Ustawa o systemie oswiaty", skroty: [],
    wzorce: [/system\S*\s+oświat\S*/] },
  { id: "eli:DU/2011/654", nazwa: "Ustawa o dzialalnosci leczniczej", skroty: [],
    wzorce: [/działalnoś\S*\s+leczni\S*/] },
  { id: "eli:DU/1985/60", nazwa: "Ustawa o drogach publicznych", skroty: [],
    wzorce: [/drog\S*\s+publiczn\S*/] },
  { id: "eli:DU/1996/622", nazwa: "Ustawa o utrzymaniu czystosci i porzadku w gminach",
    skroty: [], wzorce: [/utrzyma\S*\s+czysto\S*\s+i\s+porząd\S*/] },
];

/**
 * ADRES AKTU W DZIENNIKU - "Dz.U. 2023 poz. 955" to nie slowa, to identyfikator.
 *
 * Zapytanie "Dz.U. 2023 poz. 955 ze zm." potraktowane jak slowa oddaje INNY akt
 * z 2023 roku - liczby 2023 i 955 ida do bm25 jak kazde inne slowo. ELI ma dla
 * tego adresu wprost `eli:DU/2023/955`. Obslugujemy tez stary zapis z numerem
 * ("Dz.U. 1997 nr 88 poz. 553" - ELI pomija numer) i Monitor Polski.
 *
 * Adres wygrywa z nazwa kodeksu: jest bardziej szczegolowy, a piszacy, ktory
 * podal pozycje w Dzienniku, wie, o ktory tekst mu chodzi (np. tekst jednolity).
 */
export function rozpoznajAdres(zapytanie: string):
    { akt: string; nazwa: string; artykul: string | null } | null {
  const q = " " + zapytanie.toLowerCase().replace(/\u00a0/g, " ") + " ";
  const m = q.match(
    /(dz\.?\s*u|m\.?\s*p)\.?\s*(?:z\s*)?(\d{4})\s*(?:r\.?)?\s*,?\s*(?:nr\s*\d+\s*,?\s*)?poz\.?\s*(\d{1,5})/);
  if (!m) return null;
  const dziennik = m[1].replace(/[\s.]/g, "") === "dzu" ? "DU" : "MP";
  const art = q.match(/art(?:ykul|ykuł)?\.?\s*(\d{1,4}[a-z]?)/);
  return { akt: `eli:${dziennik}/${m[2]}/${Number(m[3])}`,
           nazwa: `${dziennik} ${m[2]} poz. ${Number(m[3])}`, artykul: art ? art[1] : null };
}

/**
 * SYGNATURA ORZECZENIA - "I OSK 590/26" to identyfikator, nie trzy slowa.
 *
 * 🔴 Sygnatura potraktowana jak worek slow nie trafia: "I FZ 104/26" oddaje akty z
 * Monitora Polskiego poz. 104, choc postanowienie NSA o tej sygnaturze lezy w
 * korpusie. "I OSK 2104/21" dalo na drugim miejscu II OSK 2104/25:
 * bliski falszywy trop, dokladnie mechanizm, ktorym model halucynuje orzeczenie.
 *
 * Ksztalt w korpusie jest staly: tytul orzeczenia zaczyna sie sygnatura
 * WERSALIKAMI, potem " (" i rodzaj ("V ACA 908/13 (wyrok, sąd powszechny)",
 * "III SA/WA 2809/25 (Wyrok WSA w Warszawie)", "KIO 3088/24 (orzeczenie KIO)").
 * Zmierzone w czterech zrodlach orzeczen.
 *
 * Wzor z aws/context-ontology-accelerator (grounding.py, Apache-2.0): dopasowanie
 * dokladne jest OSOBNYM stopniem, a jego brak ma byc nazwany, nie zasypany
 * najlepszym z przyblizonych.
 */
export const LITERY_SYG = "A-ZĄĆĘŁŃÓŚŹŻ";
export const WZOR_SYGNATURY = new RegExp(
  `(?:^|[\\s(,;:])((?:[IVX]{1,5}\\s+)?[${LITERY_SYG}]{1,6}(?:\\s*/\\s*[${LITERY_SYG}]{1,3})?`
  + `\\s+\\d{1,6}\\s*/\\s*(?:\\d{4}|\\d{2}))(?=$|[\\s),;:.])`, "g");
// Litery, ktore stoja przed "liczba/liczba", a NIE sa repertorium sadu: "art. 12/3",
// "poz. 104/26", "nr 88/2020", "ust. 2/3". Bez tej listy adres przepisu udawalby sygnature.
export const NIE_REPERTORIUM = new Set(["ART", "POZ", "NR", "UST", "PKT", "LIT", "PAR",
  "DZ", "DZU", "MP", "TJ", "ZM", "R", "ROK", "STR", "S", "T", "Z", "W", "DO", "OD", "NA"]);

/** Sygnatura bez ozdob - ta sama funkcja po stronie zapytania i tytulu. */
export function normSygnatury(s: string): string {
  return String(s ?? "").toUpperCase().replace(/ /g, " ").replace(/\./g, "")
    .replace(/\s*\/\s*/g, "/").replace(/\s+/g, " ").trim();
}

/**
 * Zapytanie BEZ sygnatur - wejscie dla rozpoznawania przepisu.
 *
 * 🔴 Zmierzone po wdrozeniu sciezki sygnatury: "IV KK 168/22"
 * oddawalo na PIERWSZYM miejscu art. 168 Kodeksu karnego, bo rozpoznawanie przepisu
 * czytalo "KK 168" wewnatrz sygnatury jako "art. 168 k.k.". Sygnatura jest
 * identyfikatorem orzeczenia - jej czesci nie sa adresem przepisu.
 */
export function bezSygnatur(zapytanie: string): string {
  const wz = new RegExp(WZOR_SYGNATURY.source, "gi");
  return String(zapytanie ?? "").replace(wz, (cale: string, syg: string) => {
    const litery = normSygnatury(syg).replace(/^[IVX]{1,5}\s+/, "").split(/[\s/]/)[0];
    return NIE_REPERTORIUM.has(litery) ? cale : cale.replace(syg, " ");
  });
}

/**
 * Czy zapytanie pyta o PRZEPIS albo o KODEKS - i o ktory.
 *
 * Powod: ani "392 kc", ani "Art. 392 kodeksu cywilnego" potraktowane jak slowa nie
 * zwraca Kodeksu cywilnego, bo wyszukiwanie widzi tylko WORKI SLOW: "392" trafia w
 * akty o numerze 392, a "kodeks cywilny" tonie w milionach orzeczen, ktore te dwa slowa
 * cytuja. Numer artykulu i skrot kodeksu to nie slowa do bm25, to ADRES.
 *
 * Zwraca `null`, gdy zadnego kodeksu nie widac - wtedy nic nie zmieniamy.
 * `artykul` moze byc `null` ("kodeks cywilny" bez numeru), co znaczy: oddaj sam akt.
 */
export function rozpoznajPrzepis(zapytanie: string):
    { akt: string; nazwa: string; artykul: string | null } | null {
  const q = " " + zapytanie.toLowerCase().replace(/\u00a0/g, " ") + " ";
  // \ud83d\udd34 WYGRYWA DOPASOWANIE NAJDLUZSZE, NIE PIERWSZE NA LISCIE (23.09). Petla
  // brala pierwsze trafienie, wiec o wyniku decydowala KOLEJNOSC WPISOW, a nie
  // tresc pytania - i myli\u0142a akty po cichu:
  //   * "kodeks karny skarbowy" pasuje tez do wzorca Kodeksu karnego;
  //   * ustawa o ochronie praw lokatorow ma w TYTULE "o zmianie Kodeksu
  //     cywilnego", wiec pytanie jej tytulem oddawalo Kodeks cywilny.
  // Dlugosc dopasowania jest miara SZCZEGOLOWOSCI: "kodeks karny skarbowy"
  // (21 znakow) bije "kodeks karny" (12). Skrot ("k.k.s.") jest wskazaniem
  // WPROST, wiec liczy sie jak dopasowanie o dlugosci calego zapytania.
  let trafiony: { id: string; nazwa: string } | null = null;
  let najlepsze = 0;
  for (const kod of KODEKSY) {
    // Skrot MUSI stac osobno: "kp" nie moze sie znalezc w "kpc" ani w "sklep".
    // Kropki w "k.c." sa opcjonalne, bo prawnicy pisza oba warianty.
    const zeSkrotu = kod.skroty.some((s) => {
      const litery = s.split("").join("\\.?");
      // Cyfra przed skrotem tez sie liczy: "392kc" bez spacji (22.09).
      return new RegExp(`[\\s(,;\\d]${litery}\\.?[\\s),;.]`).test(q);
    });
    let dlugosc = zeSkrotu ? q.length : 0;
    for (const w of kod.wzorce) {
      const m = w.exec(q);
      if (m && m[0].length > dlugosc) dlugosc = m[0].length;
    }
    if (dlugosc > najlepsze) { najlepsze = dlugosc; trafiony = kod; }
  }
  if (!trafiony) return null;
  // "art. 392", "artykul 392", "art 392a" albo samo "392 kc".
  //
  // 🔴 INDEKS GORNY (21.09): "art. 584^2", "584²", "584(2)", "584^{2}". Bez tego
  // "art. 584^2 ksh" rozpoznawal sie jako art. 584 - INNY przepis, oddany po
  // cichu jako trafienie pod adresem. Zapis kanoniczny: "584^2".
  const m = q.match(/art(?:ykul|ykuł)?\.?\s*(\d{1,4}[a-z]{0,3})(?:\s*(?:\^\{?|\()\s*(\d{1,2})\s*[})]?|([¹²³⁴⁵⁶⁷⁸⁹⁰]{1,2}))?/)
    ?? q.match(/(?:^|[\s(])(\d{1,4}[a-z]{0,3})(?:\s*(?:\^\{?|\()\s*(\d{1,2})\s*[})]?|([¹²³⁴⁵⁶⁷⁸⁹⁰]{1,2}))?\s*(?:k\.?c|k\.?p\.?c|k\.?k|k\.?p\.?k|k\.?s\.?h|k\.?p\.?a|k\.?p|k\.?r\.?o|k\.?w|o\.?p)\b/);
  if (!m) return { akt: trafiony.id, nazwa: trafiony.nazwa, artykul: null };
  const indeks = m[2] ?? (m[3] ? zIndeksuGornego(m[3]) : null);
  // 🔴 LITERY W NUMERZE (22.09): "art. 611tn k.p.k." dawalo art. 611t - INNY
  // przepis, po cichu - bo wzorzec znal jedna litere. Dopuszczamy do trzech;
  // gdy "litery" sa w istocie doklejonym skrotem kodeksu ("392kc"), odpadaja.
  const nrM = /^(\d+)([a-z]*)$/.exec(m[1]);
  const numer = nrM && SKROTY_KODEKSOW.has(nrM[2]) ? nrM[1] : m[1];
  return { akt: trafiony.id, nazwa: trafiony.nazwa,
           artykul: indeks ? `${numer}^${indeks}` : numer };
}

/**
 * NAZWA USTAWY w zapytaniu, gdy nie ma jej na liscie KODEKSY.
 *
 * 🔴 SKAD (23.09). Adres przepisu dziala przez liste aktow wolanych nazwa. Pomiar na
 * rankingu powolan z korpusu: lista lapie mniej niz polowe ustaw, ktore orzeczenia
 * realnie cytuja. Ogona nie da sie dogonic recznie,
 * a tytul ustawy lezy w korpusie. Zwracamy FRAZE TYTULOWA i numer artykulu;
 * dopasowaniem do konkretnego aktu zajmuje sie warstwa, ktora ma dostep do
 * korpusu (nazwa z zapytania to jeszcze nie akt).
 *
 * Bez numeru artykulu zwracamy `null`: pytanie tematyczne o ustawe obsluguje
 * slot ustawowy, ktory patrzy na TRESC, a nie sam tytul.
 */
export function nazwaUstawyZZapytania(zapytanie: string):
    { fraza: string; artykul: string | null; typ: "ustawa" | "prawo"; goly?: boolean } | null {
  const q = String(zapytanie ?? "").toLowerCase().replace(/ /g, " ");
  const a = q.match(/art(?:ykul|ykuł)?\.?\s*(\d{1,4}[a-z]{0,3})/);
  // 🔴 SAMA NAZWA USTAWY TEZ JEST ADRESEM. Gola nazwa ("ustawa o muzeach", "Prawo
  // o stowarzyszeniach tekst jednolity 2020") potraktowana jak slowa oddaje akt
  // TRZECI i w tekscie PIERWOTNYM albo wcale. Bez numeru artykulu
  // oddajemy fraze tylko wtedy, gdy zapytanie ZACZYNA SIE od nazwy aktu - czy to
  // sama nazwa, czy nazwa z tematem, rozstrzyga pozniej pokrycie TYTULU (temat
  // nie stoi w tytule, wiec taki kandydat odpada na progu).
  const goly = !a && /^\s*(ustaw\S*|praw[oa])\s/.test(q);
  if (!a && !goly) return null;
  // "tekst jednolity", rok i pozycja Dziennika opisuja WYDANIE aktu, nie jego nazwe.
  const bezWydania = (s: string) => s
    .replace(/\b(obwieszczeni\S*|tekst\S*\s+jednolit\S*|jednolit\S*\s+tekst\S*)/g, " ")
    .replace(/\bdz\.?\s*u\.?.*$/, " ").replace(/\b(19|20)\d{2}\b/g, " ")
    .replace(/\s+/g, " ").trim();
  // "ustawy o ochronie zabytkow", "ustawa o odpadach" - fraza po "o".
  // "prawa energetycznego", "prawo budowlane" - nazwa wlasna po "prawo".
  const zUstawy = q.match(
    /ustaw\S*\s+(?:z\s+dnia\s+[^,]{0,40}?\s+)?o\s+([a-ząćęłńóśżź][^,;.()]{5,90})/);
  // "Prawo o adwokaturze", "Prawo o ustroju sadow administracyjnych" - po
  // "prawo" bywa jeszcze "o", ktore samo w sobie nie jest nazwa (23.09).
  const zPrawa = zUstawy ? null
    : q.match(/praw\S*\s+(?:o\s+)?([a-ząćęłńóśżź]{5,}\S*(?:\s+[a-ząćęłńóśżź]{4,}\S*){0,2})/);
  const m = zUstawy ?? zPrawa;
  if (!m) return null;
  const fraza = bezWydania(m[1].replace(/\s+/g, " ").trim());
  if (fraza.length < 5) return null;
  // "art. 5 ustawy o zmianie ustawy o ..." - nowelizacje wolamy numerem, nie nazwa.
  if (/^zmianie\b/.test(fraza)) return null;
  if (!a) return { fraza, artykul: null, typ: zUstawy ? "ustawa" : "prawo", goly: true };
  const nrM = /^(\d+)([a-z]*)$/.exec(a[1]);
  const numer = nrM && SKROTY_KODEKSOW.has(nrM[2]) ? nrM[1] : a[1];
  return { fraza, artykul: numer, typ: zUstawy ? "ustawa" : "prawo" };
}

/** Skroty kodeksow, ktore moga przykleic sie do numeru artykulu ("392kc"). */
export const SKROTY_KODEKSOW = new Set(["kc", "kpc", "kk", "kpk", "ksh", "kpa", "kp", "kro",
                                 "kw", "op", "kkw"]);

/** "²" -> "2", "¹³" -> "13". */
export function zIndeksuGornego(s: string): string {
  const MAPA: Record<string, string> = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4",
    "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9" };
  return s.split("").map((c) => MAPA[c] ?? "").join("");
}


// ======================================================= WERYFIKACJA PISMA (26.09)

/**
 * Cytat wydobyty z PISMA - calego tekstu, nie z zapytania.
 *
 * 🔴 PO CO. Sankcje za zmyslone cytaty dotycza dzis calych pism, a nie pojedynczych
 * zapytan: prawnik ma tekst z modelu albo pismo przeciwnika i chce wiedziec, KTORE
 * z powolan maja pokrycie. Zapytanie rozpoznaje najwyzej trzy sygnatury i jeden
 * przepis - pismo ma ich dziesiatki. Ten ekstraktor idzie po calym tekscie tymi samymi wzorcami, ktorych uzywa wyszukiwanie (jedno
 * zrodlo prawdy o ksztalcie sygnatury i adresu), i zapamietuje OFFSET kazdego
 * cytatu, zeby wynik dal sie odnalezc w pismie.
 *
 * Czego NIE robi: nie ocenia, czy teza pisma zgadza sie z orzeczeniem. Oddaje
 * stan powolania w korpusie - to jest dowod, a nie opinia.
 */
export type CytatZPisma =
  | { typ: "sygnatura"; tekst: string; offset: number; wystapien: number;
      sygnatura: string; warianty: string[]; data_w_pismie: string | null }
  | { typ: "przepis"; tekst: string; offset: number; wystapien: number;
      akt: string; nazwa: string; artykul: string | null }
  | { typ: "akt_nierozpoznany"; tekst: string; offset: number; wystapien: number;
      fraza: string; artykul: string | null };

export const MAKS_ZNAKOW_PISMA = 64000;

//: Litery przed "liczba/liczba", ktore w PISMIE (nie w zapytaniu) nie sa repertorium:
//: kwoty, tomy, karty akt. Bez tego "zł 100/200" szloby do korpusu jako sygnatura
//: i wracalo jako "nie ma w korpusie" - falszywy alarm o halucynacji.
const NIE_REPERTORIUM_PISMA = new Set(["ZŁ", "ZL", "PLN", "EUR", "USD", "GBP", "TOM",
  "KS", "CZ", "RYS", "TAB", "GODZ", "KART", "STRON", "DZIENNIK"]);

const MIESIACE: Record<string, string> = {
  stycznia: "01", lutego: "02", marca: "03", kwietnia: "04", maja: "05", czerwca: "06",
  lipca: "07", sierpnia: "08", "września": "09", wrzesnia: "09", "października": "10",
  pazdziernika: "10", listopada: "11", grudnia: "12",
};

/**
 * Data orzeczenia podana w pismie TUZ PRZED albo TUZ PO sygnaturze ("wyrok SN z dnia
 * 12 marca 2024 r., II CSKP 1/24", "II CSKP 1/24 z 12.03.2024"). Wlasciwa sygnatura
 * z ZLA data to klasyczny slad modelu, ktory zlozyl cytat z dwoch prawdziwych
 * kawalkow - dlatego porownujemy ja z data dokumentu w korpusie.
 */
export function dataPrzySygnaturze(tekst: string, offset: number, dlugosc: number): string | null {
  const przedOryg = tekst.slice(Math.max(0, offset - 70), offset);
  const przed = przedOryg.toLowerCase();
  const po = tekst.slice(offset + dlugosc, offset + dlugosc + 40).toLowerCase();
  const slowna = /(\d{1,2})\s+(stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|wrze[sś]nia|pa[zź]dziernika|listopada|grudnia)\s+(\d{4})/g;
  const liczbowa = /\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/g;
  const zbierz = (s: string) => {
    const w: { data: string; i: number }[] = [];
    for (const m of s.matchAll(slowna))
      w.push({ data: `${m[3]}-${MIESIACE[m[2]] ?? "00"}-${m[1].padStart(2, "0")}`, i: m.index ?? 0 });
    for (const m of s.matchAll(liczbowa))
      w.push({ data: `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`, i: m.index ?? 0 });
    return w;
  };
  // Przed sygnatura bierzemy NAJBLIZSZA (ostatnia), po sygnaturze - pierwsza.
  // Tylko z tego samego zdania: kropka albo srednik, po ktorych stoi WIELKA litera
  // (poza "Sygn."), to granica zdania - data sprzed niej dotyczy czego innego.
  const p = zbierz(przed).sort((a, b) => b.i - a.i)[0];
  // 🔴 Miedzy data a sygnatura nie moze stac INNA sygnatura ("z dnia 13 maja 2022 r.,
  // II CSKP 293/22, z dnia 202 2 r., II CSKP 464/22" - data rozbita przez PDF nie
  // rozpoznaje sie, a najblizsza data przed nalezy do POPRZEDNIEGO cytatu).
  // Wyjatek: LANCUCH pod jedna data - "z dnia 21 listopada 2023 r., II CSKP 1675/22
  // i II CSKP 701/23" (takze z "niepubl." po drodze) - data obejmuje obie sygnatury.
  const poDacie = przedOryg.slice(p ? p.i : 0).replace(/^\d{1,2}\.\d{1,2}\.\d{4}/, "")
    .replace(/(?:[IVX]{1,5}\s+)?[A-ZĄĆĘŁŃÓŚŹŻ]{1,6}(?:\s*\/\s*[A-Za-z]{1,3})?\s+\d{1,6}\s*\/\s*\d{2,4}\s*,?\s*(?:niepubl\.?,?\s*)?(?:i|oraz)\s+$/, "");
  if (p && !/[.;]\s+(?!Sygn)[A-ZĄĆĘŁŃÓŚŹŻ]/.test(poDacie) && !/\d\s*\/\s*\d{2}/.test(poDacie))
    return p.data;
  // Data PO sygnaturze tylko bez przecinka i srednika po drodze: "(postanowienie SN
  // z 5.06.2023)" - tak; "II CSK 483/18, niepubl., z dnia 10 maja 2022 r." - NIE, to
  // data NASTEPNEGO cytatu (zmierzone 26.09 na publicznym wyroku SN II CSKP 832/24).
  const n = zbierz(po).sort((a, b) => a.i - b.i)[0];
  return n && n.i < 30 && !/[,;]/.test(po.slice(0, n.i)) ? n.data : null;
}

/**
 * Warianty sygnatury z PRZESTAWIONYMI sasiednimi literami repertorium ("II CKSP 820/23"
 * -> "II CSKP 820/23"). Zmierzone 26.09 na publicznym wyroku SN II CSKP 832/24: tylko
 * powolania z dokladnie ta literowka nie istnialy w korpusie. Numer
 * rzymski i numer sprawy zostaja NIETKNIETE: inny wydzial albo inna liczba to inna
 * sprawa, a nie literowka.
 */
export function wariantyLiterowek(sygnatura: string): string[] {
  const m = /^((?:[IVX]{1,5}\s+)?)([A-ZĄĆĘŁŃÓŚŹŻ]{2,6})((?:\/[A-ZĄĆĘŁŃÓŚŹŻ]{1,3})?\s+\d{1,6}\/\d{2,4})$/
    .exec(normSygnatury(sygnatura));
  if (!m) return [];
  const litery = m[2];
  const wynik = new Set<string>();
  for (let i = 0; i + 1 < litery.length; i += 1) {
    const a = litery.split("");
    [a[i], a[i + 1]] = [a[i + 1], a[i]];
    const v = a.join("");
    if (v !== litery) wynik.add(m[1] + v + m[3]);
  }
  return [...wynik].slice(0, 4);
}

/**
 * Wszystkie cytaty z pisma: sygnatury orzeczen, przepisy kodeksow i ustaw z listy
 * KODEKSY, przepisy z adresem w Dzienniku, i przepisy ustaw spoza listy (te NAZWANE
 * jako nierozpoznane, a nie pominiete). Najwyzej `maks` pozycji; reszta jest
 * policzona w `pominietych`, nie zgubiona.
 *
 * Gole "art. 5" bez zadnego aktu w poblizu nie jest cytatem, ktory da sie sprawdzic
 * (to zwykle "tej ustawy" z kontekstu) - liczymy je w `bez_aktu`.
 */
export function cytatyZPisma(tekstWejscia: string, maks = 25):
    { cytaty: CytatZPisma[]; pominietych: number; bez_aktu: number; przycieto: boolean } {
  const surowy = String(tekstWejscia ?? "");
  const przycieto = surowy.length > MAKS_ZNAKOW_PISMA;
  // Zamiana twardej spacji zachowuje DLUGOSC - offsety zostaja offsetami pisma.
  const t = surowy.slice(0, MAKS_ZNAKOW_PISMA).replace(/ /g, " ");
  const wszystkie: CytatZPisma[] = [];
  const klucze = new Map<string, CytatZPisma>();
  const dodaj = (klucz: string, c: CytatZPisma) => {
    const byl = klucze.get(klucz);
    if (byl) {
      byl.wystapien += 1;
      // Pierwsze wystapienie bez daty (np. rozbitej przez PDF: "202 2 r.") nie moze
      // zaslonic pozniejszego z data.
      if (byl.typ === "sygnatura" && c.typ === "sygnatura" && !byl.data_w_pismie)
        byl.data_w_pismie = c.data_w_pismie;
      return;
    }
    klucze.set(klucz, c);
    wszystkie.push(c);
  };

  // --- 1. Sygnatury. Wersaliki nie zmieniaja dlugosci polskiego tekstu.
  const U = " " + t.toUpperCase() + " ";
  for (const m of U.matchAll(new RegExp(WZOR_SYGNATURY.source, "g"))) {
    const surowa = m[1];
    let s = normSygnatury(surowa);
    const litery = s.replace(/^[IVX]{1,5}\s+/, "").split(/[\s/]/)[0];
    if (NIE_REPERTORIUM.has(litery) || NIE_REPERTORIUM_PISMA.has(litery)) continue;
    let offset = (m.index ?? 0) + m[0].indexOf(surowa) - 1;
    let dlugosc = surowa.length;
    // 🔴 SYGNATURA ROZBITA PRZEZ PDF ("II CSK P 1644/22" w wyroku SN, 26.09): wzorzec
    // bral "P 1644/22" - repertorium TK - i wracal "nie ma w korpusie". Gdy tuz przed
    // (bez numeru rzymskiego we wlasnym trafieniu) stoja wersaliki z numerem rzymskim,
    // sklejamy repertorium, o ile miesci sie w 6 literach.
    if (!/^[IVX]{1,5}\s/.test(s)) {
      const przed = U.slice(Math.max(0, offset + 1 - 16), offset + 1);
      const r = /(?:^|\s)([IVX]{1,5})\s+([A-ZĄĆĘŁŃÓŚŹŻ]{1,5})\s+$/.exec(przed);
      if (r && (r[2] + litery).length <= 6) {
        s = r[1] + " " + r[2] + s;
        const cofnij = r[0].length - (/^\s/.test(r[0]) ? 1 : 0);
        offset -= cofnij;
        dlugosc += cofnij;
      }
    }
    const r4 = s.match(/^(.*\/)((?:19|20)\d{2})$/);
    const warianty = r4 ? [r4[1] + r4[2].slice(2), s] : [s];
    dodaj("S|" + warianty[0], {
      typ: "sygnatura", tekst: t.slice(offset, offset + dlugosc), offset, wystapien: 1,
      sygnatura: warianty[0], warianty,
      data_w_pismie: dataPrzySygnaturze(t, offset, dlugosc),
    });
  }

  // --- 2. Przepisy. Okno od "art." do nastepnego "art.", srednika, konca wiersza
  // albo 160 znakow. Okno ucina NASTEPNY artykul - "art. 5 ustawy o X oraz art. 6
  // k.c." nie moze dac "art. 5 k.c.".
  const L = t.toLowerCase();
  const starty = [...L.matchAll(/(?<![a-ząćęłńóśżź])art(?:\.|ykuł\S*|ykul\S*)?\s*\d/g)]
    .map((m) => m.index ?? 0);
  let bezAktu = 0;
  let czekajace: { start: number; okno: string }[] = [];
  const wzorNumeru = /art(?:ykul\S*|ykuł\S*|\.)?\s*(\d{1,4}[a-z]{0,3}(?:\^\d{1,2})?)/;
  for (let n = 0; n < starty.length; n += 1) {
    const start = starty[n];
    const nastepny = starty[n + 1] ?? Infinity;
    let koniec = Math.min(start + 160, nastepny, t.length);
    // Srednik tak, koniec wiersza NIE: tekst z PDF lamie kazda linie ("Prawa\n\nbankowego",
    // "Prawo\n\n...Dz. U. z 2022 r., poz. 282") - ciecie na \n gubilo akt (26.09).
    const przerwa = L.slice(start, koniec).search(/;/);
    if (przerwa > 0) koniec = start + przerwa;
    const urwaneNastepnym = koniec === nastepny;
    // Sygnatura w oknie to identyfikator orzeczenia, nie adres ("IV KK 168/22" to nie k.k.).
    let okno = bezSygnatur(L.slice(start, koniec));
    // 🔴 INDEKS GORNY Z PDF (26.09, wyrok SN II CSKP 832/24): "art. 385 1 § 1 k.c.",
    // "art. 203 1 § 2 k.p.c.", "art. 398 13\n§ 2" - indeks spada do linii jako osobna
    // liczba. Bez tego wzorzec bral art. 385 zamiast 385^1: INNY przepis, po cichu.
    // Liczba 1-2 cyfrowa zaraz po numerze, przed jednostka, skrotem albo spojnikiem.
    const indeks = /^art(?:\.|ykuł\S*|ykul\S*)?\s*(\d{1,4}[a-z]{0,3})\s+(\d{1,2})(?=\s*(?:§|ust\.|pkt|k\.|kc\b|kpc\b|kk\b|w\s+zw|i\s|oraz\b|,|\)|$))/
      .exec(okno);
    if (indeks) okno = okno.replace(indeks[0], `art. ${indeks[1]}^${indeks[2]}`);
    const znaleziony = rozpoznajAdres(okno) ?? rozpoznajPrzepis(okno);
    const przepis = znaleziony && indeks
      ? { ...znaleziony, artykul: `${indeks[1]}^${indeks[2]}` } : znaleziony;
    if (przepis && przepis.artykul) {
      dodaj("P|" + przepis.akt + "|" + przepis.artykul, {
        typ: "przepis", tekst: t.slice(start, koniec).trim(), offset: start, wystapien: 1,
        akt: przepis.akt, nazwa: przepis.nazwa, artykul: przepis.artykul,
      });
      // Wyliczenie "art. 5 i art. 6 k.c.": poprzednie okna, urwane DOKLADNIE na
      // nastepnym artykule i bez wlasnego aktu, naleza do tego samego aktu.
      for (const c of czekajace) {
        const nr = c.okno.match(wzorNumeru);
        if (!nr) { bezAktu += 1; continue; }
        dodaj("P|" + przepis.akt + "|" + nr[1], {
          typ: "przepis", tekst: t.slice(c.start, c.start + c.okno.length).trim(),
          offset: c.start, wystapien: 1,
          akt: przepis.akt, nazwa: przepis.nazwa, artykul: nr[1],
        });
      }
      czekajace = [];
      continue;
    }
    const ustawa = nazwaUstawyZZapytania(okno);
    if (ustawa && ustawa.artykul) {
      bezAktu += czekajace.length;
      czekajace = [];
      dodaj("N|" + ustawa.fraza + "|" + ustawa.artykul, {
        typ: "akt_nierozpoznany", tekst: t.slice(start, koniec).trim(), offset: start,
        wystapien: 1, fraza: ustawa.fraza, artykul: ustawa.artykul,
      });
      continue;
    }
    // Ciag wyliczenia trwa tylko, dopoki okno jest urwane nastepnym artykulem I po
    // numerze stoja wylacznie jednostki i spojniki. 🔴 Bez drugiego warunku "art. 5
    // tej ustawy. Art. 229 k.p.a." dawalo art. 5 k.p.a. - cichy, falszywy przydzial.
    const reszta = okno.replace(wzorNumeru, "");
    const tylkoSpojniki = /^\s*(?:(?:§|ust\.|pkt|lit\.|zd\.)\s*\d*[a-z]?\s*)*(?:,|i|oraz|lub|albo|a\s+także|-|–|w\s+zw(?:\.|iązku)\s+z)?\s*$/
      .test(reszta);
    if (urwaneNastepnym && tylkoSpojniki) czekajace.push({ start, okno });
    else { bezAktu += czekajace.length + 1; czekajace = []; }
  }
  bezAktu += czekajace.length;

  wszystkie.sort((a, b) => a.offset - b.offset);
  return { cytaty: wszystkie.slice(0, maks), pominietych: Math.max(0, wszystkie.length - maks),
           bez_aktu: bezAktu, przycieto };
}
