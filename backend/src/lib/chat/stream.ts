// LLM streaming entry-point - laczy buildowanie wiadomosci, dispatch narzedzi,
// streaming SSE i citations (dokumentowe + MCP).
// Wyciagniete z chatTools.ts w ramach refactoru Faza 2.3 iteracja 2.

import {
    streamChatWithTools,
    resolveModel,
    DEFAULT_MAIN_MODEL,
    type LlmMessage,
    type OpenAIToolSchema,
} from "../llm";
import { getMcpTools, isMcpTool, runMcpTool, type McpCitation } from "../mcp";
import {
    enforceEgressGuard,
    appendLlmRouteEvent,
    caseCostCapUsd,
    getCaseSpentUsd,
    evaluateBudget,
    appendCostCapEvent,
} from "../routing";
import {
    wrapConversation,
    PseudonimStreamUnwrapper,
    plEntityDetector,
    unwrap,
} from "../pseudonim";
import type { PseudonimMap } from "../pseudonim";
import { createServerSupabase } from "../supabase";

/**
 * Rekurencyjnie odwraca tokeny pseudonimow w argumentach wywolania narzedzia.
 * Model widzi swiat zamaskowany (egress), ale narzedzia pracuja na danych
 * LOKALNYCH, ktore zamaskowane nigdy nie byly - token w argumencie jest wiec
 * zawsze bledem. `unwrap` podmienia tylko ZNANE tokeny, wiec dla zwyklego
 * tekstu jest to no-op.
 */
function odtworzTokeny(wartosc: unknown, map: PseudonimMap): unknown {
    if (typeof wartosc === "string") return unwrap(wartosc, map);
    if (Array.isArray(wartosc))
        return wartosc.map((v) => odtworzTokeny(v, map));
    if (wartosc && typeof wartosc === "object") {
        const wynik: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(wartosc as Record<string, unknown>))
            wynik[k] = odtworzTokeny(v, map);
        return wynik;
    }
    return wartosc;
}
import { CITATIONS_OPEN_TAG, parseCitations, resolveDoc } from "./citations";
import { groundCitationsByRef } from "./ground-citations";
import { makeJudge } from "../citation/judge";
import type { GroundingResult } from "../citation/grounding";
import {
    groundMcpCitations,
    mcpCitationKey,
    type McpGroundingReport,
    type McpSourceText,
} from "../citation/mcp-grounding";
import { TOOLS, WORKFLOW_TOOLS } from "./tools";
import { runToolCalls, type TurnEditState } from "./tool-dispatch";
import type {
    ChatMessage,
    CommentAnnotation,
    DocIndex,
    DocStore,
    EditAnnotation,
    TabularCellStore,
    ToolCall,
    WorkflowStore,
} from "./types";

type AssistantEvent =
    | { type: "reasoning"; text: string }
    | { type: "doc_read"; filename: string; document_id?: string }
    | {
          type: "doc_find";
          filename: string;
          query: string;
          total_matches: number;
      }
    | {
          type: "doc_created";
          filename: string;
          download_url: string;
          document_id?: string;
          version_id?: string;
          version_number?: number | null;
      }
    | { type: "doc_download"; filename: string; download_url: string }
    | {
          type: "doc_replicated";
          /** Source document being copied. */
          filename: string;
          count: number;
          copies: {
              new_filename: string;
              document_id: string;
              version_id: string;
          }[];
      }
    | { type: "workflow_applied"; workflow_id: string; title: string }
    | {
          type: "doc_edited";
          filename: string;
          document_id: string;
          version_id: string;
          /** Per-document monotonic Vn; null if backend couldn't determine it. */
          version_number: number | null;
          download_url: string;
          annotations: EditAnnotation[];
      }
    | {
          type: "doc_commented";
          filename: string;
          document_id: string;
          version_id: string;
          version_number: number | null;
          download_url: string;
          annotations: CommentAnnotation[];
      }
    | { type: "content"; text: string };

export async function runLLMStream(params: {
    apiMessages: unknown[];
    docStore: DocStore;
    docIndex: DocIndex;
    userId: string;
    db: ReturnType<typeof createServerSupabase>;
    write: (s: string) => void;
    extraTools?: unknown[];
    workflowStore?: WorkflowStore;
    tabularStore?: TabularCellStore;
    buildCitations?: (fullText: string) => unknown[];
    model?: string;
    apiKeys?: import("../llm").UserApiKeys;
    /**
     * If set, generate_docx will attach created docs to this project so
     * they appear in the project sidebar. Leave null for general chats —
     * generated docs still get persisted, but as standalone documents.
     */
    projectId?: string | null;
    /**
     * US5 / ADR-0093: gdy true, operator swiadomie nadpisuje twardy cost-cap
     * sprawy (decyzja logowana do audit jako cost_cap action=override).
     */
    allowBudgetOverride?: boolean;
}): Promise<{
    fullText: string;
    events: AssistantEvent[];
    /** Cytaty z serwerow MCP - do zapisania w DB jako adnotacje. */
    mcpCitations: McpCitation[];
    /** ADR-0005: werdykt mechanicznej weryfikacji cytatow per ref. */
    grounding: Record<number, GroundingResult>;
    /** ADR-0146: grounding cytatow MCP (null gdy w turze nie bylo zrodel MCP). */
    mcpGrounding: McpGroundingReport | null;
}> {
    const {
        apiMessages,
        docStore,
        docIndex,
        userId,
        db,
        write,
        extraTools,
        workflowStore,
        tabularStore,
        buildCitations,
        model,
        apiKeys,
        projectId,
        allowBudgetOverride,
    } = params;
    const mcpTools = await getMcpTools();
    const activeTools = extraTools?.length
        ? [...TOOLS, ...WORKFLOW_TOOLS, ...extraTools, ...mcpTools]
        : [...TOOLS, ...WORKFLOW_TOOLS, ...mcpTools];

    // Extract system prompt; pass remaining turns to the adapter as
    // plain user/assistant messages.
    const rawMsgs = apiMessages as { role: string; content: string | null }[];
    const systemPrompt =
        rawMsgs[0]?.role === "system" ? (rawMsgs[0].content ?? "") : "";
    const chatMessages: LlmMessage[] = rawMsgs
        .filter((m) => m.role !== "system")
        .map((m) => ({
            role: m.role === "assistant" ? "assistant" : "user",
            content: m.content ?? "",
        }));

    const events: AssistantEvent[] = [];
    // One assistant turn produces at most one document_versions row per
    // edited doc. `runToolCalls` fires once per tool-call batch; the model
    // may emit multiple batches in a single turn, so this map persists
    // across batches to let subsequent edit_document calls overwrite the
    // turn's existing version instead of creating a new one.
    const turnEditState: TurnEditState = new Map();
    // Akumulator citations zwracanych przez serwery MCP (np. SAOS).
    // Zbieramy z calej sesji czata - moze byc wiele batchy tool_call.
    // Deduplikacja po (server, tool, url|title) zeby kolejne wywolania
    // tego samego konektora nie spamowaly panelu.
    const mcpCitations: McpCitation[] = [];
    const mcpCitationKeys = new Set<string>();
    const appendMcpCitations = (cs: McpCitation[]) => {
        for (const c of cs) {
            const key = mcpCitationKey(c);
            if (mcpCitationKeys.has(key)) continue;
            mcpCitationKeys.add(key);
            mcpCitations.push(c);
        }
    };
    // ADR-0146: teksty tool_result z konektorow MCP (to, co model faktycznie widzial)
    // - zrodlo do groundingu cytatow MCP po zakonczeniu odpowiedzi. Zbierane per
    // wywolanie razem z kluczami kart, ktore z niego powstaly (nie tylko nowych -
    // duplikat karty z kolejnego wywolania nadal wskazuje na to samo zrodlo).
    const mcpSources: McpSourceText[] = [];
    let fullText = "";
    let iterText = "";
    let iterVisibleText = "";
    // ADR-0067 (B1): unwrapper pseudonimow dla odpowiedzi, ustawiany ponizej gdy
    // konwersacja idzie zamaskowana do chmury. null = brak maskowania (lokalny
    // model lub dane publiczne) -> przeplyw bez zmian.
    let unwrapper: PseudonimStreamUnwrapper | null = null;
    // Ta sama mapa, ale do odwracania ARGUMENTOW NARZEDZI (nie tylko strumienia
    // odpowiedzi). Maskowanie istnieje wylacznie na potrzeby egressu - dane
    // lokalne nigdy nie sa zamaskowane, wiec narzedzie musi dostac oryginal.
    // Bez tego generate_docx wpisywal do pisma "[ORG_1]" zamiast nazwy strony,
    // a search_corpus/find_in_document szukaly tokenu (zmierzone 2026-08-21).
    let pseudonimMap: PseudonimMap | null = null;
    let iterReasoning = "";
    let visibleTailBuffer = "";
    let citationsOpenSeen = false;

    const streamVisibleContent = (delta: string) => {
        if (!delta) return;
        if (citationsOpenSeen) return;

        const combined = visibleTailBuffer + delta;
        const markerIdx = combined.indexOf(CITATIONS_OPEN_TAG);
        if (markerIdx >= 0) {
            const visible = combined.slice(0, markerIdx);
            if (visible) {
                iterVisibleText += visible;
                write(
                    `data: ${JSON.stringify({ type: "content_delta", text: visible })}\n\n`,
                );
            }
            visibleTailBuffer = "";
            citationsOpenSeen = true;
            return;
        }

        const keep = Math.min(CITATIONS_OPEN_TAG.length - 1, combined.length);
        const visible = combined.slice(0, combined.length - keep);
        visibleTailBuffer = combined.slice(combined.length - keep);
        if (visible) {
            iterVisibleText += visible;
            write(
                `data: ${JSON.stringify({ type: "content_delta", text: visible })}\n\n`,
            );
        }
    };

    const flushVisibleTail = () => {
        if (citationsOpenSeen || !visibleTailBuffer) {
            visibleTailBuffer = "";
            return;
        }
        iterVisibleText += visibleTailBuffer;
        write(
            `data: ${JSON.stringify({ type: "content_delta", text: visibleTailBuffer })}\n\n`,
        );
        visibleTailBuffer = "";
    };

    const flushText = () => {
        // Domknij ewentualny wstrzymany ogon pseudonimu (rozciety token na
        // granicy tury/strumienia) zanim sfinalizujemy tekst.
        if (unwrapper) {
            const tail = unwrapper.flush();
            if (tail) {
                iterText += tail;
                streamVisibleContent(tail);
            }
        }
        if (!iterText) return;
        fullText += iterText;
        flushVisibleTail();
        if (iterVisibleText) {
            events.push({ type: "content", text: iterVisibleText });
        }
        iterText = "";
        iterVisibleText = "";
        visibleTailBuffer = "";
        citationsOpenSeen = false;
    };

    const selectedModel = resolveModel(model, DEFAULT_MAIN_MODEL);

    // US5 / ADR-0093: twardy cost-cap per sprawa PRZED guardEgress. Prog z env
    // PATRON_CASE_COST_CAP_USD (domyslnie off = brak zmiany). Po przekroczeniu
    // blok, chyba ze operator swiadomie nadpisze (allowBudgetOverride). Kazda
    // decyzja (block/override) -> audit_log cost_cap (hash-chain, AI Act art. 12).
    const capUsd = caseCostCapUsd();
    if (capUsd !== null && projectId) {
        let spentUsd = 0;
        try {
            spentUsd = await getCaseSpentUsd(db, projectId);
        } catch {
            spentUsd = 0; // brak odczytu kosztu nie moze twardo blokowac pracy
        }
        const budget = evaluateBudget({
            capUsd,
            spentUsd,
            override: allowBudgetOverride === true,
        });
        if (budget.exceeded) {
            await appendCostCapEvent(db, {
                actorUserId: userId,
                caseId: projectId,
                model: selectedModel,
                spentUsd,
                capUsd,
                action: budget.action === "override" ? "override" : "block",
            });
            if (budget.action === "block") {
                write(
                    `data: ${JSON.stringify({ type: "error", message: `Przekroczono limit kosztu sprawy (${spentUsd.toFixed(2)} / ${capUsd.toFixed(2)} USD). Operator moze kontynuowac swiadomie.`, code: "budget_exceeded" })}\n\n`,
                );
                write("data: [DONE]\n\n");
                return { fullText: "", events: [], mcpCitations: [], grounding: {}, mcpGrounding: null };
            }
        }
    }

    // ADR-0067: straznik data-residency PRZED wyjsciem do providera. Blokuje
    // wyslanie tresci sprawy do strefy egress niedozwolonej dla jej klasyfikacji
    // (tajemnica zawodowa -> tylko model lokalny). Decyzja idzie do audit_log.
    // Wspolny chokepoint egress (enforceEgress.ts) - ta sama funkcja co
    // /draft/refine. Przy blokadzie helper sam audytuje "llm_route" (block).
    const guard = await enforceEgressGuard({
        db,
        model: selectedModel,
        projectId,
        actorUserId: userId,
    });
    if (!guard.allowed) {
        const msg =
            guard.blockMessage ??
            "Routing zablokowany przez polityke data-residency.";
        write(
            `data: ${JSON.stringify({ type: "error", message: msg, code: "egress_blocked" })}\n\n`,
        );
        write("data: [DONE]\n\n");
        return { fullText: "", events: [], mcpCitations: [], grounding: {}, mcpGrounding: null };
    }

    // ADR-0067 (B1): maskuj PII PRZED wyjsciem do chmury (defense-in-depth nad
    // brama egress B2). Pomijamy model lokalny (no-egress - dane nie wychodza) i
    // dane publiczne. Wylacznik awaryjny: PATRON_PSEUDONIM_EGRESS=false.
    let outboundSystemPrompt = systemPrompt;
    let outboundMessages = chatMessages;
    const pseudonimEgressOn = process.env.PATRON_PSEUDONIM_EGRESS !== "false";
    if (
        pseudonimEgressOn &&
        guard.decision.egress !== "no-egress" &&
        guard.decision.classification !== "public"
    ) {
        // Audyt P1 #4: realny detektor PERSON/ORG/ADDRESS (deterministyczny,
        // zero-cloud) zamiast dotychczasowego no-op - nazwiska/nazwy podmiotow/
        // adresy NIE wychodza juz do chmury otwartym tekstem (domkniecie ADR-0067).
        const wrapped = await wrapConversation(systemPrompt, chatMessages, {
            llmDetector: plEntityDetector,
        });
        outboundSystemPrompt = wrapped.systemPrompt;
        outboundMessages = wrapped.messages;
        unwrapper = new PseudonimStreamUnwrapper(wrapped.map);
        pseudonimMap = wrapped.map;
    }

    const routeStartedAt = Date.now();
    const streamResult = await streamChatWithTools({
        model: selectedModel,
        systemPrompt: outboundSystemPrompt,
        messages: outboundMessages,
        tools: activeTools as OpenAIToolSchema[],
        maxIterations: 10,
        apiKeys,
        enableThinking: true,
        callbacks: {
            onContentDelta: (rawDelta) => {
                // ADR-0067 (B1): odwroc tokeny pseudonimow w strumieniu (hold-back
                // dla tokenow rozcietych na granicy chunkow). Bez maskowania
                // unwrapper jest null i delta przechodzi bez zmian.
                const delta = unwrapper ? unwrapper.push(rawDelta) : rawDelta;
                if (!delta) return;
                iterText += delta;
                streamVisibleContent(delta);
            },
            onReasoningDelta: (delta) => {
                iterReasoning += delta;
                write(
                    `data: ${JSON.stringify({ type: "reasoning_delta", text: delta })}\n\n`,
                );
            },
            onReasoningBlockEnd: () => {
                if (!iterReasoning) return;
                events.push({ type: "reasoning", text: iterReasoning });
                write(
                    `data: ${JSON.stringify({ type: "reasoning_block_end" })}\n\n`,
                );
                iterReasoning = "";
            },
            // Fires after Claude's turn ends with stop_reason=tool_use, before
            // the tool actually runs. Flushes any buffered assistant text so
            // it's emitted in chronological order, then signals the client so
            // it can open a fresh PreResponseWrapper (shows "Working…") while
            // the tool executes — avoids the dead gap between message_stop
            // and the first tool-specific event.
            onToolCallStart: (call) => {
                flushText();
                write(
                    `data: ${JSON.stringify({
                        type: "tool_call_start",
                        name: call.name,
                    })}\n\n`,
                );
            },
        },
        runTools: async (calls) => {
            // Emit any text the model produced before this tool turn so the
            // UI sees it before the tool results stream in.
            flushText();

            const toolCalls: ToolCall[] = calls.map((c) => ({
                id: c.id,
                function: {
                    name: c.name,
                    arguments: JSON.stringify(
                        pseudonimMap
                            ? odtworzTokeny(c.input, pseudonimMap)
                            : c.input,
                    ),
                },
            }));
            const {
                toolResults,
                docsRead,
                docsFound,
                docsCreated,
                docsReplicated,
                workflowsApplied,
                docsEdited,
                docsCommented,
            } = await runToolCalls(
                toolCalls,
                docStore,
                userId,
                db,
                write,
                workflowStore,
                tabularStore,
                docIndex,
                turnEditState,
                projectId,
            );
            for (const r of docsRead) {
                events.push({
                    type: "doc_read",
                    filename: r.filename,
                    document_id: r.document_id,
                });
            }
            for (const f of docsFound) {
                events.push({
                    type: "doc_find",
                    filename: f.filename,
                    query: f.query,
                    total_matches: f.total_matches,
                });
            }
            for (const dl of docsCreated) {
                events.push({
                    type: "doc_created",
                    filename: dl.filename,
                    download_url: dl.download_url,
                    document_id: dl.document_id,
                    version_id: dl.version_id,
                    version_number: dl.version_number ?? null,
                });
            }
            for (const r of docsReplicated) {
                events.push({
                    type: "doc_replicated",
                    filename: r.filename,
                    count: r.count,
                    copies: r.copies,
                });
            }
            for (const wf of workflowsApplied) {
                events.push({
                    type: "workflow_applied",
                    workflow_id: wf.workflow_id,
                    title: wf.title,
                });
            }
            for (const e of docsEdited) {
                events.push({
                    type: "doc_edited",
                    filename: e.filename,
                    document_id: e.document_id,
                    version_id: e.version_id,
                    version_number: e.version_number,
                    download_url: e.download_url,
                    annotations: e.annotations,
                });
            }
            for (const e of docsCommented) {
                events.push({
                    type: "doc_commented",
                    filename: e.filename,
                    document_id: e.document_id,
                    version_id: e.version_id,
                    version_number: e.version_number,
                    download_url: e.download_url,
                    annotations: e.annotations,
                });
            }

            // Index alignment would break if any tool branch skips its
            // push (unhandled tool name, disabled store, guard failure).
            // Each tool_result already carries its tool_call_id, so key off
            // that directly — and fall back to an error result for any
            // tool_use that didn't produce one, so Claude's next request
            // has a tool_result for every tool_use it sent.
            const resultByCallId = new Map<string, string>();
            for (const r of toolResults) {
                const row = r as { tool_call_id: string; content?: unknown };
                resultByCallId.set(row.tool_call_id, String(row.content ?? ""));
            }

            // Dispatch MCP tools for any calls not handled by built-in tools.
            await Promise.all(
                toolCalls
                    .filter(
                        (c) =>
                            !resultByCallId.has(c.id) &&
                            isMcpTool(c.function.name),
                    )
                    .map(async (c) => {
                        let args: Record<string, unknown> = {};
                        try {
                            args = JSON.parse(c.function.arguments || "{}");
                        } catch {
                            /* ignore */
                        }
                        const mcpResult = await runMcpTool(c.function.name, args);
                        resultByCallId.set(c.id, mcpResult.text);
                        if (mcpResult.citations.length > 0) {
                            appendMcpCitations(mcpResult.citations);
                        }
                        // ADR-0146: zrodlo do groundingu (bledy konektora pomijamy -
                        // komunikat bledu nie jest tekstem zrodla).
                        if (!mcpResult.isError) {
                            const sep = c.function.name.indexOf("__");
                            mcpSources.push({
                                server: sep > 0 ? c.function.name.slice(0, sep) : c.function.name,
                                tool: sep > 0 ? c.function.name.slice(sep + 2) : "",
                                text: mcpResult.text ?? "",
                                citationKeys: mcpResult.citations.map(mcpCitationKey),
                            });
                        }
                    }),
            );

            return toolCalls.map((c) => ({
                tool_use_id: c.id,
                content:
                    resultByCallId.get(c.id) ??
                    JSON.stringify({
                        error: `Tool '${c.function.name}' is not available.`,
                    }),
            }));
        },
    });

    flushText();

    // ADR-0067: per-call audit po zakonczeniu wywolania (decyzja allow) z realnym
    // kosztem (OpenRouter) i latencja. Dowod nalezytej starannosci AI Act art. 12.
    await appendLlmRouteEvent(db, {
        actorUserId: userId,
        caseId: projectId ?? null,
        model: selectedModel,
        provider: guard.provider,
        egress: guard.decision.egress,
        classification: guard.decision.classification,
        action: "allow",
        reason: guard.decision.reason,
        latencyMs: Date.now() - routeStartedAt,
        usage: streamResult.usage,
    });

    // Parse and emit citations from <CITATIONS> block
    const citations = buildCitations
        ? buildCitations(fullText)
        : parseCitations(fullText).map((c) => {
              const docInfo = resolveDoc(c.doc_id, docIndex);
              return {
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
    // ADR-0005: mechaniczna weryfikacja cytatow (citation grounding) przed
    // zwrotem - kazdy cytat z dokumentu klienta sprawdzany string-matchem
    // wzgledem tresci. Werdykt (verified/unverified/blocked) leci obok cytatow,
    // UI renderuje 3-stopniowy signal. Deterministyczne, offline, zero LLM.
    //
    // ADR-0097: opcjonalny etap semantyczny (paraphrase-judge) za flaga
    // PATRON_CITATION_JUDGE (default OFF - zero zmiany zachowania). makeJudge
    // routuje przez guardEgress (tajemnica -> tylko model lokalny; brak = null =
    // grounding pozostaje deterministyczny, fail-closed). Lapie cytat doslowny pod
    // falszywa teza (Stanford). decision (blokada) zostaje deterministyczna.
    const judgeRequested = process.env.PATRON_CITATION_JUDGE === "true";
    const judge = judgeRequested
        ? await makeJudge({ db, model: selectedModel, apiKeys, projectId })
        : null;
    // Sedzia ZADANY, ale niedostepny (makeJudge=null: fail-closed - tajemnica + model
    // chmurowy / brak modelu lokalnego). Wtedy tekstowo-ugruntowane tezy sa nieocenione
    // semantycznie -> oznacz je WYMAGA OSADU (ADR-0097). judge=off (swiadomy tryb) NIE flagujemy.
    const judgeUnavailable = judgeRequested && judge === null;
    const grounding = await groundCitationsByRef(citations, docStore, docIndex, db, {
        answerText: fullText,
        judge,
        judgeUnavailable,
        // ADR-0102 (A): tag proweniencji per cytat (default OFF). Deterministyczny,
        // enum bezpieczny do UI/audytu (jak verdict), zero egressu/PII.
        provenanceTags: process.env.PATRON_PROVENANCE_TAGS === "true",
    });
    // Do klienta wysylamy WYLACZNIE whitelistowane pola (decision + verdict enum +
    // provenance enum ADR-0102). judgeReason (ADR-0097, kandydat PII/tajemnica) zostaje
    // server-side - nie idzie po drucie (istotne w trybie serwerowym). grounding (pelny)
    // sluzy audytowi nizej.
    type GroundingClientEntry = {
        decision: string;
        verdict?: "green" | "yellow" | "red";
        provenance?: { tag: string; pinpoint: boolean };
        /** WYMAGA OSADU (ADR-0097): teza nieoceniona semantycznie. Boolean, zero PII. */
        requiresJudgment?: boolean;
    };
    const groundingForClient: Record<number, GroundingClientEntry> = {};
    for (const [ref, r] of Object.entries(grounding)) {
        const c = r as GroundingClientEntry;
        const entry: GroundingClientEntry = { decision: c.decision };
        if (c.verdict) entry.verdict = c.verdict;
        if (c.requiresJudgment) entry.requiresJudgment = true;
        if (c.provenance) {
            entry.provenance = {
                tag: c.provenance.tag,
                pinpoint: c.provenance.pinpoint,
            };
        }
        groundingForClient[Number(ref)] = entry;
    }
    write(
        `data: ${JSON.stringify({ type: "citations", citations, grounding: groundingForClient })}\n\n`,
    );
    // Cytaty z serwerow MCP (np. SAOS) - osobny event, zeby panel UI
    // mogl je renderowac jako "Powiazane zrodla" obok dokumentowych.
    if (mcpCitations.length > 0) {
        write(
            `data: ${JSON.stringify({ type: "mcp_citations", citations: mcpCitations })}\n\n`,
        );
    }
    // ADR-0146: grounding cytatow MCP - spany, ktore model prezentuje jako doslowne
    // cytaty (blockquote / cudzyslow), sprawdzane string-matchem wzgledem tekstow
    // tool_result z konektorow w tej turze. Werdykt per cytat + per karta; brak
    // tekstu zrodla = yellow "nie zweryfikowano", nigdy cicho. Deterministyczne,
    // offline, zero LLM. Odpalane TYLKO gdy w turze byly zrodla MCP - bez nich nie
    // ma z czym porownywac i event nie leci. Cytaty <CITATIONS> (juz ugruntowane
    // ADR-0005) i tresc wiadomosci uzytkownika sa wykluczone z oceny.
    let mcpGrounding: McpGroundingReport | null = null;
    if (mcpSources.length > 0 || mcpCitations.length > 0) {
        try {
            const excludeTexts: string[] = [];
            for (const c of citations) {
                const q = (c as { quote?: unknown }).quote;
                if (typeof q === "string" && q) excludeTexts.push(q);
            }
            for (const m of chatMessages) {
                if (m.role === "user" && typeof m.content === "string") {
                    excludeTexts.push(m.content);
                }
            }
            mcpGrounding = groundMcpCitations({
                answerText: fullText,
                sources: mcpSources,
                citations: mcpCitations,
                excludeTexts,
            });
            write(`data: ${JSON.stringify({ type: "mcp_grounding", ...mcpGrounding })}\n\n`);
        } catch (err) {
            // Grounding doradczy nie moze wywrocic odpowiedzi - ale brak werdyktu
            // tez nie moze byc cichy: UI dostaje jawny sygnal "nie zweryfikowano".
            console.warn("[stream] mcp grounding failed:", String(err).slice(0, 200));
            write(
                `data: ${JSON.stringify({ type: "mcp_grounding", error: "grounding_failed" })}\n\n`,
            );
        }
    }
    write("data: [DONE]\n\n");

    return { fullText, events, mcpCitations, grounding, mcpGrounding };
}

