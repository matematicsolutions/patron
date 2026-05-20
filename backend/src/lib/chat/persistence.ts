// Builderzy kontekstu (dokumenty + workflows) + ekstrakcja adnotacji do zapisu w DB.
// Wyciagniete z chatTools.ts w ramach refactoru Faza 2.3 iteracja 2.

import { attachActiveVersionPaths } from "../documentVersions";
import type { McpCitation } from "../mcp";
import { createServerSupabase } from "../supabase";
import { parseCitations, resolveDoc } from "./citations";
import type {
    ChatMessage,
    DocIndex,
    DocStore,
    EditAnnotation,
    WorkflowStore,
} from "./types";

// ---------------------------------------------------------------------------
// Annotation extraction (for DB save)
// ---------------------------------------------------------------------------

export function extractAnnotations(
    fullText: string,
    docIndex: DocIndex,
    events?: ({ type: string } & Record<string, unknown>[]) | unknown[],
    mcpCitations?: McpCitation[],
): unknown[] {
    const out: unknown[] = parseCitations(fullText).map((c) => {
        const docInfo = resolveDoc(c.doc_id, docIndex);
        return {
            type: "citation_data",
            ref: c.ref,
            doc_id: c.doc_id,
            document_id: docInfo?.document_id,
            version_id: docInfo?.version_id ?? null,
            version_number: docInfo?.version_number ?? null,
            filename: docInfo?.filename ?? c.doc_id,
            page: c.page,
            quote: c.quote,
        };
    });
    if (Array.isArray(events)) {
        for (const ev of events as {
            type?: string;
            annotations?: EditAnnotation[];
        }[]) {
            if (ev?.type === "doc_edited" && Array.isArray(ev.annotations)) {
                for (const a of ev.annotations)
                    out.push({ ...a, type: "edit_data" });
            }
        }
    }
    // Cytaty z serwerow MCP zapisujemy z dyskryminatorem `mcp_citation`
    // (frontend loader rozdziela mieszane annotations na klasyczne i MCP).
    if (Array.isArray(mcpCitations)) {
        for (const c of mcpCitations) {
            out.push({ ...c, type: "mcp_citation" });
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// Document context builder (from message file attachments)
// ---------------------------------------------------------------------------

export async function buildDocContext(
    messages: ChatMessage[],
    userId: string,
    db: ReturnType<typeof createServerSupabase>,
    chatId?: string | null,
): Promise<{ docIndex: DocIndex; docStore: DocStore }> {
    const docIndex: DocIndex = {};
    const docStore: DocStore = new Map();

    const documentIds = new Set<string>();
    for (const m of messages) {
        for (const f of m.files ?? []) {
            if (f.document_id) documentIds.add(f.document_id);
        }
    }

    // Also pull in document_ids from prior assistant events in this chat —
    // generated docs (generate_docx) and tracked-change edits (edit_document)
    // aren't attached to user messages as files, so they only live in the
    // assistant's `doc_created` / `doc_edited` events. Without this sweep
    // the model loses access to generated docs after the turn that created
    // them, and can't call edit_document / read_document on them.
    if (chatId) {
        const { data: rows } = await db
            .from("chat_messages")
            .select("content")
            .eq("chat_id", chatId)
            .eq("role", "assistant");
        for (const row of rows ?? []) {
            const content = (row as { content?: unknown }).content;
            if (!Array.isArray(content)) continue;
            for (const ev of content as Record<string, unknown>[]) {
                if (
                    (ev?.type === "doc_created" || ev?.type === "doc_edited") &&
                    typeof ev.document_id === "string"
                ) {
                    documentIds.add(ev.document_id);
                }
            }
        }
    }

    const ids = [...documentIds];
    if (ids.length > 0) {
        const { data: docs } = await db
            .from("documents")
            .select("id, filename, file_type, current_version_id, status")
            .in("id", ids)
            .eq("user_id", userId)
            .eq("status", "ready");

        const docList = (docs ?? []) as unknown as {
            id: string;
            filename: string;
            file_type: string;
            current_version_id?: string | null;
            active_version_number?: number | null;
            storage_path?: string | null;
        }[];
        await attachActiveVersionPaths(db, docList);
        for (let i = 0; i < docList.length; i++) {
            const doc = docList[i];
            if (!doc.storage_path) continue;
            const docLabel = `doc-${i}`;
            docIndex[docLabel] = {
                document_id: doc.id,
                filename: doc.filename,
                version_id: doc.current_version_id ?? null,
                version_number: doc.active_version_number ?? null,
            };
            docStore.set(docLabel, {
                storage_path: doc.storage_path,
                file_type: doc.file_type,
                filename: doc.filename,
            });
        }
    }

    console.log(
        "[buildDocContext] available docs:",
        Object.entries(docIndex).map(([label, info]) => ({
            label,
            filename: info.filename,
            document_id: info.document_id,
        })),
    );
    return { docIndex, docStore };
}

export async function buildProjectDocContext(
    projectId: string,
    _userId: string,
    db: ReturnType<typeof createServerSupabase>,
): Promise<{
    docIndex: DocIndex;
    docStore: DocStore;
    folderPaths: Map<string, string>;
}> {
    const docIndex: DocIndex = {};
    const docStore: DocStore = new Map();

    const [{ data: docs }, { data: folders }] = await Promise.all([
        db
            .from("documents")
            .select(
                "id, filename, file_type, current_version_id, status, folder_id",
            )
            .eq("project_id", projectId)
            .eq("status", "ready")
            .order("created_at", { ascending: true }),
        db
            .from("project_subfolders")
            .select("id, name, parent_folder_id")
            .eq("project_id", projectId),
    ]);
    const docList = (docs ?? []) as unknown as {
        id: string;
        filename: string;
        file_type: string;
        current_version_id?: string | null;
        active_version_number?: number | null;
        folder_id?: string | null;
        storage_path?: string | null;
    }[];
    await attachActiveVersionPaths(db, docList);

    // Build folder id → full path map
    const folderMap = new Map<
        string,
        { name: string; parent_folder_id: string | null }
    >();
    for (const f of folders ?? [])
        folderMap.set(f.id, {
            name: f.name,
            parent_folder_id: f.parent_folder_id,
        });

    function resolvePath(folderId: string | null): string {
        if (!folderId) return "";
        const parts: string[] = [];
        let cur: string | null = folderId;
        while (cur) {
            const f = folderMap.get(cur);
            if (!f) break;
            parts.unshift(f.name);
            cur = f.parent_folder_id;
        }
        return parts.join(" / ");
    }

    const folderPaths = new Map<string, string>(); // doc label → folder path

    for (let i = 0; i < docList.length; i++) {
        const doc = docList[i];
        if (!doc.storage_path) continue;
        const docLabel = `doc-${i}`;
        docIndex[docLabel] = {
            document_id: doc.id,
            filename: doc.filename,
            version_id: doc.current_version_id ?? null,
            version_number: doc.active_version_number ?? null,
        };
        docStore.set(docLabel, {
            storage_path: doc.storage_path,
            file_type: doc.file_type,
            filename: doc.filename,
        });
        const path = resolvePath(doc.folder_id ?? null);
        if (path) folderPaths.set(docLabel, path);
    }

    console.log(
        "[buildProjectDocContext] available docs:",
        Object.entries(docIndex).map(([label, info]) => ({
            label,
            filename: info.filename,
            document_id: info.document_id,
            folder: folderPaths.get(label) ?? null,
        })),
    );
    return { docIndex, docStore, folderPaths };
}

export async function buildWorkflowStore(
    userId: string,
    userEmail: string | null | undefined,
    db: ReturnType<typeof createServerSupabase>,
): Promise<WorkflowStore> {
    const { BUILTIN_WORKFLOWS } = await import("../builtinWorkflows");
    const store: WorkflowStore = new Map();
    const normalizedUserEmail = (userEmail ?? "").trim().toLowerCase();

    // Seed built-ins first
    for (const wf of BUILTIN_WORKFLOWS) {
        store.set(wf.id, { title: wf.title, prompt_md: wf.prompt_md });
    }

    // Then overlay user-owned assistant workflows.
    const { data: workflows } = await db
        .from("workflows")
        .select("id, title, prompt_md")
        .eq("user_id", userId)
        .eq("type", "assistant");
    for (const wf of workflows ?? []) {
        if (wf.prompt_md) {
            store.set(wf.id, { title: wf.title, prompt_md: wf.prompt_md });
        }
    }

    // Shared assistant workflows must also be readable by workflow tools.
    if (normalizedUserEmail) {
        const { data: shares } = await db
            .from("workflow_shares")
            .select("workflow_id")
            .eq("shared_with_email", normalizedUserEmail);
        const sharedIds = [
            ...new Set((shares ?? []).map((share) => share.workflow_id)),
        ];
        if (sharedIds.length > 0) {
            const { data: sharedWorkflows } = await db
                .from("workflows")
                .select("id, title, prompt_md")
                .in("id", sharedIds)
                .eq("type", "assistant");
            for (const wf of sharedWorkflows ?? []) {
                if (wf.prompt_md) {
                    store.set(wf.id, {
                        title: wf.title,
                        prompt_md: wf.prompt_md,
                    });
                }
            }
        }
    }
    return store;
}
