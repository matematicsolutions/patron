#!/usr/bin/env tsx
// RODO art. 20 (prawo do przenoszenia danych) - eksport pelnych danych usera w JSON.
//
// Uruchomienie:
//   npm run rodo:export -- --user <user_id> --out <plik.json>
//
// Wynik: JSON z wszystkimi czatami, dokumentami (metadata - PELNE pliki sa w MinIO,
// dorzucone osobno przez operatora), oraz wszystkimi wpisami audit_log dotyczacymi
// tego usera. Zdarzenie eksportu jest zapisywane w audit_log z type=rodo.export.

import "dotenv/config";
import fs from "fs";
import path from "path";
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

// CLI args
function arg(flag: string): string | undefined {
    const i = process.argv.indexOf(flag);
    return i >= 0 ? process.argv[i + 1] : undefined;
}
const userId = arg("--user");
const outPath = arg("--out");
if (!userId || !outPath) {
    console.error(
        "Uzycie: npm run rodo:export -- --user <user_id> --out <plik.json>",
    );
    process.exit(2);
}

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
});

interface RodoExport {
    schema_version: "1.0.0";
    generated_at: string;
    actor_user_id: string;
    user_profile: unknown;
    chats: unknown[];
    chat_messages: unknown[];
    documents: unknown[];
    document_versions: unknown[];
    projects: unknown[];
    workflows: unknown[];
    mutation_approvals: unknown[];
    audit_log_entries: unknown[];
    note: string;
}

async function fetchAll<T>(
    table: string,
    column: string,
    value: string,
): Promise<T[]> {
    const pages: T[] = [];
    let from = 0;
    const PAGE = 1000;
    while (true) {
        const { data, error } = await db
            .from(table)
            .select("*")
            .eq(column, value)
            .range(from, from + PAGE - 1);
        if (error) {
            console.error(`[rodo:export] read ${table} failed:`, error.message);
            break;
        }
        const rows = (data ?? []) as T[];
        pages.push(...rows);
        if (rows.length < PAGE) break;
        from += PAGE;
    }
    return pages;
}

async function main() {
    console.log(`[rodo:export] start dla user_id=${userId}`);

    const [
        userProfile,
        chats,
        chatMessages,
        documents,
        documentVersions,
        projects,
        workflows,
        mutationApprovals,
        auditEntries,
    ] = await Promise.all([
        db
            .from("user_profiles")
            .select("*")
            .eq("user_id", userId)
            .maybeSingle()
            .then((r) => r.data ?? null),
        fetchAll("chats", "user_id", userId!),
        // chat_messages nie ma user_id - musimy przez chat_id
        (async () => {
            const { data } = await db
                .from("chats")
                .select("id")
                .eq("user_id", userId!);
            const ids = (data ?? []).map((r: { id: string }) => r.id);
            if (ids.length === 0) return [];
            const { data: msgs } = await db
                .from("chat_messages")
                .select("*")
                .in("chat_id", ids);
            return msgs ?? [];
        })(),
        fetchAll("documents", "user_id", userId!),
        (async () => {
            const { data: docs } = await db
                .from("documents")
                .select("id")
                .eq("user_id", userId!);
            const docIds = (docs ?? []).map((r: { id: string }) => r.id);
            if (docIds.length === 0) return [];
            const { data: versions } = await db
                .from("document_versions")
                .select("*")
                .in("document_id", docIds);
            return versions ?? [];
        })(),
        fetchAll("projects", "user_id", userId!),
        fetchAll("workflows", "user_id", userId!),
        fetchAll("mutation_approvals", "user_id", userId!),
        fetchAll("audit_log", "actor_user_id", userId!),
    ]);

    const out: RodoExport = {
        schema_version: "1.0.0",
        generated_at: new Date().toISOString(),
        actor_user_id: userId!,
        user_profile: userProfile,
        chats,
        chat_messages: chatMessages,
        documents,
        document_versions: documentVersions,
        projects,
        workflows,
        mutation_approvals: mutationApprovals,
        audit_log_entries: auditEntries,
        note: "Pliki binarne (.docx/.pdf) sa w MinIO bucket - dostarcz osobno z odpowiednia kopia ze storage_path kazdego document_versions.",
    };

    const dir = path.dirname(outPath!);
    if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(outPath!, JSON.stringify(out, null, 2), "utf8");
    const stats = fs.statSync(outPath!);
    console.log(`[rodo:export] OK -> ${outPath} (${stats.size} bytes)`);
    console.log(
        `[rodo:export]   chats=${chats.length}, msgs=${chatMessages.length}, docs=${documents.length}, versions=${documentVersions.length}, projects=${projects.length}, workflows=${workflows.length}, audit=${auditEntries.length}`,
    );

    // Zapis zdarzenia w audit_log (samo-audyt).
    await appendAuditEvent(db, {
        event_type: "rodo.export",
        actor_user_id: userId!,
        payload: {
            chats: chats.length,
            chat_messages: chatMessages.length,
            documents: documents.length,
            audit_log_entries: auditEntries.length,
            out_path: outPath!,
        },
    });

    console.log("[rodo:export] zdarzenie zapisane w audit_log.");
}

main().catch((err) => {
    console.error("[rodo:export] FATAL:", err);
    process.exit(1);
});
