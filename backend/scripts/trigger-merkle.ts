#!/usr/bin/env tsx
// Manualny CLI fallback dla auto-trigger Merkle audit root (ADR-0036).
//
// Uruchomienie:
//   npm run merkle:trigger          (uzywa env PATRON_MERKLE_AUTO_*)
//   tsx scripts/trigger-merkle.ts   (direct)
//
// Uzywa tej samej funkcji `runAutoCompute` co setInterval w `src/index.ts`.
// Roznica: computedBy = "manual" zamiast "auto-scheduler", zeby audytor
// odroznial trigger w `audit_merkle_roots.computed_by`.
//
// Use case: administrator kancelarii chce wymusic swiezy root przed audytem
// (np. dzien przed wizyta UODO) bez czekania na nastepny tick schedulera.
//
// Exit codes:
//   0 - decyzja: skip (no_new_events / below_thresholds) - to nie jest blad
//   0 - decyzja: compute + insert ok
//   1 - blad DB albo compute zwrocil error

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { runAutoCompute } from "../src/lib/audit-merkle-roots";
import {
    parseIntervalHours,
    parsePositiveInt,
} from "../src/lib/audit-merkle-scheduler";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SERVICE_ROLE_KEY =
    process.env.SUPABASE_SECRET_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_KEY ??
    "";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error(
        "[merkle:trigger] Brakuje SUPABASE_URL lub SUPABASE_SECRET_KEY w .env",
    );
    process.exit(1);
}

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
});

const countThreshold = parsePositiveInt(
    process.env.PATRON_MERKLE_AUTO_COUNT_THRESHOLD,
    1000,
);
const intervalMs = parseIntervalHours(
    process.env.PATRON_MERKLE_AUTO_INTERVAL_HOURS,
    24 * 3600 * 1000,
);

async function main(): Promise<void> {
    console.log(
        `[merkle:trigger] thresholds: count=${countThreshold}, interval=${Math.floor(intervalMs / 3600 / 1000)}h`,
    );

    const result = await runAutoCompute(db, {
        countThreshold,
        intervalMs,
        computedBy: "manual",
    });

    console.log(`[merkle:trigger] decyzja: ${result.decision.reason}`);
    if (!result.decision.compute) {
        console.log("[merkle:trigger] skip - nic do roboty");
        return;
    }
    console.log(
        `[merkle:trigger] zakres bloku: [${result.decision.blockStart}, ${result.decision.blockEnd}]`,
    );
    const compute = result.computeResult;
    if (!compute) {
        console.error("[merkle:trigger] BLAD: compute=true ale brak computeResult");
        process.exit(1);
    }
    if (!compute.ok || !compute.root) {
        console.error(`[merkle:trigger] BLAD compute: ${compute.error}`);
        process.exit(1);
    }
    console.log(
        `[merkle:trigger] OK root #${compute.root.id} merkle_root=${compute.root.merkle_root.slice(0, 16)}... event_count=${compute.root.event_count}`,
    );
}

main().catch((e) => {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[merkle:trigger] Nieobsluzony blad: ${msg}`);
    process.exit(1);
});
