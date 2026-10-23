// Bramka: KAZDE pole wchodzace do `computeAuditHash` musi miec DOKLADNIE JEDNEGO
// pisarza - `appendAuditEvent`. Jesli cokolwiek innego potrafi zmienic wartosc
// takiego pola juz po wstawieniu wiersza, lancuch zrywa sie bez niczyjej intencji,
// a `scripts/verify-audit-chain.ts` raportuje to SLOWO W SLOWO tak samo jak atak
// ("tresc wpisu zostala zmodyfikowana po wstawieniu").
//
// Powod istnienia, zmierzony 2026-09-03 przy czytaniu deeplethe/utopia:
//
//   1. `actor_user_id`, `chat_id`, `document_id` wchodza do hasha (audit.ts).
//   2. W schemacie Postgres wszystkie trzy sa kolumnami FK z `on delete set null`
//      (schema.sql, `create table ... public.audit_log`).
//   3. Wiec ZWYKLE usuniecie dokumentu przez `DELETE /single-documents/:id`
//      (routes/documents.ts) przepisuje `document_id` na NULL w kazdym wierszu
//      audytu dotyczacym tego dokumentu - i zrywa lancuch na kazdym z nich.
//   4. To samo robi `lib/rodo/forget.ts` (kasuje czaty i dokumenty) oraz
//      `scripts/rodo-delete.ts` (dodatkowo jawny UPDATE na audit_log).
//
// Dlaczego dotychczasowe bramki tego nie widzialy:
//   - `audit.test.ts` sprawdza ALGORYTM na fixture'ach w pamieci. Matematyka jest
//     poprawna; problem jest w tym, kto pisze do tabeli.
//   - test ADR-0061 dla `forgetCase` asercjonuje "audit_log count bez zmian".
//     I count JEST bez zmian - zaden wiersz nie znika. Zmieniaja sie wejscia do
//     hasha w wierszach, ktore zostaly. **Test mierzy nie te wielkosc, co trzeba.**
//
// Rozstrzygniecie: ADR-0164 (2026-09-09). Migracja 024 ZDEJMUJE te FK - rejestr
// append-only nie jest dzieckiem czatu ani dokumentu, a te kolumny to
// zdenormalizowany slad historyczny, ktory ma prawo wskazywac na obiekt juz
// nieistniejacy. Postgres dogonil warstwe SQLite, nie odwrotnie. Testy 2 i 3,
// czerwone od 2026-09-03, sa od tej migracji zielone.
//
// SCHEMAT TO JEDNAK TYLKO JEDEN Z DWOCH PISARZY - i to jest cala lekcja tego
// pliku. Drugim jest KOD: `scripts/rodo-delete.ts` przepisuje `actor_user_id`
// jawnym UPDATE-em, ktory idzie przez klient w ksztalcie Supabase, czyli dziala
// takze na SQLite - w produkcie, ktory wysylamy. Gdyby ta bramka konczyla sie
// na testach 2 i 3, naprawa schematu zapalilaby ja na zielono przy zywej luce.
// Dlatego test 5 trzyma REJESTR PISARZY z dokladnym licznikiem, a test 6 wiaze
// jedyne pozwolenie na UPDATE z obowiazkiem zadeklarowania skutku
// (`audit.chain.legal_break`). Bramka bez wlasnego mianownika daje spokoj,
// nie bezpieczenstwo.
//
// Konwencja parsowania luster schematu przejeta z `db/event-type-parity.test.ts`.

import { describe, it, expect, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { computeAuditHash, GENESIS_HASH } from "./audit";
import { SQLITE_SCHEMA } from "./db/schema.sqlite";

// Skan calego `backend/src` + `backend/scripts` to sekundy pracy I/O, a domyslny
// limit testu w vitest to 5 s. Pod rownoleglym obciazeniem maszyny bramka padala
// TIMEOUTEM, czyli swiecila na czerwono z powodu, ktory nie ma nic wspolnego
// z tym, co mierzy. Bramka czerwona bez powodu uczy ignorowac swoj kolor.
vi.setConfig({ testTimeout: 60_000 });

const BACKEND_ROOT = path.resolve(__dirname, "..", "..");
const PG_SCHEMA = readFileSync(path.join(BACKEND_ROOT, "schema.sql"), "utf8");

/**
 * Pola, ktore skladaja sie na hash wpisu. Lustro `computeAuditHash`; test 1
 * pilnuje, zeby te dwie listy sie nie rozjechaly (dopisanie pola do hasha bez
 * przejrzenia pisarzy jest dokladnie ta zmiana, ktora ta bramka ma zatrzymac).
 *
 * `ts` i `payload` sa tu swiadomie: `ts` jest ustawiane raz przy wstawieniu,
 * `payload` to tresc zdarzenia. Zaden z nich nie jest kolumna FK, wiec testy
 * ponizej ich nie dotycza - ale gdyby kiedys byly, maja byc sprawdzone tak samo.
 */
const HASH_INPUTS = [
    "ts",
    "event_type",
    "actor_user_id",
    "chat_id",
    "document_id",
    "payload",
] as const;

/**
 * REJESTR PISARZY audit_log - kto ma prawo zmieniac wiersze rejestru i ile razy.
 *
 * Liczniki sa DOKLADNE, nie ">=1": plik moze miec legalny zapis i mimo to dostac
 * nowy obok (ten sam wzorzec, ktory zlapala egress-surface-parity.test.ts).
 * `insert` to dopisanie do rejestru append-only. `update`/`delete`/`upsert`
 * zmieniaja to, co juz zapisane - i wymagaja uzasadnienia w kolumnie `dlaczego`.
 */
const REJESTR_PISARZY: Array<{ plik: string; metoda: string; ile: number }> = [
    {
        // Jedyne dopisanie do rejestru. Liczy hash i wstawia wiersz.
        plik: "src/lib/audit.ts",
        metoda: "insert",
        ile: 1,
    },
    {
        // RODO art. 17 vs AI Act art. 12 - konflikt rozstrzygniety w ADR-0164:
        // anonimizacja zostaje, ale zrywa lancuch i MUSI to zadeklarowac
        // zdarzeniem audit.chain.legal_break (pilnuje tego test 6 nizej).
        plik: "scripts/rodo-delete.ts",
        metoda: "update",
        ile: 1,
    },
];

/** Katalogi skanowane w poszukiwaniu pisarzy. */
const KATALOGI_PISARZY = ["src", "scripts"] as const;
const METODY_ZAPISU = ["insert", "update", "delete", "upsert"] as const;

function plikiTs(dir: string, acc: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === "dist") continue;
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) plikiTs(full, acc);
        else if (/\.(ts|cjs|mjs)$/.test(entry) && !entry.endsWith(".test.ts")) {
            acc.push(full);
        }
    }
    return acc;
}

/** Drzewo czytane RAZ na plik testowy, nie raz na asercje. */
let cacheDrzewa: Array<{ rel: string; src: string }> | null = null;

function drzewo(): Array<{ rel: string; src: string }> {
    if (!cacheDrzewa) {
        cacheDrzewa = KATALOGI_PISARZY.flatMap((katalog) =>
            plikiTs(path.join(BACKEND_ROOT, katalog)).map((plik) => ({
                rel: path.relative(BACKEND_ROOT, plik).split(path.sep).join("/"),
                src: readFileSync(plik, "utf8"),
            })),
        );
    }
    return cacheDrzewa;
}

/**
 * Znajduje kazde `.from("audit_log")` i sprawdza, jaka metoda po nim nastepuje.
 *
 * Okno 200 znakow, bo lancuch jest wieloliniowy (prettier lamie `.update(` do
 * kolejnej linii). Czytamy PIERWSZA metode w lancuchu - `select` nie jest
 * zapisem i nie wchodzi do wyniku.
 */
function zmierzPisarzy(): Array<{ plik: string; metoda: string; ile: number }> {
    const licznik = new Map<string, number>();
    for (const { rel, src } of drzewo()) {
        let od = 0;
        for (;;) {
            const i = src.indexOf('from("audit_log")', od);
            if (i === -1) break;
            od = i + 1;
            const okno = src.slice(i, i + 200);
            const m = /\.\s*([a-zA-Z]+)\s*\(/.exec(
                okno.slice('from("audit_log")'.length),
            );
            const metoda = m?.[1] ?? "";
            if (!(METODY_ZAPISU as readonly string[]).includes(metoda)) continue;
            const klucz = `${rel}\u0000${metoda}`;
            licznik.set(klucz, (licznik.get(klucz) ?? 0) + 1);
        }
    }
    return [...licznik.entries()]
        .map(([klucz, ile]) => {
            const [plik, metoda] = klucz.split("\u0000");
            return { plik: plik!, metoda: metoda!, ile };
        })
        .sort((a, b) => (a.plik + a.metoda).localeCompare(b.plik + b.metoda));
}

/** Wyciaga cialo `create table ... <name> ( ... )` z tekstu SQL. */
function createTableBody(sql: string, table: string): string {
    const re = new RegExp(
        `create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?(?:public\\.)?${table}\\s*\\(`,
        "i",
    );
    const m = re.exec(sql);
    if (!m) throw new Error(`nie znaleziono CREATE TABLE ${table}`);
    const start = m.index + m[0].length;
    let depth = 1;
    for (let i = start; i < sql.length; i++) {
        if (sql[i] === "(") depth++;
        else if (sql[i] === ")") {
            depth--;
            if (depth === 0) return sql.slice(start, i);
        }
    }
    throw new Error(`niedomkniety CREATE TABLE ${table}`);
}

/**
 * Zwraca mape kolumna -> akcja kaskady dla kolumn zadeklarowanych jako FK
 * z `on delete <akcja>`. Kolumny bez FK albo bez `on delete` nie wchodza.
 */
function cascadingColumns(tableBody: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const raw of tableBody.split("\n")) {
        const line = raw.split("--")[0].trim();
        const m =
            /^([a-z_][a-z0-9_]*)\b[^,]*?\breferences\b[^,]*?\bon\s+delete\s+(set\s+null|cascade|set\s+default)/i.exec(
                line,
            );
        if (m) out[m[1]] = m[2].replace(/\s+/g, " ").toLowerCase();
    }
    return out;
}

describe("pola wchodzace do hasha audytu maja jednego pisarza", () => {
    it("1. HASH_INPUTS jest lustrem computeAuditHash", () => {
        // Parsujemy zrodlo zamiast eksportowac stala z audit.ts: dopisanie pola
        // do obiektu kanonicznego ma zapalic sie tutaj na czerwono, a nie zostac
        // po cichu wchlonione przez wspoldzielona stala.
        const src = readFileSync(path.join(__dirname, "audit.ts"), "utf8");
        const i = src.indexOf("canonicalJsonStringify({");
        expect(i).toBeGreaterThan(-1);
        const body = createTableBodyLike(src.slice(i + "canonicalJsonStringify(".length));
        const keys = [...body.matchAll(/^\s*([a-z_][a-z0-9_]*)\s*:/gim)].map((m) => m[1]);
        expect([...keys].sort()).toEqual([...HASH_INPUTS].sort());
    });

    it("2. zadne pole hasha nie jest celem kaskady FK w schemacie Postgres", () => {
        // CZERWONY do czasu decyzji wlasciciela produktu. Dzis: actor_user_id / chat_id / document_id
        // maja `on delete set null`, wiec baza jest drugim pisarzem tych pol.
        const cascading = cascadingColumns(createTableBody(PG_SCHEMA, "audit_log"));
        const kolizje = Object.entries(cascading).filter(([col]) =>
            (HASH_INPUTS as readonly string[]).includes(col),
        );
        expect(
            kolizje,
            "kolumny wchodzace do hasha, ktore baza przepisze przy usunieciu obiektu nadrzednego",
        ).toEqual([]);
    });

    it("3. SQLite i Postgres zgadzaja sie co do kaskad na polach hasha", () => {
        // Warstwa SQLite trzyma te trzy pola jako gole `text` bez FK - czyli robi
        // juz to, co ta bramka wymaga. Rozjazd miedzy backendami znaczy, ze ta sama
        // czynnosc uzytkownika daje zerwany lancuch w chmurze i caly na desktopie.
        const pg = cascadingColumns(createTableBody(PG_SCHEMA, "audit_log"));
        const lite = cascadingColumns(createTableBody(SQLITE_SCHEMA, "audit_log"));
        const dla = (m: Record<string, string>) =>
            Object.fromEntries(
                Object.entries(m).filter(([c]) =>
                    (HASH_INPUTS as readonly string[]).includes(c),
                ),
            );
        expect(dla(pg), "Postgres vs SQLite: kaskady na polach hasha").toEqual(dla(lite));
    });

    it("0. kontrola sterujaca: parser rozpoznaje kaskade i tylko kaskade", () => {
        // Bez tego testy 2 i 3 moglyby zzieleniec po naprawie schematu z powodu
        // pomylki w regexie zamiast z powodu naprawy. Tu sprawdzamy na znanym-zlym
        // i znanym-dobrym, ze parser faktycznie rozroznia te przypadki.
        const probka = `
  id            bigserial primary key,
  kaskadowa     uuid references public.chats(id) on delete set null,
  twarda        uuid references public.chats(id) on delete cascade,
  bezpieczna    uuid references public.chats(id) on delete no action,
  bez_fk        uuid,
  zakomentowana uuid, -- references public.chats(id) on delete set null
`;
        expect(cascadingColumns(probka)).toEqual({
            kaskadowa: "set null",
            twarda: "cascade",
        });
    });

    it("5. REJESTR PISARZY: nikt poza audit.ts i rodo-delete.ts nie zmienia audit_log", () => {
        // Ten test jest powodem, dla ktorego plik nazywa sie "...one-writer".
        //
        // Testy 2 i 3 mierza SCHEMAT, a schemat to tylko jeden z dwoch pisarzy.
        // Drugim jest KOD: `scripts/rodo-delete.ts` robi jawny
        // `update({ actor_user_id: null })`, ktory idzie przez klient w ksztalcie
        // Supabase - a wiec dziala na OBU backendach, SQLite (desktop) wlacznie.
        // Gdyby ta bramka konczyla sie na schemacie, naprawa FK zapalilaby ja na
        // zielono, podczas gdy sciezka RODO dalej zrywalaby lancuch w produkcie,
        // ktory wysylamy. Bramka mierzaca nie te wielkosc, co trzeba, jest gorsza
        // niz jej brak, bo daje spokoj.
        // Obie strony sortowane tak samo - rejestr jest ZBIOREM uprawnien,
        // a nie lista uporzadkowana; kolejnosc wpisow nie ma byc zarzutem.
        const wgKlucza = (x: { plik: string; metoda: string }) =>
            x.plik + " " + x.metoda;
        const pisarze = zmierzPisarzy();
        expect(
            [...pisarze].sort((a, b) => wgKlucza(a).localeCompare(wgKlucza(b))),
            "Nowy zapis do audit_log poza rejestrem. audit_log jest rejestrem " +
                "APPEND-ONLY: dopisuje wylacznie appendAuditEvent (lib/audit.ts). " +
                "Jesli naprawde musisz przepisac pole wchodzace do hasha, zrob to " +
                "jak rodo-delete.ts - i ZAPISZ zdarzenie audit.chain.legal_break, " +
                "inaczej weryfikator nie odrozni tego od sabotazu (ADR-0164).",
        ).toEqual(
            [...REJESTR_PISARZY].sort((a, b) =>
                wgKlucza(a).localeCompare(wgKlucza(b)),
            ),
        );
    });

    it("6. jedyny pisarz spoza audit.ts DEKLARUJE zerwanie", () => {
        // Pozwolenie na UPDATE jest wazne tylko razem z obowiazkiem nazwania
        // skutku. Bez tego sprzezenia rejestr wyzej bylby zgoda in blanco.
        const src = readFileSync(
            path.join(BACKEND_ROOT, "scripts", "rodo-delete.ts"),
            "utf8",
        );
        expect(
            src.includes('event_type: "audit.chain.legal_break"'),
            "rodo-delete.ts przepisuje pole hasha, ale nie zapisuje zdarzenia " +
                "audit.chain.legal_break - zerwanie stanie sie nieodroznialne od ataku",
        ).toBe(true);
        // Deklaracja bez zakresu jest bezuzyteczna dla weryfikatora: musi wiedziec,
        // KTORE wiersze sa objete, a nie tylko ze cos sie stalo.
        for (const pole of ["affected_ids", "affected_count", "affected_ids_truncated"]) {
            expect(src, `deklaracja bez pola ${pole}`).toContain(pole);
        }
    });

    it("4. charakterystyka: wyzerowanie pola hasha zrywa lancuch", () => {
        // Nie bramka, tylko dowod mechanizmu - to jest DOKLADNIE to, co robi
        // `on delete set null` i co robil `rodo-delete.ts`. Ten test ma byc zielony:
        // pokazuje, ze weryfikator zareaguje, a wiec ze skutek jest realny.
        const ts = "2026-09-03T10:00:00.000Z";
        const wpis = {
            prev_hash: GENESIS_HASH,
            ts,
            event_type: "chat.message.assistant",
            actor_user_id: "11111111-1111-4111-8111-111111111111",
            chat_id: null,
            document_id: "22222222-2222-4222-8222-222222222222",
            payload: { model: "test" },
        };
        const zapisany = computeAuditHash(wpis);

        // baza zeruje `document_id` przy usunieciu dokumentu; hash NIE jest liczony ponownie
        const poKasacji = computeAuditHash({ ...wpis, document_id: null });
        expect(poKasacji).not.toBe(zapisany);

        // to samo dla aktora (sciezka rodo-delete.ts)
        const poAnonimizacji = computeAuditHash({ ...wpis, actor_user_id: null });
        expect(poAnonimizacji).not.toBe(zapisany);
    });
});

/** Wycina `{ ... }` od pierwszego `{`, liczac zagniezdzenia. */
function createTableBodyLike(s: string): string {
    const start = s.indexOf("{");
    let depth = 0;
    for (let i = start; i < s.length; i++) {
        if (s[i] === "{") depth++;
        else if (s[i] === "}") {
            depth--;
            if (depth === 0) return s.slice(start + 1, i);
        }
    }
    throw new Error("niedomkniety obiekt kanoniczny w audit.ts");
}
