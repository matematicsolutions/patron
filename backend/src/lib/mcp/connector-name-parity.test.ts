// Test PARYTETU nazw konektorow MCP miedzy piecioma lustrami (AGENTS.md,
// Mirrors #2). Powod: rozjazd zmierzony 2026-08-17 - eureka pojechala w
// instalatorze enabled=false, bo brakowalo JEDNEGO wpisu w lustrze JURISDICTION
// w prepare-resources.cjs; build konczyl sie sukcesem, bramka typosquat i
// ring-policy sa zdolne zablokowac WLASNY konektor przy rozjezdzie nazw
// (ADR-0027/0028).
//
// Lustra:
//   1. APPROVED_PATRON_CONNECTORS (mcp-security/pipeline.ts) - KANON
//   2. JURISDICTION_BY_CONNECTOR (mcp/connectors.ts) - grupowanie pickera
//   3. desktop/scripts/prepare-resources.cjs - MCP_SERVERS (Node) +
//      MCP_SERVERS_PYTHON + JURISDICTION + ORDER_PL/ORDER_EN/MARKET_ORDER +
//      NEEDS_KEY + HOME_CONNECTOR + EU_LARGEST_FIRST
//   4. backend/mcp-servers.example.json - konfiguracja dev (pelna lista)
//   5. scripts/bundle-mcp.cjs SERVERS - obraz docker (CELOWY podzbior Node)
//
// prepare-resources i bundle-mcp trzymaja podzbiory (Node vs Python vs docker),
// wiec test weryfikuje RELACJE (partycja, rownosc podzbiorow), nie slepa
// identycznosc calosci - ale kazda relacje przez PELNE listy, nigdy przez
// obecnosc jednej wartosci (precedens: event-type-parity.test.ts, DON'T #3).
//
// Skrypty .cjs maja side effecty na module-scope (bundle-mcp.cjs wykonuje
// walidacje przy require, prepare-resources.cjs odpala main()), dlatego ich
// listy czytamy z TEKSTU pliku regexem - jak SQL w event-type-parity.test.ts.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { APPROVED_PATRON_CONNECTORS } from "../mcp-security/pipeline";
import { JURISDICTION_BY_CONNECTOR } from "./connectors";

const BACKEND_ROOT = path.resolve(__dirname, "../../..");
const REPO_ROOT = path.resolve(BACKEND_ROOT, "..");

const PREPARE_SRC = readFileSync(
    path.join(REPO_ROOT, "desktop", "scripts", "prepare-resources.cjs"),
    "utf8",
);
const BUNDLE_SRC = readFileSync(
    path.join(REPO_ROOT, "scripts", "bundle-mcp.cjs"),
    "utf8",
);
const EXAMPLE_JSON = JSON.parse(
    readFileSync(path.join(BACKEND_ROOT, "mcp-servers.example.json"), "utf8"),
) as Array<{ name?: string }>;

/** Wyciaga wnetrze `const <decl> = [...]` / `{...}` ze zrodla skryptu .cjs. */
function extractBlock(src: string, decl: string, brackets: "[]" | "{}"): string {
    const [open, close] = brackets === "[]" ? ["\\[", "\\]"] : ["\\{", "\\}"];
    const re = new RegExp(`const ${decl} = (?:new Set\\()?${open}([\\s\\S]*?)${close}`);
    const m = re.exec(src);
    expect(m, `brak deklaracji "const ${decl}" w skrypcie`).not.toBeNull();
    return (m as RegExpExecArray)[1];
}

/** Pary { name, repoDir } z bloku listy serwerow (wpisy jednoliniowe). */
function serverEntries(block: string): Array<{ name: string; repoDir: string }> {
    return [...block.matchAll(/name:\s*"([^"]+)",\s*repoDir:\s*"([^"]+)"/g)].map(
        (m) => ({ name: m[1], repoDir: m[2] }),
    );
}

/** Wszystkie literaly "..." z bloku. */
function stringLiterals(block: string): string[] {
    return [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

function sorted(xs: readonly string[]): string[] {
    return [...xs].sort();
}

const expected = sorted(APPROVED_PATRON_CONNECTORS);

// Listy z prepare-resources.cjs (lustro #3).
const prepNode = serverEntries(extractBlock(PREPARE_SRC, "MCP_SERVERS", "[]"));
const prepPython = serverEntries(extractBlock(PREPARE_SRC, "MCP_SERVERS_PYTHON", "[]"));
const prepNodeNames = prepNode.map((s) => s.name);
const prepPythonNames = prepPython.map((s) => s.name);

describe("parytet nazw konektorow MCP (5 luster, AGENTS.md Mirrors #2)", () => {
    it("KANON: APPROVED_PATRON_CONNECTORS nie ma duplikatow", () => {
        expect(new Set(APPROVED_PATRON_CONNECTORS).size).toBe(
            APPROVED_PATRON_CONNECTORS.length,
        );
    });

    it("connectors.ts: klucze JURISDICTION_BY_CONNECTOR == KANON", () => {
        // Rozjazd w dol = picker grupuje konektor pod "OTHER" (bug eureki);
        // rozjazd w gore = sierota bez gateway-scanu (bug sejm-eli).
        expect(sorted(Object.keys(JURISDICTION_BY_CONNECTOR))).toEqual(expected);
    });

    it("connectors.ts: zadna jurysdykcja nie jest 'OTHER' (OTHER = tylko fallback)", () => {
        const other = Object.entries(JURISDICTION_BY_CONNECTOR)
            .filter(([, jur]) => jur === "OTHER")
            .map(([name]) => name);
        expect(other).toEqual([]);
    });

    it("prepare-resources.cjs: MCP_SERVERS + MCP_SERVERS_PYTHON = PARTYCJA kanonu (suma pelna, rozlaczne)", () => {
        expect(sorted([...prepNodeNames, ...prepPythonNames])).toEqual(expected);
        const overlap = prepNodeNames.filter((n) => prepPythonNames.includes(n));
        expect(overlap).toEqual([]);
    });

    it("prepare-resources.cjs: klucze lustra JURISDICTION == KANON i wartosci zgodne z connectors.ts", () => {
        // Dokladnie ta luka wypuscila eureke enabled=false (2026-08-17).
        const block = extractBlock(PREPARE_SRC, "JURISDICTION", "{}");
        const entries = [...block.matchAll(/"?([A-Za-z][\w-]*)"?\s*:\s*"([A-Z]{2})"/g)].map(
            (m) => [m[1], m[2]] as const,
        );
        expect(sorted(entries.map(([name]) => name))).toEqual(expected);
        for (const [name, jur] of entries) {
            expect({ name, jur }).toEqual({
                name,
                jur: JURISDICTION_BY_CONNECTOR[name],
            });
        }
    });

    it("prepare-resources.cjs: ORDER_PL, ORDER_EN i MARKET_ORDER pokrywaja PELNY kanon (zero cichego fallbacku rank=999)", () => {
        // Konektor bez pozycji nie znika, tylko lapie rank=999 i jedzie na
        // koncu manifestu - porzadek ma byc jawny, nie efektem ubocznym.
        // MARKET_ORDER dopisany 2026-08-31: trzecia lista porzadku (buildy
        // rynkowe) stala POZA mianownikiem tej bramki i brakowalo w niej
        // eureka/br-eli/gb-eli/us-eli - dokladnie ten sam cichy fallback,
        // ktory bramka mialaby wykluczyc, tyle ze o jedna liste dalej.
        const eu = stringLiterals(extractBlock(PREPARE_SRC, "EU_LARGEST_FIRST", "[]"));
        for (const decl of ["ORDER_PL", "ORDER_EN", "MARKET_ORDER"]) {
            const block = extractBlock(PREPARE_SRC, decl, "[]");
            expect(block, `${decl} ma zawierac spread ...EU_LARGEST_FIRST`).toContain(
                "...EU_LARGEST_FIRST",
            );
            const order = [...eu, ...stringLiterals(block)];
            expect({ decl, names: sorted(order) }).toEqual({ decl, names: expected });
            expect(new Set(order).size, `${decl}: duplikaty pozycji`).toBe(order.length);
        }
        // Sama pelna lista nie wystarczy - marketOrder() musi z NIEJ liczyc
        // porzadek. Wlasna literalna lista w ciele funkcji = ta sama luka.
        const MARKET_FN = "function marketOrder(locale) {";
        const start = PREPARE_SRC.indexOf(MARKET_FN);
        expect(start, "brak funkcji marketOrder w skrypcie").toBeGreaterThan(-1);
        const body = PREPARE_SRC.slice(start + MARKET_FN.length).split("\n}")[0];
        expect(body, "marketOrder() nie buduje sie z MARKET_ORDER").toContain(
            "MARKET_ORDER",
        );
        expect(body, "marketOrder() nie czyta HOME_CONNECTOR").toContain(
            "HOME_CONNECTOR[locale]",
        );
        expect(
            /"[a-z]{2}-eli"|"saos"|"eureka"/.test(body),
            "marketOrder() ma wlasne literaly nazw konektorow - porzadek ma " +
                "pochodzic z MARKET_ORDER, inaczej lista wraca poza mianownik",
        ).toBe(false);
    });

    it("prepare-resources.cjs: NEEDS_KEY == wpisy z needsKey:true i jest podzbiorem kanonu", () => {
        const needsKeySet = stringLiterals(extractBlock(PREPARE_SRC, "NEEDS_KEY", "[]"));
        const flagged = [
            ...extractBlock(PREPARE_SRC, "MCP_SERVERS", "[]").matchAll(
                /name:\s*"([^"]+)"[^\n]*needsKey:\s*true/g,
            ),
            ...extractBlock(PREPARE_SRC, "MCP_SERVERS_PYTHON", "[]").matchAll(
                /name:\s*"([^"]+)"[^\n]*needsKey:\s*true/g,
            ),
        ].map((m) => m[1]);
        expect(sorted(needsKeySet)).toEqual(sorted(flagged));
        const orphans = needsKeySet.filter((n) => !expected.includes(n));
        expect(orphans).toEqual([]);
    });

    it("prepare-resources.cjs: HOME_CONNECTOR wskazuje wylacznie bundlowane konektory Python", () => {
        // Rynkowy build (lean edition) bundluje TYLKO konektor macierzysty -
        // wartosc spoza MCP_SERVERS_PYTHON = pusty instalator rynkowy.
        const values = [
            ...extractBlock(PREPARE_SRC, "HOME_CONNECTOR", "{}").matchAll(/:\s*"([a-z-]+)"/g),
        ].map((m) => m[1]);
        expect(values.length).toBeGreaterThan(0);
        const outside = values.filter((n) => !prepPythonNames.includes(n));
        expect(outside).toEqual([]);
    });

    it("mcp-servers.example.json: nazwy == KANON (pelna lista dev)", () => {
        const names = EXAMPLE_JSON.map((e) => e.name).filter(
            (n): n is string => typeof n === "string",
        );
        expect(names.length).toBe(EXAMPLE_JSON.length);
        expect(sorted(names)).toEqual(expected);
    });

    it("bundle-mcp.cjs: SERVERS (docker) == podzbior Node z prepare-resources (nazwa + repoDir)", () => {
        // Docker celowo wozi tylko konektory Node - ale DOKLADNIE ten sam
        // zestaw i te same repo co bundel desktopowy, nie wlasna liste.
        const docker = serverEntries(extractBlock(BUNDLE_SRC, "SERVERS", "[]"));
        const byName = (a: { name: string }, b: { name: string }) =>
            a.name.localeCompare(b.name);
        expect([...docker].sort(byName)).toEqual([...prepNode].sort(byName));
    });
});
