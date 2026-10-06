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
    checkStoredRowHash,
    resolveLegalBreak,
    toVerifiablePackEvent,
    type AuditPackEvent,
    type LegalBreakResolution,
    type StoredAuditRow,
} from "../lib/audit-pack";
import { LEGAL_BREAK_EVENT } from "../lib/audit-chain-verify";
import {
    buildAuditExportArchive,
    toArchiveFilename,
} from "../lib/audit-export-archive";
// ADR-0152: eksport pakietu dowodowego dla deliverable (wpiecie rdzenia ADR-0066).
import { annotateExcerptLinks, buildAuditBundle } from "../lib/audit-bundle";
import {
    citationsFromAnnotations,
    modelForMessage,
    buildAuditBundleFilename,
} from "../lib/audit-bundle-source";
import { appendAuditEvent, GENESIS_HASH } from "../lib/audit";
import {
    acknowledgeForks,
    ackHttpStatus,
    getChainStatus,
    isAckDigest,
} from "../lib/audit-chain-status";
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
            if (result.code === "not_found" || result.code === "no_root") {
                res.status(404).json({ error: "not_found", detail: error });
                return;
            }
            if (result.code === "root_mismatch") {
                res.status(409).json({
                    error: "merkle_root_mismatch",
                    detail: error,
                    root_ids: result.mismatchedRootIds ?? [],
                });
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
 *   200 - takze dla wpisu zanonimizowanego na podstawie RODO art. 17, gdy
 *         obejmuje go WAZNA deklaracja audit.chain.legal_break (ADR-0164,
 *         decyzja wlasciciela produktu 2026-10-06): zdarzenie w paczce niesie
 *         znacznik legal_break, a wiersz deklaracji jedzie jako
 *         legal_break_declaration; weryfikatory daja osobny stan (verify.py: 3)
 *   409 - ODMOWA: wpis nie przechodzi kontroli serwera (audyt 2026-09, C-04):
 *         event_hash_mismatch   - hash przeliczony z tresci != kolumna hash i
 *                                 brak waznej deklaracji zerwania z mocy prawa;
 *                                 pole legal_break w odpowiedzi mowi, czemu
 *                                 deklaracja nie wystarczyla (old_format,
 *                                 content_differs, field_not_null)
 *         event_parent_missing  - poprzednika (prev_hash) nie ma w dzienniku
 *                                 albo jest pozniejszy (usuniety / wstawka)
 *         merkle_root_mismatch  - dowod nie odtwarza ktoregos z korzeni
 *                                 obejmujacych wpis
 *         Odmowa zostawia slad admin.access.audit_export z phase "refused".
 *         Paczki, ktora potwierdzalaby nienaruszonosc takiego wpisu, nie ma.
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

        // 2. Tresc wpisu kontra jego hash (audyt 2026-09, C-04). Lisciem Merkle
        //    jest KOLUMNA hash, wiec dowod sam nie widzi zmiany payloadu, ts czy
        //    event_type zrobionej SQL-em. Przeliczamy hash z pelnej (NIEzamaskowanej)
        //    tresci - odbiorca tego nie zrobi, bo dostaje payload zamaskowany.
        //    Niezgodnosc = ODMOWA, nie paczka z werdyktem: paczka jest dowodem
        //    wydawanym na zewnatrz, a z niezgodnym wpisem nie ma czego dowodzic.
        //    Odmowa zostawia slad w dzienniku i mowi adminowi, gdzie szukac.
        const odmowa = async (
            reason: "event_hash_mismatch" | "event_parent_missing" | "merkle_root_mismatch",
            detail: string,
            legalBreak?: { status: string; declaration_event_id: number | null },
        ): Promise<void> => {
            await appendAuditEvent(db, {
                event_type: "admin.access.audit_export",
                actor_user_id: (res.locals.userId as string | null) ?? null,
                payload: {
                    phase: "refused",
                    event_id: eventId,
                    reason,
                    ...(legalBreak ? { legal_break: legalBreak } : {}),
                },
            });
            res.status(409).json({ error: reason, detail, ...(legalBreak ? { legal_break: legalBreak } : {}) });
        };

        const stored: StoredAuditRow = {
            id: eventRow.id,
            ts: eventRow.ts,
            event_type: eventRow.event_type,
            actor_user_id: eventRow.actor_user_id,
            chat_id: eventRow.chat_id,
            document_id: eventRow.document_id,
            payload: parseJson(eventRow.payload),
            prev_hash: eventRow.prev_hash,
            hash: eventRow.hash,
        };
        const hashCheck = checkStoredRowHash(stored);
        let hashedTs = hashCheck.ts;
        // 2a. Zerwanie z mocy prawa (ADR-0164, decyzja 2026-10-06). Wpis
        //     zanonimizowany przez scripts/rodo-delete.ts ma hash niezgodny z
        //     trescia z mocy prawa. Eksport idzie TYLKO, gdy obejmuje go wazna
        //     deklaracja audit.chain.legal_break z hashem po zerwaniu, a obecna
        //     tresc daje dokladnie ten hash (resolveLegalBreak). Inaczej odmowa
        //     jak dotad - w tym dla deklaracji w starym formacie (uzasadnienie
        //     przy LegalBreakResolution w lib/audit-pack.ts).
        let zerwanie: Extract<LegalBreakResolution, { status: "verified" }> | null = null;
        if (!hashCheck.ok) {
            let deklaracje: StoredAuditRow[];
            try {
                deklaracje = await czytajDeklaracje(db, eventId);
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                res.status(500).json({ error: "fetch_failed", detail: msg });
                return;
            }
            const r = resolveLegalBreak(stored, deklaracje);
            if (r.status !== "verified") {
                await odmowa(
                    "event_hash_mismatch",
                    opisOdmowyZerwania(`wpisu ${eventId}`, r),
                    r.status === "none"
                        ? undefined
                        : { status: r.status, declaration_event_id: r.declarationEventId ?? null },
                );
                return;
            }
            zerwanie = r;
            hashedTs = r.ts;
        }

        // 2b. Poprzednik: wiersz o hashu prev_hash musi istniec i byc wczesniejszy.
        //     Wykrywa usuniety poprzednik (dowod Merkle bloku tego nie widzi, gdy
        //     korzen policzono po usunieciu).
        if (stored.prev_hash !== GENESIS_HASH) {
            try {
                const pr = await db
                    .from("audit_log")
                    .select("id")
                    .eq("hash", stored.prev_hash)
                    .limit(1);
                if (pr.error) {
                    res.status(500).json({ error: "fetch_failed", detail: pr.error.message });
                    return;
                }
                const parent = (pr.data ?? [])[0] as { id: number } | undefined;
                if (!parent || parent.id >= eventId) {
                    await odmowa(
                        "event_parent_missing",
                        `Poprzednika wpisu ${eventId} (prev_hash) nie ma w dzienniku albo jest pozniejszy - ` +
                            "wpis usunieto albo wstawiono wstecz. Stan lancucha: GET /api/audit/chain.",
                    );
                    return;
                }
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                res.status(500).json({ error: "fetch_failed", detail: msg });
                return;
            }
        }

        // 3. Merkle proof bundle (ADR-0036) - zgodny z KAZDYM korzeniem
        //    obejmujacym wpis, wskazuje najstarsza pieczec.
        const proofResult = await fetchProofForEvent(db, eventId);
        if (!proofResult.ok || !proofResult.bundle) {
            const error = proofResult.error ?? "unknown_error";
            if (proofResult.code === "not_found" || proofResult.code === "no_root") {
                res.status(404).json({ error: "not_found", detail: error });
                return;
            }
            if (proofResult.code === "root_mismatch") {
                await odmowa("merkle_root_mismatch", error);
                return;
            }
            res.status(500).json({ error: "fetch_failed", detail: error });
            return;
        }
        if (proofResult.bundle.event_hash !== stored.hash) {
            // Wiersz zmienil sie miedzy odczytami - nie wydajemy niespojnej paczki.
            await odmowa(
                "event_hash_mismatch",
                `Hash wpisu ${eventId} zmienil sie w trakcie eksportu - sprobuj ponownie albo sprawdz lancuch.`,
            );
            return;
        }

        // Zdarzenie do paczki: payload zamaskowany server-side (ADR-0040); gdy
        // maskowanie niczego nie zmienilo, flaga hash_inputs_complete pozwala
        // odbiorcy przeliczyc hash z tresci.
        const packEvent: AuditPackEvent = toVerifiablePackEvent(
            stored,
            maskPayload(stored.payload),
            hashedTs,
        );
        // Wpis zerwany z mocy prawa: hash (lisc Merkle) zostaje oryginalny,
        // znacznik mowi, ktora deklaracja i jaki hash po zerwaniu; sama
        // deklaracja jedzie w paczce, zeby odbiorca mogl ja sprawdzic.
        let deklaracjaWPaczce: AuditPackEvent | undefined;
        if (zerwanie) {
            packEvent.legal_break = zerwanie.marker;
            deklaracjaWPaczce = toVerifiablePackEvent(
                zerwanie.declaration,
                maskPayload(zerwanie.declaration.payload),
                zerwanie.declarationTs,
            );
        }

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
            legalBreakDeclaration: deklaracjaWPaczce,
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
// Stan lancucha audytu i potwierdzanie rozwidlen (ADR-0165, rdzen ADR-0161)
// ---------------------------------------------------------------------------
//
// GET  /api/audit/chain              - trojstan OK / UWAGI / BLOKADA, znaleziska
//                                      (same id, bez tresci), co mozna potwierdzic
// POST /api/audit/chain/acknowledge  - { digest } z podgladu; zapis jednego
//                                      zdarzenia audit.chain.fork_acknowledged
//
// Admin-only jak caly ekran audytu. GET zostawia meta-slad admin.access.audit_viewer
// (ADR-0043). POST zostawia slad samym zdarzeniem potwierdzenia (aktor = admin).
// Status codes POST:
//   200 - zapisano, w odpowiedzi stan po zapisie
//   400 - brak digest
//   409 - odmowa: blocked / no_guard / nothing_to_acknowledge / stale (stan sie
//         zmienil od podgladu - odswiez i potwierdz jeszcze raz)
//   500 - blad odczytu albo zapisu
auditRouter.get(
    "/chain",
    requireAuth,
    requireAdmin,
    async (req: Request, res: Response): Promise<void> => {
        let db: ReturnType<typeof createServerSupabase>;
        try {
            db = createServerSupabase();
        } catch (e) {
            res.status(500).json({ error: "supabase_unavailable", detail: e instanceof Error ? e.message : String(e) });
            return;
        }
        void recordAdminAccess({
            db,
            event_type: "admin.access.audit_viewer",
            actor_user_id: (res.locals.userId as string | null) ?? null,
            actor_email: (res.locals.userEmail as string | null) ?? null,
            method: req.method,
            path: req.originalUrl,
        });
        try {
            res.status(200).json(await getChainStatus(db));
        } catch (e) {
            res.status(500).json({ error: "chain_read_failed", detail: e instanceof Error ? e.message : String(e) });
        }
    },
);

auditRouter.post(
    "/chain/acknowledge",
    requireAuth,
    requireAdmin,
    async (req: Request, res: Response): Promise<void> => {
        const digest = (req.body as { digest?: unknown } | undefined)?.digest;
        if (!isAckDigest(digest)) {
            res.status(400).json({ error: "invalid_digest" });
            return;
        }
        let db: ReturnType<typeof createServerSupabase>;
        try {
            db = createServerSupabase();
        } catch (e) {
            res.status(500).json({ error: "supabase_unavailable", detail: e instanceof Error ? e.message : String(e) });
            return;
        }
        try {
            const result = await acknowledgeForks(db, {
                actorUserId: (res.locals.userId as string | null) ?? null,
                digest,
            });
            if (result.ok) {
                res.status(200).json(result.status);
                return;
            }
            res.status(ackHttpStatus(result)).json({ error: result.reason, detail: result.detail, status: result.status });
        } catch (e) {
            res.status(500).json({ error: "chain_read_failed", detail: e instanceof Error ? e.message : String(e) });
        }
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
//   409 - ODMOWA (audyt 2026-09, D-01): excerpt_hash_mismatch (wpis wyciagu
//         niezgodny z hashem i bez waznej deklaracji zerwania z mocy prawa;
//         pole legal_break mowi, czemu deklaracja nie wystarczyla) albo
//         excerpt_parent_missing
//   500 - blad DB albo skladania archiwum
//
// Wpisy zanonimizowane na podstawie RODO art. 17 i objete WAZNA deklaracja
// audit.chain.legal_break (ADR-0164, decyzja 2026-10-06) nie zatrzymuja pakietu:
// niosa znacznik legal_break, deklaracje jada w legal_break_declarations (czesc
// manifestu), a weryfikatory daja osobny stan (verify.py: kod 3).
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
            created_at: string | null;
        };
        try {
            const r = await db
                .from("chat_messages")
                .select("id, chat_id, role, content, annotations, created_at")
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
        //    Kolejnosc po id, nie po ts: id to kolejnosc w lancuchu, a dwa wpisy
        //    z ta sama milisekunda moglyby sie przestawic (audyt 2026-09).
        let rows: StoredAuditRow[] = [];
        try {
            const r = await db
                .from("audit_log")
                .select(
                    "id, event_type, actor_user_id, chat_id, document_id, ts, hash, prev_hash, payload",
                )
                .eq("chat_id", msg.chat_id)
                .order("id", { ascending: true });
            if (r.error) {
                const detail = r.error.message ?? "audit_log";
                res.status(500).json({ error: "fetch_failed", detail });
                return;
            }
            rows = ((r.data ?? []) as StoredAuditRow[]).map((row) => ({
                ...row,
                payload: parseJson(row.payload),
            }));
        } catch (e) {
            const detail = e instanceof Error ? e.message : String(e);
            res.status(500).json({ error: "fetch_failed", detail });
            return;
        }

        // 3b. Kontrola wydawcy (audyt 2026-09, D-01 / C-04): kazdy wpis wyciagu
        //     ma hash zgodny z PELNA trescia, a poprzednik spoza wyciagu istnieje
        //     w dzienniku i jest wczesniejszy. Odbiorca nie przeliczy hasha wpisu
        //     z payloadem zamaskowanym ani nie sprawdzi ogniwa przez luke - robi
        //     to serwer, a przy niezgodnosci pakiet NIE wychodzi.
        const odmowaPakietu = async (
            reason: "excerpt_hash_mismatch" | "excerpt_parent_missing",
            ids: number[],
            detail: string,
            legalBreak?: Array<{ event_id: number; status: string; declaration_event_id: number | null }>,
        ): Promise<void> => {
            const lb = legalBreak && legalBreak.length > 0 ? legalBreak : undefined;
            await appendAuditEvent(db, {
                event_type: "deliverable.bundle_export",
                actor_user_id: userId,
                chat_id: msg.chat_id,
                document_id: null,
                payload: {
                    phase: "refused",
                    message_id: msg.id,
                    reason,
                    event_ids: ids.slice(0, 50),
                    ...(lb ? { legal_break: lb.slice(0, 50) } : {}),
                },
            });
            res.status(409).json({ error: reason, detail, event_ids: ids, ...(lb ? { legal_break: lb } : {}) });
        };
        const hashedTs = new Map<number, string>();
        const zlyHash: StoredAuditRow[] = [];
        for (const row of rows) {
            const c = checkStoredRowHash(row);
            if (c.ok) hashedTs.set(row.id, c.ts);
            else zlyHash.push(row);
        }
        // Zerwanie z mocy prawa (ADR-0164, decyzja 2026-10-06): wpis wyciagu
        // objety wazna deklaracja idzie ze znacznikiem, a deklaracja - w pakiecie.
        // Kazdy inny wpis z niezgodnym hashem zatrzymuje pakiet jak dotad.
        const znaczniki = new Map<number, Extract<LegalBreakResolution, { status: "verified" }>>();
        if (zlyHash.length > 0) {
            let deklaracje: StoredAuditRow[];
            try {
                deklaracje = await czytajDeklaracje(db, Math.min(...zlyHash.map((r) => r.id)));
            } catch (e) {
                const detail = e instanceof Error ? e.message : String(e);
                res.status(500).json({ error: "fetch_failed", detail });
                return;
            }
            const niewyjasnione: number[] = [];
            const statusy: Array<{ event_id: number; status: string; declaration_event_id: number | null }> = [];
            let pierwszaOdmowa: LegalBreakResolution | null = null;
            for (const row of zlyHash) {
                const r = resolveLegalBreak(row, deklaracje);
                if (r.status === "verified") {
                    znaczniki.set(row.id, r);
                    hashedTs.set(row.id, r.ts);
                    continue;
                }
                niewyjasnione.push(row.id);
                pierwszaOdmowa = pierwszaOdmowa ?? r;
                if (r.status !== "none") {
                    statusy.push({ event_id: row.id, status: r.status, declaration_event_id: r.declarationEventId ?? null });
                }
            }
            if (niewyjasnione.length > 0) {
                await odmowaPakietu(
                    "excerpt_hash_mismatch",
                    niewyjasnione,
                    opisOdmowyZerwania("wpisow dziennika tej sprawy", pierwszaOdmowa!) +
                        " Pakiet wstrzymany.",
                    statusy,
                );
                return;
            }
        }
        const wWyciagu = new Set(rows.map((r) => r.hash));
        const zewnetrzni = new Map<string, number>();
        for (const row of rows) {
            if (row.prev_hash !== GENESIS_HASH && !wWyciagu.has(row.prev_hash)) {
                zewnetrzni.set(row.prev_hash, row.id);
            }
        }
        const brakPoprzednika: number[] = [];
        try {
            const hashe = [...zewnetrzni.keys()];
            const znalezione = new Map<string, number>();
            for (let i = 0; i < hashe.length; i += 100) {
                const r = await db
                    .from("audit_log")
                    .select("id, hash")
                    .in("hash", hashe.slice(i, i + 100));
                if (r.error) {
                    res.status(500).json({ error: "fetch_failed", detail: r.error.message });
                    return;
                }
                for (const x of (r.data ?? []) as Array<{ id: number; hash: string }>) {
                    znalezione.set(x.hash, x.id);
                }
            }
            for (const [h, rowId] of zewnetrzni) {
                const parentId = znalezione.get(h);
                if (parentId === undefined || parentId >= rowId) brakPoprzednika.push(rowId);
            }
        } catch (e) {
            const detail = e instanceof Error ? e.message : String(e);
            res.status(500).json({ error: "fetch_failed", detail });
            return;
        }
        if (brakPoprzednika.length > 0) {
            await odmowaPakietu(
                "excerpt_parent_missing",
                brakPoprzednika.sort((a, b) => a - b),
                "Poprzednika wpisu dziennika tej sprawy nie ma w dzienniku albo jest pozniejszy - wpis usunieto " +
                    "albo wstawiono wstecz. Pakiet wstrzymany. Stan lancucha: GET /api/audit/chain (administrator).",
            );
            return;
        }

        const excerpt = annotateExcerptLinks(
            rows.map((r) => {
                const e = toVerifiablePackEvent(r, maskPayload(r.payload), hashedTs.get(r.id) ?? r.ts);
                const z = znaczniki.get(r.id);
                return z ? { ...e, legal_break: z.marker } : e;
            }),
        );
        const deklaracjeWPakiecie = [
            ...new Map([...znaczniki.values()].map((z) => [z.declaration.id, z])).values(),
        ]
            .sort((a, b) => a.declaration.id - b.declaration.id)
            .map((z) => toVerifiablePackEvent(z.declaration, maskPayload(z.declaration.payload), z.declarationTs));

        // Model, ktory napisal TE odpowiedz (D-02): zdarzenie asystenta dla tej
        // wiadomosci; granica okna to nastepna odpowiedz asystenta w czacie.
        let nextAssistantCreatedAt: string | null = null;
        if (msg.created_at) {
            try {
                const n = await db
                    .from("chat_messages")
                    .select("created_at")
                    .eq("chat_id", msg.chat_id)
                    .eq("role", "assistant")
                    .gt("created_at", msg.created_at)
                    .order("created_at", { ascending: true })
                    .limit(1);
                const first = (n.data ?? [])[0] as { created_at?: string } | undefined;
                nextAssistantCreatedAt = first?.created_at ?? null;
            } catch {
                nextAssistantCreatedAt = null;
            }
        }
        const { model, source: modelSource } = modelForMessage(
            rows.map((r) => ({ event_type: r.event_type, ts: r.ts, payload: r.payload })),
            { createdAt: msg.created_at ?? null, nextAssistantCreatedAt },
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
                ...(znaczniki.size > 0
                    ? {
                          legal_breaks: znaczniki.size,
                          legal_break_declaration_ids: deklaracjeWPakiecie.map((d) => d.id),
                      }
                    : {}),
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
            modelVersions: { model, model_source: modelSource },
            costLog: {
                available: false,
                full_text_len: deliverableMd.length,
                event_count: excerpt.length,
                note: "Patron nie sledzi jeszcze tokenow ani kosztu per deliverable (ADR-0066).",
            },
            createdAt: exportedAt,
            legalBreakDeclarations: deklaracjeWPakiecie,
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

/**
 * Deklaracje zerwania z mocy prawa POZNIEJSZE od wiersza `odId` (tylko takie
 * moga go wymieniac - ta sama regula co weryfikator lancucha). Rzuca przy
 * bledzie odczytu - caller zwraca 500, nie paczke.
 */
async function czytajDeklaracje(
    db: ReturnType<typeof createServerSupabase>,
    odId: number,
): Promise<StoredAuditRow[]> {
    const r = await db
        .from("audit_log")
        .select("id, event_type, actor_user_id, chat_id, document_id, ts, hash, prev_hash, payload")
        .eq("event_type", LEGAL_BREAK_EVENT)
        .gt("id", odId)
        .order("id", { ascending: true });
    if (r.error) throw new Error(r.error.message ?? "audit_log: odczyt deklaracji");
    return ((r.data ?? []) as StoredAuditRow[]).map((row) => ({ ...row, payload: parseJson(row.payload) }));
}

/** Tresc odmowy 409 dla wiersza z niezgodnym hashem - mowi, czemu deklaracja nie wystarczyla. */
function opisOdmowyZerwania(czego: string, r: LegalBreakResolution): string {
    const lancuch = " Stan lancucha: GET /api/audit/chain (administrator).";
    const nr = "declarationEventId" in r && r.declarationEventId !== undefined ? `#${r.declarationEventId}` : "";
    switch (r.status) {
        case "old_format":
            return (
                `Tresc ${czego} nie zgadza sie z hashem. Obejmuje ja deklaracja zerwania z mocy prawa ${nr} w starym ` +
                "formacie (bez affected_hashes_after) - nie da sie wykluczyc zmiany tresci po anonimizacji, wiec " +
                "eksport jest odmowiony." + lancuch
            );
        case "content_differs":
            return (
                `Tresc ${czego} rozni sie od zadeklarowanej po zerwaniu z mocy prawa (deklaracja ${nr}) - ` +
                "wpis zmieniono PO anonimizacji." + lancuch
            );
        case "field_not_null":
            return (
                `Tresc ${czego} nie zgadza sie z hashem, a pole nazwane w deklaracji ${nr} nie jest wyzerowane - ` +
                "niezgodnosci nie tlumaczy anonimizacja." + lancuch
            );
        default:
            return (
                `Tresc ${czego} nie zgadza sie z hashem i nie obejmuje jej wazna deklaracja zerwania z mocy prawa ` +
                "(audit.chain.legal_break) - wpis zmieniono po zapisie." + lancuch
            );
    }
}

/** SQLite trzyma JSON jako tekst, Postgres jako jsonb - przyjmujemy oba. */
function parseJson(value: unknown): unknown {
    if (typeof value !== "string") return value;
    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
}
