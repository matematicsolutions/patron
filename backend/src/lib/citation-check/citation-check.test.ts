// "Sprawdz powolania" (ADR-0157) - ekstrakcja lokalna, biala lista wysylki,
// scalenie odpowiedzi po `ref` i - najwazniejsze - dowod, ze do konektora nie
// trafia tresc pisma.
//
// Pismo testowe jest SYNTETYCZNE (strony, adres, kwota wymyslone); sygnatury i
// przepisy to publiczne identyfikatory, ktore ekstraktor ma rozpoznac.

import { describe, expect, it, vi } from "vitest";
import {
    buildVerifyItems,
    checkDocumentCitations,
    extractLocalCitations,
    MAX_CALLS,
    VERIFY_BATCH,
    type LocalCitation,
    type ToolCallResult,
    type VerifyItem,
} from "./index";

const PISMO = [
    "Pozew o zaplate. Powod: Galeria Polnocna Testowa sp. z o.o., ul. Zmyslona 7, Wroclaw.",
    "Pozwany Jan Przykladowy zalega z kwota 48 213,55 zl z tytulu najmu lokalu nr 14.",
    "Podstawa roszczenia jest art. 471 k.c. oraz art. 481 § 1 k.c.",
    "Sad Najwyzszy w uchwale z dnia 7 maja 2021 r., III CZP 6/21, przesadzil zagadnienie.",
    "Por. tez wyrok SN z 12.03.2024, II CSKP 1/24.",
    "Wniosek o zabezpieczenie opiera sie na art. 730 § 1 k.p.c.",
    "Dodatkowo art. 12 ustawy o ochronie konkurencji i konsumentow.",
    "Stosuje sie tez art. 3 ustawy o tlumaczach przysieglych zabytkowych.",
].join("\n");

// Zdania, ktore w pismie NIE sa cytatem - nie wolno im wyjsc w zadnej postaci.
const TAJEMNICE = [
    "Galeria Polnocna Testowa",
    "Zmyslona 7",
    "Jan Przykladowy",
    "48 213,55",
    "najmu lokalu nr 14",
    "zabezpieczenie",
];

/**
 * Szuka w wyslanym ladunku fragmentow pisma spoza cytatow. Okno 10 znakow po
 * normalizacji (male litery, zwiniete biale znaki); okna nachodzace na cytat sa
 * pomijane - sygnatura i akt MAJA wyjsc, reszta pisma nie.
 */
function wyciekiPisma(
    ladunek: string,
    tekst: string,
    cytaty: readonly LocalCitation[],
    okno = 10,
): string[] {
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ");
    const l = norm(ladunek);
    const zajete = new Array<boolean>(tekst.length).fill(false);
    for (const c of cytaty)
        for (let i = c.offset; i < c.offset + c.length; i++) zajete[i] = true;
    const wycieki: string[] = [];
    for (let i = 0; i + okno <= tekst.length; i++) {
        let naCytacie = false;
        for (let j = i; j < i + okno; j++) if (zajete[j]) naCytacie = true;
        if (naCytacie) continue;
        const fragment = norm(tekst.slice(i, i + okno));
        if (fragment.trim().length < okno - 2) continue;
        if (l.includes(fragment)) wycieki.push(fragment);
    }
    return wycieki;
}

describe("extractLocalCitations - lokalnie, z offsetami", () => {
    const { citations, withoutAct } = extractLocalCitations(PISMO);

    it("rozpoznaje sygnatury, przepisy i ustawe spoza listy", () => {
        const sygnatury = citations.filter((c) => c.kind === "signature").map((c) => c.signature);
        expect(sygnatury).toEqual(["III CZP 6/21", "II CSKP 1/24"]);
        const przepisy = citations
            .filter((c) => c.kind === "provision")
            .map((c) => `${c.act_id}|${c.article}`);
        expect(przepisy).toEqual([
            "eli:DU/1964/93|471",
            "eli:DU/1964/93|481",
            "eli:DU/1964/296|730",
            "eli:DU/2007/331|12",
        ]);
        expect(citations.some((c) => c.kind === "unrecognized_act")).toBe(true);
        expect(withoutAct).toBe(0);
    });

    it("offset + dlugosc wskazuja DOKLADNIE fragment pisma (podswietlenie nie zgaduje)", () => {
        expect(citations.length).toBeGreaterThanOrEqual(5);
        for (const c of citations) {
            expect(PISMO.slice(c.offset, c.offset + c.length)).toBe(c.excerpt);
        }
    });

    it("data przy sygnaturze w obu zapisach", () => {
        const byS = new Map(citations.map((c) => [c.signature, c.date_in_text]));
        expect(byS.get("III CZP 6/21")).toBe("2021-05-07");
        expect(byS.get("II CSKP 1/24")).toBe("2024-03-12");
    });

    it("podswietlenie przepisu nie wchodzi w nastepne zdanie", () => {
        const art481 = citations.find((c) => c.article === "481")!;
        expect(art481.excerpt).toBe("art. 481 § 1 k.c.");
        const art730 = citations.find((c) => c.article === "730")!;
        expect(art730.excerpt).toBe("art. 730 § 1 k.p.c.");
    });

    it("podswietlenie konczy sie na skrocie kodeksu, nie na nastepnym artykule (przypadek z zywego E2E)", () => {
        const t = "Odpowiedzialnosc z art. 471 k.c., klauzula z art. 385 1 § 1 k.c.";
        const r = extractLocalCitations(t).citations;
        expect(r.map((c) => c.excerpt)).toEqual(["art. 471 k.c.", "art. 385 1 § 1 k.c."]);
        expect(r.map((c) => c.article)).toEqual(["471", "385^1"]);
        expect(extractLocalCitations("Zob. art. 7 kpa i dalej.").citations[0].excerpt).toBe("art. 7 kpa");
    });

    it("ref jest nieprzezroczysty i unikalny", () => {
        const refs = citations.map((c) => c.ref);
        expect(new Set(refs).size).toBe(refs.length);
        for (const r of refs) expect(r).toMatch(/^c\d+$/);
    });

    it("pismo dluzsze niz okno ekstraktora: cytat za 64 000 znakiem jest znaleziony raz", () => {
        const wypelniacz = "Tekst uzasadnienia bez powolan. ".repeat(2500); // ~80 000 znakow
        const dlugie = `${wypelniacz}Zob. art. 5 k.c. ${wypelniacz}Oraz art. 5 k.c. jeszcze raz.`;
        const r = extractLocalCitations(dlugie);
        expect(r.windows).toBeGreaterThan(1);
        const art5 = r.citations.filter((c) => c.article === "5");
        expect(art5).toHaveLength(1);
        expect(art5[0].occurrences).toBe(2);
        expect(dlugie.slice(art5[0].offset, art5[0].offset + art5[0].length)).toBe(art5[0].excerpt);
    });
});

describe("buildVerifyItems - biala lista pol", () => {
    it("tylko type/signature/date_in_text/ref albo type/act_id/article/ref", () => {
        const items = buildVerifyItems(extractLocalCitations(PISMO).citations);
        expect(items.length).toBe(6);
        for (const it of items) {
            const dozwolone =
                it.type === "signature"
                    ? ["type", "signature", "date_in_text", "ref"]
                    : ["type", "act_id", "article", "ref"];
            for (const k of Object.keys(it)) expect(dozwolone).toContain(k);
        }
    });

    it("ustawa spoza listy (nazwa z pisma) nie wychodzi", () => {
        const items = buildVerifyItems(extractLocalCitations(PISMO).citations);
        expect(JSON.stringify(items)).not.toContain("tlumacz");
    });
});

describe("tresc pisma NIE trafia do konektora", () => {
    it("ladunek wszystkich wywolan nie zawiera zadnego fragmentu pisma spoza cytatow", async () => {
        const wywolania: Record<string, unknown>[] = [];
        const callTool = vi.fn(async (args: Record<string, unknown>): Promise<ToolCallResult> => {
            wywolania.push(structuredClone(args));
            return { text: "{}", structured: { result: { citations: [] } } };
        });
        const res = await checkDocumentCitations({ text: PISMO, callTool });
        expect(callTool).toHaveBeenCalledTimes(1);

        const ladunek = JSON.stringify(wywolania);
        for (const t of TAJEMNICE) expect(ladunek).not.toContain(t);
        expect(wyciekiPisma(ladunek, PISMO, extractLocalCitations(PISMO).citations)).toEqual([]);
        // Klucze wywolania: citations (+ as_of, gdy podany). Nic o pliku.
        for (const w of wywolania) expect(Object.keys(w).sort()).toEqual(["citations"]);
        // To, co zwracamy do pokazania prawnikowi, jest DOKLADNIE tym, co wyszlo.
        expect(res.sent).toEqual(wywolania.map((w) => w.citations));
    });

    it("KONTROLA POZYTYWNA: detektor widzi wyciek, gdy do ladunku dopisac wycinek pisma", () => {
        const cytaty = extractLocalCitations(PISMO).citations;
        const czysty = JSON.stringify(buildVerifyItems(cytaty));
        expect(wyciekiPisma(czysty, PISMO, cytaty)).toEqual([]);
        // Wariant, ktory kusi przy "ulepszaniu": kontekst wokol cytatu dla serwera.
        const zKontekstem = JSON.stringify(
            buildVerifyItems(cytaty).map((it, i) => ({
                ...it,
                context: PISMO.slice(Math.max(0, cytaty[i].offset - 40), cytaty[i].offset),
            })),
        );
        expect(wyciekiPisma(zKontekstem, PISMO, cytaty).length).toBeGreaterThan(0);
        // I sama nazwa strony, bez kontekstu.
        expect(
            wyciekiPisma(`${czysty}"Galeria Polnocna Testowa"`, PISMO, cytaty).length,
        ).toBeGreaterThan(0);
    });

    it("as_of wychodzi tylko wtedy, gdy prawnik go podal", async () => {
        const wywolania: Record<string, unknown>[] = [];
        const callTool = async (args: Record<string, unknown>) => {
            wywolania.push(args);
            return { text: "{}", structured: { result: { citations: [] } } };
        };
        await checkDocumentCitations({ text: PISMO, callTool, asOf: "2024-01-15" });
        expect(wywolania[0].as_of).toBe("2024-01-15");
    });
});

describe("scalenie odpowiedzi po ref", () => {
    function odpowiedz(items: VerifyItem[], statusy: Record<string, Record<string, unknown>>) {
        return {
            text: "",
            structured: {
                snapshot: "pl-test",
                coverage_status: "ok",
                coverage_note: "not_in_corpus NIE dowodzi, ze orzeczenie nie istnieje.",
                result: {
                    as_of: "2026-09-30",
                    checked_on: "2026-09-30",
                    citations: items.map((it) => ({ ref: it.ref, ...(statusy[it.ref] ?? { status: "found" }) })),
                    rejected: [],
                },
            },
        } satisfies ToolCallResult;
    }

    it("status i szczegoly trafiaja do cytatu o tym ref - offset zostaje lokalny", async () => {
        const res = await checkDocumentCitations({
            text: PISMO,
            callTool: async (args) => {
                const items = args.citations as VerifyItem[];
                const syg = items.find((i) => i.type === "signature" && i.signature === "II CSKP 1/24")!;
                return odpowiedz(items, {
                    [syg.ref]: { status: "found", date_mismatch: true, document_ids: ["pl:sn:x"], smiec: 1 },
                });
            },
        });
        expect(res.status).toBe("ok");
        const c = res.citations.find((x) => x.signature === "II CSKP 1/24")!;
        expect(c.status).toBe("found");
        expect(c.details).toEqual({ date_mismatch: true, document_ids: ["pl:sn:x"] });
        expect(PISMO.slice(c.offset, c.offset + c.length)).toBe(c.excerpt);
        expect(res.snapshot).toBe("pl-test");
        expect(res.serverNotes[0]).toContain("NIE dowodzi");
        // Ustawa spoza listy nie byla wyslana - ma stan lokalny, nie "found".
        expect(res.citations.find((x) => x.kind === "unrecognized_act")!.status).toBe("act_not_recognized");
    });

    it("pozycja odrzucona przez serwer (po indeksie) jest nazwana, nie zgubiona", async () => {
        const res = await checkDocumentCitations({
            text: PISMO,
            callTool: async (args) => {
                const items = args.citations as VerifyItem[];
                const r = odpowiedz(items.slice(1), {});
                r.structured.result.rejected = [{ index: 0, ref: null, reason: "signature_invalid" }] as never[];
                return r;
            },
        });
        const pierwsza = res.citations.find((c) => c.ref === "c1")!;
        expect(pierwsza.status).toBe("rejected");
        expect(pierwsza.rejected_reason).toBe("signature_invalid");
    });

    it("brak wyniku dla ref = partial, nie ok", async () => {
        const res = await checkDocumentCitations({
            text: PISMO,
            callTool: async (args) => odpowiedz((args.citations as VerifyItem[]).slice(1), {}),
        });
        expect(res.status).toBe("partial");
        expect(res.citations.find((c) => c.ref === "c1")!.status).toBe("not_checked");
    });

    it("odpowiedz tylko tekstowa (bez structuredContent) tez jest czytana", async () => {
        const res = await checkDocumentCitations({
            text: PISMO,
            callTool: async (args) => {
                const r = odpowiedz(args.citations as VerifyItem[], {});
                return { text: JSON.stringify(r.structured) };
            },
        });
        expect(res.status).toBe("ok");
    });

    it("blad konektora = failed, cytaty zostaja z lokalnym stanem", async () => {
        const res = await checkDocumentCitations({
            text: PISMO,
            callTool: async () => ({ text: '{"error":"x"}', isError: true }),
        });
        expect(res.status).toBe("failed");
        expect(res.failedCalls).toBe(1);
        expect(res.citations.every((c) => c.status !== "found")).toBe(true);
    });

    it("odmowa limitu (koperta bez result) = failed z nota serwera", async () => {
        const res = await checkDocumentCitations({
            text: PISMO,
            callTool: async () => ({
                text: "",
                structured: { result: null, coverage_status: "rate_limited", coverage_note: "Limit wyczerpany." },
            }),
        });
        expect(res.status).toBe("failed");
        expect(res.serverNotes).toEqual(["Limit wyczerpany."]);
    });

    it("bez konektora: not_configured, zero wywolan, cytaty widoczne", async () => {
        const res = await checkDocumentCitations({ text: PISMO, callTool: null });
        expect(res.status).toBe("not_configured");
        expect(res.sent).toEqual([]);
        expect(res.citations.filter((c) => c.status === "not_checked")).toHaveLength(6);
    });

    it("konektor czeka na zatwierdzenie Operatora (B-08): gateway_pending, zero wywolan, cytaty widoczne", async () => {
        const res = await checkDocumentCitations({ text: PISMO, callTool: null, pendingApproval: true });
        expect(res.status).toBe("gateway_pending");
        expect(res.sent).toEqual([]);
        expect(res.citations.filter((c) => c.status === "not_checked")).toHaveLength(6);
    });

    it("partie po 25, najwyzej MAX_CALLS wywolan; nadwyzka nazwana not_sent", async () => {
        const wiele = Array.from({ length: 120 }, (_, i) => `art. ${i + 1} k.c.;`).join("\n");
        const rozmiary: number[] = [];
        const res = await checkDocumentCitations({
            text: wiele,
            callTool: async (args) => {
                const items = args.citations as VerifyItem[];
                rozmiary.push(items.length);
                return odpowiedz(items, {});
            },
        });
        expect(rozmiary).toEqual(Array(MAX_CALLS).fill(VERIFY_BATCH));
        expect(res.notSent).toBe(120 - MAX_CALLS * VERIFY_BATCH);
        expect(res.citations.filter((c) => c.status === "not_sent")).toHaveLength(res.notSent);
        expect(res.status).toBe("partial");
    });
});

describe("ksztalt odpowiedzi wg kontraktu verify_citations (identyfikatory dokumentow syntetyczne)", () => {
    const TEKST = [
        "Zob. uchwale SN z dnia 7 maja 2021 r., III CZP 6/21.",
        "Por. II CKSP 820/23 oraz postanowienie IV KK 168/22.",
        "Odpowiedzialnosc z art. 471 k.c. i klauzula z art. 385 1 § 1 k.c.",
    ].join("\n");
    const KC = "Ustawa z dnia 23 kwietnia 1964 r. - Kodeks cywilny.";
    const wg: Record<string, Record<string, unknown>> = {
        "III CZP 6/21": { type: "signature", status: "found", document_ids: ["test:a"], corpus_dates: ["2021-05-07"], date_in_text: "2021-05-07", date_mismatch: false },
        "II CKSP 820/23": { type: "signature", status: "not_in_corpus", document_ids: [], date_mismatch: null,
            possible_typo_of: { signature: "II CSKP 820/23", document_id: "test:b", date: "2023-10-25", date_matches_text: null } },
        "IV KK 168/22": { type: "signature", status: "ambiguous", document_ids: ["test:c", "test:d"], corpus_dates: ["2023-06-28", "2023-01-17"] },
        "471": { type: "provision", act_id: "eli:DU/1964/93", act_title: KC, provision: "art. 471", status: "no_known_changes_after_date" },
        "385^1": { type: "provision", act_id: "eli:DU/1964/93", act_title: KC, provision: "art. 385^1", status: "changes_unknown",
            note: "Os nowelizacji nie rozroznia przepisow z indeksem gornym.",
            last_change_before_as_of: { data: "2000-07-01", rodzaj: "zmiana", akt: "eli:DU/2000/271" } },
    };

    it("statusy, literowka, akt i nota trafiaja do wlasciwych miejsc pisma", async () => {
        const res = await checkDocumentCitations({
            text: TEKST,
            callTool: async (args) => {
                const items = args.citations as VerifyItem[];
                const citations = items.map((it) => ({
                    ...wg[it.type === "signature" ? it.signature : it.article],
                    ref: it.ref,
                }));
                return {
                    text: "",
                    structured: { snapshot: "pl-test", coverage_status: "ok",
                        result: { as_of: "2026-09-30", checked_on: "2026-09-30", citations, rejected: [] } },
                };
            },
        });
        expect(res.status).toBe("ok");
        const po = (s: string) => res.citations.find((c) => c.signature === s || c.article === s)!;
        expect(po("II CKSP 820/23").status).toBe("not_in_corpus");
        expect(po("II CKSP 820/23").details.possible_typo_of).toMatchObject({ signature: "II CSKP 820/23" });
        expect(po("III CZP 6/21").details.date_mismatch).toBe(false);
        expect(po("IV KK 168/22").status).toBe("ambiguous");
        expect(po("385^1").status).toBe("changes_unknown");
        expect(po("385^1").details.last_change_before_as_of).toMatchObject({ data: "2000-07-01" });
        for (const c of res.citations) expect(TEKST.slice(c.offset, c.offset + c.length)).toBe(c.excerpt);
    });
});

// ---------------------------------------------------------------------------
// Poprawki przegladu 2026-10-02 (R-CC-01/02/03/04/08). Dane syntetyczne.
// ---------------------------------------------------------------------------

async function wyslij(text: string, odp: (items: VerifyItem[]) => unknown = () => ({ result: { citations: [] } })) {
    const calls: VerifyItem[][] = [];
    const res = await checkDocumentCitations({
        text,
        callTool: async (args) => {
            const items = args.citations as VerifyItem[];
            calls.push(items);
            return { text: JSON.stringify(odp(items)) };
        },
    });
    return { res, ladunek: JSON.stringify(calls) };
}

describe("R-CC-01 wychodza tylko sygnatury sadow, bez sygnatury wlasnej sprawy", () => {
    const NAGLOWEK = [
        "Sad Rejonowy, I Wydzial Cywilny",
        "Sygn. akt I C 1234/25",
        "Powod: Jan Testowy, ur. 12.03.1980, zam. ul. Polna 12/24.",
        "Umowa nr KRD 4471/2019, faktura FV 123/2024, akt notarialny Rep. A 5678/2021,",
        "sprawa w kancelarii pod sygn. KAN 45/2025.",
        "Zgodnie z art. 471 k.c. oraz wyrokiem SN z dnia 12 marca 2024 r., II CSKP 1/24.",
        "Por. wyrok NSA z 5.06.2023, I OSK 590/22, i wyrok TK z dnia 22 pazdziernika 2020 r., K 1/20.",
    ].join("\n");

    it("do sieci ida sygnatury z bialej listy i przepisy - nic wiecej", async () => {
        const { ladunek } = await wyslij(NAGLOWEK);
        const sygnatury = (JSON.parse(ladunek) as VerifyItem[][])
            .flat()
            .flatMap((i) => (i.type === "signature" ? [i.signature] : []));
        expect(sygnatury.sort()).toEqual(["I OSK 590/22", "II CSKP 1/24", "K 1/20"]);
        for (const zakaz of ["POLNA", "1980-03-12", "KRD", "FV 123", "A 5678", "KAN 45", "I C 1234"])
            expect(ladunek).not.toContain(zakaz);
        expect(ladunek).toContain('"date_in_text":"2024-03-12"');
    });

    it("zatrzymane pozycje sa widoczne lokalnie jako not_sent z powodem, nigdy zielone", async () => {
        const { res } = await wyslij(NAGLOWEK, (items) => ({
            result: { citations: items.map((i) => ({ ref: i.ref, status: "found" })) },
        }));
        const po = (s: string) => res.citations.find((c) => c.signature === s)!;
        expect(po("I C 1234/25")).toMatchObject({ status: "not_sent", not_sent_reason: "own_case_signature" });
        for (const s of ["POLNA 12/24", "KRD 4471/19", "FV 123/24", "A 5678/21", "KAN 45/25"])
            expect(po(s)).toMatchObject({ status: "not_sent", not_sent_reason: "not_court_signature" });
        expect(res.withheld).toBe(6);
        // Zatrzymane lokalnie nie byly do sprawdzenia - wszystko wyslane sprawdzono.
        expect(res.status).toBe("ok");
        expect(res.notSent).toBe(0);
    });

    it("nadwyzka ponad limit ma powod 'limit' (odroznialny od zatrzymania lokalnego)", async () => {
        const wiele = Array.from({ length: 110 }, (_, i) => `art. ${i + 1} k.c.;`).join("\n");
        const { res } = await wyslij(wiele, (items) => ({
            result: { citations: items.map((i) => ({ ref: i.ref, status: "found" })) },
        }));
        const nadwyzka = res.citations.filter((c) => c.status === "not_sent");
        expect(nadwyzka).toHaveLength(10);
        expect(nadwyzka.every((c) => c.not_sent_reason === "limit")).toBe(true);
        expect(res.status).toBe("partial");
    });

    it("pismo z samymi zatrzymanymi pozycjami: nic nie wychodzi, zero wywolan", async () => {
        const calls: unknown[] = [];
        const res = await checkDocumentCitations({
            text: "Sygn. akt I C 1234/25\nPowod zam. ul. Polna 12/24.",
            callTool: async (args) => {
                calls.push(args);
                return { text: "{}" };
            },
        });
        expect(calls).toEqual([]);
        expect(res.status).toBe("no_citations");
        expect(res.withheld).toBe(2);
    });
});

describe("R-CC-03 znieksztalcona odpowiedz serwera = nieudane wywolanie, nie wyjatek", () => {
    it.each([
        ["null w citations", { result: { citations: [null] } }],
        ["napis w citations", { result: { citations: ["c1"] } }],
        ["tablica w citations", { result: { citations: [[]] } }],
        ["citations nie-tablica", { result: { citations: { c1: "found" } } }],
        ["rejected nie-tablica", { result: { citations: [], rejected: 5 } }],
        ["null w rejected", { result: { citations: [], rejected: [null] } }],
        ["result tablica", { result: [] }],
        ["koperta tablica", []],
        ["koperta null", null],
    ])("%s", async (_n, odp) => {
        const { res } = await wyslij("Podstawa: art. 471 k.c.", () => odp);
        expect(res.status).toBe("failed");
        expect(res.failedCalls).toBe(1);
        expect(res.citations.every((c) => c.status === "not_checked")).toBe(true);
    });

    it("pola o zlym typie nie przechodza: status nie-napis = unknown, snapshot/daty nie-napisy pomijane", async () => {
        const { res } = await wyslij("Podstawa: art. 471 k.c.", (items) => ({
            snapshot: { x: 1 },
            result: {
                as_of: 5,
                checked_on: ["2026"],
                citations: items.map((i) => ({ ref: i.ref, status: { ok: true } })),
                rejected: [{ ref: 7, index: "0", reason: { r: 1 } }],
            },
        }));
        expect(res.citations[0].status).toBe("unknown");
        expect(res.snapshot).toBeNull();
        expect(res.checkedOn).toBeNull();
        expect(res.asOf).toBeNull();
        expect(res.status).toBe("failed"); // nic nie sprawdzono
    });
});

describe("R-CC-04 noty serwera tylko jako napisy", () => {
    it("coverage_note-obiekt jest pomijany, napis zostaje", async () => {
        const ok = (items: VerifyItem[]) => items.map((i) => ({ ref: i.ref, status: "found" }));
        const a = await wyslij("Podstawa: art. 471 k.c.", (items) => ({
            result: { citations: ok(items) },
            coverage_note: { html: "<b>x</b>" },
        }));
        expect(a.res.serverNotes).toEqual([]);
        const b = await wyslij("Podstawa: art. 471 k.c.", (items) => ({
            result: { citations: ok(items) },
            coverage_note: "Korpus do 2026-09-30.",
        }));
        expect(b.res.serverNotes).toEqual(["Korpus do 2026-09-30."]);
    });
});

describe("R-CC-08 wynik serwera tylko dla pozycji z wyslanej partii", () => {
    it("ref niewyslany (ustawa nierozpoznana, pozycja zatrzymana, spoza partii) nie dostaje statusu", async () => {
        const text =
            "Sygn. akt I C 1234/25\nPodstawa: art. 5 ustawy o ochronie zabytkow i opiece nad zabytkami oraz art. 471 k.c.";
        const { res, ladunek } = await wyslij(text, () => ({
            result: {
                citations: ["c1", "c2", "c3", "c99"].map((ref) => ({ ref, status: "found" })),
                rejected: [{ ref: "c1", reason: "x" }, { index: 5, reason: "poza partia" }],
            },
        }));
        const wyslane = (JSON.parse(ladunek) as VerifyItem[][]).flat().map((i) => i.ref);
        expect(wyslane).toEqual(["c3"]);
        expect(res.citations.find((c) => c.ref === "c1")).toMatchObject({
            status: "not_sent",
            not_sent_reason: "own_case_signature",
        });
        expect(res.citations.find((c) => c.ref === "c2")!.status).toBe("act_not_recognized");
        expect(res.citations.find((c) => c.ref === "c3")!.status).toBe("found");
    });

    it("partie: wynik z wywolania 1 nie nadaje stanu pozycji z wywolania 2", async () => {
        const wiele = Array.from({ length: 30 }, (_, i) => `art. ${i + 1} k.c.;`).join("\n");
        let n = 0;
        const res = await checkDocumentCitations({
            text: wiele,
            callTool: async () => {
                n += 1;
                // Pierwsze wywolanie "odpowiada" za wszystkie 30, drugie nie odpowiada wcale.
                return n === 1
                    ? {
                          text: JSON.stringify({
                              result: {
                                  citations: Array.from({ length: 30 }, (_, i) => ({ ref: `c${i + 1}`, status: "found" })),
                              },
                          }),
                      }
                    : { text: "", isError: true };
            },
        });
        expect(res.citations.slice(0, 25).every((c) => c.status === "found")).toBe(true);
        expect(res.citations.slice(25).every((c) => c.status === "not_checked")).toBe(true);
        expect(res.status).toBe("partial");
    });
});

describe("R-CC-02 brak sprawdzenia nigdy nie jest ok", () => {
    it("wszystkie pozycje odrzucone = failed", async () => {
        const { res } = await wyslij("Podstawa: art. 471 k.c. oraz wyrok SN II CSKP 1/24.", (items) => ({
            result: { citations: [], rejected: items.map((i) => ({ ref: i.ref, reason: "limit" })) },
        }));
        expect(res.citations.every((c) => c.status === "rejected")).toBe(true);
        expect(res.status).toBe("failed");
    });

    it("czesc odrzucona = partial, nie ok", async () => {
        const { res } = await wyslij("Podstawa: art. 471 k.c. oraz wyrok SN II CSKP 1/24.", (items) => ({
            result: {
                citations: [{ ref: items[0].ref, status: "found" }],
                rejected: items.slice(1).map((i) => ({ ref: i.ref, reason: "signature_invalid" })),
            },
        }));
        expect(res.status).toBe("partial");
    });

    it("pusta odpowiedz bez wynikow dla zadnej pozycji = failed", async () => {
        const { res } = await wyslij("Podstawa: art. 471 k.c.");
        expect(res.status).toBe("failed");
    });
});
