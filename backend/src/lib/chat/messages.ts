// Budowanie strumienia wiadomosci dla LLM + wzbogacanie poprzedniej tury
// adnotacjami o aktywnosci narzedziowej.
// Wyciagniete z chatTools.ts w ramach refactoru Faza 2.3.

import { createServerSupabase } from "../supabase";
import { buildSystemPrompt, getAgentLocale } from "./prompts";
import type { ChatMessage, DocIndex } from "./types";

/**
 * Append a tool-activity summary to the most recent assistant message so
 * the model can see what it just did (read / create / edit / workflow
 * applied) in the prior turn — otherwise it only sees its own prose and
 * forgets which docs it touched, which leads to e.g. re-generating a doc
 * that already exists.
 *
 * Doc references use the *current-turn* `doc_id` slug (looked up by
 * matching the event's stored `document_id` against this turn's freshly
 * built `docIndex`), since slugs are reassigned every turn and the old
 * slug from the prior turn would be meaningless. Falls back to filename
 * only if the doc is no longer in the index (deleted, scope changed).
 */
export async function enrichWithPriorEvents(
    messages: ChatMessage[],
    chatId: string | null | undefined,
    db: ReturnType<typeof createServerSupabase>,
    docIndex: DocIndex,
): Promise<ChatMessage[]> {
    if (!chatId) return messages;
    const { data: rows } = await db
        .from("chat_messages")
        .select("content, created_at")
        .eq("chat_id", chatId)
        .eq("role", "assistant")
        .order("created_at", { ascending: false })
        .limit(1);

    const lastRow = rows?.[0] as { content?: unknown } | undefined;
    const content = lastRow?.content;
    if (!Array.isArray(content)) return messages;

    const slugByDocumentId = new Map<string, string>();
    for (const [slug, info] of Object.entries(docIndex)) {
        if (info.document_id) slugByDocumentId.set(info.document_id, slug);
    }
    const refFor = (documentId: unknown, filename: unknown) => {
        const slug =
            typeof documentId === "string"
                ? slugByDocumentId.get(documentId)
                : undefined;
        return slug ? `${slug} ("${filename}")` : `"${filename}"`;
    };

    const lines: string[] = [];
    for (const ev of content as Record<string, unknown>[]) {
        if (ev?.type === "doc_created") {
            lines.push(
                `- generate_docx → ${refFor(ev.document_id, ev.filename)}`,
            );
        } else if (ev?.type === "doc_edited") {
            lines.push(
                `- edit_document → ${refFor(ev.document_id, ev.filename)}`,
            );
        } else if (ev?.type === "doc_read") {
            lines.push(
                `- read_document → ${refFor(ev.document_id, ev.filename)}`,
            );
        } else if (ev?.type === "doc_replicated") {
            // The model needs to know what each copy resolved to so it
            // can call edit_document / read_document on them. Emit one
            // line per copy, all attributed back to the same source.
            const srcLabel =
                typeof ev.filename === "string" ? `"${ev.filename}"` : "";
            const copies = Array.isArray(ev.copies)
                ? (ev.copies as {
                      new_filename?: unknown;
                      document_id?: unknown;
                  }[])
                : [];
            for (const c of copies) {
                const ref = refFor(c.document_id, c.new_filename);
                lines.push(
                    srcLabel
                        ? `- replicate_document → ${ref} (copy of ${srcLabel})`
                        : `- replicate_document → ${ref}`,
                );
            }
        } else if (ev?.type === "workflow_applied") {
            lines.push(`- applied workflow: "${ev.title}"`);
        }
    }
    if (lines.length === 0) return messages;
    const summary = `\n\n[Tool activity in your previous turn]\n${lines.join("\n")}`;

    // Find the index of the last assistant message and attach the
    // summary there only.
    let lastAssistantIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === "assistant") {
            lastAssistantIdx = i;
            break;
        }
    }
    if (lastAssistantIdx < 0) return messages;
    const enriched = messages.slice();
    const target = enriched[lastAssistantIdx];
    enriched[lastAssistantIdx] = {
        ...target,
        content: (target.content ?? "") + summary,
    };
    return enriched;
}

export function buildMessages(
    messages: ChatMessage[],
    docAvailability: {
        doc_id: string;
        filename: string;
        folder_path?: string;
    }[],
    systemPromptExtra?: string,
    docIndex?: DocIndex,
) {
    const formatted: unknown[] = [];
    // Jezyk agenta sledzi locale instalacji (PATRON_LOCALE), mirror frontendu.
    // Substancja jurysdykcyjna (drafting pism PL, SAOS) zostaje PL niezaleznie. ADR-0135.
    let systemContent = buildSystemPrompt(getAgentLocale());

    if (systemPromptExtra) {
        systemContent += `\n\n${systemPromptExtra.trim()}`;
    }

    if (docAvailability.length) {
        systemContent += "\n\n---\nAVAILABLE DOCUMENTS:\n";
        for (const doc of docAvailability) {
            const label = doc.folder_path
                ? `${doc.folder_path} / ${doc.filename}`
                : doc.filename;
            systemContent += `- ${doc.doc_id}: ${label}\n`;
        }
        systemContent +=
            "\nYou do NOT retain document content between conversation turns. You MUST call read_document (or fetch_documents) at the start of every response that involves a document's content, even if you have read it in a previous turn. Failure to do so will result in hallucinated or stale content.\n---\n";
    }
    formatted.push({ role: "system", content: systemContent });

    // Map document_id (UUID) → current-turn doc_id slug, so when we
    // inline a user attachment we hand the model the same handle it
    // would use to call read_document / fetch_documents.
    const slugByDocumentId = new Map<string, string>();
    if (docIndex) {
        for (const [slug, info] of Object.entries(docIndex)) {
            if (info.document_id) slugByDocumentId.set(info.document_id, slug);
        }
    }

    for (const msg of messages) {
        let content = msg.content ?? "";
        if (msg.role === "user" && msg.workflow) {
            content = `[Workflow: ${msg.workflow.title} (id: ${msg.workflow.id})]\n\n${content}`;
        }
        if (msg.role === "user" && msg.files?.length) {
            const lines = msg.files.map((f) => {
                const slug = f.document_id
                    ? slugByDocumentId.get(f.document_id)
                    : undefined;
                return slug ? `- ${slug}: ${f.filename}` : `- ${f.filename}`;
            });
            content = `[The user attached the following document(s) to this message:\n${lines.join("\n")}]\n\n${content}`;
        }
        formatted.push({ role: msg.role, content });
    }
    return formatted;
}
