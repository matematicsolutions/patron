// Audit trail hash-chain dla zdarzen Patrona (AI Act art. 12 + RODO art. 32).
//
// Idea: kazdy rekord w `audit_log` zawiera `prev_hash` poprzedniego rekordu
// oraz wlasny `hash` policzony z konkatenacji `prev_hash + canonical_json(...)`.
// Modyfikacja albo usuniecie srodkowego rekordu zrywa lancuch i zostanie
// wykryta przez weryfikator (`scripts/verify-audit-chain.ts`).
//
// Hash to SHA-256 hex (64 znaki, lower-case). Genesis = "0".repeat(64).
//
// Bezpieczne uzycie:
//   await appendAuditEvent(db, {
//     event_type: "chat.message.assistant",
//     actor_user_id: userId,
//     chat_id: chatId,
//     payload: { model, full_text_len: fullText.length, citation_count, mcp_count },
//   });
//
// Konwencja nazewnictwa event_type w Patronie (ADR-0035).
// Kolumna `event_type` w schemacie ma CHECK constraint `audit_log_event_type_whitelist`
// (migracja 001_audit_log_event_type_check.sql). Lista ponizej JEST lustrem tego
// CHECK - kazda zmiana wymaga nowej migracji + ADR + bump tej staloj.
//
// Status "uzywane" znaczy: istnieje wywolanie appendAuditEvent z ta wartoscia
// w produkcyjnym kodzie (poza testami).
//
// W CHECK constraint (whitelist 7 produkcyjnych):
//   - "chat.message.user"        UZYWANE - routes/chat.ts, routes/projectChat.ts
//   - "chat.message.assistant"   UZYWANE - routes/chat.ts, routes/projectChat.ts
//   - "input_security_scan"      UZYWANE - routes/documents.ts via lib/input-security (ADR-0020)
//   - "mcp_security.gateway"     UZYWANE - lib/mcp/audit-bridge.ts (ADR-0033)
//   - "ring_policy.decision"     UZYWANE - lib/mcp/audit-bridge.ts (ADR-0027)
//   - "rodo.delete"              UZYWANE - scripts/rodo-delete.ts (RODO art. 17)
//   - "rodo.export"              UZYWANE - scripts/rodo-export.ts (RODO art. 20)
//
// NIE w CHECK (rezerwacje pod przyszle migracje):
//   - "chat.created"             REZERWACJA - obecnie tylko w audit.test.ts (sample hash-chain)
//   - "tool.call"                REZERWACJA - obecnie tylko w audit.test.ts (sample hash-chain)
//   - "entities.extracted"       REZERWACJA - planowane w lib/graph/extractor.ts (komentarz)
//
// UWAGA: payload trafia do bazy w pelnej formie - nie wkladaj tam pelnych
// tresci dokumentow ani osobowych danych klientow kancelarii. Domyslnie
// trzymaj sie skrotow (hashy, dlugosci, identyfikatorow).

import crypto from "crypto";
import type { createServerSupabase } from "./supabase";

export const GENESIS_HASH = "0".repeat(64);

/**
 * Whitelist event_type dla `appendAuditEvent` - lustro CHECK constraint
 * `audit_log_event_type_whitelist` w bazie (ADR-0035, migracja 001).
 * Dodanie nowej wartosci wymaga: (1) migracji ALTER CHECK, (2) ADR, (3)
 * uzupelnienia komentarza konwencji powyzej.
 */
export const EVENT_TYPES = [
    "chat.message.user",
    "chat.message.assistant",
    "input_security_scan",
    "mcp_security.gateway",
    "ring_policy.decision",
    "rodo.delete",
    "rodo.export",
    // ADR-0043: meta-audit dla AI Act art. 12 - dostep admin do endpointow
    // chronionych RBAC (audit viewer, banner status, metrics scrape).
    // Wymaga migracji 002 ALTER CHECK whitelist.
    "admin.access.audit_viewer",
    "admin.access.audit_export",
    "admin.access.merkle_compute_now",
    "admin.access.security_banner",
    "admin.access.metrics",
    // ADR-0038 rezerwacja: log rollbacku migracji (DOWN aplikacja).
    "migrate.rollback",
    // ADR-0067: governance routingu LLM - per-call audit straznika data-residency
    // (model, dostawca, strefa egress, klasyfikacja danych, decyzja allow/block,
    // realny koszt, latencja). Dowod nalezytej starannosci AI Act art. 12 +
    // egzekwowanie tajemnicy zawodowej. Wymaga migracji 005 ALTER CHECK whitelist.
    // Lustro: schema.sqlite.ts, schema.sql, migrations/005. Patrz lib/routing/.
    "llm_route",
    // ADR-0068: uruchomienie pipeline obrony /draft/refine (Recenzent/Adwokat
    // diabla/Pisz po ludzku) - kto/kiedy/etapy/model/klasyfikacja high-stakes/
    // czas, bez tresci draftu. AI Act art. 12. Wymaga migracji 007 ALTER CHECK.
    // Lustro: schema.sqlite.ts, schema.sql, migrations/007. Patrz routes/draft.ts.
    "defense.pipeline.run",
    // ADR-0070: rozstrzygniecie tracked-change (accept/reject) nadpisuje bajty
    // dokumentu prawnego in-place - kto/kiedy/ktora zmiana/tryb. AI Act art. 12
    // (dotad mutacja bez sladu). Wymaga migracji 008 ALTER CHECK.
    // Lustro: schema.sqlite.ts, schema.sql, migrations/008. Patrz routes/documents.ts.
    "document.edit_resolved",
    // ADR-0082: rollup mechanicznej weryfikacji cytatow tabular (ADR-0080) na
    // przebieg generacji/regeneracji - liczby cytatow zweryfikowanych/
    // zmodyfikowanych/niezweryfikowanych, bez tresci cytatu. Werdykt z mutowalnej
    // komorki staje sie niezmiennym sladem (AI Act art. 12, dowod anty-halucynacja).
    // Wymaga migracji 009 ALTER CHECK. Lustro: schema.sqlite.ts, schema.sql,
    // migrations/009. Patrz routes/tabular.ts + lib/tabular/audit-grounding.ts.
    "tabular.grounding",
    // ADR-0117 (audyt P2 #6): swiadoma zgoda Operatora na model chmurowy
    // per-sprawa (wlaczenie/wylaczenie) - kto/kiedy/ktora sprawa/stan, bez tresci.
    // AI Act art. 12 (decyzja zmieniajaca brame egress). Wymaga ALTER CHECK
    // whitelist: sqlite przez runSqliteMigrations v2 (rebuild audit_log),
    // Postgres migracja 012. Lustro: schema.sqlite.ts, schema.sql, migrations/012.
    "project.cloud_consent",
] as const;

/** Union literal lustrzany dla CHECK constraint w audit_log. */
export type EventType = (typeof EVENT_TYPES)[number];

/**
 * Runtime guard - zwraca `true` gdy wartosc nalezy do whitelist. Sluzy
 * jako miekka bramka w punktach gdzie `event_type` przychodzi jako string
 * (np. z external API albo z replay'a audit_log).
 */
export function isEventType(value: string): value is EventType {
    return (EVENT_TYPES as ReadonlyArray<string>).includes(value);
}

export interface AuditEventInput {
    /** Krotka nazwa zdarzenia z whitelist (ADR-0035). Patrz `EVENT_TYPES`. */
    event_type: EventType;
    /** UUID uzytkownika z auth.users (jesli zdarzenie pochodzi od czlowieka). */
    actor_user_id?: string | null;
    /** UUID czatu w kontekscie ktorego zaszlo zdarzenie. */
    chat_id?: string | null;
    /** UUID dokumentu (np. dla doc.read / doc.edit). */
    document_id?: string | null;
    /** Dowolne ustrukturyzowane pola opisujace zdarzenie. Bez PII pelnotekstowego. */
    payload?: Record<string, unknown>;
}

interface PreparedAuditRow extends AuditEventInput {
    ts: string;
    prev_hash: string;
    hash: string;
}

/**
 * Kanoniczna serializacja JSON - klucze sortowane alfabetycznie na kazdym
 * poziomie zagniezdzenia. Daje deterministyczny ciag bajtow do hashowania.
 * Akceptuje tylko JSON-safe wartosci (string, number, boolean, null, array, obj).
 */
export function canonicalJsonStringify(value: unknown): string {
    if (value === null || typeof value !== "object") {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map(canonicalJsonStringify).join(",")}]`;
    }
    const obj = value as Record<string, unknown>;
    // Pomijamy klucze o wartosci undefined - JSON.stringify tez je pomija, wiec
    // round-trip przez JSON.parse nie rozjedzie sie z kanonicznym hashem (inaczej
    // falszywy "tampered" w weryfikacji audit-bundle/pack dla pol opcjonalnych).
    const keys = Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .sort();
    const parts = keys.map(
        (k) => `${JSON.stringify(k)}:${canonicalJsonStringify(obj[k])}`,
    );
    return `{${parts.join(",")}}`;
}

/**
 * Liczy hash rekordu audit_log na bazie poprzedniego hasha + serializowanej
 * tresci (ts, event_type, actor_user_id, payload). Funkcja eksportowana
 * zeby weryfikator mogl jej uzyc niezaleznie od wstawiania.
 */
export function computeAuditHash(args: {
    prev_hash: string;
    ts: string;
    event_type: string;
    actor_user_id?: string | null;
    chat_id?: string | null;
    document_id?: string | null;
    payload?: Record<string, unknown>;
}): string {
    const canon = canonicalJsonStringify({
        ts: args.ts,
        event_type: args.event_type,
        actor_user_id: args.actor_user_id ?? null,
        chat_id: args.chat_id ?? null,
        document_id: args.document_id ?? null,
        payload: args.payload ?? {},
    });
    return crypto
        .createHash("sha256")
        .update(args.prev_hash + canon, "utf8")
        .digest("hex");
}

/**
 * Pobiera hash ostatniego rekordu audit_log (do uzycia jako prev_hash dla
 * nowego). Zwraca GENESIS_HASH jesli tabela jest pusta.
 */
async function getLastHash(
    db: ReturnType<typeof createServerSupabase>,
): Promise<string> {
    const { data, error } = await db
        .from("audit_log")
        .select("hash")
        .order("id", { ascending: false })
        .limit(1);
    if (error) {
        console.warn("[audit] cannot read last hash:", error.message);
        return GENESIS_HASH;
    }
    const row = data?.[0] as { hash?: string } | undefined;
    return row?.hash ?? GENESIS_HASH;
}

/**
 * Dopisuje pojedyncze zdarzenie do audit_log z poprawnym hash-chainem.
 * Nigdy nie rzuca - bledy logowane do konsoli (audit trail nie moze
 * blokowac sciezki produktowej).
 *
 * UWAGA: w wielowątkowym scenariuszu (wiele rownoleglych zdarzen tego
 * samego czatu) wystarczy ze pomiedzy `getLastHash` a `insert` wbiegnie
 * inne zdarzenie - to bedzie kolizja na `hash unique`. Akceptujemy:
 * insert retry-uje raz pobierajac swiezy prev_hash. Wykrycie kolizji
 * przez unique constraint zapewnia ze lancuch zawsze pozostanie spojny.
 */
export async function appendAuditEvent(
    db: ReturnType<typeof createServerSupabase>,
    event: AuditEventInput,
): Promise<{ ok: boolean; row?: PreparedAuditRow; error?: string }> {
    for (let attempt = 0; attempt < 2; attempt++) {
        const prev_hash = await getLastHash(db);
        const ts = new Date().toISOString();
        const hash = computeAuditHash({
            prev_hash,
            ts,
            event_type: event.event_type,
            actor_user_id: event.actor_user_id,
            chat_id: event.chat_id,
            document_id: event.document_id,
            payload: event.payload,
        });

        const row = {
            ts,
            actor_user_id: event.actor_user_id ?? null,
            event_type: event.event_type,
            chat_id: event.chat_id ?? null,
            document_id: event.document_id ?? null,
            payload: event.payload ?? {},
            prev_hash,
            hash,
        };

        const { error } = await db.from("audit_log").insert(row);
        if (!error) {
            return { ok: true, row: { ...event, ts, prev_hash, hash } };
        }
        // 23505 = unique_violation w PostgreSQL. Wystapila race - retry.
        if (
            (error as { code?: string }).code === "23505" &&
            attempt === 0
        ) {
            continue;
        }
        console.warn("[audit] insert failed:", error.message ?? error);
        return { ok: false, error: error.message ?? String(error) };
    }
    return { ok: false, error: "exhausted retries" };
}
