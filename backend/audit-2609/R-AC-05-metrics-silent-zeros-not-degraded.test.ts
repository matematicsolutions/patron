// R-AC-05: /metrics wprowadzil `patron_metrics_degraded` (metrics-render.ts:13-21), zeby
// "zepsuty odczyt" nie wygladal jak "swieza instalacja z zerami". Ten sam handler nadal
// GUBI bledy dwoch z trzech zrodel (routes/metrics.ts:94-121):
//   - `{ count: merkleCount }` i `{ data: lastAnchorRows }` z audit_merkle_roots bez `error`,
//   - `{ data: mcpRows }` z audit_log (mcp_security.gateway) bez `error`.
// Padniety odczyt daje `patron_merkle_root_count 0`, brak kotwicy i
// `patron_mcp_security_decisions{action="denied"} 0` przy `patron_metrics_degraded 0`,
// czyli dokladnie "cichy sukces", ktory pole `degraded` mialo zamknac. Alert na
// odmowy bramki MCP albo brak kotwicy Merkle nie ma na czym zadzialac.
// Oczekiwane: blad ktoregokolwiek zrodla => degraded = 1.
import { describe, expect, it, vi } from "vitest";

process.env.PATRON_DB_BACKEND = "supabase";
process.env.METRICS_ALLOWED_IPS = "127.0.0.1";

type Res = { data?: unknown; count?: number | null; error: unknown };

function fakeClient() {
    const boom = { message: "canceling statement due to statement timeout", code: "57014" };
    return {
        from(table: string) {
            let cols = "";
            const filters: Record<string, unknown> = {};
            const result = (): Res => {
                if (table === "audit_log" && cols === "id") return { count: 2, error: null }; // liczniki per typ: OK
                if (table === "audit_merkle_roots") return { data: null, count: null, error: boom };
                if (table === "audit_log" && cols === "payload") return { data: null, error: boom };
                return { data: [], error: null };
            };
            const b: any = {
                select(c: string) { cols = c; return b; },
                eq(k: string, v: unknown) { filters[k] = v; return b; },
                order() { return b; },
                limit() { return b; },
                then(ok: (r: Res) => unknown, err?: (e: unknown) => unknown) {
                    return Promise.resolve(result()).then(ok, err);
                },
            };
            return b;
        },
    };
}

vi.mock("../src/lib/supabase", () => ({
    isSqliteBackend: () => false,
    createServerSupabase: () => fakeClient(),
}));
vi.mock("../src/lib/audit-admin-access", () => ({ recordAdminAccess: async () => ({ ok: true }) }));

describe("R-AC-05 /metrics a bledy odczytu Merkle i bramki MCP", () => {
    it("padniety odczyt audit_merkle_roots / mcp_security.gateway daje patron_metrics_degraded 1", async () => {
        const { metricsRouter } = await import("../src/routes/metrics");
        const layer = (metricsRouter as any).stack[0].route.stack;
        const handler = layer[layer.length - 1].handle;
        let body = "";
        let status = 0;
        const res: any = {
            setHeader() {},
            status(s: number) { status = s; return res; },
            send(b: string) { body = b; return res; },
            json(b: unknown) { body = JSON.stringify(b); return res; },
        };
        await handler({ ip: "127.0.0.1", method: "GET", originalUrl: "/metrics", socket: {} }, res);
        expect(status).toBe(200);
        const linia = body.split("\n").find((l) => l.startsWith("patron_metrics_degraded"));
        const kontekst = body
            .split("\n")
            .filter((l) => /^patron_(merkle_root_count|mcp_security)/.test(l))
            .join(" | ");
        expect(linia, `przy padnietych odczytach: ${kontekst}`).toBe("patron_metrics_degraded 1");
    });
});
