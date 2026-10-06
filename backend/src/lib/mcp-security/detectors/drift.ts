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
//
// Pochodzenie konektora (B-06 / R-MCP-01). Hash definicji swiadomie NIE obejmuje
// komendy ani adresu (ADR-0159), wiec obcy proces nazwany "saos" ze skopiowanymi
// narzedziami mial ten sam hash co oryginal. Obok hasha definicji baseline trzyma
// wiec ODCISK POCHODZENIA (computeOriginFingerprint): stdio = komenda + args,
// http = sam schemat i host adresu (bez sciezki, zapytania i danych logowania -
// tam bywa klucz). Format wpisu: `v2:<def>|o:<origin>`. Zasady:
//   - wpis `v2:<def>` bez odcisku (sprzed tej zmiany) = jednorazowe ustalenie
//     odcisku, informational (low) - jak migracja v1->v2;
//   - odcisk inny niz w baseline = drift high (human_review). Operator zatwierdza
//     to przez ADR-0158, a zatwierdzenie musi wtedy wskazac tez nowy odcisk;
//   - konektor z pliku instalatora zgodny z manifestem (ADR-0162): odcisk NIE jest
//     porownywany, tylko ustalany na nowo. Odcisk liczymy z konfiguracji tak, jak
//     ja zapisano (sciezki instalatora sa wzgledne wobec katalogu zasobow), ale
//     aktualizacja moze tez zmienic uklad plikow albo runtime konektora (np.
//     ADR-0136). Plik instalatora i manifest pochodza z tego samego buildu i leza w
//     tym samym katalogu; kto moze zmienic jeden, moze zmienic drugi (i dist/
//     konektora). Odcisk nic tu wiec nie dodaje, a blokowalby kazda aktualizacje.
//     Manifest dziala tylko dla konektora oznaczonego jako pochodzacy z pliku
//     instalatora (`configSource: "installer"`); nakladka Operatora go nie dostaje.

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

/**
 * Odcisk pochodzenia konektora (B-06 / R-MCP-01): skad Patron uruchamia albo
 * dokad sie laczy. Bez sekretow:
 *   - stdio: komenda i args w postaci z konfiguracji (env NIE wchodzi - tam sa klucze);
 *   - http: wylacznie schemat + host (z portem) adresu. Sciezka, zapytanie i dane
 *     logowania w URL odpadaja, bo bywa w nich klucz dostepu.
 * Do baseline trafia sam hash, nie wartosci. 64 znaki hex.
 */
export function computeOriginFingerprint(server: McpServerDefinition): string {
    if (server.transport === "http") {
        let host: string | null = null;
        if (typeof server.url === "string") {
            try {
                const u = new URL(server.url);
                host = `${u.protocol}//${u.host}`;
            } catch {
                // Niepoprawny URL: nie hashujemy surowego napisu (moze niesc klucz).
                host = "<niepoprawny-url>";
            }
        }
        return canonicalSha256({ transport: "http", host });
    }
    return canonicalSha256({
        transport: server.transport,
        command: server.command ?? null,
        args: Array.isArray(server.args) ? server.args : [],
    });
}

/**
 * Wpis baseline dla biezacej formuly: `v2:<def>` albo, z odciskiem pochodzenia,
 * `v2:<def>|o:<origin>` (B-06 / R-MCP-01).
 */
export function formatBaselineEntry(hash: string, origin?: string): string {
    const base = `${DRIFT_BASELINE_VERSION}:${hash}`;
    return origin === undefined ? base : `${base}|o:${origin}`;
}

export type ParsedBaselineEntry =
    | { version: "v1"; hash: string }
    | { version: "v2"; hash: string; origin?: string }
    | { version: "unknown" };

/** Czy finding to dryf POCHODZENIA (a nie definicji) - dla zatwierdzenia ADR-0158. */
export function isOriginDriftFinding(f: McpFinding): boolean {
    return f.detector === "drift" && f.subject === "origin" && f.severity !== "low";
}

export function parseBaselineEntry(entry: unknown): ParsedBaselineEntry {
    // Baseline to plik na dysku - wartosc nie-napis (np. null po recznej edycji)
    // rzucala TypeError w getMcpTools i wywracala kazda ture czatu. Nieznany
    // format = drift/high na tym jednym konektorze (ADR-0159 pkt 4; R-MCP-02).
    if (typeof entry !== "string") return { version: "unknown" };
    if (HEX64.test(entry)) return { version: "v1", hash: entry };
    const prefix = `${DRIFT_BASELINE_VERSION}:`;
    if (entry.startsWith(prefix)) {
        const [def, origin, ...reszta] = entry.slice(prefix.length).split("|o:");
        if (reszta.length === 0 && def !== undefined && HEX64.test(def)) {
            if (origin === undefined) return { version: "v2", hash: def };
            if (HEX64.test(origin)) return { version: "v2", hash: def, origin };
        }
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

function originHigh(server: McpServerDefinition, prev: string, curr: string): McpFinding {
    return {
        detector: "drift",
        category: "drift",
        severity: "high",
        subject: "origin",
        serverName: server.name,
        message: `Pochodzenie konektora '${server.name}' zmienilo sie od ostatniego ladowania (inna komenda/argumenty albo inny host) - pod ta sama nazwa moze dzialac inny proces lub serwer. Wymaga decyzji Operatora.`,
        sample: `origin prev=${prev.slice(0, 12)}... curr=${curr.slice(0, 12)}...`,
    };
}

function originEstablished(server: McpServerDefinition, origin: string): McpFinding {
    return {
        detector: "drift",
        category: "drift",
        severity: "low",
        subject: "origin",
        serverName: server.name,
        message: `Odcisk pochodzenia konektora '${server.name}' ustalony po raz pierwszy (wpis baseline sprzed odcisku) - od teraz zmiana komendy, argumentow albo hosta bedzie dryfem (jednorazowo, informational).`,
        sample: `origin=${origin.slice(0, 16)}...`,
    };
}

export const driftDetector: McpDetector = {
    name: "drift",
    run(server: McpServerDefinition, context: McpScanContext): McpFinding[] {
        const current = computeDefinitionHash(server);
        const origin = computeOriginFingerprint(server);
        const baseline = context.driftBaseline.get(server.name);

        // ADR-0162: konektor wozony przez instalator ma oczekiwany hash definicji
        // z manifestu wydania. Zgodny = definicja z naszego buildu, wiec zmiana
        // wzgledem baseline (np. po aktualizacji) nie wymaga decyzji Operatora.
        // Niezgodny = ktos zmienil pliki konektora po instalacji - high, bez
        // wzgledu na baseline.
        // Manifest dotyczy WYLACZNIE konektora z pliku instalatora - konektor z
        // nakladki Operatora pod ta sama nazwa nie dziedziczy zaufania wydania.
        const shipped =
            server.configSource === "installer"
                ? context.bundledDefinitions?.get(server.name)
                : undefined;
        if (shipped !== undefined) {
            if (shipped !== current) {
                return [driftHigh(
                    server,
                    `Definicja konektora '${server.name}' nie zgadza sie z manifestem instalatora (ADR-0162) - pliki konektora mogly zostac zmienione po instalacji. Wymaga decyzji Operatora.`,
                    `manifest=${shipped.slice(0, 12)}... curr=${current.slice(0, 12)}...`,
                )];
            }
            const prev = baseline === undefined ? undefined : parseBaselineEntry(baseline);
            // Odcisk pochodzenia jest tu tylko ustalany na nowo, nie porownywany
            // (naglowek modulu: plik instalatora i manifest = ten sam build).
            if (prev?.version === "v2" && prev.hash === current && prev.origin === origin) return [];
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
            const findings: McpFinding[] = [];
            if (parsed.hash !== current) {
                findings.push(driftHigh(
                    server,
                    `Definicja konektora '${server.name}' zmienila sie od ostatniego ladowania (baseline drift: nazwy, opisy lub schematy wejscia narzedzi). Wymaga decyzji Operatora czy zmiana jest oczekiwana.`,
                    `prev=${parsed.hash.slice(0, 12)}... curr=${current.slice(0, 12)}...`,
                ));
            }
            if (parsed.origin === undefined) findings.push(originEstablished(server, origin));
            else if (parsed.origin !== origin) findings.push(originHigh(server, parsed.origin, origin));
            return findings;
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
                message: `Migracja baseline v1->v2 konektora '${server.name}' (ADR-0159): nazwy i opisy narzedzi bez zmian od ostatniego ladowania; schematy wejscia i odcisk pochodzenia wchodza do baseline od teraz - wczesniejszej wersji nie bylo z czym porownac (jednorazowo, informational).`,
                sample: `v1=${parsed.hash.slice(0, 12)}... v2=${current.slice(0, 12)}...`,
            }];
        }

        return [driftHigh(
            server,
            `Wpis baseline konektora '${server.name}' ma nieznany format - nie da sie potwierdzic, ze definicja sie nie zmienila (fail-closed). Wymaga decyzji Operatora.`,
            `baseline=${String(baseline).slice(0, 16)}`,
        )];
    },
};
