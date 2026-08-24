// Router REST API dla warstwy audit (ADR-0036).
//
// Obecnie jeden endpoint: GET /api/audit/merkle/verify/:eventId zwraca
// samowystarczalny ProofBundle ktory audytor moze zweryfikowac offline
// przez `audit-merkle-verifier.ts` bez dalszego dostepu do bazy kancelarii.
//
// Autoryzacja: middleware `requireAuth` (ten sam wzorzec co inne routery
// Patrona, np. workflows). Ustawia `res.locals.userId`, rzuca 401 gdy
// brak/zly token. Twarda RBAC admin-only = rezerwacja ADR-0034 (rola
// admin + drugi middleware `requireAdmin` przed `requireAuth` bez zmiany
// kontraktu API).
//
// UI viewer dla audytora (frontend Next.js admin panel) = rezerwacja ADR-0040
// (blocked-by ADR-0034 RBAC).

import { Router, type Request, type Response } from "express";
import { requireAuth, requireAdmin } from "../middleware/auth";
import { createServerSupabase } from "../lib/supabase";
import { fetchProofForEvent, runAutoCompute } from "../lib/audit-merkle-roots";
import { maskPayload } from "../lib/audit-pii-mask";
import {
    buildResponseEvents,
    computeNextCursor,
    parseAuditLogQuery,
    type AuditLogRow,
} from "../lib/audit-log-query";
import { recordAdminAccess } from "../lib/audit-admin-access";
import {
    buildAuditPack,
    buildAuditPackFilename,
    type AuditPackEvent,
} from "../lib/audit-pack";
import {
    buildAuditExportArchive,
    toArchiveFilename,
} from "../lib/audit-export-archive";
// ADR-0152: eksport pakietu dowodowego dla deliverable (wpiecie rdzenia ADR-0066).
import { buildAuditBundle } from "../lib/audit-bundle";
import {
    citationsFromAnnotations,
    modelFromAuditRows,
    buildAuditBundleFilename,
    toPackEvent,
} from "../lib/audit-bundle-source";
import { appendAuditEvent } from "../lib/audit";
import { checkProjectAccess } from "../lib/access";
import {
    buildComputeNowResponse,
    parseComputerByLabel,
} from "../lib/audit-merkle-compute-now";

export const auditRouter = Router();

/**
 * GET /merkle/verify/:eventId
 *
 * Zwraca ProofBundle dla konkretnego eventu z audit_log. Bundle jest
 * samowystarczalny - audytor uzywa `verifyMerkleProof` offline.
 *
 * Status codes:
 *   200 - ProofBundle JSON (event_id, event_hash, proof, merkle_root_id,
 *         merkle_root, chain_block_start, chain_block_end)
 *   400 - eventId nie jest liczba calkowita > 0
 *   401 - brak/niepoprawny JWT (z requireAuth middleware)
 *   403 - user zalogowany ale nie admin (z requireAdmin middleware, ADR-0034)
 *   404 - event nie istnieje lub brak Merkle root pokrywajacego event
 *   500 - blad DB lub nieoczekiwany wyjatek
 */
auditRouter.get(
    "/merkle/verify/:eventId",
    requireAuth,
    requireAdmin,
    async (req: Request, res: Response): Promise<void> => {
        const eventIdRaw = req.params.eventId;
        const eventId = Number.parseInt(eventIdRaw, 10);
        if (!Number.isFinite(eventId) || eventId <= 0 || `${eventId}` !== eventIdRaw) {
            res.status(400).json({
                error: "invalid_event_id",
                detail: "eventId musi byc liczba calkowita > 0",
            });
            return;
        }

        let db: ReturnType<typeof createServerSupabase>;
        try {
            db = createServerSupabase();
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            res.status(500).json({ error: "supabase_unavailable", detail: msg });
            return;
        }

        const result = await fetchProofForEvent(db, eventId);
        if (!result.ok) {
            const error = result.error ?? "unknown_error";
            if (error.includes("nie istnieje") || error.includes("brak Merkle root")) {
                res.status(404).json({ error: "not_found", detail: error });
                return;
            }
            res.status(500).json({ error: "fetch_failed", detail: error });
            return;
        }

        res.status(200).json(result.bundle);
    },
);

/**
 * GET /api/audit/log
 *
 * Endpoint listy audit_log dla audytora (ADR-0040 faza 1). Paginacja cursor-
 * based, filtrowanie po event_type/actor/since/until, maskowanie PII server-
 * side.
 *
 * Query params (patrz parseAuditLogQuery): event_type, actor_user_id, since,
 * until, limit (1-200, default 50), cursor.
 *
 * Status codes:
 *   200 - { events, next_cursor }
 *   400 - invalid query param
 *   401 - brak/niepoprawny JWT
 *   403 - non-admin
 *   500 - blad DB
 */
auditRouter.get(
    "/log",
    requireAuth,
    requireAdmin,
    async (req: Request, res: Response): Promise<void> => {
        // ADR-0043: log admin access do audit_log (meta-audit AI Act art. 12)
        try {
            const db = createServerSupabase();
            void recordAdminAccess({
                db,
                event_type: "admin.access.audit_viewer",
                actor_user_id: (res.locals.userId as string | null) ?? null,
                actor_email: (res.locals.userEmail as string | null) ?? null,
                method: req.method,
                path: req.originalUrl,
                query: req.query as Record<string, unknown>,
            });
        } catch {
            /* graceful per ADR-0043 - audit_log fail nie blokuje endpointu */
        }

        const parsed = parseAuditLogQuery(req.query as Record<string, unknown>);
        if (!parsed.ok || !parsed.filter) {
            res.status(400).json({
                error: "invalid_query",
                detail: parsed.error ?? "unknown parse error",
            });
            return;
        }
        const filter = parsed.filter;

        let db: ReturnType<typeof createServerSupabase>;
        try {
            db = createServerSupabase();
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            res.status(500).json({ error: "supabase_unavailable", detail: msg });
            return;
        }

        try {
            let q = db
                .from("audit_log")
                .select(
                    "id, event_type, actor_user_id, chat_id, document_id, ts, hash, prev_hash, payload",
                )
                .gte("ts", filter.since)
                .lte("ts", filter.until)
                .order("id", { ascending: false })
                .limit(filter.limit);

            if (filter.event_type !== null) {
                q = q.eq("event_type", filter.event_type);
            }
            if (filter.actor_user_id !== null) {
                q = q.eq("actor_user_id", filter.actor_user_id);
            }
            if (filter.cursor !== null) {
                q = q.lt("id", filter.cursor);
            }

            const { data, error } = await q;
            if (error) {
                res.status(500).json({
                    error: "audit_log_query_failed",
                    detail: error.message,
                });
                return;
            }

            const rows = (data ?? []) as AuditLogRow[];
            const events = buildResponseEvents(rows, maskPayload);
            const next_cursor = computeNextCursor(rows, filter.limit);

            res.status(200).json({ events, next_cursor });
        } catch (err) {
            res.status(500).json({
                error: "internal_error",
                detail: err instanceof Error ? err.message : "unknown",
            });
        }
    },
);

/**
 * GET /api/audit/export/:eventId
 *
 * Eksport samowystarczalnego archiwum audytowego dla audytora zewnetrznego
 * (UODO, rewident kancelarii, biegly w postepowaniu). Archiwum ZIP zawiera:
 *   - audit pack JSON: event z audit_log (payload zamaskowany per ADR-0040),
 *     Merkle proof bundle (ADR-0026, ADR-0036), SHA-256 integrity
 *   - SPRAWDZ-TEN-PLIK.html - weryfikator przegladarkowy, zero instalacji
 *   - verify.py - weryfikator wiersza polecen, sama biblioteka standardowa
 *   - CZYTAJ-TO-NAJPIERW.txt - instrukcja dla odbiorcy
 *
 * Patrz ADR-0047 (pack) i ADR-0142 (weryfikator w paczce). Odbiorca NIE
 * potrzebuje repozytorium Patrona - to byla dokladnie luka zamknieta w 0142.
 *
 * Loguje admin.access.audit_export do audit_log (ADR-0043 meta-audit).
 *
 * Status codes:
 *   200 - archiwum ZIP, Content-Disposition: attachment z filename
 *   400 - eventId nie jest liczba calkowita > 0
 *   401 - brak/niepoprawny JWT
 *   403 - non-admin
 *   404 - event nie istnieje LUB brak Merkle root pokrywajacego event
 *         (audytor musi poczekac na auto-trigger ADR-0036 lub manualny
 *         compute root przez admina kancelarii)
 *   500 - blad DB albo blad skladania archiwum (error: "archive_failed")
 */
auditRouter.get(
    "/export/:eventId",
    requireAuth,
    requireAdmin,
    async (req: Request, res: Response): Promise<void> => {
        const eventIdRaw = req.params.eventId;
        const eventId = Number.parseInt(eventIdRaw, 10);
        if (!Number.isFinite(eventId) || eventId <= 0 || `${eventId}` !== eventIdRaw) {
            res.status(400).json({
                error: "invalid_event_id",
                detail: "eventId musi byc liczba calkowita > 0",
            });
            return;
        }

        let db: ReturnType<typeof createServerSupabase>;
        try {
            db = createServerSupabase();
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            res.status(500).json({ error: "supabase_unavailable", detail: msg });
            return;
        }

        // ADR-0043: log dostepu admin (graceful, NIE blokuje eksportu)
        void recordAdminAccess({
            db,
            event_type: "admin.access.audit_export",
            actor_user_id: (res.locals.userId as string | null) ?? null,
            actor_email: (res.locals.userEmail as string | null) ?? null,
            method: req.method,
            path: req.originalUrl,
            query: { eventId: String(eventId) },
        });

        // 1. Pobierz event z audit_log (pelny rzad, do zbudowania AuditPackEvent)
        let eventRow: AuditLogRow;
        try {
            const evRes = await db
                .from("audit_log")
                .select(
                    "id, event_type, actor_user_id, chat_id, document_id, ts, hash, prev_hash, payload",
                )
                .eq("id", eventId)
                .single();
            if (evRes.error || !evRes.data) {
                res.status(404).json({
                    error: "not_found",
                    detail: `event ${eventId} nie istnieje`,
                });
                return;
            }
            eventRow = evRes.data as AuditLogRow;
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            res.status(500).json({ error: "fetch_failed", detail: msg });
            return;
        }

        // 2. Pobierz Merkle proof bundle (per ADR-0036)
        const proofResult = await fetchProofForEvent(db, eventId);
        if (!proofResult.ok || !proofResult.bundle) {
            const error = proofResult.error ?? "unknown_error";
            if (error.includes("nie istnieje") || error.includes("brak Merkle root")) {
                res.status(404).json({ error: "not_found", detail: error });
                return;
            }
            res.status(500).json({ error: "fetch_failed", detail: error });
            return;
        }

        // 3. Zbuduj AuditPackEvent (payload zamaskowany server-side)
        const packEvent: AuditPackEvent = {
            id: eventRow.id,
            event_type: eventRow.event_type,
            ts: eventRow.ts,
            actor_user_id: eventRow.actor_user_id,
            chat_id: eventRow.chat_id,
            document_id: eventRow.document_id,
            hash: eventRow.hash,
            prev_hash: eventRow.prev_hash,
            payload_masked: maskPayload(eventRow.payload),
        };

        // 4. Sklej pack z integrity SHA256
        const exportedAt = new Date().toISOString();
        const pack = buildAuditPack({
            exporter: {
                user_id: (res.locals.userId as string | null) ?? null,
                email: (res.locals.userEmail as string | null) ?? null,
            },
            event: packEvent,
            bundle: proofResult.bundle,
            exportedAt,
        });

        // 5. Zwroc archiwum ZIP: pack + weryfikatory + instrukcja (ADR-0142).
        //    Sam JSON nie wystarcza - odbiorca nie ma czym go sprawdzic.
        const jsonFilename = buildAuditPackFilename(eventId, exportedAt);
        const archiveFilename = toArchiveFilename(jsonFilename);
        let archive: Buffer;
        try {
            archive = await buildAuditExportArchive({
                artifact: pack,
                artifactFilename: jsonFilename,
                timestamp: new Date(exportedAt),
            });
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            res.status(500).json({ error: "archive_failed", detail: msg });
            return;
        }

        res.setHeader("Content-Type", "application/zip");
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="${archiveFilename}"`,
        );
        res.setHeader("Content-Length", String(archive.length));
        res.status(200).send(archive);
    },
);

/**
 * POST /api/audit/merkle/compute-now
 *
 * Wymusza compute next Merkle root bez czekania na auto-trigger ADR-0036
 * (count >= 1000 LUB interval >= 24h). Bypass thresholdami "forsuje":
 * countThreshold=1, intervalMs=0 - kazdy nowy event w audit_log
 * wystarczy do compute.
 *
 * Use case: audytor UODO klika "Pobierz audit pack" w UI viewera
 * (ADR-0046, ADR-0047), dostaje 404 "brak Merkle root pokrywajacego event"
 * bo event byl od ostatniego roota a auto-trigger jeszcze nie strzelil.
 * Frontend pokazuje drugi button "Wymus compute root", wywoluje ten
 * endpoint, audytor ponawia eksport.
 *
 * Patrz ADR-0048. Logika compute reuse z ADR-0036 (`runAutoCompute`).
 *
 * Loguje admin.access.merkle_compute_now do audit_log per ADR-0043
 * (meta-audyt kto kiedy wymusil compute).
 *
 * Status codes:
 *   200 - { computed: true, reason, root } gdy insert root udany
 *   200 - { computed: false, reason } gdy brak nowych eventow (no_new_events)
 *   200 - { computed: false, reason, error } gdy decyzja=compute ale insert failed
 *   401 - brak/niepoprawny JWT
 *   403 - non-admin
 *   500 - Supabase unavailable
 *
 * Uwaga: 200 dla "no_new_events" jest swiadome - to nie blad, kancelaria po
 * prostu nie ma nowych eventow od ostatniego roota. Frontend rozroznia
 * computed=true/false aby zdecydowac czy ponawiac eksport.
 */
auditRouter.post(
    "/merkle/compute-now",
    requireAuth,
    requireAdmin,
    async (req: Request, res: Response): Promise<void> => {
        const actorUserId = (res.locals.userId as string | null) ?? null;
        const actorEmail = (res.locals.userEmail as string | null) ?? null;

        let db: ReturnType<typeof createServerSupabase>;
        try {
            db = createServerSupabase();
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            res.status(500).json({ error: "supabase_unavailable", detail: msg });
            return;
        }

        // ADR-0043: log dostepu admin (graceful, NIE blokuje compute)
        void recordAdminAccess({
            db,
            event_type: "admin.access.merkle_compute_now",
            actor_user_id: actorUserId,
            actor_email: actorEmail,
            method: req.method,
            path: req.originalUrl,
        });

        const computedByLabel = parseComputerByLabel(actorEmail, actorUserId);

        const result = await runAutoCompute(db, {
            countThreshold: 1, // FORCE_COUNT_THRESHOLD - kazdy nowy event wymusza compute
            intervalMs: 0,     // FORCE_INTERVAL_MS - bypass wymogu wieku ostatniego roota
            computedBy: computedByLabel,
        });

        const response = buildComputeNowResponse(result);
        res.status(200).json(response);
    },
);


// ---------------------------------------------------------------------------
// GET /api/audit/bundle/:messageId - pakiet dowodowy dla JEDNEGO deliverable
// ---------------------------------------------------------------------------
//
// Rozni sie od /export/:eventId (ADR-0047) przedmiotem i odbiorca:
//   - /export/:eventId  = POJEDYNCZE ZDARZENIE z dziennika, dla audytora, admin-only
//   - /bundle/:messageId = CALY DOKUMENT KONCOWY z dowodem, jak powstal, dla mecenasa
//
// Dlatego NIE jest admin-only: pakietu potrzebuje autor pisma, gdy klient albo
// regulator pyta "jak powstala ta analiza". Zamiast uprawnien admina obowiazuje
// granica sprawy (ADR-0148): dostep ma wlasciciel czatu albo osoba z dostepem do
// projektu. Sam eksport wynosi tresc z kancelarii, wiec zostawia slad w hash-chain
// jako `deliverable.bundle_export` (ADR-0152, migracja 020 + rebuild SQLite v6).
//
// Zawartosc archiwum: bundle JSON + oba weryfikatory + instrukcja (ADR-0142).
// Odbiorca nie potrzebuje repozytorium Patrona ani instalacji czegokolwiek.
//
// Status codes:
//   200 - archiwum ZIP
//   400 - wiadomosc nie jest odpowiedzia asystenta (nie ma czego dowodzic)
//   401 - brak/niepoprawny JWT
//   404 - wiadomosc nie istnieje LUB brak dostepu (nie zdradzamy ktore)
//   500 - blad DB albo skladania archiwum
auditRouter.get(
    "/bundle/:messageId",
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
        const messageId = String(req.params.messageId ?? "");
        if (!messageId) {
            res.status(400).json({ error: "invalid_message_id" });
            return;
        }
        const userId = (res.locals.userId as string | null) ?? null;
        const userEmail = (res.locals.userEmail as string | null) ?? null;
        if (!userId) {
            res.status(401).json({ error: "unauthenticated" });
            return;
        }

        let db: ReturnType<typeof createServerSupabase>;
        try {
            db = createServerSupabase();
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            res.status(500).json({ error: "supabase_unavailable", detail: msg });
            return;
        }

        // 1. Wiadomosc = deliverable. Tylko odpowiedz asystenta ma sens jako dowod.
        let msg: {
            id: string;
            chat_id: string;
            role: string;
            content: string | null;
            annotations: unknown;
        };
        try {
            const r = await db
                .from("chat_messages")
                .select("id, chat_id, role, content, annotations")
                .eq("id", messageId)
                .maybeSingle();
            if (r.error || !r.data) {
                res.status(404).json({ error: "not_found" });
                return;
            }
            msg = r.data as typeof msg;
        } catch (e) {
            const detail = e instanceof Error ? e.message : String(e);
            res.status(500).json({ error: "fetch_failed", detail });
            return;
        }
        if (msg.role !== "assistant") {
            res.status(400).json({
                error: "not_a_deliverable",
                detail: "pakiet dowodowy sklada sie dla odpowiedzi asystenta",
            });
            return;
        }

        // 2. Granica sprawy (ADR-0148): wlasciciel czatu albo dostep do projektu.
        //    Brak dostepu zwracamy jako 404 - istnienie cudzej wiadomosci tez jest
        //    informacja o aktach.
        try {
            const c = await db
                .from("chats")
                .select("id, user_id, project_id")
                .eq("id", msg.chat_id)
                .maybeSingle();
            const chat = c.data as
                | { id: string; user_id: string; project_id: string | null }
                | null;
            if (c.error || !chat) {
                res.status(404).json({ error: "not_found" });
                return;
            }
            let wolno = chat.user_id === userId;
            if (!wolno && chat.project_id) {
                const dostep = await checkProjectAccess(
                    chat.project_id,
                    userId,
                    userEmail,
                    db,
                );
                wolno = dostep.ok;
            }
            if (!wolno) {
                res.status(404).json({ error: "not_found" });
                return;
            }
        } catch (e) {
            const detail = e instanceof Error ? e.message : String(e);
            res.status(500).json({ error: "fetch_failed", detail });
            return;
        }

        // 3. Wyciag hash-chain dla tego czatu (ADR-0001). Payload maskowany
        //    server-side (ADR-0040) - model czytamy z surowego, przed maskowaniem.
        let rows: Array<{
            id: number;
            event_type: string;
            ts: string;
            actor_user_id: string | null;
            chat_id: string | null;
            document_id: string | null;
            hash: string;
            prev_hash: string;
            payload: unknown;
        }> = [];
        try {
            const r = await db
                .from("audit_log")
                .select(
                    "id, event_type, actor_user_id, chat_id, document_id, ts, hash, prev_hash, payload",
                )
                .eq("chat_id", msg.chat_id)
                .order("ts", { ascending: true });
            if (r.error) {
                const detail = r.error.message ?? "audit_log";
                res.status(500).json({ error: "fetch_failed", detail });
                return;
            }
            rows = (r.data ?? []) as typeof rows;
        } catch (e) {
            const detail = e instanceof Error ? e.message : String(e);
            res.status(500).json({ error: "fetch_failed", detail });
            return;
        }

        const excerpt = rows.map((r) => toPackEvent(r, maskPayload(parseJson(r.payload))));
        const model = modelFromAuditRows(
            rows.map((r) => ({
                event_type: r.event_type,
                ts: r.ts,
                payload: parseJson(r.payload),
            })),
        );
        const citations = citationsFromAnnotations(parseJson(msg.annotations));
        const deliverableMd = msg.content ?? "";

        // 4. Slad wyniesienia PRZED zlozeniem archiwum - tak jak przy paczce
        //    audytora zamiar zapisuje sie, zanim dowod opusci system.
        // FAIL-CLOSED: gdy wpis do dziennika sie nie uda, eksport NIE nastepuje.
        // Powod nie jest teoretyczny: na wdrozeniu Postgres bez migracji 020 CHECK
        // odrzuca nowy `event_type`, a bez tej bramki pakiet z trescia akt wyszedlby
        // z kancelarii BEZ sladu. To jest dokladnie "wylaczenie audytu" zakazane
        // w AGENTS.md, tylko przez pominiecie migracji zamiast przez decyzje.
        //
        // `phase: "requested"` mowi wprost, ze wpis powstaje PRZED zlozeniem
        // archiwum - tak jak przy paczce audytora zamiar rejestruje sie, zanim
        // dowod opusci system. Czytelnik dziennika nie musi zgadywac, czy plik
        // faktycznie dotarl do odbiorcy.
        const slad = await appendAuditEvent(db, {
            event_type: "deliverable.bundle_export",
            actor_user_id: userId,
            chat_id: msg.chat_id,
            document_id: null,
            payload: {
                phase: "requested",
                message_id: msg.id,
                chars: deliverableMd.length,
                citations_total: citations.length,
                audit_events: excerpt.length,
                model,
            },
        });
        if (!slad.ok) {
            res.status(500).json({
                error: "audit_write_failed",
                detail:
                    "Nie udalo sie zapisac wyniesienia w dzienniku - eksport wstrzymany. " +
                    "Sprawdz, czy baza ma migracje 020 (event_type deliverable.bundle_export).",
            });
            return;
        }

        // 5. Bundle + archiwum z weryfikatorami (ADR-0142).
        const exportedAt = new Date().toISOString();
        const bundle = buildAuditBundle({
            chatId: msg.chat_id,
            deliverableMd,
            citations,
            auditLogExcerpt: excerpt,
            modelVersions: { model },
            costLog: {
                available: false,
                full_text_len: deliverableMd.length,
                event_count: excerpt.length,
                note: "Patron nie sledzi jeszcze tokenow ani kosztu per deliverable (ADR-0066).",
            },
            createdAt: exportedAt,
        });

        const jsonFilename = buildAuditBundleFilename(msg.id, exportedAt);
        let archive: Buffer;
        try {
            archive = await buildAuditExportArchive({
                artifact: bundle,
                artifactFilename: jsonFilename,
                timestamp: new Date(exportedAt),
            });
        } catch (e) {
            const detail = e instanceof Error ? e.message : String(e);
            res.status(500).json({ error: "archive_failed", detail });
            return;
        }

        res.setHeader("Content-Type", "application/zip");
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="${toArchiveFilename(jsonFilename)}"`,
        );
        res.status(200).send(archive);
    },
);

/** SQLite trzyma JSON jako tekst, Postgres jako jsonb - przyjmujemy oba. */
function parseJson(value: unknown): unknown {
    if (typeof value !== "string") return value;
    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
}
