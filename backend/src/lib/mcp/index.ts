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
 * Executes an MCP tool by its prefixed name.
 * Always resolves with a string - never throws into the caller.
 */
export async function runMcpTool(
    name: string,
    input: Record<string, unknown>,
): Promise<string> {
    const entry = _toolRegistry.get(name);
    if (!entry) {
        return JSON.stringify({ error: `MCP tool "${name}" is not registered.` });
    }
    try {
        const result = await entry.client.callTool({
            name: entry.originalName,
            arguments: input,
        });
        // result.content is an array of ContentBlock
        const content = result.content;
        if (Array.isArray(content)) {
            const parts = content.map((block: unknown) => {
                const b = block as { type?: string; text?: string };
                if (b.type === "text" && typeof b.text === "string") {
                    return b.text;
                }
                return JSON.stringify(block);
            });
            return parts.join("\n");
        }
        return JSON.stringify(content);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return JSON.stringify({ error: `MCP tool "${name}" failed: ${message}` });
    }
}
