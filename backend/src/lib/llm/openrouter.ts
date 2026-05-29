// Provider OpenRouter (ADR-0059) - jeden klucz, wiele modeli (Claude / GPT /
// Gemini / Bielik / Llama / Mistral / DeepSeek...). API jest OpenAI Chat
// Completions-compatible (NIE Responses API), wiec to osobny adapter, nie reuse
// openai.ts. Model id przychodzi z prefiksem "openrouter/"; tu uzywamy juz
// natywnego id OpenRoutera (prefiks zdjety w warstwie routingu).

import { openRouterModelId } from "./models";
import type {
  LlmMessage,
  NormalizedToolCall,
  OpenAIToolSchema,
  StreamChatParams,
  StreamChatResult,
} from "./types";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MAX_TOKENS = 8192;

type ChatMessage =
  | { role: "system" | "user" | "assistant"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls: {
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

function apiKey(override?: string | null): string {
  const key =
    override?.trim() || process.env.OPENROUTER_API_KEY?.trim() || "";
  if (!key) {
    throw new Error(
      "OpenRouter API key is not configured. Set OPENROUTER_API_KEY or pass a user key.",
    );
  }
  return key;
}

function headers(key: string): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
  // OpenRouter zaleca naglowki rankingowe (opcjonalne).
  if (process.env.OPENROUTER_SITE_URL)
    h["HTTP-Referer"] = process.env.OPENROUTER_SITE_URL;
  h["X-Title"] = process.env.OPENROUTER_APP_NAME || "PATRON";
  return h;
}

/** Pure: sklada messages Chat Completions (system na poczatku). Testowalne. */
export function buildMessages(
  systemPrompt: string | undefined,
  messages: LlmMessage[],
): ChatMessage[] {
  const out: ChatMessage[] = [];
  if (systemPrompt && systemPrompt.trim())
    out.push({ role: "system", content: systemPrompt });
  for (const m of messages)
    out.push({ role: m.role, content: m.content });
  return out;
}

/** Pure: body requestu Chat Completions. Testowalne bez sieci. */
export function buildChatBody(params: {
  model: string;
  messages: ChatMessage[];
  tools?: OpenAIToolSchema[];
  stream: boolean;
  maxTokens?: number;
}): Record<string, unknown> {
  return {
    model: openRouterModelId(params.model),
    messages: params.messages,
    tools: params.tools?.length ? params.tools : undefined,
    stream: params.stream,
    max_tokens: params.maxTokens ?? MAX_TOKENS,
    // ADR-0067: prosimy OpenRouter o realne zuzycie + koszt (usage.cost).
    // Streaming zwraca usage w ostatnim chunku przed [DONE]. Per-call audit
    // (lib/routing/auditLlmRoute.ts) zapisuje go jako koszt rzeczywisty.
    usage: { include: true },
  };
}

interface ToolCallAccum {
  id: string;
  name: string;
  arguments: string;
}

/** Pure: akumuluje fragmenty tool_calls (delty po index). Testowalne. */
export function accumulateToolCallDeltas(
  acc: Map<number, ToolCallAccum>,
  deltas: {
    index?: number;
    id?: string;
    function?: { name?: string; arguments?: string };
  }[],
): void {
  for (const d of deltas) {
    const idx = d.index ?? 0;
    const cur = acc.get(idx) ?? { id: "", name: "", arguments: "" };
    if (d.id) cur.id = d.id;
    if (d.function?.name) cur.name = d.function.name;
    if (d.function?.arguments) cur.arguments += d.function.arguments;
    acc.set(idx, cur);
  }
}

function toNormalizedToolCall(a: ToolCallAccum): NormalizedToolCall {
  let input: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(a.arguments || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      input = parsed as Record<string, unknown>;
  } catch {
    input = {};
  }
  return { id: a.id || a.name || "tool_call", name: a.name, input };
}

function splitSse(buffer: string): { events: unknown[]; rest: string } {
  const events: unknown[] = [];
  const chunks = buffer.split(/\n\n/);
  const rest = chunks.pop() ?? "";
  for (const chunk of chunks) {
    for (const line of chunk.split("\n")) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const data = t.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        events.push(JSON.parse(data));
      } catch {
        /* niepelny event - zostaje w buforze */
      }
    }
  }
  return { events, rest };
}

type StreamChoice = {
  delta?: {
    content?: string | null;
    reasoning?: string | null;
    tool_calls?: {
      index?: number;
      id?: string;
      function?: { name?: string; arguments?: string };
    }[];
  };
  finish_reason?: string | null;
};

export async function streamOpenRouter(
  params: StreamChatParams,
): Promise<StreamChatResult> {
  const { model, systemPrompt, tools = [], callbacks = {}, runTools } = params;
  const maxIter = params.maxIterations ?? 10;
  const key = apiKey(params.apiKeys?.openrouter);
  const messages = buildMessages(systemPrompt, params.messages);
  let fullText = "";
  // ADR-0067: realne zuzycie + koszt z ostatniego chunku usage (usage.include).
  let capturedUsage:
    | { prompt_tokens?: number; completion_tokens?: number; cost?: number }
    | undefined;

  for (let iter = 0; iter < maxIter; iter++) {
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: headers(key),
      body: JSON.stringify(
        buildChatBody({ model, messages, tools, stream: true }),
      ),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      const err = new Error(
        `OpenRouter request failed (${response.status}): ${text || response.statusText}`,
      );
      (err as { status?: number }).status = response.status;
      throw err;
    }
    if (!response.body) throw new Error("OpenRouter response had no body");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const toolAcc = new Map<number, ToolCallAccum>();
    let buffer = "";
    let iterText = "";
    let sawReasoning = false;
    let finish: string | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { events, rest } = splitSse(buffer);
      buffer = rest;
      for (const ev of events as {
        choices?: StreamChoice[];
        usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
      }[]) {
        // Chunk usage (ostatni przed [DONE]) ma puste choices - zlap zanim
        // odrzucimy event przez `if (!choice) continue`.
        if (ev.usage) capturedUsage = ev.usage;
        const choice = ev.choices?.[0];
        if (!choice) continue;
        if (typeof choice.delta?.reasoning === "string" && choice.delta.reasoning) {
          sawReasoning = true;
          callbacks.onReasoningDelta?.(choice.delta.reasoning);
        }
        if (typeof choice.delta?.content === "string" && choice.delta.content) {
          iterText += choice.delta.content;
          fullText += choice.delta.content;
          callbacks.onContentDelta?.(choice.delta.content);
        }
        if (choice.delta?.tool_calls?.length) {
          accumulateToolCallDeltas(toolAcc, choice.delta.tool_calls);
        }
        if (choice.finish_reason) finish = choice.finish_reason;
      }
    }
    if (sawReasoning) callbacks.onReasoningBlockEnd?.();

    const calls = [...toolAcc.values()].map(toNormalizedToolCall);
    if (finish !== "tool_calls" || calls.length === 0 || !runTools) {
      break;
    }

    for (const c of calls) callbacks.onToolCallStart?.(c);
    // Dopisz ture asystenta z tool_calls + wyniki narzedzi.
    messages.push({
      role: "assistant",
      content: iterText || null,
      tool_calls: calls.map((c) => ({
        id: c.id,
        type: "function",
        function: { name: c.name, arguments: JSON.stringify(c.input) },
      })),
    });
    const results = await runTools(calls);
    for (const r of results)
      messages.push({
        role: "tool",
        tool_call_id: r.tool_use_id,
        content: r.content,
      });
  }

  return {
    fullText,
    usage: capturedUsage
      ? {
          promptTokens: capturedUsage.prompt_tokens ?? null,
          completionTokens: capturedUsage.completion_tokens ?? null,
          costUsd: capturedUsage.cost ?? null,
        }
      : undefined,
  };
}

export async function completeOpenRouterText(params: {
  model: string;
  systemPrompt?: string;
  user: string;
  maxTokens?: number;
  apiKeys?: { openrouter?: string | null };
}): Promise<string> {
  const key = apiKey(params.apiKeys?.openrouter);
  const messages = buildMessages(params.systemPrompt, [
    { role: "user", content: params.user },
  ]);
  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: headers(key),
    body: JSON.stringify(
      buildChatBody({
        model: params.model,
        messages,
        stream: false,
        maxTokens: params.maxTokens ?? 512,
      }),
    ),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `OpenRouter request failed (${response.status}): ${text || response.statusText}`,
    );
  }
  const json = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return json.choices?.[0]?.message?.content ?? "";
}
