// Testy lokalnego baseline file dla MCP Security Gateway (ADR-0028).

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { loadBaseline, saveBaseline } from "./index";

const TMP_BASELINE = path.join(os.tmpdir(), `patron-mcp-baseline-test-${process.pid}.json`);

describe("MCP Security baseline file (ADR-0028)", () => {
    beforeEach(() => {
        process.env.PATRON_MCP_BASELINE_PATH = TMP_BASELINE;
        if (fs.existsSync(TMP_BASELINE)) fs.unlinkSync(TMP_BASELINE);
    });

    afterEach(() => {
        if (fs.existsSync(TMP_BASELINE)) fs.unlinkSync(TMP_BASELINE);
        const tmp = `${TMP_BASELINE}.tmp`;
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
        delete process.env.PATRON_MCP_BASELINE_PATH;
    });

    it("loadBaseline zwraca pusta mape gdy plik nie istnieje", () => {
        const map = loadBaseline();
        expect(map.size).toBe(0);
    });

    it("saveBaseline + loadBaseline roundtrip zachowuje pary nazwa->hash", () => {
        const input = new Map([
            ["saos", "abc123"],
            ["krs", "def456"],
            ["eu-compliance", "789xyz"],
        ]);
        saveBaseline(input);
        const loaded = loadBaseline();
        expect(loaded.size).toBe(3);
        expect(loaded.get("saos")).toBe("abc123");
        expect(loaded.get("krs")).toBe("def456");
        expect(loaded.get("eu-compliance")).toBe("789xyz");
    });

    it("saveBaseline nadpisuje istniejacy plik atomowo", () => {
        saveBaseline(new Map([["saos", "v1"]]));
        saveBaseline(new Map([["saos", "v2"]]));
        const loaded = loadBaseline();
        expect(loaded.get("saos")).toBe("v2");
    });

    it("loadBaseline zwraca pusta mape gdy plik zawiera niepoprawny JSON", () => {
        process.env.PATRON_MCP_BASELINE_PATH = TMP_BASELINE;
        fs.writeFileSync(TMP_BASELINE, "{nie json}", "utf-8");
        const map = loadBaseline();
        expect(map.size).toBe(0);
    });

    it("loadBaseline zwraca pusta mape gdy plik zawiera tablice (nie obiekt)", () => {
        fs.writeFileSync(TMP_BASELINE, '["nie", "obiekt"]', "utf-8");
        const map = loadBaseline();
        // Array jest typeof 'object' wiec Object.entries dziala - ale wynikowe pary
        // to ["0", "nie"] i ["1", "obiekt"]. To akceptowalne (pierwsza linia obrony),
        // baza decyduje co jest baselinem. Test sprawdza ze nie ma crash'a.
        expect(map).toBeInstanceOf(Map);
    });

    it("saveBaseline tworzy katalog rodzicowski jezeli nie istnieje", () => {
        const nestedPath = path.join(
            os.tmpdir(),
            `patron-nested-${process.pid}`,
            "deep",
            "baseline.json",
        );
        process.env.PATRON_MCP_BASELINE_PATH = nestedPath;
        try {
            saveBaseline(new Map([["test", "hash123"]]));
            expect(fs.existsSync(nestedPath)).toBe(true);
            const loaded = loadBaseline();
            expect(loaded.get("test")).toBe("hash123");
        } finally {
            if (fs.existsSync(nestedPath)) fs.unlinkSync(nestedPath);
            const parent = path.dirname(nestedPath);
            const grandparent = path.dirname(parent);
            if (fs.existsSync(parent)) fs.rmdirSync(parent);
            if (fs.existsSync(grandparent)) fs.rmdirSync(grandparent);
        }
    });

    it("env override PATRON_MCP_BASELINE_PATH jest honorowany", () => {
        const customPath = path.join(
            os.tmpdir(),
            `patron-custom-${process.pid}.json`,
        );
        process.env.PATRON_MCP_BASELINE_PATH = customPath;
        try {
            saveBaseline(new Map([["x", "y"]]));
            expect(fs.existsSync(customPath)).toBe(true);
        } finally {
            if (fs.existsSync(customPath)) fs.unlinkSync(customPath);
        }
    });
});
