// Karty panelu bocznego - tozsamosc karty. Dwa defekty, jeden korzen:
// identyfikator karty przychodzil Z ZEWNATRZ (od wolajacego), zamiast byc
// wyprowadzony z dokumentu. Skutek pierwszy: przy trafieniu w istniejaca karte
// lista zostawala przy STARYM identyfikatorze, a aktywny ustawiano na NOWY -
// aktywna byla karta, ktorej w liscie nie ma. Skutek drugi: cytat bez
// `document_id` (backend nie rozwiazal doc_id z odpowiedzi modelu) wchodzil
// do listy z `id === undefined`, czyli `key={undefined}` w AssistantSidePanel.

import { describe, expect, it } from "vitest";
import { tabIdFor, upsertTabState } from "./sidePanelTabs";
import type { AssistantSidePanelTab } from "./AssistantSidePanel";
import type { PATRONCitationAnnotation } from "../shared/types";

function cytat(
    documentId: string | undefined,
    ref: number,
): PATRONCitationAnnotation {
    return {
        type: "citation_data",
        ref,
        doc_id: `doc-${ref}`,
        // Rzutowanie celowe: backend zapisuje `document_id: docInfo?.document_id`,
        // wiec w JSON-ie z serwera tego pola po prostu NIE MA, gdy dokument sie
        // nie rozwiazal. Fixture ma byc wierny zjawisku, nie deklaracji typu.
        document_id: documentId as string,
        filename: "umowa.docx",
        page: 3,
        quote: "Strony ustalaja termin",
    };
}

const kartaDokumentu: AssistantSidePanelTab = {
    kind: "document",
    id: "uuid-a",
    documentId: "uuid-a",
    filename: "umowa.docx",
    versionId: null,
    versionNumber: null,
};

describe("upsertTabState", () => {
    it("przy trafieniu w istniejaca karte aktywny identyfikator jest identyfikatorem karty REALNIE obecnej w liscie", () => {
        const wynik = upsertTabState([kartaDokumentu], {
            kind: "citation",
            documentId: "uuid-a",
            filename: "umowa.docx",
            versionId: null,
            versionNumber: null,
            citation: cytat("uuid-a", 1),
        });

        expect(wynik.tabs).toHaveLength(1);
        expect(wynik.activeTabId).toBe(kartaDokumentu.id);
        expect(
            wynik.tabs.some((t) => t.id === wynik.activeTabId),
        ).toBe(true);
        // Naglowek podmieniony na cytat, karta ta sama.
        expect(wynik.tabs[0].kind).toBe("citation");
    });

    it("stan UI karty (ostrzezenie, pozycja przewijania) przezywa podmiane naglowka", () => {
        const zeStanem: AssistantSidePanelTab = {
            ...kartaDokumentu,
            warning: "Nie udalo sie odswiezyc podgladu",
            initialScrollTop: 420,
        };

        const wynik = upsertTabState([zeStanem], {
            kind: "citation",
            documentId: "uuid-a",
            filename: "umowa.docx",
            versionId: "v2",
            versionNumber: 2,
            citation: cytat("uuid-a", 2),
        });

        expect(wynik.tabs[0].warning).toBe("Nie udalo sie odswiezyc podgladu");
        expect(wynik.tabs[0].initialScrollTop).toBe(420);
        expect(wynik.tabs[0].versionNumber).toBe(2);
    });

    it("nowy dokument dopisuje karte, a aktywny identyfikator wskazuje wlasnie ja", () => {
        const wynik = upsertTabState([kartaDokumentu], {
            kind: "document",
            documentId: "uuid-b",
            filename: "pozew.docx",
            versionId: null,
            versionNumber: null,
        });

        expect(wynik.tabs.map((t) => t.id)).toEqual(["uuid-a", "uuid-b"]);
        expect(wynik.activeTabId).toBe("uuid-b");
        expect(wynik.tabs.some((t) => t.id === wynik.activeTabId)).toBe(true);
    });

    it("cytat bez document_id NIE tworzy karty - lista zostaje bez zmian i bez pustego klucza", () => {
        const przed: AssistantSidePanelTab[] = [kartaDokumentu];
        const wynik = upsertTabState(przed, {
            kind: "citation",
            documentId: undefined as unknown as string,
            filename: "doc-7",
            versionId: null,
            versionNumber: null,
            citation: cytat(undefined, 7),
        });

        expect(wynik.tabs).toBe(przed);
        expect(wynik.activeTabId).toBeNull();
    });

    it("po serii otwarc kazda karta ma niepusty i unikalny identyfikator (klucz Reacta)", () => {
        let tabs: AssistantSidePanelTab[] = [];
        const zadania = [
            { documentId: "uuid-a", ref: 1 },
            { documentId: undefined, ref: 2 },
            { documentId: "uuid-b", ref: 3 },
            { documentId: "uuid-a", ref: 4 },
            { documentId: "", ref: 5 },
        ];
        for (const z of zadania) {
            tabs = upsertTabState(tabs, {
                kind: "citation",
                documentId: z.documentId as string,
                filename: "umowa.docx",
                versionId: null,
                versionNumber: null,
                citation: cytat(z.documentId, z.ref),
            }).tabs;
        }

        const klucze = tabs.map((t) => t.id);
        expect(klucze).toEqual(["uuid-a", "uuid-b"]);
        expect(new Set(klucze).size).toBe(klucze.length);
        expect(klucze.every((k) => typeof k === "string" && k.length > 0)).toBe(
            true,
        );
    });
});

describe("tabIdFor", () => {
    it("dokument bez identyfikatora nie dostaje identyfikatora karty", () => {
        expect(tabIdFor(undefined)).toBeNull();
        expect(tabIdFor(null)).toBeNull();
        expect(tabIdFor("")).toBeNull();
        expect(tabIdFor("uuid-a")).toBe("uuid-a");
    });
});
