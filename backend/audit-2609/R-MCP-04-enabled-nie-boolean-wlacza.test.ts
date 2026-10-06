// R-MCP-04: Nakladka z `enabled` innym niz boolean (np. "false", null) WLACZA
// konektor, ktory instalator wozi wylaczony.
//
// mergeOperatorOverlay kopiuje `enabled` bez walidacji typu (operator-overlay.ts:87-88:
// kazda wartosc !== undefined), a loadConfig (index.ts:163) wylacza tylko przy
// `enabled === false`. Wpis {"enabled": "false"} - recznie, jak kaze ADR-0157 - nadpisuje
// `enabled:false` instalatora i konektor startuje. Bez ostrzezenia (ostrzezenie jest
// tylko dla NIEDOZWOLONYCH pol, nie dla zlego typu dozwolonego). ADR-0166 pkt 2:
// "Wpis ... w zlym ksztalcie: pominiety z ostrzezeniem, nie po cichu".
import { describe, expect, it } from "vitest";
import { mergeOperatorOverlay } from "../src/lib/mcp/operator-overlay";

const US = { name: "us-eli", transport: "stdio", command: "py-runtime/python.exe", args: [], enabled: false };

describe("R-MCP-04 enabled nie-boolean w nakladce", () => {
    it.each([["napis 'false'", "false"], ["null", null], ["0", 0]])(
        "%s nie wlacza konektora wylaczonego przez instalator",
        (_opis, wartosc) => {
            const { configs, warnings } = mergeOperatorOverlay([US], [{ name: "us-eli", enabled: wartosc }]);
            const startuje = configs.filter((s) => s.enabled !== false).some((s) => s.name === "us-eli");
            expect({ startuje, ostrzezenie: warnings.length > 0 }).toEqual({ startuje: false, ostrzezenie: true });
        },
    );
});
