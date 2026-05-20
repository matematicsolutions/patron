import { describe, expect, it } from "vitest";
import { buildMessages } from "./messages";
import type { ChatMessage, DocIndex } from "./types";

type Msg = { role: string; content: string };

describe("buildMessages", () => {
    it("dodaje wiadomosc systemowa z SYSTEM_PROMPT na pierwszej pozycji", () => {
        const out = buildMessages([], []) as Msg[];
        expect(out).toHaveLength(1);
        expect(out[0].role).toBe("system");
        expect(out[0].content).toContain("legal assistant");
    });

    it("doleja systemPromptExtra po SYSTEM_PROMPT", () => {
        const extra = "EXTRA INSTRUCTIONS: bla bla";
        const out = buildMessages([], [], extra) as Msg[];
        expect(out[0].content).toContain("EXTRA INSTRUCTIONS: bla bla");
        expect(out[0].content.indexOf("EXTRA INSTRUCTIONS")).toBeGreaterThan(
            out[0].content.indexOf("legal assistant"),
        );
    });

    it("doleja sekcje AVAILABLE DOCUMENTS gdy podano docAvailability", () => {
        const out = buildMessages(
            [],
            [
                { doc_id: "doc-0", filename: "nda.docx" },
                {
                    doc_id: "doc-1",
                    filename: "umowa.docx",
                    folder_path: "klient/sprawa-A",
                },
            ],
        ) as Msg[];
        expect(out[0].content).toContain("AVAILABLE DOCUMENTS:");
        expect(out[0].content).toContain("- doc-0: nda.docx");
        expect(out[0].content).toContain(
            "- doc-1: klient/sprawa-A / umowa.docx",
        );
        // ostrzezenie o braku retencji miedzy turami
        expect(out[0].content).toContain("read_document");
    });

    it("pomija sekcje AVAILABLE DOCUMENTS gdy docAvailability puste", () => {
        const out = buildMessages([], []) as Msg[];
        expect(out[0].content).not.toContain("AVAILABLE DOCUMENTS:");
    });

    it("przepuszcza wiadomosci user/assistant w kolejnosci", () => {
        const messages: ChatMessage[] = [
            { role: "user", content: "Pytanie 1" },
            { role: "assistant", content: "Odpowiedz 1" },
            { role: "user", content: "Pytanie 2" },
        ];
        const out = buildMessages(messages, []) as Msg[];
        expect(out.slice(1)).toEqual([
            { role: "user", content: "Pytanie 1" },
            { role: "assistant", content: "Odpowiedz 1" },
            { role: "user", content: "Pytanie 2" },
        ]);
    });

    it("dolacza marker workflow do wiadomosci user", () => {
        const messages: ChatMessage[] = [
            {
                role: "user",
                content: "wykonaj",
                workflow: { id: "wf-1", title: "NDA Review" },
            },
        ];
        const out = buildMessages(messages, []) as Msg[];
        expect(out[1].content).toContain("[Workflow: NDA Review (id: wf-1)]");
        expect(out[1].content).toContain("wykonaj");
    });

    it("dolacza liste plikow do wiadomosci user", () => {
        const messages: ChatMessage[] = [
            {
                role: "user",
                content: "przejrzyj",
                files: [{ filename: "a.docx" }, { filename: "b.docx" }],
            },
        ];
        const out = buildMessages(messages, []) as Msg[];
        expect(out[1].content).toContain("- a.docx");
        expect(out[1].content).toContain("- b.docx");
        expect(out[1].content).toContain("przejrzyj");
    });

    it("uzywa slug z docIndex dla zalacznikow z document_id", () => {
        const docIndex: DocIndex = {
            "doc-7": { document_id: "uuid-x", filename: "umowa.docx" },
        };
        const messages: ChatMessage[] = [
            {
                role: "user",
                content: "zobacz",
                files: [{ filename: "umowa.docx", document_id: "uuid-x" }],
            },
        ];
        const out = buildMessages(messages, [], undefined, docIndex) as Msg[];
        expect(out[1].content).toContain("- doc-7: umowa.docx");
    });

    it("brak slugu w docIndex -> fallback do samej nazwy pliku", () => {
        const docIndex: DocIndex = {};
        const messages: ChatMessage[] = [
            {
                role: "user",
                content: "zobacz",
                files: [{ filename: "x.docx", document_id: "uuid-nieznany" }],
            },
        ];
        const out = buildMessages(messages, [], undefined, docIndex) as Msg[];
        expect(out[1].content).toContain("- x.docx");
        expect(out[1].content).not.toContain("doc-");
    });

    it("workflow + files razem - oba markery", () => {
        const messages: ChatMessage[] = [
            {
                role: "user",
                content: "zrob to",
                workflow: { id: "wf-2", title: "Audit" },
                files: [{ filename: "kontrakt.docx" }],
            },
        ];
        const out = buildMessages(messages, []) as Msg[];
        expect(out[1].content).toContain("[Workflow: Audit (id: wf-2)]");
        expect(out[1].content).toContain("- kontrakt.docx");
    });
});
