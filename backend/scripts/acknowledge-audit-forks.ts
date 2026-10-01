#!/usr/bin/env tsx
// Potwierdzenie rozwidlen lancucha audytu sprzed straznika (ADR-0161, wariant B).
//
// Uruchomienie:
//   npm run audit:acknowledge-forks                     # pokazuje, co by potwierdzil
//   npm run audit:acknowledge-forks -- --tak            # zapisuje potwierdzenie
//   npm run audit:acknowledge-forks -- --sqlite plik.db --tak
//   npm run audit:acknowledge-forks -- --supabase --guard-after-id N --actor <uuid> --tak
//
// Co robi: dopisuje do lancucha JEDNO zdarzenie `audit.chain.fork_acknowledged`
// z id i hashami ogniw kazdego niepotwierdzonego rozwidlenia z sygnatura wyscigu.
// Bez tresci zdarzen. Skutek: ogniwa boczne (liscie, ktorych usuniecia lancuch sam
// nie widzi) sa odtad wymienione hashem na glownej sciezce - ich usuniecie
// weryfikator pokaze jako BLOKADE `ack_missing`.
//
// To akt Operatora, nie automat startu: "wiedzielismy o tych rozwidleniach w chwili
// T". Dlatego domyslnie tylko pokazuje liste, a zapisuje dopiero z `--tak`.
//
// Odmawia (kod 1), gdy:
//   - weryfikator daje BLOKADE - potwierdzenie nie wybiela manipulacji,
//   - nie ma progu straznika - bez niego zbior rozwidlen nie jest zamkniety.
// Zapis idzie przez appendAuditEvent (jedyny pisarz audytu), wiec dziala takze przy
// uruchomionej aplikacji: straznik w bazie i ponowienia rozstrzygaja wyscig.
//
// Kody wyjscia jak audit:verify: 0 OK, 3 UWAGI (np. podglad bez --tak), 1 BLOKADA
// albo odmowa, 2 blad.

import {
    buildForkAcknowledgement,
    FORK_ACK_EVENT,
    verifyAuditChain,
} from "../src/lib/audit-chain-verify";
import { EXIT, loadChain, parseSourceArgs, printReport, sqliteFile } from "./audit-chain-source";

async function main() {
    const args = parseSourceArgs(process.argv.slice(2), ["--tak"], ["--actor"]);
    const t0 = Date.now();
    const { rows, guardAfterId } = await loadChain(args);
    const report = verifyAuditChain(rows, { guardAfterId });
    printReport(report, ((Date.now() - t0) / 1000).toFixed(2));

    if (report.verdict === "blokada") {
        console.error("[audit-chain] ODMOWA: lancuch ma BLOKADE - najpierw wyjasnij znaleziska powyzej.");
        process.exit(EXIT.blokada);
    }
    if (guardAfterId === null) {
        console.error(
            "[audit-chain] ODMOWA: brak progu straznika. SQLite: uruchom aplikacje (migracje zakladaja straznika). " +
                "Supabase: zaaplikuj migracje 022 i podaj --guard-after-id.",
        );
        process.exit(EXIT.blokada);
    }
    const ack = buildForkAcknowledgement(rows, report);
    if (!ack) {
        console.log("[audit-chain] Nic do potwierdzenia.");
        process.exit(EXIT[report.verdict]);
    }
    for (const f of ack.forks) {
        console.log(
            `[audit-chain] do potwierdzenia: poprzednik id=${f.parent_id}, ogniwa id=[${f.siblings.map((x) => x.id).join(",")}]`,
        );
    }
    if (!args.flags.has("--tak")) {
        console.log("[audit-chain] Podglad - nic nie zapisano. Uruchom ponownie z --tak, aby zapisac potwierdzenie.");
        process.exit(EXIT.uwagi);
    }

    let actor: string | null = args.values.get("--actor") ?? null;
    if (args.source === "sqlite") {
        process.env.PATRON_DB_BACKEND = "sqlite";
        process.env.PATRON_DB_PATH = sqliteFile(args);
        actor ??= (await import("../src/lib/db/sqlite-connection")).LOCAL_USER_ID;
    } else if (!actor) {
        console.error("[audit-chain] Supabase: podaj --actor <uuid Operatora> (kto potwierdza).");
        process.exit(EXIT.error);
    }
    const { createServerSupabase } = await import("../src/lib/supabase");
    const { appendAuditEvent } = await import("../src/lib/audit");
    const written = await appendAuditEvent(createServerSupabase(), {
        event_type: FORK_ACK_EVENT,
        actor_user_id: actor,
        payload: { ...ack, tool: "audit:acknowledge-forks" },
    });
    if (args.source === "sqlite") (await import("../src/lib/db/sqlite-connection")).closeDb();
    if (!written.ok) {
        console.error(`[audit-chain] zapis potwierdzenia nieudany: ${written.error}`);
        process.exit(EXIT.error);
    }
    console.log(`[audit-chain] Zapisano potwierdzenie (hash ${written.row?.hash}). Weryfikacja po zapisie:`);

    const after = await loadChain(args);
    const reportAfter = verifyAuditChain(after.rows, { guardAfterId: after.guardAfterId });
    printReport(reportAfter, ((Date.now() - t0) / 1000).toFixed(2));
    process.exit(EXIT[reportAfter.verdict]);
}

main().catch((err) => {
    console.error("[audit-chain] unhandled error:", err);
    process.exit(EXIT.error);
});
