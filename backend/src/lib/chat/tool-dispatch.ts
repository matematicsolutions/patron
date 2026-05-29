// Dispatch wszystkich narzedzi czatu (read/find/generate/edit/list/fetch/replicate/tabular/workflow).
// Wyciagniete z chatTools.ts w ramach refactoru Faza 2.3 iteracja 2.
// Helpery readDocumentContent / findInDocumentContent / normalize* sa prywatne dla
// dispatchera (uzywane tylko z wnetrza runToolCalls).

import { convertedPdfKey } from "../convert";
import {
    extractDocxBodyText,
    type EditInput,
} from "../docxTrackedChanges";
import { loadActiveVersion } from "../documentVersions";
import { buildDownloadUrl } from "../downloadTokens";
import { downloadFile, storageKey, uploadFile } from "../storage";
import { createServerSupabase } from "../supabase";
import { citationReminder } from "./prompts";
import { resolveDocLabel } from "./citations";
import { extractPdfText } from "./pdf";
import { analyzeInput, isHardThreat } from "../input-security";
import { generateDocx } from "./docx-generate";
import { loadCurrentVersionBytes, runEditDocument } from "./docx-edit";
import { retrieve } from "../retrieval/retrieval";
import { saveMemory, listMemories, readMemory } from "../brain/store";
import type {
    DocIndex,
    DocStore,
    EditAnnotation,
    TabularCellStore,
    ToolCall,
    WorkflowStore,
} from "./types";

async function readDocumentContent(
    docLabel: string,
    docStore: DocStore,
    write: (s: string) => void,
    docIndex?: DocIndex,
    db?: ReturnType<typeof createServerSupabase>,
    opts?: { emitEvents?: boolean },
): Promise<string> {
    const emitEvents = opts?.emitEvents ?? true;
    console.log(`[read_document] called with docLabel="${docLabel}"`);
    const docInfo = docStore.get(docLabel);
    if (!docInfo) {
        console.log(
            `[read_document] MISS — docLabel "${docLabel}" not in docStore. Known labels:`,
            Array.from(docStore.keys()),
        );
        return "Document not found.";
    }
    console.log(
        `[read_document] docInfo: filename="${docInfo.filename}", file_type="${docInfo.file_type}", storage_path="${docInfo.storage_path}"`,
    );

    const documentId = docIndex?.[docLabel]?.document_id;
    const emitDocRead = () => {
        if (!emitEvents) return;
        write(
            `data: ${JSON.stringify({
                type: "doc_read",
                filename: docInfo.filename,
                document_id: documentId,
            })}\n\n`,
        );
    };
    if (emitEvents)
        write(
            `data: ${JSON.stringify({
                type: "doc_read_start",
                filename: docInfo.filename,
                document_id: documentId,
            })}\n\n`,
        );
    try {
        // Prefer the current tracked-changes version (if any) so read_document
        // reflects accepted/pending edits rather than the original upload.
        let raw: ArrayBuffer | null = null;
        let sourcePath = docInfo.storage_path;
        if (documentId && db) {
            const current = await loadCurrentVersionBytes(documentId, db);
            if (current) {
                raw = current.bytes.buffer.slice(
                    current.bytes.byteOffset,
                    current.bytes.byteOffset + current.bytes.byteLength,
                ) as ArrayBuffer;
                sourcePath = current.storage_path;
                console.log(
                    `[read_document] using current version path="${sourcePath}" (bytes=${raw.byteLength})`,
                );
            } else {
                console.log(
                    `[read_document] loadCurrentVersionBytes returned null for documentId="${documentId}", falling back to original storage_path`,
                );
            }
        }
        if (!raw) {
            raw = await downloadFile(docInfo.storage_path);
            if (raw) {
                console.log(
                    `[read_document] fallback download from storage_path="${docInfo.storage_path}" (bytes=${raw.byteLength})`,
                );
            }
        }
        if (!raw) {
            console.log(
                `[read_document] FAILED to download any bytes for docLabel="${docLabel}" (tried path="${sourcePath}")`,
            );
            emitDocRead();
            return "Document could not be read.";
        }
        // Log the first 8 bytes so we can identify real file format regardless
        // of the declared file_type. Valid .docx starts with "PK\x03\x04"
        // (zip). Legacy .doc starts with "\xD0\xCF\x11\xE0" (OLE/CFB).
        // %PDF-1 is a PDF even if mislabeled. Truncated uploads show as all-zero.
        {
            const head = Buffer.from(raw).subarray(0, 8);
            const hex = head.toString("hex");
            const ascii = head.toString("binary").replace(/[^\x20-\x7e]/g, ".");
            console.log(
                `[read_document] magic bytes hex=${hex} ascii="${ascii}" for filename="${docInfo.filename}"`,
            );
        }
        let text: string;
        if (docInfo.file_type === "pdf") {
            text = await extractPdfText(raw);
            console.log(
                `[read_document] pdf extracted length=${text.length} for filename="${docInfo.filename}"`,
            );
        } else if (docInfo.file_type === "docx") {
            // Use the same flattening as the edit_document matcher so the
            // LLM sees exactly the characters it can anchor against.
            text = await extractDocxBodyText(Buffer.from(raw));
            console.log(
                `[read_document] docx extractDocxBodyText length=${text.length} for filename="${docInfo.filename}"`,
            );
            if (!text) {
                console.log(
                    `[read_document] docx accepted-view extractor returned empty, falling back to mammoth for filename="${docInfo.filename}"`,
                );
                const mammoth = await import("mammoth");
                const result = await mammoth.extractRawText({
                    buffer: Buffer.from(raw),
                });
                text = result.value;
                console.log(
                    `[read_document] docx mammoth fallback length=${text.length} for filename="${docInfo.filename}"`,
                );
            }
        } else {
            console.log(
                `[read_document] unknown file_type="${docInfo.file_type}" for filename="${docInfo.filename}", trying mammoth`,
            );
            const mammoth = await import("mammoth");
            const result = await mammoth.extractRawText({
                buffer: Buffer.from(raw),
            });
            text = result.value;
            console.log(
                `[read_document] mammoth length=${text.length} for filename="${docInfo.filename}"`,
            );
        }
        console.log(
            `[read_document] DONE filename="${docInfo.filename}" finalTextLength=${text.length} firstChars=${JSON.stringify(text.slice(0, 120))}`,
        );

        // ADR-0020 W4: obrona w glab. Tuz przed podaniem tresci do promptu
        // sprawdzamy twarde sygnaly manipulacji (prompt-injection / ukryte akcje
        // PDF). Lapie dokumenty wgrane przed wpieciem skanu w ingest (W2) albo
        // oznaczone do przegladu. Lekko - blokujemy tylko na blocked/human_review.
        const guard = analyzeInput({
            text,
            fileName: docInfo.filename,
            declaredType:
                docInfo.file_type === "pdf" ? "application/pdf" : undefined,
            buffer: new Uint8Array(raw),
        });
        if (isHardThreat(guard)) {
            console.log(
                `[read_document] WSTRZYMANY przez input-security action=${guard.action} filename="${docInfo.filename}"`,
            );
            emitDocRead();
            return `Dokument "${docInfo.filename}" zostal wstrzymany przez kontrole bezpieczenstwa wejscia (mozliwa proba manipulacji modelem, np. wstrzykniete polecenie lub ukryta akcja). Tresc nie zostala wczytana do modelu. Zglos dokument Operatorowi/Inspektorowi do recznej oceny.`;
        }

        emitDocRead();
        return text;
    } catch (err) {
        console.log(
            `[read_document] THREW for docLabel="${docLabel}" filename="${docInfo.filename}":`,
            err,
        );
        if (emitEvents)
            write(
                `data: ${JSON.stringify({ type: "doc_read", filename: docInfo.filename })}\n\n`,
            );
        return "Document could not be read.";
    }
}

// Sentinele zwracane przez readDocumentContent gdy tresci NIE udalo sie podac
// do modelu (brak dokumentu, blad odczytu, wstrzymanie przez input-security).
// Dla groundingu (ADR-0005) traktujemy je jak brak zrodla -> null.
function isReadFailureSentinel(text: string): boolean {
    return (
        text === "Document not found." ||
        text === "Document could not be read." ||
        text.startsWith("Dokument \"") // komunikat wstrzymania input-security
    );
}

/**
 * ADR-0005: cichy odczyt pelnego tekstu dokumentu klienta dla mechanicznej
 * weryfikacji cytatow (citation grounding). Reuzywa readDocumentContent (ta sama
 * sciezka co read_document widziana przez model: wersja tracked-changes,
 * ekstrakcja PDF/DOCX, guard input-security), ale BEZ emisji eventow SSE.
 * Zwraca null gdy zrodla nie da sie pobrac - grounding oznaczy wtedy BRAK_ZRODLA.
 */
export async function getDocumentTextForGrounding(
    docLabel: string,
    docStore: DocStore,
    docIndex?: DocIndex,
    db?: ReturnType<typeof createServerSupabase>,
): Promise<string | null> {
    const text = await readDocumentContent(
        docLabel,
        docStore,
        () => {},
        docIndex,
        db,
        { emitEvents: false },
    );
    return isReadFailureSentinel(text) ? null : text;
}

/**
 * Build a whitespace-collapsed, lowercased copy of `text`, plus a map from
 * each character index in the normalized form back to the corresponding
 * index in the original text. Used by `findInDocumentContent` so matches
 * are tolerant of case + whitespace variance but can still return the
 * exact original excerpt.
 */
function normalizeWithMap(text: string): { norm: string; origIdx: number[] } {
    const norm: string[] = [];
    const origIdx: number[] = [];
    let prevSpace = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (/\s/.test(ch)) {
            if (!prevSpace) {
                norm.push(" ");
                origIdx.push(i);
                prevSpace = true;
            }
        } else {
            norm.push(ch.toLowerCase());
            origIdx.push(i);
            prevSpace = false;
        }
    }
    return { norm: norm.join(""), origIdx };
}

function normalizeQuery(q: string): string {
    return q.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Ctrl+F helper. Returns a JSON-serializable result with up to `maxResults`
 * hits, each containing the original-text excerpt plus surrounding context.
 */
async function findInDocumentContent(params: {
    docLabel: string;
    query: string;
    maxResults?: number;
    contextChars?: number;
    docStore: DocStore;
    write: (s: string) => void;
    docIndex?: DocIndex;
    db?: ReturnType<typeof createServerSupabase>;
}): Promise<string> {
    const {
        docLabel,
        query,
        maxResults = 20,
        contextChars = 80,
        docStore,
        write,
        docIndex,
        db,
    } = params;

    if (!query || !query.trim()) {
        return JSON.stringify({ ok: false, error: "Empty query." });
    }

    const docInfo = docStore.get(docLabel);
    if (!docInfo) {
        return JSON.stringify({
            ok: false,
            error: `Document '${docLabel}' not found.`,
        });
    }

    // Announce the search to the UI, then reuse readDocumentContent for its
    // fallbacks — but suppress its own doc_read events so the user only sees
    // the doc_find block (not a competing doc_read block for the same op).
    write(
        `data: ${JSON.stringify({
            type: "doc_find_start",
            filename: docInfo.filename,
            query,
        })}\n\n`,
    );

    const text = await readDocumentContent(
        docLabel,
        docStore,
        write,
        docIndex,
        db,
        { emitEvents: false },
    );
    if (!text || text === "Document could not be read.") {
        write(
            `data: ${JSON.stringify({
                type: "doc_find",
                filename: docInfo.filename,
                query,
                total_matches: 0,
            })}\n\n`,
        );
        return JSON.stringify({
            ok: false,
            filename: docInfo.filename,
            error: "Document could not be read.",
        });
    }

    const { norm, origIdx } = normalizeWithMap(text);
    const needle = normalizeQuery(query);
    if (!needle) {
        return JSON.stringify({
            ok: false,
            error: "Empty query after normalization.",
        });
    }

    type Hit = {
        index: number;
        excerpt: string;
        context: string;
    };
    const hits: Hit[] = [];
    let from = 0;
    while (from <= norm.length - needle.length && hits.length < maxResults) {
        const pos = norm.indexOf(needle, from);
        if (pos < 0) break;
        const endNormPos = pos + needle.length;
        const origStart = origIdx[pos] ?? 0;
        const origEnd =
            endNormPos - 1 < origIdx.length
                ? origIdx[endNormPos - 1] + 1
                : text.length;
        const ctxStart = Math.max(0, origStart - contextChars);
        const ctxEnd = Math.min(text.length, origEnd + contextChars);
        hits.push({
            index: hits.length,
            excerpt: text.slice(origStart, origEnd),
            context:
                (ctxStart > 0 ? "…" : "") +
                text.slice(ctxStart, ctxEnd).replace(/\s+/g, " ").trim() +
                (ctxEnd < text.length ? "…" : ""),
        });
        from = pos + Math.max(1, needle.length);
    }

    // Count total occurrences beyond the cap so the model knows whether to narrow the query.
    let totalMatches = hits.length;
    if (hits.length >= maxResults) {
        let probe = from;
        while (probe <= norm.length - needle.length) {
            const pos = norm.indexOf(needle, probe);
            if (pos < 0) break;
            totalMatches++;
            probe = pos + Math.max(1, needle.length);
        }
    }

    write(
        `data: ${JSON.stringify({
            type: "doc_find",
            filename: docInfo.filename,
            query,
            total_matches: totalMatches,
        })}\n\n`,
    );

    return JSON.stringify({
        ok: true,
        filename: docInfo.filename,
        query,
        total_matches: totalMatches,
        returned: hits.length,
        truncated: totalMatches > hits.length,
        hits,
    });
}

export type DocEditedResult = {
    filename: string;
    document_id: string;
    version_id: string;
    version_number: number | null;
    download_url: string;
    annotations: EditAnnotation[];
};

export type TurnEditState = Map<
    string,
    { versionId: string; versionNumber: number; storagePath: string }
>;

export type DocCreatedResult = {
    filename: string;
    download_url: string;
    document_id?: string;
    version_id?: string;
    version_number?: number | null;
};

export type DocReplicatedResult = {
    /** Filename of the source document being copied. */
    filename: string;
    /** How many copies were produced in this single tool call. */
    count: number;
    /** One entry per new copy. */
    copies: {
        new_filename: string;
        document_id: string;
        version_id: string;
    }[];
};

export async function runToolCalls(
    toolCalls: ToolCall[],
    docStore: DocStore,
    userId: string,
    db: ReturnType<typeof createServerSupabase>,
    write: (s: string) => void,
    workflowStore?: WorkflowStore,
    tabularStore?: TabularCellStore,
    docIndex?: DocIndex,
    turnEditState?: TurnEditState,
    projectId?: string | null,
): Promise<{
    toolResults: unknown[];
    docsRead: { filename: string; document_id?: string }[];
    docsFound: { filename: string; query: string; total_matches: number }[];
    docsCreated: DocCreatedResult[];
    docsReplicated: DocReplicatedResult[];
    workflowsApplied: { workflow_id: string; title: string }[];
    docsEdited: DocEditedResult[];
}> {
    const toolResults: unknown[] = [];
    const docsRead: { filename: string; document_id?: string }[] = [];
    const docsFound: {
        filename: string;
        query: string;
        total_matches: number;
    }[] = [];
    const docsCreated: DocCreatedResult[] = [];
    const docsReplicated: DocReplicatedResult[] = [];
    const workflowsApplied: { workflow_id: string; title: string }[] = [];
    const docsEdited: DocEditedResult[] = [];

    for (const tc of toolCalls) {
        let args: Record<string, unknown> = {};
        try {
            args = JSON.parse(tc.function.arguments || "{}");
        } catch {
            /* ignore */
        }

        if (tc.function.name === "remember") {
            const scope = projectId ?? "personal";
            const title = ((args.title as string) ?? "").trim();
            const body = ((args.body as string) ?? "").trim();
            const type = (args.type as string) ?? "notatka";
            const slug = ((args.slug as string) ?? title).trim();
            let content: string;
            if (!title || !body) {
                content = JSON.stringify({
                    error: "title i body sa wymagane",
                });
            } else {
                try {
                    const r = saveMemory({ scope, slug, type, title, body });
                    content = JSON.stringify({
                        ok: true,
                        action: r.action,
                        slug: r.slug,
                        scope: r.scope,
                    });
                } catch (e) {
                    content = JSON.stringify({
                        error: e instanceof Error ? e.message : String(e),
                    });
                }
            }
            toolResults.push({ role: "tool", tool_call_id: tc.id, content });
        } else if (tc.function.name === "recall") {
            const scope = projectId ?? "personal";
            const slug = (args.slug as string | undefined)?.trim();
            let content: string;
            try {
                if (slug) {
                    const m = readMemory(scope, slug);
                    content = m
                        ? JSON.stringify({ slug, meta: m.meta, body: m.body })
                        : JSON.stringify({ note: "Brak wpisu o tym slug." });
                } else {
                    content = JSON.stringify({
                        scope,
                        memories: listMemories(scope),
                    });
                }
            } catch (e) {
                content = JSON.stringify({
                    error: e instanceof Error ? e.message : String(e),
                });
            }
            toolResults.push({ role: "tool", tool_call_id: tc.id, content });
        } else if (tc.function.name === "search_corpus") {
            const query = (args.query as string) ?? "";
            const maxResults =
                typeof args.max_results === "number" ? args.max_results : 8;
            // Scope: dokumenty projektu (jezeli projektowy czat), inaczej caly
            // korpus usera. retrieve() sam degraduje do BM25+graf bez wektora.
            let docFilter: string[] | undefined;
            if (projectId) {
                const { data: projDocs } = await db
                    .from("documents")
                    .select("id")
                    .eq("project_id", projectId)
                    .eq("status", "ready");
                docFilter = ((projDocs ?? []) as { id: string }[]).map(
                    (d) => d.id,
                );
            }
            let content: string;
            try {
                const hits = await retrieve(query, maxResults, {
                    documentIds: docFilter,
                });
                const ids = [...new Set(hits.map((h) => h.documentId))];
                const fnMap = new Map<string, string>();
                if (ids.length) {
                    const { data: docs } = await db
                        .from("documents")
                        .select("id, filename")
                        .in("id", ids);
                    for (const d of (docs ?? []) as {
                        id: string;
                        filename: string;
                    }[]) {
                        fnMap.set(d.id, d.filename);
                    }
                }
                content = JSON.stringify({
                    query,
                    results: hits.map((h) => ({
                        document_id: h.documentId,
                        filename: fnMap.get(h.documentId) ?? h.documentId,
                        chunk_index: h.chunkIndex,
                        score: Number(h.score.toFixed(4)),
                        text: h.content,
                    })),
                    note: hits.length
                        ? undefined
                        : "Brak trafien w korpusie dla tego zapytania.",
                });
            } catch (e) {
                content = JSON.stringify({
                    query,
                    results: [],
                    error: e instanceof Error ? e.message : String(e),
                });
            }
            toolResults.push({ role: "tool", tool_call_id: tc.id, content });
        } else if (tc.function.name === "read_document") {
            const rawDocId = args.doc_id as string;
            const docId =
                resolveDocLabel(rawDocId, docStore, docIndex) ?? rawDocId;
            const content = await readDocumentContent(
                docId,
                docStore,
                write,
                docIndex,
                db,
            );
            const filename = docStore.get(docId)?.filename;
            const documentId = docIndex?.[docId]?.document_id;
            if (filename) docsRead.push({ filename, document_id: documentId });
            toolResults.push({
                role: "tool",
                tool_call_id: tc.id,
                content: filename
                    ? `${citationReminder(docId, filename)}\n\n${content}`
                    : content,
            });
        } else if (tc.function.name === "find_in_document") {
            const rawDocId = args.doc_id as string;
            const docId =
                resolveDocLabel(rawDocId, docStore, docIndex) ?? rawDocId;
            const query = (args.query as string) ?? "";
            const maxResults =
                typeof args.max_results === "number"
                    ? args.max_results
                    : undefined;
            const contextChars =
                typeof args.context_chars === "number"
                    ? args.context_chars
                    : undefined;
            const content = await findInDocumentContent({
                docLabel: docId,
                query,
                maxResults,
                contextChars,
                docStore,
                write,
                docIndex,
                db,
            });
            const filename = docStore.get(docId)?.filename;
            if (filename) {
                let totalMatches = 0;
                try {
                    const parsed = JSON.parse(content) as {
                        total_matches?: number;
                    };
                    totalMatches = parsed.total_matches ?? 0;
                } catch {
                    /* ignore — still record the find attempt */
                }
                docsFound.push({
                    filename,
                    query,
                    total_matches: totalMatches,
                });
            }
            toolResults.push({ role: "tool", tool_call_id: tc.id, content });
        } else if (tc.function.name === "list_documents") {
            const list = Array.from(docStore.entries()).map(
                ([doc_id, info]) => ({
                    doc_id,
                    filename: info.filename,
                    file_type: info.file_type,
                }),
            );
            toolResults.push({
                role: "tool",
                tool_call_id: tc.id,
                content: JSON.stringify(list),
            });
        } else if (tc.function.name === "fetch_documents") {
            const rawDocIds = (args.doc_ids as string[]) ?? [];
            const docIds = rawDocIds.map(
                (id) => resolveDocLabel(id, docStore, docIndex) ?? id,
            );
            const parts: string[] = [];
            for (const docId of docIds) {
                const content = await readDocumentContent(
                    docId,
                    docStore,
                    write,
                    docIndex,
                    db,
                );
                const filename = docStore.get(docId)?.filename ?? docId;
                parts.push(
                    `--- ${filename} (${docId}) ---\n${citationReminder(docId, filename)}\n\n${content}`,
                );
                if (docStore.get(docId)) {
                    const documentId = docIndex?.[docId]?.document_id;
                    docsRead.push({ filename, document_id: documentId });
                }
            }
            toolResults.push({
                role: "tool",
                tool_call_id: tc.id,
                content: parts.join("\n\n"),
            });
        } else if (tc.function.name === "list_workflows") {
            const list = workflowStore
                ? Array.from(workflowStore.entries()).map(([id, w]) => ({
                      id,
                      title: w.title,
                  }))
                : [];
            toolResults.push({
                role: "tool",
                tool_call_id: tc.id,
                content: JSON.stringify(list),
            });
        } else if (tc.function.name === "read_workflow") {
            const wfId = args.workflow_id as string;
            const wf = workflowStore?.get(wfId);
            if (wf) {
                write(
                    `data: ${JSON.stringify({ type: "workflow_applied", workflow_id: wfId, title: wf.title })}\n\n`,
                );
                workflowsApplied.push({ workflow_id: wfId, title: wf.title });
            }
            toolResults.push({
                role: "tool",
                tool_call_id: tc.id,
                content: wf ? wf.prompt_md : `Workflow '${wfId}' not found.`,
            });
        } else if (tc.function.name === "read_table_cells" && tabularStore) {
            const colIndices = args.col_indices as number[] | undefined;
            const rowIndices = args.row_indices as number[] | undefined;

            const filteredCols = colIndices?.length
                ? tabularStore.columns.filter((_, i) => colIndices.includes(i))
                : tabularStore.columns;
            const filteredDocs = rowIndices?.length
                ? tabularStore.documents.filter((_, i) =>
                      rowIndices.includes(i),
                  )
                : tabularStore.documents;

            const label = `${filteredCols.length} ${filteredCols.length === 1 ? "column" : "columns"} × ${filteredDocs.length} ${filteredDocs.length === 1 ? "row" : "rows"}`;
            write(
                `data: ${JSON.stringify({ type: "doc_read_start", filename: label })}\n\n`,
            );

            const lines: string[] = [];
            for (const col of filteredCols) {
                const colPos = tabularStore.columns.findIndex(
                    (c) => c.index === col.index,
                );
                for (const doc of filteredDocs) {
                    const rowPos = tabularStore.documents.findIndex(
                        (d) => d.id === doc.id,
                    );
                    const cell = tabularStore.cells.get(
                        `${col.index}:${doc.id}`,
                    );
                    lines.push(
                        `[COL:${colPos} "${col.name}" | ROW:${rowPos} "${doc.filename}"]`,
                    );
                    if (cell?.summary) {
                        lines.push(`Summary: ${cell.summary}`);
                        if (cell.flag) lines.push(`Flag: ${cell.flag}`);
                        if (cell.reasoning)
                            lines.push(`Reasoning: ${cell.reasoning}`);
                    } else {
                        lines.push(`(not yet generated)`);
                    }
                    lines.push("");
                }
            }

            write(
                `data: ${JSON.stringify({ type: "doc_read", filename: label })}\n\n`,
            );
            docsRead.push({ filename: label });
            toolResults.push({
                role: "tool",
                tool_call_id: tc.id,
                content: lines.join("\n") || "No cells found.",
            });
        } else if (tc.function.name === "edit_document" && docIndex) {
            const rawDocId = args.doc_id as string;
            const editsRaw = args.edits as unknown[] | undefined;
            const docId =
                resolveDocLabel(rawDocId, docStore, docIndex) ?? rawDocId;
            const docInfo = docStore.get(docId);
            const indexed = docIndex?.[docId];

            const emitEditError = (
                filename: string,
                documentId: string,
                error: string,
            ) => {
                // Surface the failure as a failed "Edited" block in the UI
                // (start → done-with-error) so it matches the shape the
                // success/late-failure paths already use.
                write(
                    `data: ${JSON.stringify({
                        type: "doc_edited_start",
                        filename,
                    })}\n\n`,
                );
                write(
                    `data: ${JSON.stringify({
                        type: "doc_edited",
                        filename,
                        document_id: documentId,
                        version_id: "",
                        download_url: "",
                        annotations: [],
                        error,
                    })}\n\n`,
                );
            };

            if (!docInfo || !indexed) {
                const err = `Document '${docId}' not found in this chat's attachments.`;
                emitEditError(docId, indexed?.document_id ?? "", err);
                toolResults.push({
                    role: "tool",
                    tool_call_id: tc.id,
                    content: JSON.stringify({ error: err }),
                });
            } else if (!Array.isArray(editsRaw) || editsRaw.length === 0) {
                const err = "edits array is required and must not be empty.";
                emitEditError(docInfo.filename, indexed.document_id, err);
                toolResults.push({
                    role: "tool",
                    tool_call_id: tc.id,
                    content: JSON.stringify({ error: err }),
                });
            } else if (docInfo.file_type !== "docx") {
                const err = "edit_document only supports .docx files.";
                emitEditError(docInfo.filename, indexed.document_id, err);
                toolResults.push({
                    role: "tool",
                    tool_call_id: tc.id,
                    content: JSON.stringify({ error: err }),
                });
            } else {
                write(
                    `data: ${JSON.stringify({
                        type: "doc_edited_start",
                        filename: docInfo.filename,
                    })}\n\n`,
                );
                const edits: EditInput[] = (
                    editsRaw as Record<string, unknown>[]
                ).map((e) => ({
                    find: String(e.find ?? ""),
                    replace: String(e.replace ?? ""),
                    context_before: String(e.context_before ?? ""),
                    context_after: String(e.context_after ?? ""),
                    reason: e.reason ? String(e.reason) : undefined,
                }));
                const reuseVersion = turnEditState?.get(indexed.document_id);
                const result = await runEditDocument({
                    documentId: indexed.document_id,
                    userId,
                    edits,
                    db,
                    reuseVersion,
                });

                if (result.ok) {
                    turnEditState?.set(indexed.document_id, {
                        versionId: result.version_id,
                        versionNumber: result.version_number,
                        storagePath: result.storage_path,
                    });
                    // Keep the chat-local doc label pointed at the latest
                    // edited version so any follow-up read_document call in
                    // the same assistant turn reads and cites the same bytes.
                    if (docIndex[docId]) {
                        docIndex[docId] = {
                            ...docIndex[docId],
                            version_id: result.version_id,
                            version_number: result.version_number,
                        };
                    }
                    const currentDocStore = docStore.get(docId);
                    if (currentDocStore) {
                        docStore.set(docId, {
                            ...currentDocStore,
                            storage_path: result.storage_path,
                        });
                    }
                    const payload: DocEditedResult = {
                        filename: docInfo.filename,
                        document_id: indexed.document_id,
                        version_id: result.version_id,
                        version_number: result.version_number,
                        download_url: result.download_url,
                        annotations: result.annotations,
                    };
                    docsEdited.push(payload);
                    write(
                        `data: ${JSON.stringify({
                            type: "doc_edited",
                            ...payload,
                        })}\n\n`,
                    );
                    toolResults.push({
                        role: "tool",
                        tool_call_id: tc.id,
                        content: JSON.stringify({
                            ok: true,
                            doc_id: docId,
                            document_id: indexed.document_id,
                            version_id: result.version_id,
                            version_number: result.version_number,
                            applied: result.annotations.length,
                            errors: result.errors,
                        }),
                    });
                } else {
                    write(
                        `data: ${JSON.stringify({
                            type: "doc_edited",
                            filename: docInfo.filename,
                            document_id: indexed.document_id,
                            version_id: "",
                            download_url: "",
                            annotations: [],
                            error: result.error,
                        })}\n\n`,
                    );
                    toolResults.push({
                        role: "tool",
                        tool_call_id: tc.id,
                        content: JSON.stringify({
                            ok: false,
                            error: result.error,
                        }),
                    });
                }
            }
        } else if (tc.function.name === "replicate_document" && docIndex) {
            const rawDocId = args.doc_id as string;
            const requestedFilename =
                typeof args.new_filename === "string" &&
                args.new_filename.trim()
                    ? args.new_filename.trim()
                    : null;
            const requestedCount =
                typeof args.count === "number" && Number.isFinite(args.count)
                    ? Math.max(1, Math.min(20, Math.floor(args.count)))
                    : 1;
            const sourceLabel =
                resolveDocLabel(rawDocId, docStore, docIndex) ?? rawDocId;
            const sourceInfo = docStore.get(sourceLabel);
            const sourceIndexed = docIndex[sourceLabel];
            const sourceFilename = sourceInfo?.filename ?? rawDocId;

            write(
                `data: ${JSON.stringify({
                    type: "doc_replicate_start",
                    filename: sourceFilename,
                    count: requestedCount,
                })}\n\n`,
            );

            const fail = (error: string) => {
                write(
                    `data: ${JSON.stringify({
                        type: "doc_replicated",
                        filename: sourceFilename,
                        count: requestedCount,
                        copies: [],
                        error,
                    })}\n\n`,
                );
                toolResults.push({
                    role: "tool",
                    tool_call_id: tc.id,
                    content: JSON.stringify({ ok: false, error }),
                });
            };

            if (!sourceInfo || !sourceIndexed) {
                fail(`Document '${rawDocId}' not found in this project.`);
            } else if (!projectId) {
                fail("replicate_document is only available in project chats.");
            } else {
                try {
                    // Pull the active version once — every copy gets the
                    // same starting bytes (with any accepted tracked
                    // changes rolled in), no point re-fetching per copy.
                    const active = await loadActiveVersion(
                        sourceIndexed.document_id,
                        db,
                    );
                    const sourcePath =
                        active?.storage_path ?? sourceInfo.storage_path;
                    const sourcePdfPath = active?.pdf_storage_path ?? null;
                    const raw = await downloadFile(sourcePath);
                    const pdfBytes = sourcePdfPath
                        ? await downloadFile(sourcePdfPath)
                        : null;
                    if (!raw) {
                        fail(
                            "Could not read the source document's bytes from storage.",
                        );
                    } else {
                        // Build N filenames. With count=1 keep the
                        // pre-existing "(copy)" suffix; with count>1 use
                        // numbered "(1)", "(2)" suffixes.
                        const srcExt =
                            sourceInfo.filename.match(/\.[^./\\]+$/)?.[0] ?? "";
                        const baseStem = (() => {
                            if (requestedFilename) {
                                return requestedFilename.replace(
                                    /\.[^./\\]+$/,
                                    "",
                                );
                            }
                            return sourceInfo.filename.replace(
                                /\.[^./\\]+$/,
                                "",
                            );
                        })();
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
                            file_type: sourceInfo.file_type,
                            size_bytes: raw.byteLength,
                            status: "ready",
                        }));
                        const { data: insertedDocs, error: docErr } = await db
                            .from("documents")
                            .insert(docRows)
                            .select("id, filename");
                        if (
                            docErr ||
                            !insertedDocs ||
                            insertedDocs.length === 0
                        ) {
                            fail(
                                `Failed to record replicated documents: ${docErr?.message ?? "unknown"}`,
                            );
                        } else {
                            // Preserve the request order so each row pairs
                            // with the right filename. Supabase returns
                            // inserted rows in the same order as the
                            // payload.
                            const newDocs = insertedDocs as {
                                id: string;
                                filename: string;
                            }[];
                            const contentType =
                                sourceInfo.file_type === "pdf"
                                    ? "application/pdf"
                                    : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

                            // Parallel uploads: the doc bytes (and PDF
                            // rendition if any) for every new copy.
                            const uploadJobs: Promise<unknown>[] = [];
                            const newKeys: string[] = [];
                            const newPdfKeys: (string | null)[] = [];
                            for (const d of newDocs) {
                                const key = storageKey(
                                    userId,
                                    d.id,
                                    d.filename,
                                );
                                newKeys.push(key);
                                uploadJobs.push(
                                    uploadFile(key, raw, contentType),
                                );
                                if (pdfBytes) {
                                    const pdfKey = convertedPdfKey(
                                        userId,
                                        d.id,
                                    );
                                    newPdfKeys.push(pdfKey);
                                    uploadJobs.push(
                                        uploadFile(
                                            pdfKey,
                                            pdfBytes,
                                            "application/pdf",
                                        ),
                                    );
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
                            const { data: insertedVersions, error: verErr } =
                                await db
                                    .from("document_versions")
                                    .insert(versionRows)
                                    .select("id, document_id");
                            if (
                                verErr ||
                                !insertedVersions ||
                                insertedVersions.length !== newDocs.length
                            ) {
                                fail(
                                    `Failed to record replicated document versions: ${verErr?.message ?? "unknown"}`,
                                );
                            } else {
                                const versionByDocId = new Map<
                                    string,
                                    string
                                >();
                                for (const v of insertedVersions as {
                                    id: string;
                                    document_id: string;
                                }[]) {
                                    versionByDocId.set(v.document_id, v.id);
                                }

                                // current_version_id has to be a per-row
                                // value, so a single UPDATE statement
                                // can't cover all N. Fan out in parallel
                                // instead of sequential awaits.
                                await Promise.all(
                                    newDocs.map((d) =>
                                        db
                                            .from("documents")
                                            .update({
                                                current_version_id:
                                                    versionByDocId.get(d.id),
                                            })
                                            .eq("id", d.id),
                                    ),
                                );

                                // Register every copy under a fresh doc-N
                                // slug so the model can edit/read any of
                                // them in the same turn.
                                const existingLabels = new Set(
                                    Object.keys(docIndex),
                                );
                                let nextLabelIdx = 0;
                                const copies: {
                                    new_filename: string;
                                    document_id: string;
                                    version_id: string;
                                }[] = [];
                                const toolPayloadCopies: {
                                    doc_id: string;
                                    document_id: string;
                                    version_id: string;
                                    filename: string;
                                    download_url: string;
                                }[] = [];
                                for (let idx = 0; idx < newDocs.length; idx++) {
                                    const d = newDocs[idx];
                                    const newKey = newKeys[idx];
                                    const versionId = versionByDocId.get(d.id);
                                    if (!versionId) continue;
                                    while (
                                        existingLabels.has(
                                            `doc-${nextLabelIdx}`,
                                        )
                                    )
                                        nextLabelIdx++;
                                    const slug = `doc-${nextLabelIdx}`;
                                    existingLabels.add(slug);
                                    docIndex[slug] = {
                                        document_id: d.id,
                                        filename: d.filename,
                                    };
                                    docStore.set(slug, {
                                        storage_path: newKey,
                                        file_type: sourceInfo.file_type,
                                        filename: d.filename,
                                    });
                                    copies.push({
                                        new_filename: d.filename,
                                        document_id: d.id,
                                        version_id: versionId,
                                    });
                                    toolPayloadCopies.push({
                                        doc_id: slug,
                                        document_id: d.id,
                                        version_id: versionId,
                                        filename: d.filename,
                                        download_url: buildDownloadUrl(
                                            newKey,
                                            d.filename,
                                        ),
                                    });
                                }

                                write(
                                    `data: ${JSON.stringify({
                                        type: "doc_replicated",
                                        filename: sourceFilename,
                                        count: copies.length,
                                        copies,
                                    })}\n\n`,
                                );
                                docsReplicated.push({
                                    filename: sourceFilename,
                                    count: copies.length,
                                    copies,
                                });
                                toolResults.push({
                                    role: "tool",
                                    tool_call_id: tc.id,
                                    content: JSON.stringify({
                                        ok: true,
                                        count: copies.length,
                                        copies: toolPayloadCopies,
                                    }),
                                });
                            }
                        }
                    }
                } catch (e) {
                    fail(`replicate_document failed: ${String(e)}`);
                }
            }
        } else if (tc.function.name === "generate_docx") {
            const title = args.title as string;
            const landscape = !!args.landscape;
            console.log(
                `[generate_docx] title="${title}" landscape=${landscape} args.landscape=${args.landscape}`,
            );
            const previewFilename = `${
                title
                    .replace(/[^a-zA-Z0-9 _-]/g, "")
                    .trim()
                    .slice(0, 64) || "document"
            }.docx`;
            write(
                `data: ${JSON.stringify({ type: "doc_created_start", filename: previewFilename })}\n\n`,
            );
            const result = await generateDocx(
                title,
                args.sections as unknown[],
                userId,
                db,
                { landscape, projectId: projectId ?? null },
            );
            let newDocLabel: string | null = null;
            if ("filename" in result && "download_url" in result) {
                const dlFilename = result.filename as string;
                const dlUrl = result.download_url as string;
                const documentId = (result as { document_id?: string })
                    .document_id;
                const versionId = (result as { version_id?: string })
                    .version_id;
                const versionNumber =
                    (result as { version_number?: number }).version_number ??
                    null;
                const storagePath = (result as { storage_path?: string })
                    .storage_path;

                // Register the generated doc in the chat context so
                // edit_document (and read_document / find_in_document)
                // can act on it within the same assistant turn. New label
                // is the next free `doc-N` index. Subsequent turns pick
                // it up via the normal attachment/project doc query.
                if (documentId && storagePath && docIndex) {
                    const existingLabels = new Set(Object.keys(docIndex));
                    let i = 0;
                    while (existingLabels.has(`doc-${i}`)) i++;
                    newDocLabel = `doc-${i}`;
                    docIndex[newDocLabel] = {
                        document_id: documentId,
                        filename: dlFilename,
                    };
                    docStore.set(newDocLabel, {
                        storage_path: storagePath,
                        file_type: "docx",
                        filename: dlFilename,
                    });
                }

                write(
                    `data: ${JSON.stringify({
                        type: "doc_created",
                        filename: dlFilename,
                        download_url: dlUrl,
                        document_id: documentId,
                        version_id: versionId,
                        version_number: versionNumber,
                    })}\n\n`,
                );
                docsCreated.push({
                    filename: dlFilename,
                    download_url: dlUrl,
                    document_id: documentId,
                    version_id: versionId,
                    version_number: versionNumber,
                });
            } else {
                write(
                    `data: ${JSON.stringify({ type: "doc_created", filename: previewFilename, download_url: "" })}\n\n`,
                );
            }
            // Surface the chat-local doc label in the tool result so the
            // model can pass it as `doc_id` to edit_document / read_document
            // / find_in_document in the same turn. Without this the model
            // only sees the DB UUID, which isn't valid as a doc_id anchor.
            const { download_url, storage_path, ...safeToolResult } =
                result as Record<string, unknown>;
            const toolResultPayload = newDocLabel
                ? {
                      ...safeToolResult,
                      doc_id: newDocLabel,
                      next_required_action: `Before writing your final response, call read_document with doc_id "${newDocLabel}". Describe and cite the generated document using doc_id "${newDocLabel}", not the source/template document.`,
                  }
                : safeToolResult;
            toolResults.push({
                role: "tool",
                tool_call_id: tc.id,
                content: JSON.stringify(toolResultPayload),
            });
        }
    }

    return {
        toolResults,
        docsRead,
        docsFound,
        docsCreated,
        docsReplicated,
        workflowsApplied,
        docsEdited,
    };
}

// ---------------------------------------------------------------------------
// LLM streaming loop
// ---------------------------------------------------------------------------

