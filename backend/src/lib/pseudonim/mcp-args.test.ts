// A-09 / B-11 (decyzja 2026-10-06): argumenty zewnetrznych konektorow MCP.
// Dane syntetyczne (PESEL i NIP z poprawna suma kontrolna).
import { describe, expect, it } from "vitest";
import { isValidNip, isValidPesel } from "../pl-entities/checksums";
import { addPseudonim, createPseudonimMap } from "./map";
import { MCP_REHYDRATABLE_CATEGORIES, prepareMcpToolArgs, unwrapCategories } from "./mcp-args";
import { unwrap } from "./wrap";

const PESEL = "90010112349";
const PESEL_LITERAL = "85071202931";
const NIP = "5260250274";
const EMAIL = "jan.testowy@example.com";

function mapa() {
    const m = createPseudonimMap();
    addPseudonim(m, "ORG", "Testowa Spolka sp. z o.o.");
    addPseudonim(m, "NIP", NIP);
    addPseudonim(m, "REGON", "123456785");
    addPseudonim(m, "KRS", "0000123456");
    addPseudonim(m, "PERSON", "Jan Testowy");
    addPseudonim(m, "PESEL", PESEL);
    addPseudonim(m, "ADDRESS", "ul. Testowa 1, 00-001 Warszawa");
    addPseudonim(m, "EMAIL", EMAIL);
    addPseudonim(m, "PHONE", "+48 600 100 200");
    return m;
}

describe("dane syntetyczne", () => {
    it("PESEL-e i NIP maja poprawne sumy kontrolne (inaczej test niczego nie dowodzi)", () => {
        expect(isValidPesel(PESEL)).toBe(true);
        expect(isValidPesel(PESEL_LITERAL)).toBe(true);
        expect(isValidNip(NIP)).toBe(true);
    });
});

describe("MCP_REHYDRATABLE_CATEGORIES", () => {
    it("tylko podmioty rejestrow publicznych - zadnej kategorii osobowej", () => {
        expect([...MCP_REHYDRATABLE_CATEGORIES].sort()).toEqual(["KRS", "NIP", "ORG", "REGON"]);
    });
});

describe("unwrapCategories", () => {
    it("odtwarza dozwolone kategorie, reszte zostawia tokenem i liczy", () => {
        const m = mapa();
        const withheld: Record<string, number> = {};
        const out = unwrapCategories(
            "[ORG_1] NIP [NIP_1] vs [PERSON_1] [PERSON_1] [PESEL_1]",
            m,
            MCP_REHYDRATABLE_CATEGORIES,
            withheld,
        );
        expect(out).toBe(`Testowa Spolka sp. z o.o. NIP ${NIP} vs [PERSON_1] [PERSON_1] [PESEL_1]`);
        expect(withheld).toEqual({ PERSON: 2, PESEL: 1 });
    });

    it("bez aliasingu [ORG_1] / [ORG_10]", () => {
        const m = createPseudonimMap();
        for (let i = 1; i <= 10; i++) addPseudonim(m, "ORG", `Firma ${i} S.A.`);
        expect(unwrapCategories("[ORG_10] i [ORG_1]", m, MCP_REHYDRATABLE_CATEGORIES)).toBe(
            "Firma 10 S.A. i Firma 1 S.A.",
        );
    });
});

describe("prepareMcpToolArgs", () => {
    it("ORG/NIP/REGON/KRS odtworzone; PERSON/PESEL/ADDRESS/EMAIL/PHONE zostaja tokenem", () => {
        const m = mapa();
        const r = prepareMcpToolArgs(
            {
                query: "[ORG_1] [NIP_1] [REGON_1] [KRS_1]",
                party: "[PERSON_1] [PESEL_1] [ADDRESS_1] [EMAIL_1] [PHONE_1]",
            },
            m,
        );
        const args = r.args as { query: string; party: string };
        expect(args.query).toBe(`Testowa Spolka sp. z o.o. ${NIP} 123456785 0000123456`);
        expect(args.party).toBe("[PERSON_1] [PESEL_1] [ADDRESS_1] [EMAIL_1] [PHONE_1]");
        expect(JSON.stringify(r.args)).not.toContain(PESEL);
        expect(JSON.stringify(r.args)).not.toContain("Jan Testowy");
        expect(r.tokensWithheld).toEqual({ PERSON: 1, PESEL: 1, ADDRESS: 1, EMAIL: 1, PHONE: 1 });
        expect(r.redacted).toEqual({});
    });

    it("PESEL wpisany doslownie: znany z mapy -> token mapy; spoza mapy -> znacznik; licznik bez wartosci", () => {
        const m = mapa();
        const r = prepareMcpToolArgs({ query: `strona ${PESEL} oraz ${PESEL_LITERAL}` }, m);
        expect((r.args as { query: string }).query).toBe("strona [PESEL_1] oraz [PESEL_REDACTED]");
        expect(r.redacted).toEqual({ PESEL: 2 });
        expect(JSON.stringify(r.redacted)).not.toContain(PESEL_LITERAL);
    });

    it("bez mapy (model lokalny / dane publiczne) dziala sam DLP: PESEL i e-mail wyciete", () => {
        const r = prepareMcpToolArgs(
            { query: `Jan Testowy ${PESEL_LITERAL} ul. Testowa 1`, contact: [EMAIL], n: Number(PESEL_LITERAL) },
            null,
        );
        const s = JSON.stringify(r.args);
        expect(s).not.toContain(PESEL_LITERAL);
        expect(s).not.toContain(EMAIL);
        expect(r.args).toEqual({
            query: "Jan Testowy [PESEL_REDACTED] ul. Testowa 1",
            contact: ["[EMAIL_REDACTED]"],
            n: "[PESEL_REDACTED]",
        });
        expect(r.redacted).toEqual({ PESEL: 2, EMAIL: 1 });
    });

    it("ciag 11 cyfr bez poprawnej sumy (np. sygnatura, numer) nie jest ruszany", () => {
        const r = prepareMcpToolArgs({ query: "12345678901", year: 2024, flag: true }, null);
        expect(r.args).toEqual({ query: "12345678901", year: 2024, flag: true });
        expect(r.redacted).toEqual({});
    });

    it("NIP odtworzony z mapy nie jest wycinany przez DLP (to nie PESEL ani e-mail)", () => {
        const r = prepareMcpToolArgs({ nip: "[NIP_1]" }, mapa());
        expect(r.args).toEqual({ nip: NIP });
        expect(r.redacted).toEqual({});
    });

    it("parytet: narzedzie lokalne dalej dostaje pelne odtworzenie (unwrap)", () => {
        const m = mapa();
        expect(unwrap("Pan [PERSON_1], PESEL [PESEL_1]", m)).toBe(`Pan Jan Testowy, PESEL ${PESEL}`);
    });
});
