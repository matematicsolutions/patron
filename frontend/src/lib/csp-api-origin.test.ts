// A-21 (2026-10-06): CSP egzekwowana. Front (:3000) i API (:3001) to rozne originy,
// wiec `connect-src 'self'` sam odcialby backend - przed wymuszeniem polityki
// weryfikacja desktop zmierzyla, ze kazde wywolanie API idzie na inny origin.
// Ten test pilnuje, zeby origin API byl w connect-src tej samej polityki, ktora
// jest egzekwowana, i zeby img-src nie wpuszczal obcych hostow (A-20).
import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";
import { API_BASE } from "./apiBase";

async function politykaEgzekwowana(): Promise<Map<string, string>> {
    const rules = (await nextConfig.headers?.()) ?? [];
    const all = rules.find((r) => r.source === "/:path*");
    const csp = all?.headers.find((h) => h.key.toLowerCase() === "content-security-policy");
    expect(csp, "brak egzekwowanej CSP").toBeDefined();
    return new Map(
        csp!.value.split(";").map((d) => {
            const [nazwa, ...wartosci] = d.trim().split(/\s+/);
            return [nazwa, wartosci.join(" ")] as [string, string];
        }),
    );
}

describe("CSP egzekwowana a origin API", () => {
    it("connect-src obejmuje origin API_BASE (inny port = inny origin)", async () => {
        const p = await politykaEgzekwowana();
        const zrodla = (p.get("connect-src") ?? "").split(" ");
        expect(zrodla).toContain("'self'");
        expect(zrodla).toContain(new URL(API_BASE).origin);
    });

    it("img-src bez obcych hostow; frame-ancestors none", async () => {
        const p = await politykaEgzekwowana();
        expect(p.get("img-src")).not.toMatch(/https?:|\*/);
        expect(p.get("frame-ancestors")).toBe("'none'");
    });

    it("nie ma rownolegle polityki Report-Only, ktora sugerowalaby, ze nic nie jest egzekwowane", async () => {
        const rules = (await nextConfig.headers?.()) ?? [];
        const all = rules.find((r) => r.source === "/:path*");
        expect(all?.headers.some((h) => /report-only/i.test(h.key))).toBe(false);
    });
});
