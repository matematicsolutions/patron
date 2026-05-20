// MCP client layer - dynamic tool discovery from external MCP servers.
// Config is read from backend/mcp-servers.json at startup.
// If the file does not exist the module is a no-op: the rest of the app runs normally.
// A server that fails to connect is skipped with a warning; it never crashes the backend.

import fs from "fs";
import path from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { OpenAIToolSchema } from "../llm/types";
import type { McpCitation, McpToolResult } from "./types";

export type { McpCitation, McpToolResult } from "./types";

// ---------------------------------------------------------------------------
// Config types
// ---------------------------------------------------------------------------

interface McpServerConfig {
    name: string;
    transport: "stdio" | "http";
    // stdio
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    // http
    url?: string;
    // enabled flag - absent means enabled
    enabled?: boolean;
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

// tool name (prefixed) -> { client, original name }
const _toolRegistry = new Map<
    string,
    { client: Client; originalName: string }
>();
// cached list of OpenAIToolSchema[]
let _cachedTools: OpenAIToolSchema[] | null = null;

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

const CONFIG_PATH = path.resolve(__dirname, "../../../mcp-servers.json");

function loadConfig(): McpServerConfig[] {
    if (!fs.existsSync(CONFIG_PATH)) {
        return [];
    }
    try {
        const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
        const parsed = JSON.parse(raw) as McpServerConfig[];
        if (!Array.isArray(parsed)) {
            console.warn("[MCP] mcp-servers.json must be a JSON array - ignoring");
            return [];
        }
        return parsed.filter((s) => s.enabled !== false);
    } catch (err) {
        console.warn("[MCP] Failed to parse mcp-servers.json:", err);
        return [];
    }
}

// ---------------------------------------------------------------------------
// Build OpenAIToolSchema from MCP tool definition
// ---------------------------------------------------------------------------

function mcpToolToOpenAI(
    serverName: string,
    tool: { name: string; description?: string; inputSchema?: unknown },
): OpenAIToolSchema {
    const prefixedName = `${serverName}__${tool.name}`;
    return {
        type: "function",
        function: {
            name: prefixedName,
            description: tool.description ?? "",
            parameters:
                (tool.inputSchema as Record<string, unknown>) ?? {
                    type: "object",
                    properties: {},
                },
        },
    };
}

// ---------------------------------------------------------------------------
// Connect to a single server and register its tools
// ---------------------------------------------------------------------------

async function connectServer(cfg: McpServerConfig): Promise<void> {
    const client = new Client({ name: "polski-legal-ai", version: "1.0.0" });

    try {
        let transport;
        if (cfg.transport === "stdio") {
            if (!cfg.command) {
                console.warn(
                    `[MCP] Server "${cfg.name}" has transport "stdio" but no command - skipping`,
                );
                return;
            }
            transport = new StdioClientTransport({
                command: cfg.command,
                args: cfg.args ?? [],
                env: cfg.env,
            });
        } else if (cfg.transport === "http") {
            if (!cfg.url) {
                console.warn(
                    `[MCP] Server "${cfg.name}" has transport "http" but no url - skipping`,
                );
                return;
            }
            transport = new StreamableHTTPClientTransport(new URL(cfg.url));
        } else {
            console.warn(
                `[MCP] Server "${cfg.name}" has unknown transport "${(cfg as McpServerConfig).transport}" - skipping`,
            );
            return;
        }

        await client.connect(transport);

        const { tools } = await client.listTools();

        for (const tool of tools) {
            const prefixed = `${cfg.name}__${tool.name}`;
            _toolRegistry.set(prefixed, { client, originalName: tool.name });
        }

        console.log(
            `[MCP] Connected to "${cfg.name}" - ${tools.length} tool(s) registered`,
        );
    } catch (err) {
        console.warn(
            `[MCP] Could not connect to server "${cfg.name}" - skipping. Reason:`,
            err,
        );
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns the list of OpenAIToolSchema for all reachable MCP tools.
 * Results are cached after the first call.
 */
export async function getMcpTools(): Promise<OpenAIToolSchema[]> {
    if (_cachedTools !== null) {
        return _cachedTools;
    }

    const configs = loadConfig();

    if (configs.length === 0) {
        _cachedTools = [];
        return _cachedTools;
    }

    await Promise.all(configs.map(connectServer));

    const tools: OpenAIToolSchema[] = [];

    // Build the tools list by calling listTools() once more per server so we
    // can get the full schema (inputSchema). We deduplicate by server name
    // because _toolRegistry has one entry per tool, not per server.
    const serversSeen = new Set<string>();
    for (const [prefixed, { client }] of _toolRegistry) {
        const serverName = prefixed.split("__")[0];
        if (serversSeen.has(serverName)) continue;
        serversSeen.add(serverName);
        try {
            const { tools: serverTools } = await client.listTools();
            for (const t of serverTools) {
                tools.push(mcpToolToOpenAI(serverName, t));
            }
        } catch (err) {
            console.warn(
                `[MCP] Failed to list tools for server "${serverName}":`,
                err,
            );
        }
    }

    _cachedTools = tools;
    return _cachedTools;
}

/**
 * Returns true when the given tool name belongs to an MCP server
 * (i.e. was registered via getMcpTools).
 */
export function isMcpTool(name: string): boolean {
    return _toolRegistry.has(name);
}

/**
 * Wykonuje narzedzie MCP po jego prefiksowanej nazwie.
 *
 * Zwraca obiekt {text, citations}:
 * - text   - czlowiekoczytelne sklejenie blokow content[].text (wchodzi do tool_result dla LLM)
 * - citations - lista McpCitation wyluskana z structuredContent.citations (jesli serwer wystawia)
 *
 * Nigdy nie rzuca wyjatku - blad MCP zwracany jest jako text z polem error
 * i pusta lista citations.
 */
export async function runMcpTool(
    name: string,
    input: Record<string, unknown>,
): Promise<McpToolResult> {
    const entry = _toolRegistry.get(name);
    if (!entry) {
        return {
            text: JSON.stringify({ error: `MCP tool "${name}" is not registered.` }),
            citations: [],
            isError: true,
        };
    }

    const serverName = name.split("__")[0] ?? "";
    const toolName = entry.originalName;

    try {
        const result = await entry.client.callTool({
            name: toolName,
            arguments: input,
        });

        // 1. Sklej tekst z bloków content[].
        const content = result.content;
        let text: string;
        if (Array.isArray(content)) {
            const parts = content.map((block: unknown) => {
                const b = block as { type?: string; text?: string };
                if (b.type === "text" && typeof b.text === "string") {
                    return b.text;
                }
                return JSON.stringify(block);
            });
            text = parts.join("\n");
        } else {
            text = JSON.stringify(content);
        }

        // 2. Wyluskaj structured citations (opcjonalne).
        const citations = extractMcpCitations(
            (result as { structuredContent?: unknown }).structuredContent,
            serverName,
            toolName,
        );

        const isError =
            (result as { isError?: boolean }).isError === true || undefined;

        return { text, citations, isError };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
            text: JSON.stringify({ error: `MCP tool "${name}" failed: ${message}` }),
            citations: [],
            isError: true,
        };
    }
}

// ---------------------------------------------------------------------------
// Structured citations extraction
// ---------------------------------------------------------------------------

/**
 * Czyta `structuredContent.citations` i mapuje na liste McpCitation.
 * Akceptuje minimum: tablice obiektow z polem title LUB url. Wszystkie inne
 * pola sa opcjonalne; nieznane pola laduja w metadata (zeby nie tracic kontekstu).
 *
 * Funkcja eksportowana dla testow.
 */
export function extractMcpCitations(
    structuredContent: unknown,
    serverName: string,
    toolName: string,
): McpCitation[] {
    if (!structuredContent || typeof structuredContent !== "object") {
        return [];
    }
    const rawList = (structuredContent as { citations?: unknown }).citations;
    if (!Array.isArray(rawList)) {
        return [];
    }

    const out: McpCitation[] = [];
    for (const raw of rawList) {
        if (!raw || typeof raw !== "object") continue;
        const r = raw as Record<string, unknown>;
        const title = typeof r.title === "string" ? r.title : undefined;
        const url = typeof r.url === "string" ? r.url : undefined;
        const snippet = typeof r.snippet === "string" ? r.snippet : undefined;
        // Minimum sensownego cytatu: tytul LUB url.
        if (!title && !url) continue;

        // Wszystko poza znanymi polami zachowujemy w metadata.
        const knownKeys = new Set(["title", "url", "snippet", "metadata"]);
        const metadata: Record<string, unknown> = {};
        let hasMetadata = false;
        for (const [k, v] of Object.entries(r)) {
            if (knownKeys.has(k)) continue;
            metadata[k] = v;
            hasMetadata = true;
        }
        // Jesli serwer sam podal metadata - merge (jego klucze maja pierwszenstwo).
        if (r.metadata && typeof r.metadata === "object") {
            Object.assign(metadata, r.metadata as Record<string, unknown>);
            hasMetadata = true;
        }

        out.push({
            source: "mcp",
            server: serverName,
            tool: toolName,
            ...(title !== undefined && { title }),
            ...(url !== undefined && { url }),
            ...(snippet !== undefined && { snippet }),
            ...(hasMetadata && { metadata }),
        });
    }
    return out;
}
