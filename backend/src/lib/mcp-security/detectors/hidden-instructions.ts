// Detektor hidden-instructions dla MCP Security Gateway.
//
// Skanuje description konektora i opisy narzedzi pod katem wzorcow
// kierowanych do LLM (jailbreak via tool description). Atak vector znany:
// LLM przy wyborze narzedzia czyta description, instrukcja w description
// moze zmienic zachowanie modelu zanim narzedzie zostanie wywolane.
//
// Pattern cherry-picked z Microsoft AGT (ADR-0024/0025).
// PL i EN. Wzorce ciezkie (jednoznaczne) -> critical -> denied.
// Wzorce slabsze (kontekstowe) -> high -> human_review.

import type { McpDetector, McpFinding, McpServerDefinition } from "../types";

interface Pattern {
    regex: RegExp;
    severity: "high" | "critical";
    label: string;
}

const PATTERNS: Pattern[] = [
    // EN ciezkie
    { regex: /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|rules?)/i, severity: "critical", label: "ignore-previous-EN" },
    { regex: /disregard\s+(all\s+)?(previous|prior|above)/i, severity: "critical", label: "disregard-previous-EN" },
    { regex: /<\/?system\b[^>]*>/i, severity: "critical", label: "system-tag" },
    { regex: /<\/?assistant\b[^>]*>/i, severity: "critical", label: "assistant-tag" },
    { regex: /\byou\s+are\s+now\s+(?:a|an|the)\s+/i, severity: "critical", label: "role-override-EN" },
    { regex: /\bnew\s+system\s+prompt\b/i, severity: "critical", label: "new-system-prompt-EN" },

    // PL ciezkie
    { regex: /\bzignoruj\s+(wszystkie\s+)?(poprzednie|powyzsze)\s+(instrukcje|reguly|polecenia)/i, severity: "critical", label: "ignore-previous-PL" },
    { regex: /\b(jestes|bedziesz)\s+(teraz\s+)?(asystentem|botem|systemem)\b/i, severity: "critical", label: "role-override-PL" },
    { regex: /\bnowy\s+(system\s+)?prompt\b/i, severity: "critical", label: "new-system-prompt-PL" },
    { regex: /\bod\s+teraz\s+(jestes|odpowiadasz|dzialasz)/i, severity: "critical", label: "from-now-PL" },

    // EN slabsze
    { regex: /\byou\s+must\s+(always|never)\b/i, severity: "high", label: "must-always-EN" },
    { regex: /\bact\s+as\s+(?:a|an|the)\s+/i, severity: "high", label: "act-as-EN" },
    { regex: /\bpretend\s+(?:to\s+be|that)\b/i, severity: "high", label: "pretend-EN" },

    // PL slabsze
    { regex: /\budawaj\s+(ze|jakbys|zwykle)\b/i, severity: "high", label: "pretend-PL" },
    { regex: /\bmusisz\s+(zawsze|nigdy)\b/i, severity: "high", label: "must-always-PL" },
];

function clip(text: string): string {
    return text.length > 200 ? `${text.slice(0, 197)}...` : text;
}

function scanText(
    text: string,
    serverName: string,
    toolName?: string,
): McpFinding[] {
    const findings: McpFinding[] = [];
    for (const pattern of PATTERNS) {
        const match = text.match(pattern.regex);
        if (match) {
            findings.push({
                detector: "hidden-instructions",
                category: "hidden_instructions",
                severity: pattern.severity,
                serverName,
                toolName,
                message: `Wzorzec '${pattern.label}' w opisie - mozliwa proba manipulacji LLM przez tresc tool description.`,
                sample: clip(match[0]),
            });
        }
    }
    return findings;
}

export const hiddenInstructionsDetector: McpDetector = {
    name: "hidden-instructions",
    run(server: McpServerDefinition): McpFinding[] {
        const findings: McpFinding[] = [];
        for (const tool of server.tools) {
            findings.push(...scanText(tool.description, server.name, tool.name));
        }
        return findings;
    },
};
