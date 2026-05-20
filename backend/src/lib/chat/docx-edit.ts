// docx tracked-changes editing - resolve current bytes + apply tracked edits.
// Wyciagniete z chatTools.ts w ramach refactoru Faza 2.3 iteracja 2.

import { downloadFile, storageKey, uploadFile } from "../storage";
import { createServerSupabase } from "../supabase";
import {
    applyTrackedEdits,
    type EditInput,
} from "../docxTrackedChanges";
import { buildDownloadUrl } from "../downloadTokens";
import { loadActiveVersion } from "../documentVersions";
import type { EditAnnotation } from "./types";

// ---------------------------------------------------------------------------
// Document version helpers (DOCX tracked-change editing)
// ---------------------------------------------------------------------------

/**
 * Resolve the current .docx bytes for a document, preferring the active
 * tracked-changes version if one exists, else the original upload.
 */
export async function loadCurrentVersionBytes(
    documentId: string,
    db: ReturnType<typeof createServerSupabase>,
): Promise<{ bytes: Buffer; storage_path: string } | null> {
    const active = await loadActiveVersion(documentId, db);
    if (!active) return null;
    const raw = await downloadFile(active.storage_path);
    if (!raw) return null;
    return { bytes: Buffer.from(raw), storage_path: active.storage_path };
}

/**
 * Ensure the document has a document_versions row for the current upload.
 * Called before writing the first 'assistant_edit' row so the history is
 * complete. Idempotent.
 */
export async function runEditDocument(params: {
    documentId: string;
    userId: string;
    edits: EditInput[];
    db: ReturnType<typeof createServerSupabase>;
    /**
     * If provided, append these edits to the existing turn-scoped version
     * (overwrites the file at storagePath and reuses the document_versions
     * row) instead of creating a new version. Used to collapse multiple
     * edit_document tool calls within a single assistant turn into one
     * version.
     */
    reuseVersion?: {
        versionId: string;
        versionNumber: number;
        storagePath: string;
    };
}): Promise<
    | {
          ok: true;
          version_id: string;
          version_number: number;
          storage_path: string;
          download_url: string;
          annotations: EditAnnotation[];
          errors: { index: number; reason: string }[];
      }
    | { ok: false; error: string }
> {
    const { documentId, userId, edits, db, reuseVersion } = params;

    const { data: doc } = await db
        .from("documents")
        .select("id, filename")
        .eq("id", documentId)
        .single();
    if (!doc) return { ok: false, error: "Document not found." };

    const current = await loadCurrentVersionBytes(documentId, db);
    if (!current) return { ok: false, error: "Could not load document bytes." };

    const {
        bytes: editedBytes,
        changes,
        errors,
    } = await applyTrackedEdits(current.bytes, edits, { author: "Mike" });

    if (changes.length === 0) {
        return {
            ok: false,
            error:
                errors[0]?.reason ??
                "No edits could be applied. Refine context_before/context_after and retry.",
        };
    }

    const ab = editedBytes.buffer.slice(
        editedBytes.byteOffset,
        editedBytes.byteOffset + editedBytes.byteLength,
    ) as ArrayBuffer;

    let versionRowId: string;
    let newPath: string;
    let nextVersionNumber: number;

    if (reuseVersion) {
        // Overwrite the existing turn version's file in place. The version
        // row, version_number, and current_version_id all already point here.
        newPath = reuseVersion.storagePath;
        versionRowId = reuseVersion.versionId;
        nextVersionNumber = reuseVersion.versionNumber;
        await uploadFile(
            newPath,
            ab,
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        );
    } else {
        const versionId = crypto.randomUUID().replace(/-/g, "");
        newPath = `documents/${userId}/${documentId}/edits/${versionId}.docx`;
        await uploadFile(
            newPath,
            ab,
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        );

        // Per-document sequential number for the new assistant_edit
        // version. The counter spans upload + user_upload + assistant_edit
        // so the original upload is V1 and the first assistant edit is V2.
        const { data: maxRow } = await db
            .from("document_versions")
            .select("version_number")
            .eq("document_id", documentId)
            .in("source", ["upload", "user_upload", "assistant_edit"])
            .order("version_number", { ascending: false, nullsFirst: false })
            .limit(1)
            .maybeSingle();
        nextVersionNumber =
            ((maxRow?.version_number as number | null) ?? 1) + 1;

        // Inherit the display name from the most recent prior version so
        // user-applied renames carry forward through further edits. Falls
        // back to the parent document's filename when no prior version has
        // a display name (e.g. the first assistant edit of a pre-existing
        // doc). We intentionally do NOT append "[Edited Vn]" — the version
        // number is surfaced separately as a tag in the UI.
        const { data: prevRow } = await db
            .from("document_versions")
            .select("display_name, created_at")
            .eq("document_id", documentId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
        const inheritedDisplayName =
            (prevRow?.display_name as string | null) ??
            (doc.filename as string | null) ??
            null;

        const { data: versionRow, error: verErr } = await db
            .from("document_versions")
            .insert({
                document_id: documentId,
                storage_path: newPath,
                source: "assistant_edit",
                version_number: nextVersionNumber,
                display_name: inheritedDisplayName,
            })
            .select("id")
            .single();
        if (verErr || !versionRow) {
            return { ok: false, error: "Failed to record document version." };
        }
        versionRowId = versionRow.id as string;
    }

    // Insert one row per change
    const editRows = changes.map((c) => ({
        document_id: documentId,
        version_id: versionRowId,
        change_id: c.id,
        del_w_id: c.delId ?? null,
        ins_w_id: c.insId ?? null,
        deleted_text: c.deletedText,
        inserted_text: c.insertedText,
        context_before: c.contextBefore ?? "",
        context_after: c.contextAfter ?? "",
        status: "pending" as const,
    }));
    const { data: insertedEdits, error: editsErr } = await db
        .from("document_edits")
        .insert(editRows)
        .select(
            "id, change_id, del_w_id, ins_w_id, deleted_text, inserted_text, context_before, context_after",
        );

    if (editsErr || !insertedEdits) {
        return { ok: false, error: "Failed to record edits." };
    }

    await db
        .from("documents")
        .update({ current_version_id: versionRowId })
        .eq("id", documentId);

    const annotations: EditAnnotation[] = insertedEdits.map(
        (r: {
            id: string;
            change_id: string;
            deleted_text: string;
            inserted_text: string;
            context_before: string | null;
            context_after: string | null;
        }) => {
            const src = changes.find((c) => c.id === r.change_id);
            return {
                kind: "edit",
                edit_id: r.id,
                document_id: documentId,
                version_id: versionRowId,
                version_number: nextVersionNumber,
                change_id: r.change_id,
                del_w_id: src?.delId,
                ins_w_id: src?.insId,
                deleted_text: r.deleted_text ?? "",
                inserted_text: r.inserted_text ?? "",
                context_before: r.context_before ?? "",
                context_after: r.context_after ?? "",
                reason: src?.reason,
                status: "pending",
            };
        },
    );

    // Persistent, non-expiring permalink. The backend streams fresh bytes
    // on each request, so this URL stays valid as long as the file exists.
    const permalink = buildDownloadUrl(newPath, doc.filename as string);

    return {
        ok: true,
        version_id: versionRowId,
        version_number: nextVersionNumber,
        storage_path: newPath,
        download_url: permalink,
        annotations,
        errors,
    };
}
