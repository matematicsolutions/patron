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
import { appendAuditEvent } from "../src/lib/audit";

const SUPABASE_URL =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SECRET_KEY ??
    process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error("FATAL: brak SUPABASE_URL / SUPABASE_SECRET_KEY w .env");
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

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
});

async function main() {
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
    //    Dlatego NAJPIERW zbieramy id wierszy, ktore za chwile zerwiemy.
    const { data: doZerwania, error: err5a } = await db
        .from("audit_log")
        .select("id")
        .eq("actor_user_id", userId!)
        .order("id", { ascending: true });
    if (err5a) {
        console.error(`[rodo:delete] audit_log odczyt zakresu err:`, err5a.message);
    }
    const zerwaneIds = (doZerwania ?? []).map((r) => Number(r.id));

    const { error: err5 } = await db
        .from("audit_log")
        .update({ actor_user_id: null })
        .eq("actor_user_id", userId!);
    if (err5) {
        console.error(`[rodo:delete] audit_log anonimizacja err:`, err5.message);
    }

    // 5b. zdarzenie nazywajace zerwanie (ADR-0164). Idzie PO UPDATE: jego wlasny
    //     wiersz ma actor_user_id = null, wiec nie lapie sie we wlasny filtr.
    //     Payload bez danych osobowych - aktor pseudonimizowany tym samym hashem
    //     co w rodo.delete, zeby IOD mogl powiazac oba wpisy ze zgloszeniem.
    if (!err5 && zerwaneIds.length > 0) {
        // Pelna lista id bywa dluga; przycinamy, ale mianownik zostaje JAWNY -
        // milczace obciecie czyta sie potem jako "tyle bylo".
        const LIMIT_ID = 500;
        await appendAuditEvent(db, {
            event_type: "audit.chain.legal_break",
            actor_user_id: null,
            payload: {
                reason: "rodo_art_17_anonymization",
                field: "actor_user_id",
                target_user_id_hash: hashUserId(userId!),
                affected_count: zerwaneIds.length,
                first_id: zerwaneIds[0],
                last_id: zerwaneIds[zerwaneIds.length - 1],
                affected_ids: zerwaneIds.slice(0, LIMIT_ID),
                affected_ids_truncated: zerwaneIds.length > LIMIT_ID,
            },
        });
        console.log(
            `[rodo:delete] lancuch zerwany w ${zerwaneIds.length} wierszach ` +
                `(art. 17) - zapisano zdarzenie audit.chain.legal_break`,
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
    console.log(`[rodo:delete] PAMIETAJ usunac z MinIO bucket:`);
    for (const d of docList) {
        if (d.storage_path) {
            console.log(`  mc rm local/patron/${d.storage_path}`);
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
