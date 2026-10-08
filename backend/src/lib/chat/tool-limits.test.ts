// Przeglad 2026-10-08 (wzorce z cudzego serwera MCP):
//  P1 "limit wierszy != limit danych" - argumenty liczby wynikow i kontekstu podaje
//     MODEL; bez sufitu jedno wywolanie wciagalo cale akta w wynik narzedzia.
//  P4 "surowy blad do modelu" - komunikat bledu niesie schemat bazy albo sciezke
//     z nazwa uzytkownika; model dostaje biala liste pol, nie komunikat.
// Swieza baza SQLite + prawdziwy indeks (BM25). Dane syntetyczne.

import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "patron-tool-limits-"));
process.env.PATRON_DB_BACKEND = "sqlite";
process.env.PATRON_DB_PATH = path.join(TMP, "patron.db");

const USER = "u_tool_limits";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any;
let dispatch: typeof import("./tool-dispatch");

beforeAll(async () => {
    db = (await import("../supabase")).createServerSupabase();
    dispatch = await import("./tool-dispatch");
    const { indexDocument } = await import("../retrieval/indexer");
    for (let i = 0; i < 30; i++) {
        const doc = await db
            .from("documents")
            .insert({ user_id: USER, filename: `umowa-${i}.docx`, file_type: "docx", status: "ready", security_status: "allowed" })
            .select()
            .single();
        await indexDocument(doc.data.id, `Umowa dostawy numer ${i}. Kara umowna za zwloke w dostawie towaru.`);
    }
}, 120_000); // indeksacja 30 dokumentow na Windows trwa dluzej niz domyslne 10 s
afterAll(async () => {
    (await import("../db/sqlite-connection")).closeDb();
    fs.rmSync(TMP, { recursive: true, force: true });
});

async function szukaj(args: Record<string, unknown>) {
    const out = await dispatch.runToolCalls(
        [{ id: "s1", function: { name: "search_corpus", arguments: JSON.stringify(args) } }],
        new Map(), USER, db, () => {}, undefined, undefined, {}, new Map(), null,
    );
    return JSON.parse((out.toolResults[0] as { content: string }).content) as {
        results: unknown[]; note?: string;
    };
}

describe("P1 search_corpus - sufit liczby fragmentow", () => {
    it("max_results 1000 od modelu: najwyzej 20 fragmentow i nota o przycieciu", async () => {
        const r = await szukaj({ query: "kara umowna dostawa", max_results: 1000 });
        expect(r.results.length).toBeGreaterThan(0);
        expect(r.results.length).toBeLessThanOrEqual(20);
        expect(r.note ?? "").toContain("max_results ograniczone do 20");
    });

    it("kontrola: w granicach - bez noty o przycieciu", async () => {
        const r = await szukaj({ query: "kara umowna dostawa", max_results: 5 });
        expect(r.results.length).toBeLessThanOrEqual(5);
        expect(r.note ?? "").not.toContain("ograniczone");
    });
});

describe("P1 find_in_document - sufit trafien i kontekstu", () => {
    const GRUBY = Array.from({ length: 120 }, (_, i) => `${"x".repeat(4000)} kara umowna nr ${i} `).join("");

    it("max_results i context_chars z kosmosu: najwyzej 50 trafien, kontekst najwyzej 500 znakow z kazdej strony", () => {
        const w = dispatch.znajdzTrafienia(GRUBY, "kara umowna", 1_000_000, 1_000_000_000);
        expect(w.ok).toBe(true);
        if (!w.ok) return;
        expect(w.hits.length).toBe(50);
        expect(w.totalMatches).toBe(120);
        for (const h of w.hits) expect(h.context.length).toBeLessThanOrEqual(2 * 500 + "kara umowna".length + 2);
        expect(w.limity).toContain("max_results=50");
        expect(w.limity).toContain("context_chars=500");
        // Caly wynik jest ograniczony w BAJTACH, nie tylko w liczbie trafien.
        expect(JSON.stringify(w.hits).length).toBeLessThan(80_000);
    });

    it("kontrola: domyslne wartosci bez noty o przycieciu", () => {
        const w = dispatch.znajdzTrafienia(GRUBY, "kara umowna");
        expect(w.ok && w.hits.length).toBe(20);
        expect(w.ok && w.limity).toBeFalsy();
    });
});

describe("P4 blad narzedzia dla modelu - biala lista pol", () => {
    it("komunikat ze sciezka i nazwa tabeli nie trafia do wyniku", async () => {
        const { bladNarzedziaDlaModelu } = await import("./tool-error");
        const e = Object.assign(
            new Error("SQLITE_ERROR: no such column: pesel_klienta (C:\\Users\\Jan Testowy\\AppData\\patron.db)"),
            { code: "SQLITE_ERROR" },
        );
        const w = JSON.stringify(bladNarzedziaDlaModelu("search_corpus", e));
        expect(w).not.toContain("pesel_klienta");
        expect(w).not.toContain("Jan Testowy");
        expect(w).toContain("Error:SQLITE_ERROR");
    });

    it("blad bazy z shimu (zwykly obiekt): kod tak, komunikat nie", async () => {
        const { logErrorClass } = await import("../log-error-class");
        expect(logErrorClass({ code: "23505", message: "duplicate key in tajna_tabela" })).toBe("DbError:23505");
        expect(logErrorClass(null)).toBe("brak_bledu");
    });
});

// Straznik zrodla: pliki skladajace wynik narzedzia dla MODELU nie wkladaja do niego
// surowego komunikatu bledu. Kontrola pozytywna: wzorzec MUSI lapac stare postaci.
const SUROWY = [
    /error:\s*(e|err)\s+instanceof\s+Error\s*\?\s*(e|err)\.message/,
    /error:\s*String\((e|err)\)/,
    /\$\{(docErr|verErr|e|err|error)\??\.message/,
    /failed: \$\{String\((e|err)\)\}/,
    /failed: \$\{message\}/,
];
const PLIKI = ["chat/tool-dispatch.ts", "chat/docx-generate.ts", "chat/replicate.ts", "mcp/index.ts"];

describe("P4 straznik zrodla - zero surowych bledow w wynikach dla modelu", () => {
    it("kontrola pozytywna: wzorce lapia postaci sprzed poprawki", () => {
        const stare = [
            "error: e instanceof Error ? e.message : String(e),",
            "return { error: String(e) };",
            "error: `Failed to record generated document: ${docErr?.message ?? \"unknown\"}`,",
            "fail(`replicate_document failed: ${String(e)}`);",
            "text: JSON.stringify({ error: `MCP tool \"${name}\" failed: ${message}` }),",
        ];
        for (const s of stare) expect(SUROWY.some((r) => r.test(s)), s).toBe(true);
    });

    it.each(PLIKI)("%s", (plik) => {
        const zrodlo = fs.readFileSync(path.join(__dirname, "..", plik), "utf-8");
        const trafienia = zrodlo.split("\n").filter((l) => SUROWY.some((r) => r.test(l)));
        expect(trafienia).toEqual([]);
    });
});
