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
//   - audit_log - z anonimizacja: actor_user_id SET NULL (FK ON DELETE SET NULL).
//     To wymog AI Act art. 12 record-keeping + RODO art. 17 ust. 3 lit. b
//     (przetwarzanie konieczne do wywiazania sie z obowiazku prawnego).
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

    // 5. anonimizacja audit_log - FK ma ON DELETE SET NULL ale tutaj robimy
    //    explicit UPDATE zeby nie czekac na usuniecie z auth.users.
    const { error: err5 } = await db
        .from("audit_log")
        .update({ actor_user_id: null })
        .eq("actor_user_id", userId!);
    if (err5) {
        console.error(`[rodo:delete] audit_log anonimizacja err:`, err5.message);
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
