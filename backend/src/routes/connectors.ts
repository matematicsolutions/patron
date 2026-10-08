// Picker konektorow MCP (ADR-0133) - endpoint REST.
//
//   GET   /connectors            -> { connectors[] }  lista ze stanem + ring + jurysdykcja
//   PATCH /connectors/:name      -> { enabled }        wlacz/wylacz (tylko Ring 1)
//
// Mecenas zmienia TYLKO konektory zaufanego zestawu (Ring 1). Konektory poza
// zestawem (Ring 2 / 3rd-party) sa read-only - 403 (rola Operatora, ADR-0133).
// Kazda zmiana jest audytowana (connector.toggle, AI Act art. 12).
// Zmiana wchodzi w zycie po restarcie (konektory czytane przy starcie) -
// odpowiedz niesie restartRequired=true.

import { Router } from "express";
import { requireAdmin, requireAuth } from "../middleware/auth";
import { getConnectorList, toggleConnector } from "../lib/mcp/connectors";
import { recordConnectorToggleEvent, recordMcpSecurityEvent } from "../lib/mcp/audit-bridge";
import {
    getGatewayState,
    getMcpTools,
    listConnectorConfigs,
    setGatewayApprovalInConfig,
} from "../lib/mcp";
import { przelaczRepertoriumWCzacie } from "../lib/mcp/repertorium";
import { verifierServerName } from "../lib/mcp/verifier";
import {
    approveConnectorGateway,
    awaitingApprovalDetails,
    gatewayApprovalAuditArgs,
} from "../lib/mcp/gateway-approval";

export const connectorsRouter = Router();

/**
 * Stan bramy powstaje przy pierwszym getMcpTools w procesie (spawn + skan).
 * Panel konektorow bywa otwierany przed pierwszym czatem - wtedy skanujemy tu,
 * zeby Operator zatwierdzal hash policzony z ZYWEJ definicji, nie z pliku.
 */
async function stanPoSkanie(name: string) {
    if (!getGatewayState(name)) {
        try {
            await getMcpTools();
        } catch (err) {
            console.warn(`[CONNECTORS] skan bramy przed zatwierdzeniem nie powiodl sie:`, err);
        }
    }
    return getGatewayState(name);
}

// GET /connectors/:name/gateway - zastrzezenia bramy i wartosci do zatwierdzenia
// (B-08). Tylko Operator: ta sama para middleware co inne powierzchnie admina.
connectorsRouter.get("/:name/gateway", requireAuth, requireAdmin, async (req, res) => {
    const { name } = req.params;
    if (!listConnectorConfigs().some((c) => c.name === name))
        return void res.status(404).json({ detail: `Konektor "${name}" nie znaleziony.` });
    const details = awaitingApprovalDetails(await stanPoSkanie(name));
    if (!details)
        return void res.status(409).json({
            code: "not_scanned",
            detail: "Konektor nie byl skanowany w tej sesji (wylaczony albo nie wstal).",
        });
    res.json(details);
});

// POST /connectors/:name/gateway-approval  { hash, origin } - zatwierdzenie
// werdyktu `human_review` dla TEJ definicji i TEGO pochodzenia (ADR-0158).
connectorsRouter.post("/:name/gateway-approval", requireAuth, requireAdmin, async (req, res) => {
    const { name } = req.params;
    await stanPoSkanie(name);
    const userId = (res.locals.userId as string | undefined) ?? null;
    const label = (res.locals.userEmail as string | undefined) ?? userId ?? "operator";
    const wynik = await approveConnectorGateway(name, req.body, { userId, label }, {
        state: getGatewayState,
        exists: (n) => listConnectorConfigs().some((c) => c.name === n),
        write: setGatewayApprovalInConfig,
        // Ksztalt wpisu w JEDNYM miejscu (gateway-approval.ts) - z ocena ryzyka ze
        // skanu i korekta write_failed, gdy nakladka nie przyjmie zapisu.
        audit: (wpis) => recordMcpSecurityEvent(gatewayApprovalAuditArgs(wpis)),
    });
    if (!wynik.ok) return void res.status(wynik.status).json({ code: wynik.code, detail: wynik.detail });
    res.json(wynik);
});

// GET /connectors
// POST /connectors/repertorium/chat  { enabled: boolean } - ADR-0167, edycja PL.
// Tylko Operator: wlaczenie pobiera klucz instalacji z Repertorium i wpuszcza do
// czatu narzedzia odczytu. Odpowiedz nie niesie klucza ani adresu konektora.
connectorsRouter.post("/repertorium/chat", requireAuth, requireAdmin, async (req, res) => {
    const { enabled } = (req.body ?? {}) as { enabled?: unknown };
    if (typeof enabled !== "boolean") {
        return void res.status(400).json({ detail: "Pole 'enabled' (boolean) jest wymagane." });
    }
    const wynik = await przelaczRepertoriumWCzacie(enabled);
    if (!wynik.ok) {
        if (wynik.retryAfterS !== undefined) res.setHeader("Retry-After", String(wynik.retryAfterS));
        return void res.status(wynik.status).json({
            detail: wynik.detail,
            ...(wynik.powod ? { reason: wynik.powod } : {}),
        });
    }
    // Audyt zmiany powierzchni narzedzi czatu (AI Act art. 12) - ten sam typ
    // zdarzenia co przelacznik pickera; wyslij-i-zapomnij, bez klucza w payloadzie.
    void recordConnectorToggleEvent({
        serverName: verifierServerName(),
        enabled: wynik.enabled,
        ring: 2,
    }).catch((err) => {
        console.warn(`[CONNECTOR-TOGGLE] audit bridge failed for Repertorium:`, err);
    });
    res.json({ enabled: wynik.enabled, keyIssued: wynik.kluczWydany, restartRequired: true });
});

connectorsRouter.get("/", requireAuth, (_req, res) => {
    try {
        res.json({ connectors: getConnectorList() });
    } catch (e) {
        res.status(500).json({
            detail: `Nie udalo sie wczytac konektorow: ${String(e)}`,
        });
    }
});

// PATCH /connectors/:name  { enabled: boolean }
connectorsRouter.patch("/:name", requireAuth, (req, res) => {
    const { name } = req.params;
    const { enabled } = req.body as { enabled?: boolean };
    if (typeof enabled !== "boolean") {
        return void res
            .status(400)
            .json({ detail: "Pole 'enabled' (boolean) jest wymagane." });
    }

    const result = toggleConnector(name, enabled);
    if (!result.ok) {
        return void res.status(result.status).json({ detail: result.error });
    }

    // Audyt zmiany (AI Act art. 12) - wyslij-i-zapomnij, nie blokuje odpowiedzi.
    void recordConnectorToggleEvent({
        serverName: name,
        enabled,
        ring: result.connector.ring,
    }).catch((err) => {
        console.warn(`[CONNECTOR-TOGGLE] audit bridge failed for "${name}":`, err);
    });

    res.json({ connector: result.connector, restartRequired: true });
});
