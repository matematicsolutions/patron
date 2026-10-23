export const KODEKSY: Array<{ id: string; nazwa: string; skroty: string[]; wzorce: RegExp[] }> = [
  { id: "eli:DU/1964/93", nazwa: "Kodeks cywilny", skroty: ["kc"],
    wzorce: [/kodeks\S*\s+cywiln\S*/] },
  { id: "eli:DU/1964/296", nazwa: "Kodeks postepowania cywilnego", skroty: ["kpc"],
    wzorce: [/kodeks\S*\s+post\S*\s+cywiln\S*/] },
  { id: "eli:DU/1997/557", nazwa: "Kodeks karny wykonawczy", skroty: ["kkw"],
    wzorce: [/kodeks\S*\s+karn\S*\s+wykonawcz\S*/] },

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

export function rozpoznajAdres(zapytanie: string):
    { akt: string; nazwa: string; artykul: string | null } | null {
  const q = " " + zapytanie.toLowerCase().replace(/\u00a0/g, " ") + " ";
  const m = q.match(
    /(dz\.?\s*u|m\.?\s*p)\.?\s*(?:z\s*)?(\d{4})\s*(?:r\.?)?\s*,?\s*(?:nr\s*\d+\s*,?\s*)?poz\.?\s*(\d{1,5})/);
  if (!m) return null;
  const dziennik = m[1].replace(/[\s.]/g, "") === "dzu" ? "DU" : "MP";

  const art = q.match(WZOR_ARTYKULU);
  return { akt: `eli:${dziennik}/${m[2]}/${Number(m[3])}`,
           nazwa: `${dziennik} ${m[2]} poz. ${Number(m[3])}`, artykul: art ? artykulZDopasowania(art) : null };
}

const WZOR_ARTYKULU =
  /art(?:ykul|ykuł)?\.?\s*(\d{1,4}[a-z]{0,3})(?:\s*(?:\^\{?|\()\s*(\d{1,2})\s*[})]?|([¹²³⁴⁵⁶⁷⁸⁹⁰]{1,2}))?/;

function artykulZDopasowania(m: RegExpMatchArray): string {
  const indeks = m[2] ?? (m[3] ? zIndeksuGornego(m[3]) : null);
  const nrM = /^(\d+)([a-z]*)$/.exec(m[1]);
  const numer = nrM && SKROTY_KODEKSOW.has(nrM[2]) ? nrM[1] : m[1];
  return indeks ? `${numer}^${indeks}` : numer;
}

export const LITERY_SYG = "A-ZĄĆĘŁŃÓŚŹŻ";
export const WZOR_SYGNATURY = new RegExp(

  `(?:^|[\\s(,;:])((?:[IVXL]{1,8}\\s+)?[${LITERY_SYG}]{1,6}(?:\\s*/\\s*[${LITERY_SYG}]{1,3})?`
  + `\\s+\\d{1,6}\\s*/\\s*(?:\\d{4}|\\d{2}))(?=$|[\\s),;:.])`, "g");

export const NIE_REPERTORIUM = new Set(["ART", "POZ", "NR", "UST", "PKT", "LIT", "PAR",
  "DZ", "DZU", "MP", "TJ", "ZM", "R", "ROK", "STR", "S", "T", "Z", "W", "DO", "OD", "NA"]);

export const PREFIKSY_UOKIK = new Set(["DNR", "DKK", "DIH", "RKT", "RWR", "RKR", "RGD", "RPZ",
  "RŁO", "DOK", "RLU", "RWA", "RBG", "DDK", "DZP", "DDF", "DDI", "DOZIK", "DPI", "DAR", "DDP",
  "DWZ", "DDR", "DOIK", "DPK", "DUN", "DPR", "DPZ"]);
export const PREFIKSY_UODO = new Set(["DKE", "ZKE", "DKN", "ZSOŚS", "ZSZZS", "ZSPU", "DS", "ZSPR",
  "DOKE", "ZWAD", "ZWOS", "DWKSN"]);

const PREFIKSY_UOKIK_Z_KONTEKSTEM = new Set(["DZP", "DPR", "DPZ", "DPI"]);
const KONTEKST_UOKIK = /UOKIK|PREZES\S*\s+URZ[ĘE]DU|OCHRONY\s+KONKURENCJI|ANTYMONOPOL/;

const BEZ_OGONKOW_ORGANU: Record<string, string> = { RLO: "RŁO", ZSOSS: "ZSOŚS" };
const alternatywa = (s: Set<string>, ...dodatkowe: string[]) =>
  [...s, ...dodatkowe].sort((a, b) => b.length - a.length).join("|");

const WZOR_NUMERU_UOKIK = new RegExp(
  `(?:^|[\\s(,;:])((${alternatywa(PREFIKSY_UOKIK, "RLO")})(?:\\s*-\\s*(III|II|IV|I)(?=\\s*-))?`
  + `(?:\\s*-\\s*|\\s+)(\\d{1,4})(?:\\s*-\\s*(\\d{1,4}))?\\s*\\/\\s*((?:19|20)\\d{2}))(?=$|[\\s),;:.])`, "g");

const WZOR_ZNAKU_UODO = new RegExp(
  `(?:^|[\\s(,;:])((${alternatywa(PREFIKSY_UODO, "ZSOSS")})\\.(405|421|440|523|561|51\\d{2})`
  + `\\.(\\d{1,5}(?:\\.\\d{1,5})?)\\.((?:19|20)\\d{2})(?:\\.(III|II|IV|I)(?![${LITERY_SYG}]))?`
  + `((?:\\.[${LITERY_SYG}]{1,4})*))(?=$|[\\s),;:]|\\.(?=$|\\s))`, "g");

export type NumerDecyzji = { organ: "uokik" | "uodo"; numer: string; indeks: number; dlugosc: number };

export function numeryDecyzji(tekst: string, bezKontekstu = false): NumerDecyzji[] {
  const U = " " + String(tekst ?? "").toUpperCase().replace(/ /g, " ") + " ";
  const wynik: NumerDecyzji[] = [];
  const pozycja = (m: RegExpMatchArray) => (m.index ?? 0) + m[0].indexOf(m[1]) - 1;
  for (const m of U.matchAll(WZOR_NUMERU_UOKIK)) {

    if (!/-/.test(m[1].slice(m[2].length).trimStart().charAt(0))
        && /(?:^|[\s(,;:])[IVXL]{1,8}\s+$/.test(U.slice(0, (m.index ?? 0) + m[0].indexOf(m[1]))))
      continue;
    const pref = BEZ_OGONKOW_ORGANU[m[2]] ?? m[2];
    if (m[5] && pref !== "DNR") continue;
    if (!bezKontekstu && PREFIKSY_UOKIK_Z_KONTEKSTEM.has(pref)
        && !KONTEKST_UOKIK.test(U.slice(Math.max(0, pozycja(m) + 1 - 160), pozycja(m) + 1))) continue;

    const bez0 = (s: string) => s.replace(/^0+(?=\d)/, "");
    wynik.push({ organ: "uokik", indeks: pozycja(m), dlugosc: m[1].length,
                 numer: `${pref}${m[3] ? "-" + m[3] : ""}-${bez0(m[4])}${m[5] ? "-" + bez0(m[5]) : ""}/${m[6]}` });
  }
  for (const m of U.matchAll(WZOR_ZNAKU_UODO)) {
    const pref = BEZ_OGONKOW_ORGANU[m[2]] ?? m[2];

    wynik.push({ organ: "uodo", indeks: pozycja(m), dlugosc: m[1].length,
                 numer: `${pref}.${m[3]}.${m[4]}.${m[5]}${m[6] ? "." + m[6] : ""}` });
  }
  return wynik.sort((a, b) => a.indeks - b.indeks);
}

export function kanonNumeruDecyzji(s: string): { organ: "uokik" | "uodo"; numer: string } | null {
  const t = String(s ?? "").trim();

  const n = numeryDecyzji(t, true);
  return n.length === 1 && n[0].indeks === 0 && n[0].dlugosc === t.length
    ? { organ: n[0].organ, numer: n[0].numer } : null;
}

export function literyNumeruDecyzji(sygnatura: string): boolean {
  const s = normSygnatury(sygnatura);
  if (/^[IVXL]{1,8}\s/.test(s)) return false;
  const litery = s.split(/[\s/]/)[0];
  return PREFIKSY_UOKIK.has(BEZ_OGONKOW_ORGANU[litery] ?? litery);
}

export function normSygnatury(s: string): string {
  return String(s ?? "").toUpperCase().replace(/ /g, " ").replace(/\./g, "")
    .replace(/\s*\/\s*/g, "/").replace(/\s+/g, " ").trim();
}

export function bezSygnatur(zapytanie: string): string {
  const wz = new RegExp(WZOR_SYGNATURY.source, "gi");

  let q = String(zapytanie ?? "");
  for (const n of numeryDecyzji(q).reverse())
    q = q.slice(0, n.indeks) + " ".repeat(n.dlugosc) + q.slice(n.indeks + n.dlugosc);
  return q.replace(wz, (cale: string, syg: string) => {
    const litery = normSygnatury(syg).replace(/^[IVXL]{1,8}\s+/, "").split(/[\s/]/)[0];
    return NIE_REPERTORIUM.has(litery) ? cale : cale.replace(syg, " ");
  });
}

const FRAZA_KODEKSU_ETYKI = new RegExp(
  "(?:kodeks\\S*|zbi[o\u00f3]r\\S*\\s+zasad|zasad\\S*)\\s+etyki(?:\\s+zawodow\\S*)?"
  + "(?:\\s+(?:radc|adwokac|notari|komornik|lekar|doradc|rzecznik|bieg\u0142|biegl)\\S*)?"
  + "(?:\\s+(?:prawn|s\u0105dow|sadow|podatkow|patentow|rewident)\\S*)?"
  + "(?:\\s+i\\s+godno\\S*\\s+zawodu)?"

  + "|regulamin\\S*\\s+wykonywania\\s+zawodu(?:\\s+(?:radc\\S*\\s+prawn\\S*|adwokat\\S*))?"
  + "|(?<![a-z\u0105\u0107\u0119\u0142\u0144\u00f3\u015b\u017c\u017a])(?:kerp|kea)(?![a-z\u0105\u0107\u0119\u0142\u0144\u00f3\u015b\u017c\u017a])", "g");
export function bezKodeksowEtyki(q: string): string {
  return q.replace(FRAZA_KODEKSU_ETYKI, (m) => " ".repeat(m.length));
}

export function rozpoznajPrzepis(zapytanie: string):
    { akt: string; nazwa: string; artykul: string | null } | null {
  const q = bezKodeksowEtyki(" " + zapytanie.toLowerCase().replace(/\u00a0/g, " ") + " ");

  const art = WZOR_ARTYKULU.exec(q);
  const przyNumerze = (start: number, koniec: number): boolean => {
    if (!art) return false;

    if (/zmian\S*\s+(?:\S+\s+)?$/.test(q.slice(Math.max(0, start - 16), start))) return false;
    const artKoniec = art.index + art[0].length;
    if (koniec <= art.index && art.index - koniec <= 3) return true;
    if (start >= artKoniec) {
      const luka = q.slice(artKoniec, start);
      return luka.length <= 30 && /^(?:\s|§|\d|[a-z](?=\)|\s)|ust\.?|pkt|lit\.?|zd\.?|zdanie|[.,()])*$/.test(luka);
    }
    return false;
  };
  let trafiony: { id: string; nazwa: string } | null = null;
  let najlepsze = 0;
  let trafionyPrzy: { id: string; nazwa: string } | null = null;
  let najlepszePrzy = 0;
  for (const kod of KODEKSY) {

    let przy = 0;
    const zeSkrotu = kod.skroty.some((s) => {
      const litery = s.split("").join("\\.?");

      const wz = new RegExp(`[\\s(,;\\d]${litery}\\.?[\\s),;.]`, "g");
      let jest = false;
      for (const m of q.matchAll(wz)) {
        jest = true;
        if (przyNumerze(m.index! + 1, m.index! + m[0].length - 1)) przy = q.length;
      }
      return jest;
    });
    let dlugosc = zeSkrotu ? q.length : 0;
    for (const w of kod.wzorce) {
      const m = w.exec(q);
      if (m && m[0].length > dlugosc) dlugosc = m[0].length;
      if (m && przyNumerze(m.index, m.index + m[0].length) && m[0].length > przy) przy = m[0].length;
    }
    if (dlugosc > najlepsze) { najlepsze = dlugosc; trafiony = kod; }
    if (przy > najlepszePrzy) { najlepszePrzy = przy; trafionyPrzy = kod; }
  }
  if (trafionyPrzy) trafiony = trafionyPrzy;
  if (!trafiony) return null;

  const m = q.match(WZOR_ARTYKULU)
    ?? q.match(/(?:^|[\s(])(\d{1,4}[a-z]{0,3})(?:\s*(?:\^\{?|\()\s*(\d{1,2})\s*[})]?|([¹²³⁴⁵⁶⁷⁸⁹⁰]{1,2}))?\s*(?:k\.?c|k\.?p\.?c|k\.?k|k\.?p\.?k|k\.?s\.?h|k\.?p\.?a|k\.?p|k\.?r\.?o|k\.?w|o\.?p)\b/);
  if (!m) return { akt: trafiony.id, nazwa: trafiony.nazwa, artykul: null };
  return { akt: trafiony.id, nazwa: trafiony.nazwa, artykul: artykulZDopasowania(m) };
}

export function nazwaUstawyZZapytania(zapytanie: string):
    { fraza: string; artykul: string | null; typ: "ustawa" | "prawo"; goly?: boolean } | null {
  const q = bezKodeksowEtyki(String(zapytanie ?? "").toLowerCase().replace(/ /g, " "));
  const a = q.match(/art(?:ykul|ykuł)?\.?\s*(\d{1,4}[a-z]{0,3})/);

  const goly = !a && /^\s*(ustaw\S*|praw[oa])\s/.test(q);
  if (!a && !goly) return null;

  const bezWydania = (s: string) => s
    .replace(/\b(obwieszczeni\S*|tekst\S*\s+jednolit\S*|jednolit\S*\s+tekst\S*)/g, " ")
    .replace(/\bdz\.?\s*u\.?.*$/, " ").replace(/\b(19|20)\d{2}\b/g, " ")
    .replace(/\s+/g, " ").trim();

  const zUstawy = q.match(
    /ustaw\S*\s+(?:z\s+dnia\s+[^,]{0,40}?\s+)?o\s+([a-ząćęłńóśżź][^,;.()]{5,90})/);

  const zPrawa = zUstawy ? null
    : q.match(/praw\S*\s+(?:o\s+)?([a-ząćęłńóśżź]{5,}\S*(?:\s+[a-ząćęłńóśżź]{4,}\S*){0,2})/);
  const m = zUstawy ?? zPrawa;
  if (!m) return null;
  const fraza = bezWydania(m[1].replace(/\s+/g, " ").trim());
  if (fraza.length < 5) return null;

  if (/^zmianie\b/.test(fraza)) return null;
  if (!a) return { fraza, artykul: null, typ: zUstawy ? "ustawa" : "prawo", goly: true };
  const nrM = /^(\d+)([a-z]*)$/.exec(a[1]);
  const numer = nrM && SKROTY_KODEKSOW.has(nrM[2]) ? nrM[1] : a[1];
  return { fraza, artykul: numer, typ: zUstawy ? "ustawa" : "prawo" };
}

export const SKROTY_KODEKSOW = new Set(["kc", "kpc", "kk", "kpk", "ksh", "kpa", "kp", "kro",
                                 "kw", "op", "kkw"]);

export function zIndeksuGornego(s: string): string {
  const MAPA: Record<string, string> = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4",
    "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9" };
  return s.split("").map((c) => MAPA[c] ?? "").join("");
}

export type CytatZPisma =
  | { typ: "sygnatura"; tekst: string; offset: number; wystapien: number;
      sygnatura: string; warianty: string[]; data_w_pismie: string | null;
      organ?: "uokik" | "uodo" }
  | { typ: "przepis"; tekst: string; offset: number; wystapien: number;
      akt: string; nazwa: string; artykul: string | null }
  | { typ: "akt_nierozpoznany"; tekst: string; offset: number; wystapien: number;
      fraza: string; artykul: string | null };

export const MAKS_ZNAKOW_PISMA = 64000;

const NIE_REPERTORIUM_PISMA = new Set(["ZŁ", "ZL", "PLN", "EUR", "USD", "GBP", "TOM",
  "KS", "CZ", "RYS", "TAB", "GODZ", "KART", "STRON", "DZIENNIK"]);

const MIESIACE: Record<string, string> = {
  stycznia: "01", lutego: "02", marca: "03", kwietnia: "04", maja: "05", czerwca: "06",
  lipca: "07", sierpnia: "08", "września": "09", wrzesnia: "09", "października": "10",
  pazdziernika: "10", listopada: "11", grudnia: "12",
};

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

  const p = zbierz(przed).sort((a, b) => b.i - a.i)[0];

  const poDacie = przedOryg.slice(p ? p.i : 0).replace(/^\d{1,2}\.\d{1,2}\.\d{4}/, "")
    .replace(/(?:[IVXL]{1,8}\s+)?[A-ZĄĆĘŁŃÓŚŹŻ]{1,6}(?:\s*\/\s*[A-Za-z]{1,3})?\s+\d{1,6}\s*\/\s*\d{2,4}\s*,?\s*(?:niepubl\.?,?\s*)?(?:i|oraz)\s+$/, "");
  if (p && !/[.;]\s+(?!Sygn)[A-ZĄĆĘŁŃÓŚŹŻ]/.test(poDacie) && !/\d\s*\/\s*\d{2}/.test(poDacie))
    return p.data;

  const n = zbierz(po).sort((a, b) => a.i - b.i)[0];
  return n && n.i < 30 && !/[,;]/.test(po.slice(0, n.i)) ? n.data : null;
}

export function wariantyLiterowek(sygnatura: string): string[] {
  const m = /^((?:[IVXL]{1,8}\s+)?)([A-ZĄĆĘŁŃÓŚŹŻ]{2,6})((?:\/[A-ZĄĆĘŁŃÓŚŹŻ]{1,3})?\s+\d{1,6}\/\d{2,4})$/
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

export function cytatyZPisma(tekstWejscia: string, maks = 25):
    { cytaty: CytatZPisma[]; pominietych: number; bez_aktu: number; przycieto: boolean } {
  const surowy = String(tekstWejscia ?? "");
  const przycieto = surowy.length > MAKS_ZNAKOW_PISMA;

  const t = surowy.slice(0, MAKS_ZNAKOW_PISMA).replace(/ /g, " ");
  const wszystkie: CytatZPisma[] = [];
  const klucze = new Map<string, CytatZPisma>();
  const dodaj = (klucz: string, c: CytatZPisma) => {
    const byl = klucze.get(klucz);
    if (byl) {
      byl.wystapien += 1;

      if (byl.typ === "sygnatura" && c.typ === "sygnatura" && !byl.data_w_pismie)
        byl.data_w_pismie = c.data_w_pismie;
      return;
    }
    klucze.set(klucz, c);
    wszystkie.push(c);
  };

  const U = " " + t.toUpperCase() + " ";
  for (const m of U.matchAll(new RegExp(WZOR_SYGNATURY.source, "g"))) {
    const surowa = m[1];
    let s = normSygnatury(surowa);
    const litery = s.replace(/^[IVXL]{1,8}\s+/, "").split(/[\s/]/)[0];
    if (NIE_REPERTORIUM.has(litery) || NIE_REPERTORIUM_PISMA.has(litery)) continue;
    if (literyNumeruDecyzji(s)) continue;
    let offset = (m.index ?? 0) + m[0].indexOf(surowa) - 1;
    let dlugosc = surowa.length;

    if (!/^[IVXL]{1,8}\s/.test(s)) {
      const przed = U.slice(Math.max(0, offset + 1 - 16), offset + 1);
      const r = /(?:^|\s)([IVXL]{1,8})\s+([A-ZĄĆĘŁŃÓŚŹŻ]{1,5})\s+$/.exec(przed);
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

  for (const n of numeryDecyzji(t))
    dodaj("S|" + n.numer, {
      typ: "sygnatura", tekst: t.slice(n.indeks, n.indeks + n.dlugosc), offset: n.indeks,
      wystapien: 1, sygnatura: n.numer, warianty: [n.numer], organ: n.organ,
      data_w_pismie: dataPrzySygnaturze(t, n.indeks, n.dlugosc),
    });

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

    const przerwa = L.slice(start, koniec).search(/;/);
    if (przerwa > 0) koniec = start + przerwa;
    const urwaneNastepnym = koniec === nastepny;

    let okno = bezSygnatur(L.slice(start, koniec));

    const indeks = /^art(?:\.|ykuł\S*|ykul\S*)?\s*(\d{1,4}[a-z]{0,3})\s+(\d{1,2})(?=\s*(?:§|ust\.|pkt|k\.|kc\b|kpc\b|kk\b|w\s+zw|i\s|oraz\b|,|\)|$))/
      .exec(okno);

    if (indeks) okno = okno.replace(indeks[0], `art. ${indeks[1]}^${indeks[2]}`);
    const przepis = rozpoznajAdres(okno) ?? rozpoznajPrzepis(okno);
    if (przepis && przepis.artykul) {
      dodaj("P|" + przepis.akt + "|" + przepis.artykul, {
        typ: "przepis", tekst: t.slice(start, koniec).trim(), offset: start, wystapien: 1,
        akt: przepis.akt, nazwa: przepis.nazwa, artykul: przepis.artykul,
      });

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
