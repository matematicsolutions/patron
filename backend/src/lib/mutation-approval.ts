// Karty zatwierdzenia mutacji (ADR-0137) - human-in-the-loop write staging.
//
// Akcje agenta o skutkach ubocznych (edit_document, generate_docx, ...) moga byc
// STAGE'OWANE jako karta `pending` zamiast wykonywac sie natychmiast. Zatwierdza
// /odrzuca je TYLKO czlowiek (`requireAuth`), fail-closed - akt nadzoru wg AI Act
// art. 14. Decyzja (approve/reject) idzie w audit hash-chain (art. 12,
// event_type = "mutation.approval.decision").
//
// Warstwa rozdzielona na:
//   - czyste reguly przejsc stanu (canTransition / isHumanActor) - bez IO,
//   - operacje IO (stage/getPending/getById/approve/reject) na `db` (shim/Postgres).
// Wykonanie oryginalnego narzedzia przy `approve` jest WSTRZYKIWANE jako
// `executor` (seam jak SupabaseFactory w audit-bridge) - rdzen nie zalezy od
// docx-edit/docx-generate (brak cyklu importow, testowalnosc).
//
// Granica (ADR-0137): dziala NAD sciezka tool-dispatch; nie dotyka gateway/
// ring-policy/cell-review. Payload audytu BEZ tresci dokumentu (RODO minimalizacja).

import { appendAuditEvent } from "./audit";
import { createServerSupabase } from "./supabase";

type Db = ReturnType<typeof createServerSupabase>;

export const MUTATION_APPROVAL_EVENT_TYPE = "mutation.approval.decision" as const;

export type MutationApprovalStatus = "pending" | "approved" | "rejected";

/** Narzedzia objete stagingiem w MVP (US1). US3 rozszerza o comments/export. */
export type StagedToolName = "edit_document" | "generate_docx";

export interface MutationApproval {
    id: string;
    user_id: string;
    chat_id: string | null;
    document_id: string | null;
    tool_name: string;
    /** Argumenty narzedzia do wykonania PO zatwierdzeniu (bez pelnej tresci). */
    tool_payload: Record<string, unknown>;
    status: MutationApprovalStatus;
    staged_at: string;
    staged_by: string;
    approved_at: string | null;
    approved_by: string | null;
    rejection_reason: string | null;
    executed_at: string | null;
    execution_error: string | null;
    created_at: string;
    updated_at: string;
}

export interface StageMutationInput {
    userId: string;
    chatId?: string | null;
    documentId?: string | null;
    toolName: StagedToolName;
    toolPayload: Record<string, unknown>;
}

/**
 * Czy staging mutacji jest wlaczony. MVP: opt-in przez env (domyslnie OFF), by
 * nie zmieniac sciezki krytycznej czatu zanim wjedzie inbox UI (Phase 4 US2).
 * Po wdrozeniu UI domyslna wartosc przejdzie na ON dla outbound (spec Q1).
 */
export function isMutationApprovalEnabled(): boolean {
    return process.env.PATRON_MUTATION_APPROVAL === "true";
}

/** Bramka human-in-the-loop: actorId musi byc obecny (nie pusty/system). */
function isHumanActor(actorId: string | null | undefined): actorId is string {
    return !!actorId && actorId !== "system" && actorId !== "analysis";
}

/**
 * Reguly przejsc stanu (fail-closed): zatwierdzic/odrzucic mozna TYLKO karte
 * `pending`. Karta juz rozstrzygnieta (approved/rejected) jest terminalna -
 * blokuje podwojne wykonanie / zmiane decyzji bez sladu.
 */
export function canTransition(
    from: MutationApprovalStatus,
    to: "approved" | "rejected",
): boolean {
    return from === "pending" && (to === "approved" || to === "rejected");
}

function rowToApproval(row: Record<string, unknown>): MutationApproval {
    const payload = row.tool_payload;
    return {
        id: String(row.id),
        user_id: String(row.user_id),
        chat_id: (row.chat_id as string | null) ?? null,
        document_id: (row.document_id as string | null) ?? null,
        tool_name: String(row.tool_name),
        tool_payload:
            payload && typeof payload === "object"
                ? (payload as Record<string, unknown>)
                : {},
        status: row.status as MutationApprovalStatus,
        staged_at: String(row.staged_at),
        staged_by: String(row.staged_by),
        approved_at: (row.approved_at as string | null) ?? null,
        approved_by: (row.approved_by as string | null) ?? null,
        rejection_reason: (row.rejection_reason as string | null) ?? null,
        executed_at: (row.executed_at as string | null) ?? null,
        execution_error: (row.execution_error as string | null) ?? null,
        created_at: String(row.created_at),
        updated_at: String(row.updated_at),
    };
}

/**
 * Stage'uje akcje jako karte `pending`. Zwraca utworzona karte albo null gdy
 * zapis sie nie powiodl (wolajacy musi traktowac null jak fail-closed - NIE
 * wykonywac akcji bez zatwierdzenia).
 */
export async function stageMutationApproval(
    db: Db,
    input: StageMutationInput,
): Promise<MutationApproval | null> {
    const now = new Date().toISOString();
    const { data, error } = await db
        .from("mutation_approvals")
        .insert({
            user_id: input.userId,
            chat_id: input.chatId ?? null,
            document_id: input.documentId ?? null,
            tool_name: input.toolName,
            tool_payload: input.toolPayload ?? {},
            status: "pending",
            staged_at: now,
            staged_by: input.userId,
        })
        .select("*")
        .single();
    if (error || !data) {
        console.warn(
            "[mutation-approval] stage insert failed:",
            error?.message ?? "no row",
        );
        return null;
    }
    return rowToApproval(data as Record<string, unknown>);
}

/** Lista kart `pending` uzytkownika (scoping user_id), najstarsze pierwsze. */
export async function getPendingApprovals(
    db: Db,
    userId: string,
): Promise<MutationApproval[]> {
    const { data, error } = await db
        .from("mutation_approvals")
        .select("*")
        .eq("user_id", userId)
        .eq("status", "pending")
        .order("staged_at", { ascending: true });
    if (error || !data) return [];
    return (data as Record<string, unknown>[]).map(rowToApproval);
}

/**
 * Pojedyncza karta scoped do uzytkownika. Zwraca null gdy nie istnieje LUB
 * nalezy do innego usera (izolacja tajemnicy - karta cudzego usera = niewidoczna).
 */
export async function getApprovalById(
    db: Db,
    userId: string,
    id: string,
): Promise<MutationApproval | null> {
    const { data, error } = await db
        .from("mutation_approvals")
        .select("*")
        .eq("id", id)
        .eq("user_id", userId)
        .maybeSingle();
    if (error || !data) return null;
    return rowToApproval(data as Record<string, unknown>);
}

/** Wynik wykonania oryginalnego narzedzia (wstrzykiwany executor). */
export interface ExecutorResult {
    ok: boolean;
    error?: string;
    /** Dowolny wynik narzedzia do oddania wolajacemu (np. download_url). */
    result?: unknown;
}

export type MutationExecutor = (
    card: MutationApproval,
) => Promise<ExecutorResult>;

export interface DecisionResult {
    ok: boolean;
    status?: number;
    error?: string;
    card?: MutationApproval;
    /** Wynik executora (tylko dla approve, gdy wykonanie sie powiodlo). */
    execution?: ExecutorResult;
}

async function writeDecisionAudit(
    db: Db,
    card: MutationApproval,
    actorId: string,
    decision: "approved" | "rejected",
    executed: boolean,
    executionError: string | null,
): Promise<void> {
    // Minimalizacja (RODO / Konstytucja Art. 7): bez tresci/argumentow mutacji.
    await appendAuditEvent(db, {
        event_type: MUTATION_APPROVAL_EVENT_TYPE,
        actor_user_id: actorId,
        chat_id: card.chat_id,
        document_id: card.document_id,
        payload: {
            approval_id: card.id,
            tool_name: card.tool_name,
            decision,
            executed,
            execution_error_present: executionError !== null,
        },
    });
}

/**
 * Zatwierdza karte i WYKONUJE oryginalne narzedzie przez `executor`. Fail-closed:
 *   - actor musi byc czlowiekiem,
 *   - karta musi istniec (scoped do usera) i byc `pending`.
 * Sekwencja: oznacz `approved` -> wykonaj -> zapisz executed_at / execution_error.
 * Audit (decision=approved) zawsze po probie wykonania - z flaga `executed`.
 * Zwraca status HTTP-friendly (404 brak karty, 409 nie-pending, 403 nie-czlowiek).
 */
export async function approveMutationApproval(
    db: Db,
    params: { id: string; userId: string; actorId: string },
    executor: MutationExecutor,
): Promise<DecisionResult> {
    if (!isHumanActor(params.actorId)) {
        return { ok: false, status: 403, error: "Wymagany czlowiek-operator." };
    }
    const card = await getApprovalById(db, params.userId, params.id);
    if (!card) return { ok: false, status: 404, error: "Karta nie istnieje." };
    if (!canTransition(card.status, "approved")) {
        return {
            ok: false,
            status: 409,
            error: `Karta nie jest 'pending' (stan: ${card.status}).`,
        };
    }

    // Guard przejscia = getApprovalById(pending) powyzej. UWAGA: w trybie
    // SERWEROWYM (multi-proces) zostaje mikro-race dwoch rownoleglych approve
    // tej samej karty (oba czytaja pending zanim ktorykolwiek zapisze) -> ryzyko
    // podwojnego wykonania. Tryb DESKTOP (single-user, ADR-0053) tego nie ma.
    // Pelny fix wymaga atomic compare-and-swap (affected-rows) - shim go nie
    // eksponuje; rezerwacja na warstwe serwerowa. `eq(status,pending)` zaweza okno.
    const now = new Date().toISOString();
    await db
        .from("mutation_approvals")
        .update({
            status: "approved",
            approved_at: now,
            approved_by: params.actorId,
            updated_at: now,
        })
        .eq("id", card.id)
        .eq("status", "pending");

    let execution: ExecutorResult;
    try {
        execution = await executor(card);
    } catch (e) {
        execution = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }

    const executedAt = new Date().toISOString();
    await db
        .from("mutation_approvals")
        .update({
            executed_at: execution.ok ? executedAt : null,
            execution_error: execution.ok ? null : (execution.error ?? "unknown"),
            updated_at: executedAt,
        })
        .eq("id", card.id);

    await writeDecisionAudit(
        db,
        card,
        params.actorId,
        "approved",
        execution.ok,
        execution.ok ? null : (execution.error ?? "unknown"),
    );

    const updated = await getApprovalById(db, params.userId, card.id);
    return { ok: true, card: updated ?? card, execution };
}

/**
 * Odrzuca karte (brak wykonania). Fail-closed jak approve. Zapisuje powod i
 * audit (decision=rejected). Zwraca status HTTP-friendly.
 */
export async function rejectMutationApproval(
    db: Db,
    params: { id: string; userId: string; actorId: string; reason?: string },
): Promise<DecisionResult> {
    if (!isHumanActor(params.actorId)) {
        return { ok: false, status: 403, error: "Wymagany czlowiek-operator." };
    }
    const card = await getApprovalById(db, params.userId, params.id);
    if (!card) return { ok: false, status: 404, error: "Karta nie istnieje." };
    if (!canTransition(card.status, "rejected")) {
        return {
            ok: false,
            status: 409,
            error: `Karta nie jest 'pending' (stan: ${card.status}).`,
        };
    }

    const now = new Date().toISOString();
    await db
        .from("mutation_approvals")
        .update({
            status: "rejected",
            rejection_reason: params.reason?.trim() || null,
            updated_at: now,
        })
        .eq("id", card.id);

    await writeDecisionAudit(db, card, params.actorId, "rejected", false, null);

    const updated = await getApprovalById(db, params.userId, card.id);
    return { ok: true, card: updated ?? card };
}
