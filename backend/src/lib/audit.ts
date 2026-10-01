// Audit trail hash-chain dla zdarzen Patrona (AI Act art. 12 + RODO art. 32).
//
// Idea: kazdy rekord w `audit_log` zawiera `prev_hash` poprzedniego rekordu
// oraz wlasny `hash` policzony z konkatenacji `prev_hash + canonical_json(...)`.
// Modyfikacja albo usuniecie srodkowego rekordu zrywa lancuch i zostanie
// wykryta przez weryfikator (`scripts/verify-audit-chain.ts`, Supabase i SQLite;
// rdzen w `audit-chain-verify.ts`, ADR-0161).
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
    // ADR-0128 (audyt P2 #6): swiadoma zgoda Operatora na model chmurowy
    // per-sprawa (wlaczenie/wylaczenie) - kto/kiedy/ktora sprawa/stan, bez tresci.
    // AI Act art. 12 (decyzja zmieniajaca brame egress). Wymaga ALTER CHECK
    // whitelist: sqlite przez runSqliteMigrations v2 (rebuild audit_log),
    // Postgres migracja 012. Lustro: schema.sqlite.ts, schema.sql, migrations/012.
    "project.cloud_consent",
    // ADR-0133: zmiana stanu konektora MCP przez picker (mecenas wlacza/wylacza
    // konektor = wybor jurysdykcji). Zmiana powierzchni narzedzi agenta -> AI Act
    // art. 12. Wymaga migracji: SQLite v3 (rebuild) + Postgres 014 (ALTER CHECK).
    // Lustro: schema.sqlite.ts, schema.sql, migrate.sqlite.ts, migrations/014.
    "connector.toggle",
    // ADR-0137: decyzja czlowieka (approve/reject) o karcie zatwierdzenia mutacji
    // (human-in-the-loop write staging) - akt nadzoru nad zapisem agenta -> AI Act
    // art. 14 + 12. Loguje kto/kiedy/typ narzedzia/decyzja/id karty, bez pelnego
    // payloadu mutacji. Wymaga migracji: SQLite v4 (rebuild) + Postgres 016 (ALTER
    // CHECK). Lustro: schema.sqlite.ts, schema.sql, migrate.sqlite.ts, migrations/016.
    "mutation.approval.decision",
    // ADR-0093 (US5): twardy cost-cap per sprawa. Po przekroczeniu progu
    // (PATRON_CASE_COST_CAP_USD) wywolanie LLM jest blokowane PRZED guardEgress,
    // chyba ze operator swiadomie nadpisze. Kazda decyzja (block/override) - sprawa,
    // model, koszt skumulowany, prog - to niezmienny slad (AI Act art. 12, dowod
    // kontroli kosztu). Wymaga migracji 010 ALTER CHECK. Lustro: schema.sqlite.ts,
    // schema.sql, migrations/010. Patrz lib/routing/budget.ts + auditCostCap.ts.
    "cost_cap",
    // ADR-0152: eksport pakietu dowodowego deliverable (audit-bundle).
    // Wyniesienie tresci z kancelarii = akt, ktory musi zostawic slad.
    "deliverable.bundle_export",
    // ADR-0161 wariant B: Operator potwierdza rozwidlenia lancucha sprzed straznika
    // (`npm run audit:acknowledge-forks`). Payload: id i hashe ogniw, prog straznika,
    // bez tresci. Hashe lisci na glownej sciezce przywracaja im ochrone przed cichym
    // usunieciem. Lustro: schema.sqlite.ts, schema.sql, migrate.sqlite.ts (v7),
    // migrations/023.
    "audit.chain.fork_acknowledged",
    // ADR-0164: przerwanie lancucha Z MOCY PRAWA. RODO art. 17 kaze zanonimizowac
    // aktora, AI Act art. 12 kaze zachowac dowod - a `actor_user_id` wchodzi do
    // hasha, wiec zerowanie go NIEUCHRONNIE zrywa lancuch. Tego konfliktu nie da
    // sie rozwiazac po cichu: bez tego zdarzenia weryfikator raportuje skutek
    // wykonania obowiazku prawnego DOKLADNIE tak samo jak sabotaz. Zdarzenie
    // nazywa zerwanie ZANIM ktos je znajdzie - powod, pole, zakres id i licznik,
    // bez danych osobowych (aktor pseudonimizowany hashem, jak w rodo.delete).
    // Wymaga migracji: SQLite v8 (rebuild) + Postgres 025 (ALTER CHECK) - numery
    // po scaleniu linii (ADR-0163), na linii 2.0 byly to v6 i 021.
    // Lustro: schema.sqlite.ts, schema.sql, migrate.sqlite.ts, migrations/025,
    // useAuditLog.ts, audit-filter-bar.tsx. Patrz scripts/rodo-delete.ts.
    "audit.chain.legal_break",
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
 * nowego). GENESIS_HASH tylko wtedy, gdy tabela jest PUSTA.
 *
 * Blad odczytu NIE jest pusta tabela: wczesniej zwracal GENESIS_HASH, wiec
 * chwilowy blad bazy dopisywal drugi poczatek lancucha (ADR-0161). Teraz blad
 * wraca do wolajacego i zapis sie nie odbywa.
 */
async function getLastHash(
    db: ReturnType<typeof createServerSupabase>,
): Promise<{ hash: string } | { error: string }> {
    const { data, error } = await db
        .from("audit_log")
        .select("hash")
        .order("id", { ascending: false })
        .limit(1);
    if (error) {
        return { error: error.message ?? String(error) };
    }
    const row = data?.[0] as { hash?: string } | undefined;
    return { hash: row?.hash ?? GENESIS_HASH };
}

// Kolejka zapisow audytu w obrebie procesu (patrz appendAuditEvent).
// Ile razy zapis moze przegrac wyscig o poprzednika z innym procesem, zanim
// zwroci blad (ADR-0161). Wyscigi miedzy procesami sa rzadkie; osiem prob z
// losowym odstepem pokrywa kilka procesow piszacych naraz.
export const AUDIT_APPEND_MAX_ATTEMPTS = 8;

let appendQueue: Promise<unknown> = Promise.resolve();

/**
 * Dopisuje pojedyncze zdarzenie do audit_log z poprawnym hash-chainem.
 * Nigdy nie rzuca - bledy logowane do konsoli (audit trail nie moze
 * blokowac sciezki produktowej).
 *
 * Zapisy w obrebie procesu ida po kolei (kolejka ponizej). Bez niej rownolegle
 * wywolania - np. fire-and-forget bramy MCP dla kazdego konektora przy starcie -
 * czytaly ten sam `prev_hash` i lancuch sie rozwidlal. `hash unique` tego NIE
 * lapie: hash obejmuje `ts` i payload, wiec dwa ogniwa o wspolnym poprzedniku
 * maja rozne hashe (zmierzone 2026-10-01: 7 zdarzen startu, 6 zlych ogniw).
 * Zapisy z INNEGO procesu (tryb serwerowy, skrypt CLI na tej samej bazie)
 * kolejka nie obejmuje. Te zatrzymuje baza: unikalny `prev_hash` dla wpisow
 * dopisanych po instalacji straznika (ADR-0161, migracja 022 / SQLite
 * `ensureAuditChainGuard`). Przegrany wyscig konczy sie bledem 23505 i petla
 * ponizej czyta swiezy poprzednik, do AUDIT_APPEND_MAX_ATTEMPTS prob.
 */
export function appendAuditEvent(
    db: ReturnType<typeof createServerSupabase>,
    event: AuditEventInput,
): Promise<{ ok: boolean; row?: PreparedAuditRow; error?: string }> {
    const run = appendQueue.then(() => appendAuditEventNow(db, event));
    appendQueue = run.catch(() => undefined);
    return run;
}

async function appendAuditEventNow(
    db: ReturnType<typeof createServerSupabase>,
    event: AuditEventInput,
): Promise<{ ok: boolean; row?: PreparedAuditRow; error?: string }> {
    for (let attempt = 1; attempt <= AUDIT_APPEND_MAX_ATTEMPTS; attempt++) {
        const last = await getLastHash(db);
        if ("error" in last) {
            console.warn("[audit] cannot read last hash:", last.error);
            return { ok: false, error: `cannot read last hash: ${last.error}` };
        }
        const prev_hash = last.hash;
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
        // 23505 = unique_violation (PostgreSQL; shim SQLite mapuje na ten sam
        // kod). Inny proces dopisal ogniwo do tego samego poprzednika - czytamy
        // swiezy i probujemy jeszcze raz, z krotkim losowym odstepem, zeby kilka
        // procesow nie przegrywalo ze soba w tym samym rytmie.
        if ((error as { code?: string }).code === "23505") {
            if (attempt < AUDIT_APPEND_MAX_ATTEMPTS) {
                await new Promise((r) => setTimeout(r, Math.random() * 10 * attempt));
                continue;
            }
            const msg = `audit chain contention: ${AUDIT_APPEND_MAX_ATTEMPTS} attempts lost`;
            console.warn("[audit] insert failed:", msg);
            return { ok: false, error: msg };
        }
        console.warn("[audit] insert failed:", error.message ?? error);
        return { ok: false, error: error.message ?? String(error) };
    }
    return { ok: false, error: "exhausted retries" };
}
