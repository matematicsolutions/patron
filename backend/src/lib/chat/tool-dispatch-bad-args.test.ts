// Argumenty narzedzia od modelu: zly JSON nie moze po cichu stac sie pustym obiektem.
// Dotad `JSON.parse` w try/catch zostawial `{}` i narzedzie ruszalo na wartosciach domyslnych,
// a model dostawal komunikat o brakujacych polach zamiast o swoim bledzie.

import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "patron-bad-args-"));
process.env.PATRON_BRAIN_DIR = path.join(TMP, "brain");
const approvalBefore = process.env.PATRON_MUTATION_APPROVAL;
process.env.PATRON_MUTATION_APPROVAL = "false";

import { parseToolArguments, runToolCalls } from "./tool-dispatch";

let licznik = 0;
beforeEach(() => {
    process.env.PATRON_BRAIN_DIR = path.join(TMP, `brain-${++licznik}`);
});

afterAll(() => {
    fs.rmSync(TMP, { recursive: true, force: true });
    if (approvalBefore === undefined) delete process.env.PATRON_MUTATION_APPROVAL;
    else process.env.PATRON_MUTATION_APPROVAL = approvalBefore;
});

const db = {} as Parameters<typeof runToolCalls>[3];

async function partia(wywolania: { id: string; name: string; surowe: string }[]) {
    const out = await runToolCalls(
        wywolania.map((w) => ({ id: w.id, function: { name: w.name, arguments: w.surowe } })),
        new Map(), "u1", db, () => {}, undefined, undefined, {}, new Map(), null,
    );
    return out.toolResults as { tool_call_id: string; content: string }[];
}

const wywolaj = (name: string, surowe: string) => partia([{ id: `${name}-1`, name, surowe }]);

function zapisaneWpisy(): string[] {
    const katalog = process.env.PATRON_BRAIN_DIR as string;
    if (!fs.existsSync(katalog)) return [];
    return fs
        .readdirSync(katalog, { recursive: true })
        .map(String)
        .filter((p) => p.endsWith(".md") && !p.endsWith("INDEX.md"));
}

describe("parseToolArguments", () => {
    it("oddaje obiekt", () => {
        expect(parseToolArguments('{"a":1}')).toEqual({ ok: true, args: { a: 1 } });
    });
    it("pusty ciag to brak argumentow, jak dotad", () => {
        expect(parseToolArguments("")).toEqual({ ok: true, args: {} });
    });
    it.each(['{"a":', "nie json", "[1,2]", "null", "3", '"tekst"', "   "])("odrzuca %j", (surowe) => {
        expect(parseToolArguments(surowe).ok).toBe(false);
    });
    it("komunikat nie cytuje tresci argumentow (bywaja w nich dane sprawy)", () => {
        const w = parseToolArguments('{"pesel":"90010112345"');
        expect(w.ok).toBe(false);
        expect(JSON.stringify(w)).not.toContain("90010112345");
    });
});

describe("runToolCalls przy zlym JSON", () => {
    it("model dostaje blad JSON, nie komunikat o brakujacych polach", async () => {
        const wynik = await wywolaj("remember", '{"title":"T","body":');
        expect(wynik).toHaveLength(1);
        expect(wynik[0].tool_call_id).toBe("remember-1");
        expect(wynik[0].content).toMatch(/nieprawidlowy JSON/);
        expect(wynik[0].content).not.toMatch(/wymagane/);
    });

    it("kontrola pozytywna: poprawny remember zapisuje wpis w tym katalogu", async () => {
        await wywolaj("remember", '{"title":"Dobry","body":"tresc"}');
        expect(zapisaneWpisy()).toHaveLength(1);
    });

    it("zly JSON nie zapisuje niczego", async () => {
        await wywolaj("remember", '{"title":"Zatruty","body":"x"');
        expect(zapisaneWpisy()).toHaveLength(0);
    });

    it("mieszana partia: kazde wywolanie ma wynik, a dobre sie wykonuje", async () => {
        const wynik = await partia([
            { id: "zly", name: "remember", surowe: '{"title":"Zly"' },
            { id: "dobry", name: "remember", surowe: '{"title":"Dobry","body":"tresc"}' },
        ]);
        expect(wynik.map((w) => w.tool_call_id).sort()).toEqual(["dobry", "zly"]);
        expect(wynik.find((w) => w.tool_call_id === "zly")?.content).toMatch(/nieprawidlowy JSON/);
        expect(wynik.find((w) => w.tool_call_id === "dobry")?.content).not.toMatch(/nieprawidlowy JSON/);
        expect(zapisaneWpisy()).toHaveLength(1);
    });

    it("kontrola: pusty ciag dalej trafia do narzedzia", async () => {
        const wynik = await wywolaj("remember", "");
        expect(wynik[0].content).toMatch(/wymagane/);
    });
});
