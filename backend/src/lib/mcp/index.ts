// MCP client layer - dynamic tool discovery from external MCP servers.
// Config is read from backend/mcp-servers.json at startup.
// If the file does not exist the module is a no-op: the rest of the app runs normally.
// A server that fails to connect is skipped with a warning; it never crashes the backend.
//
// ADR-0028: kazda definicja konektora przechodzi przez MCP Security Gateway
// (lib/mcp-security/) PRZED registracja toolow. Decyzja human_review / denied
// blokuje konektor + logowana strukturyzowanie. Lokalny baseline file dla
// drift detection w ~/.patron/mcp-drift-baseline.json (env PATRON_MCP_BASELINE_PATH).

import fs from "fs";
import os from "os";
import path from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { OpenAIToolSchema } from "../llm/types";
import {
    buildScanContext,
    scanMcpRegistry,
    type McpServerDefinition,
    type McpToolDefinition,
} from "../mcp-security";
import { recordMcpSecurityEvent } from "./audit-bridge";
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
// Connect to a single server (no registration yet - ADR-0028 2-fazowy)
// ---------------------------------------------------------------------------

interface DiscoveredServer {
    cfg: McpServerConfig;
    client: Client;
    tools: ReadonlyArray<{ name: string; description?: string; inputSchema?: unknown }>;
    ok: boolean;
}

async function connectAndDiscover(cfg: McpServerConfig): Promise<DiscoveredServer> {
    const client = new Client({ name: "polski-legal-ai", version: "1.0.0" });

    try {
        let transport;
        if (cfg.transport === "stdio") {
            if (!cfg.command) {
                console.warn(
                    `[MCP] Server "${cfg.name}" has transport "stdio" but no command - skipping`,
                );
                return { cfg, client, tools: [], ok: false };
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
                return { cfg, client, tools: [], ok: false };
            }
            transport = new StreamableHTTPClientTransport(new URL(cfg.url));
        } else {
            console.warn(
                `[MCP] Server "${cfg.name}" has unknown transport "${(cfg as McpServerConfig).transport}" - skipping`,
            );
            return { cfg, client, tools: [], ok: false };
        }

        await client.connect(transport);
        const { tools } = await client.listTools();
        return { cfg, client, tools, ok: true };
    } catch (err) {
        console.warn(
            `[MCP] Could not connect to server "${cfg.name}" - skipping. Reason:`,
            err,
        );
        return { cfg, client, tools: [], ok: false };
    }
}

function registerTools(
    client: Client,
    serverName: string,
    tools: ReadonlyArray<{ name: string }>,
): void {
    for (const tool of tools) {
        const prefixed = `${serverName}__${tool.name}`;
        _toolRegistry.set(prefixed, { client, originalName: tool.name });
    }
    console.log(
        `[MCP] Connected to "${serverName}" - ${tools.length} tool(s) registered`,
    );
}

// ---------------------------------------------------------------------------
// MCP Security Gateway baseline (ADR-0028) - lokalny plik per uzytkownik
// ---------------------------------------------------------------------------

function baselinePath(): string {
    const override = process.env.PATRON_MCP_BASELINE_PATH;
    if (override && override.length > 0) return override;
    return path.join(os.homedir(), ".patron", "mcp-drift-baseline.json");
}

export function loadBaseline(): Map<string, string> {
    const p = baselinePath();
    if (!fs.existsSync(p)) return new Map();
    try {
        const raw = fs.readFileSync(p, "utf-8");
        const parsed = JSON.parse(raw) as Record<string, string>;
        if (!parsed || typeof parsed !== "object") return new Map();
        return new Map(Object.entries(parsed));
    } catch (err) {
        console.warn(`[MCP-SECURITY] Failed to read baseline at ${p}, treating as empty:`, err);
        return new Map();
    }
}

export function saveBaseline(baseline: ReadonlyMap<string, string>): void {
    const p = baselinePath();
    try {
        fs.mkdirSync(path.dirname(p), { recursive: true });
        const obj = Object.fromEntries(baseline.entries());
        const tmp = `${p}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), "utf-8");
        fs.renameSync(tmp, p);
    } catch (err) {
        console.warn(`[MCP-SECURITY] Failed to write baseline at ${p}:`, err);
    }
}

function toMcpServerDefinition(d: DiscoveredServer): McpServerDefinition {
    const toolDefs: McpToolDefinition[] = d.tools.map((t) => ({
        name: t.name,
        description: t.description ?? "",
        inputSchema:
            t.inputSchema && typeof t.inputSchema === "object"
                ? (t.inputSchema as Record<string, unknown>)
                : undefined,
    }));
    return {
        name: d.cfg.name,
        transport: d.cfg.transport,
        command: d.cfg.command,
        args: d.cfg.args,
        url: d.cfg.url,
        tools: toolDefs,
    };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns the list of OpenAIToolSchema for all reachable MCP tools.
 * Results are cached after the first call.
 *
 * ADR-0028: kazda definicja konektora przechodzi przez MCP Security Gateway
 * (4 detektory: typosquat / drift / hidden-instructions / tool-poisoning)
 * PRZED registracja toolow. Decyzje:
 * - allowed: tools rejestrowane, baseline zaktualizowany
 * - audit: tools rejestrowane, findings logowane (informational)
 * - human_review / denied: tools NIE rejestrowane, warning, client zamykany
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

    // Faza 1: collect (connect + listTools, bez registracji w _toolRegistry)
    const discovered = await Promise.all(configs.map(connectAndDiscover));
    const ok = discovered.filter((d) => d.ok);

    if (ok.length === 0) {
        _cachedTools = [];
        return _cachedTools;
    }

    // Faza 2: scan przez MCP Security Gateway
    const definitions = ok.map(toMcpServerDefinition);
    const baseline = loadBaseline();
    const context = buildScanContext(baseline);
    const report = scanMcpRegistry(definitions, context);

    // Faza 3: register / skip per server
    const newBaseline = new Map(baseline);
    const tools: OpenAIToolSchema[] = [];

    for (const d of ok) {
        const result = report.perServer.find((r) => r.serverName === d.cfg.name);
        if (!result) continue;

        if (result.action === "allowed" || result.action === "audit") {
            registerTools(d.client, d.cfg.name, d.tools);
            newBaseline.set(d.cfg.name, result.currentHash);
            if (result.action === "audit" || result.findings.length > 0) {
                console.warn(
                    `[MCP-SECURITY] Server "${d.cfg.name}" action=${result.action} riskScore=${result.riskScore} findings=${result.findings.length}`,
                );
                for (const f of result.findings) {
                    console.warn(
                        `[MCP-SECURITY]   - ${f.detector}/${f.severity}: ${f.message}`,
                    );
                }
                // ADR-0033: propagacja decyzji Gateway do audit hash-chain.
                // Fire-and-forget - porazka audit nie blokuje registracji toolow.
                void recordMcpSecurityEvent({
                    serverName: d.cfg.name,
                    action: result.action,
                    riskScore: result.riskScore,
                    findings: result.findings,
                }).catch((err) => {
                    console.warn(
                        `[MCP-SECURITY] audit bridge failed for "${d.cfg.name}":`,
                        err,
                    );
                });
            }
            for (const t of d.tools) {
                tools.push(mcpToolToOpenAI(d.cfg.name, t));
            }
        } else {
            console.warn(
                `[MCP-SECURITY] Server "${d.cfg.name}" BLOCKED action=${result.action} riskScore=${result.riskScore} findings=${result.findings.length}. Tools NOT registered.`,
            );
            for (const f of result.findings) {
                console.warn(
                    `[MCP-SECURITY]   - ${f.detector}/${f.severity}: ${f.message}`,
                );
            }
            // ADR-0033: propagacja decyzji Gateway do audit hash-chain.
            // Fire-and-forget - porazka audit nie wstrzymuje obslugi blokady konektora.
            void recordMcpSecurityEvent({
                serverName: d.cfg.name,
                action: result.action,
                riskScore: result.riskScore,
                findings: result.findings,
            }).catch((err) => {
                console.warn(
                    `[MCP-SECURITY] audit bridge failed for "${d.cfg.name}":`,
                    err,
                );
            });
            await d.client.close().catch(() => {
                // ignore close errors - we already decided to drop the client
            });
        }
    }

    saveBaseline(newBaseline);

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
