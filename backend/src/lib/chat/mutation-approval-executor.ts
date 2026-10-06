// Executor kart zatwierdzenia mutacji (ADR-0137). Mapuje zatwierdzona karte
// `pending` na realne wykonanie oryginalnego narzedzia (edit_document /
// generate_docx). Wstrzykiwany do approveMutationApproval - dzieki temu rdzen
// lib/mutation-approval.ts nie zalezy od docx-edit/docx-generate (brak cyklu).
//
// Wykonanie jest TYM SAMYM, co inline w tool-dispatch.ts - tylko odroczonym do
// momentu decyzji czlowieka. Bez reuseVersion (karta = osobny, swiadomy zapis).

import { runEditDocument, runAddComments } from "./docx-edit";
import { generateDocx } from "./docx-generate";
import { payloadToReplicateInput, replicateDocumentCopies } from "./replicate";
import { saveMemory } from "../brain/store";
import { createServerSupabase } from "../supabase";
import type { EditInput } from "../docxTrackedChanges";
import type { CommentInput } from "../docxComments";
import type { ExecutorResult, MutationApproval } from "../mutation-approval";

type Db = ReturnType<typeof createServerSupabase>;

/**
 * Wynik narzedzia wielopozycyjnego z jawnymi liczbami (audyt C-08):
 * runEditDocument / runAddComments zwracaja ok:true, gdy weszla CHOC JEDNA
 * pozycja, a reszte oddaja w errors[]. Executor przenosi to do `counts` /
 * `failures` (rdzen oznacza karte i audit jako wykonanie czesciowe) oraz do
 * `result` (requested / applied / failed / partial / errors), ktory trasa
 * oddaje UI.
 */
function withCounts(
    requested: number,
    errors: { index: number; reason: string }[],
    base: Record<string, unknown>,
): ExecutorResult {
    // Liczymy od listy WEJSCIA i bledow per indeks, nie od adnotacji: jedna zmiana
    // bywa kilkoma adnotacjami, wiec "applied = liczba adnotacji" zawyzalo wynik
    // (z galezi fix/kurs-aies-fala1, 2a9f28d).
    const failed = Math.min(requested, new Set(errors.map((e) => e.index)).size);
    const applied = Math.max(0, requested - failed);
    const counts = { requested, applied, failed };
    return {
        ok: true,
        counts,
        failures: errors,
        result: {
            ...base,
            requested: counts.requested,
            applied,
            failed,
            partial: failed > 0,
            errors,
        },
    };
}

/**
 * Wykonuje narzedzie opisane przez zatwierdzona karte. Zwraca ExecutorResult
 * (ok + opcjonalny error/result). Nieobslugiwane narzedzie = ok:false (fail-closed).
 */
export async function executeStagedTool(
    card: MutationApproval,
    userId: string,
    db: Db,
): Promise<ExecutorResult> {
    const p = card.tool_payload ?? {};

    if (card.tool_name === "edit_document") {
        const documentId =
            card.document_id ?? (p.document_id as string | undefined);
        const edits = (p.edits as EditInput[] | undefined) ?? [];
        if (!documentId || edits.length === 0) {
            return { ok: false, error: "Karta bez document_id lub edits." };
        }
        const r = await runEditDocument({ documentId, userId, edits, db });
        if (!r.ok) return { ok: false, error: r.error };
        return withCounts(edits.length, r.errors, {
            document_id: documentId,
            version_id: r.version_id,
            version_number: r.version_number,
            download_url: r.download_url,
        });
    }

    if (card.tool_name === "add_comments") {
        const documentId =
            card.document_id ?? (p.document_id as string | undefined);
        const comments = (p.comments as CommentInput[] | undefined) ?? [];
        if (!documentId || comments.length === 0) {
            return { ok: false, error: "Karta bez document_id lub comments." };
        }
        const r = await runAddComments({ documentId, userId, comments, db });
        if (!r.ok) return { ok: false, error: r.error };
        return withCounts(comments.length, r.errors, {
            document_id: documentId,
            version_id: r.version_id,
            version_number: r.version_number,
            download_url: r.download_url,
        });
    }

    if (card.tool_name === "generate_docx") {
        const title = String(p.title ?? "");
        const sections = (p.sections as unknown[] | undefined) ?? [];
        const r = await generateDocx(title, sections, userId, db, {
            landscape: !!p.landscape,
            kancelaria: !!p.kancelaria,
            projectId: (p.projectId as string | null | undefined) ?? null,
        });
        if (r && typeof r === "object" && "download_url" in r) {
            return { ok: true, result: r };
        }
        return {
            ok: false,
            error:
                (r as { error?: string } | undefined)?.error ??
                "generate_docx nie zwrocil dokumentu.",
        };
    }

    // Audyt B-04: replicate_document - ten sam rdzen co inline (replicate.ts),
    // na argumentach znormalizowanych przed bramka i zapisanych na karcie.
    if (card.tool_name === "replicate_document") {
        const input = payloadToReplicateInput(p);
        if (!input) {
            return { ok: false, error: "Karta replicate_document niekompletna." };
        }
        const r = await replicateDocumentCopies(input, userId, db);
        if (!r.ok) return { ok: false, error: r.error };
        return {
            ok: true,
            result: {
                count: r.copies.length,
                copies: r.copies.map((c) => ({
                    document_id: c.document_id,
                    version_id: c.version_id,
                    filename: c.filename,
                })),
            },
        };
    }

    // Audyt B-04: remember - ten sam saveMemory na tych samych polach co inline
    // (scope wyliczony przez serwer przy stagingu, nie przez model).
    if (card.tool_name === "remember") {
        const str = (v: unknown) => (typeof v === "string" ? v : "");
        const input = {
            scope: str(p.scope),
            slug: str(p.slug),
            type: str(p.type) || "notatka",
            title: str(p.title),
            body: str(p.body),
        };
        if (!input.scope || !input.title || !input.body) {
            return { ok: false, error: "Karta remember niekompletna." };
        }
        try {
            const r = saveMemory(input);
            return {
                ok: true,
                result: { action: r.action, slug: r.slug, scope: r.scope },
            };
        } catch (e) {
            return { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
    }

    return { ok: false, error: `Nieobslugiwane narzedzie: ${card.tool_name}` };
}
