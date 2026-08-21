// Bramka zlotego podzialu (regula stala WM, 2026-08-21: "zawsze stosuj zloty
// podzial, na kazdej stronie").
//
// Regula bez bramki nie trzyma: proporcja wpisana raz w piksele wykrusza sie
// przy pierwszym "tylko troche szerzej". Dlatego podzial zyje w TOKENACH
// (--gold-major / --gold-minor dla pionu, --rail / --rail-gap dla trzeciej
// strefy), a ten test pilnuje dwoch rzeczy naraz: ze tokeny sa zlote
// arytmetycznie ORAZ ze komponenty ukladu biora szerokosc z nich, a nie
// z reki.

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

    it("margines dowodu dzieli szerokosc w proporcji phi (rynna poza podzialem)", () => {
        // Kontener roboczy przy xl: max-w-6xl (72rem) minus padding 2x2rem.
        const inner = 72 - 4; // rem
        const gap = parseFloat(token("rail-gap"));
        const rail = parseFloat(token("rail"));
        const text = inner - gap - rail;
        // Rynna nie nalezy do zadnej kolumny - dzielimy to, co po niej zostaje.
        expect(text / rail).toBeGreaterThan(1.55);
        expect(text / rail).toBeLessThan(1.69);
    });

    it("rezerwa marginesu to margines plus rynna - kolumna tekstu nie skacze", () => {
        const reserve = token("rail-reserve");
        expect(reserve).toContain("var(--rail)");
        expect(reserve).toContain("var(--rail-gap)");
    });

    it("kontrola pozytywna: komponenty faktycznie biora szerokosc z tokenu", () => {
        const uses = tsxFiles(SRC).filter((f) =>
            readFileSync(f, "utf8").includes("var(--rail)"),
        );
        // Gdyby ten warunek nie swiecil, test ponizej ("brak sztywnych
        // szerokosci") przechodzilby na slepo - bo skan nie widzialby niczego.
        expect(uses.length).toBeGreaterThan(0);
    });

    it("zadna kolumna ukladu nie ma szerokosci wpisanej z reki", () => {
        // Historyczne wartosci sprzed tokenizacji; kazdy powrot do nich
        // oznacza, ze proporcja znowu zostala ustawiona "na oko".
        const zakazane = /(?:w|pr)-\[1[789](?:\.\d+)?rem\]/;
        const winne = tsxFiles(SRC).filter((f) =>
            zakazane.test(readFileSync(f, "utf8")),
        );
        expect(
            winne.map((f) => f.replace(SRC, "src")),
            "Szerokosc kolumny bierz z var(--rail) / var(--rail-reserve), " +
                "nie z liczby - inaczej zloty podzial rozjedzie sie po pierwszej korekcie.",
        ).toEqual([]);
    });
});
