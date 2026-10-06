// R-MCP-05: Zapis pickera (tmp + rename) zamienia nakladke 0600 na plik 0644.
//
// Nakladka niesie adres konektora 3rd-party z kluczem dostepu (citation-check/
// connector.ts:12, ADR-0157/0166). writeEnabledToOverlay (operator-overlay.ts:146-150)
// tworzy NOWY plik `.tmp` z domyslnym trybem (0666 & umask) i podmienia nim
// oryginal - prawa nadane przez Operatora (chmod 600) przepadaja przy kazdym
// przelaczeniu konektora w pickerze. Dotyczy trybu serwerowego / Linux (wielu
// uzytkownikow systemu); na Windows decyduja ACL katalogu domowego.
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeEnabledToOverlay } from "../src/lib/mcp/operator-overlay";

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "r-mcp-05-")); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe.skipIf(process.platform === "win32")("R-MCP-05 prawa pliku nakladki", () => {
    it("przelaczenie w pickerze zachowuje prawa 0600 nakladki z kluczem", () => {
        const p = path.join(dir, "mcp-servers.operator.json");
        fs.writeFileSync(p, JSON.stringify([
            { name: "repertorium", transport: "http", url: "https://example.invalid/mcp/KLUCZ-SYNTETYCZNY" },
        ]));
        fs.chmodSync(p, 0o600);
        expect(writeEnabledToOverlay(p, "saos", false).ok).toBe(true);
        expect((fs.statSync(p).mode & 0o777).toString(8)).toBe("600");
    });
});
