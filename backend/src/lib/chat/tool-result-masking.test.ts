// Audyt 2026-09 A-01 (P0): wyniki narzedzi czatu ida do modelu chmurowego przez
// TA SAMA pseudonimizacje co konwersacja (stream.ts runTools -> wrapToolResultInto).
//
// Sprawdza pelna petle na realnej sciezce runLLMStream -> runToolCalls (prawdziwy
// dispatcher, prawdziwy DOCX, swieza baza SQLite), z modelem zastapionym skryptem:
//   1. tresc dokumentu oddana modelowi nie niesie PESEL/e-mail/nazwiska,
//   2. tokeny z wynikow narzedzi sa odmaskowane w strumieniu (tresc i rozumowanie),
//      fullText jest oryginalny, a cytat z nazwiskiem/PESEL nadal sie ugruntowuje
//      (ADR-0005 porownuje z ORYGINALNYM tekstem dokumentu),
//   3. find_in_document z tokenem w zapytaniu szuka oryginalu,
//   4. edit_document z tokenem trafia do DOCX jako oryginal - inline i przez karte
//      zatwierdzenia (ADR-0137) wykonuja te same bajty,
//   5. wynik MCP jest maskowany, ale grounding MCP (ADR-0146) porownuje z oryginalem,
//   6. bez maskowania (wylacznik / model lokalny) wynik narzedzia jest bez zmian,
//   7. D-10: zdarzenie doc_edited niesie `errors` czesciowo nieudanej edycji.
// Dane syntetyczne (PESEL z poprawna suma kontrolna, wygenerowany).

import fs from "fs";
import os from "os";
import path from "path";
import JSZip from "jszip";
import { Document, Packer, Paragraph } from "docx";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocIndex, DocStore } from "./types";

const PESEL = "90010112349";
const EMAIL = "jan.testowy@example.com";
const DOC_TEXT = `Powod: Pan Jan Testowy, PESEL ${PESEL}, e-mail ${EMAIL}. Pozwany: Pan Adam Probny. Jan Testowy wnosi o zaplate.`;

type ToolCallIn = { id: string; name: string; input: Record<string, unknown> };
type ToolOut = { tool_use_id: string; content: string };
type Params = {
    model: string;
    messages: { role: string; content: string }[];
    runTools: (calls: ToolCallIn[]) => Promise<ToolOut[]>;
    callbacks?: {
        onContentDelta?: (d: string) => void;
        onReasoningDelta?: (d: string) => void;
        onReasoningBlockEnd?: () => void;
    };
};

const { storage, scriptRef } = vi.hoisted(() => ({
    storage: new Map<string, ArrayBuffer>(),
    scriptRef: { current: null as null | ((p: Params) => Promise<string>) },
}));

vi.mock("../llm", async (importOriginal) => {
    const orig = await importOriginal<typeof import("../llm")>();
    return {
        ...orig,
        streamChatWithTools: vi.fn(async (params: Params) => {
            const fullText = scriptRef.current ? await scriptRef.current(params) : "";
            return { fullText };
        }),
    };
});
vi.mock("../mcp", async (importOriginal) => {
    const orig = await importOriginal<typeof import("../mcp")>();
    return {
        ...orig,
        getMcpTools: vi.fn(async () => []),
        isMcpTool: vi.fn((name: string) => name.startsWith("saos__")),
        runMcpTool: vi.fn(async () => ({
            text: `Wyrok SA. Swiadek Pan Jan Testowy zeznal, ze umowa zostala zawarta. PESEL ${PESEL}.`,
            citations: [
                { source: "mcp", server: "saos", tool: "get_judgment", title: "Wyrok testowy", url: "https://example.org/1" },
            ],
            isError: false,
        })),
    };
});
vi.mock("../storage", () => ({
    downloadFile: vi.fn(async (k: string) => storage.get(k) ?? null),
    uploadFile: vi.fn(async (k: string, ab: ArrayBuffer) => {
        storage.set(k, ab);
    }),
    storageKey: vi.fn((...p: string[]) => p.join("/")),
}));

// `any`: shim bez generyka schematu (jak tool-dispatch-mutation-gate.test.ts).
let db: any;
let runLLMStream: typeof import("./stream").runLLMStream;
let executeStagedTool: typeof import("./mutation-approval-executor").executeStagedTool;
let extractDocxBodyText: typeof import("../docxTrackedChanges").extractDocxBodyText;
let projectId: string;
const USER = "u_mask";
const tmp = path.join(os.tmpdir(), `patron-tool-mask-${Date.now()}.db`);
const envBackup = { ...process.env };

async function makeDocx(text: string): Promise<Buffer> {
    const d = new Document({ sections: [{ children: [new Paragraph(text)] }] });
    return Packer.toBuffer(d);
}

async function docxXml(storagePath: string): Promise<string> {
    const ab = storage.get(storagePath);
    if (!ab) throw new Error(`brak pliku ${storagePath}`);
    const zip = await JSZip.loadAsync(Buffer.from(ab));
    return zip.file("word/document.xml")!.async("string");
}

/** Realny dokument DOCX w sprawie: documents + document_versions (V1) + bajty. */
async function seedDocx(
    filename: string,
    text: string = DOC_TEXT,
): Promise<{ docStore: DocStore; docIndex: DocIndex; documentId: string }> {
    const doc = await db
        .from("documents")
        .insert({ user_id: USER, project_id: projectId, filename, file_type: "docx", status: "ready" })
        .select()
        .single();
    const documentId = doc.data.id as string;
    const storagePath = `documents/${USER}/${documentId}/source.docx`;
    const bytes = await makeDocx(text);
    storage.set(storagePath, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    const ver = await db
        .from("document_versions")
        .insert({ document_id: documentId, storage_path: storagePath, source: "upload", version_number: 1 })
        .select()
        .single();
    await db.from("documents").update({ current_version_id: ver.data.id }).eq("id", documentId);
    return {
        documentId,
        docStore: new Map([["doc-0", { storage_path: storagePath, file_type: "docx", filename }]]),
        docIndex: { "doc-0": { document_id: documentId, filename } },
    };
}

async function run(fixture: { docStore: DocStore; docIndex: DocIndex }, model = "openrouter/google/gemini-3-flash-preview") {
    const sse: string[] = [];
    const result = await runLLMStream({
        apiMessages: [
            { role: "system", content: "Jestes asystentem." },
            { role: "user", content: "Streszcz dokument doc-0." },
        ],
        docStore: fixture.docStore,
        docIndex: fixture.docIndex,
        userId: USER,
        db,
        write: (s) => sse.push(s),
        model,
        projectId,
    });
    const events = sse
        .filter((s) => s.startsWith("data: {"))
        .map((s) => JSON.parse(s.slice(6)) as Record<string, unknown>);
    return { result, events };
}

const tokenOf = (content: string, cat: string): string => {
    const m = content.match(new RegExp(`\\[${cat}_\\d+\\]`));
    if (!m) throw new Error(`brak tokenu ${cat} w: ${content.slice(0, 200)}`);
    return m[0];
};

beforeAll(async () => {
    process.env.PATRON_DB_BACKEND = "sqlite";
    process.env.PATRON_DB_PATH = tmp;
    const supa = await import("../supabase");
    db = supa.createServerSupabase();
    ({ runLLMStream } = await import("./stream"));
    ({ executeStagedTool } = await import("./mutation-approval-executor"));
    ({ extractDocxBodyText } = await import("../docxTrackedChanges"));
    const proj = await db
        .from("projects")
        .insert({ user_id: USER, name: "Sprawa testowa", classification: "attorney_client_privileged" })
        .select()
        .single();
    projectId = proj.data.id;
    // Zimny import ./stream w pelnej suicie przekracza domyslne 10 s (jak w 5beae93).
}, 30_000);

beforeEach(() => {
    // Domyslne ustawienia instalatora desktop (jak audit-2609/A-01).
    process.env.ALLOW_US_PROVIDERS = "true";
    process.env.PATRON_ALLOW_PRIVILEGED_CLOUD = "true";
    delete process.env.PATRON_PSEUDONIM_EGRESS;
    // Sciezka inline jako punkt odniesienia: karty zatwierdzen (ADR-0137) sa
    // domyslnie wlaczone od 2026-10-06, wiec testy inline wylaczaja je jawnie;
    // test "staging OFF i ON" wlacza je sam.
    process.env.PATRON_MUTATION_APPROVAL = "false";
    process.env.DOWNLOAD_SIGNING_SECRET = "test-secret-tool-result-masking";
    vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
    scriptRef.current = null;
    vi.restoreAllMocks();
});

afterAll(async () => {
    process.env = { ...envBackup };
    const { closeDb } = await import("../db/sqlite-connection");
    closeDb();
    for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) {
        try {
            fs.unlinkSync(f);
        } catch {
            /* ignore */
        }
    }
});

describe("A-01: wyniki narzedzi maskowane przed modelem chmurowym", () => {
    it("read_document: model dostaje tokeny, uzytkownik oryginaly, cytat sie ugruntowuje", async () => {
        const fx = await seedDocx("pozew.docx");
        let toolContent = "";
        scriptRef.current = async (p) => {
            const [r] = await p.runTools([{ id: "c1", name: "read_document", input: { doc_id: "doc-0" } }]);
            toolContent = r!.content;
            const person = tokenOf(toolContent, "PERSON");
            const pesel = tokenOf(toolContent, "PESEL");
            // Rozumowanie i tresc z tokenami; token rozciety na granicy chunkow.
            p.callbacks?.onReasoningDelta?.(`Powodem jest ${person.slice(0, 4)}`);
            p.callbacks?.onReasoningDelta?.(`${person.slice(4)}.`);
            p.callbacks?.onReasoningBlockEnd?.();
            const answer =
                `Powodem jest ${person} (PESEL ${pesel}) [1].\n` +
                `<CITATIONS>[{"ref":1,"doc_id":"doc-0","page":1,"quote":"Pan ${person}, PESEL ${pesel}"}]</CITATIONS>`;
            const cut = answer.indexOf(person) + 3;
            p.callbacks?.onContentDelta?.(answer.slice(0, cut));
            p.callbacks?.onContentDelta?.(answer.slice(cut));
            return answer;
        };
        const { result, events } = await run(fx);

        // 1. Do modelu: tresc akt, ale bez identyfikatorow klienta.
        expect(toolContent).toContain("Pozwany");
        expect(toolContent).not.toContain(PESEL);
        expect(toolContent).not.toContain(EMAIL);
        expect(toolContent).not.toContain("Jan Testowy");
        expect(toolContent).not.toContain("Adam Probny");

        // 2. Do uzytkownika: oryginaly w tresci i w rozumowaniu, zero tokenow.
        const streamed = events
            .filter((e) => e.type === "content_delta")
            .map((e) => e.text)
            .join("");
        expect(streamed).toContain(`Powodem jest Jan Testowy (PESEL ${PESEL})`);
        expect(streamed).not.toMatch(/\[(PERSON|PESEL)_\d+\]/);
        const reasoning = events
            .filter((e) => e.type === "reasoning_delta")
            .map((e) => e.text)
            .join("");
        expect(reasoning).toBe("Powodem jest Jan Testowy.");
        expect(result.fullText).toContain(`Pan Jan Testowy, PESEL ${PESEL}`);
        expect(result.fullText).not.toMatch(/\[(PERSON|PESEL)_\d+\]/);

        // 3. Grounding cytatu z nazwiskiem i PESEL porownuje z ORYGINALEM dokumentu.
        expect(result.grounding[1]?.decision).toBe("verified");
        const cit = events.find((e) => e.type === "citations") as { citations: { quote: string }[] };
        expect(cit.citations[0]!.quote).toBe(`Pan Jan Testowy, PESEL ${PESEL}`);
    });

    it("ten sam identyfikator dostaje ten sam token w kolejnych wynikach (takze bez kotwicy)", async () => {
        const fx = await seedDocx("pozew-2.docx");
        const contents: string[] = [];
        scriptRef.current = async (p) => {
            const a = await p.runTools([{ id: "c1", name: "read_document", input: { doc_id: "doc-0" } }]);
            contents.push(a[0]!.content);
            // find_in_document z GOLYM nazwiskiem (bez "Pan") - snippet nie ma kotwicy.
            const b = await p.runTools([
                { id: "c2", name: "find_in_document", input: { doc_id: "doc-0", query: "wnosi o zaplate" } },
            ]);
            contents.push(b[0]!.content);
            return "";
        };
        await run(fx);
        const person = tokenOf(contents[0]!, "PERSON");
        expect(contents[1]).toContain(person);
        expect(contents[1]).not.toContain("Jan Testowy");
        // Wynik find_in_document to JSON - po maskowaniu nadal poprawny.
        expect(() => JSON.parse(contents[1]!)).not.toThrow();
    });

    it("find_in_document z tokenem w zapytaniu szuka oryginalu", async () => {
        const fx = await seedDocx("pozew-3.docx");
        let found = "";
        scriptRef.current = async (p) => {
            const [r] = await p.runTools([{ id: "c1", name: "read_document", input: { doc_id: "doc-0" } }]);
            const pesel = tokenOf(r!.content, "PESEL");
            const [f] = await p.runTools([
                { id: "c2", name: "find_in_document", input: { doc_id: "doc-0", query: pesel } },
            ]);
            found = f!.content;
            return "";
        };
        const { result, events } = await run(fx);
        const parsed = JSON.parse(found) as { ok: boolean; total_matches: number; query: string };
        expect(parsed.ok).toBe(true);
        expect(parsed.total_matches).toBe(1);
        // Do modelu wraca token, nie PESEL.
        expect(found).not.toContain(PESEL);
        // Uzytkownik (SSE + zapis) widzi zapytanie oryginalne.
        const docFind = events.find((e) => e.type === "doc_find") as { query: string; total_matches: number };
        expect(docFind.query).toBe(PESEL);
        expect(docFind.total_matches).toBe(1);
        const ev = result.events.find((e) => e.type === "doc_find") as { query: string };
        expect(ev.query).toBe(PESEL);
    });
});

describe("A-01: edit_document z tokenem trafia do DOCX jako oryginal (inline = karta)", () => {
    async function editTurn(fx: { docStore: DocStore; docIndex: DocIndex }) {
        let editResult = "";
        scriptRef.current = async (p) => {
            const [r] = await p.runTools([{ id: "c1", name: "read_document", input: { doc_id: "doc-0" } }]);
            const person = tokenOf(r!.content, "PERSON");
            const pesel = tokenOf(r!.content, "PESEL");
            const [e] = await p.runTools([
                {
                    id: "c2",
                    name: "edit_document",
                    input: {
                        doc_id: "doc-0",
                        edits: [
                            {
                                find: `Pan ${person}, PESEL ${pesel}`,
                                replace: `Pan ${person} (PESEL ${pesel}), dzialajacy osobiscie`,
                                reason: "doprecyzowanie",
                            },
                        ],
                    },
                },
            ]);
            editResult = e!.content;
            return "";
        };
        const out = await run(fx);
        return { ...out, editResult };
    }

    async function editRows(versionId: string) {
        const { data } = await db
            .from("document_edits")
            .select("deleted_text, inserted_text")
            .eq("version_id", versionId);
        return (data ?? []) as { deleted_text: string; inserted_text: string }[];
    }

    it("staging OFF i ON wykonuja te same, odmaskowane edycje", async () => {
        // --- inline ---
        const inlineFx = await seedDocx("pismo-inline.docx");
        const inline = await editTurn(inlineFx);
        expect(inline.editResult).not.toContain(PESEL);
        const edited = inline.result.events.find((e) => e.type === "doc_edited") as {
            version_id: string;
            annotations: { deleted_text?: string; inserted_text?: string }[];
        };
        expect(edited).toBeTruthy();
        const verRow = await db
            .from("document_versions")
            .select("storage_path")
            .eq("id", edited.version_id)
            .single();
        const inlineXml = await docxXml(verRow.data.storage_path);
        expect(inlineXml).not.toMatch(/\[(PERSON|PESEL)_\d+\]/);
        expect(inlineXml).toContain(`(PESEL ${PESEL}), dzialajacy osobiscie`);
        const inlineText = await extractDocxBodyText(Buffer.from(storage.get(verRow.data.storage_path)!));
        expect(inlineText).not.toMatch(/\[(PERSON|PESEL)_\d+\]/);
        const inlineRows = await editRows(edited.version_id);
        expect(inlineRows.length).toBeGreaterThan(0);

        // --- staged (ADR-0137) ---
        process.env.PATRON_MUTATION_APPROVAL = "true";
        const stagedFx = await seedDocx("pismo-staged.docx");
        const staged = await editTurn(stagedFx);
        expect(JSON.parse(staged.editResult).staged).toBe(true);
        const { data: cards } = await db
            .from("mutation_approvals")
            .select("*")
            .eq("document_id", stagedFx.documentId);
        expect(cards).toHaveLength(1);
        const card = cards[0];
        const payload =
            typeof card.tool_payload === "string" ? JSON.parse(card.tool_payload) : card.tool_payload;
        // Karta trzyma oryginaly (dane lokalne), nie tokeny.
        expect(JSON.stringify(payload)).not.toMatch(/\[(PERSON|PESEL)_\d+\]/);
        expect(payload.edits[0].find).toBe(`Pan Jan Testowy, PESEL ${PESEL}`);

        const exec = await executeStagedTool({ ...card, tool_payload: payload }, USER, db);
        expect(exec.ok).toBe(true);
        const stagedVersionId = (exec.result as { version_id: string }).version_id;
        const stagedRows = await editRows(stagedVersionId);
        // Te same bajty edycji co inline.
        const norm = (rows: { deleted_text: string; inserted_text: string }[]) =>
            rows.map((r) => [r.deleted_text, r.inserted_text]).sort();
        expect(norm(stagedRows)).toEqual(norm(inlineRows));
        const stagedVer = await db
            .from("document_versions")
            .select("storage_path")
            .eq("id", stagedVersionId)
            .single();
        const stagedXml = await docxXml(stagedVer.data.storage_path);
        expect(stagedXml).not.toMatch(/\[(PERSON|PESEL)_\d+\]/);
        expect(stagedXml).toContain(`(PESEL ${PESEL}), dzialajacy osobiscie`);
    });

    it("D-10: doc_edited w zdarzeniach tury niesie errors czesciowo nieudanej edycji", async () => {
        const fx = await seedDocx("pismo-czesciowe.docx");
        scriptRef.current = async (p) => {
            await p.runTools([
                {
                    id: "c1",
                    name: "edit_document",
                    input: {
                        doc_id: "doc-0",
                        edits: [
                            { find: "wnosi o zaplate", replace: "wnosi o zaplate z odsetkami" },
                            { find: "tego zdania nie ma w pismie", replace: "x" },
                        ],
                    },
                },
            ]);
            return "";
        };
        const { result } = await run(fx);
        const edited = result.events.find((e) => e.type === "doc_edited") as {
            annotations: unknown[];
            errors?: { index: number; reason: string }[];
        };
        expect(edited.annotations.length).toBe(1);
        expect(edited.errors).toHaveLength(1);
        expect(edited.errors![0]!.index).toBe(1);
    });
});

describe("A-01: wynik MCP maskowany, grounding MCP na oryginale (ADR-0146)", () => {
    it("cytat z tokenami ugruntowuje sie wzgledem oryginalnego tekstu konektora", async () => {
        const fx = await seedDocx("pozew-mcp.docx");
        let mcpContent = "";
        scriptRef.current = async (p) => {
            const [r] = await p.runTools([
                { id: "m1", name: "saos__get_judgment", input: { id: "1" } },
            ]);
            mcpContent = r!.content;
            const person = tokenOf(mcpContent, "PERSON");
            const answer = `Sad ustalil:\n\n> Swiadek Pan ${person} zeznal, ze umowa zostala zawarta.\n`;
            p.callbacks?.onContentDelta?.(answer);
            return answer;
        };
        const { result } = await run(fx);
        expect(mcpContent).not.toContain("Jan Testowy");
        expect(mcpContent).not.toContain(PESEL);
        expect(result.fullText).toContain("Swiadek Pan Jan Testowy zeznal");
        expect(result.mcpGrounding).not.toBeNull();
        expect(result.mcpGrounding!.quotes).toHaveLength(1);
        expect(result.mcpGrounding!.quotes[0]!.verdict).toBe("green");
    });
});

describe("A-01: bez maskowania wynik narzedzia jest bez zmian", () => {
    it("PATRON_PSEUDONIM_EGRESS=false -> tresc surowa (swiadomy wylacznik)", async () => {
        process.env.PATRON_PSEUDONIM_EGRESS = "false";
        const fx = await seedDocx("pozew-off.docx");
        let content = "";
        scriptRef.current = async (p) => {
            const [r] = await p.runTools([{ id: "c1", name: "read_document", input: { doc_id: "doc-0" } }]);
            content = r!.content;
            return "";
        };
        await run(fx);
        expect(content).toContain(PESEL);
        expect(content).toContain("Jan Testowy");
    });

    it("model lokalny (no-egress) -> tresc surowa", async () => {
        const fx = await seedDocx("pozew-lokalny.docx");
        let content = "";
        scriptRef.current = async (p) => {
            const [r] = await p.runTools([{ id: "c1", name: "read_document", input: { doc_id: "doc-0" } }]);
            content = r!.content;
            return "";
        };
        await run(fx, "ollama/qwen3:8b");
        expect(content).toContain(PESEL);
        expect(content).toContain("Jan Testowy");
    });
});

describe("A-09 / B-11: argumenty zewnetrznych konektorow MCP (decyzja 2026-10-06)", () => {
    const NIP = "5260250274"; // syntetyczny, poprawna suma
    const PESEL_SPOZA = "85071202931"; // syntetyczny, poprawna suma, nie ma go w aktach
    const TEXT = `Pozwana: Alfa Testowa sp. z o.o., NIP ${NIP}. Powod: Pan Jan Testowy, PESEL ${PESEL}. Jan Testowy wnosi o zaplate.`;

    async function lastLlmRoutePayload(): Promise<Record<string, unknown>> {
        const { data } = await db.from("audit_log").select("*").eq("event_type", "llm_route");
        const rows = (data ?? []) as { id: number | string; payload: unknown }[];
        const last = rows[rows.length - 1]!;
        return (typeof last.payload === "string" ? JSON.parse(last.payload) : last.payload) as Record<string, unknown>;
    }

    it("ORG/NIP odtworzone do MCP; PERSON/PESEL zostaja tokenem; PESEL wpisany doslownie wyciety; narzedzie lokalne dostaje oryginal; licznik w llm_route", async () => {
        const mcp = await import("../mcp");
        const runMcp = vi.mocked(mcp.runMcpTool);
        runMcp.mockClear();
        const fx = await seedDocx("pozew-mcp-args.docx", TEXT);
        scriptRef.current = async (p) => {
            const [r] = await p.runTools([{ id: "c1", name: "read_document", input: { doc_id: "doc-0" } }]);
            const org = tokenOf(r!.content, "ORG");
            const nip = tokenOf(r!.content, "NIP");
            const person = tokenOf(r!.content, "PERSON");
            const pesel = tokenOf(r!.content, "PESEL");
            await p.runTools([
                {
                    id: "m1",
                    name: "saos__search_judgments",
                    input: { query: `${org} NIP ${nip}`, party: `${person} ${pesel}`, extra: `${PESEL_SPOZA} jan@example.com` },
                },
                // Narzedzie lokalne w tej samej turze: pelne odtworzenie.
                { id: "c2", name: "find_in_document", input: { doc_id: "doc-0", query: person } },
            ]);
            return "";
        };
        const { result } = await run(fx);

        expect(runMcp).toHaveBeenCalledTimes(1);
        const args = runMcp.mock.calls[0]![1] as { query: string; party: string; extra: string };
        // Podmiot rejestru publicznego: odtworzony (szukanie po KRS/NIP jest celowe).
        expect(args.query).toContain("Alfa Testowa sp. z o.o.");
        expect(args.query).toContain(NIP);
        // Osoba i PESEL klienta: konektor dostaje token, nie oryginal.
        expect(args.party).toMatch(/^\[PERSON_\d+\] \[PESEL_\d+\]$/);
        const sent = JSON.stringify(args);
        expect(sent).not.toContain("Jan Testowy");
        expect(sent).not.toContain(PESEL);
        // PESEL i e-mail wpisane doslownie (spoza mapy) - wyciete.
        expect(sent).not.toContain(PESEL_SPOZA);
        expect(sent).not.toContain("jan@example.com");
        expect(args.extra).toBe("[PESEL_REDACTED] [EMAIL_REDACTED]");

        // Narzedzie lokalne: zapytanie z oryginalem (edycja/szukanie trafia w tekst).
        const ev = result.events.find((e) => e.type === "doc_find") as { query: string; total_matches: number };
        expect(ev.query).toBe("Jan Testowy");
        expect(ev.total_matches).toBeGreaterThan(0);

        // llm_route tej tury: same liczniki, bez wartosci.
        const payload = await lastLlmRoutePayload();
        expect(payload.mcp_args_redacted).toEqual({ PESEL: 1, EMAIL: 1 });
        expect(payload.mcp_args_tokens_withheld).toEqual({ PERSON: 1, PESEL: 1 });
        const raw = JSON.stringify(payload);
        expect(raw).not.toContain(PESEL_SPOZA);
        expect(raw).not.toContain("jan@example.com");
    });

    it("model lokalny (bez mapy): PESEL z akt wklejony do argumentu MCP jest wyciety (B-11)", async () => {
        const mcp = await import("../mcp");
        const runMcp = vi.mocked(mcp.runMcpTool);
        runMcp.mockClear();
        const fx = await seedDocx("pozew-mcp-lokalny.docx", TEXT);
        scriptRef.current = async (p) => {
            const [r] = await p.runTools([{ id: "c1", name: "read_document", input: { doc_id: "doc-0" } }]);
            const pesel = r!.content.match(/\b\d{11}\b/)?.[0] ?? "";
            await p.runTools([{ id: "m1", name: "saos__search_judgments", input: { query: `Jan Testowy ${pesel}` } }]);
            return "";
        };
        await run(fx, "ollama/qwen3:8b");
        expect(runMcp).toHaveBeenCalledTimes(1);
        const sent = JSON.stringify(runMcp.mock.calls[0]![1]);
        expect(sent).not.toContain(PESEL);
        expect(sent).toContain("[PESEL_REDACTED]");
        const payload = await lastLlmRoutePayload();
        expect(payload.mcp_args_redacted).toEqual({ PESEL: 1 });
    });
});

describe("B-02: wstrzymana akcja jest jawnym sygnalem czatu (ADR-0137, domyslnie ON)", () => {
    it("bez env edit_document trafia na karte, a tura emituje i utrwala mutation_staged", async () => {
        delete process.env.PATRON_MUTATION_APPROVAL;
        const fx = await seedDocx("pismo-domyslnie.docx");
        scriptRef.current = async (p) => {
            await p.runTools([
                {
                    id: "e1",
                    name: "edit_document",
                    input: { doc_id: "doc-0", edits: [{ find: "wnosi o zaplate", replace: "wnosi o zaplate z odsetkami" }] },
                },
            ]);
            return "";
        };
        const { result, events } = await run(fx);
        expect(result.events.filter((e) => e.type === "doc_edited")).toHaveLength(0);
        const sse = events.filter((e) => e.type === "mutation_staged");
        expect(sse).toHaveLength(1);
        expect(sse[0]!.tool).toBe("edit_document");
        expect(typeof sse[0]!.approval_id).toBe("string");
        // Bez argumentow mutacji w zdarzeniu.
        expect(JSON.stringify(sse[0])).not.toContain("odsetkami");
        const persisted = result.events.filter((e) => e.type === "mutation_staged");
        expect(persisted).toEqual(sse);
    });
});
