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
import { requireAuth } from "../middleware/auth";
import { getConnectorList, toggleConnector } from "../lib/mcp/connectors";
import { recordConnectorToggleEvent } from "../lib/mcp/audit-bridge";

export const connectorsRouter = Router();

// GET /connectors
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
