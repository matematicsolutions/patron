// ADR-0166: konfiguracja konektorow MCP przezywa aktualizacje instalatora.
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    mergeOperatorOverlay,
    readMergedConfig,
    writeEnabledToOverlay,
} from "./operator-overlay";
import { listConnectorConfigs, setConnectorEnabledInConfig } from "./index";
import { decideRing } from "./ring-policy";

const SAOS = { name: "saos", transport: "stdio", command: "node", args: ["mcp-bundled/saos/dist/index.js"] };
const ISAP = { name: "isap", transport: "stdio", command: "node", args: ["mcp-bundled/isap/dist/index.js"], enabled: true };
const WERYFIKATOR = {
    name: "repertorium", transport: "http", url: "https://example.invalid/mcp/x",
    trustLevel: "untrusted", operatorApproved: true,
    gatewayApproval: { hash: "a".repeat(64), approvedBy: "op" },
};

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "patron-nakladka-")); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); delete process.env.PATRON_MCP_OPERATOR_CONFIG; });
const zapisz = (n: string, v: unknown) => { const p = path.join(dir, n); fs.writeFileSync(p, JSON.stringify(v)); return p; };

describe("mergeOperatorOverlay", () => {
    it("konektor z instalatora: z nakladki tylko enabled i gatewayApproval", () => {
        const { configs, warnings } = mergeOperatorOverlay([SAOS], [
            { name: "saos", enabled: false, command: "C:/zly.exe", args: ["x"], gatewayApproval: { hash: "b".repeat(64) } },
        ]);
        expect(configs).toHaveLength(1);
        expect(configs[0].enabled).toBe(false);
        expect(configs[0].command).toBe("node");
        expect(configs[0].args).toEqual(SAOS.args);
        expect(configs[0].gatewayApproval?.hash).toBe("b".repeat(64));
        expect(warnings.join(" ")).toMatch(/saos.*zignorowano pola command, args/);
    });

    it("konektor spoza instalatora: caly wpis, po konektorach instalatora", () => {
        const { configs } = mergeOperatorOverlay([SAOS, ISAP], [WERYFIKATOR]);
        expect(configs.map((c) => c.name)).toEqual(["saos", "isap", "repertorium"]);
        expect(configs[2]).toMatchObject({ operatorApproved: true, url: WERYFIKATOR.url });
    });

    it("wpis bez nazwy, bez transportu albo powtorzony - pominiety z ostrzezeniem", () => {
        const { configs, warnings } = mergeOperatorOverlay([SAOS], [
            { enabled: false }, { name: "nowy" }, WERYFIKATOR, { ...WERYFIKATOR, url: "https://inny.invalid" },
        ]);
        expect(configs.map((c) => c.name)).toEqual(["saos", "repertorium"]);
        expect(configs[1].url).toBe(WERYFIKATOR.url);
        expect(warnings).toHaveLength(3);
    });
});

describe("pochodzenie wpisu: configSource (B-06 / R-MCP-01, ADR-0166)", () => {
    it("wpis instalatora = installer, wpis z nakladki = operator-overlay", () => {
        const { configs } = mergeOperatorOverlay([SAOS], [WERYFIKATOR, { name: "saos", enabled: false }]);
        expect(configs.find((c) => c.name === "saos")?.configSource).toBe("installer");
        expect(configs.find((c) => c.name === "repertorium")?.configSource).toBe("operator-overlay");
    });

    it("pliki nie moga podac pochodzenia - pole configSource w pliku jest nadpisywane", () => {
        const { configs } = mergeOperatorOverlay(
            [{ ...SAOS, configSource: "operator-overlay" }],
            [
                { name: "de-eli", transport: "stdio", command: "C:/obcy.exe", configSource: "installer" },
                { name: "saos", configSource: "operator-overlay" },
            ],
        );
        expect(configs.find((c) => c.name === "saos")?.configSource).toBe("installer");
        expect(configs.find((c) => c.name === "de-eli")?.configSource).toBe("operator-overlay");
    });

    it("edycja lean: nakladka dodaje nazwe z APPROVED z obca komenda -> Ring 2, nie Ring 1", () => {
        const { configs } = mergeOperatorOverlay(
            [{ name: "it-eli", transport: "stdio", command: "py-runtime/python.exe", args: [] }],
            [{ name: "de-eli", transport: "stdio", command: "C:/Users/Public/obcy.exe" }],
        );
        const deEli = configs.find((c) => c.name === "de-eli")!;
        expect(decideRing(deEli.name, deEli)).toMatchObject({ ring: 2, action: "deny" });
        const itEli = configs.find((c) => c.name === "it-eli")!;
        expect(decideRing(itEli.name, itEli)).toMatchObject({ ring: 1, action: "allow" });
    });
});

describe("aktualizacja instalatora nie kasuje ustawien Operatora", () => {
    it("nowy mcp-servers.json z instalatora + stara nakladka = konektor i przelaczniki zostaja", () => {
        const nakladka = zapisz("nakladka.json", [WERYFIKATOR, { name: "isap", enabled: false }]);
        // Przed aktualizacja.
        let instalator = zapisz("mcp-servers.json", [SAOS, ISAP]);
        expect(readMergedConfig(instalator, nakladka).configs.map((c) => c.name)).toContain("repertorium");
        // Aktualizacja: NSIS kasuje katalog instalacji, nowy plik bez ustawien Operatora.
        fs.rmSync(instalator);
        instalator = zapisz("mcp-servers.json", [SAOS, { ...ISAP, args: ["mcp-bundled/isap/dist/v2.js"] }]);
        const po = readMergedConfig(instalator, nakladka).configs;
        expect(po.find((c) => c.name === "repertorium")?.gatewayApproval?.hash).toBe("a".repeat(64));
        const isap = po.find((c) => c.name === "isap")!;
        expect(isap.enabled).toBe(false);
        expect(isap.args).toEqual(["mcp-bundled/isap/dist/v2.js"]);
    });

    it("brak plikow = pusta lista; uszkodzona nakladka nie zabiera konektorow instalatora", () => {
        expect(readMergedConfig(path.join(dir, "brak.json"), path.join(dir, "brak2.json")).configs).toEqual([]);
        const instalator = zapisz("mcp-servers.json", [SAOS]);
        const zla = path.join(dir, "zla.json");
        fs.writeFileSync(zla, "{ to nie json");
        const r = readMergedConfig(instalator, zla);
        expect(r.configs.map((c) => c.name)).toEqual(["saos"]);
        expect(r.warnings.join(" ")).toMatch(/nakladka: blad parsowania/);
    });
});

describe("writeEnabledToOverlay", () => {
    it("upsert po nazwie, inne pola wpisu zostaja", () => {
        const p = zapisz("nakladka.json", [WERYFIKATOR]);
        expect(writeEnabledToOverlay(p, "repertorium", false).ok).toBe(true);
        expect(writeEnabledToOverlay(p, "saos", false).ok).toBe(true);
        const lista = JSON.parse(fs.readFileSync(p, "utf-8"));
        expect(lista[0]).toMatchObject({ ...WERYFIKATOR, enabled: false });
        expect(lista[1]).toEqual({ name: "saos", enabled: false });
    });

    it("tworzy katalog i plik, gdy ich nie ma", () => {
        const p = path.join(dir, "nowy", "nakladka.json");
        expect(writeEnabledToOverlay(p, "saos", true).ok).toBe(true);
        expect(JSON.parse(fs.readFileSync(p, "utf-8"))).toEqual([{ name: "saos", enabled: true }]);
    });

    it("uszkodzonej nakladki nie nadpisuje - moze niesc wpis Operatora", () => {
        const p = path.join(dir, "zla.json");
        fs.writeFileSync(p, "{ uszkodzone");
        expect(writeEnabledToOverlay(p, "saos", false).ok).toBe(false);
        expect(fs.readFileSync(p, "utf-8")).toBe("{ uszkodzone");
    });
});

describe("wpiecie w index.ts (picker i loader)", () => {
    it("picker widzi konektor z nakladki i zapisuje przelacznik DO NAKLADKI, nie do pliku instalatora", () => {
        const nakladka = zapisz("nakladka.json", [{ ...WERYFIKATOR, name: "weryfikator-testowy-0166" }]);
        process.env.PATRON_MCP_OPERATOR_CONFIG = nakladka;
        const plikInstalatora = path.resolve(__dirname, "../../../mcp-servers.json");
        const byl = fs.existsSync(plikInstalatora) ? fs.readFileSync(plikInstalatora, "utf-8") : null;

        expect(listConnectorConfigs().some((c) => c.name === "weryfikator-testowy-0166")).toBe(true);
        expect(setConnectorEnabledInConfig("weryfikator-testowy-0166", false).ok).toBe(true);
        expect(JSON.parse(fs.readFileSync(nakladka, "utf-8"))[0].enabled).toBe(false);
        // Plik instalatora nietkniety (albo nadal nieistniejacy).
        const jest = fs.existsSync(plikInstalatora) ? fs.readFileSync(plikInstalatora, "utf-8") : null;
        expect(jest).toBe(byl);
        expect(setConnectorEnabledInConfig("nie-ma-takiego", true).ok).toBe(false);
    });
});

describe("odpornosc nakladki (przeglad 2026-10-02: R-MCP-03/04/05)", () => {
    const SAOS = { name: "saos", transport: "stdio", command: "node", args: ["x.js"] };
    const wlaczone = (c: { name: string; enabled?: unknown }[]) => c.filter((s) => s.enabled !== false).map((s) => s.name);

    it("nieczytelna nakladka bez kopii: konektory instalatora startuja WYLACZONE, z ostrzezeniem", () => {
        const inst = zapisz("mcp-servers.json", [SAOS]);
        const nak = path.join(dir, "nak.json");
        fs.writeFileSync(nak, '[{"name":"saos","enabled":false},]');
        const r = readMergedConfig(inst, nak);
        expect(wlaczone(r.configs)).toEqual([]);
        expect(r.warnings.join(" ")).toMatch(/WYLACZONE/);
    });

    it("nieczytelna nakladka z kopia zapisana przez picker: stan z kopii", () => {
        const inst = zapisz("mcp-servers.json", [SAOS, { ...SAOS, name: "krs" }]);
        const nak = path.join(dir, "nak.json");
        expect(writeEnabledToOverlay(nak, "saos", false).ok).toBe(true);
        fs.writeFileSync(nak, "{zepsute");
        const r = readMergedConfig(inst, nak);
        expect(wlaczone(r.configs)).toEqual(["krs"]);
        expect(r.warnings.join(" ")).toMatch(/kopii/);
    });

    it("enabled niebedace booleanem jest ignorowane", () => {
        const { configs, warnings } = mergeOperatorOverlay([{ ...SAOS, enabled: false }], [{ name: "saos", enabled: "true" }]);
        expect(wlaczone(configs)).toEqual([]);
        expect(warnings.join(" ")).toMatch(/zly typ/);
    });

    it.skipIf(process.platform === "win32")("zapis pickera tworzy nakladke 0600 i nie poszerza istniejacego trybu", () => {
        const nak = path.join(dir, "nak.json");
        expect(writeEnabledToOverlay(nak, "saos", false).ok).toBe(true);
        expect((fs.statSync(nak).mode & 0o777).toString(8)).toBe("600");
        expect(writeEnabledToOverlay(nak, "saos", true).ok).toBe(true);
        expect((fs.statSync(nak).mode & 0o777).toString(8)).toBe("600");
    });
});
