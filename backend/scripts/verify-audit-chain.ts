#!/usr/bin/env tsx
// Weryfikator integralnosci audit trail hash-chain.
//
// Uruchomienie:
//   tsx scripts/verify-audit-chain.ts
//
// Skrypt iteruje przez audit_log w kolejnosci id ASC, sprawdzajac:
//   - prev_hash wpisu N == hash wpisu N-1 (dla N=0: prev_hash == GENESIS)
//   - recomputed_hash(...) == zapisany hash (zaden pole payloadu / ts /
//     event_type nie zostalo zmodyfikowane)
//
// Exit code 0 = lancuch OK, 1 = wykryto zerwanie (raport pierwszego incydentu).

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import {
    GENESIS_HASH,
    computeAuditHash,
} from "../src/lib/audit";

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error(
        "[verify] Brakuje SUPABASE_URL lub SUPABASE_SERVICE_ROLE_KEY w .env",
    );
    process.exit(2);
}

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
});

interface AuditRow {
    id: number;
    ts: string;
    actor_user_id: string | null;
    event_type: string;
    chat_id: string | null;
    document_id: string | null;
    payload: Record<string, unknown>;
    prev_hash: string;
    hash: string;
}

async function main() {
    const PAGE = 1000;
    let offset = 0;
    let prevExpected = GENESIS_HASH;
    let verified = 0;
    let firstId: number | null = null;
    let lastId: number | null = null;
    const startedAt = Date.now();

    while (true) {
        const { data, error } = await db
            .from("audit_log")
            .select(
                "id, ts, actor_user_id, event_type, chat_id, document_id, payload, prev_hash, hash",
            )
            .order("id", { ascending: true })
            .range(offset, offset + PAGE - 1);

        if (error) {
            console.error("[verify] read failed:", error.message);
            process.exit(2);
        }
        const rows = (data ?? []) as AuditRow[];
        if (rows.length === 0) break;

        for (const row of rows) {
            if (firstId === null) firstId = row.id;
            lastId = row.id;

            if (row.prev_hash !== prevExpected) {
                console.error(
                    `[verify] FAIL @ id=${row.id} (ts=${row.ts}): prev_hash mismatch`,
                );
                console.error(`  expected: ${prevExpected}`);
                console.error(`  got     : ${row.prev_hash}`);
                console.error(
                    "  -> srodkowy wpis zostal zmodyfikowany lub usuniety",
                );
                process.exit(1);
            }

            const recomputed = computeAuditHash({
                prev_hash: row.prev_hash,
                ts: row.ts,
                event_type: row.event_type,
                actor_user_id: row.actor_user_id,
                chat_id: row.chat_id,
                document_id: row.document_id,
                payload: row.payload,
            });
            if (recomputed !== row.hash) {
                console.error(
                    `[verify] FAIL @ id=${row.id} (ts=${row.ts}): hash mismatch`,
                );
                console.error(`  expected: ${recomputed}`);
                console.error(`  got     : ${row.hash}`);
                console.error(
                    "  -> tresc wpisu zostala zmodyfikowana po wstawieniu",
                );
                process.exit(1);
            }

            prevExpected = row.hash;
            verified++;
        }

        offset += rows.length;
        if (rows.length < PAGE) break;
    }

    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(2);
    console.log(
        `[verify] OK - ${verified} wpisow (id=${firstId ?? "-"}..${lastId ?? "-"}) zweryfikowanych w ${elapsed}s`,
    );
    console.log(`[verify] head hash: ${prevExpected}`);
    process.exit(0);
}

main().catch((err) => {
    console.error("[verify] unhandled error:", err);
    process.exit(2);
});
