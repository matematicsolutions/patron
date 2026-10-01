// Bramka jedynej galezi straznika, ktora NIE jest fail-closed.
//
// resolveClassification(null) zwraca "internal" (lib/routing/guard.ts) - to
// jedyne wejscie do straznika data-residency, ktore nie konczy sie
// najostrzejsza klasyfikacja. POST /tabular-review/prompt trzymal je otwarte
// przez OPCJONALNY reviewId: zadanie z tytulem kolumny i tagami sprawy objetej
// tajemnica wystarczylo wyslac bez jednego pola, zeby wyszlo do chmury po
// najslabszej klasyfikacji. Ta sama galaz raz juz wyprodukowala defekt (20fd0cd
// przybil projectId na twardo do null).
//
// Test opisuje kontrakt bramki wejscia: brak sprawy musi byc NAZWANY, nie
// domyslany. Konwencja jak w routes/security.test.ts - logika decyzyjna wyjeta
// z route'u do pure function, bo w stosie nie ma supertesta (Konstytucja Art. 4).

import { describe, expect, it } from "vitest";

import { rozstrzygnijZakresPromptu, ZAKRESY_PROMPTU } from "./prompt-scope";

describe("rozstrzygnijZakresPromptu - brak sprawy musi byc nazwany", () => {
    it("odrzuca zadanie BEZ reviewId i BEZ scope (znany-zly: dokladnie ta luka)", () => {
        const wynik = rozstrzygnijZakresPromptu({
            title: "Kara umowna",
            format: "tag",
            tags: ["Sprawa Kowalski", "Sprawa Nowak"],
        });
        expect(wynik.ok).toBe(false);
        if (!wynik.ok) expect(wynik.detail).toContain("scope is required");
    });

    it("odrzuca zadanie z tresc niosaca documentName, ale bez sprawy", () => {
        // `documentName` nie jest juz czytany przez route, ale zadanie o tym
        // ksztalcie ma sie rozbic o BRAK ZAKRESU, a nie przejsc na "internal".
        const wynik = rozstrzygnijZakresPromptu({
            title: "Strony umowy",
            documentName: "Umowa najmu - Kowalski vs Nowak.pdf",
        });
        expect(wynik.ok).toBe(false);
    });

    it("scope 'review' bez reviewId to 400, nie cicha degradacja klasyfikacji", () => {
        const wynik = rozstrzygnijZakresPromptu({ scope: "review" });
        expect(wynik.ok).toBe(false);
        if (!wynik.ok) expect(wynik.detail).toContain("reviewId is required");
    });

    it("scope 'workflow_template' przechodzi - edytor szablonu ma dzialac dalej", () => {
        const wynik = rozstrzygnijZakresPromptu({
            title: "Termin platnosci",
            format: "date",
            scope: "workflow_template",
        });
        expect(wynik).toEqual({ ok: true, zakres: { scope: "workflow_template" } });
    });

    it("scope 'workflow_template' z reviewId to 400 - wolajacy nie wie, gdzie jest", () => {
        const wynik = rozstrzygnijZakresPromptu({
            scope: "workflow_template",
            reviewId: "11111111-1111-1111-1111-111111111111",
        });
        expect(wynik.ok).toBe(false);
        if (!wynik.ok) expect(wynik.detail).toContain("must not carry a reviewId");
    });

    it("scope 'review' z reviewId niesie sprawe do straznika", () => {
        const wynik = rozstrzygnijZakresPromptu({
            scope: "review",
            reviewId: "  22222222-2222-2222-2222-222222222222  ",
        });
        expect(wynik).toEqual({
            ok: true,
            zakres: {
                scope: "review",
                reviewId: "22222222-2222-2222-2222-222222222222",
            },
        });
    });

    it("brak scope jest domyslany na 'review' TYLKO gdy jest reviewId", () => {
        // Kierunek bezpieczny: klasyfikacja i tak wyjdzie ze sprawy. Kierunek
        // niebezpieczny (brak sprawy) nigdy nie jest domyslany - patrz pierwszy test.
        const wynik = rozstrzygnijZakresPromptu({
            reviewId: "33333333-3333-3333-3333-333333333333",
        });
        expect(wynik.ok).toBe(true);
        if (wynik.ok) expect(wynik.zakres.scope).toBe("review");
    });

    it("nieznany scope to 400 - lista wartosci jest ZAMKNIETA", () => {
        for (const zly of ["internal", "template", "REVIEW", "workflow"]) {
            const wynik = rozstrzygnijZakresPromptu({ scope: zly, title: "x" });
            expect(wynik.ok, `scope "${zly}" przeszedl`).toBe(false);
        }
        expect([...ZAKRESY_PROMPTU]).toEqual(["review", "workflow_template"]);
    });

    it("nie wywraca sie na body, ktore nie jest obiektem", () => {
        for (const body of [null, undefined, "x", 7, []]) {
            expect(rozstrzygnijZakresPromptu(body).ok).toBe(false);
        }
    });
});
