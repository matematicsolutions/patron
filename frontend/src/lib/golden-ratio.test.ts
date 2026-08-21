// Bramka zlotego podzialu (regula stala WM, 2026-08-21: "zawsze stosuj zloty
// podzial, na kazdej stronie").
//
// Regula bez bramki nie trzyma: proporcja wpisana raz w piksele wykrusza sie
// przy pierwszym "tylko troche szerzej". Dlatego podzial zyje w TOKENACH
// (--gold-major / --gold-minor dla pionu, --rail-ratio dla trzeciej strefy),
// a ten test pilnuje, ze tokeny sa zlote arytmetycznie ORAZ ze komponenty
// ukladu biora z nich szerokosc, a nie z reki.
//
// Lekcja z pomiaru na zywo (2026-08-21): pierwsza wersja miala rail o stalej
// szerokosci 25,5rem i bylo to ZLE - φ wychodzilo tylko przy jednej szerokosci
// okna, a przy 1280 px stosunek spadal do 1,29. Dlatego niezmiennikiem jest
// UDZIAL, nie liczba, a test pilnuje takze tego, ze nikt nie wroci do wartosci
// stalej.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..");
const CSS = readFileSync(join(SRC, "app", "globals.css"), "utf8");

const PHI = 1.618;

function token(name: string): string {
    const m = CSS.match(new RegExp(`--${name}:\\s*([^;]+);`));
    if (!m) throw new Error(`brak tokenu --${name} w globals.css`);
    return m[1]!.trim();
}

function tsxFiles(dir: string, acc: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === ".next") continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) tsxFiles(full, acc);
        else if (entry.endsWith(".tsx")) acc.push(full);
    }
    return acc;
}

describe("zloty podzial jako token, nie jako pamiec projektanta", () => {
    it("wagi pionu sa zlote - blok tresci stoi na 38,2%, nie na srodku", () => {
        const major = Number(token("gold-major"));
        const minor = Number(token("gold-minor"));
        expect(major / minor).toBeCloseTo(PHI, 2);
        // Kontrola sensu: minor MUSI byc mniejszy, inaczej blok spadnie
        // ponizej srodka i caly zabieg dziala odwrotnie.
        expect(minor).toBeLessThan(major);
    });

    it("udzial marginesu dowodu to mniejsza czesc podzialu: 1/(1+φ)", () => {
        const ratio = Number(token("rail-ratio"));
        expect(ratio).toBeCloseTo(1 / (1 + PHI), 3);
        // Rownowazny warunek od drugiej strony - tekst do marginesu ma sie jak φ.
        expect((1 - ratio) / ratio).toBeCloseTo(PHI, 2);
    });

    it("margines jest UDZIALEM, nie stala szerokoscia", () => {
        // Wartosc stala daje zloty podzial przy jednej szerokosci okna i psuje
        // go przy kazdej innej - zmierzone: 1,29 zamiast 1,618 przy 1280 px.
        expect(CSS).not.toMatch(/--rail:\s*[\d.]+rem/);
        expect(CSS).not.toMatch(/--rail-reserve:/);
    });

    it("kontrola pozytywna: komponenty faktycznie licza z tokenu udzialu", () => {
        const uses = tsxFiles(SRC).filter((f) =>
            readFileSync(f, "utf8").includes("var(--rail-ratio)"),
        );
        // Gdyby ten warunek nie swiecil, test ponizej ("brak sztywnych
        // szerokosci") przechodzilby na slepo - bo skan nie widzialby niczego.
        expect(uses.length).toBeGreaterThan(0);
    });

    it("rynna jest odejmowana PRZED podzialem, nie doliczana do kolumny", () => {
        // Wzorzec (100% - rynna) * udzial. Policzenie rynny po stronie jednej
        // z kolumn przesuwa stosunek o kilka procent i cichaczem psuje regule.
        const uses = tsxFiles(SRC)
            .map((f) => readFileSync(f, "utf8"))
            .filter((s) => s.includes("var(--rail-ratio)"));
        for (const src of uses) {
            expect(src).toMatch(/100%\s*-\s*[^)]*var\(--rail-gap\)/);
        }
    });

    it("zadna kolumna ukladu nie ma szerokosci wpisanej z reki", () => {
        // Historyczne wartosci sprzed tokenizacji; kazdy powrot do nich
        // oznacza, ze proporcja znowu zostala ustawiona "na oko".
        const zakazane = /(?:w|pr)-\[(?:1[789]|2[0-9])(?:\.\d+)?rem\]/;
        const winne = tsxFiles(SRC).filter((f) =>
            zakazane.test(readFileSync(f, "utf8")),
        );
        expect(
            winne.map((f) => f.replace(SRC, "src")),
            "Szerokosc kolumny licz z var(--rail-ratio), nie z liczby - " +
                "inaczej zloty podzial trzyma tylko przy jednej szerokosci okna.",
        ).toEqual([]);
    });
});
