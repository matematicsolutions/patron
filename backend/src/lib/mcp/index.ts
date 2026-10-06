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
    APPROVED_PATRON_CONNECTORS,
    awaitsOnlyThirdPartyApproval,
    buildScanContext,
    isOriginDriftFinding,
    resolveOperatorApproval,
    scanMcpRegistry,
    type GatewayApproval,
    type McpAction,
    type McpFinding,
    type McpServerDefinition,
    type McpToolDefinition,
    type OperatorApprovalStatus,
} from "../mcp-security";
import { recordMcpSecurityEvent, recordRingPolicyEvent } from "./audit-bridge";
import { decideRing } from "./ring-policy";
import {
    operatorOverlayPath,
    readMergedConfig,
    writeEnabledToOverlay,
    writeGatewayApprovalToOverlay,
} from "./operator-overlay";
import type { McpCitation, McpToolResult } from "./types";
import { isVerifierServer, sanitizeVerifyArgs, verifierServerName, VERIFY_TOOL } from "./verifier";

export type { McpCitation, McpToolResult } from "./types";
export { verifierServerName, VERIFY_TOOL } from "./verifier";

// ---------------------------------------------------------------------------
// Config types
// ---------------------------------------------------------------------------

export interface McpServerConfig {
    name: string;
    transport: "stdio" | "http";
    // stdio
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    // http
    url?: string;
    // ADR-0134: runtime konektora dla bundlingu desktop. "node" (domyslny) =
    // dist/index.js pod Node Electrona; "python" = frozen-exe (PyInstaller).
    // Nie zmienia kontraktu MCP ani trust - tylko sposob uruchomienia/bundlowania.
    runtime?: "node" | "python";
    // enabled flag - absent means enabled
    enabled?: boolean;
    // ADR-0027 privilege rings - pola dla Ring 2 explicit allow przez Operatora.
    // trustLevel jest informacyjne (audytor widzi w git diff), decyzja
    // ring-policy wymaga operatorApproved=true dla Ring 2 allow.
    // approvedAt / approvedBy sa informacyjne dla audytora w samym pliku konfigu.
    trustLevel?: "trusted" | "untrusted";
    operatorApproved?: boolean;
    approvedAt?: string;
    approvedBy?: string;
    // ADR-0158: zatwierdzenie werdyktu `human_review` bramy (load-time) dla
    // KONKRETNEJ definicji narzedzi. Niezalezne od operatorApproved (ring-policy,
    // runtime). Hash podaje log przy starcie; `denied` nie jest do zatwierdzenia.
    gatewayApproval?: GatewayApproval;
    // B-06 / R-MCP-01 (ADR-0166): skad pochodzi wpis - ustawiane WYLACZNIE przez
    // mergeOperatorOverlay, nigdy czytane z pliku. Ring 1 i zaufanie manifestu
    // (ADR-0162) tylko dla "installer".
    configSource?: "installer" | "operator-overlay";
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

// tool name (prefixed) -> { client, original name, serverName }
const _toolRegistry = new Map<
    string,
    { client: Client; originalName: string; serverName: string }
>();
// ADR-0027: serverName -> McpServerConfig, populowana razem z _toolRegistry
// w fazie 3 getMcpTools(). Czytana w runMcpTool zeby decideRing mial dostep
// do pol trustLevel/operatorApproved konektora.
const _serverConfigByName = new Map<string, McpServerConfig>();
// B-08 (decyzja wlasciciela produktu 2026-10-06): serwery, ktorych werdykt
// `human_review` Operator zatwierdzil W TYM PROCESIE zgodnym `gatewayApproval`
// (hash definicji + odcisk pochodzenia, ADR-0158). Ustawiane WYLACZNIE w
// getMcpTools po resolveOperatorApproval === "approved" - nigdy z pliku
// konfiguracji, wiec pole o tej nazwie w nakladce niczego nie daje. Czytane w
// callRegisteredTool: to jedno zatwierdzenie dopuszcza tez wywolania Ring 2.
const _gatewayApprovedServers = new Set<string>();
// Stan bramy per serwer z ostatniego skanu (do trasy "Sprawdz powolania" i
// pickera konektorow): czy konektor czeka na zatwierdzenie Operatora.
const _gatewayStateByName = new Map<string, McpGatewayState>();
// cached list of OpenAIToolSchema[]
let _cachedTools: OpenAIToolSchema[] | null = null;

/**
 * Stan konektora po skanie bramy przy starcie (B-08 / ADR-0158). Bez sekretow:
 * hash definicji i odcisk pochodzenia to skroty SHA-256, adres i klucz nie
 * wchodza.
 */
export interface McpGatewayState {
    /** Werdykt skanera (przed decyzja Operatora). */
    gatewayAction: McpAction;
    /** Decyzja Operatora wzgledem werdyktu (resolveOperatorApproval). */
    approval: OperatorApprovalStatus;
    /** Czy narzedzia zostaly zarejestrowane. */
    registered: boolean;
    /**
     * `human_review` wynika wylacznie z tego, ze konektor jest nieznany (nowy
     * 3rd-party), a nie z podejrzanego sygnalu (dryf, podobna nazwa, ukryte
     * instrukcje) - UI pokazuje "czeka na zatwierdzenie", nie alarm.
     */
    unknownThirdPartyOnly: boolean;
    /** Wartosci do wpisania w `gatewayApproval` po przegladzie zastrzezen. */
    approvalHash: string;
    approvalOrigin: string;
    /**
     * Zastrzezenia skanera (te same 3 pola co w audycie, ADR-0033) - Operator
     * widzi je w panelu konektorow PRZED zatwierdzeniem.
     */
    findings: ReadonlyArray<Pick<McpFinding, "detector" | "severity" | "message">>;
    /** Ocena ryzyka skanera - ta sama, co w zdarzeniu startowym (dowod scisly). */
    riskScore: number;
}

/**
 * Konektor czeka na zatwierdzenie Operatora: werdykt `human_review` bez
 * zgodnego `gatewayApproval` (brak albo zatwierdzenie innej definicji).
 */
export function isAwaitingOperatorApproval(state: McpGatewayState | undefined): boolean {
    return (
        !!state &&
        !state.registered &&
        state.gatewayAction === "human_review" &&
        (state.approval === "missing" || state.approval === "hash_mismatch")
    );
}

/**
 * Stan bramy dla konektora z ostatniego skanu w tym procesie. `undefined` =
 * konektor nie byl skanowany (brak wpisu, wylaczony, nie wstal albo
 * getMcpTools jeszcze nie bylo wolane).
 */
export function getGatewayState(serverName: string): McpGatewayState | undefined {
    return _gatewayStateByName.get(serverName);
}

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

const CONFIG_PATH = path.resolve(__dirname, "../../../mcp-servers.json");
// Korzen backendu (tam lezy mcp-servers.json oraz - w instalatorze desktop -
// katalog mcp-bundled/ z konektorami). Sluzy do rozwiazania sciezek wzglednych
// w args konektora na bezwzgledne.
const BACKEND_ROOT = path.dirname(CONFIG_PATH);

/**
 * Rozwiazuje konfiguracje konektora stdio pod realne srodowisko uruchomieniowe.
 *
 * Dwa problemy instalatora desktop (ADR-0091), ktorych nie ma w trybie
 * dev/docker:
 *  1. Na maszynie klienta NIE MA zewnetrznego `node`. Backend dziala pod Node
 *     wbudowanym w Electron (main.js spawnuje go z ELECTRON_RUN_AS_NODE=1).
 *     Ten sam binarny (process.execPath) musi uruchomic konektor - wiec gdy
 *     command === "node" i jestesmy pod Electronem, podmieniamy na execPath
 *     i przekazujemy ELECTRON_RUN_AS_NODE=1 do dziecka.
 *  2. mcp-servers.json instalatora trzyma args WZGLEDNE (np.
 *     "mcp-bundled/saos/dist/index.js"), bo absolutna sciezka instalacji nie
 *     jest znana w czasie budowania. Rozwiazujemy je wzgledem BACKEND_ROOT.
 *
 * W trybie dev/docker (command "node" dostepny, args absolutne) funkcja jest
 * no-op - sciezki absolutne nie sa ruszane, podmiana execPath nie odpala.
 */
export function resolveStdioSpawn(cfg: McpServerConfig): McpServerConfig {
    if (cfg.transport !== "stdio") return cfg;

    const underElectron = process.env.ELECTRON_RUN_AS_NODE === "1";
    let command = cfg.command;
    let env = cfg.env;
    if (command === "node" && underElectron) {
        command = process.execPath;
        // Minimalny env (least-privilege, Konstytucja Art. 7 / RODO art. 32):
        // wymuszamy tryb Node Electrona + ewentualny env operatora z cfg. NIE
        // przekazujemy pelnego process.env - zawiera sekrety backendu (klucz
        // szyfrowania bazy, sekret szyfrowania kluczy API, secret podpisu pobran
        // z main.js), ktorych konektor orzecznictwa nie potrzebuje, a bundlujemy
        // duzo tranzytywnych node_modules (powierzchnia supply-chain). Bezpieczna
        // baza OS (PATH/SystemRoot/APPDATA itd.) jest domieszywana przez sam SDK
        // (StdioClientTransport: { ...getDefaultEnvironment(), ...env }) - konektor
        // startuje, sekrety nie wyciekaja do procesu-dziecka.
        env = { ...(cfg.env ?? {}), ELECTRON_RUN_AS_NODE: "1" };
    } else if (command && !path.isAbsolute(command) && /[\\/]/.test(command)) {
        // ADR-0134: konektor nie-Node bundlowany jako artefakt (np. frozen Python
        // exe). `command` jest sciezka WZGLEDNA do bundla -> rozwiaz wzgledem
        // BACKEND_ROOT (jak args .js/.py). Bare nazwy ("node"/"python") bez
        // separatora zostaja - znajdzie je SDK na PATH.
        command = path.resolve(BACKEND_ROOT, command);
    }

    const args = (cfg.args ?? []).map((a) =>
        (a.endsWith(".js") || a.endsWith(".py")) && !path.isAbsolute(a)
            ? path.resolve(BACKEND_ROOT, a)
            : a,
    );

    return { ...cfg, command, args, env };
}

// ADR-0166: konfiguracja = plik instalatora (resources/backend, kasowany przy
// aktualizacji) + nakladka Operatora w katalogu uzytkownika (przezywa update).
// Ostrzezenia o pominietych wpisach logujemy raz na proces.
let _ostrzezeniaZalogowane = false;
function mergedConfig(): McpServerConfig[] {
    const { configs, warnings } = readMergedConfig(CONFIG_PATH, operatorOverlayPath());
    if (!_ostrzezeniaZalogowane) {
        for (const w of warnings) console.warn(`[MCP] ${w}`);
        _ostrzezeniaZalogowane = true;
    }
    return configs;
}

/**
 * Wpis do uruchomienia: `spawn` po rozwiazaniu sciezek (resolveStdioSpawn) i
 * `declared` w postaci z konfiguracji. Odcisk pochodzenia (B-06) liczymy z
 * `declared`: sciezki instalatora sa tam wzgledne wobec katalogu zasobow, a
 * `node` nie jest jeszcze podmieniony na process.execPath - przeniesienie
 * instalacji w inne miejsce nie zmienia odcisku.
 */
interface LoadedConfig {
    spawn: McpServerConfig;
    declared: McpServerConfig;
}

function loadConfig(): LoadedConfig[] {
    return mergedConfig()
        .filter((s) => s.enabled !== false)
        .map((declared) => ({ declared, spawn: resolveStdioSpawn(declared) }));
}

// ---------------------------------------------------------------------------
// Connector picker I/O (ADR-0133) - surowy odczyt + zapis flagi `enabled`.
// W odroznieniu od loadConfig(): NIE filtruje wylaczonych i NIE rozwiazuje
// sciezek stdio - sluzy prezentacji/zmianie stanu w pickerze, nie uruchomieniu.
// Cala styk z plikiem konfiguracji konektorow jest w tym module (jedno zrodlo
// dostepu - latwiejszy audyt bezpieczenstwa).
// ---------------------------------------------------------------------------

/** Lista konektorow (WSZYSTKICH, lacznie z enabled=false): instalator + nakladka. */
export function listConnectorConfigs(): McpServerConfig[] {
    return mergedConfig();
}

/**
 * Ustawia flage `enabled` konektora. ADR-0166: zapis idzie do NAKLADKI Operatora,
 * nie do mcp-servers.json z katalogu instalacji - inaczej przelacznik ginal przy
 * kazdej aktualizacji. NIE waliduje ring - autoryzacja (tylko Ring 1 przez
 * picker) jest w connectors.ts. Zmiana wchodzi w zycie po restarcie/reloadzie.
 */
export function setConnectorEnabledInConfig(
    name: string,
    enabled: boolean,
): { ok: boolean; error?: string } {
    if (!mergedConfig().some((s) => s.name === name)) {
        return { ok: false, error: `connector "${name}" not found` };
    }
    return writeEnabledToOverlay(operatorOverlayPath(), name, enabled);
}

/**
 * Zapisuje zatwierdzenie bramy (`gatewayApproval`) konektora do NAKLADKI
 * Operatora (B-08 / ADR-0158). NIE sprawdza, czy zatwierdzenie odpowiada
 * biezacemu skanowi - to robi connectors.ts (approveConnectorGateway).
 * Wchodzi w zycie po restarcie (rejestracja przy starcie, getMcpTools).
 */
export function setGatewayApprovalInConfig(
    name: string,
    approval: { hash: string; origin: string; approvedAt: string; approvedBy: string },
): { ok: boolean; error?: string } {
    if (!mergedConfig().some((s) => s.name === name)) {
        return { ok: false, error: `connector "${name}" not found` };
    }
    return writeGatewayApprovalToOverlay(operatorOverlayPath(), name, approval);
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
    /** Konfiguracja jak zapisana (przed resolveStdioSpawn) - zrodlo odcisku pochodzenia. */
    declared?: McpServerConfig;
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
    cfg: McpServerConfig,
): void {
    for (const tool of tools) {
        const prefixed = `${serverName}__${tool.name}`;
        _toolRegistry.set(prefixed, { client, originalName: tool.name, serverName });
    }
    // ADR-0027: zachowujemy konfig serwera zeby ring-policy w runMcpTool
    // miala dostep do flag trustLevel/operatorApproved.
    _serverConfigByName.set(serverName, cfg);
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

// ADR-0162: manifest definicji konektorow wozonych przez instalator, zapisany
// przy buildzie (desktop/scripts/definition-manifest.cjs) obok mcp-servers.json.
// Brak pliku (dev, tryb serwerowy) albo plik uszkodzony = pusta mapa, czyli
// zwykly dryf - brak manifestu nigdy nie poszerza zaufania.
function bundledDefinitionsPath(): string {
    const override = process.env.PATRON_MCP_BUNDLED_DEFINITIONS_PATH;
    if (override && override.length > 0) return override;
    return path.join(BACKEND_ROOT, "bundled-definitions.json");
}

export function loadBundledDefinitions(): Map<string, string> {
    const p = bundledDefinitionsPath();
    if (!fs.existsSync(p)) return new Map();
    try {
        const parsed = JSON.parse(fs.readFileSync(p, "utf-8")) as {
            version?: unknown;
            definitions?: unknown;
        };
        if (parsed?.version !== 1 || !parsed.definitions || typeof parsed.definitions !== "object") {
            console.warn(`[MCP-SECURITY] Manifest definicji ${p} ma nieznany format - ignoruje (zwykly dryf).`);
            return new Map();
        }
        const out = new Map<string, string>();
        for (const [name, hash] of Object.entries(parsed.definitions as Record<string, unknown>)) {
            if (typeof hash === "string" && /^[0-9a-f]{64}$/.test(hash)) out.set(name, hash);
        }
        return out;
    } catch (err) {
        console.warn(`[MCP-SECURITY] Nie udalo sie odczytac manifestu definicji ${p} - ignoruje (zwykly dryf):`, err);
        return new Map();
    }
}

function toMcpServerDefinition(d: DiscoveredServer): McpServerDefinition {
    const declared = d.declared ?? d.cfg;
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
        command: declared.command,
        args: declared.args,
        url: declared.url,
        tools: toolDefs,
        ...(declared.configSource !== undefined && { configSource: declared.configSource }),
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
 * - human_review: tools NIE rejestrowane, chyba ze Operator wpisal zgodne
 *   `gatewayApproval` (ADR-0158) - wtedy rejestrowane i dopuszczone w Ring 2.
 *   Nieznany konektor 3rd-party zawsze trafia tutaj (B-08).
 * - denied: tools NIE rejestrowane, warning, client zamykany
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
    const discovered = await Promise.all(
        configs.map(async (c) => ({ ...(await connectAndDiscover(c.spawn)), declared: c.declared })),
    );
    const ok = discovered.filter((d) => d.ok);

    if (ok.length === 0) {
        _cachedTools = [];
        return _cachedTools;
    }

    // Faza 2: scan przez MCP Security Gateway
    const definitions = ok.map(toMcpServerDefinition);
    const baseline = loadBaseline();
    const context = buildScanContext(baseline, APPROVED_PATRON_CONNECTORS, loadBundledDefinitions());
    const report = scanMcpRegistry(definitions, context);

    // Faza 3: register / skip per server
    const newBaseline = new Map(baseline);
    const tools: OpenAIToolSchema[] = [];

    for (const [i, d] of ok.entries()) {
        const result = report.perServer.find((r) => r.serverName === d.cfg.name);
        if (!result) continue;

        // ADR-0158: `human_review` moze zostac zatwierdzony przez Operatora dla
        // tej konkretnej definicji (hash); `denied` - nigdy.
        const approval = resolveOperatorApproval(
            result.action,
            definitions[i],
            d.cfg.gatewayApproval,
            { originChanged: result.findings.some(isOriginDriftFinding) },
        );
        const cfgApproval = d.cfg.gatewayApproval;
        const operatorApproval =
            approval.status === "not_needed"
                ? undefined
                : {
                      status: approval.status,
                      gatewayAction: result.action,
                      approvalHash: approval.approvalHash,
                      ...(typeof cfgApproval?.approvedAt === "string" && {
                          approvedAt: cfgApproval.approvedAt,
                      }),
                      ...(typeof cfgApproval?.approvedBy === "string" && {
                          approvedBy: cfgApproval.approvedBy,
                      }),
                  };
        const action = approval.status === "approved" ? "audit" : result.action;
        const unknownThirdPartyOnly = awaitsOnlyThirdPartyApproval(result.findings);
        _gatewayStateByName.set(d.cfg.name, {
            gatewayAction: result.action,
            approval: approval.status,
            registered: approval.register,
            unknownThirdPartyOnly,
            approvalHash: approval.approvalHash,
            approvalOrigin: approval.approvalOrigin,
            findings: result.findings.map((f) => ({
                detector: f.detector,
                severity: f.severity,
                message: f.message,
            })),
            riskScore: result.riskScore,
        });

        if (approval.register) {
            registerTools(d.client, d.cfg.name, d.tools, d.cfg);
            newBaseline.set(d.cfg.name, result.currentHash);
            if (approval.status === "approved") {
                // B-08: zgodne zatwierdzenie bramy (hash + pochodzenie) jest tez
                // zgoda na wywolania w Ring 2 - jeden swiadomy krok Operatora.
                _gatewayApprovedServers.add(d.cfg.name);
                console.warn(
                    `[MCP-SECURITY] Server "${d.cfg.name}" human_review ZATWIERDZONY przez Operatora (hash=${approval.approvalHash}) - narzedzia zarejestrowane, wywolania dopuszczone (Ring 2, ADR-0027/0158).`,
                );
            }
            if (action === "audit" || result.findings.length > 0) {
                console.warn(
                    `[MCP-SECURITY] Server "${d.cfg.name}" action=${action} riskScore=${result.riskScore} findings=${result.findings.length}`,
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
                    action,
                    riskScore: result.riskScore,
                    findings: result.findings,
                    ...(operatorApproval && { operatorApproval }),
                }).catch((err) => {
                    console.warn(
                        `[MCP-SECURITY] audit bridge failed for "${d.cfg.name}":`,
                        err,
                    );
                });
            }
            // R-CC-07 (ADR-0157): narzedzia serwera weryfikatora powolan sa
            // zarejestrowane (trasa "Sprawdz powolania" ich potrzebuje), ale NIE
            // trafiaja do listy narzedzi modelu czatu - tryb `text` wyslalby cale pismo.
            if (isVerifierServer(d.cfg.name)) {
                console.log(
                    `[MCP] "${d.cfg.name}" to weryfikator powolan (ADR-0157) - narzedzia niedostepne dla czatu.`,
                );
            } else {
                for (const t of d.tools) {
                    tools.push(mcpToolToOpenAI(d.cfg.name, t));
                }
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
            if (approval.status === "missing" || approval.status === "hash_mismatch") {
                // Sciezka decyzji dla czlowieka (ADR-0158): po przegladzie findings
                // Operator wpisuje ten hash - i tylko ta definicja przechodzi.
                // B-08: to JEDYNY krok - zgodne zatwierdzenie bramy dopuszcza tez
                // wywolania Ring 2 (operatorApproved nie jest juz potrzebne).
                console.warn(
                    `[MCP-SECURITY]   ${unknownThirdPartyOnly ? "Nowy konektor spoza zaufanego zestawu czeka na zatwierdzenie Operatora (B-08). " : ""}${approval.status === "hash_mismatch" ? "Zatwierdzenie w nakladce Operatora dotyczy INNEJ definicji albo innego pochodzenia konektora (narzedzia, komenda lub host sie zmienily). " : ""}Po przegladzie findings Operator zatwierdza te definicje w panelu "Konektory prawa" (przycisk "Przejrzyj i zatwierdz") albo recznie JEDNYM wpisem: "gatewayApproval": { "hash": "${approval.approvalHash}", "origin": "${approval.approvalOrigin}", "approvedAt": "RRRR-MM-DD", "approvedBy": "..." } we wpisie konektora w nakladce Operatora ${operatorOverlayPath()} (mcp-servers.json z katalogu instalacji kasuje aktualizacja, ADR-0166), potem restart PATRONa. To zatwierdzenie dopuszcza tez wywolania narzedzi (Ring 2) - osobne operatorApproved nie jest potrzebne.`,
                );
            }
            // ADR-0033: propagacja decyzji Gateway do audit hash-chain.
            // Fire-and-forget - porazka audit nie wstrzymuje obslugi blokady konektora.
            void recordMcpSecurityEvent({
                serverName: d.cfg.name,
                action: result.action,
                riskScore: result.riskScore,
                findings: result.findings,
                ...(operatorApproval && { operatorApproval }),
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
 * (i.e. was registered via getMcpTools) AND is a chat tool. Narzedzia serwera
 * weryfikatora powolan (R-CC-07) nie sa narzedziami czatu - model, ktory poda
 * ich nazwe mimo braku w schemacie, nie dostaje wywolania.
 */
export function isMcpTool(name: string): boolean {
    const entry = _toolRegistry.get(name);
    return !!entry && !isVerifierServer(entry.serverName);
}

/** Czy weryfikator powolan (`<serwer>__verify_citations`) jest zarejestrowany. */
export function hasCitationVerifier(): boolean {
    return _toolRegistry.has(`${verifierServerName()}__${VERIFY_TOOL}`);
}

/**
 * Jedyne wejscie do `verify_citations` (trasa "Sprawdz powolania", ADR-0157).
 * Argumenty przechodza przez biala liste trybu listy (`sanitizeVerifyArgs`):
 * `text` i kazde inne pole nie wychodza, niezaleznie od tego, co poda wolajacy.
 */
export async function runCitationVerifier(
    input: Record<string, unknown>,
): Promise<McpToolResult> {
    const name = `${verifierServerName()}__${VERIFY_TOOL}`;
    const entry = _toolRegistry.get(name);
    if (!entry) {
        return {
            text: JSON.stringify({ error: `MCP tool "${name}" is not registered.` }),
            citations: [],
            isError: true,
        };
    }
    return callRegisteredTool(name, entry, sanitizeVerifyArgs(input));
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
    // R-CC-07: serwer weryfikatora nie jest dostepny z czatu - takze wtedy, gdy
    // model poda nazwe narzedzia, ktorej nie dostal w schemacie.
    if (isVerifierServer(entry.serverName)) {
        return {
            text: JSON.stringify({
                error: `MCP tool "${name}" is reserved for the citation check (ADR-0157) and is not available in chat.`,
            }),
            citations: [],
            isError: true,
        };
    }
    return callRegisteredTool(name, entry, input);
}

async function callRegisteredTool(
    name: string,
    entry: { client: Client; originalName: string; serverName: string },
    input: Record<string, unknown>,
): Promise<McpToolResult> {
    const serverName = entry.serverName;
    const toolName = entry.originalName;

    // ADR-0027 privilege rings - gate w czasie wywolania przed faktycznym callTool.
    // decideRing jest pure function; audit dziala w trybie wyslij-i-zapomnij
    // (Konstytucja Art. 8 stalosc kontraktow - porazka audit nie blokuje tool call).
    const cfg = _serverConfigByName.get(serverName);
    // Pola ring-policy skladane jawnie: `gatewayApproved` pochodzi WYLACZNIE ze
    // skanu w tym procesie (B-08), nigdy z pliku konfiguracji.
    const decision = decideRing(serverName, {
        trustLevel: cfg?.trustLevel,
        operatorApproved: cfg?.operatorApproved,
        configSource: cfg?.configSource,
        gatewayApproved: _gatewayApprovedServers.has(serverName),
    });
    void recordRingPolicyEvent({
        toolName: name,
        serverName,
        decision,
    }).catch((err) => {
        console.warn(
            `[RING-POLICY] audit bridge failed for "${name}":`,
            err,
        );
    });

    if (decision.action === "deny") {
        console.warn(
            `[RING-POLICY] Tool "${name}" DENIED (ring=${decision.ring}, reason=${decision.reason}). Add operatorApproved=true to its entry in the operator overlay ${operatorOverlayPath()} to allow (the installer copy of mcp-servers.json is replaced on update, ADR-0166).`,
        );
        return {
            text: JSON.stringify({
                error: `Tool "${name}" denied by ring policy (ring ${decision.ring}, reason: ${decision.reason}). Operator approval required.`,
                ring: decision.ring,
                reason: decision.reason,
            }),
            citations: [],
            isError: true,
        };
    }

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
        const structured = (result as { structuredContent?: unknown })
            .structuredContent;
        const citations = extractMcpCitations(structured, serverName, toolName);

        const isError =
            (result as { isError?: boolean }).isError === true || undefined;

        return {
            text,
            citations,
            isError,
            ...(structured !== undefined && { structured }),
        };
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
