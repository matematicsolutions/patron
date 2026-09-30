// Test dryfu kopii ekstraktora (ADR-0157).
//
// `cytaty_pl.ts` ma JEDEN dom - repozytorium Repertorium. PATRON trzyma kopie 1:1,
// bo wyciaga cytaty lokalnie; dwie kopie jednego kodu rozjezdzaja sie po cichu.
// Dwa poziomy:
//   1. ZAWSZE: sha256 kopii == przypiety `cytaty_pl.sha256` (skopiowany z
//      `narzedzia/cytaty_pl.sha256` Repertorium razem z plikiem). Edycja kopii
//      w PATRONIE bez aktualizacji w domu = czerwien.
//   2. GDY repozytorium Repertorium jest obok (REPERTORIUM_DIR albo katalog
//      rodzenstwa): przypiety sha == biezacy sha domu. Repertorium jest
//      prywatne, wiec w CI tego poziomu nie ma - i test mowi to glosno (skip
//      z powodem), zamiast udawac, ze sprawdzil.
//
// SHA z tresci o koncach linii LF (CRLF -> LF) - jak `narzedzia/sha_cytatow.py`:
// na Windows z autocrlf ten sam plik lezy raz z CRLF, raz z LF.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const TU = __dirname;

function shaLf(path: string): string {
    const bajty = readFileSync(path);
    const lf = Buffer.from(bajty.toString("latin1").replace(/\r\n/g, "\n"), "latin1");
    return createHash("sha256").update(lf).digest("hex");
}

function przypiety(path: string): string {
    const m = /^([0-9a-f]{64})\s/.exec(readFileSync(path, "utf8"));
    if (!m) throw new Error(`brak sha256 w ${path}`);
    return m[1];
}

// Repozytorium Repertorium szukamy jako RODZENSTWA ktoregos z katalogow nad
// tym plikiem - checkout PATRONA bywa glowny albo worktree o kilka pieter nizej.
const NAZWY_DOMU = ["repertorium", "repertorium-weryfikacja"];

function domRepertorium(): string | null {
    const env = process.env.REPERTORIUM_DIR;
    if (env && existsSync(join(env, "narzedzia", "cytaty_pl.sha256"))) return env;
    let dir = TU;
    for (let i = 0; i < 10; i++) {
        const wyzej = dirname(dir);
        if (wyzej === dir) break;
        dir = wyzej;
        for (const n of NAZWY_DOMU) {
            const k = join(dir, n);
            if (existsSync(join(k, "narzedzia", "cytaty_pl.sha256"))) return k;
        }
    }
    return null;
}

describe("cytaty_pl.ts - kopia ekstraktora Repertorium", () => {
    it("sha256 kopii zgadza sie z przypietym (kopia nie byla edytowana w PATRONIE)", () => {
        expect(shaLf(join(TU, "cytaty_pl.ts"))).toBe(przypiety(join(TU, "cytaty_pl.sha256")));
    });

    it("kopia jest bez zaleznosci (warunek uruchomienia lokalnie)", () => {
        const src = readFileSync(join(TU, "cytaty_pl.ts"), "utf8");
        expect(src).not.toMatch(/^\s*import\b/m);
        expect(src).not.toMatch(/\brequire\s*\(/);
    });

    const dom = domRepertorium();
    it.skipIf(!dom)(
        `przypiety sha == biezacy sha w domu (Repertorium ${dom ? "znalezione" : "NIEDOSTEPNE - poziom 2 pominiety; ustaw REPERTORIUM_DIR"})`,
        () => {
            expect(przypiety(join(TU, "cytaty_pl.sha256"))).toBe(
                przypiety(join(dom!, "narzedzia", "cytaty_pl.sha256")),
            );
        },
    );
});
