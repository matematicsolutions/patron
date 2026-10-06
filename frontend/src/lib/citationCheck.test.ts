// "Sprawdź powołania" (ADR-0157) - czyste funkcje widoku.
import { describe, expect, it } from "vitest";
import { t } from "@/i18n";
import {
    buildReportHtml,
    detailLines,
    fill,
    highlightSegments,
    reportFilename,
    severityOf,
    statusLabel,
    type CheckedCitation,
    type CheckedResponse,
} from "./citationCheck";

const TEKST = "Zob. art. 471 k.c. oraz wyrok SN II CSKP 1/24 <script>x</script>.";

function cyt(over: Partial<CheckedCitation>): CheckedCitation {
    return {
        ref: "c1",
        kind: "signature",
        offset: 0,
        length: 1,
        excerpt: "",
        occurrences: 1,
        status: "found",
        details: {},
        ...over,
    };
}

const art = cyt({
    ref: "c1",
    kind: "provision",
    offset: TEKST.indexOf("art. 471"),
    length: "art. 471 k.c.".length,
    excerpt: "art. 471 k.c.",
    act_id: "eli:DU/1964/93",
    act_name: "Kodeks cywilny",
    article: "471",
    status: "no_known_changes_after_date",
});
const syg = cyt({
    ref: "c2",
    offset: TEKST.indexOf("II CSKP"),
    length: "II CSKP 1/24".length,
    excerpt: "II CSKP 1/24",
    signature: "II CSKP 1/24",
    status: "not_in_corpus",
    details: { possible_typo_of: { signature: "II CKSP 1/24<b>" } },
});

describe("severityOf", () => {
    it("brak w korpusie = uwaga, nie ok", () => {
        expect(severityOf({ status: "not_in_corpus", details: {} })).toBe("attention");
    });
    it("znaleziona z niezgodną datą schodzi z ok", () => {
        expect(severityOf({ status: "found", details: { date_mismatch: true } })).toBe("attention");
        expect(severityOf({ status: "found", details: { date_mismatch: false } })).toBe("ok");
    });
    it("stany lokalne i nieznane nie udają zielonych", () => {
        for (const s of ["not_checked", "not_sent", "rejected", "act_not_recognized", "cos_nowego"])
            expect(severityOf({ status: s, details: {} })).toBe("none");
    });
});

describe("statusLabel", () => {
    it("nieznany status serwera jest pokazany wprost", () => {
        expect(statusLabel("cos_nowego")).toContain("cos_nowego");
    });
    it("znany status ma etykietę ze słownika", () => {
        expect(statusLabel("not_in_corpus")).not.toContain("citationCheck.");
    });
});

describe("highlightSegments", () => {
    it("składa się z powrotem w CAŁY tekst, podświetlone kawałki to fragmenty powołań", () => {
        const seg = highlightSegments(TEKST, [syg, art]);
        expect(seg.map((s) => s.text).join("")).toBe(TEKST);
        expect(seg.filter((s) => s.ref).map((s) => s.text)).toEqual(["art. 471 k.c.", "II CSKP 1/24"]);
    });
    it("zakres nakładający się jest pomijany, nie podświetlany krzywo", () => {
        const zly = { ref: "c9", offset: art.offset + 2, length: 5 };
        const seg = highlightSegments(TEKST, [art, zly]);
        expect(seg.some((s) => s.ref === "c9")).toBe(false);
        expect(seg.map((s) => s.text).join("")).toBe(TEKST);
    });
});

describe("buildReportHtml", () => {
    const r: CheckedResponse = {
        status: "partial",
        filename: "pismo <klienta>.docx",
        verifier: "repertorium",
        text: TEKST,
        citations: [art, syg],
        withoutAct: 1,
        windows: 1,
        sent: [[{ type: "signature", signature: "II CSKP 1/24", ref: "c2" }]],
        notSent: 0,
        asOf: null,
        checkedOn: "2026-09-30",
        snapshot: "pl-2026-09",
        serverNotes: ["nota <i>serwera</i>"],
        failedCalls: 0,
    };
    const html = buildReportHtml(r, new Date("2026-09-30T10:00:00Z"));

    it("escapuje wszystko, co przyszło z pisma i z serwera", () => {
        expect(html).not.toContain("<klienta>");
        expect(html).not.toContain("<b>");
        expect(html).not.toContain("<i>serwera");
        expect(html).toContain("&lt;klienta&gt;");
    });
    it("bez skryptów i zasobów zewnętrznych", () => {
        expect(html).not.toMatch(/<script|<link|src=|https?:\/\//i);
    });
    it("niesie notę o braku w korpusie i dokładną listę wysłanych pozycji", () => {
        expect(html).toContain(t("citationCheck.notInCorpusNote"));
        expect(html).toContain("&quot;ref&quot;: &quot;c2&quot;");
    });
    it("nie niesie całego tekstu pisma - tylko fragmenty powołań", () => {
        expect(html).not.toContain("Zob.");
    });
});

describe("R-CC-01 / R-CC-04 - pozycje zatrzymane i noty serwera", () => {
    const adres = cyt({
        ref: "c3",
        signature: "POLNA 12/24",
        excerpt: "Polna 12/24",
        status: "not_sent",
        not_sent_reason: "not_court_signature",
    });
    const wlasna = cyt({
        ref: "c4",
        signature: "I C 1234/25",
        excerpt: "I C 1234/25",
        status: "not_sent",
        not_sent_reason: "own_case_signature",
    });

    it("powód zatrzymania jest widoczny, stan nigdy zielony", () => {
        expect(detailLines(adres)).toContain(t("citationCheck.notSentReason.not_court_signature"));
        expect(detailLines(wlasna)).toContain(t("citationCheck.notSentReason.own_case_signature"));
        expect(severityOf(adres)).toBe("none");
        expect(statusLabel("not_sent")).toBe(t("citationCheck.status.not_sent"));
    });

    it("raport z notą serwera nie-napisem powstaje, a liczba zatrzymanych jest w nim nazwana", () => {
        const r: CheckedResponse = {
            status: "ok",
            filename: "pismo.docx",
            verifier: "repertorium",
            text: "x",
            citations: [adres, wlasna],
            withoutAct: 0,
            windows: 1,
            sent: [],
            notSent: 0,
            withheld: 2,
            asOf: null,
            checkedOn: null,
            snapshot: null,
            serverNotes: [{ html: "<b>x</b>" } as unknown as string],
            failedCalls: 0,
        };
        const html = buildReportHtml(r, new Date("2026-10-02T00:00:00Z"));
        expect(html).toContain("[object Object]");
        expect(html).not.toContain("<b>x</b>");
        expect(html).toContain(fill(t("citationCheck.withheldCount"), { n: 2 }));
    });
});

describe("reportFilename", () => {
    it("bezpieczna nazwa pliku z datą", () => {
        expect(reportFilename("Pozew / wersja: 2.docx", new Date("2026-09-30T00:00:00Z"))).toBe(
            "sprawdzenie-powolan-Pozew-wersja-2-2026-09-30.html",
        );
    });
});
