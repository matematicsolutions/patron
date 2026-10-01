// Zakres generatora promptu kolumny - JAWNE pole zamiast nullowalnego reviewId.
//
// Powod istnienia: POST /tabular-review/prompt przyjmowal `reviewId` jako
// opcjonalny, wiec "brak sprawy" byl stanem DOMYSLNYM. Schodzil wtedy do
// resolveClassification(null) - JEDYNEJ galezi straznika data-residency, ktora
// nie jest fail-closed ("internal", lib/routing/guard.ts). Zeby wyslac tytul
// kolumny i tagi sprawy objetej tajemnica do chmury po najslabszej
// klasyfikacji, wystarczylo pominac jedno pole. Ta sama galaz raz juz
// wyprodukowala defekt: commit 1de8f84 naprawial `projectId` przybity na twardo
// do null (commit 20fd0cd), ale zostawil ja OSIAGALNA.
//
// Lek: brak sprawy przestaje byc domyslna galezia i staje sie NAZWANYM
// zakresem. Zadanie bez reviewId przechodzi wylacznie jako
// scope "workflow_template" - edytor SZABLONU workflow
// (frontend/src/app/(pages)/workflows/[id]/page.tsx + WFEditColumnModal.tsx)
// sprawy celowo nie ma i musi dzialac dalej. Kazdy inny ksztalt to 400, czyli
// ostrzej niz najostrzejsza klasyfikacja: zadanie nie dociera do modelu w ogole.
//
// Dlaczego szablon zostaje przy "internal", a nie leci fail-closed na
// attorney_client_privileged: po tej zmianie na sciezce szablonu do modelu idzie
// TYLKO tytul kolumny szablonu, format i lista tagow szablonu - bez sprawy, bez
// dokumentu (`documentName` usuniete z powierzchni: martwy input, ktorego nie
// ustawial zaden call-site frontu). To ten sam rodzaj danych co czat ogolny bez
// sprawy, ktory ADR-0067 (l. 43-44) klasyfikuje jako "internal". Rygor
// przeniesiony jest o poziom wyzej - do bramki wejscia, nie do klasyfikacji.
//
// CZEGO TA BRAMKA NIE ROBI: nie zamyka galezi "internal" dla scope "review".
// Przeglad samodzielny (bez sprawy) ma project_id = null i nadal schodzi do
// resolveClassification(null). Zakres deklaruje KLIENT i backend nie ma jak go
// zweryfikowac - to konwencja wejscia, nie granica bezpieczenstwa.

/** Zakres zadania: sprawa (review) albo szablon workflow (bez sprawy). */
export type ZakresPromptu =
    | { scope: "review"; reviewId: string }
    | { scope: "workflow_template" };

export type WynikZakresu =
    | { ok: true; zakres: ZakresPromptu }
    | { ok: false; detail: string };

/** Wartosci `scope` przyjmowane przez route. Lista ZAMKNIETA (fail-closed). */
export const ZAKRESY_PROMPTU = ["review", "workflow_template"] as const;

const tekst = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * Rozstrzyga zakres zadania generatora promptu kolumny. Pure - bez IO, zeby
 * dalo sie testowac w izolacji (konwencja routes/security.test.ts: logika
 * decyzyjna wyjeta z route'u, bo w stosie nie ma supertesta).
 *
 * Reguly:
 *  - scope "review" wymaga niepustego reviewId (bez niego nie ma z czego
 *    rozwiazac klasyfikacji sprawy),
 *  - scope "workflow_template" wymaga BRAKU reviewId (szablon nie ma sprawy;
 *    obecne reviewId znaczy, ze wolajacy sam nie wie, w jakim jest zakresie),
 *  - brak `scope` jest domyslany na "review" WYLACZNIE gdy jest reviewId -
 *    czyli tylko w kierunku bezpiecznym (klasyfikacja i tak wyjdzie ze sprawy).
 *    Brak sprawy nigdy nie jest domyslany; trzeba go nazwac.
 */
export function rozstrzygnijZakresPromptu(body: unknown): WynikZakresu {
    const b = (body ?? {}) as Record<string, unknown>;
    const scope = tekst(b.scope);
    const reviewId = tekst(b.reviewId);

    if (!scope) {
        if (reviewId) return { ok: true, zakres: { scope: "review", reviewId } };
        return {
            ok: false,
            detail:
                'scope is required when reviewId is absent: use "review" with a ' +
                'reviewId, or "workflow_template" for the case-less workflow ' +
                "template editor",
        };
    }

    if (!(ZAKRESY_PROMPTU as readonly string[]).includes(scope)) {
        return {
            ok: false,
            detail: `unknown scope "${scope}" (allowed: ${ZAKRESY_PROMPTU.join(", ")})`,
        };
    }

    if (scope === "review") {
        if (!reviewId)
            return { ok: false, detail: 'reviewId is required for scope "review"' };
        return { ok: true, zakres: { scope: "review", reviewId } };
    }

    if (reviewId)
        return {
            ok: false,
            detail:
                'scope "workflow_template" must not carry a reviewId - a workflow ' +
                "template has no case",
        };
    return { ok: true, zakres: { scope: "workflow_template" } };
}
