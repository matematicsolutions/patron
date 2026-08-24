// Czy widoki NAPRAWDE uzywaja slownika.
//
// i18n.test.ts pilnuje PARYTETU slownikow - i przechodzil, gdy slowniki byly
// kompletne, a komponenty i tak renderowaly angielski na sztywno. Zmierzone
// 2026-08-23 na wydaniu 1.2.0: panel cytatu pokazywal "Citation", "Download"
// i "(Page 1)" w polskim interfejsie, lista workflowow - "Name", "Type",
// "Practice", "Source", "All", "Built-in", "Custom", "Hidden". Klucze na te
// napisy juz istnialy w pl.ts; brakowalo tylko ich uzycia.
//
// Ten test patrzy z drugiej strony niz i18n.test.ts: nie na slownik, tylko na
// widok. Zakres jest CELOWO waski - lista plikow, ktore ogladaja klienci -
// zeby bramka nie krzyczala bez powodu; bramka, ktora krzyczy, zostaje
// wylaczona przy trzeciej korekcie.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const KORZEN = join(__dirname, "..");

// Powierzchnie, ktore widzi klient kancelarii i widz na demo.
const PILNOWANE = [
    "app/components/shared/DocPanel.tsx",
    "app/components/shared/types.ts",
    "app/components/workflows/WorkflowList.tsx",
];

// Napisy interfejsu, ktore juz maja swoj klucz w pl.ts. Lista jest jawna,
// zeby test mowil "ten konkretny napis", a nie "cos tu jest po angielsku".
const ZAKAZANE: Array<{ wzor: RegExp; opis: string }> = [
    { wzor: />\s*Citation\s*</, opis: '">Citation<" zamiast t("citations.cardLabel")' },
    { wzor: />\s*Tracked Change\s*</, opis: '">Tracked Change<" zamiast t("citations.trackedChange")' },
    { wzor: /^\s*Download\s*$/m, opis: '"Download" zamiast t("common.download")' },
    { wzor: /`Page \$\{/, opis: '"Page ${...}" zamiast t("citations.page")' },
    { wzor: /label="(Name|Type|Practice|Source)"/, opis: 'naglowek kolumny na sztywno zamiast t("workflows.*")' },
    { wzor: /label:\s*"(All|Built-in|Custom|Hidden)"/, opis: 'etykieta zakladki na sztywno zamiast t("workflows.*")' },
    { wzor: /placeholder="Search workflows/, opis: 'placeholder na sztywno zamiast t("workflows.searchPlaceholder")' },
];

describe("i18n - widoki uzywaja slownika, nie napisow na sztywno", () => {
    // KONTROLA POZYTYWNA: bramka z pusta lista przechodzi zawsze. Najpierw
    // udowodnij, ze w ogole jest co skanowac, dopiero potem ze jest czysto.
    it("skanuje komplet pilnowanych plikow", () => {
        expect(PILNOWANE.length).toBeGreaterThanOrEqual(3);
        for (const rel of PILNOWANE) {
            expect(existsSync(join(KORZEN, rel)), `brak pliku ${rel}`).toBe(true);
            expect(readFileSync(join(KORZEN, rel), "utf8").length).toBeGreaterThan(500);
        }
    });

    it("pilnowane widoki nie renderuja angielskich napisow na sztywno", () => {
        const znalezione: string[] = [];
        for (const rel of PILNOWANE) {
            const tresc = readFileSync(join(KORZEN, rel), "utf8");
            for (const { wzor, opis } of ZAKAZANE) {
                if (wzor.test(tresc)) znalezione.push(`${rel}: ${opis}`);
            }
        }
        expect(znalezione).toEqual([]);
    });

    it("pilnowane widoki siegaja po t() ze slownika", () => {
        for (const rel of PILNOWANE) {
            const tresc = readFileSync(join(KORZEN, rel), "utf8");
            expect(tresc, `${rel} nie importuje t() z @/i18n`).toMatch(
                /from "@\/i18n"/,
            );
        }
    });
});
