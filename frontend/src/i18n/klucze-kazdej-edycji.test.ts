// Klucze, ktore MUSZA miec tlumaczenie w kazdym slowniku rynkowym.
//
// Slowniki rynkowe sa czesciowe (fallback EN -> PL), wiec brak klucza nie psuje
// buildu - pokazuje polski napis. Zmierzone 2026-10-10: po wyciagnieciu przelacznika
// zgody na model chmurowy do slownika usuniecie klucza z en.ts przechodzilo przez
// wszystkie testy, a mecenas w Londynie znow widzialby "Model chmurowy". Dla napisow
// ponizej fallback NIE jest akceptowalny: to glowny ekran sprawy i jedyna droga do
// chmury w sprawie objetej tajemnica.
import { describe, expect, it } from "vitest";
import { de } from "./de";
import { en } from "./en";
import { es } from "./es";
import { fr } from "./fr";
import { it as itDict } from "./it";
import { pt } from "./pt";
import { pl } from "./pl";

const RYNKI: Record<string, unknown> = { en, it: itDict, de, es, fr, pt };

const OBOWIAZKOWE = [
    "projects.cloudConsentLabel",
    "projects.cloudConsentHint",
    "projects.nameColumn",
    "projects.typeColumn",
    "projects.sizeColumn",
    "projects.versionColumn",
    "projects.createdColumn",
    "projects.updatedColumn",
    "projects.uploadingStatus",
    "projects.removeFromSubfolder",
    "projects.bulkFailedTitle",
    "projects.bulkDeleteFailed",
    "projects.bulkMoveFailed",
    "projects.actions",
    "workflows.actions",
    "common.download",
    "common.delete",
];

function wartosc(slownik: unknown, klucz: string): unknown {
    return klucz.split(".").reduce<unknown>(
        (o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), slownik);
}

describe("i18n - klucze obowiazkowe w kazdym slowniku rynkowym", () => {
    it("mianownik: 6 slownikow rynkowych i niepusta lista kluczy, kazdy klucz istnieje w pl.ts", () => {
        expect(Object.keys(RYNKI)).toHaveLength(6);
        expect(OBOWIAZKOWE.length).toBeGreaterThan(0);
        expect(OBOWIAZKOWE.filter((k) => typeof wartosc(pl, k) !== "string")).toEqual([]);
    });

    it("kazdy slownik rynkowy ma wlasne, niepuste tlumaczenie", () => {
        const braki: string[] = [];
        for (const [rynek, slownik] of Object.entries(RYNKI)) {
            for (const k of OBOWIAZKOWE) {
                const v = wartosc(slownik, k);
                if (typeof v !== "string" || v.trim() === "") braki.push(`${rynek}: ${k}`);
            }
        }
        expect(braki).toEqual([]);
    });

    it("etykieta zgody na chmure nie jest polska poza edycja PL", () => {
        const polskie = Object.entries(RYNKI)
            .filter(([, s]) => wartosc(s, "projects.cloudConsentLabel") === wartosc(pl, "projects.cloudConsentLabel"))
            .map(([r]) => r);
        expect(polskie).toEqual([]);
    });
});
