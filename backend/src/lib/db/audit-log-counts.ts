// Liczniki audit_log per event_type - JEDEN agregat zamiast petli COUNT-ow.
//
// Powod istnienia: routes/metrics.ts liczyl wpisy petla po EVENT_TYPES, czyli
// jednym sekwencyjnym `select count(*) ... where event_type = ?` NA TYP. Gdy
// lustro EVENT_TYPES w metrics.ts przestalo byc wlasna kopia 7 pozycji i zaczelo
// importowac kanoniczne 21 (parytet, 2026-08-31), koszt kazdego scrape'u
// Prometheusa urosl 7 -> 21 zapytan po kolei. Naprawa parytetu nie miala
// placic kosztem wydajnosci.
//
// SQL zyje TU, w warstwie db - nie w route. Backend SQLite dostaje prawdziwe
// GROUP BY (jedno zapytanie, po indeksie idx_audit_log_event_type). Backend
// Postgres chodzi przez PostgREST, ktory bez widoku/RPC nie potrafi GROUP BY -
// tam zostaja COUNT-y per typ, ale RUSZAJA ROWNOLEGLE, wiec scrape kosztuje
// jedna fale zamiast 21 rund w szeregu.

import type { createServerSupabase } from "../supabase";
import { isSqliteBackend } from "../supabase";
import { getDb } from "./sqlite-connection";

/**
 * Zwraca `{ [event_type]: liczba }` dla PODANEJ listy typow - zawsze pelna,
 * z zerami dla typow bez wpisow. Lista przychodzi z zewnatrz (kanoniczne
 * EVENT_TYPES z lib/audit.ts): ten modul nie trzyma wlasnej kopii, bo kopia
 * listy typow to lustro #1 z AGENTS.md i ma jeden dom.
 *
 * Typy spoza listy (np. wpisy starsze niz obecna whitelist) sa ignorowane -
 * snapshot metryk opisuje kanon, nie zawartosc tabeli.
 *
 * UWAGA do parametru `db`: na backendzie SQLite ten argument jest IGNOROWANY.
 * Agregat potrzebuje surowego GROUP BY, ktorego klient w ksztalcie PostgREST
 * nie wyraza, wiec sciezka SQLite siega po `getDb()`. To nie jest druga baza:
 * `createSqliteClient()` (lib/db/supabase-shim.ts) sam wola `getDb()`, wiec to
 * TA SAMA lokalna instancja. Konsekwencja jest jednak realna i musi byc
 * napisana: podanie tu innego klienta (atrapa w tescie) nie zmieni wyniku na
 * SQLite - zmierzysz proces, nie argument. Sciezka PostgREST uzywa `db`.
 */
export async function countAuditLogByEventType(
    db: ReturnType<typeof createServerSupabase>,
    eventTypes: readonly string[],
): Promise<Record<string, number>> {
    const out: Record<string, number> = Object.fromEntries(
        eventTypes.map((et) => [et, 0]),
    );

    if (isSqliteBackend()) {
        const rows = getDb()
            .prepare(
                "select event_type as et, count(*) as n from audit_log group by event_type",
            )
            .all() as Array<{ et: string | null; n: number | bigint }>;
        for (const row of rows) {
            const et = row.et ?? "";
            if (et in out) out[et] = Number(row.n);
        }
        return out;
    }

    const pary = await Promise.all(
        eventTypes.map(async (et) => {
            const { count, error } = await db
                .from("audit_log")
                .select("id", { count: "exact", head: true })
                .eq("event_type", et);
            // Blad zapytania NIE jest zerem. `count ?? 0` pokazywalo audytorowi
            // "0 zdarzen tego typu" w sytuacji, w ktorej baza w ogole nie
            // odpowiedziala - a zero jest nieodroznialne od prawdy. Rzucamy:
            // routes/metrics.ts ma wtedy jednolicie pusty snapshot (widoczna
            // degradacja) zamiast jednej po cichu falszywej serii.
            if (error) {
                throw new Error(
                    `count audit_log dla event_type "${et}" nie powiodl sie: ` +
                        `${error.message ?? String(error)}`,
                );
            }
            return [et, count ?? 0] as const;
        }),
    );
    for (const [et, n] of pary) out[et] = n;
    return out;
}
