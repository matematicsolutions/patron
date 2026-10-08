// Trwalosc zapisu audytu (przeglad 2026-10-08, OverGraph -> PATRON).
//
// 1. Polaczenie SQLite pracuje w WAL z synchronous=FULL: zatwierdzony zapis audytu
//    przetrwa zanik zasilania. Przy NORMAL ostatnie transakcje mogly sie wycofac -
//    takze wpis llm_route "allow" dopisywany PO wyjsciu danych do chmury.
//    Zmierzone 2026-10-08 na maszynie deweloperskiej: ok. +1,5 ms na zapis audytu,
//    indeksacja bez roznicy ponad szum. To deklaracja o ARCHITEKTURZE (tryb
//    polaczenia) - zaniku zasilania ten test nie symuluje.
// 2. GRANICA METODY, nazwana testem: weryfikator lancucha NIE wykrywa ucietego
//    ogona - ostatnie wpisy usuniete w calosci zostawiaja poprawny prefiks.
//    Potwierdzenie konca lancucha wymaga kotwicy spoza bazy (porownanie `head` z
//    kopia zapisana gdzie indziej; znakowanie czasem - rezerwacja ADR-0037).
//    Gdy kotwica powstanie, ten test zmieni sie na czerwony - i tak ma byc.
// Swieza baza w katalogu tymczasowym; dane syntetyczne.

import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "patron-trwalosc-"));
process.env.PATRON_DB_BACKEND = "sqlite";
process.env.PATRON_DB_PATH = path.join(TMP, "patron.db");

let conn: typeof import("./sqlite-connection");

beforeAll(async () => {
    conn = await import("./sqlite-connection");
});
afterAll(() => {
    conn.closeDb();
    fs.rmSync(TMP, { recursive: true, force: true });
});

describe("trwalosc zapisu audytu", () => {
    it("polaczenie: WAL + synchronous=FULL (2)", () => {
        const db = conn.getDb();
        expect(String(db.pragma("journal_mode", { simple: true })).toLowerCase()).toBe("wal");
        expect(db.pragma("synchronous", { simple: true })).toBe(2);
    });

    it("granica metody: uciety ogon lancucha daje werdykt ok (potrzebna kotwica spoza bazy)", async () => {
        const { createServerSupabase } = await import("../supabase");
        const { appendAuditEvent } = await import("../audit");
        const { verifyAuditChain } = await import("../audit-chain-verify");
        const db = createServerSupabase();
        for (let i = 0; i < 12; i++) {
            await appendAuditEvent(db, {
                event_type: "connector.toggle", actor_user_id: null, chat_id: null, document_id: null,
                payload: { server_name: "trwalosc-test", enabled: true, ring: 1 },
            });
        }
        // Ten sam odczyt co loadSqlite w scripts/audit-chain-source.ts (kolumny,
        // kolejnosc, parsowanie payloadu) - skrypt lezy poza rootDir testow.
        const { readAuditChainGuardThreshold } = await import("./migrate.sqlite");
        const raw = conn.getDb();
        const zweryfikuj = async () => {
            const wiersze = (raw.prepare(
                "select id, ts, actor_user_id, event_type, chat_id, document_id, payload, prev_hash, hash from audit_log order by id",
            ).all() as Array<{ payload: string }>).map((r) => ({ ...r, payload: JSON.parse(r.payload) }));
            return verifyAuditChain(wiersze as never, { guardAfterId: readAuditChainGuardThreshold(raw) });
        };
        const pelny = await zweryfikuj();
        raw.prepare("DELETE FROM audit_log WHERE id > (SELECT max(id) - 4 FROM audit_log)").run();
        const uciety = await zweryfikuj();
        expect(pelny.verdict).toBe("ok");
        expect(uciety.rows).toBe(pelny.rows - 4);
        // Granica, nie defekt do ukrycia: prefiks jest poprawny, wiec werdykt to "ok".
        expect(uciety.verdict).toBe("ok");
        expect(uciety.headId).toBeLessThan(pelny.headId!);
    });
});
