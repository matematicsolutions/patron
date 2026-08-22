// Bramka slownika produktu (ADR-0148: "sprawa" zastepuje "projekt").
//
// Decyzja byla zaakceptowana 2026-08-21, ale wdrozona w polowie: nawigacja
// mowila "Sprawy", a sama strona nadal "Projekty" - i tylko po polsku oraz
// angielsku, podczas gdy piec pozostalych edycji zostalo przy "Progetti",
// "Projekte", "Proyectos", "Projets", "Projetos". Polprodukt jest gorszy niz
// brak zmiany, bo wyglada na skonczony.
//
// Ten test pilnuje, ze zaden TEKST WIDOCZNY dla uzytkownika nie wraca do starego
// slownictwa. Klucze, trasy i tabele zostaja przy "project" - to swiadomy
// rozdzial nazwy widocznej od identyfikatora, wiec sprawdzamy wylacznie
// WARTOSCI, nigdy nazw kluczy.
//
// PULAPKA, ktora ten test musi rozumiec: po francusku "projet" znaczy takze
// SZKIC pisma ("Projet de réponse"). Slepa zamiana zepsulaby panel draftu,
// dlatego te frazy sa jawnie dopuszczone.

import { describe, expect, it } from "vitest";
import { pl } from "./pl";
import { en } from "./en";
import { it as itDict } from "./it";
import { de } from "./de";
import { es } from "./es";
import { fr } from "./fr";
import { pt } from "./pt";

/** Stare slownictwo per edycja - rdzen, zeby zlapac takze odmiany. */
const STARE_SLOWO: Record<string, string> = {
    pl: "projek",
    en: "project",
    it: "progett",
    de: "projekt",
    es: "proyect",
    fr: "projet",
    pt: "projet",
};

/** Frazy, w ktorych slowo znaczy SZKIC pisma, nie sprawe (FR). */
const DOZWOLONE = new Set([
    "Projet de réponse",
    "Projet finalisé",
    "Comment le projet a été élaboré",
]);

type Dict = Record<string, unknown>;

function wartosci(obj: Dict, sciezka = ""): [string, string][] {
    const out: [string, string][] = [];
    for (const [k, v] of Object.entries(obj)) {
        const gdzie = sciezka ? `${sciezka}.${k}` : k;
        if (typeof v === "string") out.push([gdzie, v]);
        else if (v && typeof v === "object") out.push(...wartosci(v as Dict, gdzie));
    }
    return out;
}

const SLOWNIKI: [string, Dict][] = [
    ["pl", pl as unknown as Dict],
    ["en", en as unknown as Dict],
    ["it", itDict as unknown as Dict],
    ["de", de as unknown as Dict],
    ["es", es as unknown as Dict],
    ["fr", fr as unknown as Dict],
    ["pt", pt as unknown as Dict],
];

describe("slownik produktu mowi o SPRAWIE, nie o projekcie (ADR-0148)", () => {
    it("kontrola pozytywna: skan faktycznie widzi teksty we wszystkich edycjach", () => {
        for (const [kod, dict] of SLOWNIKI) {
            expect(wartosci(dict).length, `${kod} wyglada na pusty`).toBeGreaterThan(50);
        }
    });

    it.each(SLOWNIKI)("edycja %s nie uzywa juz starego slownictwa", (kod, dict) => {
        const stare = STARE_SLOWO[kod]!;
        const winne = wartosci(dict)
            .filter(([, v]) => v.toLowerCase().includes(stare))
            .filter(([, v]) => !DOZWOLONE.has(v));

        expect(
            winne.map(([k, v]) => `${k} = "${v}"`),
            `Edycja ${kod} wrocila do slownictwa sprzed ADR-0148. ` +
                "Klucze zostaja przy 'project' celowo - zmieniaj WARTOSC, nie klucz.",
        ).toEqual([]);
    });

    it("kazda edycja nazywa Warsztat i Sprawy wlasnym slowem", () => {
        for (const [kod, dict] of SLOWNIKI) {
            const mapa = Object.fromEntries(wartosci(dict));
            // Edycje niepelne moga dziedziczyc po PL - sprawdzamy tylko to,
            // co edycja faktycznie definiuje.
            for (const klucz of ["nav.assistant", "nav.projects"]) {
                const v = mapa[klucz];
                if (v === undefined) continue;
                expect(v.trim().length, `${kod}: ${klucz} jest puste`).toBeGreaterThan(2);
            }
        }
    });
});
