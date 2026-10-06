// B-08 / ADR-0158: zatwierdzenie konektora z panelu konektorow zamiast recznej
// edycji JSON nakladki. Testy logiki procesu (bramki 400/404/409/500), kolejnosci
// audyt -> zapis oraz pelnej drogi: zapis nakladki -> scalanie -> werdykt przy
// starcie -> Ring 2, a po dryfie definicji z powrotem blokada.
import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import {
    computeApprovalHash,
    computeOriginFingerprint,
    resolveOperatorApproval,
    type McpServerDefinition,
} from "../mcp-security";
import { approveConnectorGateway, type GatewayApprovalDeps } from "./gateway-approval";
import type { McpGatewayState } from "./index";
import { mergeOperatorOverlay, writeGatewayApprovalToOverlay } from "./operator-overlay";
import { decideRing } from "./ring-policy";
import { connectorsRouter } from "../../routes/connectors";

const DEF: McpServerDefinition = {
    name: "weryfikator-testowy",
    transport: "http",
    url: "https://example.invalid/mcp",
    tools: [{ name: "verify_citations", description: "Sprawdza powolania.", inputSchema: { type: "object" } }],
};
const HASH = computeApprovalHash(DEF);
const ORIGIN = computeOriginFingerprint(DEF);

const czeka = (over: Partial<McpGatewayState> = {}): McpGatewayState => ({
    gatewayAction: "human_review",
    approval: "missing",
    registered: false,
    unknownThirdPartyOnly: true,
    approvalHash: HASH,
    approvalOrigin: ORIGIN,
    findings: [{ detector: "typosquat", severity: "medium", message: "nieznany konektor spoza zaufanego zestawu" }],
    ...over,
});

function deps(state: McpGatewayState | undefined, over: Partial<GatewayApprovalDeps> = {}) {
    const kolejnosc: string[] = [];
    const d: GatewayApprovalDeps = {
        state: () => state,
        exists: (n) => n === DEF.name,
        audit: vi.fn(async () => { kolejnosc.push("audyt"); return { ok: true }; }),
        write: vi.fn(() => { kolejnosc.push("zapis"); return { ok: true }; }),
        now: () => new Date("2026-10-06T12:00:00Z"),
        ...over,
    };
    return { d, kolejnosc };
}
const AKTOR = { userId: "u-operator", label: "operator@kancelaria.test" };
const OK_BODY = { hash: HASH, origin: ORIGIN };

describe("approveConnectorGateway - bramki procesu", () => {
    it("400 bez hash/origin albo w zlym ksztalcie", async () => {
        const { d } = deps(czeka());
        for (const body of [null, {}, { hash: HASH }, { hash: "abc", origin: ORIGIN }]) {
            const r = await approveConnectorGateway(DEF.name, body, AKTOR, d);
            expect(r.ok ? 200 : r.status).toBe(400);
        }
        expect(d.write).not.toHaveBeenCalled();
    });

    it("404 dla nieznanego konektora", async () => {
        const r = await approveConnectorGateway("nie-ma", OK_BODY, AKTOR, deps(czeka()).d);
        expect(r.ok ? 200 : r.status).toBe(404);
    });

    it("409 gdy konektor nie byl skanowany, gdy `denied`, gdy nic nie czeka", async () => {
        const przypadki: [McpGatewayState | undefined, string][] = [
            [undefined, "not_scanned"],
            [czeka({ gatewayAction: "denied", approval: "not_overridable" }), "not_overridable"],
            [czeka({ registered: true, approval: "approved" }), "not_awaiting"],
            [czeka({ gatewayAction: "audit", approval: "not_needed", registered: true }), "not_awaiting"],
        ];
        for (const [stan, kod] of przypadki) {
            const { d } = deps(stan);
            const r = await approveConnectorGateway(DEF.name, OK_BODY, AKTOR, d);
            expect(r.ok ? "ok" : r.code).toBe(kod);
            expect(d.audit).not.toHaveBeenCalled();
            expect(d.write).not.toHaveBeenCalled();
        }
    });

    it("409 stale_definition, gdy hash albo pochodzenie z ekranu nie zgadza sie z biezacym skanem", async () => {
        for (const body of [{ hash: "0".repeat(64), origin: ORIGIN }, { hash: HASH, origin: "f".repeat(64) }]) {
            const { d } = deps(czeka());
            const r = await approveConnectorGateway(DEF.name, body, AKTOR, d);
            expect(r.ok ? "ok" : r.code).toBe("stale_definition");
            expect(d.write).not.toHaveBeenCalled();
        }
    });

    it("hash_mismatch (zatwierdzona INNA definicja) tez mozna zatwierdzic na nowo", async () => {
        const { d } = deps(czeka({ approval: "hash_mismatch" }));
        expect((await approveConnectorGateway(DEF.name, OK_BODY, AKTOR, d)).ok).toBe(true);
    });

    it("audyt PRZED zapisem; porazka audytu = brak zapisu (fail-closed)", async () => {
        const ok = deps(czeka());
        const r = await approveConnectorGateway(DEF.name, OK_BODY, AKTOR, ok.d);
        expect(r).toEqual({ ok: true, restartRequired: true, approvedAt: "2026-10-06T12:00:00.000Z" });
        expect(ok.kolejnosc).toEqual(["audyt", "zapis"]);
        expect(ok.d.write).toHaveBeenCalledWith(DEF.name, {
            hash: HASH, origin: ORIGIN, approvedAt: "2026-10-06T12:00:00.000Z", approvedBy: AKTOR.label,
        });
        expect(ok.d.audit).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: "u-operator" }));

        const zlyAudyt = deps(czeka(), { audit: vi.fn(async () => ({ ok: false })) });
        const r2 = await approveConnectorGateway(DEF.name, OK_BODY, AKTOR, zlyAudyt.d);
        expect(r2.ok ? "ok" : r2.code).toBe("audit_failed");
        expect(zlyAudyt.d.write).not.toHaveBeenCalled();
    });

    it("blad zapisu po udanym audycie konczy sie 500 z nazwanym skutkiem, nie sukcesem", async () => {
        const { d } = deps(czeka(), { write: vi.fn(() => ({ ok: false, error: "EACCES" })) });
        const r = await approveConnectorGateway(DEF.name, OK_BODY, AKTOR, d);
        expect(r.ok ? "ok" : r.code).toBe("write_failed");
        expect(r.ok ? "" : r.detail).toMatch(/nadal czeka/);
    });
});

describe("droga do rejestracji: nakladka -> werdykt przy starcie -> Ring 2", () => {
    it("zatwierdzenie z panelu przepuszcza te definicje, a dryf znow blokuje", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw-approval-"));
        const nakladka = path.join(dir, "mcp-servers.operator.json");
        fs.writeFileSync(nakladka, JSON.stringify([{ name: DEF.name, transport: "http", url: DEF.url }]));
        const w = writeGatewayApprovalToOverlay(nakladka, DEF.name, {
            hash: HASH, origin: ORIGIN, approvedAt: "2026-10-06T12:00:00.000Z", approvedBy: AKTOR.label,
        });
        expect(w).toEqual({ ok: true });
        // Kopia .bak powstaje ta sama procedura co przy przelaczniku pickera.
        expect(fs.existsSync(`${nakladka}.bak`)).toBe(true);

        const { configs } = mergeOperatorOverlay([], JSON.parse(fs.readFileSync(nakladka, "utf-8")));
        const cfg = configs.find((c) => c.name === DEF.name)!;
        expect(cfg.url).toBe(DEF.url); // reszta wpisu nietknieta
        const decyzja = resolveOperatorApproval("human_review", DEF, cfg.gatewayApproval);
        expect(decyzja).toMatchObject({ status: "approved", register: true });
        expect(decideRing(cfg.name, { configSource: cfg.configSource }).ring).toBe(2);

        const poDryfie = { ...DEF, tools: [{ ...DEF.tools[0], description: "Sprawdza powolania i wysyla tresc pisma." }] };
        expect(resolveOperatorApproval("human_review", poDryfie, cfg.gatewayApproval).status).toBe("hash_mismatch");
        const innyHost = { ...DEF, url: "https://inny-host.invalid/mcp" };
        expect(resolveOperatorApproval("human_review", innyHost, cfg.gatewayApproval).status).toBe("hash_mismatch");
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it("zapis odmawia zatwierdzenia w zlym ksztalcie i nie nadpisuje uszkodzonej nakladki", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw-approval-"));
        const nakladka = path.join(dir, "mcp-servers.operator.json");
        const zle = writeGatewayApprovalToOverlay(nakladka, DEF.name, {
            hash: "xyz", origin: ORIGIN, approvedAt: "", approvedBy: "",
        });
        expect(zle.ok).toBe(false);
        expect(fs.existsSync(nakladka)).toBe(false);
        fs.writeFileSync(nakladka, "[{ zepsuty json");
        const r = writeGatewayApprovalToOverlay(nakladka, DEF.name, {
            hash: HASH, origin: ORIGIN, approvedAt: "x", approvedBy: "y",
        });
        expect(r.ok).toBe(false);
        expect(fs.readFileSync(nakladka, "utf-8")).toBe("[{ zepsuty json");
        fs.rmSync(dir, { recursive: true, force: true });
    });
});

describe("trasy zatwierdzenia - tylko Operator (Mirrors #13)", () => {
    it("GET /:name/gateway i POST /:name/gateway-approval maja requireAuth + requireAdmin", () => {
        type Warstwa = { route?: { path: string; methods: Record<string, boolean>; stack: { name: string }[] } };
        const trasy = (connectorsRouter.stack as Warstwa[]).filter((l) => l.route);
        const znajdz = (p: string, m: string) =>
            trasy.find((l) => l.route!.path === p && l.route!.methods[m])?.route!.stack.map((s) => s.name);
        for (const [p, m] of [["/:name/gateway", "get"], ["/:name/gateway-approval", "post"]] as const) {
            const stos = znajdz(p, m);
            expect(stos, `${m.toUpperCase()} ${p}`).toBeDefined();
            expect(stos!.slice(0, 2)).toEqual(["requireAuth", "requireAdmin"]);
        }
    });
});
