// E-01 (audyt 2026-09): anonimizacja RODO i kasacja czatu/dokumentu zrywaly weryfikacje
// hash-chain, a weryfikator raportowal to identycznie jak sabotaz (obietnica Konstytucji
// 5.3/5.4). Pierwotna wersja tego testu kopiowala weryfikator sprzed ADR-0161 i wymagala,
// zeby lancuch po anonimizacji "przechodzil" - czego zaden hash-chain nie da. Stan
// docelowy (ADR-0164 + migracja 024 + przeglad 2026-10-02 R-AC-01): (1) pola hasha nie
// maja FK z akcja on delete, wiec kasacja czatu/dokumentu ich nie przepisuje; (2)
// anonimizacja jest zadeklarowana zdarzeniem audit.chain.legal_break z hashem wiersza
// po zerwaniu i weryfikator daje UWAGI "z mocy prawa", a nie BLOKADE.
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { computeAuditHash, GENESIS_HASH } from "../src/lib/audit";
import { verifyAuditChain, type ChainRow } from "../src/lib/audit-chain-verify";

function chain(): ChainRow[] {
    const rows: ChainRow[] = [];
    let prev = GENESIS_HASH;
    for (let i = 1; i <= 2; i++) {
        const base = {
            id: i,
            ts: `2026-01-15T10:00:1${i}.000Z`,
            event_type: i === 1 ? "chat.message.user" : "chat.message.assistant",
            actor_user_id: "11111111-1111-4111-8111-111111111111",
            chat_id: "22222222-2222-4222-8222-222222222222",
            document_id: null,
            payload: { n: i },
            prev_hash: prev,
        };
        const row: ChainRow = { ...base, hash: computeAuditHash(base) };
        rows.push(row);
        prev = row.hash;
    }
    return rows;
}

describe("E-01 anonimizacja RODO / kasacja czatu vs weryfikator hash-chain", () => {
    it("zadeklarowana anonimizacja (jak scripts/rodo-delete.ts) daje UWAGI z mocy prawa, nie BLOKADE", () => {
        const rows = chain();
        const hashePo = rows.map((r) => computeAuditHash({ ...r, actor_user_id: null }));
        for (const r of rows) r.actor_user_id = null;
        const decl = {
            id: 3,
            ts: "2026-01-15T10:00:20.000Z",
            event_type: "audit.chain.legal_break",
            actor_user_id: null,
            chat_id: null,
            document_id: null,
            payload: {
                reason: "rodo_art_17_anonymization",
                field: "actor_user_id",
                affected_count: 2,
                first_id: 1,
                last_id: 2,
                affected_ids: [1, 2],
                affected_hashes_after: hashePo,
                affected_ids_truncated: false,
            },
            prev_hash: rows[1].hash,
        };
        rows.push({ ...decl, hash: computeAuditHash(decl) });
        const r = verifyAuditChain(rows, { guardAfterId: null });
        expect(r.verdict).toBe("uwagi");
        expect(r.findings.every((f) => f.kind === "hash_mismatch_legal_break")).toBe(true);
    });

    it("pola hasha audit_log nie maja FK z akcja on delete (kasacja czatu/dokumentu ich nie przepisuje)", () => {
        for (const plik of ["../schema.sql", "../src/lib/db/schema.sqlite.ts"]) {
            const src = fs.readFileSync(path.join(__dirname, plik), "utf8");
            const m = /create table if not exists (?:public\.)?audit_log\s*\(([\s\S]*?)\n\s*\);/i.exec(src);
            expect(m, `brak definicji audit_log w ${plik}`).not.toBeNull();
            expect(m![1]).not.toMatch(/(actor_user_id|chat_id|document_id)[^,\n]*references/i);
        }
    });
});
