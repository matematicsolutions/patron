// Executor kart zatwierdzenia mutacji (ADR-0137). Mapuje zatwierdzona karte
// `pending` na realne wykonanie oryginalnego narzedzia (edit_document /
// generate_docx). Wstrzykiwany do approveMutationApproval - dzieki temu rdzen
// lib/mutation-approval.ts nie zalezy od docx-edit/docx-generate (brak cyklu).
//
// Wykonanie jest TYM SAMYM, co inline w tool-dispatch.ts - tylko odroczonym do
// momentu decyzji czlowieka. Bez reuseVersion (karta = osobny, swiadomy zapis).

import { runEditDocument, runAddComments } from "./docx-edit";
import { generateDocx } from "./docx-generate";
import { createServerSupabase } from "../supabase";
import type { EditInput } from "../docxTrackedChanges";
import type { CommentInput } from "../docxComments";
import type { ExecutorResult, MutationApproval } from "../mutation-approval";

type Db = ReturnType<typeof createServerSupabase>;

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
        return {
            ok: true,
            result: {
                document_id: documentId,
                version_id: r.version_id,
                version_number: r.version_number,
                download_url: r.download_url,
                applied: r.annotations.length,
                errors: r.errors,
            },
        };
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
        return {
            ok: true,
            result: {
                document_id: documentId,
                version_id: r.version_id,
                version_number: r.version_number,
                download_url: r.download_url,
                applied: r.annotations.length,
                errors: r.errors,
            },
        };
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

    return { ok: false, error: `Nieobslugiwane narzedzie: ${card.tool_name}` };
}
