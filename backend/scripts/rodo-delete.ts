#!/usr/bin/env tsx
// RODO art. 17 (prawo do bycia zapomnianym) - kasacja danych usera.
//
// Co kasujemy:
//   - chat_messages (przez chat_id w chats user_id=...)
//   - chats user_id=...
//   - documents + document_versions (soft-delete: status='deleted', + pliki w MinIO
//     do kasowania osobno przez operatora)
//   - projects user_id=...
//   - workflows user_id=...
//   - user_profiles user_id=...
//   - user_api_keys user_id=...
//
// Co ZOSTAJE (compliance > prawo do usuniecia):
//   - audit_log - z anonimizacja: actor_user_id ustawiane na NULL jawnym UPDATE-em
//     (od migracji 024 audit_log NIE MA juz FK na polach hasha - patrz ADR-0164).
//     To wymog AI Act art. 12 record-keeping + RODO art. 17 ust. 3 lit. b
//     (przetwarzanie konieczne do wywiazania sie z obowiazku prawnego).
//     UWAGA: `actor_user_id` wchodzi do hasha, wiec ta anonimizacja ZRYWA lancuch
//     w dotknietych wierszach. Jest to swiadomy, nazwany skutek: krok 5b zapisuje
//     zdarzenie `audit.chain.legal_break` z zakresem id, zeby weryfikator
//     (scripts/verify-audit-chain.ts) odroznil obowiazek prawny od sabotazu.
//
// Wymaga --confirm zeby zadzialalo - bezpiecznik anty-pomylkowy.
//
// Uruchomienie:
//   npm run rodo:delete -- --user <user_id> --confirm

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { appendAuditEvent, computeAuditHash } from "../src/lib/audit";
import { createServerSupabase, isSqliteBackend } from "../src/lib/supabase";
import net from "net";

// Tryb desktop (SQLite, domyslny): ta sama warstwa bazy co backend (shim SQLite,
// PATRON_DB_PATH). Do 2026-10-06 skrypt znal tylko Supabase i na domyslnej
// instalacji konczyl sie "FATAL: brak SUPABASE_URL" - obowiazek z art. 17 byl
// niewykonalny tam, gdzie PATRON dziala najczesciej (weryfikacja desktop, R5).
const SQLITE = isSqliteBackend();
const SUPABASE_URL =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SECRET_KEY ??
    process.env.SUPABASE_SERVICE_KEY;

if (!SQLITE && (!SUPABASE_URL || !SERVICE_ROLE_KEY)) {
    console.error(
        "FATAL: brak SUPABASE_URL / SUPABASE_SECRET_KEY w .env (tryb serwerowy). " +
            "Desktop: ustaw PATRON_DB_BACKEND=sqlite i PATRON_DB_PATH=<sciezka do patron.db>.",
    );
    process.exit(2);
}

function arg(flag: string): string | undefined {
    const i = process.argv.indexOf(flag);
    return i >= 0 ? process.argv[i + 1] : undefined;
}
const userId = arg("--user");
const confirm = process.argv.includes("--confirm");
if (!userId) {
    console.error(
        "Uzycie: npm run rodo:delete -- --user <user_id> --confirm",
    );
    process.exit(2);
}
if (!confirm) {
    console.error(
        `BEZPIECZNIK: brak flagi --confirm. To DESTRUKCYJNA operacja. Aby kontynuowac uruchom:\n  npm run rodo:delete -- --user ${userId} --confirm`,
    );
    process.exit(2);
}

const db = SQLITE
    ? createServerSupabase()
    : createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
          auth: { persistSession: false },
      });

/**
 * Desktop (SQLite): backend PATRONa dopisuje do tego samego audit_log. Dwa procesy
 * dopisujace naraz moga rozwidlic lancuch (kolejka zapisow C-07 dziala w JEDNYM
 * procesie), wiec "zamknij aplikacje" nie moze byc tylko zdaniem w instrukcji.
 * Sprawdzamy port backendu (PORT, domyslnie 3001 - staly w desktopie). Tryb
 * serwerowy (Postgres) ma wiele procesow z zalozenia - tam tej bramki nie ma.
 */
function backendDziala(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const s = net.connect({ host: "127.0.0.1", port }, () => {
            s.destroy();
            resolve(true);
        });
        s.on("error", () => resolve(false));
        s.setTimeout(1500, () => {
            s.destroy();
            resolve(false);
        });
    });
}

async function main() {
    if (SQLITE) {
        const port = Number(process.env.PORT ?? 3001);
        if (await backendDziala(port)) {
            console.error(
                `STOP: na porcie ${port} dziala backend PATRONa. Zamknij aplikacje PATRON i uruchom ponownie - ` +
                    `dwa procesy zapisujace dziennik audytu naraz moga rozwidlic lancuch dowodowy. Nic nie zostalo zmienione.`,
            );
            process.exit(2);
            return;
        }
    }
    console.log(`[rodo:delete] START dla user_id=${userId}`);

    // 1. policz "przed"
    const { data: chatsBefore } = await db
        .from("chats")
        .select("id")
        .eq("user_id", userId!);
    const chatIds = (chatsBefore ?? []).map((r: { id: string }) => r.id);

    const { data: docsBefore } = await db
        .from("documents")
        .select("id, storage_path")
        .eq("user_id", userId!);
    const docList = (docsBefore ?? []) as { id: string; storage_path?: string }[];

    console.log(
        `[rodo:delete] przed: chats=${chatIds.length}, docs=${docList.length}`,
    );

    // 2. chat_messages -> chats
    if (chatIds.length > 0) {
        const { error: err1 } = await db
            .from("chat_messages")
            .delete()
            .in("chat_id", chatIds);
        if (err1) console.error(`[rodo:delete] chat_messages err:`, err1.message);
    }
    const { error: err2 } = await db
        .from("chats")
        .delete()
        .eq("user_id", userId!);
    if (err2) console.error(`[rodo:delete] chats err:`, err2.message);

    // 3. documents (soft-delete) - pliki w MinIO usuwa operator osobno wedlug
    //    storage_path z raportu (drukowane nizej).
    if (docList.length > 0) {
        const docIds = docList.map((d) => d.id);
        const { error: err3 } = await db
            .from("document_versions")
            .delete()
            .in("document_id", docIds);
        if (err3) console.error(`[rodo:delete] document_versions err:`, err3.message);
        const { error: err4 } = await db
            .from("documents")
            .update({ status: "deleted" })
            .eq("user_id", userId!);
        if (err4) console.error(`[rodo:delete] documents soft-delete err:`, err4.message);
    }

    // 4. projects, workflows, user_profiles, user_api_keys, mutation_approvals
    //    (ADR-0137: karty zatwierdzenia mutacji niosa tool_payload z tekstem
    //    edycji dokumentu klienta -> musza zniknac przy art. 17; FK do chats/
    //    documents ma ON DELETE SET NULL, wiec kolejnosc usuniecia jest dowolna).
    for (const table of [
        "projects",
        "workflows",
        "user_profiles",
        "user_api_keys",
        "mutation_approvals",
    ]) {
        const { error } = await db.from(table).delete().eq("user_id", userId!);
        if (error) {
            console.error(`[rodo:delete] ${table} err:`, error.message);
        }
    }

    // 5. anonimizacja audit_log - jawny UPDATE (od migracji 024 audit_log nie ma
    //    juz FK na polach hasha, wiec to JEDYNA sciezka, ktora te pola przepisuje).
    //
    //    `actor_user_id` WCHODZI DO HASHA, wiec ten UPDATE NIEUCHRONNIE zrywa
    //    lancuch w kazdym dotknietym wierszu. To nie jest defekt do naprawienia,
    //    tylko konflikt dwoch obowiazkow: RODO art. 17 kaze zanonimizowac,
    //    AI Act art. 12 kaze zachowac dowod. ADR-0164 rozstrzyga go tak:
    //    anonimizacja zostaje, ale zerwanie MA SIE SAMO NAZWAC - inaczej
    //    verify-audit-chain raportuje wykonanie obowiazku prawnego identycznie
    //    jak sabotaz, a audytor nie ma jak ich odroznic.
    //
    //    Dlatego NAJPIERW zbieramy wiersze, ktore za chwile zerwiemy, i NAJPIERW
    //    zapisujemy deklaracje, a dopiero potem anonimizujemy (audyt 2026-10-02,
    //    R-AC-02: odwrotna kolejnosc przy nieudanym zapisie deklaracji zostawiala
    //    lancuch zerwany bez slowa, a skrypt i tak konczyl sie "OK" i kodem 0).
    //    Deklaracja niesie dla kazdego wiersza hash PO anonimizacji (R-AC-01):
    //    weryfikator uznaje zerwanie "z mocy prawa" tylko gdy tresc wiersza po
    //    anonimizacji jest dokladnie ta zadeklarowana - inaczej deklaracja
    //    wybielalaby kazda pozniejsza zmiane tresci. Lista nie jest obcinana -
    //    idzie w porcjach (R-AC-07: obciecie do 500 dawalo trwala BLOKADE).
    const { data: doZerwania, error: err5a } = await db
        .from("audit_log")
        .select("id, ts, event_type, chat_id, document_id, payload, prev_hash")
        .eq("actor_user_id", userId!)
        .order("id", { ascending: true });
    if (err5a) {
        // Fail-closed: bez listy wierszy nie ma deklaracji, a bez deklaracji
        // anonimizacja wygladalaby w weryfikatorze jak sabotaz.
        throw new Error(`audit_log odczyt zakresu anonimizacji: ${err5a.message} - audit_log NIE zostal zanonimizowany`);
    }
    const wiersze = (doZerwania ?? []) as Array<{
        id: number | string;
        ts: string;
        event_type: string;
        chat_id: string | null;
        document_id: string | null;
        payload: Record<string, unknown> | null;
        prev_hash: string;
    }>;
    const zerwaneIds = wiersze.map((r) => Number(r.id));
    const hashePo = wiersze.map((r) =>
        computeAuditHash({
            prev_hash: r.prev_hash,
            ts: r.ts,
            event_type: r.event_type,
            actor_user_id: null,
            chat_id: r.chat_id,
            document_id: r.document_id,
            payload: r.payload ?? {},
        }),
    );

    if (zerwaneIds.length > 0) {
        // 5a. deklaracje (ADR-0164) - przed UPDATE, w porcjach. Payload bez danych
        //     osobowych - aktor pseudonimizowany tym samym hashem co w rodo.delete,
        //     zeby IOD mogl powiazac wpisy ze zgloszeniem.
        const PORCJA = 500;
        const porcje = Math.ceil(zerwaneIds.length / PORCJA);
        for (let i = 0; i < porcje; i++) {
            const ids = zerwaneIds.slice(i * PORCJA, (i + 1) * PORCJA);
            const zapis = await appendAuditEvent(db, {
                event_type: "audit.chain.legal_break",
                actor_user_id: null,
                payload: {
                    reason: "rodo_art_17_anonymization",
                    field: "actor_user_id",
                    target_user_id_hash: hashUserId(userId!),
                    affected_count: zerwaneIds.length,
                    first_id: zerwaneIds[0],
                    last_id: zerwaneIds[zerwaneIds.length - 1],
                    part: i + 1,
                    parts: porcje,
                    affected_ids: ids,
                    affected_hashes_after: hashePo.slice(i * PORCJA, (i + 1) * PORCJA),
                    affected_ids_truncated: false,
                },
            });
            if (!zapis.ok) {
                throw new Error(
                    `zapis audit.chain.legal_break (czesc ${i + 1}/${porcje}) nieudany: ${zapis.error ?? "nieznany blad"} - ` +
                        `audit_log NIE zostal zanonimizowany (Postgres bez migracji 025?)`,
                );
            }
        }

        // 5b. anonimizacja dokladnie zadeklarowanych wierszy (po id, nie po
        //     actor_user_id - wpis dopisany w miedzyczasie nie zostanie zerwany
        //     bez deklaracji).
        for (let i = 0; i < zerwaneIds.length; i += PORCJA) {
            const { error: err5 } = await db
                .from("audit_log")
                .update({ actor_user_id: null })
                .in("id", zerwaneIds.slice(i, i + PORCJA));
            if (err5) {
                throw new Error(
                    `audit_log anonimizacja nieudana: ${err5.message} - deklaracja zapisana, czesc wierszy moze nie byc zanonimizowana; uruchom skrypt ponownie`,
                );
            }
        }
        console.log(
            `[rodo:delete] lancuch zerwany w ${zerwaneIds.length} wierszach ` +
                `(art. 17) - zadeklarowany w ${porcje} zdarzeniu(ach) audit.chain.legal_break`,
        );
    }

    // 6. samoaudyt - rodo.delete zdarzenie z anonimowym actor (nie wskazuje na usera ktorego usuwamy)
    await appendAuditEvent(db, {
        event_type: "rodo.delete",
        actor_user_id: null,
        payload: {
            target_user_id_hash: hashUserId(userId!),
            chats_removed: chatIds.length,
            documents_soft_deleted: docList.length,
            minio_files_to_remove: docList
                .map((d) => d.storage_path)
                .filter(Boolean),
        },
    });

    console.log(`[rodo:delete] OK`);
    if (SQLITE) {
        console.log(
            `[rodo:delete] PAMIETAJ usunac pliki dokumentow z katalogu danych (PATRON_STORAGE_DIR):`,
        );
        for (const d of docList) if (d.storage_path) console.log(`  ${d.storage_path}`);
    } else {
        console.log(`[rodo:delete] PAMIETAJ usunac z MinIO bucket:`);
        for (const d of docList) {
            if (d.storage_path) {
                console.log(`  mc rm local/patron/${d.storage_path}`);
            }
        }
    }
}

import crypto from "crypto";
function hashUserId(id: string): string {
    // Nie chcemy w audit_log mieliny wskazujacej na konkretnego usera ktorego
    // usunelismy - ale chcemy wskaznik zeby IOD mogl powiazac wpis ze
    // zgloszeniem (np. ticket helpdesku ma ten sam hash).
    return crypto.createHash("sha256").update(id).digest("hex").slice(0, 16);
}

main().catch((err) => {
    console.error("[rodo:delete] FATAL:", err);
    process.exit(1);
});
