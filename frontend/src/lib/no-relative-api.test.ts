// Bramka na regresje, ktora raz juz uciszyla trzy powierzchnie zgodnosciowe -
// a potem, MIMO ISTNIENIA tej bramki, zabila dwie najwazniejsze funkcje produktu.
//
// Historia w dwoch aktach:
//
// 1. 2026-08-21: useEgressConfig, useMcpSecurityStatus i usePackUpdates wolaly
//    sciezki WZGLEDNE. Frontend stoi na 3000, backend na 3001, proxy nie ma -
//    kazdy taki fetch dostawal 404 z originu frontendu, hook zwracal null,
//    a baner nie renderowal sie w ogole. Trzy powierzchnie zgodnosciowe byly
//    martwe, a brak banera czytalo sie jako "wszystko w porzadku".
//
// 2. 2026-08-22, przebieg bojowy na ZAINSTALOWANEJ aplikacji: bramka swiecila
//    na zielono, a mimo to `components/audit-export-button` i
//    `components/merkle-verify-button` wolaly backend sciezka wzgledna. Czyli
//    TECZKA DOWODOWA i WERYFIKACJA PIECZECI - jedyne funkcje, ktorych nie ma
//    zaden konkurent w kategorii - nie dzialaly w spakowanej paczce.
//    Powod: pierwsza wersja bramki skanowala WYLACZNIE `src/hooks/`, bo tam
//    znaleziono pierwszy przypadek.
//
// LEKCJA: kontrola pozytywna WZORCA nie wykryje zle zawezonego MIANOWNIKA.
// Dlatego pierwszy test sprawdza, co skan w ogole obejmuje.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_DIR = join(__dirname, "..");

/** Literal stringowy zaczynajacy sie od "/api/" - czyli adres bez hosta. */
const RELATIVE_API = /["'`]\/api\//;

/** Sciezka z separatorami "/" niezaleznie od systemu. */
const naSlashe = (p: string): string => p.split(sep).join("/");

/**
 * Znany, JAWNY dlug - endpoint, ktorego nie ma po ZADNEJ stronie.
 * Formularz wsparcia strzela pod /api/support: nie istnieje ani jako trasa
 * Next (brak katalogu app/api), ani jako router backendu. Wysylka konczy sie
 * bledem zawsze - ale pada GLOSNO, wiec nie jest to cicha awaria. Kanal
 * kontaktu idzie na zewnatrz, czyli jest decyzja biznesowa, nie techniczna:
 * zapisany tutaj z nazwa pliku, zamiast schowany pod dywan.
 */
const ZNANE_MARTWE = ["app/support/page.tsx"];

function zrodla(dir: string, acc: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === ".next") continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) zrodla(full, acc);
        else if (
            (entry.endsWith(".ts") || entry.endsWith(".tsx")) &&
            !entry.endsWith(".test.ts") &&
            !entry.endsWith(".test.tsx")
        ) {
            acc.push(full);
        }
    }
    return acc;
}

function plikiDoSkanu(): string[] {
    return zrodla(SRC_DIR).filter(
        (f) => !ZNANE_MARTWE.some((z) => naSlashe(f).endsWith(z)),
    );
}

describe("front nie wola backendu sciezka wzgledna", () => {
    it("skan obejmuje CALY front - kontrola pozytywna MIANOWNIKA", () => {
        const pliki = plikiDoSkanu();
        expect(pliki.length).toBeGreaterThan(50);
        for (const katalog of ["/components/", "/hooks/", "/app/"]) {
            expect(
                pliki.some((f) => naSlashe(f).includes(katalog)),
                `${katalog} poza skanem - dokladnie tak powstal martwy eksport teczki`,
            ).toBe(true);
        }
    });

    it("zaden plik nie wola backendu sciezka wzgledna", () => {
        const winne: string[] = [];

        for (const file of plikiDoSkanu()) {
            const src = readFileSync(file, "utf8");
            // patronApi.ts sklada adres w apiRequest(), ktory dokleja API_BASE -
            // tam sciezka wzgledna jest ARGUMENTEM, nie adresem fetcha.
            if (src.includes("${API_BASE}${path}")) continue;

            src.split("\n").forEach((raw, i) => {
                const line = raw.trim();
                if (!RELATIVE_API.test(line)) return;
                if (line.startsWith("//") || line.startsWith("*")) return;
                if (line.includes("apiUrl(")) return;
                const krotka = naSlashe(file).split("/src/")[1] ?? file;
                winne.push(`${krotka}:${i + 1}`);
            });
        }

        expect(
            winne,
            "Adres backendu bez hosta trafia na origin frontendu (404), wiec funkcja " +
                "umiera po cichu w spakowanej aplikacji. Uzyj apiUrl() z @/lib/apiBase.",
        ).toEqual([]);
    });
});
