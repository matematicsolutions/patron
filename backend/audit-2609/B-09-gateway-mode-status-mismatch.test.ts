// B-09: Zmienna MCP_SECURITY_GATEWAY_MODE (off/audit/enforce) jest czytana WYLACZNIE
// przez endpoint statusu (routes/security.ts:31-36). Faktyczny gateway w
// lib/mcp/index.ts:392-475 zawsze blokuje human_review/denied, niezaleznie od
// zmiennej. W domyslnej konfiguracji (desktop nie ustawia zmiennej;
// .env.docker.example:63 ustawia "off") panel admina raportuje "Wylaczony"
// (active=false), choc gateway dziala - a "audit" ("loguje, nie blokuje") nie ma
// zadnego efektu. Raport o stanie kontroli bezpieczenstwa rozjezdza sie z
// zachowaniem w obie strony.
// Oczekiwane: status zwracany operatorowi odpowiada rzeczywistemu zachowaniu
// gatewaya - przy domyslnej konfiguracji (gateway egzekwuje) status mowi
// active=true / mode=enforce.
import { afterEach, describe, expect, it } from "vitest";
import { buildStatusPayload, readGatewayMode } from "../src/routes/security";
import { buildScanContext, scanMcpServer, type McpServerDefinition } from "../src/lib/mcp-security";

const backup = process.env.MCP_SECURITY_GATEWAY_MODE;
afterEach(() => {
    if (backup === undefined) delete process.env.MCP_SECURITY_GATEWAY_MODE;
    else process.env.MCP_SECURITY_GATEWAY_MODE = backup;
});

describe("B-09 tryb gatewaya MCP raportowany vs egzekwowany", () => {
    it("domyslnie (brak zmiennej) status odpowiada faktycznemu egzekwowaniu", () => {
        delete process.env.MCP_SECURITY_GATEWAY_MODE;
        // Kontrola: typosquat 'sa0s' jest przez pipeline ZAWSZE odrzucany (denied) -
        // getMcpTools nie rejestruje takiego konektora, niezaleznie od zmiennej.
        const typo: McpServerDefinition = { name: "sa0s", transport: "stdio", command: "node", tools: [] };
        expect(scanMcpServer(typo, buildScanContext(new Map())).action).toBe("denied");
        const status = buildStatusPayload(readGatewayMode(), { audit: 0, human_review: 0, denied: 0 });
        expect(status.gateway, "banner mowi 'wylaczony', gateway blokuje").toMatchObject({ active: true, mode: "enforce" });
    });
});
