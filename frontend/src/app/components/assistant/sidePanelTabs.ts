// Tozsamosc karty panelu bocznego - JEDEN dom faktu "ktora karta jest ktora".
//
// Powod istnienia: `upsertTab` w ChatView bral identyfikator karty NA WIARE od
// wolajacego (`openCitation` / `openEditor` / `openDocument` kazdy wpisywal
// wlasne `id`), a przy trafieniu w istniejaca karte zachowywal identyfikator
// STAREJ karty i zaraz potem ustawial jako aktywny identyfikator NOWEGO obiektu,
// ktory do listy nie trafil. Dzialalo tylko dlatego, ze wszystkie trzy sciezki
// przypadkiem wpisywaly to samo (`documentId`) - pierwszy wolajacy z innym `id`
// zostawialby panel z aktywnym identyfikatorem spoza listy.
//
// Lek: identyfikatora karty NIE PODAJE sie z zewnatrz - jest WYPROWADZANY
// z dokumentu (`tabIdFor`). Zadanie otwarcia karty (`SidePanelTabRequest`) nie
// ma pola `id`, wiec rozjazd nie ma jak powstac, a nie tylko "nie powstaje".
//
// Drugi skutek: zadanie bez `documentId` NIE tworzy karty. Backend zostawia
// `document_id` niezdefiniowane, gdy model zacytowal dokument spoza indeksu
// tury (`resolveDoc` nie trafia - backend/src/lib/chat/persistence.ts), a taka
// karta wchodzila do listy z `id === undefined`: React dostawal `key={undefined}`
// i zglaszal "Each child in a list should have a unique key prop" wskazujac
// AssistantSidePanel - czyli brak klucza, nie duplikat wartosci.

import type {
    AssistantSidePanelTab,
    CitationTab,
    DocumentTab,
    EditTab,
} from "./AssistantSidePanel";

/**
 * Zadanie otwarcia karty - dokladnie to, co karta, ale BEZ `id`.
 * Rozdzielne `Omit` na kazdym wariancie: `Omit` na unii sciela pola
 * dyskryminujace (`kind`, `citation`, `edit`).
 */
export type SidePanelTabRequest =
    | Omit<DocumentTab, "id">
    | Omit<CitationTab, "id">
    | Omit<EditTab, "id">;

export interface UpsertTabResult {
    /** Nowa lista kart. Ta sama referencja co `prev`, gdy zadanie odrzucone. */
    tabs: AssistantSidePanelTab[];
    /**
     * Identyfikator karty, ktora REALNIE jest w `tabs` (przy trafieniu -
     * istniejacej, przy pudle - dopisanej). `null` = zadania nie dalo sie
     * spelnic i aktywnej karty nie wolno zmieniac.
     */
    activeTabId: string | null;
}

/**
 * Jedyna regula identyfikatora karty: karta JEST dokumentem, ktory pokazuje.
 * `null` dla dokumentu, ktorego nie ma (cytat bez `document_id`).
 */
export function tabIdFor(
    documentId: string | null | undefined,
): string | null {
    return typeof documentId === "string" && documentId.length > 0
        ? documentId
        : null;
}

function withId(
    request: SidePanelTabRequest,
    id: string,
): AssistantSidePanelTab {
    // Spread unii + dopisane `id` - kazdy wariant `SidePanelTabRequest`
    // uzupelniony o brakujace pole daje odpowiadajacy mu wariant karty.
    switch (request.kind) {
        case "citation":
            return { ...request, id };
        case "edit":
            return { ...request, id };
        default:
            return { ...request, id };
    }
}

/**
 * Jedna karta na dokument. Trafienie w istniejaca karte podmienia tylko pola
 * naglowka (kind, cytat/zmiana, wersja, nazwa pliku); stan UI karty - odrzucone
 * ostrzezenie i zapisana pozycja przewijania - zostaje, zeby zmiana naglowka nie
 * kasowala stanu podgladu. Zadanie bez uzytecznego `documentId` nie tworzy karty.
 */
export function upsertTabState(
    prev: AssistantSidePanelTab[],
    request: SidePanelTabRequest,
): UpsertTabResult {
    const id = tabIdFor(request.documentId);
    if (!id) return { tabs: prev, activeTabId: null };

    const idx = prev.findIndex((t) => t.documentId === request.documentId);
    if (idx < 0) {
        return { tabs: [...prev, withId(request, id)], activeTabId: id };
    }

    const existing = prev[idx];
    const copy = prev.slice();
    copy[idx] = {
        ...withId(request, existing.id),
        warning: existing.warning,
        initialScrollTop: existing.initialScrollTop,
    };
    return { tabs: copy, activeTabId: existing.id };
}
