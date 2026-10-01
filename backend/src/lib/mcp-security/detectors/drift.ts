// Detektor drift dla MCP Security Gateway.
//
// Liczy hash definicji konektora, porownuje z baseline w kontekscie. Pierwszy
// load = baseline (informational, zero impact). Roznica od baseline = finding
// high (human_review), bo definicja narzedzia moze wplywac na zachowanie LLM
// (jailbreak via description swap) albo na to, co model do narzedzia wysyla
// (dopisany parametr wejscia, np. `token`).
//
// Pattern cherry-picked z Microsoft AGT (ADR-0024/0025). Baseline trzymany
// poza tym modulem - wywolujacy (pipeline) ladowal/zapisuje
// ~/.patron/mcp-drift-baseline.json (wpiecie w startup = ADR-0028).
//
// ADR-0159: wpisy baseline sa wersjonowane.
//   - v1 (goly 64-hex, zapisywany do ADR-0159): SHA256 z nazwy serwera + nazw
//     i opisow narzedzi. NIE widzial `inputSchema`.
//   - v2 (`v2:<64-hex>`): canonicalSha256 (ADR-0142) z nazwy serwera i pelnych
//     definicji narzedzi (nazwa, opis, inputSchema), narzedzia sortowane po
//     nazwie. Ta sama formula co hash zatwierdzenia Operatora (ADR-0158).
// Wpis v1 migruje sie JEDNORAZOWO: gdy stary hash sie zgadza (nazwy i opisy bez
// zmian), baseline przechodzi na v2 z findingiem low (trafia do audytu, ADR-0033).
// Gdy stary hash sie NIE zgadza - to jest prawdziwy dryf, high, jak dotad.
// Wpis w nieznanym formacie = fail-closed (high).

import { createHash } from "node:crypto";
import { canonicalSha256 } from "../../audit-pack";
import type { McpDetector, McpFinding, McpScanContext, McpServerDefinition } from "../types";

/** Wersja formuly hasha zapisywana w nowych wpisach baseline. */
export const DRIFT_BASELINE_VERSION = "v2";

const HEX64 = /^[0-9a-f]{64}$/;

/**
 * Hash definicji konektora (formula v2): nazwa serwera + dla kazdego narzedzia
 * nazwa, opis i schemat wejscia. Kolejnosc narzedzi nie ma znaczenia. Adres i
 * komenda konektora do hasha nie wchodza (URL moze niesc klucz dostepu).
 * 64 znaki hex, bez prefiksu wersji.
 */
export function computeDefinitionHash(server: McpServerDefinition): string {
    const tools = [...server.tools]
        .map((t) => ({
            name: t.name,
            description: t.description ?? "",
            inputSchema: t.inputSchema ?? null,
        }))
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return canonicalSha256({ server: server.name, tools });
}

/**
 * Formula v1 (sprzed ADR-0159) - WYLACZNIE do migracji starych wpisow baseline.
 * Musi dawac bit w bit ten sam wynik co dawniej (separator = bajt NUL), inaczej
 * migracja zamieni kazdy stary wpis w falszywy dryf.
 */
export function computeLegacyDefinitionHash(server: McpServerDefinition): string {
    const hash = createHash("sha256");
    hash.update(server.name);
    hash.update("\0");
    for (const tool of server.tools) {
        hash.update(tool.name);
        hash.update("\0");
        hash.update(tool.description);
        hash.update("\0");
    }
    return hash.digest("hex");
}

/** Wpis baseline dla biezacej formuly: `v2:<64-hex>`. */
export function formatBaselineEntry(hash: string): string {
    return `${DRIFT_BASELINE_VERSION}:${hash}`;
}

export type ParsedBaselineEntry =
    | { version: "v1"; hash: string }
    | { version: "v2"; hash: string }
    | { version: "unknown" };

export function parseBaselineEntry(entry: string): ParsedBaselineEntry {
    if (HEX64.test(entry)) return { version: "v1", hash: entry };
    const prefix = `${DRIFT_BASELINE_VERSION}:`;
    if (entry.startsWith(prefix) && HEX64.test(entry.slice(prefix.length))) {
        return { version: "v2", hash: entry.slice(prefix.length) };
    }
    return { version: "unknown" };
}

function driftHigh(server: McpServerDefinition, message: string, sample: string): McpFinding {
    return {
        detector: "drift",
        category: "drift",
        severity: "high",
        serverName: server.name,
        message,
        sample,
    };
}

export const driftDetector: McpDetector = {
    name: "drift",
    run(server: McpServerDefinition, context: McpScanContext): McpFinding[] {
        const current = computeDefinitionHash(server);
        const baseline = context.driftBaseline.get(server.name);

        // ADR-0162: konektor wozony przez instalator ma oczekiwany hash definicji
        // z manifestu wydania. Zgodny = definicja z naszego buildu, wiec zmiana
        // wzgledem baseline (np. po aktualizacji) nie wymaga decyzji Operatora.
        // Niezgodny = ktos zmienil pliki konektora po instalacji - high, bez
        // wzgledu na baseline.
        const shipped = context.bundledDefinitions?.get(server.name);
        if (shipped !== undefined) {
            if (shipped !== current) {
                return [driftHigh(
                    server,
                    `Definicja konektora '${server.name}' nie zgadza sie z manifestem instalatora (ADR-0162) - pliki konektora mogly zostac zmienione po instalacji. Wymaga decyzji Operatora.`,
                    `manifest=${shipped.slice(0, 12)}... curr=${current.slice(0, 12)}...`,
                )];
            }
            const prev = baseline === undefined ? undefined : parseBaselineEntry(baseline);
            if (prev?.version === "v2" && prev.hash === current) return [];
            return [{
                detector: "drift",
                category: "drift",
                severity: "low",
                serverName: server.name,
                message: `Definicja konektora '${server.name}' zgodna z manifestem instalatora (ADR-0162) - baseline ustawiony na definicje z biezacego wydania (informational).`,
                sample: `hash=${current.slice(0, 16)}...`,
            }];
        }

        if (baseline === undefined) {
            return [{
                detector: "drift",
                category: "drift",
                severity: "low",
                serverName: server.name,
                message: `Pierwszy load konektora '${server.name}' - hash baseline zostal ustalony (informational).`,
                sample: `hash=${current.slice(0, 16)}...`,
            }];
        }

        const parsed = parseBaselineEntry(baseline);

        if (parsed.version === "v2") {
            if (parsed.hash === current) return [];
            return [driftHigh(
                server,
                `Definicja konektora '${server.name}' zmienila sie od ostatniego ladowania (baseline drift: nazwy, opisy lub schematy wejscia narzedzi). Wymaga decyzji Operatora czy zmiana jest oczekiwana.`,
                `prev=${parsed.hash.slice(0, 12)}... curr=${current.slice(0, 12)}...`,
            )];
        }

        if (parsed.version === "v1") {
            const legacy = computeLegacyDefinitionHash(server);
            if (parsed.hash !== legacy) {
                // Prawdziwy dryf nazw/opisow - migracja formuly go NIE polyka.
                return [driftHigh(
                    server,
                    `Definicja konektora '${server.name}' zmienila sie od ostatniego ladowania (baseline drift). Wymaga decyzji Operatora czy zmiana jest oczekiwana.`,
                    `prev=${parsed.hash.slice(0, 12)}... curr(v1)=${legacy.slice(0, 12)}...`,
                )];
            }
            return [{
                detector: "drift",
                category: "drift",
                severity: "low",
                serverName: server.name,
                message: `Migracja baseline v1->v2 konektora '${server.name}' (ADR-0159): nazwy i opisy narzedzi bez zmian od ostatniego ladowania; schematy wejscia wchodza do baseline od teraz - wczesniejszej wersji schematow nie bylo z czym porownac (jednorazowo, informational).`,
                sample: `v1=${parsed.hash.slice(0, 12)}... v2=${current.slice(0, 12)}...`,
            }];
        }

        return [driftHigh(
            server,
            `Wpis baseline konektora '${server.name}' ma nieznany format - nie da sie potwierdzic, ze definicja sie nie zmienila (fail-closed). Wymaga decyzji Operatora.`,
            `baseline=${baseline.slice(0, 16)}`,
        )];
    },
};
