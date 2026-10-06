// Jawne sygnaly odpowiedzi czatu zamiast ciszy (audyt 2026-09):
//  - D-14 `citations_parse_failed`: przypisy <CITATIONS> przepadly przy parsowaniu,
//  - D-07 `mcp_error`: konektor MCP padl w tej turze (B-03: albo jego wynik
//    wstrzymala kontrola bezpieczenstwa wejscia - reason "input_security"),
//  - B-02 `mutation_staged`: akcja agenta czeka na karcie zatwierdzenia
//    (ADR-0137, domyslnie wlaczone od 2026-10-06) - z linkiem do skrzynki kart.
// Renderowane POZA zwijanym blokiem "pracy" asystenta (PreResponseWrapper), zeby
// ostrzezenie nie chowalo sie pod rozwijana sekcja.

import Link from "next/link";
import { t } from "@/i18n";
import type { AssistantEvent } from "./types";

export type ChatSignalEvent = Extract<
    AssistantEvent,
    | { type: "citations_parse_failed" }
    | { type: "mcp_error" }
    | { type: "mutation_staged" }
>;

export function isChatSignalEvent(e: AssistantEvent): e is ChatSignalEvent {
    return (
        e.type === "citations_parse_failed" ||
        e.type === "mcp_error" ||
        e.type === "mutation_staged"
    );
}

/** Skrzynka kart zatwierdzen (ADR-0137) - ta sama trasa co zakladka konta. */
export const APPROVAL_INBOX_HREF = "/account/approval-cards";

function stagedToolLabel(tool: string): string {
    if (tool === "edit_document") return t("approvals.toolEditDocument");
    if (tool === "generate_docx") return t("approvals.toolGenerateDocx");
    if (tool === "replicate_document") return t("approvals.toolReplicateDocument");
    if (tool === "remember") return t("approvals.toolRemember");
    if (tool === "add_comments") return t("mutationStaged.toolAddComments");
    return tool || "?";
}

function signalText(e: ChatSignalEvent): string {
    if (e.type === "mutation_staged") {
        return t("mutationStaged.pending").replace("{action}", stagedToolLabel(e.tool));
    }
    if (e.type === "mcp_error") {
        const key =
            e.reason === "input_security"
                ? "chatSignals.mcpResultWithheld"
                : "chatSignals.mcpConnectorFailed";
        return t(key)
            .replace("{server}", e.server || "?")
            .replace("{tool}", e.tool || "?");
    }
    if (e.reason === "invalid_records" && e.dropped > 0) {
        return t("chatSignals.citationsDropped").replace("{count}", String(e.dropped));
    }
    return t("chatSignals.citationsParseFailed");
}

export function ChatSignalNotices({ events }: { events?: AssistantEvent[] }) {
    const signals = (events ?? []).filter(isChatSignalEvent);
    if (signals.length === 0) return null;
    return (
        <div className="mt-3 flex flex-col gap-1.5" data-testid="chat-signal-notices">
            {signals.map((e, i) => (
                <div
                    key={i}
                    data-testid="chat-signal-notice"
                    data-signal={e.type}
                    className="border-l-2 border-unverified bg-unverified-soft px-3 py-2 text-xs text-unverified"
                >
                    {signalText(e)}
                    {e.type === "mutation_staged" && (
                        <>
                            {" "}
                            <Link
                                href={APPROVAL_INBOX_HREF}
                                data-testid="approval-inbox-link"
                                className="font-medium underline"
                            >
                                {t("mutationStaged.openInbox")}
                            </Link>
                        </>
                    )}
                </div>
            ))}
        </div>
    );
}
