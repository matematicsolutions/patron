// Tymczasowy identyfikator (przeglad 2026-10-08): unikalny i niezalezny od
// crypto.randomUUID, ktorego nie ma poza bezpiecznym kontekstem (HTTP z adresu w LAN).
import { afterEach, describe, expect, it, vi } from "vitest";
import { nowyTymczasowyId } from "./tempId";

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("nowyTymczasowyId", () => {
    it("1000 kolejnych identyfikatorow jest unikalnych i ma prefiks", () => {
        const ids = Array.from({ length: 1000 }, () => nowyTymczasowyId());
        expect(new Set(ids).size).toBe(1000);
        expect(ids.every((i) => i.startsWith("temp-"))).toBe(true);
    });

    it("dziala bez crypto.randomUUID (kontekst niezabezpieczony)", () => {
        vi.stubGlobal("crypto", {});
        expect(() => nowyTymczasowyId("folder")).not.toThrow();
        expect(nowyTymczasowyId("folder")).toMatch(/^folder-\d+$/);
    });
});
