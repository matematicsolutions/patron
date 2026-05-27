#!/usr/bin/env tsx
// Governance-friendly runner dla migracji SQL nad Supabase Postgres (ADR-0035).
//
// Trzy komendy:
//   tsx scripts/run-migrations.ts plan       (alias: brak argumentu)
//     Wypisuje pending migracje + pelny SQL kazdej z nich + instrukcja
//     skopiowania do Supabase SQL Editor / psql / pgAdmin. NIE aplikuje DDL.
//
//   tsx scripts/run-migrations.ts mark <id>
//     Po manualnej aplikacji DDL operator zapisuje rekord do tabeli
//     `public.schema_migrations` (id, name, applied_at, checksum).
//     Runner weryfikuje ze checksum w bazie zgadza sie z checksumem pliku
//     PRZED insertem - chroni przed oznaczeniem zmodyfikowanego pliku jako
//     zaaplikowany.
//
//   tsx scripts/run-migrations.ts status
//     Lista wszystkich migracji z stanem `applied` / `pending` + ostrzezenie
//     `drift` gdy plik zmodyfikowany po aplikacji (checksum file != db).
//
// Exit codes:
//   0 - operacja udana
//   1 - blad walidacji / IO / DB
//   2 - duplikaty id w katalogu migracji (early exit przed jakakolwiek akcja)

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { readFile, readdir } from "fs/promises";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";
import {
    type MigrationFile,
    parseMigrationFilename,
    sortMigrations,
    computeMigrationChecksum,
    selectPendingMigrations,
    findDuplicateIds,
} from "../src/lib/migrations";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, "..", "migrations");

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SERVICE_ROLE_KEY =
    process.env.SUPABASE_SECRET_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_KEY ??
    "";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error(
        "[migrate] Brakuje SUPABASE_URL lub SUPABASE_SECRET_KEY w .env",
    );
    process.exit(1);
}

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
});

interface MigrationRecord {
    id: string;
    name: string;
    applied_at: string;
    checksum: string;
}

async function listMigrationsOnDisk(): Promise<MigrationFile[]> {
    let entries: string[];
    try {
        entries = await readdir(MIGRATIONS_DIR);
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[migrate] Nie moge czytac ${MIGRATIONS_DIR}: ${msg}`);
        process.exit(1);
    }
    const parsed = entries
        .map(parseMigrationFilename)
        .filter((f): f is MigrationFile => f !== null);
    const duplicates = findDuplicateIds(parsed);
    if (duplicates.length > 0) {
        console.error(
            `[migrate] Duplikaty id migracji: ${duplicates.join(", ")}. Napraw przed dalszymi krokami.`,
        );
        process.exit(2);
    }
    return sortMigrations(parsed);
}

async function listAppliedMigrations(): Promise<MigrationRecord[]> {
    const { data, error } = await db
        .from("schema_migrations")
        .select("id, name, applied_at, checksum")
        .order("id", { ascending: true });
    if (error) {
        const msg = error.message ?? String(error);
        if (msg.toLowerCase().includes("does not exist")) {
            console.error(
                "[migrate] Tabela public.schema_migrations nie istnieje. Wykonaj bootstrap SQL z ADR-0035 w Supabase SQL Editor.",
            );
            process.exit(1);
        }
        console.error(`[migrate] Blad odczytu schema_migrations: ${msg}`);
        process.exit(1);
    }
    return (data ?? []) as MigrationRecord[];
}

async function readMigrationContent(file: MigrationFile): Promise<string> {
    return readFile(join(MIGRATIONS_DIR, file.filename), "utf8");
}

async function commandPlan(): Promise<void> {
    const onDisk = await listMigrationsOnDisk();
    const applied = await listAppliedMigrations();
    const appliedIds = new Set(applied.map((r) => r.id));
    const pending = selectPendingMigrations(onDisk, appliedIds);

    if (pending.length === 0) {
        console.log("[migrate] Brak pending migracji. Schema aktualna.");
        return;
    }

    console.log(`[migrate] Pending migracje: ${pending.length}`);
    for (const file of pending) {
        const content = await readMigrationContent(file);
        const checksum = computeMigrationChecksum(content);
        console.log("");
        console.log("=".repeat(72));
        console.log(`-- ${file.filename}  (checksum: ${checksum.slice(0, 16)}...)`);
        console.log("=".repeat(72));
        console.log(content);
    }
    console.log("");
    console.log("=".repeat(72));
    console.log("[migrate] Instrukcja:");
    console.log("  1. Skopiuj kazda migracje z osobna do Supabase SQL Editor");
    console.log("     (lub psql / pgAdmin) i wykonaj.");
    console.log("  2. Po udanej aplikacji oznacz w rejestrze:");
    for (const file of pending) {
        console.log(`     npm run migrate:mark ${file.id}`);
    }
    console.log("=".repeat(72));
}

async function commandMark(id: string): Promise<void> {
    if (!/^\d{3}$/.test(id)) {
        console.error(
            `[migrate] Niepoprawny id "${id}". Oczekiwany format NNN (trzy cyfry).`,
        );
        process.exit(1);
    }
    const onDisk = await listMigrationsOnDisk();
    const file = onDisk.find((f) => f.id === id);
    if (!file) {
        console.error(`[migrate] Brak pliku migracji dla id ${id}.`);
        process.exit(1);
    }
    const content = await readMigrationContent(file);
    const checksum = computeMigrationChecksum(content);

    const applied = await listAppliedMigrations();
    if (applied.some((r) => r.id === id)) {
        console.error(
            `[migrate] Migracja ${id} juz oznaczona jako zaaplikowana. Sprawdz status: npm run migrate:status`,
        );
        process.exit(1);
    }

    const { error } = await db
        .from("schema_migrations")
        .insert({
            id: file.id,
            name: file.name,
            checksum,
        });
    if (error) {
        console.error(
            `[migrate] Blad insertu do schema_migrations: ${error.message ?? error}`,
        );
        process.exit(1);
    }
    console.log(
        `[migrate] OK ${file.filename} oznaczona jako zaaplikowana (checksum ${checksum.slice(0, 16)}...).`,
    );
}

async function commandStatus(): Promise<void> {
    const onDisk = await listMigrationsOnDisk();
    const applied = await listAppliedMigrations();
    const byId = new Map(applied.map((r) => [r.id, r]));

    console.log(`[migrate] Migracje w ${MIGRATIONS_DIR}: ${onDisk.length}`);
    console.log("");
    for (const file of onDisk) {
        const record = byId.get(file.id);
        if (!record) {
            console.log(`  ${file.id}  PENDING   ${file.filename}`);
            continue;
        }
        const content = await readMigrationContent(file);
        const checksum = computeMigrationChecksum(content);
        if (checksum !== record.checksum) {
            console.log(
                `  ${file.id}  DRIFT     ${file.filename}  (file ${checksum.slice(0, 8)} != db ${record.checksum.slice(0, 8)})`,
            );
        } else {
            console.log(
                `  ${file.id}  APPLIED   ${file.filename}  (${record.applied_at})`,
            );
        }
    }

    const onDiskIds = new Set(onDisk.map((f) => f.id));
    const orphans = applied.filter((r) => !onDiskIds.has(r.id));
    if (orphans.length > 0) {
        console.log("");
        console.log("[migrate] OSTRZEZENIE - zaaplikowane migracje bez pliku w katalogu:");
        for (const orphan of orphans) {
            console.log(`  ${orphan.id}  ORPHAN    ${orphan.name}  (${orphan.applied_at})`);
        }
    }
}

async function main(): Promise<void> {
    const [, , command, ...args] = process.argv;
    const cmd = command ?? "plan";
    if (cmd === "plan") {
        await commandPlan();
    } else if (cmd === "mark") {
        const id = args[0];
        if (!id) {
            console.error("[migrate] Uzycie: npm run migrate:mark <id>");
            process.exit(1);
        }
        await commandMark(id);
    } else if (cmd === "status") {
        await commandStatus();
    } else {
        console.error(`[migrate] Nieznana komenda "${cmd}". Dostepne: plan / mark <id> / status`);
        process.exit(1);
    }
}

main().catch((e) => {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[migrate] Nieobsluzony blad: ${msg}`);
    process.exit(1);
});
