// R-MCP-03: Uszkodzona nakladka Operatora po cichu WLACZA konektory, ktore mecenas
// wylaczyl w pickerze (fail-open).
//
// Picker zapisuje wylaczenie wylacznie w nakladce (`{name, enabled:false}`,
// operator-overlay.ts:143-145). Gdy nakladka sie nie parsuje - a ADR-0157/0166 kaze
// Operatorowi edytowac ja RECZNIE, zeby dopisac weryfikator powolan - czytajTablice
// (operator-overlay.ts:35-45) zwraca [] z ostrzezeniem w konsoli, a scalanie bierze
// stan z instalatora (enabled domyslnie). Konektor wylaczony przez mecenasa wraca do
// getMcpTools przy starcie; picker pokazuje go jako wlaczony, a zapisu nie da sie
// poprawic (writeEnabledToOverlay odmawia nadpisania uszkodzonego pliku, :138-141).
// ADR-0166 pkt 2 rozwazyl tylko jedna strone: "Uszkodzona nakladka nie zabiera
// konektorow instalatora".
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readMergedConfig } from "../src/lib/mcp/operator-overlay";

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "r-mcp-03-")); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const SAOS = { name: "saos", transport: "stdio", command: "node", args: ["mcp-bundled/saos/dist/index.js"] };
const ladowany = (cfgs: { name: string; enabled?: unknown }[], n: string) =>
    cfgs.filter((s) => s.enabled !== false).some((s) => s.name === n); // = loadConfig, index.ts:163

describe("R-MCP-03 uszkodzona nakladka a wylaczenia z pickera", () => {
    it("literowka Operatora w nakladce nie moze przywrocic konektora wylaczonego przez mecenasa", () => {
        const instalator = path.join(dir, "mcp-servers.json");
        const nakladka = path.join(dir, "mcp-servers.operator.json");
        fs.writeFileSync(instalator, JSON.stringify([SAOS]));
        fs.writeFileSync(nakladka, JSON.stringify([{ name: "saos", enabled: false }]));
        expect(ladowany(readMergedConfig(instalator, nakladka).configs, "saos")).toBe(false);

        // Operator dopisuje recznie weryfikator powolan i zostawia przecinek na koncu.
        fs.writeFileSync(
            nakladka,
            '[{"name":"saos","enabled":false},{"name":"repertorium","transport":"http","url":"https://example.invalid/mcp"},]',
        );
        const { configs, warnings } = readMergedConfig(instalator, nakladka);
        expect(warnings.join(" ")).toMatch(/blad parsowania/);
        expect(ladowany(configs, "saos"), "konektor wylaczony przez mecenasa wrocil do startu").toBe(false);
    });
});
