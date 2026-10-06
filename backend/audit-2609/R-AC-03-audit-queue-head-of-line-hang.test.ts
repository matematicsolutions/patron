// R-AC-03: kolejka zapisow audytu (poprawka C-07, lib/audit.ts:275-281) nie ma limitu
// czasu. Jedno zapytanie bazy, ktore nie wraca (zawieszone polaczenie PostgREST w trybie
// serwerowym - supabase-js nie ma domyslnego timeoutu fetch), blokuje NA ZAWSZE kazdy
// kolejny appendAuditEvent w procesie: `appendQueue.then(...)` czeka na poprzednika.
// Przed poprawka jeden zawieszony zapis dotyczyl tylko siebie. Skutek: wszystkie sciezki
// fail-closed czekajace na audyt (eksport pakietu dowodowego ADR-0152, karty zatwierdzen
// ADR-0137) wisza bez konca, a fire-and-forget (`void appendAuditEvent` w chat.ts,
// projectChat.ts, bramka MCP) gromadzi sie w pamieci i przepada bez sladu.
// Oczekiwane: zawieszony zapis konczy sie bledem po skonczonym czasie, a nastepne
// zapisy ida dalej (straznik prev_hash w bazie obsluzy ewentualny spozniony insert).
import { describe, expect, it } from "vitest";

type Res = { data: unknown; error: unknown };

/** Atrapa klienta: pierwsze zapytanie o ostatni hash nigdy nie wraca, kolejne dzialaja. */
function makeDb() {
    let calls = 0;
    const rows: Array<{ hash: string }> = [];
    return {
        from(_t: string) {
            return {
                select(_c: string) {
                    return {
                        order() {
                            return {
                                limit(): Promise<Res> {
                                    calls++;
                                    if (calls === 1) return new Promise<Res>(() => {}); // zawieszone polaczenie
                                    return Promise.resolve({ data: rows.slice(-1), error: null });
                                },
                            };
                        },
                    };
                },
                insert(row: { hash: string }): Promise<Res> {
                    rows.push(row);
                    return Promise.resolve({ data: null, error: null });
                },
            };
        },
    };
}

describe("R-AC-03 kolejka audytu a jedno zawieszone zapytanie", () => {
    it("zawieszony zapis nie blokuje na zawsze kolejnych zapisow audytu w procesie", async () => {
        const { appendAuditEvent } = await import("../src/lib/audit");
        const db = makeDb() as any;
        // np. meta-slad admina w trybie serwerowym trafia na zerwane polaczenie
        void appendAuditEvent(db, { event_type: "admin.access.metrics", payload: {} });
        // kolejne zdarzenie - baza juz odpowiada
        const second = appendAuditEvent(db, { event_type: "chat.message.user", payload: { n: 1 } });
        const wynik = await Promise.race([
            second.then((r) => (r.ok ? "zapisane" : `blad: ${r.error}`)),
            new Promise<string>((r) => setTimeout(() => r("nadal czeka po 5 s"), 5_000)),
        ]);
        expect(wynik).toBe("zapisane");
    }, 15_000);
});
