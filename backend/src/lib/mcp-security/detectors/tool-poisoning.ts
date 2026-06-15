// Detektor tool-poisoning dla MCP Security Gateway.
//
// Wykrywa narzedzia, ktorych description zaden o uprawnienia/zasoby spoza
// zadeklarowanego inputSchema lub modyfikuje zachowanie systemu. Pattern
// cherry-picked z Microsoft AGT (ADR-0024/0025).
//
// Dwa rodzaje sygnalow:
//   1. Permission expansion - opis prosi o sciezki/zasoby spoza schemy
//      ("additionally requires", "also reads", "writes to")
//   2. Schema mismatch - opis wspomina o polu ktorego nie ma w inputSchema
//      (np. opis mowi "send token", ale schema nie ma `token`)

import type { McpDetector, McpFinding, McpServerDefinition, McpToolDefinition } from "../types";

const PERMISSION_PATTERNS: ReadonlyArray<{ regex: RegExp; label: string }> = [
    // EN
    { regex: /\badditionally\s+(requires|reads|accesses|writes)/i, label: "additionally-requires-EN" },
    { regex: /\balso\s+(reads|writes|sends|uploads|deletes)/i, label: "also-action-EN" },
    { regex: /\b(send|upload|post)s?\s+to\s+(https?:\/\/|\w+@)/i, label: "send-to-external-EN" },
    { regex: /\bwrites?\s+to\s+(\/etc|\/var|\/root|C:\\Windows|\/System)/i, label: "writes-system-path-EN" },
    { regex: /\b(deletes?|removes?)\s+(files?|directories|tables?)/i, label: "delete-action-EN" },

    // PL
    { regex: /\bdodatkowo\s+(wymaga|czyta|wysyla|zapisuje)/i, label: "additionally-PL" },
    { regex: /\browniez\s+(czyta|wysyla|zapisuje|usuwa)/i, label: "also-action-PL" },
    { regex: /\bwysyla\s+do\s+(https?:\/\/|\w+@)/i, label: "send-to-external-PL" },
    { regex: /\b(usuwa|kasuje)\s+(pliki|katalogi|tabele)/i, label: "delete-action-PL" },
];

function clip(text: string): string {
    return text.length > 200 ? `${text.slice(0, 197)}...` : text;
}

function detectPermissionExpansion(
    tool: McpToolDefinition,
    serverName: string,
): McpFinding[] {
    const findings: McpFinding[] = [];
    for (const pattern of PERMISSION_PATTERNS) {
        const match = tool.description.match(pattern.regex);
        if (match) {
            findings.push({
                detector: "tool-poisoning",
                category: "tool_poisoning",
                severity: "high",
                serverName,
                toolName: tool.name,
                message: `Opis narzedzia '${tool.name}' zaden o uprawnienia spoza inputSchema (wzorzec '${pattern.label}'). Mozliwy tool poisoning.`,
                sample: clip(match[0]),
            });
        }
    }
    return findings;
}

function extractSchemaProperties(schema?: Record<string, unknown>): Set<string> {
    if (!schema || typeof schema !== "object") return new Set();
    const props = (schema as { properties?: Record<string, unknown> }).properties;
    if (!props || typeof props !== "object") return new Set();
    return new Set(Object.keys(props));
}

// Wykrywa, czy description wymienia "polecone pola wejscia" sloty, ktore nie
// istnieja w inputSchema. Heurystyka: szuka wzorca `parameter X`, `pole X`,
// `argument X`, `input X` - bardzo ostroznie, zeby uniknac false positive.
const FIELD_MENTION_REGEX = /\b(?:parameter|argument|input|field|pole|argument|parametr)\s+`?([a-zA-Z_][a-zA-Z0-9_]{1,40})`?/gi;

function detectSchemaMismatch(
    tool: McpToolDefinition,
    serverName: string,
): McpFinding[] {
    const schemaProps = extractSchemaProperties(tool.inputSchema);
    if (schemaProps.size === 0) return []; // brak schemy = pomijamy (input-free tool)

    const mentioned = new Set<string>();
    let m: RegExpExecArray | null;
    const re = new RegExp(FIELD_MENTION_REGEX.source, FIELD_MENTION_REGEX.flags);
    while ((m = re.exec(tool.description)) !== null) {
        mentioned.add(m[1]);
    }

    const orphans = [...mentioned].filter((name) => !schemaProps.has(name));
    if (orphans.length === 0) return [];

    return [{
        detector: "tool-poisoning",
        category: "tool_poisoning",
        severity: "medium",
        serverName,
        toolName: tool.name,
        message: `Opis narzedzia '${tool.name}' wspomina o polach spoza inputSchema: ${orphans.join(", ")}. Mozliwa niezgodnosc kontraktu.`,
        sample: `orphans=${orphans.join(",")}`,
    }];
}

export const toolPoisoningDetector: McpDetector = {
    name: "tool-poisoning",
    run(server: McpServerDefinition): McpFinding[] {
        const findings: McpFinding[] = [];
        for (const tool of server.tools) {
            findings.push(...detectPermissionExpansion(tool, server.name));
            findings.push(...detectSchemaMismatch(tool, server.name));
        }
        return findings;
    },
};
