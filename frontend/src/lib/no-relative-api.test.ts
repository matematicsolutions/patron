// Bramka na regresje, ktora raz juz uciszyla trzy powierzchnie zgodnosciowe.
//
// Zmierzone 2026-08-21 na uruchomionym stacku: useEgressConfig,
// useMcpSecurityStatus i usePackUpdates wolaly sciezki WZGLEDNE. Frontend stoi
// na 3000, backend na 3001, proxy nie ma - wiec kazdy z tych fetchy dostawal 404
// z originu frontendu, hook zwracal null, a baner nie renderowal sie w ogole.
// EgressConfigBanner (ADR-0101), McpSecurityBanner (ADR-0025/0028) i
// PackUpdateBanner (ADR-0140) byly martwe w spakowanej aplikacji, a brak banera
// czytalo sie jako "wszystko dobrze".
//
// Reguly bez bramki nie trzymaja, wiec tu jest bramka: zaden hook nie moze
// wolac backendu sciezka wzgledna. Test czyta ZRODLA, nie zachowanie - bo to
// wlasnie warstwa, na ktorej blad powstal.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const HOOKS_DIR = join(__dirname, "..", "hooks");

/** Literal stringowy zaczynajacy sie od "/api/" - czyli adres bez hosta. */
const RELATIVE_API = /["'`]\/api\//;

function hookFiles(): string[] {
    return readdirSync(HOOKS_DIR).filter(
        (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
    );
}

describe("hooki nie wolaja backendu sciezka wzgledna", () => {
    it("znajduje pliki hookow (kontrola pozytywna - inaczej test przechodzi pusty)", () => {
        expect(hookFiles().length).toBeGreaterThan(0);
    });

    for (const file of hookFiles()) {
        it(`${file} uzywa apiUrl(), nie "/api/..."`, () => {
            const src = readFileSync(join(HOOKS_DIR, file), "utf8");
            const offending = src
                .split("\n")
                .map((line, i) => ({ line: line.trim(), nr: i + 1 }))
                .filter(
                    ({ line }) =>
                        RELATIVE_API.test(line) && !line.startsWith("//"),
                )
                .filter(({ line }) => !line.includes("apiUrl("));

            expect(
                offending,
                `${file}: adres backendu bez hosta trafi na origin frontendu (404). ` +
                    "Uzyj apiUrl() z @/lib/apiBase.",
            ).toEqual([]);
        });
    }
});
