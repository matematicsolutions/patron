// Rdzen replicate_document: N kopii dokumentu sprawy (wiersze documents +
// document_versions + bajty w storage). Wyciagniety z tool-dispatch.ts, zeby
// sciezka inline i wykonanie karty zatwierdzenia (ADR-0137, audyt B-04)
// wykonywaly TE SAME kroki na TYCH SAMYCH (znormalizowanych) argumentach.
// Rejestracja etykiet doc-N i zdarzenia SSE zostaja po stronie wolajacego.

import { logErrorClass } from "../log-error-class";
import { convertedPdfKey } from "../convert";
import { loadActiveVersion } from "../documentVersions";
import { downloadFile, storageKey, uploadFile } from "../storage";
import type { createServerSupabase } from "../supabase";

type Db = ReturnType<typeof createServerSupabase>;

/** Znormalizowane argumenty replikacji (to samo idzie inline i na karte). */
export interface ReplicateInput {
    /** documents.id zrodla. */
    sourceDocumentId: string;
    sourceFilename: string;
    sourceFileType: string;
    /** Sciezka oryginalu - uzyta, gdy dokument nie ma aktywnej wersji. */
    sourceStoragePath: string;
    /** Nazwa kopii zadana przez model (null = "(copy)" / "(N)"). */
    requestedFilename: string | null;
    /** 1..20 (przyciete przed bramka). */
    requestedCount: number;
    projectId: string;
}

export interface ReplicatedCopy {
    document_id: string;
    filename: string;
    storage_path: string;
    version_id: string;
}

export type ReplicateResult =
    | { ok: true; copies: ReplicatedCopy[] }
    | { ok: false; error: string };

/** Przyciecie liczby kopii do 1..20 (jak dotad w tool-dispatch). */
export function normalizeReplicateCount(raw: unknown): number {
    return typeof raw === "number" && Number.isFinite(raw)
        ? Math.max(1, Math.min(20, Math.floor(raw)))
        : 1;
}

export async function replicateDocumentCopies(
    input: ReplicateInput,
    userId: string,
    db: Db,
): Promise<ReplicateResult> {
    const {
        sourceDocumentId,
        sourceFilename,
        sourceFileType,
        sourceStoragePath,
        requestedFilename,
        projectId,
    } = input;
    const requestedCount = normalizeReplicateCount(input.requestedCount);
    // Pull the active version once — every copy gets the same starting bytes
    // (with any accepted tracked changes rolled in), no point re-fetching per copy.
    const active = await loadActiveVersion(sourceDocumentId, db);
    const sourcePath = active?.storage_path ?? sourceStoragePath;
    const sourcePdfPath = active?.pdf_storage_path ?? null;
    const raw = await downloadFile(sourcePath);
    const pdfBytes = sourcePdfPath ? await downloadFile(sourcePdfPath) : null;
    if (!raw) {
        return {
            ok: false,
            error: "Could not read the source document's bytes from storage.",
        };
    }
    // Build N filenames. With count=1 keep the pre-existing "(copy)" suffix;
    // with count>1 use numbered "(1)", "(2)" suffixes.
    const srcExt = sourceFilename.match(/\.[^./\\]+$/)?.[0] ?? "";
    const baseStem = requestedFilename
        ? requestedFilename.replace(/\.[^./\\]+$/, "")
        : sourceFilename.replace(/\.[^./\\]+$/, "");
    const filenames: string[] = [];
    for (let n = 1; n <= requestedCount; n++) {
        const suffix =
            requestedCount === 1
                ? requestedFilename
                    ? ""
                    : " (copy)"
                : ` (${n})`;
        filenames.push(`${baseStem}${suffix}${srcExt}`);
    }

    // Bulk insert N documents in one round-trip.
    const docRows = filenames.map((fn) => ({
        project_id: projectId,
        user_id: userId,
        filename: fn,
        file_type: sourceFileType,
        size_bytes: raw.byteLength,
        status: "ready",
    }));
    const { data: insertedDocs, error: docErr } = await db
        .from("documents")
        .insert(docRows)
        .select("id, filename");
    if (docErr || !insertedDocs || insertedDocs.length === 0) {
        return {
            ok: false,
            error: `Failed to record replicated documents (${logErrorClass(docErr)})`,
        };
    }
    // Preserve the request order so each row pairs with the right filename.
    // Supabase returns inserted rows in the same order as the payload.
    const newDocs = insertedDocs as { id: string; filename: string }[];
    const contentType =
        sourceFileType === "pdf"
            ? "application/pdf"
            : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

    // Parallel uploads: the doc bytes (and PDF rendition if any) for every new copy.
    const uploadJobs: Promise<unknown>[] = [];
    const newKeys: string[] = [];
    const newPdfKeys: (string | null)[] = [];
    for (const d of newDocs) {
        const key = storageKey(userId, d.id, d.filename);
        newKeys.push(key);
        uploadJobs.push(uploadFile(key, raw, contentType));
        if (pdfBytes) {
            const pdfKey = convertedPdfKey(userId, d.id);
            newPdfKeys.push(pdfKey);
            uploadJobs.push(uploadFile(pdfKey, pdfBytes, "application/pdf"));
        } else {
            newPdfKeys.push(null);
        }
    }
    await Promise.all(uploadJobs);

    // Bulk insert N versions in one round-trip.
    const versionRows = newDocs.map((d, idx) => ({
        document_id: d.id,
        storage_path: newKeys[idx],
        pdf_storage_path: newPdfKeys[idx],
        source: "upload",
        version_number: 1,
        display_name: d.filename,
    }));
    const { data: insertedVersions, error: verErr } = await db
        .from("document_versions")
        .insert(versionRows)
        .select("id, document_id");
    if (
        verErr ||
        !insertedVersions ||
        insertedVersions.length !== newDocs.length
    ) {
        return {
            ok: false,
            error: `Failed to record replicated document versions (${logErrorClass(verErr)})`,
        };
    }
    const versionByDocId = new Map<string, string>();
    for (const v of insertedVersions as { id: string; document_id: string }[]) {
        versionByDocId.set(v.document_id, v.id);
    }

    // current_version_id has to be a per-row value, so a single UPDATE
    // statement can't cover all N. Fan out in parallel instead of sequential awaits.
    await Promise.all(
        newDocs.map((d) =>
            db
                .from("documents")
                .update({ current_version_id: versionByDocId.get(d.id) })
                .eq("id", d.id),
        ),
    );

    const copies: ReplicatedCopy[] = [];
    for (let idx = 0; idx < newDocs.length; idx++) {
        const d = newDocs[idx];
        const versionId = versionByDocId.get(d.id);
        if (!versionId) continue;
        copies.push({
            document_id: d.id,
            filename: d.filename,
            storage_path: newKeys[idx],
            version_id: versionId,
        });
    }
    return { ok: true, copies };
}

/** ReplicateInput -> tool_payload karty (ADR-0137). Bez tresci dokumentu. */
export function replicateInputToPayload(
    input: ReplicateInput,
): Record<string, unknown> {
    return {
        source_document_id: input.sourceDocumentId,
        source_filename: input.sourceFilename,
        source_file_type: input.sourceFileType,
        source_storage_path: input.sourceStoragePath,
        new_filename: input.requestedFilename,
        count: input.requestedCount,
        project_id: input.projectId,
    };
}

/**
 * tool_payload karty -> ReplicateInput. null, gdy karta niekompletna
 * (executor traktuje to jako fail-closed, nie zgaduje).
 */
export function payloadToReplicateInput(
    p: Record<string, unknown>,
): ReplicateInput | null {
    const str = (v: unknown) => (typeof v === "string" && v ? v : null);
    const sourceDocumentId = str(p.source_document_id);
    const sourceFilename = str(p.source_filename);
    const sourceFileType = str(p.source_file_type);
    const sourceStoragePath = str(p.source_storage_path);
    const projectId = str(p.project_id);
    if (
        !sourceDocumentId ||
        !sourceFilename ||
        !sourceFileType ||
        !sourceStoragePath ||
        !projectId
    ) {
        return null;
    }
    return {
        sourceDocumentId,
        sourceFilename,
        sourceFileType,
        sourceStoragePath,
        requestedFilename: str(p.new_filename),
        requestedCount: normalizeReplicateCount(p.count),
        projectId,
    };
}
