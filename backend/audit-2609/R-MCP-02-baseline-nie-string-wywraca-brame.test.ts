// R-MCP-02: Wpis baseline, ktory nie jest napisem (np. null po recznej edycji
// ~/.patron/mcp-drift-baseline.json), wywraca caly skan bramy wyjatkiem TypeError.
//
// loadBaseline (lib/mcp/index.ts:301-313) rzutuje JSON na Record<string,string> bez
// walidacji wartosci. Od ADR-0159 detektor dryfu wola parseBaselineEntry(baseline)
// (drift.ts:118 i 141), ktore robi `entry.startsWith(...)` (drift.ts:81) - dla null
// / liczby / obiektu to TypeError. scanMcpRegistry rzuca, getMcpTools (index.ts:420)
// rzuca PO polaczeniu wszystkich konektorow (procesy-dzieci nie zamkniete),
// _cachedTools zostaje null, a chat/stream.ts:173 (`await getMcpTools()` bez try)
// wywraca kazda ture czatu. Przed ADR-0159 ten sam plik dawal drift/high
// (porownanie `baseline !== current`), czyli fail-closed na JEDNYM konektorze.
// ADR-0159 pkt 4 obiecuje: wpis w nieznanym formacie = drift/high.
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { loadBaseline } from "../src/lib/mcp";
import {
    buildScanContext,
    scanMcpRegistry,
    type McpServerDefinition,
} from "../src/lib/mcp-security";

const plik = path.join(os.tmpdir(), `r-mcp-02-baseline-${process.pid}.json`);
afterEach(() => {
    delete process.env.PATRON_MCP_BASELINE_PATH;
    fs.rmSync(plik, { force: true });
});

const saos: McpServerDefinition = {
    name: "saos", transport: "stdio", command: "node",
    tools: [{ name: "search", description: "Syntetyczny opis.", inputSchema: { type: "object", properties: {} } }],
};
const isap: McpServerDefinition = { ...saos, name: "isap" };

describe("R-MCP-02 baseline z wartoscia nie-napisem", () => {
    it("null w baseline jednego konektora = drift/high dla niego, nie wyjatek dla wszystkich", () => {
        fs.writeFileSync(plik, JSON.stringify({ saos: null }));
        process.env.PATRON_MCP_BASELINE_PATH = plik;
        const baseline = loadBaseline();

        let raport: ReturnType<typeof scanMcpRegistry> | undefined;
        let blad: unknown;
        try {
            raport = scanMcpRegistry([saos, isap], buildScanContext(baseline));
        } catch (e) {
            blad = e;
        }
        expect(blad === undefined ? "brak wyjatku" : String(blad), "skan bramy nie moze rzucac").toBe("brak wyjatku");
        expect(raport?.perServer.find((r) => r.serverName === "saos")?.action).toBe("human_review");
    });
});
