// R-TI-05: weryfikator lancucha (lib/audit-chain-verify.ts, classifyContentBreaks,
// squash 0141ce1 / ADR-0164) daje UWAGI zamiast BLOKADY dla wiersza z niezgodnym
// hashem, jezeli (1) jakies pozniejsze zdarzenie audit.chain.legal_break z poprawnym
// hashem wymienia jego id oraz (2) nazwane pole (actor_user_id) jest NULL.
// Nie sprawdza, czy NULL w tym polu jest JEDYNA zmiana: wiersz, w ktorym po
// anonimizacji podmieniono takze payload, dostaje ten sam werdykt UWAGI co wiersz
// tylko zanonimizowany. Test jednostkowy "deklaracja nie wybiela innej zmiany"
// (src/lib/audit-chain-verify.test.ts) omija dokladnie ten przypadek - przywraca
// actor_user_id przed sprawdzeniem. Oczekiwane: podmieniony payload w wierszu
// objetym deklaracja = BLOKADA (deklaracja moglaby np. niesc hash wiersza po
// wyzerowaniu pola i weryfikator porownywalby z nim).
import { describe, expect, it } from "vitest";
import { GENESIS_HASH, computeAuditHash } from "../src/lib/audit";
import { verifyAuditChain, type ChainRow } from "../src/lib/audit-chain-verify";

function chain(): ChainRow[] {
    const rows: ChainRow[] = [];
    let prev = GENESIS_HASH;
    for (let i = 1; i <= 4; i++) {
        const base = {
            id: i,
            ts: `2026-01-15T10:00:1${i}.000Z`,
            event_type: "chat.message.user",
            actor_user_id: i === 2 ? "u-anon" : "u-inny",
            chat_id: "c1",
            document_id: null,
            payload: { n: i, decyzja: "allow" },
            prev_hash: prev,
        };
        const row: ChainRow = { ...base, hash: computeAuditHash(base) };
        rows.push(row);
        prev = row.hash;
    }
    const decl = {
        id: 5,
        ts: "2026-01-15T10:00:20.000Z",
        event_type: "audit.chain.legal_break",
        actor_user_id: null,
        chat_id: null,
        document_id: null,
        payload: {
            reason: "rodo_art_17_anonymization",
            field: "actor_user_id",
            affected_count: 1,
            first_id: 2,
            last_id: 2,
            affected_ids: [2],
            // Format deklaracji od poprawki R-AC-01 (scripts/rodo-delete.ts): hash
            // wiersza PO wyzerowaniu pola. Deklaracje w starym formacie (bez tego
            // pola) weryfikator swiadomie zostawia na UWAGACH z jawna nota - inaczej
            // prawdziwe anonimizacje sprzed poprawki zmienilyby sie w BLOKADE.
            affected_hashes_after: [computeAuditHash({ ...rows[1], actor_user_id: null })],
            affected_ids_truncated: false,
        },
        prev_hash: prev,
    };
    rows.push({ ...decl, hash: computeAuditHash(decl) });
    return rows;
}

describe("R-TI-05 legal_break wybiela zmiane tresci w zadeklarowanym wierszu", () => {
    it("kontrola: sama anonimizacja zadeklarowana -> UWAGI", () => {
        const rows = chain();
        rows[1] = { ...rows[1], actor_user_id: null };
        expect(verifyAuditChain(rows, { guardAfterId: null }).verdict).toBe("uwagi");
    });

    it("anonimizacja + podmieniony payload w tym samym wierszu -> BLOKADA", () => {
        const rows = chain();
        rows[1] = { ...rows[1], actor_user_id: null, payload: { n: 2, decyzja: "block" } };
        const r = verifyAuditChain(rows, { guardAfterId: null });
        expect(
            r.verdict,
            `findings=${JSON.stringify(r.findings.map((f) => [f.kind, f.severity, f.ids]))}`,
        ).toBe("blokada");
    });
});
