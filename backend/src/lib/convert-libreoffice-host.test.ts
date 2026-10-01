// Lista kandydatow dla win32 NIE MOZE zalezec od systemu, na ktorym ja liczymy.
//
// Zmierzone 2026-10-01: `sofficeCandidates("win32")` skladala sciezki modulem `path`
// gospodarza. Na Windowsie wszystko sie zgadzalo, a na Linuksie (CI) `path.isAbsolute`
// odrzucal kazda sciezke `C:/...` - lustro z `convert-libreoffice.test.ts` i furtka
// `LIBRE_OFFICE_EXE` padaly tylko w CI, nigdy na maszynie autora. Ten test podmienia
// `path` na wersje POSIX, wiec odtwarza CI na dowolnym systemie.
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("path", async () => {
    const real = await vi.importActual<typeof import("node:path")>("node:path");
    return { default: real.posix, ...real.posix };
});

describe("sofficeCandidates('win32') liczone na gospodarzu POSIX", () => {
    it("zna stala sciezke Program Files i honoruje LIBRE_OFFICE_EXE", async () => {
        const { sofficeCandidates } = await import("./convert");
        const stara = process.env.LIBRE_OFFICE_EXE;
        try {
            process.env.LIBRE_OFFICE_EXE = "X:/wlasna/sciezka/soffice.exe";
            const lista = sofficeCandidates("win32");
            expect(lista).toContain("C:/Program Files/LibreOffice/program/soffice.exe");
            expect(lista).toContain("X:/wlasna/sciezka/soffice.exe");
        } finally {
            if (stara === undefined) delete process.env.LIBRE_OFFICE_EXE;
            else process.env.LIBRE_OFFICE_EXE = stara;
        }
    });

    it("pusta zmienna srodowiskowa nadal nie daje sciezki wzglednej", async () => {
        const { sofficeCandidates } = await import("./convert");
        const stara = process.env.PROGRAMFILES;
        try {
            delete process.env.PROGRAMFILES;
            for (const p of sofficeCandidates("win32")) {
                expect(path.win32.isAbsolute(p), p).toBe(true);
            }
        } finally {
            if (stara !== undefined) process.env.PROGRAMFILES = stara;
        }
    });
});
