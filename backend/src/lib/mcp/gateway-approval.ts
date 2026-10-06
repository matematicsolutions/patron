// Zatwierdzenie konektora przez Operatora z panelu konektorow (B-08 / ADR-0158).
//
// Do 2026-10-06 jedyna sciezka zatwierdzenia werdyktu `human_review` byla reczna
// edycja JSON nakladki (hash z dziennika startu). Po B-08 kazdy nowy konektor
// spoza zaufanego zestawu czeka na Operatora, wiec bez przycisku kancelaria po
// aktualizacji tracila konektor bez wykonalnej drogi powrotu.
//
// Zasady (te same co przy recznym wpisie, plus dwie bramki procesu):
//   - zatwierdzic mozna TYLKO konektor, ktory w biezacym procesie czeka na
//     Operatora (`human_review` bez zgodnego zatwierdzenia); `denied` nigdy;
//   - klient odsyla hash definicji i odcisk pochodzenia, ktore widzial - musza
//     byc rowne biezacemu skanowi; inaczej 409 (definicja zmienila sie miedzy
//     wyswietleniem a kliknieciem, Operator przeglada ja jeszcze raz);
//   - decyzja trafia do lancucha audytu PRZED zapisem nakladki (fail-closed):
//     brak sladu = brak zatwierdzenia;
//   - zatwierdzenie dotyczy tej jednej definicji i tego pochodzenia - kazdy
//     pozniejszy dryf znow blokuje (resolveOperatorApproval przy starcie).
// Zatwierdzenie wchodzi w zycie po restarcie, jak przelacznik pickera.

import type { McpGatewayState } from "./index";
import type { RecordMcpSecurityEventArgs } from "./audit-bridge";

/**
 * Wpis audytu decyzji Operatora z panelu (mcp_security.gateway). Jedno miejsce
 * budowy, zeby trasa i testy mowily o tym samym ksztalcie dowodu.
 */
export function gatewayApprovalAuditArgs(entry: GatewayApprovalAuditEntry): RecordMcpSecurityEventArgs {
    const { serverName, state, approvedAt, approvedBy, actorUserId } = entry;
    return {
        serverName,
        action: state.gatewayAction,
        // Ta sama ocena co w zdarzeniu startowym - dowod ma byc scisly, nie 0.
        riskScore: state.riskScore,
        findings: state.findings,
        operatorApproval: {
            status: entry.status ?? "approved",
            gatewayAction: state.gatewayAction,
            approvalHash: state.approvalHash,
            approvalOrigin: state.approvalOrigin,
            approvedAt,
            approvedBy,
            source: "operator_ui",
        },
        actorUserId,
    };
}

export interface GatewayApprovalAuditEntry {
    serverName: string;
    state: McpGatewayState;
    approvedAt: string;
    approvedBy: string;
    actorUserId: string | null;
    /**
     * "approved" (domyslnie) albo "write_failed": decyzja zapisana w dzienniku,
     * ale nakladka nie przyjela zapisu - drugi wpis, zeby dziennik nie pokazywal
     * zatwierdzenia, ktore nie weszlo w zycie.
     */
    status?: "approved" | "write_failed";
}

export interface GatewayApprovalRequest {
    hash: string;
    origin: string;
}

export interface GatewayApprovalDeps {
    /** Stan bramy z ostatniego skanu w tym procesie (getGatewayState). */
    state: (name: string) => McpGatewayState | undefined;
    /** Czy konektor istnieje w konfiguracji (instalator + nakladka). */
    exists: (name: string) => boolean;
    /** Zapis do nakladki (setGatewayApprovalInConfig). */
    write: (
        name: string,
        approval: { hash: string; origin: string; approvedAt: string; approvedBy: string },
    ) => { ok: boolean; error?: string };
    /** Slad w lancuchu audytu (recordMcpSecurityEvent). */
    audit: (entry: GatewayApprovalAuditEntry) => Promise<{ ok: boolean }>;
    now?: () => Date;
}

export type GatewayApprovalResult =
    | { ok: true; restartRequired: true; approvedAt: string }
    | { ok: false; status: 400 | 404 | 409 | 500; code: string; detail: string };

const HEX64 = /^[0-9a-f]{64}$/;

export function awaitingApprovalDetails(state: McpGatewayState | undefined) {
    if (!state) return null;
    return {
        gatewayAction: state.gatewayAction,
        approval: state.approval,
        unknownThirdPartyOnly: state.unknownThirdPartyOnly,
        hash: state.approvalHash,
        origin: state.approvalOrigin,
        findings: state.findings,
    };
}

export async function approveConnectorGateway(
    name: string,
    body: unknown,
    actor: { userId: string | null; label: string },
    deps: GatewayApprovalDeps,
): Promise<GatewayApprovalResult> {
    const req = body as Partial<GatewayApprovalRequest> | null;
    if (!req || typeof req.hash !== "string" || typeof req.origin !== "string"
        || !HEX64.test(req.hash) || !HEX64.test(req.origin)) {
        return { ok: false, status: 400, code: "bad_request",
            detail: "Wymagane pola hash i origin (64 znaki hex) z biezacego skanu bramy." };
    }
    if (!deps.exists(name))
        return { ok: false, status: 404, code: "not_found", detail: `Konektor "${name}" nie znaleziony.` };
    const state = deps.state(name);
    if (!state)
        return { ok: false, status: 409, code: "not_scanned",
            detail: "Konektor nie byl skanowany w tej sesji (wylaczony albo nie wstal) - nie ma czego zatwierdzic." };
    if (state.gatewayAction === "denied")
        return { ok: false, status: 409, code: "not_overridable",
            detail: "Bramka odrzucila ten konektor (poziom krytyczny) - tego werdyktu nie da sie zatwierdzic." };
    const czeka = !state.registered && state.gatewayAction === "human_review"
        && (state.approval === "missing" || state.approval === "hash_mismatch");
    if (!czeka)
        return { ok: false, status: 409, code: "not_awaiting",
            detail: "Konektor nie czeka na zatwierdzenie Operatora." };
    if (req.hash !== state.approvalHash || req.origin !== state.approvalOrigin)
        return { ok: false, status: 409, code: "stale_definition",
            detail: "Definicja albo pochodzenie konektora zmienily sie od wyswietlenia - przejrzyj zastrzezenia jeszcze raz." };

    const approvedAt = (deps.now ?? (() => new Date()))().toISOString();
    const wpis = { serverName: name, state, approvedAt, approvedBy: actor.label, actorUserId: actor.userId };
    const audyt = await deps.audit(wpis);
    if (!audyt.ok)
        return { ok: false, status: 500, code: "audit_failed",
            detail: "Nie udalo sie zapisac decyzji w dzienniku audytu - zatwierdzenie NIE zostalo zapisane." };
    const w = deps.write(name, { hash: state.approvalHash, origin: state.approvalOrigin, approvedAt, approvedBy: actor.label });
    if (!w.ok) {
        // Dziennik ma juz "approved" - dopisujemy, ze nie weszlo w zycie.
        const korekta = await deps.audit({ ...wpis, status: "write_failed" }).catch(() => ({ ok: false }));
        return { ok: false, status: 500, code: "write_failed",
            detail: `Decyzja jest w dzienniku audytu, ale zapis nakladki sie nie udal: ${w.error ?? "blad zapisu"}. Konektor nadal czeka.` +
                (korekta.ok ? " Dziennik odnotowal, ze zatwierdzenie nie weszlo w zycie." : " UWAGA: nie udalo sie tez dopisac korekty do dziennika.") };
    }
    return { ok: true, restartRequired: true, approvedAt };
}
